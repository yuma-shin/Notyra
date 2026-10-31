//! StopBarrier: 全 Plugin_Host_Window での Plugin_Stop 完了を待ち合わせる。
//!
//! アンインストール・更新・開発者モードの再読み込みでは、ファイルを削除・置き換える前に
//! 開いているすべての Plugin_Host_Window（`main` / `note_*`）で旧バージョンの Plugin_Stop を
//! 完了させる必要がある（Requirements 9.7, 9.8, 10.11, 19.10）。
//!
//! 手順:
//! 1. 開いている Plugin_Host_Window のラベル集合を待機対象として登録する
//! 2. `plugins:stop-request`（`{ id, requestId }`）を全ウィンドウへ emit する
//! 3. 各ウィンドウの `plugin_ack_stop(requestId)` で待機対象から外す
//! 4. 待機対象が空になるか、タイムアウト（既定15秒）で完了する
//!
//! 待機中に閉じられたウィンドウは ack を返せないため、定期的に開いているウィンドウを確認して
//! 待機対象から外す。

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Notify;

/// Plugin_Stop を要求するイベント名
pub const STOP_REQUEST_EVENT: &str = "plugins:stop-request";

/// 既定の待機上限（deactivate の上限10秒 + 余裕）
pub const DEFAULT_STOP_TIMEOUT: Duration = Duration::from_secs(15);

/// 閉じられたウィンドウを待機対象から外すための確認間隔
const WINDOW_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// `plugins:stop-request` のペイロード
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StopRequestPayload {
    pub id: String,
    pub request_id: String,
}

/// 待ち合わせの結果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopOutcome {
    /// 待機対象のすべてのウィンドウが ack した（または閉じられた／待機対象がなかった）
    Completed,
    /// タイムアウトした。`pending` は ack を返さなかったウィンドウのラベル（昇順）
    TimedOut { pending: Vec<String> },
}

struct BarrierEntry {
    remaining: HashSet<String>,
    notify: Arc<Notify>,
}

/// ウィンドウラベルが Plugin_Host_Window（`main` または `note_*`）かを判定する
pub fn is_host_window_label(label: &str) -> bool {
    label == "main" || label.starts_with("note_")
}

/// Plugin_Stop の完了を待ち合わせるバリア
#[derive(Default)]
pub struct StopBarrier {
    pending: Mutex<HashMap<String /* requestId */, BarrierEntry>>,
}

impl StopBarrier {
    pub fn new() -> Self {
        Self::default()
    }

    /// 開いているすべての Plugin_Host_Window に Plugin_Stop を要求し、完了を待つ。
    pub async fn request_stop<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        plugin_id: &str,
        timeout: Duration,
    ) -> StopOutcome {
        let targets = open_host_labels(app);
        if targets.is_empty() {
            return StopOutcome::Completed;
        }

        // ack の取りこぼしを防ぐため、emit より前に待機対象を登録する
        let request_id = self.begin(targets);
        let payload = StopRequestPayload {
            id: plugin_id.to_string(),
            request_id: request_id.clone(),
        };
        if let Err(e) = app.emit(STOP_REQUEST_EVENT, payload) {
            eprintln!("[notyra] failed to emit {STOP_REQUEST_EVENT}: {e}");
        }

        self.wait(&request_id, timeout, || open_host_labels(app)).await
    }

    /// 待機対象のウィンドウからの応答を記録する。未知の requestId やラベルは無視する。
    pub fn ack(&self, request_id: &str, window_label: &str) {
        let mut pending = self.pending.lock();
        if let Some(entry) = pending.get_mut(request_id) {
            entry.remaining.remove(window_label);
            if entry.remaining.is_empty() {
                // 待機側がまだ notified() に入っていなくても permit が残るため取りこぼさない
                entry.notify.notify_one();
            }
        }
    }

    /// 待機対象を登録し requestId を返す。
    fn begin(&self, targets: impl IntoIterator<Item = String>) -> String {
        let request_id = new_request_id();
        let entry = BarrierEntry {
            remaining: targets.into_iter().collect(),
            notify: Arc::new(Notify::new()),
        };
        self.pending.lock().insert(request_id.clone(), entry);
        request_id
    }

    /// 開いていないウィンドウを待機対象から外す。
    fn retain_open(&self, request_id: &str, open: &HashSet<String>) {
        let mut pending = self.pending.lock();
        if let Some(entry) = pending.get_mut(request_id) {
            entry.remaining.retain(|label| open.contains(label));
            if entry.remaining.is_empty() {
                entry.notify.notify_one();
            }
        }
    }

    /// 待機対象が空なら true を返す（未登録の requestId も完了扱い）。
    fn is_done(&self, request_id: &str) -> bool {
        self.pending
            .lock()
            .get(request_id)
            .is_none_or(|e| e.remaining.is_empty())
    }

    /// 待機対象が空になるか、タイムアウトするまで待つ。完了後にエントリを削除する。
    async fn wait<F>(&self, request_id: &str, timeout: Duration, mut open_labels: F) -> StopOutcome
    where
        F: FnMut() -> HashSet<String>,
    {
        let notify = match self.pending.lock().get(request_id) {
            Some(e) => e.notify.clone(),
            None => return StopOutcome::Completed,
        };
        let deadline = tokio::time::Instant::now() + timeout;

        loop {
            self.retain_open(request_id, &open_labels());
            if self.is_done(request_id) {
                break;
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                break;
            }
            let next_poll = (now + WINDOW_POLL_INTERVAL).min(deadline);
            tokio::select! {
                _ = notify.notified() => {}
                _ = tokio::time::sleep_until(next_poll) => {}
            }
        }

        let entry = self.pending.lock().remove(request_id);
        match entry {
            Some(e) if !e.remaining.is_empty() => {
                let mut pending: Vec<String> = e.remaining.into_iter().collect();
                pending.sort();
                StopOutcome::TimedOut { pending }
            }
            _ => StopOutcome::Completed,
        }
    }
}

/// 開いている Plugin_Host_Window のラベル集合
fn open_host_labels<R: Runtime>(app: &AppHandle<R>) -> HashSet<String> {
    app.webview_windows()
        .into_keys()
        .filter(|label| is_host_window_label(label))
        .collect()
}

fn new_request_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("stop-{nanos:x}-{seq:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(xs: &[&str]) -> HashSet<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn host_window_labels() {
        assert!(is_host_window_label("main"));
        assert!(is_host_window_label("note_abc"));
        assert!(!is_host_window_label("settings"));
        assert!(!is_host_window_label("print_window"));
        assert!(!is_host_window_label("mainx"));
    }

    #[test]
    fn request_ids_are_unique() {
        let a = new_request_id();
        let b = new_request_id();
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn completes_when_all_windows_ack() {
        let barrier = Arc::new(StopBarrier::new());
        let id = barrier.begin(labels(&["main", "note_a"]));
        let open = labels(&["main", "note_a"]);

        let b = barrier.clone();
        let rid = id.clone();
        let acker = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            b.ack(&rid, "main");
            tokio::time::sleep(Duration::from_millis(20)).await;
            b.ack(&rid, "note_a");
        });

        let started = std::time::Instant::now();
        let outcome = barrier
            .wait(&id, Duration::from_secs(5), || open.clone())
            .await;
        acker.await.unwrap();

        assert_eq!(outcome, StopOutcome::Completed);
        assert!(started.elapsed() < Duration::from_secs(2));
        // 完了後はエントリが削除される
        assert!(barrier.pending.lock().is_empty());
    }

    #[tokio::test]
    async fn ack_before_wait_is_not_lost() {
        let barrier = StopBarrier::new();
        let id = barrier.begin(labels(&["main"]));
        barrier.ack(&id, "main");
        let outcome = barrier
            .wait(&id, Duration::from_secs(5), || labels(&["main"]))
            .await;
        assert_eq!(outcome, StopOutcome::Completed);
    }

    #[tokio::test]
    async fn times_out_with_pending_labels() {
        let barrier = StopBarrier::new();
        let id = barrier.begin(labels(&["main", "note_b", "note_a"]));
        barrier.ack(&id, "main");
        let open = labels(&["main", "note_a", "note_b"]);
        let outcome = barrier
            .wait(&id, Duration::from_millis(150), || open.clone())
            .await;
        assert_eq!(
            outcome,
            StopOutcome::TimedOut {
                pending: vec!["note_a".to_string(), "note_b".to_string()]
            }
        );
        assert!(barrier.pending.lock().is_empty());
    }

    #[tokio::test]
    async fn closed_windows_are_removed_from_targets() {
        let barrier = Arc::new(StopBarrier::new());
        let id = barrier.begin(labels(&["main", "note_a"]));
        barrier.ack(&id, "main");

        // note_a は ack を返さずに閉じられる
        let open = Arc::new(Mutex::new(labels(&["main", "note_a"])));
        let closer = {
            let open = open.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(50)).await;
                open.lock().remove("note_a");
            })
        };

        let started = std::time::Instant::now();
        let outcome = barrier
            .wait(&id, Duration::from_secs(5), || open.lock().clone())
            .await;
        closer.await.unwrap();

        assert_eq!(outcome, StopOutcome::Completed);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn unknown_request_and_label_are_ignored() {
        let barrier = StopBarrier::new();
        let id = barrier.begin(labels(&["main"]));
        barrier.ack("unknown", "main");
        barrier.ack(&id, "settings");
        assert!(!barrier.is_done(&id));
        barrier.ack(&id, "main");
        assert!(barrier.is_done(&id));
    }
}
