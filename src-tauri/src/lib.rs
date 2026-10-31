mod commands;
mod plugins;
mod state;

use std::collections::HashMap;
use parking_lot::Mutex;
use tauri::Manager;

pub use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // フォーカスをメインウィンドウに戻す
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        // Plugin のコードと資産の配信（Windows: http://notyra-plugin.localhost/、
        // macOS / Linux: notyra-plugin://localhost/）
        .register_asynchronous_uri_scheme_protocol(
            plugins::protocol::SCHEME,
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let response = match app.try_state::<AppState>() {
                        Some(state) => plugins::protocol::handle(
                            &state.plugin_store,
                            &state.shared_modules,
                            &request,
                        ),
                        None => plugins::protocol::unavailable_response(),
                    };
                    responder.respond(response);
                });
            },
        )
        .setup(|app| {
            // プラグインの永続化状態を {app_data_dir}/plugins から読み込む
            // （app_data_dir の解決にアプリハンドルが必要なため setup で AppState を登録する）
            let plugins_root = app.path().app_data_dir()?.join("plugins");
            let plugin_store = plugins::store::PluginStore::load(plugins_root.clone())
                .unwrap_or_else(|e| {
                    eprintln!("[notyra] failed to load plugin state: {e}");
                    plugins::store::PluginStore::fallback(plugins_root, e)
                });
            app.manage(AppState {
                watchers: Mutex::new(HashMap::new()),
                plugin_store,
                stop_barrier: plugins::barrier::StopBarrier::new(),
                shared_modules: plugins::protocol::SharedModuleRegistry::new(),
                plugin_diagnostics: plugins::diagnostics::PluginDiagnostics::new(),
                plugin_ops: tokio::sync::Mutex::new(()),
            });

            // アプリアイコンをウィンドウに設定（dev モードでも正しいアイコンが表示されるよう埋め込む）
            if let Some(main_window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../../src/resources/build/icons/dark/png/128x128.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = main_window.set_icon(icon);
                }
            }

            // メインウィンドウが閉じられたらアプリ全体を終了する
            // （エディタウィンドウなどサブウィンドウも一緒に閉じる）
            let app_handle = app.handle().clone();
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        app_handle.exit(0);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Markdown コマンド
            commands::markdown::select_root_folder,
            commands::markdown::check_root_exists,
            commands::markdown::scan_notes_and_build_folder_tree,
            commands::markdown::get_note_content,
            commands::markdown::save_note,
            commands::markdown::create_note,
            commands::markdown::rename_note,
            commands::markdown::delete_note,
            commands::markdown::move_note,
            commands::markdown::create_folder,
            commands::markdown::delete_folder,
            commands::markdown::watch_file,
            commands::markdown::unwatch_file,
            // 画像コマンド
            commands::image::save_image_from_file,
            commands::image::save_image_from_buffer,
            commands::image::select_image_file,
            commands::image::cleanup_unused_images,
            commands::image::cleanup_all_unused_images,
            commands::image::delete_note_images,
            commands::image::read_image_as_base64,
            // エクスポートコマンド
            commands::export::export_html,
            commands::export::export_pdf,
            commands::export::open_print_window,
            // ウィンドウコマンド
            commands::window::open_note_window,
            commands::window::open_settings_window,
            // フォントコマンド
            commands::font::list_system_fonts,
            // プラグイン管理コマンド
            commands::plugin::plugin_get_state,
            commands::plugin::plugin_fetch_release,
            commands::plugin::plugin_discard_staging,
            commands::plugin::plugin_commit_install,
            commands::plugin::plugin_check_update,
            commands::plugin::plugin_apply_update,
            commands::plugin::plugin_set_enabled,
            commands::plugin::plugin_uninstall,
            commands::plugin::plugin_set_developer_mode,
            commands::plugin::plugin_ack_third_party_warning,
            commands::plugin::plugin_select_dev_folder,
            commands::plugin::plugin_register_dev,
            commands::plugin::plugin_reload_dev,
            commands::plugin::plugin_set_dev_consent,
            commands::plugin::plugin_read_text,
            commands::plugin::plugin_read_staging_text,
            commands::plugin::plugin_get_settings,
            commands::plugin::plugin_set_setting,
            commands::plugin::plugin_report_error,
            commands::plugin::plugin_get_errors,
            commands::plugin::plugin_report_keybinding_conflicts,
            commands::plugin::plugin_get_keybinding_conflicts,
            commands::plugin::plugin_ack_stop,
            commands::plugin::plugin_register_shared_modules,
            commands::plugin::plugin_classify_destinations,
            commands::plugin::plugin_fetch_registry,
            commands::plugin::plugin_clipboard_read,
            commands::plugin::plugin_clipboard_write,
            commands::plugin::plugin_open_external,
            // Network_Gateway
            commands::plugin_network::plugin_http_request,
            // Plugin 用ノートコマンド
            commands::plugin_notes::plugin_notes_list_roots,
            commands::plugin_notes::plugin_notes_list,
            commands::plugin_notes::plugin_notes_read,
            commands::plugin_notes::plugin_notes_create,
            commands::plugin_notes::plugin_notes_update,
            commands::plugin_notes::plugin_notes_rename,
            commands::plugin_notes::plugin_notes_move,
            commands::plugin_notes::plugin_notes_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // アプリ終了前の未使用画像クリーンアップは非同期で実行
                // クリーンアップが完了したら終了
                let _ = api;
                let _ = app;
            }
        })
}
