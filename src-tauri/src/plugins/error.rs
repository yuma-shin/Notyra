//! プラグインシステム共通のエラー型。
//!
//! `#[serde(tag = "kind")]` により `{ "kind": "<camelCase>", ...フィールド }` の形で
//! フロントエンドへシリアライズされる。`kind` の値は TypeScript 側の
//! `PluginApiErrorKind`（`src/shared/plugin/api.ts`）と重なるものは同じ名前を使う。

use serde::Serialize;
use std::fmt;

/// Network_Gateway が通信をブロックした理由。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockReason {
    /// 要求先が同意済み Declared_Destination のいずれにも一致しない（Requirement 7.12）
    NotDeclared,
    /// リダイレクト先が同意済み Declared_Destination に一致しない（Requirement 7.13）
    RedirectNotDeclared,
    /// Public_Destination として一致したホスト名が Private の IP に解決された（Requirement 7.14）
    ResolvedToPrivate,
    /// `localhost` として一致したホスト名が Private 範囲外の IP に解決された（Requirement 7.15）
    ResolvedToNonPrivate,
}

impl fmt::Display for BlockReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            BlockReason::NotDeclared => "destination is not declared",
            BlockReason::RedirectNotDeclared => "redirect destination is not declared",
            BlockReason::ResolvedToPrivate => "public destination resolved to a private address",
            BlockReason::ResolvedToNonPrivate => "localhost resolved to a non-private address",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PluginError {
    /// 指定リポジトリが存在しない（Requirement 3.4）
    RepoNotFound,
    /// Latest_Release が存在しない（Requirement 3.5）
    NoRelease,
    /// Latest_Release に `notyra-plugin.zip` がない（Requirement 3.6）
    NoPackage,
    /// GitHub API の利用制限（Requirement 3.8）。`reset_at` は UNIX 秒
    RateLimited { reset_at: Option<u64> },
    /// 通信失敗・タイムアウト・5xx（Requirement 3.7）
    Network { message: String },
    /// Plugin_Package または展開後サイズの上限超過
    TooLarge,
    InvalidZip { message: String },
    /// Plugin_Package のルートに `package.json` がない
    ManifestMissing,
    AlreadyInstalled,
    NotInstalled,
    Io { message: String },
    /// 同意済みでない Permission を要する操作（Requirement 6.9）
    PermissionDenied { permission: String },
    SchemeNotAllowed { scheme: String },
    Blocked { host: String, port: u16, reason: BlockReason },
    OutOfScope { path: String },
    NotFound { path: String },
    NameConflict { path: String },
    TooManyRedirects,
    ResponseTooLarge,
    Timeout,
    CorruptState { message: String },
    /// Plugin_API に渡された引数が不正（解析できない URL、不正なメソッド・ヘッダ等）
    InvalidArgument { message: String },
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PluginError::RepoNotFound => f.write_str("repository not found"),
            PluginError::NoRelease => f.write_str("repository has no latest release"),
            PluginError::NoPackage => {
                f.write_str("latest release has no matching <id>.zip or notyra-plugin.zip asset")
            }
            PluginError::RateLimited { reset_at: Some(t) } => {
                write!(f, "GitHub API rate limit exceeded (resets at {t})")
            }
            PluginError::RateLimited { reset_at: None } => {
                f.write_str("GitHub API rate limit exceeded")
            }
            PluginError::Network { message } => write!(f, "network error: {message}"),
            PluginError::TooLarge => f.write_str("plugin package exceeds the size limit"),
            PluginError::InvalidZip { message } => write!(f, "invalid zip: {message}"),
            PluginError::ManifestMissing => {
                f.write_str("package.json not found at the package root")
            }
            PluginError::AlreadyInstalled => f.write_str("plugin is already installed"),
            PluginError::NotInstalled => f.write_str("plugin is not installed"),
            PluginError::Io { message } => write!(f, "I/O error: {message}"),
            PluginError::PermissionDenied { permission } => {
                write!(f, "permission denied: {permission}")
            }
            PluginError::SchemeNotAllowed { scheme } => {
                write!(f, "scheme not allowed: {scheme}")
            }
            PluginError::Blocked { host, port, reason } => {
                write!(f, "request to {host}:{port} blocked: {reason}")
            }
            PluginError::OutOfScope { path } => {
                write!(f, "path is outside the registered root folders: {path}")
            }
            PluginError::NotFound { path } => write!(f, "not found: {path}"),
            PluginError::NameConflict { path } => write!(f, "name already exists: {path}"),
            PluginError::TooManyRedirects => f.write_str("too many redirects"),
            PluginError::ResponseTooLarge => f.write_str("response exceeds the size limit"),
            PluginError::Timeout => f.write_str("request timed out"),
            PluginError::CorruptState { message } => {
                write!(f, "plugin state is corrupt: {message}")
            }
            PluginError::InvalidArgument { message } => {
                write!(f, "invalid argument: {message}")
            }
        }
    }
}

impl std::error::Error for PluginError {}

impl From<std::io::Error> for PluginError {
    fn from(e: std::io::Error) -> Self {
        PluginError::Io {
            message: e.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unit_variant_serializes_kind_only() {
        let v = serde_json::to_value(PluginError::RepoNotFound).unwrap();
        assert_eq!(v, json!({ "kind": "repoNotFound" }));
    }

    #[test]
    fn struct_variant_fields_are_camel_case() {
        let v = serde_json::to_value(PluginError::RateLimited {
            reset_at: Some(1_700_000_000),
        })
        .unwrap();
        assert_eq!(v, json!({ "kind": "rateLimited", "resetAt": 1_700_000_000u64 }));
    }

    #[test]
    fn blocked_serializes_reason() {
        let v = serde_json::to_value(PluginError::Blocked {
            host: "example.com".into(),
            port: 443,
            reason: BlockReason::ResolvedToPrivate,
        })
        .unwrap();
        assert_eq!(
            v,
            json!({
                "kind": "blocked",
                "host": "example.com",
                "port": 443,
                "reason": "resolvedToPrivate"
            })
        );
    }

    #[test]
    fn kinds_shared_with_typescript_match() {
        // TS の PluginApiErrorKind と共通の kind 名
        let cases = [
            (PluginError::PermissionDenied { permission: "network".into() }, "permissionDenied"),
            (PluginError::SchemeNotAllowed { scheme: "ws".into() }, "schemeNotAllowed"),
            (PluginError::OutOfScope { path: "/x".into() }, "outOfScope"),
            (PluginError::NotFound { path: "/x".into() }, "notFound"),
            (PluginError::NameConflict { path: "/x".into() }, "nameConflict"),
            (PluginError::Io { message: "e".into() }, "io"),
            (PluginError::Network { message: "e".into() }, "network"),
            (PluginError::Timeout, "timeout"),
            (PluginError::ResponseTooLarge, "responseTooLarge"),
            (PluginError::TooManyRedirects, "tooManyRedirects"),
            (PluginError::InvalidArgument { message: "e".into() }, "invalidArgument"),
        ];
        for (err, kind) in cases {
            let v = serde_json::to_value(&err).unwrap();
            assert_eq!(v["kind"], kind);
        }
    }

    #[test]
    fn display_and_io_conversion() {
        let e: PluginError = std::io::Error::other("disk").into();
        assert_eq!(e, PluginError::Io { message: "disk".into() });
        assert_eq!(e.to_string(), "I/O error: disk");
        let e: &dyn std::error::Error = &PluginError::NoPackage;
        assert!(e.to_string().contains("notyra-plugin.zip"));
    }
}
