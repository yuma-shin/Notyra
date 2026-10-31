use std::collections::HashMap;
use parking_lot::Mutex;

use crate::plugins::barrier::StopBarrier;
use crate::plugins::diagnostics::PluginDiagnostics;
use crate::plugins::protocol::SharedModuleRegistry;
use crate::plugins::store::PluginStore;

/// ファイルウォッチャーのハンドル
pub struct WatcherHandle {
    pub _watcher: Box<dyn std::any::Any + Send>,
}

/// アプリケーション全体の共有状態
pub struct AppState {
    /// ファイルパス → ウォッチャーハンドルのマップ
    pub watchers: Mutex<HashMap<String, WatcherHandle>>,
    /// プラグインの永続化状態（`{app_data_dir}/plugins`）
    pub plugin_store: PluginStore,
    /// 全 Plugin_Host_Window での Plugin_Stop 完了の待ち合わせ
    pub stop_barrier: StopBarrier,
    /// `notyra-plugin` スキームで配信する共有モジュール（React 等）の export 名
    pub shared_modules: SharedModuleRegistry,
    /// セッション内のエラーとキーバインド重複（永続化しない）
    pub plugin_diagnostics: PluginDiagnostics,
    /// インストール・更新・アンインストール・開発者モードの再読み込みなど、
    /// Plugin のファイルを操作する処理を直列化する（StopBarrier の待機中も保持する）
    pub plugin_ops: tokio::sync::Mutex<()>,
    pub note_sync: crate::plugins::note_sync::NoteSync,
}
