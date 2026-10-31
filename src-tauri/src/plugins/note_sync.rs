//! A plugin mutation must drain editor saves before writing, then reconcile
//! every open editor before reporting success. Watcher events cannot do this:
//! they contain neither the origin nor the old/new paths of an operation.
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use super::barrier::{new_request_id, open_host_labels, StopBarrier, StopOutcome};
use super::PluginError;

pub const NOTE_CHANGE_EVENT: &str = "notes:mutation";
const SYNC_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMutation {
    pub request_id: String,
    pub transaction_id: String,
    pub phase: &'static str,
    pub kind: &'static str,
    pub paths: Vec<String>,
    pub new_path: Option<String>,
}

#[derive(Default)]
pub struct NoteSync {
    // Only plugin mutations take this lock. Ordinary saves must remain usable
    // while prepare is waiting for editors to flush their pending changes.
    operations: tokio::sync::Mutex<()>,
    barrier: StopBarrier,
    replies: Mutex<HashMap<String, Replies>>,
}

struct Replies {
    remaining: HashSet<String>,
    errors: Vec<String>,
}

trait Transport {
    fn windows(&self) -> HashSet<String>;
    fn emit(&self, event: NoteMutation) -> Result<(), PluginError>;
}

struct AppTransport<'a, R: Runtime>(&'a AppHandle<R>);
impl<R: Runtime> Transport for AppTransport<'_, R> {
    fn windows(&self) -> HashSet<String> {
        open_host_labels(self.0)
    }
    fn emit(&self, event: NoteMutation) -> Result<(), PluginError> {
        self.0
            .emit(NOTE_CHANGE_EVENT, event)
            .map_err(|e| sync_error(e.to_string()))
    }
}

impl NoteSync {
    pub fn ack(&self, request: &str, window: &str, error: Option<String>) {
        let mut replies = self.replies.lock();
        let Some(reply) = replies.get_mut(request) else {
            return;
        };
        if !reply.remaining.remove(window) {
            return;
        }
        if let Some(error) = error {
            reply.errors.push(format!("{window}: {error}"));
        }
        drop(replies);
        self.barrier.ack(request, window);
    }

    async fn notify(
        &self,
        transport: &impl Transport,
        event: &mut NoteMutation,
        timeout: Duration,
    ) -> Result<(), PluginError> {
        let windows = transport.windows();
        event.request_id = self.barrier.begin(windows.clone());
        self.replies.lock().insert(
            event.request_id.clone(),
            Replies {
                remaining: windows,
                errors: vec![],
            },
        );
        let emitted = transport.emit(event.clone());
        let timeout = if emitted.is_ok() {
            timeout
        } else {
            Duration::ZERO
        };
        let outcome = self
            .barrier
            .wait(&event.request_id, timeout, || transport.windows())
            .await;
        let failures = self
            .replies
            .lock()
            .remove(&event.request_id)
            .map(|r| r.errors)
            .unwrap_or_default();
        emitted?;
        if let StopOutcome::TimedOut { pending } = outcome {
            return Err(sync_error(format!(
                "editor synchronization timed out: {pending:?}"
            )));
        }
        if !failures.is_empty() {
            return Err(sync_error(failures.join("; ")));
        }
        Ok(())
    }

    pub async fn mutate<R, T, F>(
        &self,
        app: &AppHandle<R>,
        kind: &'static str,
        paths: Vec<String>,
        operation: F,
    ) -> Result<T, PluginError>
    where
        R: Runtime,
        F: Future<Output = Result<(T, Option<String>), PluginError>>,
    {
        self.run(&AppTransport(app), kind, paths, operation, SYNC_TIMEOUT)
            .await
    }

    async fn run<T>(
        &self,
        transport: &impl Transport,
        kind: &'static str,
        paths: Vec<String>,
        operation: impl Future<Output = Result<(T, Option<String>), PluginError>>,
        timeout: Duration,
    ) -> Result<T, PluginError> {
        let _guard = self.operations.lock().await;
        let mut event = NoteMutation {
            request_id: String::new(),
            transaction_id: String::new(),
            phase: "prepare",
            kind,
            paths,
            new_path: None,
        };
        // Use a separate stable transaction ID so a late prepare response can
        // never acknowledge the commit phase of the same operation.
        event.transaction_id = new_request_id();
        if let Err(error) = self.notify(transport, &mut event, timeout).await {
            event.phase = "abort";
            let _ = transport.emit(event);
            return Err(error);
        }
        match operation.await {
            Ok((result, new_path)) => {
                event.phase = "commit";
                event.new_path = new_path;
                self.notify(transport, &mut event, timeout).await?;
                Ok(result)
            }
            Err(error) => {
                event.phase = "abort";
                let _ = transport.emit(event);
                Err(error)
            }
        }
    }
}

fn sync_error(message: String) -> PluginError {
    PluginError::Io {
        message: format!("note synchronization failed: {message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

    struct MockTransport {
        windows: Mutex<HashSet<String>>,
        events: UnboundedSender<NoteMutation>,
    }
    impl Transport for MockTransport {
        fn windows(&self) -> HashSet<String> {
            self.windows.lock().clone()
        }
        fn emit(&self, event: NoteMutation) -> Result<(), PluginError> {
            self.events
                .send(event)
                .map_err(|e| sync_error(e.to_string()))
        }
    }
    fn transport(labels: &[&str]) -> (MockTransport, UnboundedReceiver<NoteMutation>) {
        let (events, receiver) = unbounded_channel();
        (
            MockTransport {
                windows: Mutex::new(labels.iter().map(|s| s.to_string()).collect()),
                events,
            },
            receiver,
        )
    }

    #[tokio::test]
    async fn rename_waits_for_all_saves_and_all_editor_rebindings() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("old.md");
        let new = tmp.path().join("new.md");
        std::fs::write(&old, "saved edit").unwrap();
        let sync = NoteSync::default();
        let (transport, mut events) = transport(&["main", "note_1"]);
        let returned = AtomicBool::new(false);
        let operation = async {
            let result = sync
                .run(
                    &transport,
                    "rename",
                    vec![old.to_string_lossy().into()],
                    async {
                        tokio::fs::rename(&old, &new).await?;
                        let new = new.to_string_lossy().into_owned();
                        Ok((new.clone(), Some(new)))
                    },
                    Duration::from_secs(1),
                )
                .await;
            returned.store(true, Ordering::SeqCst);
            result
        };
        let editors = async {
            let prepare = events.recv().await.unwrap();
            assert_eq!(prepare.phase, "prepare");
            sync.ack(&prepare.request_id, "main", None);
            // Duplicate/unknown windows cannot finish the other editor or
            // inject an error into an otherwise successful operation.
            sync.ack(&prepare.request_id, "main", Some("duplicate".into()));
            sync.ack(&prepare.request_id, "settings", Some("unknown".into()));
            tokio::task::yield_now().await;
            assert!(old.exists());
            assert!(!new.exists());
            sync.ack(&prepare.request_id, "note_1", None);
            let commit = events.recv().await.unwrap();
            assert_eq!(commit.phase, "commit");
            assert_ne!(prepare.request_id, commit.request_id);
            assert_eq!(prepare.transaction_id, commit.transaction_id);
            assert_eq!(commit.new_path.as_deref(), Some(new.to_str().unwrap()));
            assert!(!old.exists());
            assert!(new.exists());
            // A delayed prepare ack cannot acknowledge commit.
            sync.ack(&prepare.request_id, "note_1", None);
            sync.ack(&commit.request_id, "main", None);
            tokio::task::yield_now().await;
            assert!(!returned.load(Ordering::SeqCst));
            sync.ack(&commit.request_id, "note_1", None);
        };
        let (result, ()) = tokio::join!(operation, editors);
        assert_eq!(result.unwrap(), new.to_string_lossy());
        assert_eq!(std::fs::read_to_string(new).unwrap(), "saved edit");
    }

    #[tokio::test]
    async fn prepare_error_or_timeout_aborts_without_writing() {
        for timeout in [false, true] {
            let sync = NoteSync::default();
            let (transport, mut events) = transport(&["main"]);
            let written = AtomicBool::new(false);
            let operation = sync.run(
                &transport,
                "update",
                vec!["a.md".into()],
                async {
                    written.store(true, Ordering::SeqCst);
                    Ok(((), None))
                },
                Duration::from_millis(30),
            );
            let editor = async {
                let prepare = events.recv().await.unwrap();
                if !timeout {
                    sync.ack(&prepare.request_id, "main", Some("disk full".into()));
                }
                let abort = events.recv().await.unwrap();
                assert_eq!(abort.phase, "abort");
                assert_eq!(abort.transaction_id, prepare.transaction_id);
            };
            let (result, ()) = tokio::join!(operation, editor);
            assert!(result.is_err());
            assert!(!written.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn commit_failure_does_not_report_a_successful_plugin_operation() {
        let sync = NoteSync::default();
        let (transport, mut events) = transport(&["main"]);
        let written = AtomicBool::new(false);
        let operation = sync.run(
            &transport,
            "update",
            vec![],
            async {
                written.store(true, Ordering::SeqCst);
                Ok(((), None))
            },
            Duration::from_secs(1),
        );
        let editor = async {
            let prepare = events.recv().await.unwrap();
            sync.ack(&prepare.request_id, "main", None);
            let commit = events.recv().await.unwrap();
            sync.ack(&commit.request_id, "main", Some("reload failed".into()));
        };
        let (result, ()) = tokio::join!(operation, editor);
        assert!(result.is_err());
        assert!(written.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn concurrent_plugin_mutations_are_serialized_and_closed_windows_do_not_block() {
        let sync = NoteSync::default();
        let (transport, mut events) = transport(&["main", "note_closed"]);
        let first = sync.run(
            &transport,
            "update",
            vec![],
            async { Ok(((), None)) },
            Duration::from_secs(1),
        );
        let second = sync.run(
            &transport,
            "move",
            vec![],
            async { Ok(((), Some("b.md".into()))) },
            Duration::from_secs(1),
        );
        let editor = async {
            let mut phases = vec![];
            for _ in 0..4 {
                let event = events.recv().await.unwrap();
                phases.push(event.phase);
                transport.windows.lock().remove("note_closed");
                sync.ack(&event.request_id, "main", None);
            }
            assert_eq!(phases, ["prepare", "commit", "prepare", "commit"]);
        };
        let (a, b, ()) = tokio::join!(first, second, editor);
        assert!(a.is_ok());
        assert!(b.is_ok());
    }
}
