//! Declared_Destination の解析・分類（Destination_Classifier）・照合。
//!
//! 受け付ける書式は TypeScript 側の `DECLARED_DESTINATION_PATTERN`
//! （`src/shared/plugin/manifest.ts`、Requirement 2.10）と同じ。
//!
//! - ホスト名: ASCII 英数字と `-` のラベルを `.` で連結（各ラベル1〜63文字、先頭・末尾は英数字、
//!   最後のラベルは英字を1文字以上含む）。末尾のドットは不可
//! - ワイルドカード: 先頭の `*.` に続くホスト名
//! - IPv4: 10進4オクテット（先頭ゼロ不可）
//! - IPv6: 角括弧で囲んだ表記（`[::1]`）
//! - 任意のポート: `:` に続く 1〜65535（先頭ゼロ不可）

use serde::Serialize;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Declared_Destination のホスト部分。ホスト名は小文字で保持する。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DestHost {
    /// 完全一致のホスト名
    Name(String),
    /// `*.<suffix>` の `<suffix>`（`*.` を除いたドメイン）
    Wildcard(String),
    Ip(IpAddr),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destination {
    pub host: DestHost,
    /// `None` はポート未指定（80 と 443 にのみ一致する。Requirement 7.10）
    pub port: Option<u16>,
}

/// Destination_Classifier の分類結果（Requirement 7.1）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DestClass {
    Private,
    Public,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestParseError {
    Empty,
    InvalidHost,
    InvalidPort,
}

impl fmt::Display for DestParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            DestParseError::Empty => "destination is empty",
            DestParseError::InvalidHost => "destination host is invalid",
            DestParseError::InvalidPort => "destination port must be 1-65535",
        };
        f.write_str(s)
    }
}

impl std::error::Error for DestParseError {}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/// Declared_Destination の文字列を解析する（Requirement 2.10）。
pub fn parse_destination(s: &str) -> Result<Destination, DestParseError> {
    if s.is_empty() {
        return Err(DestParseError::Empty);
    }

    // IPv6: `[addr]` または `[addr]:port`
    if let Some(rest) = s.strip_prefix('[') {
        let (inner, after) = rest.split_once(']').ok_or(DestParseError::InvalidHost)?;
        let ip = parse_ipv6_literal(inner).ok_or(DestParseError::InvalidHost)?;
        let port = match after {
            "" => None,
            _ => Some(
                after
                    .strip_prefix(':')
                    .and_then(parse_port)
                    .ok_or(DestParseError::InvalidPort)?,
            ),
        };
        return Ok(Destination {
            host: DestHost::Ip(IpAddr::V6(ip)),
            port,
        });
    }

    // 角括弧なしのホストは `:` を含まないため、最初の `:` 以降をポートとみなす
    let (host, port) = match s.split_once(':') {
        Some((h, p)) => (h, Some(parse_port(p).ok_or(DestParseError::InvalidPort)?)),
        None => (s, None),
    };

    let host = if let Some(suffix) = host.strip_prefix("*.") {
        if !is_valid_hostname(suffix) {
            return Err(DestParseError::InvalidHost);
        }
        DestHost::Wildcard(suffix.to_ascii_lowercase())
    } else if let Some(ip) = parse_ipv4_strict(host) {
        DestHost::Ip(IpAddr::V4(ip))
    } else if is_valid_hostname(host) {
        DestHost::Name(host.to_ascii_lowercase())
    } else {
        return Err(DestParseError::InvalidHost);
    };

    Ok(Destination { host, port })
}

/// 1〜65535 の10進数（先頭ゼロ・符号不可）。
fn parse_port(s: &str) -> Option<u16> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || s.starts_with('0') {
        return None;
    }
    s.parse::<u16>().ok().filter(|p| *p != 0)
}

/// 10進4オクテットの IPv4（各オクテット 0〜255、先頭ゼロ不可）。
fn parse_ipv4_strict(s: &str) -> Option<Ipv4Addr> {
    let mut octets = [0u8; 4];
    let mut parts = s.split('.');
    for octet in &mut octets {
        let part = parts.next()?;
        if part.is_empty()
            || part.len() > 3
            || !part.bytes().all(|b| b.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return None;
        }
        *octet = part.parse::<u8>().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(Ipv4Addr::from(octets))
}

/// 角括弧内の IPv6 表記。ゾーン ID（`%`）は受け付けない。
fn parse_ipv6_literal(s: &str) -> Option<Ipv6Addr> {
    if s.contains('%') {
        return None;
    }
    s.parse::<Ipv6Addr>().ok()
}

/// ホスト名の書式（TS 側の `HOSTNAME` と同じ規則）。
fn is_valid_hostname(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let labels: Vec<&str> = s.split('.').collect();
    let valid_labels = labels.iter().all(|label| {
        let bytes = label.as_bytes();
        !bytes.is_empty()
            && bytes.len() <= 63
            && bytes
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
            && bytes[0] != b'-'
            && bytes[bytes.len() - 1] != b'-'
    });
    // 最後のラベルが英字を含むことで、数字だけのホスト名（不正な IPv4 を含む）を除外する
    valid_labels
        && labels
            .last()
            .is_some_and(|last| last.bytes().any(|b| b.is_ascii_alphabetic()))
}

// ---------------------------------------------------------------------------
// 分類（Requirement 7.1, 7.2, 7.3, 7.18）
// ---------------------------------------------------------------------------

/// Declared_Destination を Private_Destination / Public_Destination に分類する。
///
/// ホスト名 `localhost` のみ Private。その他のホスト名（`foo.localhost`、`nas.local` を含む）と
/// ワイルドカードは Public。IP アドレスは `is_private_ip` に従う。
pub fn classify(d: &Destination) -> DestClass {
    let private = match &d.host {
        DestHost::Name(name) => name == "localhost",
        DestHost::Wildcard(_) => false,
        DestHost::Ip(ip) => is_private_ip(ip),
    };
    if private {
        DestClass::Private
    } else {
        DestClass::Public
    }
}

/// Glossary の Private_Destination のアドレス範囲に含まれるかを判定する。
///
/// IPv4: 0.0.0.0/32、127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、169.254.0.0/16。
/// IPv6: ::、::1、fe80::/10、fc00::/7。IPv4 射影 IPv6（`::ffff:a.b.c.d`）は IPv4 として判定する。
/// CGNAT（100.64.0.0/10）は含まない。
pub fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_ipv4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_private_ipv4(&v4),
            None => is_private_ipv6(v6),
        },
    }
}

fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    ip.is_unspecified() // 0.0.0.0/32
        || a == 127 // 127.0.0.0/8
        || a == 10 // 10.0.0.0/8
        || (a == 172 && (16..=31).contains(&b)) // 172.16.0.0/12
        || (a == 192 && b == 168) // 192.168.0.0/16
        || (a == 169 && b == 254) // 169.254.0.0/16
}

fn is_private_ipv6(ip: &Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    ip.is_unspecified() // ::
        || *ip == Ipv6Addr::LOCALHOST // ::1
        || (first & 0xffc0) == 0xfe80 // fe80::/10
        || (first & 0xfe00) == 0xfc00 // fc00::/7
}

// ---------------------------------------------------------------------------
// 照合（Requirement 7.8, 7.9, 7.10, 7.11）
// ---------------------------------------------------------------------------

/// スキームとポート指定から実効ポートを返す（Requirement 7.8）。
///
/// ポート未指定のとき `http` は 80、`https` は 443。それ以外のスキームでポート未指定なら 0 を返す
/// （0 はどの Declared_Destination にも一致しない。スキームの拒否は Network_Gateway が先に行う）。
pub fn effective_port(scheme: &str, port: Option<u16>) -> u16 {
    match port {
        Some(p) => p,
        None if scheme.eq_ignore_ascii_case("http") => 80,
        None if scheme.eq_ignore_ascii_case("https") => 443,
        None => 0,
    }
}

/// 要求のホストと実効ポートが Declared_Destination に一致するかを判定する。
///
/// - ポート: 指定ありはそのポートのみ（7.9）、指定なしは 80 と 443 のみ（7.10）
/// - `Name`: 大文字小文字を無視した完全一致
/// - `Wildcard(d)`: `d` 自体を除く、`d` の任意の深さのサブドメイン（7.11）
/// - `Ip`: 要求ホストを IP として解析した値と等しい（IPv6 の角括弧は省略可）
///
/// 要求ホストは小文字化し、末尾のドットを1つ除去してから比較する。
pub fn matches(d: &Destination, host: &str, port: u16) -> bool {
    let port_ok = match d.port {
        Some(p) => port == p,
        None => port == 80 || port == 443,
    };
    if !port_ok {
        return false;
    }

    let host = host.strip_suffix('.').unwrap_or(host).to_ascii_lowercase();
    match &d.host {
        DestHost::Name(name) => host == *name,
        DestHost::Wildcard(suffix) => host
            .strip_suffix(suffix.as_str())
            .and_then(|prefix| prefix.strip_suffix('.'))
            .is_some_and(|sub| !sub.is_empty()),
        DestHost::Ip(ip) => parse_request_ip(&host).is_some_and(|req| req == *ip),
    }
}

fn parse_request_ip(host: &str) -> Option<IpAddr> {
    let inner = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    inner.parse::<IpAddr>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Destination {
        parse_destination(s).unwrap_or_else(|e| panic!("{s}: {e}"))
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    // --- parse_destination ---

    #[test]
    fn parses_hostnames_wildcards_and_ips() {
        assert_eq!(
            parse("API.Example.com"),
            Destination {
                host: DestHost::Name("api.example.com".into()),
                port: None
            }
        );
        assert_eq!(
            parse("localhost:8080"),
            Destination {
                host: DestHost::Name("localhost".into()),
                port: Some(8080)
            }
        );
        assert_eq!(
            parse("*.Example.com:443"),
            Destination {
                host: DestHost::Wildcard("example.com".into()),
                port: Some(443)
            }
        );
        assert_eq!(
            parse("192.168.1.10:65535"),
            Destination {
                host: DestHost::Ip(ip("192.168.1.10")),
                port: Some(65535)
            }
        );
        assert_eq!(
            parse("[::1]:1"),
            Destination {
                host: DestHost::Ip(ip("::1")),
                port: Some(1)
            }
        );
        assert_eq!(
            parse("[::ffff:10.0.0.1]"),
            Destination {
                host: DestHost::Ip(ip("::ffff:10.0.0.1")),
                port: None
            }
        );
    }

    #[test]
    fn rejects_invalid_syntax() {
        for s in [
            "",
            "example.com.",
            "*.",
            "*",
            "a.*.example.com",
            "**.example.com",
            "-bad.com",
            "bad-.com",
            "exa_mple.com",
            "ex ample.com",
            "例え.jp",
            "1.2.3",
            "256.1.1.1",
            "01.2.3.4",
            "1.2.3.4.5",
            "::1",
            "[::1",
            "[::1]x",
            "[fe80::1%eth0]",
            "[1.2.3.4]",
            &format!("{}.com", "a".repeat(64)),
        ] {
            assert!(parse_destination(s).is_err(), "should reject {s:?}");
        }
        for s in [
            "example.com:0",
            "example.com:65536",
            "example.com:080",
            "example.com:",
            "example.com:+80",
            "[::1]:",
            "a.com:1:2",
        ] {
            assert_eq!(
                parse_destination(s),
                Err(DestParseError::InvalidPort),
                "{s:?}"
            );
        }
    }

    #[test]
    fn accepts_max_length_label_and_numeric_inner_labels() {
        assert!(parse_destination(&format!("{}.com", "a".repeat(63))).is_ok());
        assert!(parse_destination("1.2.3.example").is_ok());
        assert!(parse_destination("*.com").is_ok());
    }

    // --- is_private_ip / classify ---

    #[test]
    fn ipv4_private_range_boundaries() {
        let cases = [
            ("127.0.0.1", true),
            ("127.255.255.255", true),
            ("128.0.0.1", false),
            ("10.0.0.0", true),
            ("10.255.255.255", true),
            ("11.0.0.0", false),
            ("172.15.255.255", false),
            ("172.16.0.0", true),
            ("172.31.255.255", true),
            ("172.32.0.0", false),
            ("192.167.255.255", false),
            ("192.168.0.0", true),
            ("192.168.255.255", true),
            ("192.169.0.0", false),
            ("169.253.255.255", false),
            ("169.254.0.0", true),
            ("169.254.255.255", true),
            ("169.255.0.0", false),
            ("100.63.255.255", false),
            ("100.64.0.0", false),
            ("100.64.0.1", false),
            ("100.127.255.255", false),
            ("8.8.8.8", false),
            ("0.0.0.0", true),
        ];
        for (addr, expected) in cases {
            assert_eq!(is_private_ip(&ip(addr)), expected, "{addr}");
        }
    }

    #[test]
    fn ipv6_private_range_boundaries() {
        let cases = [
            ("::1", true),
            ("::2", false),
            ("::", true),
            ("fe7f:ffff::1", false),
            ("fe80::", true),
            ("fe80::1", true),
            ("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true),
            ("fec0::", false),
            ("fbff:ffff::1", false),
            ("fc00::", true),
            ("fd12:3456::1", true),
            ("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true),
            ("fe00::", false),
            ("2001:db8::1", false),
            // IPv4 射影 IPv6 は IPv4 として判定する
            ("::ffff:10.0.0.1", true),
            ("::ffff:127.0.0.1", true),
            ("::ffff:172.32.0.1", false),
            ("::ffff:100.64.0.1", false),
            ("::ffff:8.8.8.8", false),
        ];
        for (addr, expected) in cases {
            assert_eq!(is_private_ip(&ip(addr)), expected, "{addr}");
        }
    }

    #[test]
    fn classify_follows_requirement_7() {
        let cases = [
            ("localhost", DestClass::Private),
            ("LOCALHOST:3000", DestClass::Private),
            ("foo.localhost", DestClass::Public),
            ("nas.local", DestClass::Public),
            ("*.localhost", DestClass::Public),
            ("*.example.com", DestClass::Public),
            ("api.example.com", DestClass::Public),
            ("127.0.0.1:11434", DestClass::Private),
            ("192.168.0.5", DestClass::Private),
            ("172.32.0.1", DestClass::Public),
            ("100.64.0.1", DestClass::Public),
            ("[::1]", DestClass::Private),
            ("[fd00::1]:8080", DestClass::Private),
            ("[::ffff:10.0.0.1]", DestClass::Private),
            ("[2001:db8::1]", DestClass::Public),
        ];
        for (s, expected) in cases {
            assert_eq!(classify(&parse(s)), expected, "{s}");
        }
    }

    // --- effective_port / matches ---

    #[test]
    fn effective_port_defaults() {
        assert_eq!(effective_port("http", None), 80);
        assert_eq!(effective_port("HTTPS", None), 443);
        assert_eq!(effective_port("https", Some(8443)), 8443);
        assert_eq!(effective_port("ws", None), 0);
    }

    #[test]
    fn port_rules() {
        let no_port = parse("api.example.com");
        assert!(matches(&no_port, "api.example.com", 80));
        assert!(matches(&no_port, "api.example.com", 443));
        assert!(!matches(&no_port, "api.example.com", 8080));
        assert!(!matches(&no_port, "api.example.com", 0));

        let with_port = parse("localhost:11434");
        assert!(matches(&with_port, "localhost", 11434));
        assert!(!matches(&with_port, "localhost", 80));
        assert!(!matches(&with_port, "localhost", 443));

        let https_only = parse("api.example.com:443");
        assert!(matches(&https_only, "api.example.com", 443));
        assert!(!matches(&https_only, "api.example.com", 80));
    }

    #[test]
    fn hostname_matching_is_exact_and_case_insensitive() {
        let d = parse("api.example.com");
        assert!(matches(&d, "API.Example.COM", 443));
        assert!(matches(&d, "api.example.com.", 443));
        assert!(!matches(&d, "example.com", 443));
        assert!(!matches(&d, "x.api.example.com", 443));
        assert!(!matches(&d, "api.example.com.evil.com", 443));
        assert!(!matches(&d, "evilapi.example.com", 443));
    }

    #[test]
    fn wildcard_matches_subdomains_but_not_apex() {
        let d = parse("*.example.com");
        assert!(matches(&d, "a.example.com", 443));
        assert!(matches(&d, "a.b.c.example.com", 80));
        assert!(matches(&d, "A.EXAMPLE.com", 443));
        assert!(!matches(&d, "example.com", 443));
        assert!(!matches(&d, "example.com.", 443));
        assert!(!matches(&d, ".example.com", 443));
        assert!(!matches(&d, "badexample.com", 443));
        assert!(!matches(&d, "a.example.com.evil.com", 443));
        assert!(!matches(&d, "a.example.com", 8080));
    }

    #[test]
    fn ip_matching_compares_values() {
        let v4 = parse("192.168.1.10:8080");
        assert!(matches(&v4, "192.168.1.10", 8080));
        assert!(!matches(&v4, "192.168.1.11", 8080));
        assert!(!matches(&v4, "192.168.1.10", 80));

        let v6 = parse("[::1]:3000");
        assert!(matches(&v6, "[::1]", 3000));
        assert!(matches(&v6, "::1", 3000));
        assert!(matches(&v6, "[0:0:0:0:0:0:0:1]", 3000));
        assert!(!matches(&v6, "localhost", 3000));
        assert!(!matches(&v6, "127.0.0.1", 3000));

        // ホスト名の宛先は IP の要求に一致しない
        let name = parse("localhost");
        assert!(!matches(&name, "127.0.0.1", 80));
    }
}
