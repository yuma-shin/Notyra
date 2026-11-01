//! PluginStore: `plugins/state.json` と `plugins/settings/<id>.json` の永続化。
//!
//! ファイル配置（`{app_data_dir}/plugins/`）:
//!
//! ```text
//! state.json              # PluginStateFile（Installed_Plugin_State 等）
//! settings/<id>.json      # Plugin_Settings の値
//! installed/<id>/         # 展開済み Plugin_Package
//! staging/<uuid>/         # ダウンロード・展開中の一時領域（起動時に削除）
//! backup/<id>-<ts>/       # 更新中の旧バージョン退避（起動時に復元または削除）
//! ```
//!
//! JSON の形は `src/shared/plugin/types.ts` の `PluginStateFile` /
//! `InstalledPluginState` と一致させる（camelCase）。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::error::PluginError;

/// 対応している `state.json` の `schemaVersion`
pub const SCHEMA_VERSION: u32 = 1;

const STATE_FILE: &str = "state.json";
const SETTINGS_DIR: &str = "settings";
const INSTALLED_DIR: &str = "installed";
const STAGING_DIR: &str = "staging";
const BACKUP_DIR: &str = "backup";

// `commands/markdown.rs` の `atomic_write` と同じリトライ設定
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_MS: u64 = 200;

// ---------------------------------------------------------------------------
// serde 構造体（TS: src/shared/plugin/types.ts）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Permission {
    #[serde(rename = "notes:read")]
    NotesRead,
    #[serde(rename = "notes:write")]
    NotesWrite,
    #[serde(rename = "clipboard")]
    Clipboard,
    #[serde(rename = "shell:openExternal")]
    ShellOpenExternal,
    #[serde(rename = "network")]
    Network,
}

impl Permission {
    pub fn as_str(&self) -> &'static str {
        match self {
            Permission::NotesRead => "notes:read",
            Permission::NotesWrite => "notes:write",
            Permission::Clipboard => "clipboard",
            Permission::ShellOpenExternal => "shell:openExternal",
            Permission::Network => "network",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PluginSource {
    Github { owner: String, repo: String },
    Local { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingConsent {
    pub added_permissions: Vec<Permission>,
    pub added_destinations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisabledReason {
    User,
    ActivateFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginState {
    pub id: String,
    pub version: String,
    pub source: PluginSource,
    pub enabled: bool,
    pub consented_permissions: Vec<Permission>,
    pub consented_destinations: Vec<String>,
    // 以下は補助項目
    /// 更新・開発者モード再読み込みごとに +1（loadKey 用）
    #[serde(default)]
    pub generation: u64,
    /// Developer_Plugin の同意待ち
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_consent: Option<PendingConsent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_reason: Option<DisabledReason>,
    /// ISO 8601
    pub installed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStateFile {
    pub schema_version: u32,
    #[serde(default)]
    pub third_party_warning_acknowledged: bool,
    #[serde(default)]
    pub developer_mode: bool,
    /// 配列順 = Load_Order
    #[serde(default)]
    pub plugins: Vec<InstalledPluginState>,
}

impl Default for PluginStateFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            third_party_warning_acknowledged: false,
            developer_mode: false,
            plugins: Vec::new(),
        }
    }
}

impl PluginStateFile {
    pub fn find(&self, id: &str) -> Option<&InstalledPluginState> {
        self.plugins.iter().find(|p| p.id == id)
    }

    pub fn find_mut(&mut self, id: &str) -> Option<&mut InstalledPluginState> {
        self.plugins.iter_mut().find(|p| p.id == id)
    }
}

// ---------------------------------------------------------------------------
// PluginStore
// ---------------------------------------------------------------------------

pub struct PluginStore {
    /// `{app_data_dir}/plugins`
    root: PathBuf,
    state: RwLock<PluginStateFile>,
    /// 起動時に検出した問題（state.json の破損など）。Toast / Plugins_Tab での表示用
    startup_error: Option<PluginError>,
    /// settings/<id>.json の読み書きを直列化する
    settings_lock: Mutex<()>,
}

impl PluginStore {
    /// `root`（`{app_data_dir}/plugins`）から状態を読み込む。
    ///
    /// - 必要なディレクトリを作成し、`staging/` と `backup/` の残骸を片付ける
    /// - `state.json` がなければ空状態
    /// - `state.json` が破損している、または `schemaVersion` が未知の場合は、
    ///   上書きせず `state.corrupt-<ts>.json` に退避し、空状態で起動する
    ///   （`startup_error` に `CorruptState` を記録する）
    pub fn load(root: PathBuf) -> Result<Self, PluginError> {
        fs::create_dir_all(&root)?;
        fs::create_dir_all(root.join(SETTINGS_DIR))?;
        fs::create_dir_all(root.join(INSTALLED_DIR))?;

        cleanup_staging(&root.join(STAGING_DIR));
        recover_backups(&root.join(BACKUP_DIR), &root.join(INSTALLED_DIR));

        let state_path = root.join(STATE_FILE);
        let (state, startup_error) = match fs::read_to_string(&state_path) {
            Ok(text) => match parse_state(&text) {
                Ok(state) => (state, None),
                Err(message) => {
                    let moved = quarantine_corrupt(&root, &state_path)?;
                    eprintln!(
                        "[notyra] plugins/state.json is corrupt ({}); moved to {}",
                        message,
                        moved.display()
                    );
                    (
                        PluginStateFile::default(),
                        Some(PluginError::CorruptState { message }),
                    )
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => (PluginStateFile::default(), None),
            Err(e) => return Err(e.into()),
        };

        Ok(Self {
            root,
            state: RwLock::new(state),
            startup_error,
            settings_lock: Mutex::new(()),
        })
    }

    /// `load` が失敗したときの代替。空状態で起動し、エラーを `startup_error` に保持する。
    pub fn fallback(root: PathBuf, error: PluginError) -> Self {
        Self {
            root,
            state: RwLock::new(PluginStateFile::default()),
            startup_error: Some(error),
            settings_lock: Mutex::new(()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn installed_root(&self) -> PathBuf {
        self.root.join(INSTALLED_DIR)
    }

    pub fn staging_root(&self) -> PathBuf {
        self.root.join(STAGING_DIR)
    }

    pub fn backup_root(&self) -> PathBuf {
        self.root.join(BACKUP_DIR)
    }

    /// 更新時の旧バージョン退避先 `backup/<id>-<ts>`（起動時の復元処理と同じ命名規則）
    pub fn backup_dir_for(&self, id: &str, ts: u64) -> PathBuf {
        self.backup_root().join(format!("{id}-{ts}"))
    }

    pub fn startup_error(&self) -> Option<&PluginError> {
        self.startup_error.as_ref()
    }

    pub fn snapshot(&self) -> PluginStateFile {
        self.state.read().clone()
    }

    /// 状態を更新して `state.json` に書き出す。
    ///
    /// `f` は複製に対して適用し、`f` が失敗した場合、または書き出しに失敗した場合は
    /// メモリ上の状態を変更しない（＝更新前の状態に巻き戻る）。
    /// 書き込みロックを保持したまま書き出すため、更新は直列化される。
    pub fn update<F>(&self, f: F) -> Result<PluginStateFile, PluginError>
    where
        F: FnOnce(&mut PluginStateFile) -> Result<(), PluginError>,
    {
        let mut guard = self.state.write();
        let mut next = guard.clone();
        f(&mut next)?;
        next.schema_version = SCHEMA_VERSION;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| PluginError::Io {
            message: e.to_string(),
        })?;
        atomic_write_sync(&self.root.join(STATE_FILE), &bytes)?;
        *guard = next.clone();
        Ok(next)
    }

    /// Plugin のファイルがあるディレクトリ。
    /// GitHub 由来は `installed/<id>`、Developer_Plugin は登録済みのローカルフォルダ。
    /// 未登録なら `None`。
    pub fn plugin_dir(&self, id: &str) -> Option<PathBuf> {
        let state = self.state.read();
        let plugin = state.find(id)?;
        match &plugin.source {
            PluginSource::Github { .. } => {
                if !is_valid_plugin_id(id) {
                    return None;
                }
                Some(self.installed_root().join(id))
            }
            PluginSource::Local { path } => Some(PathBuf::from(path)),
        }
    }

    /// Plugin_Settings の保存値。ファイルがない、または JSON オブジェクトとして
    /// 読めない場合は空（＝すべて既定値として扱われる）。
    pub fn read_settings(&self, id: &str) -> Result<Map<String, Value>, PluginError> {
        let path = self.settings_path(id)?;
        let _guard = self.settings_lock.lock();
        read_settings_file(&path)
    }

    /// Plugin_Settings の値を1件保存する（他のキーの値は維持する）。
    pub fn write_setting(&self, id: &str, key: &str, value: Value) -> Result<(), PluginError> {
        let path = self.settings_path(id)?;
        let _guard = self.settings_lock.lock();
        let mut values = read_settings_file(&path)?;
        values.insert(key.to_string(), value);
        let bytes = serde_json::to_vec_pretty(&Value::Object(values)).map_err(|e| {
            PluginError::Io {
                message: e.to_string(),
            }
        })?;
        fs::create_dir_all(self.root.join(SETTINGS_DIR))?;
        atomic_write_sync(&path, &bytes)
    }

    /// Plugin_Settings の値をファイルごと削除する（アンインストール時）。存在しなくても成功。
    pub fn delete_settings(&self, id: &str) -> Result<(), PluginError> {
        let path = self.settings_path(id)?;
        let _guard = self.settings_lock.lock();
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    fn settings_path(&self, id: &str) -> Result<PathBuf, PluginError> {
        if !is_valid_plugin_id(id) {
            // パス区切りなどを含む ID でディレクトリ外を指さないよう拒否する
            return Err(PluginError::NotInstalled);
        }
        Ok(self.root.join(SETTINGS_DIR).join(format!("{id}.json")))
    }
}

// ---------------------------------------------------------------------------
// 補助関数
// ---------------------------------------------------------------------------

/// Plugin_ID の書式（npm パッケージ名規則・スコープなし）。
/// TS の Manifest_Parser と同じ規則: `^[a-z0-9][a-z0-9._-]*$`、1〜214文字、
/// `node_modules` / `favicon.ico` 不可。
pub fn is_valid_plugin_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 214 || id == "node_modules" || id == "favicon.ico" {
        return false;
    }
    let mut chars = id.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

fn parse_state(text: &str) -> Result<PluginStateFile, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    match value.get("schemaVersion").and_then(Value::as_u64) {
        Some(v) if v == SCHEMA_VERSION as u64 => {}
        _ => {
            return Err(format!(
                "unsupported schemaVersion: {}",
                value
                    .get("schemaVersion")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "missing".into())
            ))
        }
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 破損した state.json を `state.corrupt-<ts>.json` に退避する（既存の退避ファイルは上書きしない）
fn quarantine_corrupt(root: &Path, state_path: &Path) -> Result<PathBuf, PluginError> {
    let ts = now_millis();
    let mut dest = root.join(format!("state.corrupt-{ts}.json"));
    let mut n = 1u32;
    while dest.exists() {
        dest = root.join(format!("state.corrupt-{ts}-{n}.json"));
        n += 1;
    }
    fs::rename(state_path, &dest)?;
    Ok(dest)
}

/// 前回の異常終了で残った `staging/` を削除する（ベストエフォート）
fn cleanup_staging(staging: &Path) {
    if staging.exists() {
        if let Err(e) = fs::remove_dir_all(staging) {
            eprintln!("[notyra] failed to clean up {}: {}", staging.display(), e);
        }
    }
}

/// `backup/<id>-<ts>` を片付ける。`installed/<id>` が欠けていれば最新の退避を復元し、
/// それ以外の退避は削除する。復元に失敗した退避は削除しない（データ保全）。
fn recover_backups(backup: &Path, installed: &Path) {
    let entries = match fs::read_dir(backup) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut parsed: Vec<(String, u64, PathBuf)> = Vec::new();
    let mut unknown: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        match parse_backup_name(&name) {
            Some((id, ts)) if path.is_dir() => parsed.push((id, ts, path)),
            _ => unknown.push(path),
        }
    }
    // 同じ ID の中で新しい退避を先に処理する
    parsed.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));

    let mut keep_backup_dir = false;
    for (id, _ts, path) in parsed {
        let target = installed.join(&id);
        if !target.exists() {
            if let Err(e) = fs::rename(&path, &target) {
                eprintln!(
                    "[notyra] failed to restore {} to {}: {}",
                    path.display(),
                    target.display(),
                    e
                );
                keep_backup_dir = true;
            }
            continue;
        }
        if let Err(e) = fs::remove_dir_all(&path) {
            eprintln!("[notyra] failed to remove {}: {}", path.display(), e);
            keep_backup_dir = true;
        }
    }
    for path in unknown {
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if result.is_err() {
            keep_backup_dir = true;
        }
    }
    if !keep_backup_dir {
        let _ = fs::remove_dir(backup);
    }
}

/// `<id>-<ts>`（`ts` は数字のみ）を分解する
fn parse_backup_name(name: &str) -> Option<(String, u64)> {
    let (id, ts) = name.rsplit_once('-')?;
    if ts.is_empty() || !ts.bytes().all(|b| b.is_ascii_digit()) || !is_valid_plugin_id(id) {
        return None;
    }
    Some((id.to_string(), ts.parse().ok()?))
}

fn read_settings_file(path: &Path) -> Result<Map<String, Value>, PluginError> {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => Ok(map),
            _ => Ok(Map::new()),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e.into()),
    }
}

/// 対象ファイルと同じディレクトリに一時ファイルパスを生成する
/// （`commands/markdown.rs` の `temp_path_for` と同じ命名）
fn temp_path_for(target: &Path) -> PathBuf {
    let file_name = target
        .file_name()
        .map(|n| format!(".{}.notyra_tmp", n.to_string_lossy()))
        .unwrap_or_else(|| ".notyra_tmp".to_string());
    target.with_file_name(file_name)
}

fn is_retryable(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(1224) | Some(32) | Some(5))
        || e.kind() == io::ErrorKind::PermissionDenied
}

/// `commands/markdown.rs` の `atomic_write` と同方式（一時ファイル + rename、
/// 一時的なロックエラーはリトライ）の同期版。ロック保持中に呼ぶため同期で実装する。
///
/// Err の場合、`path` の元の内容は変更されない。
fn atomic_write_sync(path: &Path, bytes: &[u8]) -> Result<(), PluginError> {
    let tmp = temp_path_for(path);
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }

    let mut retries = 0u32;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) if is_retryable(&e) && retries < MAX_RETRIES => {
                retries += 1;
                std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e.into());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn sample_plugin(id: &str) -> InstalledPluginState {
        InstalledPluginState {
            id: id.to_string(),
            version: "1.0.0".into(),
            source: PluginSource::Github {
                owner: "someone".into(),
                repo: id.to_string(),
            },
            enabled: true,
            consented_permissions: vec![Permission::Network, Permission::NotesRead],
            consented_destinations: vec!["api.example.com".into()],
            generation: 0,
            pending_consent: None,
            disabled_reason: None,
            installed_at: "2026-07-04T00:00:00Z".into(),
        }
    }

    fn plugins_root(dir: &TempDir) -> PathBuf {
        dir.path().join("plugins")
    }

    #[test]
    fn json_shape_matches_typescript_types() {
        let mut p = sample_plugin("notyra-toc");
        p.pending_consent = Some(PendingConsent {
            added_permissions: vec![Permission::ShellOpenExternal],
            added_destinations: vec!["*.example.com:8443".into()],
        });
        p.disabled_reason = Some(DisabledReason::ActivateFailed);
        let local = InstalledPluginState {
            source: PluginSource::Local { path: "/dev/plugin".into() },
            consented_permissions: vec![Permission::NotesWrite, Permission::Clipboard],
            ..sample_plugin("dev-plugin")
        };
        let state = PluginStateFile {
            schema_version: 1,
            third_party_warning_acknowledged: true,
            developer_mode: true,
            plugins: vec![p, local],
        };
        let v = serde_json::to_value(&state).unwrap();
        assert_eq!(
            v,
            json!({
                "schemaVersion": 1,
                "thirdPartyWarningAcknowledged": true,
                "developerMode": true,
                "plugins": [
                    {
                        "id": "notyra-toc",
                        "version": "1.0.0",
                        "source": { "type": "github", "owner": "someone", "repo": "notyra-toc" },
                        "enabled": true,
                        "consentedPermissions": ["network", "notes:read"],
                        "consentedDestinations": ["api.example.com"],
                        "generation": 0,
                        "pendingConsent": {
                            "addedPermissions": ["shell:openExternal"],
                            "addedDestinations": ["*.example.com:8443"]
                        },
                        "disabledReason": "activateFailed",
                        "installedAt": "2026-07-04T00:00:00Z"
                    },
                    {
                        "id": "dev-plugin",
                        "version": "1.0.0",
                        "source": { "type": "local", "path": "/dev/plugin" },
                        "enabled": true,
                        "consentedPermissions": ["notes:write", "clipboard"],
                        "consentedDestinations": ["api.example.com"],
                        "generation": 0,
                        "installedAt": "2026-07-04T00:00:00Z"
                    }
                ]
            })
        );
    }

    #[test]
    fn load_without_state_file_starts_empty_and_creates_dirs() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let store = PluginStore::load(root.clone()).unwrap();
        assert_eq!(store.snapshot(), PluginStateFile::default());
        assert!(store.startup_error().is_none());
        assert!(root.join("settings").is_dir());
        assert!(root.join("installed").is_dir());
    }

    #[test]
    fn update_persists_and_reload_returns_same_state() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let store = PluginStore::load(root.clone()).unwrap();
        let next = store
            .update(|s| {
                s.third_party_warning_acknowledged = true;
                s.plugins.push(sample_plugin("a"));
                s.plugins.push(sample_plugin("b"));
                Ok(())
            })
            .unwrap();
        assert_eq!(store.snapshot(), next);
        assert!(!root.join(".state.json.notyra_tmp").exists());

        let reloaded = PluginStore::load(root).unwrap();
        assert_eq!(reloaded.snapshot(), next);
        let ids: Vec<_> = reloaded.snapshot().plugins.into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn update_closure_error_leaves_state_unchanged() {
        let dir = TempDir::new().unwrap();
        let store = PluginStore::load(plugins_root(&dir)).unwrap();
        let before = store.snapshot();
        let err = store
            .update(|s| {
                s.developer_mode = true;
                Err(PluginError::AlreadyInstalled)
            })
            .unwrap_err();
        assert_eq!(err, PluginError::AlreadyInstalled);
        assert_eq!(store.snapshot(), before);
    }

    #[test]
    fn update_write_failure_rolls_back_memory() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let store = PluginStore::load(root.clone()).unwrap();
        store
            .update(|s| {
                s.plugins.push(sample_plugin("a"));
                Ok(())
            })
            .unwrap();
        let before = store.snapshot();

        // state.json をディレクトリに置き換えて rename を失敗させる
        fs::remove_file(root.join(STATE_FILE)).unwrap();
        fs::create_dir(root.join(STATE_FILE)).unwrap();

        let result = store.update(|s| {
            s.plugins.push(sample_plugin("b"));
            Ok(())
        });
        assert!(matches!(result, Err(PluginError::Io { .. })));
        assert_eq!(store.snapshot(), before);
        assert!(!root.join(".state.json.notyra_tmp").exists());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        fs::create_dir_all(&root).unwrap();
        let mut plugin = serde_json::to_value(sample_plugin("a")).unwrap();
        plugin["futureField"] = json!({ "x": 1 });
        let text = json!({
            "schemaVersion": 1,
            "thirdPartyWarningAcknowledged": true,
            "developerMode": false,
            "plugins": [plugin],
            "somethingNew": [1, 2, 3]
        })
        .to_string();
        fs::write(root.join(STATE_FILE), text).unwrap();

        let store = PluginStore::load(root).unwrap();
        assert!(store.startup_error().is_none());
        let s = store.snapshot();
        assert!(s.third_party_warning_acknowledged);
        assert_eq!(s.plugins, vec![sample_plugin("a")]);
    }

    fn assert_quarantined(root: &Path, original: &str, store: &PluginStore) {
        assert_eq!(store.snapshot(), PluginStateFile::default());
        assert!(matches!(
            store.startup_error(),
            Some(PluginError::CorruptState { .. })
        ));
        assert!(!root.join(STATE_FILE).exists());
        let moved: Vec<_> = fs::read_dir(root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("state.corrupt-") && n.ends_with(".json"))
            .collect();
        assert_eq!(moved.len(), 1);
        assert_eq!(fs::read_to_string(root.join(&moved[0])).unwrap(), original);
    }

    #[test]
    fn corrupt_json_is_quarantined_and_store_starts_empty() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        fs::create_dir_all(&root).unwrap();
        let original = "{ not json";
        fs::write(root.join(STATE_FILE), original).unwrap();

        let store = PluginStore::load(root.clone()).unwrap();
        assert_quarantined(&root, original, &store);

        // 以降の更新は退避ファイルを上書きしない
        store
            .update(|s| {
                s.developer_mode = true;
                Ok(())
            })
            .unwrap();
        assert_quarantined_file_intact(&root, original);
    }

    fn assert_quarantined_file_intact(root: &Path, original: &str) {
        let moved = fs::read_dir(root)
            .unwrap()
            .flatten()
            .find(|e| e.file_name().to_string_lossy().starts_with("state.corrupt-"))
            .unwrap();
        assert_eq!(fs::read_to_string(moved.path()).unwrap(), original);
    }

    #[test]
    fn unknown_schema_version_is_quarantined() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        fs::create_dir_all(&root).unwrap();
        let original = r#"{"schemaVersion":2,"plugins":[]}"#;
        fs::write(root.join(STATE_FILE), original).unwrap();

        let store = PluginStore::load(root.clone()).unwrap();
        assert_quarantined(&root, original, &store);
    }

    #[test]
    fn invalid_field_type_is_quarantined() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        fs::create_dir_all(&root).unwrap();
        let original = r#"{"schemaVersion":1,"plugins":[{"id":"a"}]}"#;
        fs::write(root.join(STATE_FILE), original).unwrap();

        let store = PluginStore::load(root.clone()).unwrap();
        assert_quarantined(&root, original, &store);
    }

    #[test]
    fn startup_removes_staging_leftovers() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let leftover = root.join("staging").join("abc");
        fs::create_dir_all(&leftover).unwrap();
        fs::write(leftover.join("package.json"), "{}").unwrap();

        PluginStore::load(root.clone()).unwrap();
        assert!(!root.join("staging").exists());
    }

    #[test]
    fn startup_restores_backup_when_installed_is_missing() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let older = root.join("backup").join("my-plugin-100");
        let newer = root.join("backup").join("my-plugin-200");
        fs::create_dir_all(&older).unwrap();
        fs::create_dir_all(&newer).unwrap();
        fs::write(older.join("package.json"), "old").unwrap();
        fs::write(newer.join("package.json"), "new").unwrap();

        PluginStore::load(root.clone()).unwrap();
        let restored = root.join("installed").join("my-plugin").join("package.json");
        assert_eq!(fs::read_to_string(restored).unwrap(), "new");
        assert!(!root.join("backup").exists());
    }

    #[test]
    fn startup_discards_backup_when_installed_exists() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let installed = root.join("installed").join("my-plugin");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("package.json"), "current").unwrap();
        let backup = root.join("backup").join("my-plugin-100");
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("package.json"), "old").unwrap();

        PluginStore::load(root.clone()).unwrap();
        assert_eq!(
            fs::read_to_string(installed.join("package.json")).unwrap(),
            "current"
        );
        assert!(!root.join("backup").exists());
    }

    #[test]
    fn plugin_dir_resolves_by_source() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let store = PluginStore::load(root.clone()).unwrap();
        store
            .update(|s| {
                s.plugins.push(sample_plugin("gh"));
                s.plugins.push(InstalledPluginState {
                    source: PluginSource::Local { path: "/work/dev".into() },
                    ..sample_plugin("dev")
                });
                Ok(())
            })
            .unwrap();
        assert_eq!(store.plugin_dir("gh"), Some(root.join("installed").join("gh")));
        assert_eq!(store.plugin_dir("dev"), Some(PathBuf::from("/work/dev")));
        assert_eq!(store.plugin_dir("missing"), None);
    }

    #[test]
    fn settings_roundtrip_and_delete() {
        let dir = TempDir::new().unwrap();
        let store = PluginStore::load(plugins_root(&dir)).unwrap();
        assert!(store.read_settings("p").unwrap().is_empty());

        store.write_setting("p", "depth", json!("3")).unwrap();
        store.write_setting("p", "show", json!(true)).unwrap();
        store.write_setting("p", "size", json!(1.5)).unwrap();
        store.write_setting("p", "depth", json!("2")).unwrap();
        let values = store.read_settings("p").unwrap();
        assert_eq!(Value::Object(values), json!({ "depth": "2", "show": true, "size": 1.5 }));

        store.delete_settings("p").unwrap();
        assert!(store.read_settings("p").unwrap().is_empty());
        // 存在しなくても成功
        store.delete_settings("p").unwrap();
    }

    #[test]
    fn corrupt_settings_file_reads_as_empty() {
        let dir = TempDir::new().unwrap();
        let root = plugins_root(&dir);
        let store = PluginStore::load(root.clone()).unwrap();
        fs::write(root.join("settings").join("p.json"), "[1,2").unwrap();
        assert!(store.read_settings("p").unwrap().is_empty());
    }

    #[test]
    fn settings_reject_invalid_plugin_id() {
        let dir = TempDir::new().unwrap();
        let store = PluginStore::load(plugins_root(&dir)).unwrap();
        for id in ["../evil", "a/b", "a\\b", "", "Upper", ".hidden", "node_modules"] {
            assert!(store.read_settings(id).is_err(), "{id}");
            assert!(store.write_setting(id, "k", json!(1)).is_err(), "{id}");
            assert!(store.delete_settings(id).is_err(), "{id}");
        }
    }

    #[test]
    fn plugin_id_rule() {
        assert!(is_valid_plugin_id("notyra-toc"));
        assert!(is_valid_plugin_id("a.b_c-1"));
        assert!(!is_valid_plugin_id("@scope/name"));
        assert!(!is_valid_plugin_id("-start"));
        assert!(!is_valid_plugin_id(&"a".repeat(215)));
        assert!(is_valid_plugin_id(&"a".repeat(214)));
    }

    #[test]
    fn backup_name_parsing() {
        assert_eq!(parse_backup_name("my-plugin-123"), Some(("my-plugin".into(), 123)));
        assert_eq!(parse_backup_name("my-plugin"), None);
        assert_eq!(parse_backup_name("plugin-"), None);
        assert_eq!(parse_backup_name("-123"), None);
    }
}
