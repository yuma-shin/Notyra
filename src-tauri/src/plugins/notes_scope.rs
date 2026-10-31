//! NotesScope: ノートAPIのパスが登録済みルートフォルダ内にあるかの判定。
//!
//! Requirement 18.3 / 18.4: `..` などの相対表記を解決した後のパスが登録済み
//! ルートフォルダの内側（ルート自身を含む）にあるかを判定し、外側なら
//! `PluginError::OutOfScope` を返す。
//!
//! 呼び出し側は、[`resolve_within_roots`] が返したパスを使って入出力を行うこと。
//! 判定に使ったパスと実際に操作するパスを一致させるため（字句的な `..` の解決と
//! OS によるシンボリックリンク越しの `..` の解決の差を突かれないようにするため）。

use super::error::PluginError;
use std::path::{Component, Path, PathBuf};

/// `.` と `..` を字句的に解決する（ファイルシステムを参照しない）。
///
/// - `.` は取り除く。
/// - `..` は直前の通常の要素を取り除く。ルート（`/`、`C:\` 等）より上へは出ない。
/// - 相対パスの先頭にある、打ち消す要素のない `..` はそのまま残す。
pub fn normalize_lexically(p: &Path) -> PathBuf {
    let mut out: Vec<Component<'_>> = Vec::new();
    for comp in p.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => match out.last() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                // ルートの上へは出ない
                Some(Component::RootDir) | Some(Component::Prefix(_)) => {}
                // 相対パスの先頭の `..`（または連続する `..`）は残す
                Some(Component::ParentDir) | None => out.push(comp),
                Some(Component::CurDir) => unreachable!("CurDir is never pushed"),
            },
            other => out.push(other),
        }
    }
    out.iter().collect()
}

/// `path` を正規化し、`roots` のいずれかの配下（ルート自身を含む）であれば
/// 正規化済みのパスを返す。
///
/// 手順:
/// 1. 相対パスは拒否する。
/// 2. 字句的に `.` / `..` を解決する。
/// 3. 存在する最も深い祖先を `canonicalize` し（シンボリックリンクを解決）、
///    存在しない残りの要素を連結する。
/// 4. `canonicalize` 済みのルートと要素単位で前方一致を判定する
///    （`/notes` と `/notes2` は区別される）。
///
/// 存在しない、または相対パスのルートは無視する。
pub fn resolve_within_roots(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, PluginError> {
    let out_of_scope = || PluginError::OutOfScope {
        path: path.to_string_lossy().into_owned(),
    };

    if !path.is_absolute() {
        return Err(out_of_scope());
    }

    let normalized = normalize_lexically(path);
    let resolved = canonicalize_existing_prefix(&normalized).ok_or_else(out_of_scope)?;

    let inside = roots
        .iter()
        .filter(|r| r.is_absolute())
        .filter_map(|r| std::fs::canonicalize(normalize_lexically(r)).ok())
        .any(|root| resolved.starts_with(&root));

    if inside {
        Ok(strip_verbatim(resolved))
    } else {
        Err(out_of_scope())
    }
}

/// 存在する最も深い祖先を `canonicalize` し、存在しない残りの要素を連結する。
///
/// `normalized` は `..` / `.` を含まない絶対パスであること。
/// 存在するのに `canonicalize` できない要素（リンク先のないシンボリックリンク等）に
/// 当たった場合は、配下かどうかを確かめられないため `None` を返す。
fn canonicalize_existing_prefix(normalized: &Path) -> Option<PathBuf> {
    let mut rest: Vec<&std::ffi::OsStr> = Vec::new();
    let mut current = normalized;
    loop {
        match std::fs::canonicalize(current) {
            Ok(base) => {
                let mut out = base;
                for name in rest.iter().rev() {
                    out.push(name);
                }
                return Some(out);
            }
            Err(_) => {
                if std::fs::symlink_metadata(current).is_ok() {
                    // 存在するが解決できない（リンク切れのシンボリックリンク等）
                    return None;
                }
                let name = current.file_name()?;
                rest.push(name);
                current = current.parent()?;
            }
        }
    }
}

/// Windows の `canonicalize` が返す `\\?\` 形式（verbatim パス）を通常の形式に戻す。
///
/// 通常形式にすると意味が変わる可能性があるパス（長いパス、末尾が `.` や空白の要素、
/// 予約デバイス名）は verbatim のまま返す。Windows 以外では何もしない。
fn strip_verbatim(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        use std::path::Prefix;

        const RESERVED: [&str; 22] = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
            "LPT9",
        ];

        let Some(s) = p.to_str() else {
            return p;
        };
        if s.len() >= 260 {
            return p;
        }
        let unsafe_component = p.components().any(|c| match c {
            Component::Normal(n) => {
                let n = n.to_string_lossy();
                let stem = n.split('.').next().unwrap_or("").trim_end();
                n.ends_with('.')
                    || n.ends_with(' ')
                    || RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem))
            }
            _ => false,
        });
        if unsafe_component {
            return p;
        }
        if let Some(Component::Prefix(prefix)) = p.components().next() {
            match prefix.kind() {
                // `\\?\C:\...` → `C:\...`
                Prefix::VerbatimDisk(_) => return PathBuf::from(&s[4..]),
                // `\\?\UNC\server\share\...` → `\\server\share\...`
                Prefix::VerbatimUNC(_, _) => return PathBuf::from(format!(r"\\{}", &s[8..])),
                _ => {}
            }
        }
        p
    }
    #[cfg(not(windows))]
    {
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn canon(p: &Path) -> PathBuf {
        strip_verbatim(fs::canonicalize(p).unwrap())
    }

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("notes");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub").join("a.md"), "# a").unwrap();
        (tmp, root)
    }

    fn assert_out_of_scope(r: Result<PathBuf, PluginError>) {
        assert!(
            matches!(r, Err(PluginError::OutOfScope { .. })),
            "expected OutOfScope, got {r:?}"
        );
    }

    #[test]
    fn normalize_resolves_dot_and_dotdot() {
        let base = std::env::temp_dir();
        assert_eq!(
            normalize_lexically(&base.join("a").join(".").join("b").join("..").join("c")),
            normalize_lexically(&base).join("a").join("c")
        );
        assert_eq!(
            normalize_lexically(Path::new("a/./b/../c")),
            PathBuf::from("a").join("c")
        );
        // 相対パスの先頭の `..` は残る
        assert_eq!(
            normalize_lexically(Path::new("../a/../../b")),
            PathBuf::from("..").join("..").join("b")
        );
    }

    #[test]
    fn normalize_does_not_escape_filesystem_root() {
        let base = std::env::temp_dir();
        let fs_root: PathBuf = base.ancestors().last().unwrap().to_path_buf();
        let p = fs_root.join("..").join("..").join("x");
        assert_eq!(normalize_lexically(&p), fs_root.join("x"));
    }

    #[test]
    fn existing_file_inside_root_is_accepted() {
        let (_tmp, root) = setup();
        let target = root.join("sub").join("a.md");
        let got = resolve_within_roots(&target, std::slice::from_ref(&root)).unwrap();
        assert_eq!(got, canon(&target));
    }

    #[test]
    fn root_itself_is_accepted() {
        let (_tmp, root) = setup();
        let got = resolve_within_roots(&root, std::slice::from_ref(&root)).unwrap();
        assert_eq!(got, canon(&root));
    }

    #[test]
    fn nonexistent_nested_file_under_root_is_accepted() {
        let (_tmp, root) = setup();
        let target = root.join("x").join("y").join("new.md");
        let got = resolve_within_roots(&target, std::slice::from_ref(&root)).unwrap();
        assert_eq!(got, canon(&root).join("x").join("y").join("new.md"));
    }

    #[test]
    fn dotdot_inside_root_is_resolved() {
        let (_tmp, root) = setup();
        let target = root.join("sub").join("..").join("sub").join("a.md");
        let got = resolve_within_roots(&target, std::slice::from_ref(&root)).unwrap();
        assert_eq!(got, canon(&root.join("sub").join("a.md")));
    }

    #[test]
    fn dotdot_escape_is_rejected() {
        let (tmp, root) = setup();
        fs::write(tmp.path().join("secret.md"), "s").unwrap();
        assert_out_of_scope(resolve_within_roots(
            &root.join("sub").join("..").join("..").join("secret.md"),
            std::slice::from_ref(&root),
        ));
        assert_out_of_scope(resolve_within_roots(&root.join(".."), std::slice::from_ref(&root)));
    }

    #[test]
    fn sibling_with_shared_prefix_is_rejected() {
        let (tmp, root) = setup();
        let sibling = tmp.path().join("notes2");
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("b.md"), "b").unwrap();
        assert_out_of_scope(resolve_within_roots(&sibling.join("b.md"), std::slice::from_ref(&root)));
        assert_out_of_scope(resolve_within_roots(
            &tmp.path().join("notes2-new.md"),
            &[root],
        ));
    }

    #[test]
    fn relative_path_is_rejected() {
        let (_tmp, root) = setup();
        assert_out_of_scope(resolve_within_roots(Path::new("sub/a.md"), std::slice::from_ref(&root)));
        assert_out_of_scope(resolve_within_roots(Path::new("."), &[root]));
    }

    #[test]
    fn no_roots_or_missing_roots_reject_everything() {
        let (tmp, root) = setup();
        let target = root.join("sub").join("a.md");
        assert_out_of_scope(resolve_within_roots(&target, &[]));
        assert_out_of_scope(resolve_within_roots(
            &target,
            &[tmp.path().join("does-not-exist"), PathBuf::from("notes")],
        ));
    }

    #[test]
    fn any_of_multiple_roots_matches_and_roots_are_normalized() {
        let (tmp, root) = setup();
        let other = tmp.path().join("other");
        fs::create_dir_all(&other).unwrap();
        let target = root.join("sub").join("a.md");
        // `.../notes/sub/..` は `.../notes` として扱われる
        let roots = [other, root.join("sub").join("..")];
        let got = resolve_within_roots(&target, &roots).unwrap();
        assert_eq!(got, canon(&target));
    }

    #[cfg(windows)]
    #[test]
    fn returned_path_is_not_verbatim_on_windows() {
        let (_tmp, root) = setup();
        let got = resolve_within_roots(&root.join("sub").join("a.md"), &[root]).unwrap();
        assert!(!got.to_string_lossy().starts_with(r"\\?\"), "{got:?}");
        assert!(fs::metadata(&got).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;
        let (tmp, root) = setup();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("x.md"), "x").unwrap();
        symlink(&outside, root.join("link")).unwrap();
        // 既存ファイル・新規ファイルのどちらもリンク先で判定する
        assert_out_of_scope(resolve_within_roots(
            &root.join("link").join("x.md"),
            std::slice::from_ref(&root),
        ));
        assert_out_of_scope(resolve_within_roots(
            &root.join("link").join("new.md"),
            std::slice::from_ref(&root),
        ));
        // リンク切れのシンボリックリンクは確かめられないため拒否する
        symlink(tmp.path().join("missing"), root.join("dangling")).unwrap();
        assert_out_of_scope(resolve_within_roots(
            &root.join("dangling").join("new.md"),
            &[root],
        ));
    }
}
