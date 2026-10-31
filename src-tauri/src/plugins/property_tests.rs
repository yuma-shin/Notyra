//! Generated inputs exercise security boundaries and real disk/network operations.
use super::{destination::*, gateway, notes_scope, protocol, store::*, PluginError};
use crate::commands::{markdown, plugin_notes};
use proptest::prelude::*;
use serde_json::json;
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::Path,
};

fn plugin(
    index: usize,
    enabled: bool,
    local: bool,
    generation: u64,
    mask: u8,
) -> InstalledPluginState {
    let permissions = [
        Permission::NotesRead,
        Permission::NotesWrite,
        Permission::Clipboard,
        Permission::ShellOpenExternal,
        Permission::Network,
    ];
    InstalledPluginState {
        id: format!("plugin-{index}"),
        version: format!("1.{generation}.0"),
        enabled,
        source: if local {
            PluginSource::Local {
                path: format!("/dev/{index}"),
            }
        } else {
            PluginSource::Github {
                owner: "owner".into(),
                repo: format!("repo-{index}"),
            }
        },
        consented_permissions: permissions
            .into_iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, p)| p)
            .collect(),
        consented_destinations: vec![format!("api-{index}.example.com")],
        generation,
        pending_consent: (mask & 32 != 0).then(|| PendingConsent {
            added_permissions: vec![Permission::Clipboard],
            added_destinations: vec!["localhost:3000".into()],
        }),
        disabled_reason: (!enabled).then_some(DisabledReason::User),
        installed_at: "2026-10-31T00:00:00Z".into(),
    }
}

// CIDR arithmetic is independent of the octet-based production implementation.
fn private_v4(ip: u32) -> bool {
    [
        (0, 32),
        (0x7f000000, 8),
        (0x0a000000, 8),
        (0xac100000, 12),
        (0xc0a80000, 16),
        (0xa9fe0000, 16),
    ]
    .iter()
    .any(|&(base, bits)| ip >> (32 - bits) == base >> (32 - bits))
}
fn private_v6(ip: u128) -> bool {
    let addr = Ipv6Addr::from(ip);
    if let Some(v4) = addr.to_ipv4_mapped() {
        return private_v4(u32::from(v4));
    }
    ip == 0 || ip == 1 || ip >> 118 == 0x3fa || ip >> 121 == 0x7e
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // Feature: plugin-system, Property 18: リダイレクトの再照合
    #[test]
    fn property_18_redirect_chain(allowed in prop::collection::vec(any::<bool>(), 1..=10)) {
        use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let visits = Arc::new(AtomicUsize::new(0));
            let recorded = visits.clone();
            let chain = allowed.clone();
            let server = tokio::spawn(async move {
                loop {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut buf = [0; 4096];
                    let n = socket.read(&mut buf).await.unwrap();
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let step: usize = request.split_whitespace().nth(1).unwrap().trim_start_matches('/').parse().unwrap();
                    recorded.fetch_add(1, Ordering::SeqCst);
                    let response = if step == chain.len() { "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_string() }
                    else { let host = if chain[step] { "127.0.0.1" } else { "127.0.0.2" }; format!("HTTP/1.1 302 Found\r\nLocation: http://{host}:{port}/{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", step + 1) };
                    socket.write_all(response.as_bytes()).await.unwrap();
                }
            });
            let result = gateway::execute(&[parse_destination(&format!("127.0.0.1:{port}")).unwrap()], gateway::PluginHttpRequest { url: format!("http://127.0.0.1:{port}/0"), method: "GET".into(), headers: vec![], body_base64: None }).await;
            let first_blocked = allowed.iter().position(|ok| !ok);
            assert_eq!(visits.load(Ordering::SeqCst), first_blocked.map_or(allowed.len() + 1, |i| i + 1));
            if first_blocked.is_some() { assert!(matches!(result, Err(PluginError::Blocked { .. }))); }
            else { assert_eq!(result.unwrap().status, 200); }
            server.abort();
        });
    }

    // Feature: plugin-system, Property 16: 通信先の分類
    #[test]
    fn property_16_classification(v4 in any::<u32>(), v6 in any::<u128>(), edge in prop::sample::select(vec![0u32, 0x7f000001, 0x0a000000, 0xac0fffff, 0xac100000, 0xac1fffff, 0xac200000, 0x64400001])) {
        for n in [v4, edge] {
            let ip = IpAddr::V4(Ipv4Addr::from(n));
            prop_assert_eq!(is_private_ip(&ip), private_v4(n));
            prop_assert_eq!(is_private_ip(&IpAddr::V6(Ipv4Addr::from(n).to_ipv6_mapped())), private_v4(n));
            prop_assert_eq!(classify(&parse_destination(&ip.to_string()).unwrap()), if private_v4(n) { DestClass::Private } else { DestClass::Public });
        }
        let ip = IpAddr::V6(Ipv6Addr::from(v6));
        prop_assert_eq!(is_private_ip(&ip), private_v6(v6));
        prop_assert_eq!(classify(&parse_destination("localhost").unwrap()), DestClass::Private);
        prop_assert_eq!(classify(&parse_destination("*.localhost").unwrap()), DestClass::Public);
    }

    // Feature: plugin-system, Property 17: Network_Gateway の宛先照合
    #[test]
    fn property_17_matching(port in 1u16..=65535, declared in prop::option::of(1u16..=65535), depth in 0usize..4, wildcard in any::<bool>(), scheme in prop::sample::select(vec!["http", "https", "ftp"])) {
        let declaration = format!("{}example.com{}", if wildcard { "*." } else { "" }, declared.map(|p| format!(":{p}")).unwrap_or_default());
        let host = format!("{}example.com", "sub.".repeat(depth));
        let url = url::Url::parse(&format!("{scheme}://{host}:{port}/")).unwrap();
        let result = gateway::check_request(&[parse_destination(&declaration).unwrap()], &url, None);
        let expected = scheme != "ftp" && (if wildcard { depth > 0 } else { depth == 0 }) && declared.map_or(port == 80 || port == 443, |p| p == port);
        prop_assert_eq!(result.is_ok(), expected);
        if scheme == "ftp" { prop_assert!(matches!(result, Err(PluginError::SchemeNotAllowed { .. })), "scheme rejected"); }
    }

    // Feature: plugin-system, Property 19: 名前解決結果の検査
    #[test]
    fn property_19_dns_results(public in any::<bool>(), ips in prop::collection::vec(prop::sample::select(vec!["0.0.0.0", "::", "::ffff:0.0.0.0", "127.0.0.1", "10.0.0.1", "172.32.0.1", "100.64.0.1", "8.8.8.8", "::1", "fc00::1", "fe80::1", "2001:4860::1"]), 1..12)) {
        let host = if public { "api.example.com" } else { "localhost" };
        let url = url::Url::parse(&format!("https://{host}/")).unwrap();
        let ips: Vec<IpAddr> = ips.iter().map(|s| s.parse().unwrap()).collect();
        let expected = ips.iter().all(|ip| public != match ip { IpAddr::V4(v) => private_v4(u32::from(*v)), IpAddr::V6(v) => private_v6(u128::from(*v)) });
        prop_assert_eq!(gateway::check_request(&[parse_destination(host).unwrap()], &url, Some(&ips)).is_ok(), expected);
    }

    // Feature: plugin-system, Property 23: Plugin ファイルの解決はディレクトリ内に限る
    #[test]
    fn property_23_protocol_containment(parts in prop::collection::vec(prop::sample::select(vec!["sub", ".", "..", "%2e%2e", "", "%2f", "C:", "\\", "%5c"]), 0..12)) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("a.js"), "export {}").unwrap();
        fs::write(dir.path().join("sub/a.js"), "export {}").unwrap();
        let rel = format!("{}/a.js", parts.join("/"));
        if let Ok(path) = protocol::resolve_plugin_file(dir.path(), &rel) {
            prop_assert!(path.starts_with(fs::canonicalize(dir.path()).unwrap()));
            prop_assert!(path.is_file());
        }
        for rel in ["a.js", "sub/../a.js", "%61.js"] { prop_assert!(protocol::resolve_plugin_file(dir.path(), rel).is_ok()); }
        for rel in ["../a.js", "%2e%2e/a.js", "C:/a.js", "\\a.js", "/a.js"] { prop_assert!(protocol::resolve_plugin_file(dir.path(), rel).is_err()); }
    }

    // Feature: plugin-system, Property 24: Installed_Plugin_State のラウンドトリップ
    #[test]
    fn property_24_persistence(items in prop::collection::vec((any::<bool>(), any::<bool>(), 0u64..1000, any::<u8>()), 0..12), warning in any::<bool>(), developer in any::<bool>()) {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::load(dir.path().to_path_buf()).unwrap();
        let expected = PluginStateFile { schema_version: 1, third_party_warning_acknowledged: warning, developer_mode: developer, plugins: items.iter().enumerate().map(|(i, &(enabled, local, generation, mask))| plugin(i, enabled, local, generation, mask)).collect() };
        store.update(|s| { *s = expected.clone(); Ok(()) }).unwrap();
        prop_assert_eq!(PluginStore::load(dir.path().to_path_buf()).unwrap().snapshot(), expected);
    }

    // Feature: plugin-system, Property 25: 状態遷移で無関係な状態は変わらない
    #[test]
    fn property_25_unrelated_state(ops in prop::collection::vec(0u8..6, 1..25), warning in any::<bool>()) {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::load(dir.path().to_path_buf()).unwrap();
        let other = vec![plugin(0, true, false, 0, 3), plugin(1, false, true, 12, 63)];
        store.update(|s| { s.plugins = other.clone(); s.third_party_warning_acknowledged = warning; Ok(()) }).unwrap();
        for op in ops {
            let next = store.update(|s| {
                match op {
                    0 if s.find("plugin-2").is_none() => s.plugins.push(plugin(2, true, false, 0, 0)),
                    1 => { if let Some(p) = s.find_mut("plugin-2") { p.version = "2.0.0".into(); p.generation += 1; } },
                    2 | 3 => { if let Some(p) = s.find_mut("plugin-2") { p.enabled = op == 2; } },
                    4 => s.plugins.retain(|p| p.id != "plugin-2"),
                    5 => s.developer_mode = !s.developer_mode,
                    _ => {}
                }
                Ok(())
            }).unwrap();
            prop_assert_eq!(next.third_party_warning_acknowledged, warning);
            prop_assert_eq!(next.plugins.iter().filter(|p| p.id != "plugin-2").cloned().collect::<Vec<_>>(), other.clone());
        }
    }

    // Feature: plugin-system, Property 39: ルートフォルダ外のパスの拒否
    #[test]
    fn property_39_notes_scope(parts in prop::collection::vec(prop::sample::select(vec!["a", "b", ".", "..", ""]), 0..15), relative in any::<bool>()) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("notes"); fs::create_dir(&root).unwrap();
        let path = if relative { Path::new("relative").join(parts.join("/")) } else { root.join(parts.join("/")) };
        let expected = !relative && notes_scope::normalize_lexically(&path).starts_with(&root);
        prop_assert_eq!(notes_scope::resolve_within_roots(&path, &[root]).is_ok(), expected);
    }

    // Feature: plugin-system, Property 40: 重複名の連番付与
    #[test]
    fn property_40_unique_names(occupied in prop::collection::btree_set(0usize..15, 0..15), moving in any::<bool>()) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("notes"); fs::create_dir(&root).unwrap();
        let name = |n| if n == 0 { "note.md".to_string() } else { format!("note-{n}.md") };
        for &n in &occupied { fs::write(root.join(name(n)), format!("existing {n}")).unwrap(); }
        let expected = (0usize..).find(|n| !occupied.contains(n)).unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let saved = rt.block_on(async {
            if moving {
                let source = dir.path().join("note.md"); fs::write(&source, "new").unwrap();
                markdown::move_note_file(&source, &root).await.unwrap().unwrap()
            } else { markdown::create_note_file(&root, "note", "new").await.unwrap() }
        });
        prop_assert_eq!(saved.file_name().unwrap().to_str().unwrap(), name(expected));
        for n in occupied { prop_assert_eq!(fs::read_to_string(root.join(name(n))).unwrap(), format!("existing {n}")); }
    }

    // Feature: plugin-system, Property 41: ノート書き込みと読み取りのラウンドトリップ
    #[test]
    fn property_41_note_roundtrip(text in ".{0,100}", tags in prop::collection::vec(".{0,30}", 0..5), number in -100000i64..100000, flag in any::<bool>(), key in prop_oneof![".{0,20}", prop::sample::select(vec!["true".into(), "null".into(), "123".into(), "yes".into(), "".into()])]) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md"); fs::write(&path, "old").unwrap();
        let state = PluginStateFile { plugins: vec![plugin(0, true, false, 0, 3)], ..Default::default() };
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        let path = path.to_string_lossy().into_owned();
        let mut fm = json!({ "title": format!("{}\n\"quoted\"\\path: # YAML", text), "tags": tags, "number": number, "flag": flag, "key: #\n": text });
        fm.as_object_mut().unwrap().insert(key, json!(text));
        let body = format!("# Body\n{text}\n");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let read = rt.block_on(async { plugin_notes::update(&state, "plugin-0", &roots, &path, &body, &fm).await.unwrap(); plugin_notes::read(&state, "plugin-0", &roots, &path).await.unwrap() });
        prop_assert_eq!(read.body, body);
        prop_assert_eq!(json!(read.front_matter), fm);
    }
}

#[tokio::test]
async fn unspecified_dns_addresses_are_blocked() {
    let public = parse_destination("api.example.com").unwrap();
    for ip in ["0.0.0.0", "::", "::ffff:0.0.0.0"] {
        let ips = [ip.parse().unwrap()];
        assert!(matches!(
            gateway::check_request(
                std::slice::from_ref(&public),
                &url::Url::parse("https://api.example.com").unwrap(),
                Some(&ips)
            ),
            Err(PluginError::Blocked { .. })
        ));
    }
}

#[tokio::test]
async fn rename_to_same_filename_preserves_note() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("Same.md");
    fs::write(&file, "# keep body\n").unwrap();
    let path = file.to_string_lossy().replace('\\', "/");
    markdown::rename_note(path.clone(), "Same".into())
        .await
        .unwrap();
    assert!(file.is_file());
    assert!(fs::read_to_string(&file).unwrap().contains("# keep body"));
    #[cfg(windows)]
    {
        markdown::rename_note(path, "same".into()).await.unwrap();
        assert!(file.is_file());
    }
}
