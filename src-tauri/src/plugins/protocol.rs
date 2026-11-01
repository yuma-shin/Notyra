//! 独自 URI スキーム `notyra-plugin` のハンドラ。
//!
//! `<base>` は Windows で `http://notyra-plugin.localhost`、macOS / Linux で
//! `notyra-plugin://localhost`。どちらでも要求 URI のパス部分だけを見て振り分ける。
//!
//! | パス | 内容 |
//! |------|------|
//! | `/<id>/<nonce>/<path>` | Plugin のファイル（`<nonce>` は無視する） |
//! | `/<id>/@notyra/api.js` | Plugin 専用 API を返す仮想モジュール |
//! | `/@shared/<module>.js` | 共有モジュール（React 等）の仮想モジュール |
//!
//! 配信対象は state.json に登録された Plugin のディレクトリ配下のみ
//! （Requirement 8.12）。Developer_Mode がオフのとき Developer_Plugin は配信しない。

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use parking_lot::RwLock;
use tauri::http::{header, Method, Request, Response, StatusCode};

use super::store::{is_valid_plugin_id, PluginSource, PluginStore};

/// スキーム名
pub const SCHEME: &str = "notyra-plugin";

/// 共有モジュールのパス接頭辞（`/@shared/...`）
const SHARED_PREFIX: &str = "@shared";
/// Plugin 専用 API の仮想モジュールのパス（`/<id>/@notyra/api.js`）
const API_DIR: &str = "@notyra";
const API_FILE: &str = "api.js";

/// CORS を許可するアプリのオリジン
const APP_ORIGINS: &[&str] = &["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
/// 開発時（`tauri dev`）の Vite のオリジン（`tauri.conf.json` の `devUrl`）
const DEV_ORIGINS: &[&str] = &["http://localhost:1420"];

// ---------------------------------------------------------------------------
// ファイル解決
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    /// 字句的に不正、または Plugin ディレクトリの外を指すパス
    InvalidPath,
    /// ファイルが存在しない（ディレクトリを指す場合を含む）
    NotFound,
    Io(String),
}

/// URL パスの残り（`<nonce>` より後ろ。パーセントエンコードされたまま）を、
/// `plugin_dir` 配下の実ファイルのパスに解決する。
///
/// 1. 先頭が `/` または `\` の要求（絶対パス）は拒否する。
/// 2. `/` で区切った各要素をパーセントデコードし、デコード後に `/`・`\`・`:`・NUL を
///    含む要素は拒否する（エンコードされた区切り文字、ドライブ文字、NTFS の ADS）。
/// 3. 空要素と `.` は無視し、`..` は直前の要素を取り除く。`plugin_dir` より上へ出る
///    場合は拒否する（字句的正規化）。
/// 4. `plugin_dir` と結果を `canonicalize` し、結果が `plugin_dir` の配下にある
///    通常ファイルであることを確認する（シンボリックリンクで外へ出るのを防ぐ）。
///
/// 返すパスは `canonicalize` 済み。呼び出し側はこのパスを読み取ること。
pub fn resolve_plugin_file(plugin_dir: &Path, rel: &str) -> Result<PathBuf, ProtocolError> {
    if rel.starts_with('/') || rel.starts_with('\\') {
        return Err(ProtocolError::InvalidPath);
    }

    let mut segments: Vec<String> = Vec::new();
    for raw in rel.split('/') {
        let decoded = urlencoding::decode(raw).map_err(|_| ProtocolError::InvalidPath)?;
        let seg = decoded.as_ref();
        if seg.contains(['/', '\\', ':', '\0']) {
            return Err(ProtocolError::InvalidPath);
        }
        match seg {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(ProtocolError::InvalidPath);
                }
            }
            other => segments.push(other.to_string()),
        }
    }
    if segments.is_empty() {
        return Err(ProtocolError::NotFound);
    }

    let canonical_dir = fs::canonicalize(plugin_dir).map_err(io_to_protocol)?;
    let mut candidate = canonical_dir.clone();
    for seg in &segments {
        candidate.push(seg);
    }
    let canonical = fs::canonicalize(&candidate).map_err(io_to_protocol)?;
    if canonical == canonical_dir || !canonical.starts_with(&canonical_dir) {
        return Err(ProtocolError::InvalidPath);
    }
    if !canonical.is_file() {
        return Err(ProtocolError::NotFound);
    }
    Ok(canonical)
}

fn io_to_protocol(e: io::Error) -> ProtocolError {
    match e.kind() {
        io::ErrorKind::NotFound => ProtocolError::NotFound,
        // Windows で存在しない要素の途中にファイルがある場合など
        io::ErrorKind::NotADirectory | io::ErrorKind::InvalidInput => ProtocolError::NotFound,
        _ => ProtocolError::Io(e.to_string()),
    }
}

/// 拡張子から MIME タイプを決める。HTML は Plugin のオリジンで文書として
/// 解釈させないため `application/octet-stream` とする。
pub fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// 共有モジュール
// ---------------------------------------------------------------------------

/// Renderer が `plugin_register_shared_modules` で登録した共有モジュールの export 名。
///
/// キーはモジュール指定子（例: `react`、`react/jsx-runtime`、`@codemirror/state`）。
#[derive(Default)]
pub struct SharedModuleRegistry {
    modules: RwLock<HashMap<String, Vec<String>>>,
}

impl SharedModuleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 共有モジュールを登録する。同じモジュールは置き換える（どのウィンドウも同じ
    /// 一覧を登録するため）。不正なモジュール名は無視し、不正な export 名と
    /// `default` は取り除く。登録したモジュール数を返す。
    pub fn register(&self, modules: HashMap<String, Vec<String>>) -> usize {
        let mut guard = self.modules.write();
        let mut count = 0;
        for (name, exports) in modules {
            if !is_valid_module_name(&name) {
                continue;
            }
            let mut names: Vec<String> = exports
                .into_iter()
                .filter(|e| e != "default" && is_identifier_name(e))
                .collect();
            names.sort();
            names.dedup();
            guard.insert(name, names);
            count += 1;
        }
        count
    }

    pub fn exports_of(&self, module: &str) -> Option<Vec<String>> {
        self.modules.read().get(module).cloned()
    }

    /// 仮想モジュールのファイル名（例: `@codemirror__state.js`）からモジュールを探し、
    /// 生成した JavaScript を返す。
    pub fn render_by_file_name(&self, file_name: &str) -> Option<String> {
        let module = module_name_from_file(file_name)?;
        let exports = self.exports_of(&module)?;
        Some(render_shared_module(&module, &exports))
    }
}

/// モジュール指定子から仮想モジュールのファイル名を作る（`/` → `__`、末尾に `.js`）。
/// TS 側（`sharedModules.ts`）と共有する命名規則の定義で、Rust ではテストからのみ使う。
#[cfg_attr(not(test), allow(dead_code))]
pub fn shared_module_file_name(module: &str) -> String {
    format!("{}.js", module.replace('/', "__"))
}

fn module_name_from_file(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".js")?;
    let module = stem.replace("__", "/");
    is_valid_module_name(&module).then_some(module)
}

/// npm のモジュール指定子として妥当な文字だけで構成されているか
/// （`react`、`react-dom/client`、`@codemirror/state` など）。
fn is_valid_module_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 214 {
        return false;
    }
    let body = name.strip_prefix('@').unwrap_or(name);
    if body.is_empty() || body.starts_with('/') || body.ends_with('/') || body.contains("//") {
        return false;
    }
    body.split('/').all(|seg| {
        !seg.is_empty()
            && seg != "."
            && seg != ".."
            && !seg.contains("__")
            && seg
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
    })
}

/// ECMAScript の IdentifierName（ASCII の範囲に限定）。予約語も export 名として
/// 使えるため、予約語は拒否しない。
fn is_identifier_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// 共有モジュールの仮想モジュールを生成する。
///
/// export 名には予約語（例: `class`）も含まれ得るため、`export const <name>` ではなく
/// ローカル変数を経由した `export { __e0 as <name> }` で公開する。
pub fn render_shared_module(module: &str, exports: &[String]) -> String {
    let key = serde_json::to_string(module).expect("string serialization never fails");
    let mut js = String::new();
    js.push_str(&format!("const __m = globalThis.__NOTYRA_SHARED__[{key}];\n"));
    js.push_str("export default (__m.default ?? __m);\n");
    for (i, name) in exports.iter().enumerate() {
        js.push_str(&format!("const __e{i} = __m.{name};\nexport {{ __e{i} as {name} }};\n"));
    }
    js
}

/// Plugin 専用 API の仮想モジュールを生成する。`id` は検証済みの Plugin_ID。
pub fn render_api_module(id: &str) -> String {
    let key = serde_json::to_string(id).expect("string serialization never fails");
    format!(
        "const api = globalThis.__NOTYRA_PLUGIN_HOST__.getPluginApi({key});\n\
         export const notyra = api;\n\
         export default api;\n"
    )
}

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
enum Route<'a> {
    Shared { file_name: String },
    Api { id: String },
    File { id: String, rel: &'a str },
}

/// URL パス（先頭の `/` を含む、パーセントエンコードされたまま）を振り分ける。
fn route(path: &str) -> Option<Route<'_>> {
    let path = path.strip_prefix('/')?;
    let (first, rest) = path.split_once('/')?;
    let first = urlencoding::decode(first).ok()?;

    if first == SHARED_PREFIX {
        let file_name = urlencoding::decode(rest).ok()?.into_owned();
        if file_name.contains('/') {
            return None;
        }
        return Some(Route::Shared { file_name });
    }

    let id = first.into_owned();
    if !is_valid_plugin_id(&id) {
        return None;
    }
    let (second, rel) = rest.split_once('/')?;
    if second == API_DIR && rel == API_FILE {
        return Some(Route::Api { id });
    }
    if second.is_empty() || rel.is_empty() {
        return None;
    }
    // second は <nonce>（読み込みごとのキャッシュ分離用）。内容は無視する
    Some(Route::File { id, rel })
}

/// Plugin のディレクトリ。未登録、または Developer_Mode がオフのときの
/// Developer_Plugin は `None`。
fn served_plugin_dir(store: &PluginStore, id: &str) -> Option<PathBuf> {
    let state = store.snapshot();
    let plugin = state.find(id)?;
    if matches!(plugin.source, PluginSource::Local { .. }) && !state.developer_mode {
        return None;
    }
    store.plugin_dir(id)
}

fn is_allowed_origin(origin: &str) -> bool {
    APP_ORIGINS.contains(&origin) || (cfg!(debug_assertions) && DEV_ORIGINS.contains(&origin))
}

/// `notyra-plugin` スキームの要求を処理する。
pub fn handle(store: &PluginStore, shared: &SharedModuleRegistry, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .filter(|o| is_allowed_origin(o))
        .map(str::to_owned);

    if req.method() != Method::GET {
        return text_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed", origin.as_deref())
            .map(|mut r| {
                r.headers_mut()
                    .insert(header::ALLOW, header::HeaderValue::from_static("GET"));
                r
            })
            .unwrap_or_else(|_| fallback_response());
    }

    let result = match route(req.uri().path()) {
        None => Err(StatusCode::NOT_FOUND),
        Some(Route::Shared { file_name }) => shared
            .render_by_file_name(&file_name)
            .map(|js| (js.into_bytes(), mime_for(Path::new("m.js"))))
            .ok_or(StatusCode::NOT_FOUND),
        Some(Route::Api { id }) => match served_plugin_dir(store, &id) {
            Some(_) => Ok((render_api_module(&id).into_bytes(), mime_for(Path::new("m.js")))),
            None => Err(StatusCode::NOT_FOUND),
        },
        Some(Route::File { id, rel }) => match served_plugin_dir(store, &id) {
            None => Err(StatusCode::NOT_FOUND),
            Some(dir) => match resolve_plugin_file(&dir, rel) {
                Ok(path) => match fs::read(&path) {
                    Ok(bytes) => Ok((bytes, mime_for(&path))),
                    Err(e) if e.kind() == io::ErrorKind::NotFound => Err(StatusCode::NOT_FOUND),
                    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
                },
                Err(ProtocolError::NotFound) => Err(StatusCode::NOT_FOUND),
                Err(ProtocolError::InvalidPath) => Err(StatusCode::FORBIDDEN),
                Err(ProtocolError::Io(_)) => Err(StatusCode::INTERNAL_SERVER_ERROR),
            },
        },
    };

    let built = match result {
        Ok((body, mime)) => base_builder(StatusCode::OK, origin.as_deref())
            .header(header::CONTENT_TYPE, mime)
            .body(body),
        Err(status) => text_response(
            status,
            status.canonical_reason().unwrap_or("error"),
            origin.as_deref(),
        ),
    };
    built.unwrap_or_else(|_| fallback_response())
}

/// AppState が未登録（setup 前）のときの応答
pub fn unavailable_response() -> Response<Vec<u8>> {
    text_response(StatusCode::SERVICE_UNAVAILABLE, "plugin system is not ready", None)
        .unwrap_or_else(|_| fallback_response())
}

fn base_builder(status: StatusCode, origin: Option<&str>) -> tauri::http::response::Builder {
    let mut b = Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::VARY, "Origin");
    if let Some(origin) = origin {
        b = b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    b
}

fn text_response(
    status: StatusCode,
    message: &str,
    origin: Option<&str>,
) -> Result<Response<Vec<u8>>, tauri::http::Error> {
    base_builder(status, origin)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
}

fn fallback_response() -> Response<Vec<u8>> {
    let mut r = Response::new(b"internal error".to_vec());
    *r.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
    r
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::store::{InstalledPluginState, PluginStateFile};
    use tempfile::TempDir;

    fn plugin(id: &str, source: PluginSource) -> InstalledPluginState {
        InstalledPluginState {
            id: id.to_string(),
            version: "1.0.0".into(),
            source,
            enabled: true,
            consented_permissions: vec![],
            consented_destinations: vec![],
            generation: 0,
            pending_consent: None,
            disabled_reason: None,
            installed_at: "2026-07-04T00:00:00Z".into(),
        }
    }

    struct Fixture {
        _dir: TempDir,
        store: PluginStore,
        dev_dir: PathBuf,
        /// ディレクトリ外のファイル（存在することが前提のため保持する）
        _outside: PathBuf,
    }

    /// `gh`（GitHub 由来）と `dev`（Developer_Plugin）を登録したストア
    fn fixture(developer_mode: bool) -> Fixture {
        let dir = TempDir::new().unwrap();
        let store = PluginStore::load(dir.path().join("plugins")).unwrap();

        let gh_dir = store.installed_root().join("gh");
        fs::create_dir_all(gh_dir.join("dist").join("sub")).unwrap();
        fs::write(gh_dir.join("dist").join("index.js"), "export function activate() {}").unwrap();
        fs::write(gh_dir.join("dist").join("sub").join("a b.css"), "body{}").unwrap();
        fs::write(gh_dir.join("package.json"), "{}").unwrap();

        let dev_dir = dir.path().join("work").join("dev");
        fs::create_dir_all(&dev_dir).unwrap();
        fs::write(dev_dir.join("index.mjs"), "export {}").unwrap();

        let outside = dir.path().join("secret.txt");
        fs::write(&outside, "secret").unwrap();

        let dev_path = dev_dir.to_string_lossy().into_owned();
        store
            .update(|s: &mut PluginStateFile| {
                s.developer_mode = developer_mode;
                s.plugins.push(plugin(
                    "gh",
                    PluginSource::Github { owner: "o".into(), repo: "gh".into() },
                ));
                s.plugins.push(plugin("dev", PluginSource::Local { path: dev_path }));
                Ok(())
            })
            .unwrap();
        Fixture { _dir: dir, store, dev_dir, _outside: outside }
    }

    fn get(uri: &str, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut b = Request::builder().method(Method::GET).uri(uri);
        if let Some(o) = origin {
            b = b.header(header::ORIGIN, o);
        }
        b.body(Vec::new()).unwrap()
    }

    fn body_str(r: &Response<Vec<u8>>) -> String {
        String::from_utf8(r.body().clone()).unwrap()
    }

    // --- resolve_plugin_file ---

    #[test]
    fn resolves_files_inside_plugin_dir() {
        let f = fixture(false);
        let dir = f.store.installed_root().join("gh");
        let p = resolve_plugin_file(&dir, "dist/index.js").unwrap();
        assert!(p.ends_with(Path::new("dist").join("index.js")));
        // `.`・`..`・空要素・パーセントエンコードを解決する
        let p2 = resolve_plugin_file(&dir, "./dist/sub/../index.js").unwrap();
        assert_eq!(p, p2);
        let p3 = resolve_plugin_file(&dir, "dist//sub/a%20b.css").unwrap();
        assert!(p3.ends_with("a b.css"));
    }

    #[test]
    fn rejects_paths_escaping_plugin_dir() {
        let f = fixture(false);
        let dir = f.store.installed_root().join("gh");
        let cases = [
            "../dev/index.mjs",
            "dist/../../gh/package.json",
            "%2e%2e/secret.txt",
            "dist%2f..%2f..%2fsecret.txt",
            "..%5c..%5csecret.txt",
            "/etc/passwd",
            "\\windows\\win.ini",
            "C:/windows/win.ini",
            "C%3a/windows/win.ini",
            "package.json%00.js",
        ];
        for rel in cases {
            assert_eq!(
                resolve_plugin_file(&dir, rel),
                Err(ProtocolError::InvalidPath),
                "rel = {rel}"
            );
        }
    }

    #[test]
    fn missing_files_and_directories_are_not_found() {
        let f = fixture(false);
        let dir = f.store.installed_root().join("gh");
        assert_eq!(resolve_plugin_file(&dir, "nope.js"), Err(ProtocolError::NotFound));
        assert_eq!(resolve_plugin_file(&dir, "dist"), Err(ProtocolError::NotFound));
        assert_eq!(resolve_plugin_file(&dir, ""), Err(ProtocolError::NotFound));
        assert_eq!(resolve_plugin_file(&dir, "dist/.."), Err(ProtocolError::NotFound));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_pointing_outside() {
        let f = fixture(false);
        let dir = f.store.installed_root().join("gh");
        std::os::unix::fs::symlink(&f._outside, dir.join("link.txt")).unwrap();
        assert_eq!(resolve_plugin_file(&dir, "link.txt"), Err(ProtocolError::InvalidPath));
    }

    // --- handle ---

    #[test]
    fn serves_plugin_file_with_mime_and_headers_ignoring_nonce() {
        let f = fixture(false);
        let shared = SharedModuleRegistry::new();
        for uri in [
            "http://notyra-plugin.localhost/gh/n1/dist/index.js",
            "notyra-plugin://localhost/gh/other-nonce/dist/index.js",
        ] {
            let r = handle(&f.store, &shared, &get(uri, Some("http://tauri.localhost")));
            assert_eq!(r.status(), StatusCode::OK, "{uri}");
            assert_eq!(body_str(&r), "export function activate() {}");
            let h = r.headers();
            assert_eq!(h[header::CONTENT_TYPE], "text/javascript; charset=utf-8");
            assert_eq!(h[header::CACHE_CONTROL], "no-store");
            assert_eq!(h[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://tauri.localhost");
        }
    }

    #[test]
    fn cors_only_for_app_origins() {
        let f = fixture(false);
        let shared = SharedModuleRegistry::new();
        let uri = "http://notyra-plugin.localhost/gh/n/dist/index.js";
        let r = handle(&f.store, &shared, &get(uri, Some("tauri://localhost")));
        assert_eq!(r.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "tauri://localhost");
        for origin in [Some("https://evil.example"), Some("null"), None] {
            let r = handle(&f.store, &shared, &get(uri, origin));
            assert!(r.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        }
    }

    #[test]
    fn non_get_is_405() {
        let f = fixture(false);
        let shared = SharedModuleRegistry::new();
        for method in [Method::POST, Method::HEAD, Method::PUT, Method::OPTIONS] {
            let req = Request::builder()
                .method(method.clone())
                .uri("http://notyra-plugin.localhost/gh/n/dist/index.js")
                .body(Vec::new())
                .unwrap();
            let r = handle(&f.store, &shared, &req);
            assert_eq!(r.status(), StatusCode::METHOD_NOT_ALLOWED, "{method}");
        }
    }

    #[test]
    fn unknown_plugin_and_bad_paths_are_rejected() {
        let f = fixture(false);
        let shared = SharedModuleRegistry::new();
        let status = |uri: &str| handle(&f.store, &shared, &get(uri, None)).status();
        assert_eq!(status("http://notyra-plugin.localhost/missing/n/index.js"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/missing/@notyra/api.js"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/gh/n/nope.js"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/gh/n/"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/gh"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/Bad%2FId/n/x.js"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/gh/n/%2e%2e/%2e%2e/secret.txt"), StatusCode::FORBIDDEN);
        assert_eq!(status("http://notyra-plugin.localhost/gh/n/..%2f..%2fsecret.txt"), StatusCode::FORBIDDEN);
    }

    #[test]
    fn developer_plugin_is_served_only_in_developer_mode() {
        let shared = SharedModuleRegistry::new();
        let file = "http://notyra-plugin.localhost/dev/n/index.mjs";
        let api = "http://notyra-plugin.localhost/dev/@notyra/api.js";

        let off = fixture(false);
        assert_eq!(handle(&off.store, &shared, &get(file, None)).status(), StatusCode::NOT_FOUND);
        assert_eq!(handle(&off.store, &shared, &get(api, None)).status(), StatusCode::NOT_FOUND);

        let on = fixture(true);
        let r = handle(&on.store, &shared, &get(file, None));
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(body_str(&r), "export {}");
        assert!(on.dev_dir.join("index.mjs").exists());
        assert_eq!(handle(&on.store, &shared, &get(api, None)).status(), StatusCode::OK);
    }

    #[test]
    fn api_virtual_module_embeds_plugin_id() {
        let f = fixture(false);
        let shared = SharedModuleRegistry::new();
        let r = handle(
            &f.store,
            &shared,
            &get("http://notyra-plugin.localhost/gh/@notyra/api.js", None),
        );
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_TYPE], "text/javascript; charset=utf-8");
        assert_eq!(
            body_str(&r),
            "const api = globalThis.__NOTYRA_PLUGIN_HOST__.getPluginApi(\"gh\");\n\
             export const notyra = api;\n\
             export default api;\n"
        );
    }

    #[test]
    fn shared_virtual_module_is_generated_from_registered_exports() {
        let f = fixture(false);
        let shared = SharedModuleRegistry::new();
        let count = shared.register(HashMap::from([
            (
                "react".to_string(),
                vec!["useState".into(), "default".into(), "not-valid".into(), "Fragment".into()],
            ),
            ("@codemirror/state".to_string(), vec!["EditorState".into(), "class".into()]),
            ("react/jsx-runtime".to_string(), vec!["jsx".into()]),
            ("../evil".to_string(), vec!["x".into()]),
        ]));
        assert_eq!(count, 3);
        assert_eq!(shared_module_file_name("@codemirror/state"), "@codemirror__state.js");
        assert_eq!(shared_module_file_name("react/jsx-runtime"), "react__jsx-runtime.js");

        let r = handle(&f.store, &shared, &get("http://notyra-plugin.localhost/@shared/react.js", None));
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(
            body_str(&r),
            "const __m = globalThis.__NOTYRA_SHARED__[\"react\"];\n\
             export default (__m.default ?? __m);\n\
             const __e0 = __m.Fragment;\nexport { __e0 as Fragment };\n\
             const __e1 = __m.useState;\nexport { __e1 as useState };\n"
        );

        let r = handle(
            &f.store,
            &shared,
            &get("http://notyra-plugin.localhost/@shared/@codemirror__state.js", None),
        );
        assert_eq!(r.status(), StatusCode::OK);
        assert!(body_str(&r).contains("__NOTYRA_SHARED__[\"@codemirror/state\"]"));
        assert!(body_str(&r).contains("export { __e1 as class };"));

        let r = handle(
            &f.store,
            &shared,
            &get("http://notyra-plugin.localhost/@shared/react__jsx-runtime.js", None),
        );
        assert_eq!(r.status(), StatusCode::OK);

        let status = |uri: &str| handle(&f.store, &shared, &get(uri, None)).status();
        assert_eq!(status("http://notyra-plugin.localhost/@shared/vue.js"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/@shared/react"), StatusCode::NOT_FOUND);
        assert_eq!(status("http://notyra-plugin.localhost/@shared/a/react.js"), StatusCode::NOT_FOUND);
    }

    #[test]
    fn route_parses_paths() {
        assert_eq!(
            route("/gh/abc/dist/index.js"),
            Some(Route::File { id: "gh".into(), rel: "dist/index.js" })
        );
        assert_eq!(route("/gh/@notyra/api.js"), Some(Route::Api { id: "gh".into() }));
        assert_eq!(
            route("/@shared/react.js"),
            Some(Route::Shared { file_name: "react.js".into() })
        );
        assert_eq!(route("/gh//x.js"), None);
        assert_eq!(route("gh/n/x.js"), None);
        assert_eq!(route("/UPPER/n/x.js"), None);
    }

    #[test]
    fn mime_types() {
        assert_eq!(mime_for(Path::new("a.MJS")), "text/javascript; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.css")), "text/css; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.json")), "application/json; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(mime_for(Path::new("a.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a.html")), "application/octet-stream");
        assert_eq!(mime_for(Path::new("noext")), "application/octet-stream");
    }
}
