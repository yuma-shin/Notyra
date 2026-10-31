//! PackageFetcher: GitHub の Latest_Release から Plugin_Package を取得し、安全に展開する。
//!
//! 流れ（Requirement 3.3〜3.8、10.3、10.5）:
//! 1. `GET /repos/{owner}/{repo}`（404 → `RepoNotFound`）
//! 2. `GET /repos/{owner}/{repo}/releases/latest`（404 → `NoRelease`。プレリリース・ドラフトは返らない）
//! 3. ID 指定時は `<id>.zip`、なければ従来の `notyra-plugin.zip` を選択（なし → `NoPackage`）
//! 4. `staging/<id>.zip` へストリームでダウンロード（20MB 上限）
//! 5. `staging/<id>/` へ展開（zip-slip・シンボリックリンク拒否、展開後 100MB・10,000 エントリ上限）
//!
//! 失敗時は `staging/<id>/` と `staging/<id>.zip` を削除してからエラーを返す（Requirement 3.16、3.17）。
//! 成功時も一時 zip は削除し、`staging/<id>/` には Plugin_Package の中身だけが残る。

use super::error::PluginError;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::fs::{self, File, OpenOptions};
use std::hash::{BuildHasher, Hasher};
use std::io::{self, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// GitHub API のベース URL（未認証で利用する）
const GITHUB_API_BASE: &str = "https://api.github.com";
/// Latest_Release から取得するアセット名
pub const PACKAGE_ASSET_NAME: &str = "notyra-plugin.zip";
/// Plugin_Package（zip）のサイズ上限（決定 #16）
pub const MAX_PACKAGE_BYTES: u64 = 20 * 1024 * 1024;
/// 展開後の合計サイズ上限（決定 #16）
pub const MAX_EXTRACTED_BYTES: u64 = 100 * 1024 * 1024;
/// zip のエントリ数上限
pub const MAX_ZIP_ENTRIES: usize = 10_000;
/// GitHub 通信1回あたりのタイムアウト（接続から本文の受信完了まで。決定 #16）
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Plugin_Package のルートに必須のマニフェスト
const MANIFEST_FILE: &str = "package.json";

const USER_AGENT: &str = concat!("Notyra/", env!("CARGO_PKG_VERSION"));

/// `fetch_latest_package` の結果。`staging_id` は `staging/<staging_id>/` を指す。
/// `plugin_fetch_release` の戻り値として `{ stagingId, packageJson, tag }` にシリアライズする。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedPackage {
    pub staging_id: String,
    pub package_json: String,
    pub tag: String,
}

/// 展開時の上限値
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtractLimits {
    /// 実際に書き出したバイト数の合計の上限（ヘッダのサイズは信用しない）
    pub max_total_bytes: u64,
    pub max_entries: usize,
}

impl Default for ExtractLimits {
    fn default() -> Self {
        Self {
            max_total_bytes: MAX_EXTRACTED_BYTES,
            max_entries: MAX_ZIP_ENTRIES,
        }
    }
}

/// どの GitHub 要求に対する応答か（404 の意味が段階ごとに異なる）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GithubStage {
    /// `GET /repos/{owner}/{repo}`
    Repo,
    /// `GET /repos/{owner}/{repo}/releases/latest`
    Release,
    /// アセットのダウンロード
    Asset,
}

/// GitHub の HTTP ステータスを `PluginError` に対応付ける純粋関数。
///
/// - 2xx → `Ok(())`
/// - 403 かつ `x-ratelimit-remaining: 0`、または 429 → `RateLimited`（`x-ratelimit-reset` を UNIX 秒として保持）
/// - 404 → 段階ごとに `RepoNotFound` / `NoRelease` / `NoPackage`
/// - 5xx、その他 → `Network`
pub fn map_github_status(
    stage: GithubStage,
    status: u16,
    rate_limit_remaining: Option<&str>,
    rate_limit_reset: Option<&str>,
) -> Result<(), PluginError> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let reset_at = || rate_limit_reset.and_then(|s| s.trim().parse::<u64>().ok());
    let exhausted = rate_limit_remaining.is_some_and(|s| s.trim() == "0");
    if status == 429 || (status == 403 && exhausted) {
        return Err(PluginError::RateLimited {
            reset_at: reset_at(),
        });
    }
    if status == 404 {
        return Err(match stage {
            GithubStage::Repo => PluginError::RepoNotFound,
            GithubStage::Release => PluginError::NoRelease,
            GithubStage::Asset => PluginError::NoPackage,
        });
    }
    let message = if (500..600).contains(&status) {
        format!("GitHub server error (HTTP {status})")
    } else {
        format!("unexpected response from GitHub (HTTP {status})")
    };
    Err(PluginError::Network { message })
}

/// GitHub の owner / repo の文字種を検証する（URL を組み立てる前の防御）。
///
/// owner: 英数字と `-`（1〜39文字）。repo: 英数字と `.` `_` `-`（1〜100文字、`.` / `..` 不可）。
/// 不正な指定はそのようなリポジトリが存在し得ないため `RepoNotFound` とする。
pub fn validate_repo_spec(owner: &str, repo: &str) -> Result<(), PluginError> {
    let owner_ok = !owner.is_empty()
        && owner.len() <= 39
        && owner.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    let repo_ok = !repo.is_empty()
        && repo.len() <= 100
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if owner_ok && repo_ok {
        Ok(())
    } else {
        Err(PluginError::RepoNotFound)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseInfo {
    pub tag_name: String,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

/// Latest_Release から `notyra-plugin.zip` を選ぶ。なければ `NoPackage`、
/// 申告サイズが上限を超えていれば `TooLarge`（実サイズはダウンロード時にも検査する）。
pub fn select_package_asset(release: &ReleaseInfo) -> Result<&ReleaseAsset, PluginError> {
    select_package_asset_for_plugin(release, None)
}

/// 同一リポジトリの複数プラグインを ID ごとに選択する。従来形式にも対応する。
pub fn select_package_asset_for_plugin<'a>(
    release: &'a ReleaseInfo,
    plugin_id: Option<&str>,
) -> Result<&'a ReleaseAsset, PluginError> {
    if plugin_id.is_some_and(|id| !super::store::is_valid_plugin_id(id)) {
        return Err(PluginError::InvalidArgument {
            message: "invalid plugin ID for release asset".into(),
        });
    }
    let named = plugin_id.map(|id| format!("{id}.zip"));
    let asset = release
        .assets
        .iter()
        .find(|a| named.as_deref() == Some(a.name.as_str()))
        .or_else(|| release.assets.iter().find(|a| a.name == PACKAGE_ASSET_NAME))
        .ok_or(PluginError::NoPackage)?;
    if asset.size > MAX_PACKAGE_BYTES {
        return Err(PluginError::TooLarge);
    }
    Ok(asset)
}

/// GitHub 通信用のクライアント（User-Agent と 30 秒のタイムアウトを設定）
pub fn github_client() -> Result<reqwest::Client, PluginError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(network_error)
}

/// Latest_Release の Plugin_Package を取得し、`staging_root/<staging_id>/` に展開する。
pub async fn fetch_latest_package(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    plugin_id: Option<&str>,
    staging_root: &Path,
) -> Result<FetchedPackage, PluginError> {
    validate_repo_spec(owner, repo)?;

    // 1. リポジトリの存在確認（404 を「リリースなし」と区別するため）
    let repo_url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}");
    send_checked(api_get(client, &repo_url), GithubStage::Repo).await?;

    // 2. Latest_Release
    let release_url = format!("{repo_url}/releases/latest");
    let release: ReleaseInfo = send_checked(api_get(client, &release_url), GithubStage::Release)
        .await?
        .json()
        .await
        .map_err(|e| PluginError::Network {
            message: format!("invalid release response from GitHub: {e}"),
        })?;

    // 3. アセットの選択
    let asset = match plugin_id {
        Some(id) => select_package_asset_for_plugin(&release, Some(id))?,
        None => select_package_asset(&release)?,
    };
    let download_url = validate_download_url(&asset.browser_download_url)?;

    // 4〜5. staging への取得と展開（失敗時は staging を削除）
    fs::create_dir_all(staging_root)?;
    let (staging_id, staging_dir) = create_staging_dir(staging_root)?;
    let zip_path = staging_root.join(format!("{staging_id}.zip"));

    let result = download_and_extract(client, download_url, &zip_path, &staging_dir).await;
    remove_file_best_effort(&zip_path);

    match result {
        Ok(package_json) => Ok(FetchedPackage {
            staging_id,
            package_json,
            tag: release.tag_name,
        }),
        Err(e) => {
            remove_dir_best_effort(&staging_dir);
            Err(e)
        }
    }
}

async fn download_and_extract(
    client: &reqwest::Client,
    url: url::Url,
    zip_path: &Path,
    staging_dir: &Path,
) -> Result<String, PluginError> {
    let request = client
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .timeout(REQUEST_TIMEOUT);
    let response = send_checked(request, GithubStage::Asset).await?;
    download_to_file(response, zip_path, MAX_PACKAGE_BYTES).await?;

    let zip = zip_path.to_path_buf();
    let dest = staging_dir.to_path_buf();
    tokio::task::spawn_blocking(move || extract_zip_safely(&zip, &dest, ExtractLimits::default()))
        .await
        .map_err(|e| PluginError::Io {
            message: format!("extraction task failed: {e}"),
        })??;

    read_manifest(staging_dir)
}

/// 応答本文をストリームでファイルに書き出す。`max_bytes` を超えた時点で `TooLarge`。
async fn download_to_file(
    mut response: reqwest::Response,
    path: &Path,
    max_bytes: u64,
) -> Result<(), PluginError> {
    use tokio::io::AsyncWriteExt;

    if response.content_length().is_some_and(|len| len > max_bytes) {
        return Err(PluginError::TooLarge);
    }
    let mut file = tokio::fs::File::create(path).await?;
    let mut total: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        total += chunk.len() as u64;
        if total > max_bytes {
            return Err(PluginError::TooLarge);
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    Ok(())
}

fn api_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(REQUEST_TIMEOUT)
}

async fn send_checked(
    request: reqwest::RequestBuilder,
    stage: GithubStage,
) -> Result<reqwest::Response, PluginError> {
    let response = request.send().await.map_err(network_error)?;
    {
        let headers = response.headers();
        let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
        map_github_status(
            stage,
            response.status().as_u16(),
            header("x-ratelimit-remaining"),
            header("x-ratelimit-reset"),
        )?;
    }
    Ok(response)
}

fn network_error(e: reqwest::Error) -> PluginError {
    PluginError::Network {
        message: e.to_string(),
    }
}

/// アセットのダウンロード URL は HTTPS のみ受け付ける
fn validate_download_url(raw: &str) -> Result<url::Url, PluginError> {
    match url::Url::parse(raw) {
        Ok(u) if u.scheme() == "https" && u.host_str().is_some() => Ok(u),
        _ => Err(PluginError::Network {
            message: format!("unexpected asset download URL: {raw}"),
        }),
    }
}

/// 展開済みディレクトリのルートの `package.json` を読む
fn read_manifest(dir: &Path) -> Result<String, PluginError> {
    match fs::read_to_string(dir.join(MANIFEST_FILE)) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(PluginError::ManifestMissing),
        Err(e) if e.kind() == io::ErrorKind::InvalidData => Err(PluginError::InvalidZip {
            message: "package.json is not valid UTF-8".into(),
        }),
        Err(e) => Err(e.into()),
    }
}

// ---------------------------------------------------------------------------
// staging ID
// ---------------------------------------------------------------------------

/// staging ID を生成する（時刻 + プロセス内カウンタ + `RandomState` のランダム鍵によるハッシュ）。
/// 形式は `<16進の時刻>-<16桁の16進>`。
fn new_staging_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(nanos);
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    hasher.write_u32(std::process::id());
    format!("{:x}-{:016x}", nanos, hasher.finish())
}

/// staging ID の形式検査（コマンド引数から staging パスを組み立てる前に使う）
pub fn is_valid_staging_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'-'))
}

/// `staging_root/<id>/` を新規作成する（既存のディレクトリは使わない）
fn create_staging_dir(staging_root: &Path) -> Result<(String, PathBuf), PluginError> {
    let mut last_err = None;
    for _ in 0..8 {
        let id = new_staging_id();
        let dir = staging_root.join(&id);
        match fs::create_dir(&dir) {
            Ok(()) => return Ok((id, dir)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => last_err = Some(e),
            Err(e) => return Err(e.into()),
        }
    }
    Err(last_err
        .map(PluginError::from)
        .unwrap_or_else(|| PluginError::Io {
            message: "failed to create staging directory".into(),
        }))
}

fn remove_dir_best_effort(dir: &Path) {
    if let Err(e) = fs::remove_dir_all(dir) {
        if e.kind() != io::ErrorKind::NotFound {
            eprintln!("[plugins] failed to remove staging dir {}: {e}", dir.display());
        }
    }
}

fn remove_file_best_effort(path: &Path) {
    if let Err(e) = fs::remove_file(path) {
        if e.kind() != io::ErrorKind::NotFound {
            eprintln!("[plugins] failed to remove {}: {e}", path.display());
        }
    }
}

// ---------------------------------------------------------------------------
// zip 展開
// ---------------------------------------------------------------------------

fn invalid_zip(message: impl ToString) -> PluginError {
    PluginError::InvalidZip {
        message: message.to_string(),
    }
}

/// エントリ名が絶対パス（`/x`、`\x`、`C:x`）か。
/// `enclosed_name()` は先頭のルートを取り除いて相対パスとして扱うため、別途拒否する。
fn is_absolute_entry_name(name: &str) -> bool {
    let b = name.as_bytes();
    name.starts_with('/')
        || name.starts_with('\\')
        || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
}

/// zip を `dest` に安全に展開する。
///
/// - 絶対パス、`..` で外に出るパス（`enclosed_name()` が `None`）、シンボリックリンクのエントリは
///   全体を失敗にする（`InvalidZip`）
/// - エントリ数が `max_entries` を超える、または実際に書き出したバイト数の合計が
///   `max_total_bytes` を超えた時点で中止する（`TooLarge`）
/// - ルートに `package.json`（ファイル）がなければ `ManifestMissing`
///
/// 失敗時に `dest` 内に途中まで書き出したファイルが残る。`dest` の削除は呼び出し側が行う。
pub fn extract_zip_safely(
    zip_path: &Path,
    dest: &Path,
    limits: ExtractLimits,
) -> Result<(), PluginError> {
    let file = File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file)).map_err(invalid_zip)?;
    if archive.has_duplicate_names() {
        return Err(invalid_zip("duplicate entry names"));
    }
    if archive.len() > limits.max_entries {
        return Err(PluginError::TooLarge);
    }
    fs::create_dir_all(dest)?;

    let mut total: u64 = 0;
    let mut has_manifest = false;
    let mut buf = vec![0u8; 64 * 1024];

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(invalid_zip)?;
        let name = entry.name().map_err(invalid_zip)?.into_owned();
        if is_absolute_entry_name(&name) {
            return Err(invalid_zip(format!("absolute path entry: {name}")));
        }
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| invalid_zip(format!("unsafe path entry: {name}")))?;
        if entry.is_symlink() {
            return Err(invalid_zip(format!("symbolic link entry: {name}")));
        }
        // 念のため、正規化後のパスが通常の要素だけで構成されることを確認する
        if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
            return Err(invalid_zip(format!("unsafe path entry: {name}")));
        }

        if entry.is_dir() {
            if !rel.as_os_str().is_empty() {
                fs::create_dir_all(dest.join(&rel))?;
            }
            continue;
        }
        if rel.as_os_str().is_empty() {
            return Err(invalid_zip(format!("entry without a file name: {name}")));
        }

        let out_path = dest.join(&rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&out_path)
            .map_err(|e| {
                if e.kind() == io::ErrorKind::AlreadyExists {
                    invalid_zip(format!("duplicate entry: {name}"))
                } else {
                    e.into()
                }
            })?;

        // ヘッダの申告サイズは信用せず、実際に書き出したバイト数で上限を判定する
        loop {
            let n = entry.read(&mut buf).map_err(invalid_zip)?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > limits.max_total_bytes {
                return Err(PluginError::TooLarge);
            }
            out.write_all(&buf[..n])?;
        }
        out.flush()?;

        if rel == Path::new(MANIFEST_FILE) {
            has_manifest = true;
        }
    }

    if !has_manifest {
        return Err(PluginError::ManifestMissing);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;

    // --- HTTP ステータスの対応 ---

    #[test]
    fn status_2xx_is_ok() {
        for stage in [GithubStage::Repo, GithubStage::Release, GithubStage::Asset] {
            assert_eq!(map_github_status(stage, 200, None, None), Ok(()));
            assert_eq!(map_github_status(stage, 204, Some("0"), None), Ok(()));
        }
    }

    #[test]
    fn status_404_depends_on_stage() {
        assert_eq!(
            map_github_status(GithubStage::Repo, 404, None, None),
            Err(PluginError::RepoNotFound)
        );
        assert_eq!(
            map_github_status(GithubStage::Release, 404, None, None),
            Err(PluginError::NoRelease)
        );
        assert_eq!(
            map_github_status(GithubStage::Asset, 404, None, None),
            Err(PluginError::NoPackage)
        );
    }

    #[test]
    fn rate_limit_detection() {
        assert_eq!(
            map_github_status(GithubStage::Release, 403, Some("0"), Some("1700000000")),
            Err(PluginError::RateLimited {
                reset_at: Some(1_700_000_000)
            })
        );
        assert_eq!(
            map_github_status(GithubStage::Repo, 429, None, None),
            Err(PluginError::RateLimited { reset_at: None })
        );
        // 403 でも残量があれば利用制限ではない
        assert!(matches!(
            map_github_status(GithubStage::Repo, 403, Some("12"), None),
            Err(PluginError::Network { .. })
        ));
        assert!(matches!(
            map_github_status(GithubStage::Repo, 403, None, None),
            Err(PluginError::Network { .. })
        ));
    }

    #[test]
    fn server_errors_are_network() {
        for status in [500, 502, 503, 599] {
            assert!(matches!(
                map_github_status(GithubStage::Asset, status, None, None),
                Err(PluginError::Network { .. })
            ));
        }
    }

    #[test]
    fn repo_spec_validation() {
        assert!(validate_repo_spec("yuma-shin", "notyra-plugins").is_ok());
        assert!(validate_repo_spec("a", "my.repo_name-1").is_ok());
        for (owner, repo) in [
            ("", "r"),
            ("o", ""),
            ("o/x", "r"),
            ("o", "r/x"),
            ("o", ".."),
            ("o", "."),
            ("o", "r?x=1"),
            ("o.x", "r"),
            ("o", "r#a"),
        ] {
            assert_eq!(
                validate_repo_spec(owner, repo),
                Err(PluginError::RepoNotFound),
                "{owner}/{repo}"
            );
        }
    }

    #[test]
    fn asset_selection() {
        let asset = |name: &str, size: u64| ReleaseAsset {
            name: name.into(),
            browser_download_url: format!("https://github.com/o/r/releases/download/v1/{name}"),
            size,
        };
        let release = ReleaseInfo {
            tag_name: "v1".into(),
            assets: vec![asset("other.zip", 1), asset(PACKAGE_ASSET_NAME, 10)],
        };
        assert_eq!(select_package_asset(&release).unwrap().size, 10);

        let none = ReleaseInfo {
            tag_name: "v1".into(),
            assets: vec![asset("other.zip", 1)],
        };
        assert_eq!(select_package_asset(&none).unwrap_err(), PluginError::NoPackage);

        let big = ReleaseInfo {
            tag_name: "v1".into(),
            assets: vec![asset(PACKAGE_ASSET_NAME, MAX_PACKAGE_BYTES + 1)],
        };
        assert_eq!(select_package_asset(&big).unwrap_err(), PluginError::TooLarge);
    }

    #[test]
    fn download_url_must_be_https() {
        assert!(validate_download_url("https://github.com/o/r/a.zip").is_ok());
        assert!(validate_download_url("http://github.com/o/r/a.zip").is_err());
        assert!(validate_download_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn collection_assets_select_by_id_and_preserve_legacy_support() {
        let asset = |name: &str, size| ReleaseAsset {
            name: name.into(),
            browser_download_url: format!("https://github.com/o/r/releases/download/v1/{name}"),
            size,
        };
        let release = ReleaseInfo {
            tag_name: "v1".into(),
            assets: vec![asset(PACKAGE_ASSET_NAME, 10), asset("notyra-toc.zip", 20), asset("notyra-theme-blue.zip", 30)],
        };
        assert_eq!(select_package_asset_for_plugin(&release, Some("notyra-toc")).unwrap().size, 20);
        assert_eq!(select_package_asset_for_plugin(&release, Some("notyra-theme-blue")).unwrap().size, 30);
        assert_eq!(select_package_asset_for_plugin(&release, Some("legacy-plugin")).unwrap().size, 10);
        assert_eq!(select_package_asset(&release).unwrap().size, 10);
        assert!(matches!(select_package_asset_for_plugin(&release, Some("../escape")), Err(PluginError::InvalidArgument { .. })));

        let collection = ReleaseInfo { tag_name: "v1".into(), assets: vec![asset("notyra-toc.zip", 20)] };
        assert_eq!(select_package_asset_for_plugin(&collection, Some("notyra-theme-blue")).unwrap_err(), PluginError::NoPackage);
        let oversized = ReleaseInfo { tag_name: "v1".into(), assets: vec![asset(PACKAGE_ASSET_NAME, 10), asset("notyra-toc.zip", MAX_PACKAGE_BYTES + 1)] };
        assert_eq!(select_package_asset_for_plugin(&oversized, Some("notyra-toc")).unwrap_err(), PluginError::TooLarge);
    }

    #[test]
    fn staging_ids_are_unique_and_valid() {
        let a = new_staging_id();
        let b = new_staging_id();
        assert_ne!(a, b);
        assert!(is_valid_staging_id(&a), "{a}");
        assert!(!is_valid_staging_id("../x"));
        assert!(!is_valid_staging_id(""));
    }

    // --- zip 展開 ---

    enum Entry<'a> {
        File(&'a str, Vec<u8>),
        Dir(&'a str),
        Symlink(&'a str, &'a str),
    }

    fn write_zip(dir: &Path, entries: &[Entry]) -> PathBuf {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for entry in entries {
            match entry {
                Entry::File(name, data) => {
                    writer.start_file(*name, options).unwrap();
                    writer.write_all(data).unwrap();
                }
                Entry::Dir(name) => writer.add_directory(*name, options).unwrap(),
                Entry::Symlink(name, target) => writer.add_symlink(*name, *target, options).unwrap(),
            }
        }
        let bytes = writer.finish().unwrap().into_inner();
        let path = dir.join("package.zip");
        fs::write(&path, bytes).unwrap();
        path
    }

    fn manifest() -> Entry<'static> {
        Entry::File("package.json", br#"{"name":"p","version":"1.0.0"}"#.to_vec())
    }

    #[test]
    fn extracts_normal_package() {
        let tmp = TempDir::new().unwrap();
        let zip = write_zip(
            tmp.path(),
            &[
                manifest(),
                Entry::Dir("dist/"),
                Entry::File("dist/index.js", b"export function activate() {}".to_vec()),
                Entry::File("assets/icon.svg", b"<svg/>".to_vec()),
            ],
        );
        let dest = tmp.path().join("out");
        extract_zip_safely(&zip, &dest, ExtractLimits::default()).unwrap();

        assert_eq!(
            read_manifest(&dest).unwrap(),
            r#"{"name":"p","version":"1.0.0"}"#
        );
        assert_eq!(
            fs::read(dest.join("dist/index.js")).unwrap(),
            b"export function activate() {}"
        );
        assert!(dest.join("assets/icon.svg").is_file());
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let tmp = TempDir::new().unwrap();
        let zip = write_zip(
            tmp.path(),
            &[manifest(), Entry::File("../evil.txt", b"x".to_vec())],
        );
        let dest = tmp.path().join("out");
        let err = extract_zip_safely(&zip, &dest, ExtractLimits::default()).unwrap_err();
        assert!(matches!(err, PluginError::InvalidZip { .. }), "{err:?}");
        assert!(!tmp.path().join("evil.txt").exists());
    }

    #[test]
    fn rejects_nested_traversal() {
        let tmp = TempDir::new().unwrap();
        let zip = write_zip(
            tmp.path(),
            &[manifest(), Entry::File("dist/../../evil.txt", b"x".to_vec())],
        );
        let dest = tmp.path().join("out");
        let err = extract_zip_safely(&zip, &dest, ExtractLimits::default()).unwrap_err();
        assert!(matches!(err, PluginError::InvalidZip { .. }), "{err:?}");
        assert!(!tmp.path().join("evil.txt").exists());
    }

    #[test]
    fn rejects_absolute_paths() {
        for name in ["/abs.txt", "\\abs.txt", "C:/abs.txt"] {
            let tmp = TempDir::new().unwrap();
            let zip = write_zip(tmp.path(), &[manifest(), Entry::File(name, b"x".to_vec())]);
            let dest = tmp.path().join("out");
            let err = extract_zip_safely(&zip, &dest, ExtractLimits::default()).unwrap_err();
            assert!(matches!(err, PluginError::InvalidZip { .. }), "{name}: {err:?}");
            assert!(!dest.join("abs.txt").exists(), "{name}");
        }
    }

    #[test]
    fn rejects_symlinks() {
        let tmp = TempDir::new().unwrap();
        let zip = write_zip(
            tmp.path(),
            &[manifest(), Entry::Symlink("link", "/etc/passwd")],
        );
        let dest = tmp.path().join("out");
        let err = extract_zip_safely(&zip, &dest, ExtractLimits::default()).unwrap_err();
        assert!(matches!(err, PluginError::InvalidZip { .. }), "{err:?}");
        assert!(!dest.join("link").exists());
    }

    #[test]
    fn requires_root_package_json() {
        let tmp = TempDir::new().unwrap();
        let zip = write_zip(
            tmp.path(),
            &[
                Entry::File("sub/package.json", b"{}".to_vec()),
                Entry::File("index.js", b"".to_vec()),
            ],
        );
        let dest = tmp.path().join("out");
        assert_eq!(
            extract_zip_safely(&zip, &dest, ExtractLimits::default()),
            Err(PluginError::ManifestMissing)
        );
    }

    #[test]
    fn enforces_total_size_by_actual_bytes() {
        let tmp = TempDir::new().unwrap();
        // 高圧縮されるデータ: zip は小さいが展開後は上限を超える
        let zip = write_zip(
            tmp.path(),
            &[manifest(), Entry::File("big.bin", vec![0u8; 4096])],
        );
        assert!(fs::metadata(&zip).unwrap().len() < 4096);
        let limits = ExtractLimits {
            max_total_bytes: 1024,
            max_entries: MAX_ZIP_ENTRIES,
        };
        let dest = tmp.path().join("out");
        assert_eq!(
            extract_zip_safely(&zip, &dest, limits),
            Err(PluginError::TooLarge)
        );

        // 上限ちょうどは受理する
        let total = 4096 + br#"{"name":"p","version":"1.0.0"}"#.len() as u64;
        let limits = ExtractLimits {
            max_total_bytes: total,
            max_entries: MAX_ZIP_ENTRIES,
        };
        let dest = tmp.path().join("out2");
        assert_eq!(extract_zip_safely(&zip, &dest, limits), Ok(()));
    }

    #[test]
    fn enforces_entry_count() {
        let tmp = TempDir::new().unwrap();
        let zip = write_zip(
            tmp.path(),
            &[
                manifest(),
                Entry::File("a.js", b"".to_vec()),
                Entry::File("b.js", b"".to_vec()),
            ],
        );
        let limits = ExtractLimits {
            max_total_bytes: MAX_EXTRACTED_BYTES,
            max_entries: 2,
        };
        let dest = tmp.path().join("out");
        assert_eq!(
            extract_zip_safely(&zip, &dest, limits),
            Err(PluginError::TooLarge)
        );
    }

    #[test]
    fn rejects_non_zip_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("bad.zip");
        fs::write(&path, b"not a zip").unwrap();
        let err = extract_zip_safely(&path, &tmp.path().join("out"), ExtractLimits::default())
            .unwrap_err();
        assert!(matches!(err, PluginError::InvalidZip { .. }), "{err:?}");
    }
}
