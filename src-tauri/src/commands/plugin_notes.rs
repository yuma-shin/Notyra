//! Plugin 用ノート読み書きの `#[tauri::command]`（`plugin_notes_*`）。
//!
//! すべてのコマンドは次を行ってから操作する。
//!
//! - state.json（`PluginStore`）で、呼び出し元 Plugin が必要な Permission
//!   （`notes:read` / `notes:write`）に同意済みであることを再確認する（Requirement 6.9）
//! - パス引数を [`resolve_within_roots`] で登録済みルートフォルダ（`roots`）の内側か判定し、
//!   範囲外なら `OutOfScope` を返す（Requirement 18.3、18.4）。入出力は解決後のパスで行う
//!
//! ノートの作成・保存・移動・一覧・画像削除は既存の UI 用コマンドと同じ内部処理
//! （`commands/markdown.rs`、`commands/image.rs`）を共有する（Requirement 18.7、18.10、18.13）。

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State, WebviewWindow};

use crate::commands::image::{delete_image_files, note_image_paths};
use crate::commands::markdown::{self, MarkdownNoteMeta};
use crate::plugins::notes_scope::resolve_within_roots;
use crate::plugins::store::{Permission, PluginStateFile};
use crate::plugins::PluginError;
use crate::state::AppState;

/// `plugin_notes_read` の戻り値（TS: `{ path, body, frontMatter }`）
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNoteContent {
    pub path: String,
    pub body: String,
    pub front_matter: Map<String, Value>,
}

// ---------------------------------------------------------------------------
// Tauri コマンド
// ---------------------------------------------------------------------------

/// 登録済みルートフォルダのうち存在するものを返す（notes:read）
#[tauri::command]
pub async fn plugin_notes_list_roots(
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
) -> Result<Vec<String>, PluginError> {
    list_roots(&state.plugin_store.snapshot(), &plugin_id, &roots)
}

/// ルートフォルダ内のノート一覧（メタデータ）を返す（notes:read）
#[tauri::command]
pub async fn plugin_notes_list(
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    root: String,
) -> Result<Vec<MarkdownNoteMeta>, PluginError> {
    let snapshot = state.plugin_store.snapshot();
    list(&snapshot, &plugin_id, &roots, &root).await
}

/// ノートの本文と Front Matter を返す（notes:read）
#[tauri::command]
pub async fn plugin_notes_read(
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    path: String,
) -> Result<PluginNoteContent, PluginError> {
    let snapshot = state.plugin_store.snapshot();
    read(&snapshot, &plugin_id, &roots, &path).await
}

/// 削除確認前に、リンク解決後のノートを含む登録済みルートを返す（notes:write）。
#[tauri::command]
pub async fn plugin_notes_resolve_root(
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    path: String,
) -> Result<String, PluginError> {
    resolve_delete_root(&state.plugin_store.snapshot(), &plugin_id, &roots, &path)
}

/// ノートを作成し、実際に保存したパスを返す（notes:write）
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn plugin_notes_create(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    root: String,
    folder: Option<String>,
    title: String,
    body: Option<String>,
    front_matter: Option<Value>,
) -> Result<String, PluginError> {
    let snapshot = state.plugin_store.snapshot();
    require_permission(&snapshot, &plugin_id, Permission::NotesWrite)?;
    registered_root(&root, &roots)?;
    state.note_sync.mutate(&app, "create", vec![], async {
        let saved = create(
            &snapshot,
            &plugin_id,
            &roots,
            &root,
            CreateInput { folder: folder.as_deref(), title: &title, body, front_matter },
        )
        .await?;
        Ok((saved.clone(), Some(saved)))
    }).await
}

/// ノートの本文と Front Matter を書き込み、ノートを開いているエディタへ
/// プラグイン由来の変更として同期する（notes:write、Requirement 18.10）
#[tauri::command]
pub async fn plugin_notes_update(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    path: String,
    body: String,
    front_matter: Value,
) -> Result<(), PluginError> {
    let snapshot = state.plugin_store.snapshot();
    let open_paths: Vec<_> = state.watchers.lock().keys().cloned().collect();
    let paths = mutation_paths(&snapshot, &plugin_id, &roots, &path, &open_paths)?;
    require_object(&front_matter)?;
    state.note_sync.mutate(&app, "update", paths, async {
        update(&snapshot, &plugin_id, &roots, &path, &body, &front_matter).await?;
        Ok(((), None))
    }).await
}

/// ノートの名前を変更し、新しいパスを返す。既存のノートは上書きしない（notes:write）
#[tauri::command]
pub async fn plugin_notes_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    path: String,
    new_title: String,
) -> Result<String, PluginError> {
    let snapshot = state.plugin_store.snapshot();
    let open_paths: Vec<_> = state.watchers.lock().keys().cloned().collect();
    let paths = mutation_paths(&snapshot, &plugin_id, &roots, &path, &open_paths)?;
    state.note_sync.mutate(&app, "rename", paths, async {
        let saved = rename(&snapshot, &plugin_id, &roots, &path, &new_title).await?;
        Ok((saved.clone(), Some(saved)))
    }).await
}

/// ノートを移動し、実際に保存したパスを返す（notes:write）
#[tauri::command]
pub async fn plugin_notes_move(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    root: String,
    path: String,
    target_folder: String,
) -> Result<String, PluginError> {
    let snapshot = state.plugin_store.snapshot();
    let open_paths: Vec<_> = state.watchers.lock().keys().cloned().collect();
    let paths = mutation_paths(&snapshot, &plugin_id, &roots, &path, &open_paths)?;
    state.note_sync.mutate(&app, "move", paths, async {
        let saved = move_note(&snapshot, &plugin_id, &roots, &root, &path, &target_folder).await?;
        Ok((saved.clone(), Some(saved)))
    }).await
}

/// ノートと関連付けられた画像を削除する（notes:write）。
/// 確認ダイアログは Renderer 側で表示し、確定後にのみ呼び出される（Requirement 18.12）
#[tauri::command]
pub async fn plugin_notes_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    roots: Vec<String>,
    root: String,
    path: String,
) -> Result<(), PluginError> {
    let snapshot = state.plugin_store.snapshot();
    let open_paths: Vec<_> = state.watchers.lock().keys().cloned().collect();
    let paths = mutation_paths(&snapshot, &plugin_id, &roots, &path, &open_paths)?;
    state.note_sync.mutate(&app, "delete", paths, async {
        let result = delete(&snapshot, &plugin_id, &roots, &root, &path).await;
        // Image cleanup can fail after the note has already been deleted.
        // Editors must still clear the deleted path before returning that error.
        match result {
            Err(error) if Path::new(&path).exists() => Err(error),
            result => Ok((result, None)),
        }
    }).await?
}

/// Only the calling window may acknowledge its own editor synchronization.
#[tauri::command]
pub fn ack_note_mutation(
    state: State<'_, AppState>,
    webview_window: WebviewWindow,
    request_id: String,
    error: Option<String>,
) {
    state.note_sync.ack(&request_id, webview_window.label(), error);
}

fn mutation_paths(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    path: &str,
    open_paths: &[String],
) -> Result<Vec<String>, PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    let resolved = resolve_note(path, &root_paths(roots))?;
    let mut paths = vec![path.to_string(), path_string(&resolved)];
    // An editor can use a registered junction/symlink root while a plugin uses
    // the canonical path returned by notes.read. Notify both spellings.
    for root in roots {
        if let Ok(base) = resolve_within_roots(Path::new(root), &root_paths(roots)) {
            if let Ok(relative) = resolved.strip_prefix(base) {
                let alias = path_string(&Path::new(root).join(relative));
                if !paths.contains(&alias) { paths.push(alias); }
            }
        }
    }
    // Watcher keys preserve the spelling used by each open editor. Resolve
    // those paths before rename/delete, while file and directory links still
    // exist, and retain the aliases for both prepare and commit notifications.
    let roots = root_paths(roots);
    for open_path in open_paths {
        if matches!(resolve_note(open_path, &roots), Ok(note) if note == resolved)
            && !paths.contains(open_path)
        {
            paths.push(open_path.clone());
        }
    }
    Ok(paths)
}

// ---------------------------------------------------------------------------
// 本体（テスト可能にするため State / AppHandle から分離）
// ---------------------------------------------------------------------------

pub(crate) struct CreateInput<'a> {
    pub folder: Option<&'a str>,
    pub title: &'a str,
    pub body: Option<String>,
    pub front_matter: Option<Value>,
}

pub(crate) fn list_roots(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
) -> Result<Vec<String>, PluginError> {
    require_permission(state, plugin_id, Permission::NotesRead)?;
    Ok(roots
        .iter()
        .filter(|r| {
            let p = Path::new(r.as_str());
            p.is_absolute() && p.is_dir()
        })
        .cloned()
        .collect())
}

pub(crate) async fn list(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    root: &str,
) -> Result<Vec<MarkdownNoteMeta>, PluginError> {
    require_permission(state, plugin_id, Permission::NotesRead)?;
    let (_, registered) = registered_root(root, roots)?;
    // 表示用のパスは登録時の表記を保ち、各読み込み先を notes.read と同じスコープで検証する。
    Ok(markdown::scan_notes_scoped(Path::new(registered), &root_paths(roots)).await)
}

pub(crate) async fn read(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    path: &str,
) -> Result<PluginNoteContent, PluginError> {
    require_permission(state, plugin_id, Permission::NotesRead)?;
    let note = resolve_note(path, &root_paths(roots))?;
    let raw = tokio::fs::read_to_string(&note).await?;
    let (body, front_matter) = markdown::parse_note_front_matter(&raw).map_err(io_error)?;
    Ok(PluginNoteContent { path: path_string(&note), body, front_matter })
}

pub(crate) async fn create(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    root: &str,
    input: CreateInput<'_>,
) -> Result<String, PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    let title = input.title;
    if title.trim().is_empty() {
        return Err(invalid_argument("title must not be empty"));
    }
    if let Some(fm) = &input.front_matter {
        require_object(fm)?;
    }

    let (resolved_root, _) = registered_root(root, roots)?;
    let target_dir = match input.folder {
        Some(folder) if !folder.is_empty() => {
            resolve_within_roots(&resolved_root.join(folder), std::slice::from_ref(&resolved_root))?
        }
        _ => resolved_root.clone(),
    };

    let content = match (input.body, input.front_matter) {
        // 本文も Front Matter も指定されていなければ UI の新規作成と同じ内容
        (None, None) => markdown::default_note_content(title),
        (body, front_matter) => {
            let body = body.unwrap_or_else(|| format!("# {}\n\n", title));
            let front_matter = front_matter.unwrap_or_else(|| default_front_matter(title));
            markdown::compose_note_file(&body, Some(&front_matter))
        }
    };

    let saved = markdown::create_note_file(&target_dir, &markdown::sanitize_filename(title), &content)
        .await
        .map_err(io_error)?;
    Ok(path_string(&saved))
}

/// 書き込んだノートのパス（呼び出し元の表記と解決後の表記）を返す
pub(crate) async fn update(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    path: &str,
    body: &str,
    front_matter: &Value,
) -> Result<Vec<String>, PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    require_object(front_matter)?;
    let note = resolve_note(path, &root_paths(roots))?;

    markdown::write_note_file(&note, body, Some(front_matter))
        .await
        .map_err(io_error)?;

    // 呼び出し元と実際に書き込んだファイルの両方の表記を保持する。
    // エディタとの同期自体はコマンド層の notes:mutation が行う。
    let mut changed = Vec::new();
    for p in [path.to_string(), path.replace('\\', "/"), path_string(&note)] {
        if !changed.contains(&p) {
            changed.push(p);
        }
    }
    Ok(changed)
}

pub(crate) async fn rename(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    path: &str,
    new_title: &str,
) -> Result<String, PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    if new_title.trim().is_empty() {
        return Err(invalid_argument("new title must not be empty"));
    }
    let note = resolve_note(path, &root_paths(roots))?;
    let new_path = markdown::renamed_note_path(&note, new_title).map_err(io_error)?;

    // 同じファイルへの名前変更（大文字小文字だけが異なる場合を含む）は重複とみなさない
    let same_file = is_same_file(&note, &new_path);
    if !same_file && std::fs::symlink_metadata(&new_path).is_ok() {
        // Requirement 18.8: 既存のノートを上書きしない
        return Err(PluginError::NameConflict { path: path_string(&new_path) });
    }

    markdown::write_renamed_note(&note, &new_path, new_title)
        .await
        .map_err(io_error)?;
    if !same_file {
        tokio::fs::remove_file(&note).await?;
    }
    Ok(path_string(&new_path))
}

pub(crate) async fn move_note(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    root: &str,
    path: &str,
    target_folder: &str,
) -> Result<String, PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    let (resolved_root, _) = registered_root(root, roots)?;
    let scope = std::slice::from_ref(&resolved_root);
    let note = resolve_note(path, scope)?;
    let target_dir = if target_folder.is_empty() {
        resolved_root.clone()
    } else {
        resolve_within_roots(&resolved_root.join(target_folder), scope)?
    };

    let saved = markdown::move_note_file(&note, &target_dir)
        .await
        .map_err(io_error)?
        .unwrap_or(note);
    Ok(path_string(&saved))
}

pub(crate) async fn delete(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    root: &str,
    path: &str,
) -> Result<(), PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    let (resolved_root, _) = registered_root(root, roots)?;
    let note = resolve_note(path, std::slice::from_ref(&resolved_root))?;

    // Validate the entire image cleanup plan before deleting anything.
    let base_name = note
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let images = if base_name.is_empty() {
        vec![]
    } else {
        let scope = root_paths(roots);
        let images_dir = resolve_within_roots(&resolved_root.join("images"), &scope)?;
        let paths = match note_image_paths(&images_dir, &base_name).await {
            Ok(paths) => paths,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(error) => return Err(error.into()),
        };
        for path in &paths {
            resolve_within_roots(path, &scope)?;
        }
        // Paths use the resolved directory, but retain the final filename so
        // remove_file unlinks a file symlink instead of deleting its target.
        paths
    };

    tokio::fs::remove_file(&note).await?;

    if !images.is_empty() {
        let result = delete_image_files(&images).await;
        if !result.errors.is_empty() {
            return Err(io_error(format!(
                "note was deleted but some images could not be deleted: {}",
                result.errors.join("; ")
            )));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/// state.json で Plugin が `permission` に同意済みであることを確認する
pub(crate) fn require_permission(
    state: &PluginStateFile,
    plugin_id: &str,
    permission: Permission,
) -> Result<(), PluginError> {
    let plugin = state.find(plugin_id).ok_or(PluginError::NotInstalled)?;
    if plugin.consented_permissions.contains(&permission) {
        Ok(())
    } else {
        Err(PluginError::PermissionDenied { permission: permission.as_str().to_string() })
    }
}

fn root_paths(roots: &[String]) -> Vec<PathBuf> {
    roots.iter().map(PathBuf::from).collect()
}

pub(crate) fn resolve_delete_root(
    state: &PluginStateFile,
    plugin_id: &str,
    roots: &[String],
    path: &str,
) -> Result<String, PluginError> {
    require_permission(state, plugin_id, Permission::NotesWrite)?;
    let note = resolve_note(path, &root_paths(roots))?;
    let mut best: Option<(usize, &String)> = None;
    for root in roots {
        let Ok((resolved, _)) = registered_root(root, roots) else {
            continue;
        };
        let depth = resolved.components().count();
        if note.starts_with(&resolved) && best.is_none_or(|(previous, _)| depth > previous) {
            best = Some((depth, root));
        }
    }
    best.map(|(_, root)| root.clone())
        .ok_or_else(|| PluginError::OutOfScope { path: path.to_string() })
}

/// `root` が登録済みルートのいずれか（正規化後に一致）であれば、
/// 解決後のパスと登録済みルートの文字列を返す。サブフォルダや範囲外は `OutOfScope`
fn registered_root<'a>(root: &str, roots: &'a [String]) -> Result<(PathBuf, &'a str), PluginError> {
    let resolved = resolve_within_roots(Path::new(root), &root_paths(roots))?;
    roots
        .iter()
        .find(|r| {
            resolve_within_roots(Path::new(r.as_str()), &[PathBuf::from(r.as_str())])
                .is_ok_and(|rr| rr == resolved)
        })
        .map(|r| (resolved.clone(), r.as_str()))
        .ok_or_else(|| PluginError::OutOfScope { path: root.to_string() })
}

/// ノートのパスを解決する。範囲外は `OutOfScope`、`.md` 以外は `InvalidArgument`、
/// 存在しなければ `NotFound`
fn resolve_note(path: &str, scope: &[PathBuf]) -> Result<PathBuf, PluginError> {
    let resolved = resolve_within_roots(Path::new(path), scope)?;
    if resolved.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err(invalid_argument(&format!("not a markdown note: {path}")));
    }
    if !resolved.is_file() {
        return Err(PluginError::NotFound { path: path.to_string() });
    }
    Ok(resolved)
}

fn require_object(v: &Value) -> Result<(), PluginError> {
    if v.is_object() {
        Ok(())
    } else {
        Err(invalid_argument("frontMatter must be an object"))
    }
}

fn default_front_matter(title: &str) -> Value {
    let now = markdown::chrono_now();
    json!({ "title": title, "createdAt": now, "updatedAt": now, "tags": [] })
}

fn is_same_file(a: &Path, b: &Path) -> bool {
    markdown::is_same_note_file(a, b)
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn io_error(message: String) -> PluginError {
    PluginError::Io { message }
}

fn invalid_argument(message: &str) -> PluginError {
    PluginError::InvalidArgument { message: message.to_string() }
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::store::{InstalledPluginState, PluginSource};
    use std::fs;
    use tempfile::TempDir;

    const ID: &str = "notes-plugin";

    fn state_with(permissions: Vec<Permission>) -> PluginStateFile {
        PluginStateFile {
            schema_version: 1,
            third_party_warning_acknowledged: true,
            developer_mode: false,
            plugins: vec![InstalledPluginState {
                id: ID.into(),
                version: "1.0.0".into(),
                source: PluginSource::Github { owner: "o".into(), repo: "r".into() },
                enabled: true,
                consented_permissions: permissions,
                consented_destinations: vec![],
                generation: 0,
                pending_consent: None,
                disabled_reason: None,
                installed_at: "2026-01-01T00:00:00Z".into(),
            }],
        }
    }

    fn rw() -> PluginStateFile {
        state_with(vec![Permission::NotesRead, Permission::NotesWrite])
    }

    /// 一時ディレクトリに `notes/` ルートを作り、(TempDir, ルートのパス, roots) を返す
    fn setup() -> (TempDir, PathBuf, Vec<String>) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("notes");
        fs::create_dir_all(root.join("sub")).unwrap();
        let roots = vec![root.to_string_lossy().into_owned()];
        (tmp, root, roots)
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn same(a: &str, b: &Path) -> bool {
        fs::canonicalize(a).unwrap() == fs::canonicalize(b).unwrap()
    }

    fn input(title: &str) -> CreateInput<'_> {
        CreateInput { folder: None, title, body: None, front_matter: None }
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn list_does_not_disclose_notes_through_links_outside_registered_roots() {
        let (tmp, root, roots) = setup();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.md"), "---\ntitle: PRIVATE_TITLE\ntags: [private-tag]\n---\nPRIVATE_BODY_EXCERPT").unwrap();
        fs::write(root.join("sub/allowed.md"), "allowed body").unwrap();
        link_directory(&outside, &root.join("escape"));
        let escaped = s(&root.join("escape/secret.md"));
        assert!(matches!(read(&rw(), ID, &roots, &escaped).await, Err(PluginError::OutOfScope { .. })));
        let notes = list(&rw(), ID, &roots, &roots[0]).await.unwrap();
        assert_eq!(notes.iter().map(|note| note.relative_path.as_str()).collect::<Vec<_>>(), ["sub/allowed.md"]);
        let serialized = serde_json::to_string(&notes).unwrap();
        for secret in ["PRIVATE_TITLE", "private-tag", "PRIVATE_BODY_EXCERPT"] {
            assert!(!serialized.contains(secret));
        }
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn list_preserves_registered_root_aliases_and_in_scope_links_without_following_cycles() {
        let tmp = TempDir::new().unwrap();
        let real = tmp.path().join("real notes");
        let other = tmp.path().join("other registered root");
        fs::create_dir_all(real.join("sub")).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(real.join("sub/a.md"), "allowed A").unwrap();
        fs::write(other.join("b.md"), "allowed B").unwrap();
        let alias = tmp.path().join("registered alias");
        link_directory(&real, &alias);
        link_directory(&real.join("sub"), &real.join("sub-alias"));
        link_directory(&other, &real.join("other"));
        link_directory(&real, &real.join("loop"));
        let empty = real.join("missing-target");
        fs::create_dir(&empty).unwrap();
        link_directory(&empty, &real.join("broken-link"));
        fs::remove_dir(empty).unwrap();
        let roots = vec![s(&alias), s(&other)];
        let notes = list(&rw(), ID, &roots, &roots[0]).await.unwrap();
        let mut relative: Vec<_> = notes.iter().map(|note| note.relative_path.as_str()).collect();
        relative.sort();
        assert_eq!(relative, ["other/b.md", "sub-alias/a.md", "sub/a.md"]);
        for note in notes {
            assert_eq!(note.file_path, format!("{}/{}", path_string(&alias), note.relative_path));
            let content = read(&rw(), ID, &roots, &note.file_path).await.unwrap();
            assert!(content.body.starts_with("allowed"));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn list_validates_file_symlink_targets_as_well_as_directories() {
        let (tmp, root, roots) = setup();
        let outside = tmp.path().join("secret.md");
        fs::write(&outside, "PRIVATE_EXCERPT").unwrap();
        fs::write(root.join("inside.md"), "allowed").unwrap();
        fs::write(root.join("inside.txt"), "NOT_A_NOTE").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape.md")).unwrap();
        std::os::unix::fs::symlink(root.join("inside.md"), root.join("alias.md")).unwrap();
        std::os::unix::fs::symlink(root.join("missing.md"), root.join("broken.md")).unwrap();
        std::os::unix::fs::symlink(root.join("inside.txt"), root.join("fake.md")).unwrap();
        let notes = list(&rw(), ID, &roots, &roots[0]).await.unwrap();
        let mut paths: Vec<_> = notes.iter().map(|note| note.relative_path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, ["alias.md", "inside.md"]);
        assert!(!serde_json::to_string(&notes).unwrap().contains("PRIVATE_EXCERPT"));
        assert!(matches!(read(&rw(), ID, &roots, &s(&root.join("escape.md"))).await, Err(PluginError::OutOfScope { .. })));
    }

    #[cfg(any(unix, windows))]
    fn link_directory(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("cmd.exe")
                .args(["/D", "/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(output.status.success(), "junction creation failed: {output:?}");
        }
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn delete_resolves_canonical_paths_returned_by_note_operations_through_linked_roots() {
        let tmp = TempDir::new().unwrap();
        let real = tmp.path().join("real notes");
        fs::create_dir_all(real.join("sub")).unwrap();
        let alias = tmp.path().join("registered notes");
        let nested = tmp.path().join("subroot");
        link_directory(&real, &alias);
        link_directory(&real.join("sub"), &nested);
        let roots = vec![s(&alias), s(&nested)];
        fs::write(real.join("a.md"), "body").unwrap();
        let read_path = read(&rw(), ID, &roots, &s(&alias.join("a.md"))).await.unwrap().path;
        assert!(!Path::new(&read_path).starts_with(&alias));
        let created = create(&rw(), ID, &roots, &roots[0], input("created")).await.unwrap();
        let source = create(&rw(), ID, &roots, &roots[0], input("before-rename")).await.unwrap();
        let renamed = rename(&rw(), ID, &roots, &source, "renamed").await.unwrap();
        let source = create(&rw(), ID, &roots, &roots[0], input("before-move")).await.unwrap();
        let moved = move_note(&rw(), ID, &roots, &roots[0], &source, "sub").await.unwrap();
        for (path, expected) in [(&read_path, &roots[0]), (&created, &roots[0]), (&renamed, &roots[0]), (&moved, &roots[1])] {
            let root = resolve_delete_root(&state_with(vec![Permission::NotesWrite]), ID, &roots, path).unwrap();
            assert_eq!(&root, expected);
            delete(&rw(), ID, &roots, &root, path).await.unwrap();
            assert!(!Path::new(path).exists());
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn delete_root_resolution_rejects_symlink_escapes_and_checks_write_permission() {
        let tmp = TempDir::new().unwrap();
        let real = tmp.path().join("real");
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&real).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(real.join("a.md"), "inside").unwrap();
        fs::write(outside.join("b.md"), "keep").unwrap();
        let alias = tmp.path().join("registered");
        link_directory(&real, &alias);
        link_directory(&outside, &real.join("escape"));
        let roots = vec![s(&alias)];
        for path in [s(&alias.join("escape/b.md")), s(&outside.join("b.md"))] {
            assert!(matches!(resolve_delete_root(&rw(), ID, &roots, &path), Err(PluginError::OutOfScope { .. })));
        }
        assert!(matches!(resolve_delete_root(&state_with(vec![Permission::NotesRead]), ID, &roots, &s(&real.join("a.md"))), Err(PluginError::PermissionDenied { .. })));
        assert_eq!(fs::read_to_string(outside.join("b.md")).unwrap(), "keep");
    }

    #[test]
    fn mutation_events_include_registered_root_aliases_and_validate_permissions() {
        let (_tmp, root, _) = setup();
        fs::write(root.join("a.md"), "body").unwrap();
        let root = path_string(&root);
        let roots = vec![format!("{root}/.")];
        let path = format!("{root}/a.md");
        let paths = mutation_paths(&rw(), ID, &roots, &path, &[]).unwrap();
        assert!(paths.contains(&path));
        assert!(paths.contains(&format!("{root}/./a.md")));
        assert!(matches!(mutation_paths(&state_with(vec![]), ID, &roots, &path, &[]), Err(PluginError::PermissionDenied { .. })));
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn mutation_events_include_open_editors_through_nested_directory_links() {
        let tmp = TempDir::new().unwrap();
        let real = tmp.path().join("real notes");
        fs::create_dir_all(real.join("sub")).unwrap();
        fs::write(real.join("sub/a.md"), "body").unwrap();
        fs::write(real.join("sub/b.md"), "unrelated").unwrap();
        let registered = tmp.path().join("registered notes");
        link_directory(&real, &registered);
        link_directory(&real.join("sub"), &real.join("sub-alias"));
        link_directory(&real.join("sub-alias"), &real.join("nested-alias"));
        let roots = vec![s(&registered)];
        let aliases = vec![
            s(&registered.join("sub-alias/a.md")),
            s(&registered.join("nested-alias/a.md")),
            s(&real.join("sub-alias/a.md")),
        ];
        let unrelated = s(&registered.join("sub-alias/b.md"));
        let mut open_paths = aliases.clone();
        open_paths.push(unrelated.clone());
        let canonical = read(&rw(), ID, &roots, &aliases[0]).await.unwrap().path;
        let paths = mutation_paths(&rw(), ID, &roots, &canonical, &open_paths).unwrap();
        for alias in &aliases {
            assert!(paths.contains(alias), "missing editor alias: {alias}");
        }
        assert!(!paths.contains(&unrelated));
        assert!(matches!(mutation_paths(&state_with(vec![]), ID, &roots, &canonical, &open_paths), Err(PluginError::PermissionDenied { .. })));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mutation_events_include_open_file_symlinks() {
        let (_tmp, root, roots) = setup();
        fs::write(root.join("a.md"), "body").unwrap();
        let alias = root.join("alias.md");
        std::os::unix::fs::symlink(root.join("a.md"), &alias).unwrap();
        let alias = s(&alias);
        let canonical = read(&rw(), ID, &roots, &alias).await.unwrap().path;
        let paths = mutation_paths(&rw(), ID, &roots, &canonical, std::slice::from_ref(&alias)).unwrap();
        assert!(paths.contains(&alias));
    }

    #[tokio::test]
    async fn create_io_failure_keeps_existing_file() {
        let (_tmp, root, roots) = setup();
        fs::write(root.join("blocked"), "keep").unwrap();
        let result = create(&rw(), ID, &roots, &roots[0], CreateInput { folder: Some("blocked"), ..input("new") }).await;
        assert!(matches!(result, Err(PluginError::Io { .. })));
        assert_eq!(fs::read_to_string(root.join("blocked")).unwrap(), "keep");
        assert!(!root.join("new.md").exists());
    }

    #[tokio::test]
    async fn permissions_are_checked_against_state() {
        let (_tmp, root, roots) = setup();
        fs::write(root.join("a.md"), "# a").unwrap();
        let note = s(&root.join("a.md"));

        let write_only = state_with(vec![Permission::NotesWrite]);
        let denied_read = PluginError::PermissionDenied { permission: "notes:read".into() };
        assert_eq!(list_roots(&write_only, ID, &roots), Err(denied_read.clone()));
        assert_eq!(read(&write_only, ID, &roots, &note).await, Err(denied_read));

        let read_only = state_with(vec![Permission::NotesRead]);
        let denied_write = PluginError::PermissionDenied { permission: "notes:write".into() };
        assert_eq!(
            update(&read_only, ID, &roots, &note, "x", &json!({})).await,
            Err(denied_write.clone())
        );
        assert_eq!(delete(&read_only, ID, &roots, &roots[0], &note).await, Err(denied_write));
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "# a");

        assert_eq!(list_roots(&rw(), "other", &roots), Err(PluginError::NotInstalled));
    }

    #[tokio::test]
    async fn paths_outside_roots_are_rejected() {
        let (tmp, root, roots) = setup();
        fs::write(tmp.path().join("secret.md"), "s").unwrap();
        let escape = s(&root.join("sub").join("..").join("..").join("secret.md"));

        assert!(matches!(read(&rw(), ID, &roots, &escape).await, Err(PluginError::OutOfScope { .. })));
        let create_outside = CreateInput { folder: Some("../outside"), ..input("x") };
        assert!(matches!(
            create(&rw(), ID, &roots, &roots[0], create_outside).await,
            Err(PluginError::OutOfScope { .. })
        ));
        // ルートとして渡せるのは登録済みルートのみ（サブフォルダは不可）
        assert!(matches!(
            list(&rw(), ID, &roots, &s(&root.join("sub"))).await,
            Err(PluginError::OutOfScope { .. })
        ));
        assert!(!tmp.path().join("outside").exists());
    }

    #[tokio::test]
    async fn list_roots_and_list_return_existing_roots_and_notes() {
        let (tmp, root, mut roots) = setup();
        fs::write(root.join("sub").join("b.md"), "---\ntitle: B\n---\nbody").unwrap();
        roots.push(s(&tmp.path().join("missing")));

        assert_eq!(list_roots(&rw(), ID, &roots).unwrap(), vec![roots[0].clone()]);
        let notes = list(&rw(), ID, &roots, &roots[0]).await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "B");
        assert_eq!(notes[0].relative_path, "sub/b.md");
    }

    #[tokio::test]
    async fn create_adds_sequence_number_and_returns_saved_path() {
        let (_tmp, root, roots) = setup();
        let first = create(&rw(), ID, &roots, &roots[0], input("My Note")).await.unwrap();
        let second = create(&rw(), ID, &roots, &roots[0], input("My Note")).await.unwrap();
        assert!(same(&first, &root.join("my-note.md")));
        assert!(same(&second, &root.join("my-note-1.md")));

        let in_folder = CreateInput {
            folder: Some("sub/new"),
            body: Some("hello".into()),
            ..input("Doc")
        };
        let path = create(&rw(), ID, &roots, &roots[0], in_folder).await.unwrap();
        assert!(same(&path, &root.join("sub").join("new").join("doc.md")));
        let note = read(&rw(), ID, &roots, &path).await.unwrap();
        assert_eq!(note.body, "hello");
        assert_eq!(note.front_matter["title"], "Doc");
    }

    #[tokio::test]
    async fn update_then_read_returns_written_content() {
        let (_tmp, root, roots) = setup();
        fs::write(root.join("a.md"), "# old").unwrap();
        let path = s(&root.join("a.md"));
        let fm = json!({ "title": "T", "tags": ["x", "y"], "count": 3, "flag": true });

        let changed = update(&rw(), ID, &roots, &path, "# Hello\n\nworld", &fm).await.unwrap();
        assert!(changed.contains(&path.replace('\\', "/")));

        let note = read(&rw(), ID, &roots, &path).await.unwrap();
        assert_eq!(note.body, "# Hello\n\nworld");
        assert_eq!(Value::Object(note.front_matter), fm);
    }

    #[tokio::test]
    async fn missing_note_is_not_found() {
        let (_tmp, root, roots) = setup();
        let path = s(&root.join("none.md"));
        assert!(matches!(read(&rw(), ID, &roots, &path).await, Err(PluginError::NotFound { .. })));
        assert!(matches!(
            update(&rw(), ID, &roots, &path, "x", &json!({})).await,
            Err(PluginError::NotFound { .. })
        ));
        assert!(!root.join("none.md").exists());
    }

    #[tokio::test]
    async fn rename_rejects_existing_name_without_overwriting() {
        let (_tmp, root, roots) = setup();
        fs::write(root.join("a.md"), "---\ntitle: \"a\"\n---\nA").unwrap();
        fs::write(root.join("b.md"), "---\ntitle: \"b\"\n---\nB").unwrap();
        let a = s(&root.join("a.md"));

        assert!(matches!(
            rename(&rw(), ID, &roots, &a, "B").await,
            Err(PluginError::NameConflict { .. })
        ));
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "---\ntitle: \"a\"\n---\nA");
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "---\ntitle: \"b\"\n---\nB");

        let renamed = rename(&rw(), ID, &roots, &a, "C").await.unwrap();
        assert!(same(&renamed, &root.join("c.md")));
        assert!(!root.join("a.md").exists());

        // 同じ名前への変更はノートを失わない
        let again = rename(&rw(), ID, &roots, &renamed, "c").await.unwrap();
        assert!(same(&again, &root.join("c.md")));
    }

    #[tokio::test]
    async fn move_adds_sequence_number() {
        let (_tmp, root, roots) = setup();
        fs::write(root.join("x.md"), "root").unwrap();
        fs::write(root.join("sub").join("x.md"), "sub").unwrap();

        let moved = move_note(&rw(), ID, &roots, &roots[0], &s(&root.join("sub").join("x.md")), "")
            .await
            .unwrap();
        assert!(same(&moved, &root.join("x-1.md")));
        assert_eq!(fs::read_to_string(root.join("x.md")).unwrap(), "root");
        assert_eq!(fs::read_to_string(root.join("x-1.md")).unwrap(), "sub");
        assert!(!root.join("sub").join("x.md").exists());
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn delete_rejects_images_directory_links_outside_registered_roots() {
        let (tmp, root, roots) = setup();
        let outside = tmp.path().join("outside images");
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("note.md"), "body").unwrap();
        fs::write(outside.join("note_1_001.png"), "keep private image").unwrap();
        link_directory(&outside, &root.join("images"));
        let result = delete(&rw(), ID, &roots, &roots[0], &s(&root.join("note.md"))).await;
        assert!(matches!(result, Err(PluginError::OutOfScope { .. })), "{result:?}");
        assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "body");
        assert_eq!(fs::read_to_string(outside.join("note_1_001.png")).unwrap(), "keep private image");
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn delete_validates_each_linked_image_target_before_removing_the_note() {
        let (tmp, root, roots) = setup();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(root.join("images")).unwrap();
        fs::write(root.join("note.md"), "body").unwrap();
        fs::write(root.join("images/note_1_001.png"), "keep until validation succeeds").unwrap();
        fs::write(outside.join("private.png"), "private").unwrap();
        link_directory(&outside, &root.join("images").join("note_1_002.png"));
        let result = delete(&rw(), ID, &roots, &roots[0], &s(&root.join("note.md"))).await;
        assert!(matches!(result, Err(PluginError::OutOfScope { .. })), "{result:?}");
        assert!(root.join("note.md").exists());
        assert!(root.join("images/note_1_001.png").exists());
        assert_eq!(fs::read_to_string(outside.join("private.png")).unwrap(), "private");
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn delete_cleans_images_through_links_to_registered_roots() {
        for external in [false, true] {
            let (tmp, root, mut roots) = setup();
            let images = if external { tmp.path().join("other registered root") } else { root.join("assets") };
            fs::create_dir_all(&images).unwrap();
            if external { roots.push(s(&images)); }
            fs::write(root.join("note.md"), "body").unwrap();
            fs::write(images.join("note_1_001.png"), "associated").unwrap();
            fs::write(images.join("other_1_001.png"), "unrelated").unwrap();
            link_directory(&images, &root.join("images"));
            delete(&rw(), ID, &roots, &roots[0], &s(&root.join("note.md"))).await.unwrap();
            assert!(!root.join("note.md").exists());
            assert!(!images.join("note_1_001.png").exists());
            assert_eq!(fs::read_to_string(images.join("other_1_001.png")).unwrap(), "unrelated");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn delete_rejects_file_symlinks_to_unregistered_images() {
        let (tmp, root, roots) = setup();
        fs::create_dir_all(root.join("images")).unwrap();
        fs::write(root.join("note.md"), "body").unwrap();
        let outside = tmp.path().join("private.png");
        fs::write(&outside, "private").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("images/note_1_001.png")).unwrap();
        let result = delete(&rw(), ID, &roots, &roots[0], &s(&root.join("note.md"))).await;
        assert!(matches!(result, Err(PluginError::OutOfScope { .. })), "{result:?}");
        assert!(root.join("note.md").exists());
        assert_eq!(fs::read_to_string(outside).unwrap(), "private");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn delete_unlinks_in_scope_image_aliases_without_deleting_their_targets() {
        let (_tmp, root, roots) = setup();
        fs::create_dir_all(root.join("images")).unwrap();
        fs::write(root.join("note.md"), "body").unwrap();
        let target = root.join("images/other_1_001.png");
        fs::write(&target, "shared image").unwrap();
        let alias = root.join("images/note_1_001.png");
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        delete(&rw(), ID, &roots, &roots[0], &s(&root.join("note.md"))).await.unwrap();
        assert!(!alias.exists());
        assert_eq!(fs::read_to_string(target).unwrap(), "shared image");
    }

    #[tokio::test]
    async fn delete_removes_note_and_its_images() {
        let (_tmp, root, roots) = setup();
        fs::create_dir_all(root.join("images")).unwrap();
        fs::write(root.join("note.md"), "![](images/note_1_001.png)").unwrap();
        fs::write(root.join("images").join("note_1_001.png"), "png").unwrap();
        fs::write(root.join("images").join("other_1_001.png"), "png").unwrap();

        delete(&rw(), ID, &roots, &roots[0], &s(&root.join("note.md"))).await.unwrap();
        assert!(!root.join("note.md").exists());
        assert!(!root.join("images").join("note_1_001.png").exists());
        assert!(root.join("images").join("other_1_001.png").exists());
    }
}
