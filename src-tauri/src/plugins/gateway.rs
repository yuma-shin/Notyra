//! Network_Gateway: Plugin の HTTP / HTTPS 通信の照合と実行。
//!
//! 処理手順（design.md「5. Rust: Network_Gateway」）:
//!
//! 1. スキームが `http` / `https` 以外なら `SchemeNotAllowed`（Requirement 7.7）
//! 2. 要求のホストと実効ポートを同意済み Declared_Destination と照合し、不一致なら `Blocked`
//!    （Requirement 7.8〜7.12）
//! 3. ホストが名前なら `lookup_host` で解決し、一致した宛先の分類で解決結果を検査する
//!    （Requirement 7.14、7.15）
//! 4. 検査済みのアドレスだけに接続する（`resolve_to_addrs` で接続先を固定し、
//!    検査後の再解決による DNS リバインディングを防ぐ）
//! 5. 自動リダイレクト無効・プロキシ無効・30秒タイムアウトで送信する
//! 6. 3xx の `Location` は手順 1〜5 で再照合する（最大10回。Requirement 7.13）
//! 7. 応答本文は 10MB を上限にストリームで読む
//!
//! 照合と検査（手順 1〜3、6）は純粋関数 `check_request` / `check_target` / `check_resolved` に
//! 分離し、プロパティテストの対象にする。

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use url::{Host, Url};

use super::destination::{classify, effective_port, is_private_ip, matches, DestClass, Destination};
use super::error::{BlockReason, PluginError};

/// 追従するリダイレクトの最大回数
pub const MAX_REDIRECTS: usize = 10;
/// 1回の要求（名前解決・接続・本文の受信完了まで）のタイムアウト（決定 #16）
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// 応答本文の上限（決定 #16）
pub const MAX_RESPONSE_BYTES: u64 = 10 * 1024 * 1024;

const USER_AGENT: &str = concat!("Notyra/", env!("CARGO_PKG_VERSION"));

/// Plugin が指定できない要求ヘッダ（`Host` の上書きと、接続・本文の制御に関わるもの）
const FORBIDDEN_REQUEST_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "upgrade",
    "te",
    "trailer",
    "proxy-authorization",
    "proxy-connection",
];

/// 本文を破棄するリダイレクトで取り除く本文関連のヘッダ（Fetch 標準の request-body-header name）
const BODY_HEADERS: &[&str] = &[
    "content-type",
    "content-encoding",
    "content-language",
    "content-location",
];

/// 異なるオリジンへのリダイレクトで取り除く資格情報ヘッダ
const CREDENTIAL_HEADERS: &[&str] = &["authorization", "cookie"];

// ---------------------------------------------------------------------------
// 要求と応答（Renderer との IPC 形式）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHttpRequest {
    pub url: String,
    /// 空なら `GET`
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body_base64: String,
    /// リダイレクト追従後の最終的な URL
    pub url: String,
}

// ---------------------------------------------------------------------------
// 照合（純粋関数）
// ---------------------------------------------------------------------------

/// 照合に成功した要求先。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedTarget {
    /// URL のホスト（ドメインは小文字。IPv6 は角括弧なし）
    pub host: String,
    /// 実効ポート
    pub port: u16,
    pub kind: TargetKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// IP アドレスの要求。名前解決は行わない
    Ip(IpAddr),
    /// ホスト名の要求。`class` は一致した Declared_Destination の分類
    Name { class: DestClass },
}

/// スキームの確認と、同意済み Declared_Destination との照合（手順 1〜2）。
pub fn check_target(consented: &[Destination], url: &Url) -> Result<CheckedTarget, PluginError> {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(PluginError::SchemeNotAllowed {
            scheme: scheme.to_string(),
        });
    }

    let (host, ip) = match url.host() {
        Some(Host::Domain(d)) => (d.to_ascii_lowercase(), None),
        Some(Host::Ipv4(v4)) => (v4.to_string(), Some(IpAddr::V4(v4))),
        Some(Host::Ipv6(v6)) => (v6.to_string(), Some(IpAddr::V6(v6))),
        None => {
            return Err(PluginError::InvalidArgument {
                message: format!("URL has no host: {url}"),
            })
        }
    };
    // `url` は既定ポートを `port()` から除くため、未指定と同じく実効ポートに補完される
    let port = effective_port(scheme, url.port());

    let matched: Vec<&Destination> = consented
        .iter()
        .filter(|d| matches(d, &host, port))
        .collect();
    if matched.is_empty() {
        return Err(PluginError::Blocked {
            host,
            port,
            reason: BlockReason::NotDeclared,
        });
    }

    let kind = match ip {
        Some(ip) => TargetKind::Ip(ip),
        None => {
            // ホスト名に一致し得る Private の宛先は `localhost` の完全一致だけなので、
            // 一致した宛先の分類は1種類に定まる。念のため混在時は Public として扱う
            let class = if matched
                .iter()
                .all(|d| classify(d) == DestClass::Private)
            {
                DestClass::Private
            } else {
                DestClass::Public
            };
            TargetKind::Name { class }
        }
    };

    Ok(CheckedTarget { host, port, kind })
}

/// 名前解決結果の検査（手順 3）。
///
/// - Public として一致したホスト名: Private の IP が1つでも含まれれば `Blocked`（7.14）
/// - `localhost` として一致したホスト名: Private 範囲外の IP が1つでも含まれれば `Blocked`（7.15）
/// - IP アドレスの要求: 検査しない
pub fn check_resolved(target: &CheckedTarget, resolved: &[IpAddr]) -> Result<(), PluginError> {
    let class = match target.kind {
        TargetKind::Ip(_) => return Ok(()),
        TargetKind::Name { class } => class,
    };
    if resolved.is_empty() {
        return Err(PluginError::Network {
            message: format!("name resolution returned no addresses for {}", target.host),
        });
    }
    let violation = match class {
        DestClass::Public => resolved
            .iter()
            .any(is_private_ip)
            .then_some(BlockReason::ResolvedToPrivate),
        DestClass::Private => resolved
            .iter()
            .any(|ip| !is_private_ip(ip))
            .then_some(BlockReason::ResolvedToNonPrivate),
    };
    match violation {
        Some(reason) => Err(PluginError::Blocked {
            host: target.host.clone(),
            port: target.port,
            reason,
        }),
        None => Ok(()),
    }
}

/// 要求 URL の照合と（与えられた場合は）名前解決結果の検査を行う。
///
/// `resolved` が `None` のときは照合のみ行う（名前解決の前段の判定）。
pub fn check_request(
    consented: &[Destination],
    url: &Url,
    resolved: Option<&[IpAddr]>,
) -> Result<CheckedTarget, PluginError> {
    let target = check_target(consented, url)?;
    if let Some(addrs) = resolved {
        check_resolved(&target, addrs)?;
    }
    Ok(target)
}

/// リダイレクト先の照合で宛先不一致になった場合は、理由を `RedirectNotDeclared` に置き換える。
fn as_redirect_error(e: PluginError) -> PluginError {
    match e {
        PluginError::Blocked {
            host,
            port,
            reason: BlockReason::NotDeclared,
        } => PluginError::Blocked {
            host,
            port,
            reason: BlockReason::RedirectNotDeclared,
        },
        other => other,
    }
}

/// リダイレクト応答なら、`Location` を現在の URL を基準に解決した次の URL を返す。
/// リダイレクトでない（3xx 以外、または `Location` がない）なら `None`。
pub fn redirect_location(
    current: &Url,
    status: u16,
    location: Option<&str>,
) -> Result<Option<Url>, PluginError> {
    if !matches!(status, 301 | 302 | 303 | 307 | 308) {
        return Ok(None);
    }
    let Some(location) = location else {
        return Ok(None);
    };
    let mut next = current.join(location).map_err(|e| PluginError::Network {
        message: format!("invalid redirect location {location:?}: {e}"),
    })?;
    next.set_fragment(None);
    Ok(Some(next))
}

/// リダイレクト後のメソッドと、本文を維持するかどうか（Fetch 標準と同じ規則）。
///
/// 303 は `HEAD` 以外を `GET` に、301 / 302 は `POST` を `GET` に変え、本文を破棄する。
/// 307 / 308 はメソッドと本文を維持する。
pub fn redirect_method(status: u16, method: &Method) -> (Method, bool) {
    match status {
        303 if *method != Method::HEAD => (Method::GET, false),
        301 | 302 if *method == Method::POST => (Method::GET, false),
        _ => (method.clone(), true),
    }
}

// ---------------------------------------------------------------------------
// 要求の検証
// ---------------------------------------------------------------------------

fn invalid(message: impl Into<String>) -> PluginError {
    PluginError::InvalidArgument {
        message: message.into(),
    }
}

fn parse_url(raw: &str) -> Result<Url, PluginError> {
    let mut url = Url::parse(raw).map_err(|e| invalid(format!("invalid URL {raw:?}: {e}")))?;
    url.set_fragment(None);
    Ok(url)
}

fn parse_method(raw: &str) -> Result<Method, PluginError> {
    if raw.is_empty() {
        return Ok(Method::GET);
    }
    // 標準メソッドは大文字小文字を区別せずに正規化する
    let upper = raw.to_ascii_uppercase();
    let normalized = match upper.as_str() {
        "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "OPTIONS" | "PATCH" => upper.as_str(),
        "CONNECT" | "TRACE" | "TRACK" => {
            return Err(invalid(format!("method not allowed: {raw}")));
        }
        _ => raw,
    };
    Method::from_bytes(normalized.as_bytes()).map_err(|_| invalid(format!("invalid method: {raw}")))
}

fn parse_headers(raw: &[(String, String)]) -> Result<HeaderMap, PluginError> {
    let mut map = HeaderMap::new();
    for (name, value) in raw {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| invalid(format!("invalid header name: {name:?}")))?;
        let lower = header_name.as_str();
        if FORBIDDEN_REQUEST_HEADERS.contains(&lower) || lower.starts_with("proxy-") {
            return Err(invalid(format!("header not allowed: {name}")));
        }
        let header_value = HeaderValue::from_str(value)
            .map_err(|_| invalid(format!("invalid value for header {name}")))?;
        map.append(header_name, header_value);
    }
    Ok(map)
}

fn decode_body(raw: Option<&str>) -> Result<Option<Vec<u8>>, PluginError> {
    raw.map(|b| {
        general_purpose::STANDARD
            .decode(b)
            .map_err(|e| invalid(format!("body is not valid base64: {e}")))
    })
    .transpose()
}

fn remove_headers(headers: &mut HeaderMap, names: &[&str]) {
    for name in names {
        headers.remove(*name);
    }
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

fn request_error(e: reqwest::Error) -> PluginError {
    if e.is_timeout() {
        return PluginError::Timeout;
    }
    // 原因の連鎖を含めて伝える（接続拒否・TLS エラー等の判別のため）
    let mut message = e.to_string();
    let mut source = std::error::Error::source(&e);
    while let Some(s) = source {
        message.push_str(": ");
        message.push_str(&s.to_string());
        source = s.source();
    }
    PluginError::Network { message }
}

/// ホスト名を解決して検査し、接続に使うアドレスを返す。IP アドレスの要求は `None`。
async fn resolve_and_check(target: &CheckedTarget) -> Result<Option<Vec<SocketAddr>>, PluginError> {
    if let TargetKind::Ip(_) = target.kind {
        return Ok(None);
    }
    let lookup = tokio::net::lookup_host((target.host.as_str(), target.port));
    let addrs: Vec<SocketAddr> = tokio::time::timeout(REQUEST_TIMEOUT, lookup)
        .await
        .map_err(|_| PluginError::Timeout)?
        .map_err(|e| PluginError::Network {
            message: format!("failed to resolve {}: {e}", target.host),
        })?
        .collect();
    let ips: Vec<IpAddr> = addrs.iter().map(SocketAddr::ip).collect();
    check_resolved(target, &ips)?;
    Ok(Some(addrs))
}

/// 1回の要求用のクライアント。名前の要求は検査済みアドレスに接続先を固定する。
fn build_client(
    target: &CheckedTarget,
    pinned: Option<&[SocketAddr]>,
) -> Result<reqwest::Client, PluginError> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(REQUEST_TIMEOUT);
    if let Some(addrs) = pinned {
        builder = builder.resolve_to_addrs(&target.host, addrs);
    }
    builder.build().map_err(request_error)
}

/// 応答本文を上限付きで読む。
async fn read_body_limited(mut response: reqwest::Response) -> Result<Vec<u8>, PluginError> {
    if response
        .content_length()
        .is_some_and(|len| len > MAX_RESPONSE_BYTES)
    {
        return Err(PluginError::ResponseTooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if (body.len() + chunk.len()) as u64 > MAX_RESPONSE_BYTES {
            return Err(PluginError::ResponseTooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn response_headers(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect()
}

/// 同意済み Declared_Destination の範囲で Plugin の HTTP / HTTPS 要求を実行する。
///
/// `network` Permission の確認は呼び出し元（`commands::plugin_network`）で行う。
pub async fn execute(
    consented: &[Destination],
    request: PluginHttpRequest,
) -> Result<PluginHttpResponse, PluginError> {
    let mut url = parse_url(&request.url)?;
    let mut method = parse_method(&request.method)?;
    let mut headers = parse_headers(&request.headers)?;
    let mut body = decode_body(request.body_base64.as_deref())?;
    let mut redirects = 0usize;

    loop {
        let target = check_request(consented, &url, None).map_err(|e| {
            if redirects > 0 {
                as_redirect_error(e)
            } else {
                e
            }
        })?;
        let pinned = resolve_and_check(&target).await?;
        let client = build_client(&target, pinned.as_deref())?;

        let mut builder = client
            .request(method.clone(), url.clone())
            .headers(headers.clone());
        if let Some(b) = &body {
            builder = builder.body(b.clone());
        }
        let response = builder.send().await.map_err(request_error)?;

        let status = response.status().as_u16();
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok());
        if let Some(next) = redirect_location(&url, status, location)? {
            redirects += 1;
            if redirects > MAX_REDIRECTS {
                return Err(PluginError::TooManyRedirects);
            }
            let (next_method, keep_body) = redirect_method(status, &method);
            if !keep_body {
                body = None;
                remove_headers(&mut headers, BODY_HEADERS);
            }
            if next.origin() != url.origin() {
                remove_headers(&mut headers, CREDENTIAL_HEADERS);
            }
            method = next_method;
            url = next;
            continue;
        }

        let response_headers = response_headers(response.headers());
        let final_url = response.url().to_string();
        let bytes = read_body_limited(response).await?;
        return Ok(PluginHttpResponse {
            status,
            headers: response_headers,
            body_base64: general_purpose::STANDARD.encode(bytes),
            url: final_url,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::destination::parse_destination;

    fn dests(list: &[&str]) -> Vec<Destination> {
        list.iter().map(|s| parse_destination(s).unwrap()).collect()
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn ips(list: &[&str]) -> Vec<IpAddr> {
        list.iter().map(|s| s.parse().unwrap()).collect()
    }

    fn blocked_reason(r: Result<CheckedTarget, PluginError>) -> BlockReason {
        match r {
            Err(PluginError::Blocked { reason, .. }) => reason,
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn rejects_non_http_schemes() {
        let consented = dests(&["example.com"]);
        for (u, scheme) in [
            ("ws://example.com/", "ws"),
            ("wss://example.com/", "wss"),
            ("ftp://example.com/", "ftp"),
            ("file:///etc/passwd", "file"),
        ] {
            assert_eq!(
                check_request(&consented, &url(u), None),
                Err(PluginError::SchemeNotAllowed {
                    scheme: scheme.into()
                }),
                "{u}"
            );
        }
    }

    #[test]
    fn matches_declared_host_and_effective_port() {
        let consented = dests(&["api.example.com", "localhost:11434", "*.cdn.example.com:8443"]);

        let t = check_request(&consented, &url("https://API.example.com/v1"), None).unwrap();
        assert_eq!(t.host, "api.example.com");
        assert_eq!(t.port, 443);
        assert_eq!(t.kind, TargetKind::Name { class: DestClass::Public });

        // 既定ポートを明示しても実効ポートは同じ
        assert!(check_request(&consented, &url("http://api.example.com:80/"), None).is_ok());
        // ポート未指定の宛先は 80 / 443 以外に一致しない
        assert_eq!(
            blocked_reason(check_request(&consented, &url("http://api.example.com:8080/"), None)),
            BlockReason::NotDeclared
        );
        // http で 443 を明示した場合も 443 として一致する
        assert!(check_request(&consented, &url("http://api.example.com:443/"), None).is_ok());

        let t = check_request(&consented, &url("http://localhost:11434/api"), None).unwrap();
        assert_eq!(t.kind, TargetKind::Name { class: DestClass::Private });
        assert!(check_request(&consented, &url("http://localhost/"), None).is_err());

        assert!(check_request(&consented, &url("https://a.cdn.example.com:8443/"), None).is_ok());
        assert!(check_request(&consented, &url("https://cdn.example.com:8443/"), None).is_err());
        assert!(check_request(&consented, &url("https://other.com/"), None).is_err());
    }

    #[test]
    fn ip_targets_skip_resolution_checks() {
        let consented = dests(&["192.168.1.10:8080", "[::1]:3000"]);
        let t = check_request(&consented, &url("http://192.168.1.10:8080/"), Some(&[])).unwrap();
        assert_eq!(t.kind, TargetKind::Ip("192.168.1.10".parse().unwrap()));
        assert!(check_request(&consented, &url("http://[::1]:3000/"), None).is_ok());
        assert!(check_request(&consented, &url("http://[::2]:3000/"), None).is_err());
        // url クレートが正規化した IPv4 表記でも値として照合する
        let consented = dests(&["127.0.0.1:8080"]);
        assert!(check_request(&consented, &url("http://0x7f.0.0.1:8080/"), None).is_ok());
    }

    #[test]
    fn public_name_resolving_to_private_is_blocked() {
        let consented = dests(&["api.example.com"]);
        let u = url("https://api.example.com/");
        assert!(check_request(&consented, &u, Some(&ips(&["93.184.216.34"]))).is_ok());
        for bad in [
            &["10.0.0.1"][..],
            &["93.184.216.34", "127.0.0.1"][..],
            &["::ffff:192.168.0.1"][..],
            &["fd00::1"][..],
        ] {
            assert_eq!(
                blocked_reason(check_request(&consented, &u, Some(&ips(bad)))),
                BlockReason::ResolvedToPrivate,
                "{bad:?}"
            );
        }
        // CGNAT は Public
        assert!(check_request(&consented, &u, Some(&ips(&["100.64.0.1"]))).is_ok());
    }

    #[test]
    fn localhost_resolving_outside_private_is_blocked() {
        let consented = dests(&["localhost:3000"]);
        let u = url("http://localhost:3000/");
        assert!(check_request(&consented, &u, Some(&ips(&["127.0.0.1", "::1"]))).is_ok());
        assert_eq!(
            blocked_reason(check_request(&consented, &u, Some(&ips(&["127.0.0.1", "8.8.8.8"])))),
            BlockReason::ResolvedToNonPrivate
        );
    }

    #[test]
    fn empty_resolution_is_a_network_error() {
        let consented = dests(&["api.example.com"]);
        assert!(matches!(
            check_request(&consented, &url("https://api.example.com/"), Some(&[])),
            Err(PluginError::Network { .. })
        ));
    }

    #[test]
    fn redirect_location_resolution() {
        let base = url("https://api.example.com/a/b?q=1");
        assert_eq!(redirect_location(&base, 200, Some("/x")).unwrap(), None);
        assert_eq!(redirect_location(&base, 304, Some("/x")).unwrap(), None);
        assert_eq!(redirect_location(&base, 302, None).unwrap(), None);
        assert_eq!(
            redirect_location(&base, 302, Some("c#frag")).unwrap(),
            Some(url("https://api.example.com/a/c"))
        );
        assert_eq!(
            redirect_location(&base, 308, Some("//evil.com/x")).unwrap(),
            Some(url("https://evil.com/x"))
        );
    }

    #[test]
    fn redirect_to_undeclared_host_reports_redirect_reason() {
        let consented = dests(&["api.example.com"]);
        let next = redirect_location(&url("https://api.example.com/"), 302, Some("https://evil.com/"))
            .unwrap()
            .unwrap();
        let err = check_request(&consented, &next, None).map_err(as_redirect_error);
        assert_eq!(blocked_reason(err), BlockReason::RedirectNotDeclared);
        // スキーム違反はそのまま
        let next = url("ws://api.example.com/");
        assert!(matches!(
            check_request(&consented, &next, None).map_err(as_redirect_error),
            Err(PluginError::SchemeNotAllowed { .. })
        ));
    }

    #[test]
    fn redirect_method_rules() {
        assert_eq!(redirect_method(303, &Method::POST), (Method::GET, false));
        assert_eq!(redirect_method(303, &Method::HEAD), (Method::HEAD, true));
        assert_eq!(redirect_method(302, &Method::POST), (Method::GET, false));
        assert_eq!(redirect_method(301, &Method::PUT), (Method::PUT, true));
        assert_eq!(redirect_method(307, &Method::POST), (Method::POST, true));
        assert_eq!(redirect_method(308, &Method::POST), (Method::POST, true));
    }

    #[test]
    fn request_validation() {
        assert_eq!(parse_method("").unwrap(), Method::GET);
        assert_eq!(parse_method("post").unwrap(), Method::POST);
        assert_eq!(parse_method("PROPFIND").unwrap().as_str(), "PROPFIND");
        assert!(parse_method("CONNECT").is_err());
        assert!(parse_method("bad method").is_err());

        assert!(parse_headers(&[("Authorization".into(), "Bearer x".into())]).is_ok());
        for name in ["Host", "content-length", "Transfer-Encoding", "Proxy-Foo"] {
            assert!(
                matches!(
                    parse_headers(&[(name.into(), "x".into())]),
                    Err(PluginError::InvalidArgument { .. })
                ),
                "{name}"
            );
        }
        assert!(parse_headers(&[("X-A".into(), "a\nb".into())]).is_err());

        assert_eq!(decode_body(Some("aGk=")).unwrap(), Some(b"hi".to_vec()));
        assert!(decode_body(Some("***")).is_err());
        assert!(parse_url("not a url").is_err());
    }

    #[tokio::test]
    async fn execute_blocks_before_any_network_access() {
        let consented = dests(&["api.example.com"]);
        let request = |u: &str| PluginHttpRequest {
            url: u.into(),
            method: String::new(),
            headers: vec![],
            body_base64: None,
        };
        assert!(matches!(
            execute(&consented, request("https://evil.invalid/")).await,
            Err(PluginError::Blocked {
                reason: BlockReason::NotDeclared,
                ..
            })
        ));
        assert!(matches!(
            execute(&consented, request("wss://api.example.com/")).await,
            Err(PluginError::SchemeNotAllowed { .. })
        ));
    }

    /// ローカルの HTTP サーバーで、リダイレクト先の再照合と応答の受け取りを確認する。
    #[tokio::test]
    async fn execute_follows_declared_redirects_and_blocks_undeclared() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let resp = match path.as_str() {
                        "/to-ok" => format!(
                            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/ok\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        ),
                        "/to-evil" => "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.2:9/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                        "/loop" => "HTTP/1.1 302 Found\r\nLocation: /loop\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                        _ => "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_string(),
                    };
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                });
            }
        });

        let consented = dests(&[&format!("127.0.0.1:{port}")]);
        let request = |p: &str| PluginHttpRequest {
            url: format!("http://127.0.0.1:{port}{p}"),
            method: "GET".into(),
            headers: vec![],
            body_base64: None,
        };

        let resp = execute(&consented, request("/to-ok")).await.unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.url, format!("http://127.0.0.1:{port}/ok"));
        assert_eq!(general_purpose::STANDARD.decode(resp.body_base64).unwrap(), b"ok");

        assert!(matches!(
            execute(&consented, request("/to-evil")).await,
            Err(PluginError::Blocked {
                reason: BlockReason::RedirectNotDeclared,
                ..
            })
        ));
        assert_eq!(
            execute(&consented, request("/loop")).await.unwrap_err(),
            PluginError::TooManyRedirects
        );
    }
}
