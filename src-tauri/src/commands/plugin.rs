//! プラグイン管理の `#[tauri::command]`（インストール・更新・有効化・設定など）。
//!
//! 状態は `PluginStore`（state.json）を正とし、変更のたびに `plugins:state-changed` を
//! 全ウィンドウへ emit する。各 Plugin_Host_Window はこのイベントで差分調停を行う。
//!
//! | イベント | ペイロード |
//! |---------|-----------|
//! | `plugins:state-changed` | `PluginStateView` |
//! | `plugins:settings-changed` | `{ id, values }` |
//! | `plugins:stop-request` | `{ id, requestId }`（`StopBarrier` が emit） |
//! | `plugins:error` | `PluginErrorEntry` |
//!
//! Developer_Plugin（`source.type == "local"`）のフォルダは読み取りのみに使い、
//! 書き込み・削除は行わない（Requirement 19.7、19.12）。

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::commands::plugin_notes::require_permission;
use crate::plugins::barrier::{StopOutcome, StopRequestPayload, DEFAULT_STOP_TIMEOUT};
use crate::plugins::destination::{classify, parse_destination, DestClass};
use crate::plugins::diagnostics::{KeybindingConflict, PluginErrorEntry, PluginErrorSource};
use crate::plugins::package::{self, is_valid_staging_id, validate_repo_spec, FetchedPackage};
use crate::plugins::protocol::{resolve_plugin_file, ProtocolError};
use crate::plugins::store::{
    is_valid_plugin_id, DisabledReason, InstalledPluginState, PendingConsent, Permission,
    PluginSource, PluginStateFile, PluginStore,
};
use crate::plugins::PluginError;
use crate::state::AppState;

pub const STATE_CHANGED_EVENT: &str = "plugins:state-changed";
pub const SETTINGS_CHANGED_EVENT: &str = "plugins:settings-changed";
pub const ERROR_EVENT: &str = "plugins:error";

/// Plugin_Registry の公開先。公開用の初期 JSON と手順は docs/plugin-registry/ に置く。
pub const PLUGIN_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/yuma-shin/notyra-plugins/main/registry.json";
/// Plugin_Registry の応答本文の上限
const MAX_REGISTRY_BYTES: usize = 5 * 1024 * 1024;
/// `plugin_report_error` で受け付けるメッセージの最大文字数
const MAX_ERROR_MESSAGE_CHARS: usize = 4000;
/// Plugin_Settings のキーの最大文字数
const MAX_SETTING_KEY_CHARS: usize = 256;
/// `plugin_read_text` で読む最大サイズ（テーマ JSON・追加CSS）
const MAX_READ_TEXT_BYTES: u64 = 5 * 1024 * 1024;

const MANIFEST_FILE: &str = "package.json";
/// 外部 URL として開けるスキーム（Requirement 6.11、6.12）
const EXTERNAL_URL_SCHEMES: &[&str] = &["http", "https", "mailto"];

// ---------------------------------------------------------------------------
// 入出力の型（TS: src/shared/plugin/types.ts）
// ---------------------------------------------------------------------------

/// `PluginStateView.plugins` の要素（Installed_Plugin_State + package.json の文字列）
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginView {
    #[serde(flatten)]
    pub state: InstalledPluginState,
    /// package.json の文字列。読めない場合は null
    pub package_json: Option<String>,
}

/// `plugin_get_state` と `plugins:state-changed` のペイロード
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStateView {
    pub schema_version: u32,
    pub third_party_warning_acknowledged: bool,
    pub developer_mode: bool,
    pub plugins: Vec<InstalledPluginView>,
    /// 起動時に検出した問題（state.json の破損など）。なければ出力しない
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_error: Option<PluginError>,
    /// 停止を伴う管理操作の最終状態にだけ付ける。失敗時も再読み込みを許可する。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_stop_request: Option<StopRequestPayload>,
}

/// インストール・更新・開発フォルダ登録・再同意で記録する内容。
///
/// `source` は `plugin_commit_install`（`github` 必須）と `plugin_register_dev`
/// （`local` 必須。省略時は引数の `path`）で使い、更新と再同意では無視する。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecord {
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub source: Option<PluginSource>,
    pub consented_permissions: Vec<Permission>,
    pub consented_destinations: Vec<String>,
}

/// `plugin_check_update` の戻り値
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub version: String,
}

/// `plugin_select_dev_folder` の戻り値
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevFolder {
    pub path: String,
    pub package_json: String,
}

/// `plugin_reload_dev` の戻り値
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevReload {
    pub package_json: String,
}

/// `plugin_classify_destinations` の戻り値の要素
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClassifiedDestination {
    pub dest: String,
    pub class: DestClass,
}

/// `plugins:settings-changed` のペイロード
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsChangedPayload {
    pub id: String,
    pub values: Map<String, Value>,
}

// ---------------------------------------------------------------------------
// 状態の参照
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn plugin_get_state(state: State<'_, AppState>) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    Ok(build_view(store, store.snapshot()))
}

// ---------------------------------------------------------------------------
// インストール（Requirement 3、4、6）
// ---------------------------------------------------------------------------

/// Latest_Release の Plugin_Package を `staging/<stagingId>/` に取得・展開する。
#[tauri::command]
pub async fn plugin_fetch_release(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    plugin_id: Option<String>,
) -> Result<FetchedPackage, PluginError> {
    let client = package::github_client()?;
    package::fetch_latest_package(
        &client,
        &owner,
        &repo,
        plugin_id.as_deref(),
        &state.plugin_store.staging_root(),
    ).await
}

/// 中止したインストール・更新の staging を削除する（Requirement 3.16、6.7、10.7、10.10）。
#[tauri::command]
pub async fn plugin_discard_staging(
    state: State<'_, AppState>,
    staging_id: String,
) -> Result<(), PluginError> {
    let dir = staging_dir(&state.plugin_store, &staging_id)?;
    discard_staging_dir(&dir);
    Ok(())
}

/// staging の Plugin を `installed/<id>` に配置し、Installed_Plugin_State を記録する
/// （Requirement 3.14、3.15、3.17、6.6）。失敗時は staging と配置したファイルを削除する。
#[tauri::command]
pub async fn plugin_commit_install(
    app: AppHandle,
    state: State<'_, AppState>,
    staging_id: String,
    record: InstallRecord,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let staging = staging_dir(store, &staging_id)?;
    let _ops = state.plugin_ops.lock().await;
    let result = commit_install(store, &staging, record);
    if result.is_err() {
        discard_staging_dir(&staging);
    }
    Ok(publish_state(&app, store, result?))
}

// ---------------------------------------------------------------------------
// 更新（Requirement 10）
// ---------------------------------------------------------------------------

/// 取得元リポジトリの Latest_Release の package.json の `version` を返す。
/// 取得した staging は常に破棄する（Requirement 10.2、10.3）。
#[tauri::command]
pub async fn plugin_check_update(
    state: State<'_, AppState>,
    id: String,
) -> Result<UpdateCheck, PluginError> {
    let store = &state.plugin_store;
    let (owner, repo) = github_source(&store.snapshot(), &id)?;
    let client = package::github_client()?;
    let fetched = package::fetch_latest_package(&client, &owner, &repo, Some(&id), &store.staging_root()).await?;
    let staging = store.staging_root().join(&fetched.staging_id);
    discard_staging_dir(&staging);

    let info = PackageInfo::parse(&fetched.package_json)?;
    if info.name.as_deref() != Some(id.as_str()) {
        return Err(invalid_argument("release package ID does not match installed plugin"));
    }
    let version = info.version.ok_or_else(|| PluginError::InvalidArgument {
        message: "package.json has no version".into(),
    })?;
    Ok(UpdateCheck { version })
}

/// 旧バージョンの Plugin_Stop を全ウィンドウで待ってから、`backup/` へ退避して新バージョンに
/// 置き換え、状態を更新する。置き換えや記録に失敗した場合は旧バージョンを復元する
/// （Requirement 10.11〜10.15）。有効/無効は維持する。
#[tauri::command]
pub async fn plugin_apply_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    staging_id: String,
    record: InstallRecord,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let staging = staging_dir(store, &staging_id)?;
    let _ops = state.plugin_ops.lock().await;

    let prepared = prepare_update(store, &id, &staging, &record);
    let enabled = match prepared {
        Ok(enabled) => enabled,
        Err(e) => {
            discard_staging_dir(&staging);
            return Err(e);
        }
    };

    let stop_request = if enabled {
        Some(stop_everywhere(&app, &state, &id).await)
    } else {
        None
    };

    let result = apply_update_files(store, &id, &staging, &record, now_millis());
    if result.is_err() {
        discard_staging_dir(&staging);
    }
    // 失敗時も旧バージョンを読み込み直させるため、現在の状態を必ず通知する
    let view = publish_state_after_stop(&app, store, store.snapshot(), stop_request);
    result.map(|_| view)
}

// ---------------------------------------------------------------------------
// 有効化・無効化・アンインストール（Requirement 9）
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn plugin_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
    reason: Option<DisabledReason>,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let next = set_enabled(store, &id, enabled, reason)?;
    Ok(publish_state(&app, store, next))
}

/// 有効な場合は全ウィンドウでの Plugin_Stop を待ってから、状態・ファイル・設定値を削除する
/// （Requirement 9.7、9.8）。Developer_Plugin はフォルダを変更しない（Requirement 19.12）。
#[tauri::command]
pub async fn plugin_uninstall(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let _ops = state.plugin_ops.lock().await;
    let plugin = store.snapshot().find(&id).cloned().ok_or(PluginError::NotInstalled)?;

    let mut stop_request = None;
    let (next, cleanup) = uninstall_after_stop(store, &plugin, async {
        stop_request = Some(stop_everywhere(&app, &state, &id).await);
    }).await;
    if next.is_ok() {
        state.plugin_diagnostics.clear_errors_for(&id);
    }
    // A failed state write must also release the stopped hosts for retry.
    let view = publish_state_after_stop(&app, store, store.snapshot(), stop_request);
    next?;
    cleanup.map(|_| view)
}

// ---------------------------------------------------------------------------
// Third_Party_Warning・開発者モード（Requirement 1.6、19）
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn plugin_set_developer_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let next = store.update(|s| {
        s.developer_mode = enabled;
        Ok(())
    })?;
    Ok(publish_state(&app, store, next))
}

#[tauri::command]
pub async fn plugin_ack_third_party_warning(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let next = store.update(|s| {
        s.third_party_warning_acknowledged = true;
        Ok(())
    })?;
    Ok(publish_state(&app, store, next))
}

/// フォルダ選択ダイアログを表示し、選択したフォルダの package.json を返す。
/// キャンセル時は `null`。
#[tauri::command]
pub async fn plugin_select_dev_folder(app: AppHandle) -> Result<Option<DevFolder>, PluginError> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| PluginError::InvalidArgument {
        message: format!("unsupported folder path: {e}"),
    })?;
    let package_json = read_manifest(&path)?;
    Ok(Some(DevFolder {
        path: path.to_string_lossy().into_owned(),
        package_json,
    }))
}

/// Developer_Plugin を登録する（Requirement 19.4〜19.6）。
#[tauri::command]
pub async fn plugin_register_dev(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    record: InstallRecord,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let _ops = state.plugin_ops.lock().await;
    let next = register_dev(store, &path, record)?;
    Ok(publish_state(&app, store, next))
}

/// 全ウィンドウで Plugin_Stop を待ってから、ローカルフォルダの最新の package.json を読み直す
/// （Requirement 19.10）。
///
/// 同意済みでない Permission / Declared_Destination が追加されていれば `pendingConsent` を記録し、
/// `plugin_set_dev_consent` で同意されるまで読み込み対象から外す（Requirement 19.11、19.14）。
/// 追加がなければ同意済みの一覧を新しい宣言に揃え、`generation` を進めて読み込み直させる。
#[tauri::command]
pub async fn plugin_reload_dev(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<DevReload, PluginError> {
    let store = &state.plugin_store;
    let _ops = state.plugin_ops.lock().await;
    let (path, developer_mode) = {
        let snapshot = store.snapshot();
        (local_source(&snapshot, &id)?, snapshot.developer_mode)
    };
    if !developer_mode {
        return Err(developer_mode_disabled());
    }

    let stop_request = Some(stop_everywhere(&app, &state, &id).await);

    let package_json = match read_manifest(Path::new(&path)) {
        Ok(text) => text,
        Err(e) => {
            // 停止したウィンドウに現在の状態で読み込み直させる
            publish_state_after_stop(&app, store, store.snapshot(), stop_request);
            return Err(e);
        }
    };
    let result = reload_dev_state(store, &id, &package_json);
    publish_state_after_stop(&app, store, store.snapshot(), stop_request);
    result?;
    Ok(DevReload { package_json })
}

/// Developer_Plugin の再同意を記録し、同意待ちを解除する（Requirement 19.11）。
#[tauri::command]
pub async fn plugin_set_dev_consent(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    record: InstallRecord,
) -> Result<PluginStateView, PluginError> {
    let store = &state.plugin_store;
    let next = set_dev_consent(store, &id, record)?;
    Ok(publish_state(&app, store, next))
}

// ---------------------------------------------------------------------------
// ファイル・設定値（Requirement 11、17）
// ---------------------------------------------------------------------------

/// Plugin ディレクトリ内のテキストファイル（テーマ JSON・追加CSS）を読む。
/// ディレクトリの外を指すパスは `outOfScope`。
#[tauri::command]
pub async fn plugin_read_text(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<String, PluginError> {
    read_plugin_text(&state.plugin_store, &id, &path)
}

/// `plugin_fetch_release` で取得した staging 内のテキストファイル（テーマ JSON）を読む。
/// staging の外を指すパスは `outOfScope`。
#[tauri::command]
pub async fn plugin_read_staging_text(
    state: State<'_, AppState>,
    staging_id: String,
    path: String,
) -> Result<String, PluginError> {
    read_staging_text(&state.plugin_store, &staging_id, &path)
}

#[tauri::command]
pub async fn plugin_get_settings(
    state: State<'_, AppState>,
    id: String,
) -> Result<Map<String, Value>, PluginError> {
    let store = &state.plugin_store;
    require_installed(&store.snapshot(), &id)?;
    store.read_settings(&id)
}

/// Plugin_Settings の値を1件保存し、全ウィンドウへ `plugins:settings-changed` を通知する
/// （Requirement 17.6、17.7）。値の型検証（宣言との照合）は TS 側で行い、ここでは
/// JSON プリミティブ（文字列・数値・真偽値）であることだけを確認する。
#[tauri::command]
pub async fn plugin_set_setting(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    key: String,
    value: Value,
) -> Result<(), PluginError> {
    let store = &state.plugin_store;
    let values = set_setting(store, &id, &key, value)?;
    let payload = SettingsChangedPayload { id, values };
    if let Err(e) = app.emit(SETTINGS_CHANGED_EVENT, payload) {
        eprintln!("[notyra] failed to emit {SETTINGS_CHANGED_EVENT}: {e}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// エラー・キーバインド重複（Requirement 8.5、8.9、8.14、16.8、16.9）
// ---------------------------------------------------------------------------

/// セッション内のエラーを記録し、`plugins:error` を emit する。
/// 発生ウィンドウのラベルと時刻は Rust 側で付与する。
#[tauri::command]
pub async fn plugin_report_error(
    app: AppHandle,
    state: State<'_, AppState>,
    webview_window: WebviewWindow,
    id: String,
    source: PluginErrorSource,
    message: String,
) -> Result<(), PluginError> {
    let entry = make_error_entry(&id, source, &message, webview_window.label(), iso8601_now())?;
    state.plugin_diagnostics.push_error(entry.clone());
    if let Err(e) = app.emit(ERROR_EVENT, entry) {
        eprintln!("[notyra] failed to emit {ERROR_EVENT}: {e}");
    }
    Ok(())
}

/// Plugin ごとに最新20件のエラー（記録順）
#[tauri::command]
pub async fn plugin_get_errors(
    state: State<'_, AppState>,
) -> Result<Vec<PluginErrorEntry>, PluginError> {
    Ok(state.plugin_diagnostics.errors())
}

/// キーバインド重複の一覧を置き換える（メインウィンドウの PluginHost が送る）
#[tauri::command]
pub async fn plugin_report_keybinding_conflicts(
    state: State<'_, AppState>,
    conflicts: Vec<KeybindingConflict>,
) -> Result<(), PluginError> {
    state.plugin_diagnostics.set_keybinding_conflicts(conflicts);
    Ok(())
}

#[tauri::command]
pub async fn plugin_get_keybinding_conflicts(
    state: State<'_, AppState>,
) -> Result<Vec<KeybindingConflict>, PluginError> {
    Ok(state.plugin_diagnostics.keybinding_conflicts())
}

// ---------------------------------------------------------------------------
// ホスト実行系の補助
// ---------------------------------------------------------------------------

/// `plugins:stop-request` への応答（呼び出し元ウィンドウのラベルで待機対象から外す）
#[tauri::command]
pub async fn plugin_ack_stop(
    state: State<'_, AppState>,
    webview_window: WebviewWindow,
    request_id: String,
) -> Result<(), PluginError> {
    state.stop_barrier.ack(&request_id, webview_window.label());
    Ok(())
}

/// 共有モジュール（React 等）の export 名を登録する
#[tauri::command]
pub async fn plugin_register_shared_modules(
    state: State<'_, AppState>,
    modules: HashMap<String, Vec<String>>,
) -> Result<(), PluginError> {
    state.shared_modules.register(modules);
    Ok(())
}

/// Consent_Dialog 用に Declared_Destination を分類する（Requirement 7.1〜7.3、7.18）
#[tauri::command]
pub async fn plugin_classify_destinations(
    destinations: Vec<String>,
) -> Result<Vec<ClassifiedDestination>, PluginError> {
    classify_destinations(&destinations)
}

/// Plugin_Registry の JSON を取得する（解析は TS 側。Requirement 4.1、4.10）
#[tauri::command]
pub async fn plugin_fetch_registry() -> Result<String, PluginError> {
    fetch_registry_text().await
}

// ---------------------------------------------------------------------------
// 権限付き Plugin_API（Requirement 6.9〜6.12）
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn plugin_clipboard_read(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, PluginError> {
    require_permission(&state.plugin_store.snapshot(), &id, Permission::Clipboard)?;
    app.clipboard().read_text().map_err(|e| PluginError::Io {
        message: e.to_string(),
    })
}

#[tauri::command]
pub async fn plugin_clipboard_write(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<(), PluginError> {
    require_permission(&state.plugin_store.snapshot(), &id, Permission::Clipboard)?;
    app.clipboard().write_text(text).map_err(|e| PluginError::Io {
        message: e.to_string(),
    })
}

/// `http` / `https` / `mailto` の URL を OS の既定のアプリケーションで開く
#[tauri::command]
pub async fn plugin_open_external(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
) -> Result<(), PluginError> {
    require_permission(&state.plugin_store.snapshot(), &id, Permission::ShellOpenExternal)?;
    let url = check_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| PluginError::Io {
            message: e.to_string(),
        })
}

// ---------------------------------------------------------------------------
// 本体（State / AppHandle から分離した処理）
// ---------------------------------------------------------------------------

/// 状態からビューを作り、`plugins:state-changed` を emit して返す
fn publish_state(app: &AppHandle, store: &PluginStore, snapshot: PluginStateFile) -> PluginStateView {
    publish_state_after_stop(app, store, snapshot, None)
}

fn publish_state_after_stop(
    app: &AppHandle,
    store: &PluginStore,
    snapshot: PluginStateFile,
    completed_stop_request: Option<StopRequestPayload>,
) -> PluginStateView {
    let mut view = build_view(store, snapshot);
    view.completed_stop_request = completed_stop_request;
    if let Err(e) = app.emit(STATE_CHANGED_EVENT, &view) {
        eprintln!("[notyra] failed to emit {STATE_CHANGED_EVENT}: {e}");
    }
    view
}

/// 開いているすべての Plugin_Host_Window で Plugin_Stop を待つ。
/// タイムアウトしても処理は続行する（設計: 全 ack または15秒経過で完了）。
async fn stop_everywhere(app: &AppHandle, state: &AppState, id: &str) -> StopRequestPayload {
    let (request, outcome) = state.stop_barrier.request_stop(app, id, DEFAULT_STOP_TIMEOUT).await;
    if let StopOutcome::TimedOut { pending } = outcome {
        eprintln!("[notyra] plugin stop for {id} timed out; pending windows: {pending:?}");
    }
    request
}

pub(crate) fn build_view(store: &PluginStore, snapshot: PluginStateFile) -> PluginStateView {
    let installed_root = store.installed_root();
    let plugins = snapshot
        .plugins
        .into_iter()
        .map(|p| {
            let package_json = plugin_dir_of(&installed_root, &p)
                .and_then(|dir| fs::read_to_string(dir.join(MANIFEST_FILE)).ok());
            InstalledPluginView { state: p, package_json }
        })
        .collect();
    PluginStateView {
        schema_version: snapshot.schema_version,
        third_party_warning_acknowledged: snapshot.third_party_warning_acknowledged,
        developer_mode: snapshot.developer_mode,
        plugins,
        startup_error: store.startup_error().cloned(),
        completed_stop_request: None,
    }
}

/// Plugin のファイルがあるディレクトリ（`PluginStore::plugin_dir` と同じ規則）
fn plugin_dir_of(installed_root: &Path, plugin: &InstalledPluginState) -> Option<PathBuf> {
    match &plugin.source {
        PluginSource::Github { .. } => {
            is_valid_plugin_id(&plugin.id).then(|| installed_root.join(&plugin.id))
        }
        PluginSource::Local { path } => Some(PathBuf::from(path)),
    }
}

pub(crate) fn commit_install(
    store: &PluginStore,
    staging: &Path,
    record: InstallRecord,
) -> Result<PluginStateFile, PluginError> {
    let record = normalize_record(record)?;
    let source = match &record.source {
        Some(source @ PluginSource::Github { owner, repo }) => {
            validate_repo_spec(owner, repo)?;
            source.clone()
        }
        _ => return Err(invalid_argument("install source must be a GitHub repository")),
    };
    if !staging.is_dir() {
        return Err(PluginError::NotFound {
            path: staging.to_string_lossy().into_owned(),
        });
    }
    PackageInfo::parse(&read_manifest(staging)?)?.ensure_matches(&record)?;
    if store.snapshot().find(&record.id).is_some() {
        return Err(PluginError::AlreadyInstalled);
    }

    let installed_root = store.installed_root();
    fs::create_dir_all(&installed_root)?;
    let target = installed_root.join(&record.id);
    // 状態に記録されていない残骸（前回の失敗など）は Notyra の管理領域なので削除してよい
    remove_dir_if_exists(&target)?;
    fs::rename(staging, &target)?;

    let installed_at = iso8601_now();
    let result = store.update(|s| {
        if s.find(&record.id).is_some() {
            return Err(PluginError::AlreadyInstalled);
        }
        s.plugins.push(InstalledPluginState {
            id: record.id.clone(),
            version: record.version.clone(),
            source,
            enabled: true,
            consented_permissions: record.consented_permissions.clone(),
            consented_destinations: record.consented_destinations.clone(),
            generation: 0,
            pending_consent: None,
            disabled_reason: None,
            installed_at,
        });
        Ok(())
    });
    if result.is_err() {
        if let Err(e) = remove_dir_if_exists(&target) {
            eprintln!("[notyra] failed to remove {}: {e}", target.display());
        }
    }
    result
}

/// 更新の事前確認。対象の有効/無効を返す。
fn prepare_update(
    store: &PluginStore,
    id: &str,
    staging: &Path,
    record: &InstallRecord,
) -> Result<bool, PluginError> {
    let snapshot = store.snapshot();
    github_source(&snapshot, id)?;
    if record.id != id {
        return Err(invalid_argument("record id does not match the plugin"));
    }
    if !staging.is_dir() {
        return Err(PluginError::NotFound {
            path: staging.to_string_lossy().into_owned(),
        });
    }
    let record = normalize_record(record.clone())?;
    PackageInfo::parse(&read_manifest(staging)?)?.ensure_matches(&record)?;
    Ok(snapshot.find(id).map(|p| p.enabled).unwrap_or(false))
}

/// `installed/<id>` を `backup/<id>-<ts>` へ退避して staging と置き換え、状態を更新する。
/// 置き換えまたは状態の記録に失敗した場合は旧バージョンのファイルを復元する。
pub(crate) fn apply_update_files(
    store: &PluginStore,
    id: &str,
    staging: &Path,
    record: &InstallRecord,
    ts: u128,
) -> Result<PluginStateFile, PluginError> {
    let record = normalize_record(record.clone())?;
    let installed = store.installed_root().join(id);
    let backup = store.backup_dir_for(id, ts as u64);
    replace_with_backup(&installed, staging, &backup, || {
        store.update(|s| {
            let p = s.find_mut(id).ok_or(PluginError::NotInstalled)?;
            p.version = record.version.clone();
            p.consented_permissions = record.consented_permissions.clone();
            p.consented_destinations = record.consented_destinations.clone();
            p.generation += 1;
            Ok(())
        })
    })
}

/// `installed` を `backup` へ退避し、`staging` を `installed` に移してから `commit` を実行する。
/// いずれかが失敗したら `installed` を退避前の内容に戻す。
pub(crate) fn replace_with_backup<F>(
    installed: &Path,
    staging: &Path,
    backup: &Path,
    commit: F,
) -> Result<PluginStateFile, PluginError>
where
    F: FnOnce() -> Result<PluginStateFile, PluginError>,
{
    let had_old = installed.exists();
    if had_old {
        if let Some(parent) = backup.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(installed, backup)?;
    }

    let restore = || {
        if !had_old {
            return;
        }
        // 失敗しても次回起動時に backup/ から復元される（installed が欠けている場合）
        if let Err(e) = remove_dir_if_exists(installed).and_then(|_| fs::rename(backup, installed)) {
            eprintln!(
                "[notyra] failed to restore {} from {}: {e}",
                installed.display(),
                backup.display()
            );
        }
    };

    if let Err(e) = fs::rename(staging, installed) {
        restore();
        return Err(e.into());
    }
    match commit() {
        Ok(next) => {
            if had_old {
                if let Err(e) = remove_dir_if_exists(backup) {
                    eprintln!("[notyra] failed to remove {}: {e}", backup.display());
                }
                if let Some(parent) = backup.parent() {
                    // 空になった backup/ を片付ける（他の退避が残っていれば失敗するだけ）
                    let _ = fs::remove_dir(parent);
                }
            }
            Ok(next)
        }
        Err(e) => {
            restore();
            Err(e)
        }
    }
}

fn set_enabled(
    store: &PluginStore,
    id: &str,
    enabled: bool,
    reason: Option<DisabledReason>,
) -> Result<PluginStateFile, PluginError> {
    store.update(|s| {
        let p = s.find_mut(id).ok_or(PluginError::NotInstalled)?;
        p.enabled = enabled;
        p.disabled_reason = if enabled {
            None
        } else {
            Some(reason.unwrap_or(DisabledReason::User))
        };
        Ok(())
    })
}

/// 状態から Plugin を削除し、ファイル（GitHub 由来のみ）と設定値を削除する。
///
/// 状態を先に削除する（ファイルだけが消えて状態が残ると、読み込めない Plugin が残るため）。
/// 戻り値の1つ目は状態の更新結果、2つ目はファイル・設定値の削除結果。
fn uninstall(
    store: &PluginStore,
    plugin: &InstalledPluginState,
) -> (Result<PluginStateFile, PluginError>, Result<(), PluginError>) {
    let next = store.update(|s| {
        let before = s.plugins.len();
        s.plugins.retain(|p| p.id != plugin.id);
        if s.plugins.len() == before {
            return Err(PluginError::NotInstalled);
        }
        Ok(())
    });
    if next.is_err() {
        return (next, Ok(()));
    }

    let mut cleanup = Ok(());
    // Developer_Plugin のフォルダは変更しない（Requirement 19.12）
    if let PluginSource::Github { .. } = plugin.source {
        if let Some(dir) = plugin_dir_of(&store.installed_root(), plugin) {
            if let Err(e) = remove_dir_if_exists(&dir) {
                cleanup = Err(e.into());
            }
        }
    }
    if let Err(e) = store.delete_settings(&plugin.id) {
        if cleanup.is_ok() {
            cleanup = Err(e);
        }
    }
    (next, cleanup)
}

async fn uninstall_after_stop(
    store: &PluginStore,
    plugin: &InstalledPluginState,
    stop: impl std::future::Future<Output = ()>,
) -> (Result<PluginStateFile, PluginError>, Result<(), PluginError>) {
    if plugin.enabled {
        stop.await;
    }
    uninstall(store, plugin)
}

pub(crate) fn register_dev(
    store: &PluginStore,
    path: &str,
    record: InstallRecord,
) -> Result<PluginStateFile, PluginError> {
    let record = normalize_record(record)?;
    match &record.source {
        None => {}
        Some(PluginSource::Local { path: p }) if p == path => {}
        Some(_) => return Err(invalid_argument("source must be the selected local folder")),
    }
    if !store.snapshot().developer_mode {
        return Err(developer_mode_disabled());
    }
    let dir = Path::new(path);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(invalid_argument("developer plugin path must be an existing absolute folder"));
    }
    PackageInfo::parse(&read_manifest(dir)?)?.ensure_matches(&record)?;

    let installed_at = iso8601_now();
    store.update(|s| {
        if s.find(&record.id).is_some() {
            return Err(PluginError::AlreadyInstalled);
        }
        s.plugins.push(InstalledPluginState {
            id: record.id.clone(),
            version: record.version.clone(),
            source: PluginSource::Local { path: path.to_string() },
            enabled: true,
            consented_permissions: record.consented_permissions.clone(),
            consented_destinations: record.consented_destinations.clone(),
            generation: 0,
            pending_consent: None,
            disabled_reason: None,
            installed_at,
        });
        Ok(())
    })
}

/// 再読み込みした package.json で状態を更新する（`plugin_reload_dev` の後半）。
pub(crate) fn reload_dev_state(
    store: &PluginStore,
    id: &str,
    package_json: &str,
) -> Result<PluginStateFile, PluginError> {
    let info = PackageInfo::parse(package_json)?;
    store.update(|s| {
        let p = s.find_mut(id).ok_or(PluginError::NotInstalled)?;
        if !matches!(p.source, PluginSource::Local { .. }) {
            return Err(invalid_argument("plugin is not a developer plugin"));
        }
        if let Some(version) = &info.version {
            p.version = version.clone();
        }
        match info.consent_additions(p) {
            Some(pending) => p.pending_consent = Some(pending),
            None => {
                p.pending_consent = None;
                p.consented_permissions = info.permissions.clone();
                p.consented_destinations = info.destinations.clone();
            }
        }
        p.generation += 1;
        Ok(())
    })
}

pub(crate) fn set_dev_consent(
    store: &PluginStore,
    id: &str,
    record: InstallRecord,
) -> Result<PluginStateFile, PluginError> {
    let record = normalize_record(record)?;
    if record.id != id {
        return Err(invalid_argument("record id does not match the plugin"));
    }
    store.update(|s| {
        let p = s.find_mut(id).ok_or(PluginError::NotInstalled)?;
        if !matches!(p.source, PluginSource::Local { .. }) {
            return Err(invalid_argument("plugin is not a developer plugin"));
        }
        p.version = record.version.clone();
        p.consented_permissions = record.consented_permissions.clone();
        p.consented_destinations = record.consented_destinations.clone();
        if p.pending_consent.take().is_some() {
            // 同意待ちで停止していた Plugin を読み込み直させる
            p.generation += 1;
        }
        Ok(())
    })
}

pub(crate) fn read_plugin_text(store: &PluginStore, id: &str, path: &str) -> Result<String, PluginError> {
    let snapshot = store.snapshot();
    let plugin = require_installed(&snapshot, id)?;
    // 独自スキームと同じく、開発者モードがオフの Developer_Plugin のファイルは返さない
    if matches!(plugin.source, PluginSource::Local { .. }) && !snapshot.developer_mode {
        return Err(PluginError::NotInstalled);
    }
    let dir = plugin_dir_of(&store.installed_root(), plugin).ok_or(PluginError::NotInstalled)?;
    read_text_in_dir(&dir, path)
}

/// staging（インストール・更新の同意前）の Plugin_Package 内のテキストファイルを読む。
/// 同意前に Theme_Plugin のテーマ定義を検証するために使う（Requirement 11.3）。
pub(crate) fn read_staging_text(
    store: &PluginStore,
    staging_id: &str,
    path: &str,
) -> Result<String, PluginError> {
    let dir = staging_dir(store, staging_id)?;
    if !dir.is_dir() {
        return Err(PluginError::NotFound {
            path: staging_id.to_string(),
        });
    }
    read_text_in_dir(&dir, path)
}

/// `dir` 配下のテキストファイルを読む。`dir` の外を指すパスは `outOfScope`
fn read_text_in_dir(dir: &Path, path: &str) -> Result<String, PluginError> {
    // resolve_plugin_file は URL パスとしてデコードするため、各要素をエンコードして渡す
    // （`..`・`.` はエンコードされないため、範囲外への移動は従来どおり拒否される）
    let encoded = path
        .split('/')
        .map(|seg| urlencoding::encode(seg).into_owned())
        .collect::<Vec<_>>()
        .join("/");
    let resolved = resolve_plugin_file(dir, &encoded).map_err(|e| match e {
        ProtocolError::InvalidPath => PluginError::OutOfScope { path: path.to_string() },
        ProtocolError::NotFound => PluginError::NotFound { path: path.to_string() },
        ProtocolError::Io(message) => PluginError::Io { message },
    })?;
    if fs::metadata(&resolved)?.len() > MAX_READ_TEXT_BYTES {
        return Err(PluginError::TooLarge);
    }
    fs::read_to_string(&resolved).map_err(|e| match e.kind() {
        io::ErrorKind::InvalidData => invalid_argument("file is not valid UTF-8"),
        _ => e.into(),
    })
}

/// 値を保存し、保存後のすべての値を返す
pub(crate) fn set_setting(
    store: &PluginStore,
    id: &str,
    key: &str,
    value: Value,
) -> Result<Map<String, Value>, PluginError> {
    require_installed(&store.snapshot(), id)?;
    if key.is_empty() || key.chars().count() > MAX_SETTING_KEY_CHARS {
        return Err(invalid_argument("invalid setting key"));
    }
    if !matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_)) {
        return Err(invalid_argument("setting value must be a string, number, or boolean"));
    }
    store.write_setting(id, key, value)?;
    store.read_settings(id)
}

pub(crate) fn make_error_entry(
    id: &str,
    source: PluginErrorSource,
    message: &str,
    window_label: &str,
    at: String,
) -> Result<PluginErrorEntry, PluginError> {
    if !is_valid_plugin_id(id) {
        return Err(invalid_argument("invalid plugin id"));
    }
    let message = if message.chars().count() > MAX_ERROR_MESSAGE_CHARS {
        let mut m: String = message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect();
        m.push('…');
        m
    } else {
        message.to_string()
    };
    Ok(PluginErrorEntry {
        plugin_id: id.to_string(),
        source,
        message,
        window_label: window_label.to_string(),
        at,
    })
}

pub(crate) fn classify_destinations(
    destinations: &[String],
) -> Result<Vec<ClassifiedDestination>, PluginError> {
    destinations
        .iter()
        .map(|dest| {
            let parsed = parse_destination(dest)
                .map_err(|_| invalid_argument(format!("invalid destination: {dest}")))?;
            Ok(ClassifiedDestination {
                dest: dest.clone(),
                class: classify(&parsed),
            })
        })
        .collect()
}

/// `http` / `https` / `mailto` 以外は `schemeNotAllowed`
pub(crate) fn check_external_url(raw: &str) -> Result<url::Url, PluginError> {
    let url = url::Url::parse(raw).map_err(|_| invalid_argument(format!("invalid URL: {raw}")))?;
    if !EXTERNAL_URL_SCHEMES.contains(&url.scheme()) {
        return Err(PluginError::SchemeNotAllowed {
            scheme: url.scheme().to_string(),
        });
    }
    Ok(url)
}

async fn fetch_registry_text() -> Result<String, PluginError> {
    let client = package::github_client()?;
    let mut response = client
        .get(PLUGIN_REGISTRY_URL)
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    if !status.is_success() {
        return Err(PluginError::Network {
            message: format!("failed to fetch plugin registry (HTTP {})", status.as_u16()),
        });
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_REGISTRY_BYTES as u64)
    {
        return Err(PluginError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len() + chunk.len() > MAX_REGISTRY_BYTES {
            return Err(PluginError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| PluginError::Network {
        message: "plugin registry is not valid UTF-8".into(),
    })
}

// ---------------------------------------------------------------------------
// package.json の最小限の読み取り
// ---------------------------------------------------------------------------

/// Rust 側で必要な package.json の項目（完全な検証は TS の Manifest_Parser が行う）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PackageInfo {
    pub name: Option<String>,
    pub version: Option<String>,
    /// `notyra.permissions[].name` のうち既知の Permission（重複除去・宣言順）
    pub permissions: Vec<Permission>,
    /// `notyra.networkDestinations`（重複除去・宣言順）
    pub destinations: Vec<String>,
}

impl PackageInfo {
    pub fn parse(json: &str) -> Result<Self, PluginError> {
        let value: Value = serde_json::from_str(json)
            .map_err(|e| invalid_argument(format!("package.json is not valid JSON: {e}")))?;
        let text = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_owned);
        let notyra = value.get("notyra");
        let mut permissions = Vec::new();
        for item in notyra
            .and_then(|n| n.get("permissions"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(Ok(p)) = item
                .get("name")
                .cloned()
                .map(serde_json::from_value::<Permission>)
            {
                if !permissions.contains(&p) {
                    permissions.push(p);
                }
            }
        }
        let mut destinations: Vec<String> = Vec::new();
        for d in notyra
            .and_then(|n| n.get("networkDestinations"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !destinations.iter().any(|x| x == d) {
                destinations.push(d.to_string());
            }
        }
        Ok(Self {
            name: text(value.get("name")),
            version: text(value.get("version")),
            permissions,
            destinations,
        })
    }

    /// 記録しようとする ID とバージョンが package.json と一致することを確認する
    pub fn ensure_matches(&self, record: &InstallRecord) -> Result<(), PluginError> {
        if self.name.as_deref() != Some(record.id.as_str()) {
            return Err(invalid_argument("record id does not match package.json name"));
        }
        if self.version.as_deref() != Some(record.version.as_str()) {
            return Err(invalid_argument("record version does not match package.json version"));
        }
        Ok(())
    }

    /// 同意済みに含まれない Permission / Declared_Destination。なければ `None`
    pub fn consent_additions(&self, plugin: &InstalledPluginState) -> Option<PendingConsent> {
        let added_permissions: Vec<Permission> = self
            .permissions
            .iter()
            .filter(|p| !plugin.consented_permissions.contains(p))
            .copied()
            .collect();
        let added_destinations: Vec<String> = self
            .destinations
            .iter()
            .filter(|d| !plugin.consented_destinations.contains(d))
            .cloned()
            .collect();
        if added_permissions.is_empty() && added_destinations.is_empty() {
            None
        } else {
            Some(PendingConsent {
                added_permissions,
                added_destinations,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

fn invalid_argument(message: impl Into<String>) -> PluginError {
    PluginError::InvalidArgument {
        message: message.into(),
    }
}

fn developer_mode_disabled() -> PluginError {
    invalid_argument("developer mode is disabled")
}

fn network_error(e: reqwest::Error) -> PluginError {
    PluginError::Network {
        message: e.to_string(),
    }
}

fn require_installed<'a>(
    state: &'a PluginStateFile,
    id: &str,
) -> Result<&'a InstalledPluginState, PluginError> {
    state.find(id).ok_or(PluginError::NotInstalled)
}

fn github_source(state: &PluginStateFile, id: &str) -> Result<(String, String), PluginError> {
    match &require_installed(state, id)?.source {
        PluginSource::Github { owner, repo } => Ok((owner.clone(), repo.clone())),
        PluginSource::Local { .. } => Err(invalid_argument("developer plugins cannot be updated")),
    }
}

fn local_source(state: &PluginStateFile, id: &str) -> Result<String, PluginError> {
    match &require_installed(state, id)?.source {
        PluginSource::Local { path } => Ok(path.clone()),
        PluginSource::Github { .. } => Err(invalid_argument("plugin is not a developer plugin")),
    }
}

/// ID・Permission・宛先を検証し、重複を除去する
fn normalize_record(mut record: InstallRecord) -> Result<InstallRecord, PluginError> {
    if !is_valid_plugin_id(&record.id) {
        return Err(invalid_argument(format!("invalid plugin id: {}", record.id)));
    }
    let mut permissions = Vec::new();
    for p in record.consented_permissions {
        if !permissions.contains(&p) {
            permissions.push(p);
        }
    }
    record.consented_permissions = permissions;
    let mut destinations: Vec<String> = Vec::new();
    for d in record.consented_destinations {
        if parse_destination(&d).is_err() {
            return Err(invalid_argument(format!("invalid destination: {d}")));
        }
        if !destinations.contains(&d) {
            destinations.push(d);
        }
    }
    record.consented_destinations = destinations;
    Ok(record)
}

fn staging_dir(store: &PluginStore, staging_id: &str) -> Result<PathBuf, PluginError> {
    if !is_valid_staging_id(staging_id) {
        return Err(invalid_argument("invalid staging id"));
    }
    Ok(store.staging_root().join(staging_id))
}

/// staging ディレクトリ（と取得途中の zip）を削除する（ベストエフォート）
fn discard_staging_dir(dir: &Path) {
    if let Err(e) = remove_dir_if_exists(dir) {
        eprintln!("[notyra] failed to remove {}: {e}", dir.display());
    }
    let zip = dir.with_extension("zip");
    if let Err(e) = fs::remove_file(&zip) {
        if e.kind() != io::ErrorKind::NotFound {
            eprintln!("[notyra] failed to remove {}: {e}", zip.display());
        }
    }
}

fn remove_dir_if_exists(dir: &Path) -> io::Result<()> {
    match fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// フォルダのルートの package.json を読む
fn read_manifest(dir: &Path) -> Result<String, PluginError> {
    match fs::read_to_string(dir.join(MANIFEST_FILE)) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(PluginError::ManifestMissing),
        Err(e) if e.kind() == io::ErrorKind::InvalidData => {
            Err(invalid_argument("package.json is not valid UTF-8"))
        }
        Err(e) => Err(e.into()),
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn iso8601_now() -> String {
    format_iso8601(SystemTime::now())
}

/// UTC の ISO 8601（`YYYY-MM-DDTHH:MM:SS.sssZ`。JS の `toISOString()` と同じ形式）
fn format_iso8601(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        d.subsec_millis()
    )
}

/// 1970-01-01 からの日数をグレゴリオ暦の年月日に変換する（Howard Hinnant のアルゴリズム）
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;
    use tempfile::TempDir;

    fn store(dir: &TempDir) -> PluginStore {
        PluginStore::load(dir.path().join("plugins")).unwrap()
    }

    fn manifest(id: &str, version: &str, permissions: &[&str], dests: &[&str]) -> String {
        let perms: Vec<_> = permissions.iter().map(|p| json!({ "name": p })).collect();
        json!({
            "name": id,
            "version": version,
            "notyra": {
                "displayName": id,
                "type": "feature",
                "notyraVersion": "*",
                "main": "index.js",
                "permissions": perms,
                "networkDestinations": dests,
            }
        })
        .to_string()
    }

    fn record(id: &str, version: &str, source: Option<PluginSource>) -> InstallRecord {
        InstallRecord {
            id: id.into(),
            version: version.into(),
            source,
            consented_permissions: vec![Permission::Network],
            consented_destinations: vec!["api.example.com".into()],
        }
    }

    fn github() -> Option<PluginSource> {
        Some(PluginSource::Github { owner: "someone".into(), repo: "repo".into() })
    }

    fn make_staging(store: &PluginStore, name: &str, package_json: &str) -> PathBuf {
        let dir = store.staging_root().join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(MANIFEST_FILE), package_json).unwrap();
        fs::write(dir.join("index.js"), "export function activate() {}").unwrap();
        dir
    }

    #[test]
    fn iso8601_matches_known_dates() {
        assert_eq!(format_iso8601(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let t = UNIX_EPOCH + Duration::from_millis(951_782_400_123); // 2000-02-29
        assert_eq!(format_iso8601(t), "2000-02-29T00:00:00.123Z");
        let t = UNIX_EPOCH + Duration::from_secs(1_783_123_199); // 2026-07-03T23:59:59Z
        assert_eq!(format_iso8601(t), "2026-07-03T23:59:59.000Z");
    }

    #[test]
    fn view_serializes_like_typescript_plugin_state_view() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "abc", &manifest("p", "1.0.0", &["network"], &["api.example.com"]));
        let next = commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();
        let v = serde_json::to_value(build_view(&store, next)).unwrap();
        assert_eq!(v["schemaVersion"], 1);
        assert_eq!(v["plugins"][0]["id"], "p");
        assert_eq!(v["plugins"][0]["enabled"], true);
        assert_eq!(v["plugins"][0]["source"], json!({ "type": "github", "owner": "someone", "repo": "repo" }));
        assert!(v["plugins"][0]["packageJson"].as_str().unwrap().contains("\"name\":\"p\""));
        assert!(v.get("startupError").is_none());
    }

    #[test]
    fn commit_install_moves_staging_and_records_state() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "abc", &manifest("p", "1.0.0", &["network"], &["api.example.com"]));
        let next = commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();
        assert!(!staging.exists());
        assert!(store.installed_root().join("p").join("index.js").is_file());
        let p = next.find("p").unwrap();
        assert_eq!(p.consented_permissions, vec![Permission::Network]);
        assert_eq!(p.consented_destinations, vec!["api.example.com".to_string()]);

        // 同じ ID は重複
        let staging2 = make_staging(&store, "def", &manifest("p", "1.0.0", &[], &[]));
        assert_eq!(
            commit_install(&store, &staging2, record("p", "1.0.0", github())),
            Err(PluginError::AlreadyInstalled)
        );
    }

    #[test]
    fn commit_install_rejects_mismatched_record() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "abc", &manifest("p", "1.0.0", &[], &[]));
        assert!(matches!(
            commit_install(&store, &staging, record("q", "1.0.0", github())),
            Err(PluginError::InvalidArgument { .. })
        ));
        assert!(matches!(
            commit_install(&store, &staging, record("p", "1.0.0", None)),
            Err(PluginError::InvalidArgument { .. })
        ));
        assert!(store.snapshot().plugins.is_empty());
    }

    #[test]
    fn apply_update_replaces_files_and_keeps_enabled_state() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "a1", &manifest("p", "1.0.0", &["network"], &["api.example.com"]));
        commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();
        set_enabled(&store, "p", false, None).unwrap();

        let staging = make_staging(&store, "a2", &manifest("p", "1.1.0", &[], &[]));
        let mut rec = record("p", "1.1.0", None);
        rec.consented_permissions.clear();
        rec.consented_destinations.clear();
        let next = apply_update_files(&store, "p", &staging, &rec, 42).unwrap();
        let p = next.find("p").unwrap();
        assert_eq!(p.version, "1.1.0");
        assert!(!p.enabled);
        assert_eq!(p.generation, 1);
        assert!(p.consented_permissions.is_empty());
        let text = fs::read_to_string(store.installed_root().join("p").join(MANIFEST_FILE)).unwrap();
        assert!(text.contains("1.1.0"));
        assert!(!store.backup_dir_for("p", 42).exists());
    }

    #[test]
    fn update_commit_failure_restores_files_and_state() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "old", &manifest("p", "1.0.0", &["network"], &["api.example.com"]));
        commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();
        let before = store.snapshot();
        let old_manifest = fs::read(store.installed_root().join("p/package.json")).unwrap();
        let staging = make_staging(&store, "new", &manifest("p", "2.0.0", &["network"], &["api.example.com"]));
        let installed = store.installed_root().join("p");
        let result = replace_with_backup(&installed, &staging, &store.backup_dir_for("p", 42), || Err(PluginError::Io { message: "injected commit failure".into() }));
        assert!(result.is_err());
        assert_eq!(store.snapshot(), before);
        assert_eq!(fs::read(installed.join("package.json")).unwrap(), old_manifest);
        assert!(!store.backup_dir_for("p", 42).exists());
    }

    #[tokio::test]
    async fn uninstall_waits_for_stop_before_removing_files_and_state() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "old", &manifest("p", "1.0.0", &["network"], &["api.example.com"]));
        commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();
        let plugin = store.snapshot().find("p").unwrap().clone();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let operation = uninstall_after_stop(&store, &plugin, async { rx.await.unwrap(); });
        tokio::pin!(operation);
        assert!(tokio::time::timeout(Duration::from_millis(1), &mut operation).await.is_err());
        assert!(store.installed_root().join("p/index.js").is_file());
        assert!(store.snapshot().find("p").is_some());
        tx.send(()).unwrap();
        let (next, cleanup) = operation.await;
        assert!(next.unwrap().plugins.is_empty());
        cleanup.unwrap();
        assert!(!store.installed_root().join("p").exists());
    }

    #[test]
    fn uninstall_developer_plugin_keeps_source_bytes() {
        use std::hash::{Hash, Hasher};
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        store.update(|s| { s.developer_mode = true; Ok(()) }).unwrap();
        let folder = dir.path().join("dev");
        fs::create_dir_all(folder.join("src")).unwrap();
        fs::write(folder.join("package.json"), manifest("p", "1.0.0", &["network"], &["api.example.com"])).unwrap();
        fs::write(folder.join("src/index.js"), "export function activate() {}").unwrap();
        let hash = || {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            for file in ["package.json", "src/index.js"] { fs::read(folder.join(file)).unwrap().hash(&mut h); }
            h.finish()
        };
        let before = hash();
        register_dev(&store, folder.to_str().unwrap(), record("p", "1.0.0", None)).unwrap();
        let plugin = store.snapshot().find("p").unwrap().clone();
        let (next, cleanup) = uninstall(&store, &plugin);
        next.unwrap(); cleanup.unwrap();
        assert_eq!(hash(), before);
    }

    #[test]
    fn dev_reload_records_pending_consent_only_for_additions() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        store.update(|s| { s.developer_mode = true; Ok(()) }).unwrap();
        let folder = dir.path().join("dev");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(MANIFEST_FILE), manifest("d", "0.1.0", &["network"], &["api.example.com"])).unwrap();
        let path = folder.to_string_lossy().into_owned();
        register_dev(&store, &path, record("d", "0.1.0", None)).unwrap();

        // 追加なし（宛先を減らす）→ 同意済みを新しい宣言に揃える
        let next = reload_dev_state(&store, "d", &manifest("d", "0.1.1", &["network"], &[])).unwrap();
        let p = next.find("d").unwrap();
        assert_eq!(p.pending_consent, None);
        assert!(p.consented_destinations.is_empty());
        assert_eq!((p.version.as_str(), p.generation), ("0.1.1", 1));

        // 追加あり → 同意待ち。同意済みは変えない
        let next = reload_dev_state(&store, "d", &manifest("d", "0.2.0", &["network", "clipboard"], &["x.example.com"])).unwrap();
        let p = next.find("d").unwrap();
        assert_eq!(
            p.pending_consent,
            Some(PendingConsent {
                added_permissions: vec![Permission::Clipboard],
                added_destinations: vec!["x.example.com".into()],
            })
        );
        assert_eq!(p.consented_permissions, vec![Permission::Network]);

        // 再同意で解除し、読み込み直させる
        let mut rec = record("d", "0.2.0", None);
        rec.consented_permissions = vec![Permission::Network, Permission::Clipboard];
        rec.consented_destinations = vec!["x.example.com".into()];
        let next = set_dev_consent(&store, "d", rec).unwrap();
        let p = next.find("d").unwrap();
        assert_eq!(p.pending_consent, None);
        assert_eq!(p.generation, 3);
        // フォルダは変更しない
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
    }

    #[test]
    fn read_text_stays_inside_plugin_dir() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "abc", &manifest("p", "1.0.0", &[], &[]));
        fs::write(staging.join("theme 100%.json"), "{\"id\":\"t\"}").unwrap();
        commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();

        assert_eq!(read_plugin_text(&store, "p", "theme 100%.json").unwrap(), "{\"id\":\"t\"}");
        assert!(matches!(read_plugin_text(&store, "p", "../state.json"), Err(PluginError::OutOfScope { .. })));
        assert!(matches!(read_plugin_text(&store, "p", "missing.css"), Err(PluginError::NotFound { .. })));
        assert_eq!(read_plugin_text(&store, "nope", "a"), Err(PluginError::NotInstalled));
    }

    #[test]
    fn read_staging_text_stays_inside_staging_dir() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "abc", &manifest("p", "1.0.0", &[], &[]));
        fs::write(staging.join("theme.json"), "{\"id\":\"t\"}").unwrap();

        assert_eq!(read_staging_text(&store, "abc", "theme.json").unwrap(), "{\"id\":\"t\"}");
        assert!(matches!(read_staging_text(&store, "abc", "../../state.json"), Err(PluginError::OutOfScope { .. })));
        assert!(matches!(read_staging_text(&store, "abc", "missing.json"), Err(PluginError::NotFound { .. })));
        assert!(matches!(read_staging_text(&store, "../x", "theme.json"), Err(PluginError::InvalidArgument { .. })));
        assert!(matches!(read_staging_text(&store, "abcdef", "theme.json"), Err(PluginError::NotFound { .. })));
    }

    #[test]
    fn set_setting_accepts_only_primitives() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);
        let staging = make_staging(&store, "abc", &manifest("p", "1.0.0", &[], &[]));
        commit_install(&store, &staging, record("p", "1.0.0", github())).unwrap();

        let values = set_setting(&store, "p", "depth", json!("3")).unwrap();
        assert_eq!(Value::Object(values), json!({ "depth": "3" }));
        assert!(set_setting(&store, "p", "x", json!(null)).is_err());
        assert!(set_setting(&store, "p", "x", json!([1])).is_err());
        assert!(set_setting(&store, "p", "", json!(1)).is_err());
        assert_eq!(set_setting(&store, "q", "x", json!(1)), Err(PluginError::NotInstalled));
    }

    #[test]
    fn external_url_schemes() {
        assert!(check_external_url("https://example.com").is_ok());
        assert!(check_external_url("http://example.com").is_ok());
        assert!(check_external_url("mailto:a@example.com").is_ok());
        assert_eq!(
            check_external_url("file:///etc/passwd").unwrap_err(),
            PluginError::SchemeNotAllowed { scheme: "file".into() }
        );
        assert!(matches!(check_external_url("not a url"), Err(PluginError::InvalidArgument { .. })));
    }

    #[test]
    fn classify_and_error_entry() {
        let v = serde_json::to_value(
            classify_destinations(&["localhost:3000".into(), "api.example.com".into()]).unwrap(),
        )
        .unwrap();
        assert_eq!(
            v,
            json!([
                { "dest": "localhost:3000", "class": "private" },
                { "dest": "api.example.com", "class": "public" }
            ])
        );
        assert!(classify_destinations(&["bad host!".into()]).is_err());

        let long = "x".repeat(MAX_ERROR_MESSAGE_CHARS + 10);
        let e = make_error_entry("p", PluginErrorSource::Load, &long, "note_1", "t".into()).unwrap();
        assert_eq!(e.message.chars().count(), MAX_ERROR_MESSAGE_CHARS + 1);
        assert!(make_error_entry("../x", PluginErrorSource::Load, "m", "main", "t".into()).is_err());
    }

    #[test]
    fn install_record_deserializes_from_camel_case() {
        let r: InstallRecord = serde_json::from_value(json!({
            "id": "p",
            "version": "1.0.0",
            "source": { "type": "github", "owner": "o", "repo": "r" },
            "consentedPermissions": ["notes:read"],
            "consentedDestinations": []
        }))
        .unwrap();
        assert_eq!(r.source, Some(PluginSource::Github { owner: "o".into(), repo: "r".into() }));
        assert_eq!(r.consented_permissions, vec![Permission::NotesRead]);
    }
}
