use std::collections::HashMap;
use std::path::{Path, PathBuf};

use gray_matter::engine::YAML;
use gray_matter::{Matter, Pod};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::state::{AppState, WatcherHandle};

// ---------------------------------------------------------------------------
// 共有型定義
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownNoteMeta {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub relative_path: String,
    pub tags: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub name: String,
    pub relative_path: String,
    pub children: Vec<FolderNode>,
    pub notes: Vec<MarkdownNoteMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub meta: MarkdownNoteMeta,
    pub content: String,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub notes: Vec<MarkdownNoteMeta>,
    pub tree: FolderNode,
}

// ---------------------------------------------------------------------------
// アトミック書き込みユーティリティ
// ---------------------------------------------------------------------------

const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_MS: u64 = 200;

/// 対象ファイルと同じディレクトリに一時ファイルパスを生成する
/// 例: /path/to/notes/foo.md → /path/to/notes/.foo.md.notyra_tmp
fn temp_path_for(target: &Path) -> PathBuf {
    let file_name = target
        .file_name()
        .map(|n| format!(".{}.notyra_tmp", n.to_string_lossy()))
        .unwrap_or_else(|| ".notyra_tmp".to_string());
    target.with_file_name(file_name)
}

/// OS エラーコードがリトライ可能かどうかを判定する
/// - 1224: ERROR_USER_MAPPED_FILE（同期エージェントがメモリマップ中）
/// - 32:   ERROR_SHARING_VIOLATION（共有違反）
/// - 5:    ERROR_ACCESS_DENIED（一時的なロック）
fn is_retryable(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(1224) | Some(32) | Some(5))
        || e.kind() == std::io::ErrorKind::PermissionDenied
}

/// アトミックな書き込みを実行する。
/// 対象ファイルと同じディレクトリに一時ファイルを作成し、
/// rename でアトミックに差し替える。rename が一時的なロックエラーで
/// 失敗した場合は最大 MAX_RETRIES 回リトライする。
///
/// Preconditions:
///   - path の親ディレクトリが存在すること
///   - bytes は完全な書き込みコンテンツであること
///
/// Postconditions:
///   - Ok(()) の場合、path のコンテンツが bytes と一致する
///   - Ok(()) の場合、一時ファイルは存在しない
///   - Err の場合、path の元コンテンツは変更されていない
///   - Err の場合、一時ファイルの削除を試みている（ベストエフォート）
///
/// Invariants:
///   - 一時ファイルは必ず path の親ディレクトリに作成する
async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_path_for(path);

    // 一時ファイルへ書き込む
    if let Err(e) = tokio::fs::write(&tmp, bytes).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!(
            "一時ファイルへの書き込みに失敗しました: {}  ファイル: {}  (os error: {:?})",
            e,
            path.display(),
            e.raw_os_error()
        ));
    }

    // rename でアトミックに差し替え（リトライ付き）
    let mut retries = 0u32;
    loop {
        match tokio::fs::rename(&tmp, path).await {
            Ok(()) => return Ok(()),
            Err(e) if is_retryable(&e) && retries < MAX_RETRIES => {
                retries += 1;
                eprintln!(
                    "[notyra] 保存リトライ ({}/{}): {}  os error: {:?}",
                    retries,
                    MAX_RETRIES,
                    path.display(),
                    e.raw_os_error()
                );
                tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                let msg = format!(
                    "保存に失敗しました (リトライ回数: {}/{}): {}  ファイル: {}",
                    retries,
                    MAX_RETRIES,
                    e,
                    path.display()
                );
                eprintln!("[notyra] {}", msg);
                return Err(msg);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/// ファイル名の禁止文字を置換する
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_whitespace() => '-',
            c => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// 相対パスから ID を生成する
fn id_from_relative_path(relative: &str) -> String {
    relative.replace('\\', "/").trim_end_matches(".md").to_string()
}

/// ファイル先頭 16 KB を UTF-8 文字列として読み込む
async fn read_header(path: &Path) -> std::io::Result<String> {
    use tokio::io::AsyncReadExt;
    const HEADER: usize = 16384;
    let mut f = tokio::fs::File::open(path).await?;
    let mut buf = vec![0u8; HEADER];
    let n = f.read(&mut buf).await?;
    buf.truncate(n);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// ファイルからノートメタデータを抽出する
async fn get_note_meta(root: &Path, file_path: &Path) -> Option<MarkdownNoteMeta> {
    let header = read_header(file_path).await.ok()?;
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse::<Pod>(&header).ok()?;

    let relative = file_path.strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/");
    let excerpt = parsed.content.trim().chars().take(150).collect::<String>();
    let excerpt = if excerpt.is_empty() { None } else { Some(excerpt) };

    let data = parsed.data.as_ref();

    let get_str = |key: &str| -> Option<String> {
        data?.as_hashmap().ok()?.get(key)?.as_string().ok()
    };

    let get_vec = |key: &str| -> Vec<String> {
        let Some(pod) = data else { return vec![] };
        let Ok(map) = pod.as_hashmap() else { return vec![] };
        let Some(val) = map.get(key) else { return vec![] };
        let Ok(items) = val.as_vec() else { return vec![] };
        items.into_iter().filter_map(|v| v.as_string().ok()).collect()
    };

    let file_name = file_path.file_stem()?.to_string_lossy().to_string();
    let title = get_str("title").unwrap_or(file_name);
    let id = get_str("id").unwrap_or_else(|| id_from_relative_path(&relative));

    Some(MarkdownNoteMeta {
        id,
        title,
        file_path: file_path.to_string_lossy().replace('\\', "/"),
        relative_path: relative,
        tags: get_vec("tags"),
        created_at: get_str("createdAt"),
        updated_at: get_str("updatedAt"),
        excerpt,
    })
}

/// ディレクトリを再帰的に走査して .md ファイルのパスを収集する
fn collect_md_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_md_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            out.push(path);
        }
    }
}

/// フォルダツリーを構築する
fn build_folder_tree_from_notes(root: &Path, notes: &[MarkdownNoteMeta]) -> FolderNode {
    let root_name = root.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let mut folder_map: HashMap<String, FolderNode> = HashMap::new();

    // ルートノードを挿入
    folder_map.insert(String::new(), FolderNode {
        name: root_name,
        relative_path: String::new(),
        children: Vec::new(),
        notes: Vec::new(),
    });

    // ディレクトリ構造を走査してフォルダノードを作成
    scan_dirs_for_tree(root, root, &mut folder_map);

    // ノートを各フォルダに配置
    for note in notes {
        let dir = {
            let p = Path::new(&note.relative_path);
            p.parent().and_then(|d| {
                let s = d.to_string_lossy().replace('\\', "/");
                if s == "." || s.is_empty() { None } else { Some(s) }
            }).unwrap_or_default()
        };
        if let Some(folder) = folder_map.get_mut(&dir) {
            folder.notes.push(note.clone());
        }
    }

    // HashMap をツリーに組み立てる（葉から根へ）
    assemble_tree(&mut folder_map, "")
}

fn scan_dirs_for_tree(root: &Path, current: &Path, folder_map: &mut HashMap<String, FolderNode>) {
    let Ok(entries) = std::fs::read_dir(current) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }

        let rel = path.strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        // images ディレクトリはスキップ
        if current == root && rel == "images" { continue; }

        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        folder_map.entry(rel.clone()).or_insert_with(|| FolderNode {
            name,
            relative_path: rel.clone(),
            children: Vec::new(),
            notes: Vec::new(),
        });

        scan_dirs_for_tree(root, &path, folder_map);
    }
}

fn assemble_tree(folder_map: &mut HashMap<String, FolderNode>, key: &str) -> FolderNode {
    let mut node = folder_map.remove(key).unwrap_or_else(|| FolderNode {
        name: String::new(),
        relative_path: key.to_string(),
        children: Vec::new(),
        notes: Vec::new(),
    });

    // このノードの子を特定する
    let child_keys: Vec<String> = folder_map.keys()
        .filter(|k| {
            let parent = Path::new(k).parent()
                .map(|p| {
                    let s = p.to_string_lossy().replace('\\', "/");
                    if s == "." || s.is_empty() { String::new() } else { s }
                })
                .unwrap_or_default();
            parent.as_str() == key
        })
        .cloned()
        .collect();

    for child_key in child_keys {
        let child = assemble_tree(folder_map, &child_key);
        node.children.push(child);
    }

    node.children.sort_by(|a, b| a.name.cmp(&b.name));
    node
}

// ---------------------------------------------------------------------------
// Tauri コマンド: ルートフォルダ選択・存在確認・スキャン
// ---------------------------------------------------------------------------

#[command]
pub async fn select_root_folder(app: AppHandle) -> Result<Option<String>, String> {
    let result = app.dialog()
        .file()
        .blocking_pick_folder();

    Ok(result.map(|p| p.to_string().replace('\\', "/")))
}

#[command]
pub async fn check_root_exists(root_dir: String) -> bool {
    Path::new(&root_dir).is_dir()
}

#[command]
pub async fn scan_notes_and_build_folder_tree(root_dir: String) -> Result<ScanResult, String> {
    let root = Path::new(&root_dir).to_path_buf();

    // .md ファイルを収集
    let mut file_paths: Vec<PathBuf> = Vec::new();
    collect_md_files(&root, &mut file_paths);

    // 並列でメタデータを取得
    let root_clone = root.clone();
    let tasks: Vec<_> = file_paths.into_iter().map(|p| {
        let r = root_clone.clone();
        tokio::spawn(async move { get_note_meta(&r, &p).await })
    }).collect();

    let mut notes: Vec<MarkdownNoteMeta> = Vec::new();
    for task in tasks {
        if let Ok(Some(meta)) = task.await {
            notes.push(meta);
        }
    }

    // updatedAt 降順でソート
    notes.sort_by(|a, b| {
        b.updated_at.as_deref().unwrap_or("").cmp(a.updated_at.as_deref().unwrap_or(""))
    });

    let tree = build_folder_tree_from_notes(&root, &notes);

    Ok(ScanResult { notes, tree })
}

// ---------------------------------------------------------------------------
// Tauri コマンド: CRUD
// ---------------------------------------------------------------------------

#[command]
pub async fn get_note_content(file_path: String) -> Result<Option<NoteContent>, String> {
    let path = Path::new(&file_path);
    let raw = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| e.to_string())?;

    let matter = Matter::<YAML>::new();
    let parsed = matter.parse::<Pod>(&raw)
        .map_err(|e| format!("フロントマターの解析に失敗しました: {}", e))?;

    let relative = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let title = if let Some(pod) = parsed.data.as_ref() {
        if let Ok(map) = pod.as_hashmap() {
            if let Some(val) = map.get("title") {
                val.as_string().ok()
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    }
    .unwrap_or_else(|| path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string());

    let meta = MarkdownNoteMeta {
        id: id_from_relative_path(&relative),
        title,
        file_path: file_path.replace('\\', "/"),
        relative_path: relative,
        tags: Vec::new(),
        created_at: None,
        updated_at: None,
        excerpt: None,
    };

    Ok(Some(NoteContent {
        meta,
        content: parsed.content,
        raw_content: raw,
    }))
}

#[command]
pub async fn save_note(
    file_path: String,
    content: String,
    front_matter: Option<serde_json::Value>,
) -> Result<bool, String> {
    let file_content = if let Some(fm) = front_matter {
        // フロントマターを YAML に変換して結合
        let yaml = serde_yaml_from_value(&fm);
        format!("---\n{}---\n{}", yaml, content)
    } else {
        content
    };

    atomic_write(Path::new(&file_path), file_content.as_bytes())
        .await
        .map(|_| true)
}

fn serde_yaml_from_value(v: &serde_json::Value) -> String {
    // 簡易 YAML シリアライズ（フロントマター用）
    match v {
        serde_json::Value::Object(map) => {
            map.iter()
                .map(|(k, v)| {
                    let val = match v {
                        serde_json::Value::String(s) => format!("\"{}\"", s.replace('"', "\\\"")),
                        serde_json::Value::Array(arr) => {
                            if arr.is_empty() {
                                "[]".to_string()
                            } else {
                                let items = arr.iter()
                                    .map(|i| format!("  - {}", i.as_str().unwrap_or("")))
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                format!("\n{}", items)
                            }
                        }
                        other => other.to_string(),
                    };
                    format!("{}: {}\n", k, val)
                })
                .collect()
        }
        _ => String::new(),
    }
}

#[command]
pub async fn create_note(
    root_dir: String,
    folder_path: String,
    title: String,
) -> Result<Option<String>, String> {
    let base_name = sanitize_filename(&title);
    let target_dir = if folder_path.is_empty() {
        PathBuf::from(&root_dir)
    } else {
        PathBuf::from(&root_dir).join(&folder_path)
    };

    tokio::fs::create_dir_all(&target_dir).await.map_err(|e| e.to_string())?;

    // 重複ファイル名に連番を付加
    let mut file_path = target_dir.join(format!("{}.md", base_name));
    let mut counter = 1u32;
    while file_path.exists() {
        file_path = target_dir.join(format!("{}-{}.md", base_name, counter));
        counter += 1;
    }

    let now = chrono_now();
    let content = format!(
        "---\ntitle: \"{}\"\ncreatedAt: \"{}\"\nupdatedAt: \"{}\"\ntags: []\n---\n# {}\n\n",
        title, now, now, title
    );

    atomic_write(&file_path, content.as_bytes()).await?;

    Ok(Some(file_path.to_string_lossy().replace('\\', "/").to_string()))
}

#[command]
pub async fn rename_note(old_path: String, new_title: String) -> Result<Option<String>, String> {
    let old = Path::new(&old_path);
    let dir = old.parent().ok_or("parent dir not found")?;
    let new_name = format!("{}.md", sanitize_filename(&new_title));
    let new_path = dir.join(&new_name);

    let raw = tokio::fs::read_to_string(old).await.map_err(|e| e.to_string())?;
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse::<Pod>(&raw)
        .map_err(|e| format!("フロントマターの解析に失敗しました: {}", e))?;

    let now = chrono_now();
    // フロントマターの title と updatedAt を更新
    let new_content = update_front_matter(&raw, &parsed.content, &new_title, &now);

    atomic_write(&new_path, new_content.as_bytes()).await?;

    if old_path != new_path.to_string_lossy() {
        tokio::fs::remove_file(old).await.map_err(|e| e.to_string())?;
    }

    Ok(Some(new_path.to_string_lossy().replace('\\', "/").to_string()))
}

fn update_front_matter(raw: &str, body: &str, title: &str, updated_at: &str) -> String {
    // 既存のフロントマターを更新する
    if let Some(stripped) = raw.strip_prefix("---") {
        if let Some(end) = stripped.find("---") {
            let fm_block = &stripped[..end];
            // title と updatedAt だけ置換
            let new_fm = fm_block
                .lines()
                .map(|line| {
                    if line.starts_with("title:") {
                        format!("title: \"{}\"", title)
                    } else if line.starts_with("updatedAt:") {
                        format!("updatedAt: \"{}\"", updated_at)
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            return format!("---\n{}---\n{}", new_fm, body);
        }
    }
    // フロントマターがない場合は新規作成
    format!(
        "---\ntitle: \"{}\"\nupdatedAt: \"{}\"\n---\n{}",
        title, updated_at, body
    )
}

#[command]
pub async fn delete_note(file_path: String) -> Result<bool, String> {
    tokio::fs::remove_file(&file_path)
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn move_note(
    root_dir: String,
    current_file_path: String,
    target_folder: String,
) -> Result<Option<String>, String> {
    let src = Path::new(&current_file_path);
    let target_dir = if target_folder.is_empty() {
        PathBuf::from(&root_dir)
    } else {
        PathBuf::from(&root_dir).join(&target_folder)
    };

    tokio::fs::create_dir_all(&target_dir).await.map_err(|e| e.to_string())?;

    let file_name = src.file_name().ok_or("invalid file name")?;
    let mut dest = target_dir.join(file_name);

    // 同じ場所への移動はスキップ
    if src == dest.as_path() {
        return Ok(Some(current_file_path));
    }

    // 重複名の解決
    let base = src.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let mut counter = 1u32;
    while dest.exists() {
        dest = target_dir.join(format!("{}-{}.md", base, counter));
        counter += 1;
    }

    tokio::fs::copy(src, &dest).await.map_err(|e| e.to_string())?;
    tokio::fs::remove_file(src).await.map_err(|e| e.to_string())?;

    Ok(Some(dest.to_string_lossy().replace('\\', "/").to_string()))
}

// ---------------------------------------------------------------------------
// Tauri コマンド: フォルダ操作
// ---------------------------------------------------------------------------

#[command]
pub async fn create_folder(root_dir: String, folder_path: String) -> Result<bool, String> {
    let target = PathBuf::from(&root_dir).join(&folder_path);
    tokio::fs::create_dir_all(&target)
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_folder(root_dir: String, folder_path: String) -> Result<bool, String> {
    let target = PathBuf::from(&root_dir).join(&folder_path);
    tokio::fs::remove_dir_all(&target)
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri コマンド: ファイル監視
// ---------------------------------------------------------------------------

#[command]
pub async fn watch_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<bool, String> {
    let mut watchers = state.watchers.lock();

    // 既に監視中の場合はスキップ
    if watchers.contains_key(&file_path) {
        return Ok(true);
    }

    let app_clone = app.clone();
    let path_clone = file_path.clone();
    let path_clone2 = file_path.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Modify(_)) {
                let _ = app_clone.emit("file-changed", &path_clone);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&file_path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    watchers.insert(
        path_clone2,
        WatcherHandle {
            _watcher: Box::new(watcher),
        },
    );

    Ok(true)
}

#[command]
pub async fn unwatch_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<bool, String> {
    let mut watchers = state.watchers.lock();
    watchers.remove(&file_path);
    Ok(true)
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

fn chrono_now() -> String {
    // ISO 8601 形式の現在時刻（UTC）
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| {
            let secs = d.as_secs();
            let (y, mo, day, h, mi, s) = epoch_to_ymd_hms(secs);
            format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, mo, day, h, mi, s)
        })
        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".to_string())
}

fn epoch_to_ymd_hms(epoch: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = epoch % 60;
    let mi = (epoch / 60) % 60;
    let h = (epoch / 3600) % 24;
    let days = epoch / 86400;
    // ユリウス日計算（簡易版）
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, day, h, mi, s)
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // atomic_write ユーティリティのテスト
    // -----------------------------------------------------------------------

    #[test]
    fn test_temp_path_for_standard() {
        let target = Path::new("/path/to/notes/foo.md");
        let tmp = temp_path_for(target);
        assert_eq!(tmp, Path::new("/path/to/notes/.foo.md.notyra_tmp"));
    }

    #[test]
    fn test_temp_path_for_nested() {
        let target = Path::new("/a/b/c/note.md");
        let tmp = temp_path_for(target);
        assert_eq!(tmp, Path::new("/a/b/c/.note.md.notyra_tmp"));
    }

    #[test]
    fn test_is_retryable_error_1224() {
        let e = std::io::Error::from_raw_os_error(1224);
        assert!(is_retryable(&e), "error 1224 (ERROR_USER_MAPPED_FILE) はリトライ可能");
    }

    #[test]
    fn test_is_retryable_error_32() {
        let e = std::io::Error::from_raw_os_error(32);
        assert!(is_retryable(&e), "error 32 (ERROR_SHARING_VIOLATION) はリトライ可能");
    }

    #[test]
    fn test_is_retryable_error_5() {
        let e = std::io::Error::from_raw_os_error(5);
        assert!(is_retryable(&e), "error 5 (ERROR_ACCESS_DENIED) はリトライ可能");
    }

    #[test]
    fn test_is_retryable_permission_denied() {
        let e = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "permission denied");
        assert!(is_retryable(&e), "PermissionDenied はリトライ可能");
    }

    #[test]
    fn test_is_retryable_not_found_is_false() {
        let e = std::io::Error::from_raw_os_error(2); // ERROR_FILE_NOT_FOUND
        assert!(!is_retryable(&e), "error 2 (NOT FOUND) はリトライ不可");
    }

    #[test]
    fn test_is_retryable_other_error_is_false() {
        let e = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        assert!(!is_retryable(&e), "NotFound はリトライ不可");
    }

    #[tokio::test]
    async fn test_atomic_write_success_no_temp_file() {
        let dir = std::env::temp_dir().join(format!("notyra_test_{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let target = dir.join("test_atomic.md");
        let bytes = b"hello atomic world";

        atomic_write(&target, bytes).await.expect("atomic_write should succeed");

        // ターゲットファイルの内容が正しいことを確認
        let written = tokio::fs::read(&target).await.unwrap();
        assert_eq!(written, bytes);

        // 一時ファイルが残存していないことを確認
        let tmp = temp_path_for(&target);
        assert!(!tmp.exists(), "一時ファイルが残存していてはならない");

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn test_atomic_write_write_failure_does_not_touch_original() {
        let dir = std::env::temp_dir().join(format!("notyra_test2_{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        // 既存の元ファイルを作成しておく
        let target = dir.join("original.md");
        let original_bytes = b"original content";
        tokio::fs::write(&target, original_bytes).await.unwrap();

        // 存在しない親ディレクトリへの書き込みはエラーになる
        let bad_target = dir.join("nonexistent_subdir").join("fail.md");
        let result = atomic_write(&bad_target, b"new content").await;
        assert!(result.is_err(), "存在しないパスへの書き込みは失敗するべき");

        // 元ファイルは変更されていないことを確認
        let after = tokio::fs::read(&target).await.unwrap();
        assert_eq!(after, original_bytes, "元ファイルの内容は変更されていてはならない");

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    // -----------------------------------------------------------------------
    // 既存のテスト
    // -----------------------------------------------------------------------

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("Hello World"), "hello-world");
        assert_eq!(sanitize_filename("file/name:test"), "file-name-test");
        assert_eq!(sanitize_filename("note<>|?*"), "note-----");
    }

    #[test]
    fn test_id_from_relative_path() {
        assert_eq!(id_from_relative_path("notes/hello.md"), "notes/hello");
        assert_eq!(id_from_relative_path("hello.md"), "hello");
    }

    #[test]
    fn test_chrono_now_format() {
        let ts = chrono_now();
        assert!(ts.ends_with('Z'), "timestamp should end with Z: {}", ts);
        assert_eq!(ts.len(), 24, "ISO 8601 length: {}", ts);
    }

    #[test]
    fn test_update_front_matter_with_existing() {
        let raw = "---\ntitle: \"old\"\nupdatedAt: \"2020\"\ntags: []\n---\nbody";
        let result = update_front_matter(raw, "body", "new title", "2026");
        assert!(result.contains("title: \"new title\""));
        assert!(result.contains("updatedAt: \"2026\""));
    }

    async fn create_front_matter_test_note(name: &str, raw: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "notyra_front_matter_{}_{}", std::process::id(), name
        ));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("note.md");
        tokio::fs::write(&path, raw).await.unwrap();
        (dir, path)
    }

    #[tokio::test]
    async fn test_read_note_with_front_matter() {
        let raw = "---\nid: note-id\ntitle: Note title\ntags: [work, ideas]\ncreatedAt: '2026-01-01'\nupdatedAt: '2026-01-02'\n---\n# Body";
        let (dir, path) = create_front_matter_test_note("valid", raw).await;

        let meta = get_note_meta(&dir, &path).await.unwrap();
        assert_eq!(meta.id, "note-id");
        assert_eq!(meta.title, "Note title");
        assert_eq!(meta.tags, vec!["work", "ideas"]);
        assert_eq!(meta.created_at.as_deref(), Some("2026-01-01"));
        assert_eq!(meta.updated_at.as_deref(), Some("2026-01-02"));
        assert_eq!(meta.excerpt.as_deref(), Some("# Body"));

        let note = get_note_content(path.to_string_lossy().into_owned()).await.unwrap().unwrap();
        assert_eq!(note.meta.title, "Note title");
        assert_eq!(note.content, "# Body");
        assert_eq!(note.raw_content, raw);
        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }

    #[tokio::test]
    async fn test_read_note_without_front_matter() {
        let (dir, path) = create_front_matter_test_note("plain", "# Plain note").await;

        let meta = get_note_meta(&dir, &path).await.unwrap();
        assert_eq!(meta.title, "note");
        assert!(meta.tags.is_empty());
        let note = get_note_content(path.to_string_lossy().into_owned()).await.unwrap().unwrap();
        assert_eq!(note.content, "# Plain note");
        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }

    #[tokio::test]
    async fn test_invalid_front_matter_returns_error_without_modifying_note() {
        let raw = "---\ntitle: [unterminated\n---\n# Body";
        let (dir, path) = create_front_matter_test_note("invalid", raw).await;

        assert!(get_note_meta(&dir, &path).await.is_none());
        let file_path = path.to_string_lossy().into_owned();
        assert!(get_note_content(file_path.clone()).await.is_err());
        assert!(rename_note(file_path, "New title".to_string()).await.is_err());
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), raw);
        assert!(!dir.join("new-title.md").exists());
        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }
}
