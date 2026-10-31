use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle};
use tauri_plugin_dialog::DialogExt;

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSaveResult {
    pub success: bool,
    pub relative_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub success: bool,
    pub deleted_files: Vec<String>,
    pub errors: Vec<String>,
}

const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn sanitize_note_basename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_whitespace() => '_',
            c => c,
        })
        .collect()
}

fn generate_image_filename(note_base: &str, extension: &str, seq: u32) -> String {
    let sanitized = sanitize_note_basename(note_base);
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}_{}_{:03}.{}", sanitized, now, seq, extension)
}

async fn ensure_images_dir(root_dir: &str) -> std::io::Result<PathBuf> {
    let images = PathBuf::from(root_dir).join("images");
    tokio::fs::create_dir_all(&images).await?;
    Ok(images)
}

async fn find_unique_filename(images_dir: &Path, note_base: &str, extension: &str) -> String {
    let mut seq = 1u32;
    loop {
        let name = generate_image_filename(note_base, extension, seq);
        if !images_dir.join(&name).exists() {
            return name;
        }
        seq += 1;
    }
}

fn parse_image_references(markdown: &str) -> Vec<String> {
    let mut refs = Vec::new();
    // ![alt](path)
    let mut rest = markdown;
    while let Some(start) = rest.find("![") {
        rest = &rest[start + 2..];
        if let Some(close_bracket) = rest.find("](") {
            rest = &rest[close_bracket + 2..];
            if let Some(close_paren) = rest.find(')') {
                refs.push(rest[..close_paren].to_string());
                rest = &rest[close_paren + 1..];
            }
        }
    }
    refs
}

// ---------------------------------------------------------------------------
// コマンド
// ---------------------------------------------------------------------------

#[command]
pub async fn save_image_from_file(
    root_dir: String,
    note_base_name: String,
    source_file_path: String,
) -> Result<ImageSaveResult, String> {
    let src = Path::new(&source_file_path);

    if !is_image_file(src) {
        return Ok(ImageSaveResult {
            success: false,
            relative_path: None,
            error: Some(format!("Unsupported image format: {:?}", src.extension())),
        });
    }

    let images_dir = match ensure_images_dir(&root_dir).await {
        Ok(d) => d,
        Err(e) => return Ok(ImageSaveResult {
            success: false,
            relative_path: None,
            error: Some(e.to_string()),
        }),
    };

    let ext = src.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let file_name = find_unique_filename(&images_dir, &note_base_name, &ext).await;
    let dest = images_dir.join(&file_name);

    match tokio::fs::copy(src, &dest).await {
        Ok(_) => Ok(ImageSaveResult {
            success: true,
            relative_path: Some(format!("images/{}", file_name)),
            error: None,
        }),
        Err(e) => Ok(ImageSaveResult {
            success: false,
            relative_path: None,
            error: Some(e.to_string()),
        }),
    }
}

#[command]
pub async fn save_image_from_buffer(
    root_dir: String,
    note_base_name: String,
    buffer: Vec<u8>,
    extension: String,
) -> Result<ImageSaveResult, String> {
    let ext = extension.to_lowercase();
    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return Ok(ImageSaveResult {
            success: false,
            relative_path: None,
            error: Some(format!("Unsupported image format: {}", extension)),
        });
    }

    let images_dir = match ensure_images_dir(&root_dir).await {
        Ok(d) => d,
        Err(e) => return Ok(ImageSaveResult {
            success: false,
            relative_path: None,
            error: Some(e.to_string()),
        }),
    };

    let file_name = find_unique_filename(&images_dir, &note_base_name, &ext).await;
    let dest = images_dir.join(&file_name);

    match tokio::fs::write(&dest, &buffer).await {
        Ok(_) => Ok(ImageSaveResult {
            success: true,
            relative_path: Some(format!("images/{}", file_name)),
            error: None,
        }),
        Err(e) => Ok(ImageSaveResult {
            success: false,
            relative_path: None,
            error: Some(e.to_string()),
        }),
    }
}

#[command]
pub async fn select_image_file(app: AppHandle) -> Result<Vec<String>, String> {
    let result = app.dialog()
        .file()
        .add_filter("画像", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .blocking_pick_files();

    Ok(result
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string().replace('\\', "/"))
        .collect())
}

#[command]
pub async fn cleanup_unused_images(
    root_dir: String,
    note_base_name: String,
    markdown_content: String,
) -> Result<CleanupResult, String> {
    let images_dir = PathBuf::from(&root_dir).join("images");
    let sanitized = sanitize_note_basename(&note_base_name);

    let all_files = match tokio::fs::read_dir(&images_dir).await {
        Ok(mut rd) => {
            let mut files = Vec::new();
            while let Ok(Some(entry)) = rd.next_entry().await {
                if let Some(name) = entry.file_name().to_str() {
                    files.push(name.to_string());
                }
            }
            files
        }
        Err(_) => return Ok(CleanupResult { success: true, deleted_files: vec![], errors: vec![] }),
    };

    let note_files: Vec<_> = all_files.iter()
        .filter(|f| f.starts_with(&format!("{}_", sanitized)))
        .cloned()
        .collect();

    if note_files.is_empty() {
        return Ok(CleanupResult { success: true, deleted_files: vec![], errors: vec![] });
    }

    let refs = parse_image_references(&markdown_content);
    let referenced: std::collections::HashSet<String> = refs.iter()
        .map(|p| Path::new(p).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string())
        .collect();

    let mut deleted = Vec::new();
    let mut errors = Vec::new();

    for file in &note_files {
        if referenced.contains(file.as_str()) { continue; }
        let path = images_dir.join(file);
        match tokio::fs::remove_file(&path).await {
            Ok(_) => deleted.push(file.clone()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", file, e)),
        }
    }

    Ok(CleanupResult { success: true, deleted_files: deleted, errors })
}

#[command]
pub async fn delete_note_images(
    root_dir: String,
    note_base_name: String,
) -> Result<CleanupResult, String> {
    Ok(delete_images_for_note(Path::new(&root_dir), &note_base_name).await)
}

/// `<root>/images` からノートに紐づく画像（`<sanitize(note_base_name)>_` で始まるファイル）を削除する。
/// `delete_note_images` と Plugin 用の `plugin_notes_delete` で共有する。
pub(crate) async fn delete_images_for_note(root: &Path, note_base_name: &str) -> CleanupResult {
    let images_dir = root.join("images");
    let sanitized = sanitize_note_basename(note_base_name);

    let all_files = match tokio::fs::read_dir(&images_dir).await {
        Ok(mut rd) => {
            let mut files = Vec::new();
            while let Ok(Some(entry)) = rd.next_entry().await {
                if let Some(name) = entry.file_name().to_str() {
                    files.push(name.to_string());
                }
            }
            files
        }
        Err(_) => return CleanupResult { success: true, deleted_files: vec![], errors: vec![] },
    };

    let note_files: Vec<_> = all_files.iter()
        .filter(|f| f.starts_with(&format!("{}_", sanitized)))
        .cloned()
        .collect();

    let mut deleted = Vec::new();
    let mut errors = Vec::new();

    for file in &note_files {
        let path = images_dir.join(file);
        match tokio::fs::remove_file(&path).await {
            Ok(_) => deleted.push(file.clone()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", file, e)),
        }
    }

    CleanupResult { success: true, deleted_files: deleted, errors }
}

/// 画像ファイルを読み込み、`data:{mime};base64,{data}` 形式の文字列を返す。
/// アセットプロトコルが利用できない環境向けのフォールバック用途。
#[command]
pub async fn read_image_as_base64(path: String) -> Result<String, String> {
    let p = Path::new(&path);

    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    };

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read image: {}", e))?;

    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

/// ルートディレクトリ全体を横断して全ノートの画像参照を収集し、
/// 参照されていない画像ファイルをすべて削除する。
/// Electron の `app.on('before-quit')` 相当の処理。
#[command]
pub async fn cleanup_all_unused_images(root_dir: String) -> Result<CleanupResult, String> {
    let root = PathBuf::from(&root_dir);
    let images_dir = root.join("images");

    // images/ ディレクトリが存在しなければ何もしない
    let all_image_files = match tokio::fs::read_dir(&images_dir).await {
        Ok(mut rd) => {
            let mut files = Vec::new();
            while let Ok(Some(entry)) = rd.next_entry().await {
                let path = entry.path();
                if is_image_file(&path) {
                    if let Some(name) = entry.file_name().to_str() {
                        files.push(name.to_string());
                    }
                }
            }
            files
        }
        Err(_) => return Ok(CleanupResult { success: true, deleted_files: vec![], errors: vec![] }),
    };

    if all_image_files.is_empty() {
        return Ok(CleanupResult { success: true, deleted_files: vec![], errors: vec![] });
    }

    // ルートディレクトリ配下の全 .md ファイルから画像参照を収集
    let referenced = collect_all_image_refs(&root).await;

    let mut deleted = Vec::new();
    let mut errors = Vec::new();

    for file in &all_image_files {
        if referenced.contains(file.as_str()) {
            continue;
        }
        let path = images_dir.join(file);
        match tokio::fs::remove_file(&path).await {
            Ok(_) => deleted.push(file.clone()),
            Err(e) => errors.push(format!("Failed to delete {}: {}", file, e)),
        }
    }

    Ok(CleanupResult { success: true, deleted_files: deleted, errors })
}

/// ディレクトリを再帰的に走査して全 .md ファイルの画像参照ファイル名を収集する。
async fn collect_all_image_refs(root: &Path) -> std::collections::HashSet<String> {
    let mut refs = std::collections::HashSet::new();
    collect_refs_in_dir(root, &mut refs).await;
    refs
}

fn collect_refs_in_dir<'a>(
    dir: &'a Path,
    refs: &'a mut std::collections::HashSet<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        let mut rd = match tokio::fs::read_dir(dir).await {
            Ok(rd) => rd,
            Err(_) => return,
        };

        while let Ok(Some(entry)) = rd.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                // images/ ディレクトリは再帰しない
                if path.file_name().and_then(|n| n.to_str()) == Some("images") {
                    continue;
                }
                collect_refs_in_dir(&path, refs).await;
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(content) = tokio::fs::read_to_string(&path).await {
                    for r in parse_image_references(&content) {
                        let file_name = Path::new(&r)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                        if !file_name.is_empty() {
                            refs.insert(file_name);
                        }
                    }
                }
            }
        }
    })
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_image_file() {
        assert!(is_image_file(Path::new("photo.png")));
        assert!(is_image_file(Path::new("photo.JPG")));
        assert!(!is_image_file(Path::new("note.md")));
        assert!(!is_image_file(Path::new("doc.pdf")));
    }

    #[test]
    fn test_sanitize_note_basename() {
        assert_eq!(sanitize_note_basename("my note"), "my_note");
        assert_eq!(sanitize_note_basename("file/name"), "file_name");
    }

    #[test]
    fn test_parse_image_references() {
        let md = "![img](images/foo.png) and ![](images/bar.jpg)";
        let refs = parse_image_references(md);
        assert_eq!(refs, vec!["images/foo.png", "images/bar.jpg"]);
    }
}
