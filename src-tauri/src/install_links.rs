//! Web links only enqueue an installation request. Download and consent remain in PluginManager.
use std::collections::VecDeque;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

use crate::plugins::store::is_valid_plugin_id;

const EVENT: &str = "plugins:install-link-changed";
const MAX_PENDING: usize = 10;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallTarget {
    pub repo: String,
    pub plugin_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub request_id: u32,
    #[serde(flatten)]
    pub target: InstallTarget,
}

/// Keep requests until explicitly dismissed, including while the settings WebView is loading.
#[derive(Default)]
pub struct InstallInbox {
    inner: Mutex<InboxState>,
}

#[derive(Default)]
struct InboxState {
    next_id: u32,
    pending: VecDeque<InstallRequest>,
}

impl InstallInbox {
    fn enqueue(&self, target: InstallTarget) {
        let mut inner = self.inner.lock();
        if inner.pending.len() >= MAX_PENDING || inner.pending.iter().any(|r| r.target == target) {
            return;
        }
        let Some(next_id) = inner.next_id.checked_add(1) else {
            return;
        };
        inner.next_id = next_id;
        inner.pending.push_back(InstallRequest {
            request_id: next_id,
            target,
        });
    }

    fn pending(&self) -> Option<InstallRequest> {
        self.inner.lock().pending.front().cloned()
    }

    fn dismiss(&self, request_id: u32) {
        let mut inner = self.inner.lock();
        if inner
            .pending
            .front()
            .is_some_and(|r| r.request_id == request_id)
        {
            inner.pending.pop_front();
        }
    }
}

/// Only accept a GitHub repository and an exact plugin ID, never an arbitrary download URL/path.
pub fn parse_install_link(input: &str) -> Option<InstallTarget> {
    if input.len() > 2048 || input.chars().any(char::is_control) {
        return None;
    }
    let url = Url::parse(input).ok()?;
    if url.scheme() != "notyra"
        || url.host_str() != Some("plugins")
        || url.path() != "/install"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let (mut repo, mut plugin_id) = (None, None);
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "repo" if repo.is_none() => repo = Some(value.into_owned()),
            "id" if plugin_id.is_none() => plugin_id = Some(value.into_owned()),
            _ => return None,
        }
    }
    let repo = repo?;
    let plugin_id = plugin_id?;
    let (owner, name) = repo.split_once('/')?;
    if owner.is_empty()
        || owner.len() > 39
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || name.is_empty()
        || name.len() > 100
        || name == "."
        || name == ".."
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        || !is_valid_plugin_id(&plugin_id)
    {
        return None;
    }
    Some(InstallTarget {
        repo: repo.to_ascii_lowercase(),
        plugin_id,
    })
}

fn receive(app: &AppHandle, urls: impl IntoIterator<Item = Url>) {
    let inbox = app.state::<InstallInbox>();
    let mut valid = false;
    for url in urls {
        if let Some(target) = parse_install_link(url.as_str()) {
            inbox.enqueue(target);
            valid = true;
        }
    }
    if valid {
        if let Err(error) = crate::commands::window::show_settings_window(app) {
            eprintln!("[notyra] could not open plugin installation settings: {error}");
        }
        let _ = app.emit_to("settings", EVENT, ());
    }
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // AppImages need runtime registration to point at their current executable location.
    #[cfg(target_os = "linux")]
    if let Err(error) = app.deep_link().register_all() {
        eprintln!("[notyra] could not register deep links: {error}");
    }
    let handle = app.clone();
    app.deep_link()
        .on_open_url(move |event| receive(&handle, event.urls()));
    if let Some(urls) = app.deep_link().get_current()? {
        receive(app, urls);
    }
    Ok(())
}

#[tauri::command]
pub fn get_pending_plugin_install(inbox: State<'_, InstallInbox>) -> Option<InstallRequest> {
    inbox.pending()
}

#[tauri::command]
pub fn dismiss_pending_plugin_install(
    app: AppHandle,
    inbox: State<'_, InstallInbox>,
    request_id: u32,
) {
    inbox.dismiss(request_id);
    let _ = app.emit_to("settings", EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: &str) -> InstallTarget {
        InstallTarget {
            repo: "yuma-shin/notyra-plugins".into(),
            plugin_id: id.into(),
        }
    }

    #[test]
    fn accepts_website_links_and_preserves_exact_theme_id() {
        assert_eq!(
            parse_install_link(
                "notyra://plugins/install?repo=Yuma-Shin%2Fnotyra-plugins&id=notyra-theme-blue"
            ),
            Some(target("notyra-theme-blue"))
        );
    }

    #[test]
    fn rejects_untrusted_shapes_and_ambiguous_queries() {
        for link in [
            "https://plugins/install?repo=o/r&id=p",
            "notyra://other/install?repo=o/r&id=p",
            "notyra://plugins/other?repo=o/r&id=p",
            "notyra://user@plugins/install?repo=o/r&id=p",
            "notyra://plugins:123/install?repo=o/r&id=p",
            "notyra://plugins/install?repo=o/r&id=p#fragment",
            "notyra://plugins/install?repo=o/r",
            "notyra://plugins/install?repo=o/r&id=p&id=q",
            "notyra://plugins/install?repo=o/r&repo=o/s&id=p",
            "notyra://plugins/install?repo=o/r&id=p&url=https://example.com/a.zip",
            "notyra://plugins/install?repo=https://github.com/o/r&id=p",
            "notyra://plugins/install?repo=o/..&id=p",
            "notyra://plugins/install?repo=o/r/extra&id=p",
            "notyra://plugins/install?repo=o/r&id=../p",
            "notyra://plugins/install?repo=o/r&id=node_modules",
            "notyra://plugins/install?repo=o%0A/r&id=p",
            "notyra://plugins/install?repo=o/r&id=p\n",
        ] {
            assert!(parse_install_link(link).is_none(), "accepted {link}");
        }
    }

    #[test]
    fn retains_deduplicated_requests_until_acknowledged_in_order() {
        let inbox = InstallInbox::default();
        inbox.enqueue(target("toc"));
        inbox.enqueue(target("toc"));
        inbox.enqueue(target("blue"));
        let first = inbox.pending().unwrap();
        assert_eq!(inbox.pending(), Some(first.clone()));
        inbox.dismiss(first.request_id + 1); // stale/out-of-order acknowledgements cannot lose a request
        assert_eq!(inbox.pending(), Some(first.clone()));
        inbox.dismiss(first.request_id);
        assert_eq!(inbox.pending().unwrap().target, target("blue"));
        inbox.dismiss(first.request_id);
        assert_eq!(inbox.pending().unwrap().target, target("blue"));
    }

    #[test]
    fn bounds_the_inbox_and_accepts_an_explicit_retry_after_dismissal() {
        let inbox = InstallInbox::default();
        for i in 0..20 {
            inbox.enqueue(target(&format!("plugin-{i}")));
        }
        assert_eq!(inbox.inner.lock().pending.len(), MAX_PENDING);
        let first = inbox.pending().unwrap();
        inbox.dismiss(first.request_id);
        inbox.enqueue(first.target);
        assert_eq!(inbox.inner.lock().pending.len(), MAX_PENDING);
        assert_ne!(
            inbox.inner.lock().pending.back().unwrap().request_id,
            first.request_id
        );
    }
}
