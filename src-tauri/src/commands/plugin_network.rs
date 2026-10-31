//! Network_Gateway の `#[tauri::command]`（`plugin_http_request`）。

use tauri::State;

use crate::plugins::destination::{parse_destination, Destination};
use crate::plugins::gateway::{self, PluginHttpRequest, PluginHttpResponse};
use crate::plugins::store::{Permission, PluginStateFile};
use crate::plugins::PluginError;
use crate::state::AppState;

/// Plugin の HTTP / HTTPS 通信を Network_Gateway 経由で実行する（Requirement 7.6）。
///
/// Plugin_API 側の権限チェックとは別に、state.json の同意済み `network` Permission と
/// 同意済み Declared_Destination を Rust でも確認する（Requirement 6.9）。
#[tauri::command]
pub async fn plugin_http_request(
    state: State<'_, AppState>,
    plugin_id: String,
    request: PluginHttpRequest,
) -> Result<PluginHttpResponse, PluginError> {
    let consented = consented_network_destinations(&state.plugin_store.snapshot(), &plugin_id)?;
    gateway::execute(&consented, request).await
}

/// `network` Permission が同意済みであることを確認し、同意済み Declared_Destination を返す。
///
/// 解析できない宛先（インストール時の検証を経ているため通常は存在しない）は照合対象から除く。
fn consented_network_destinations(
    state: &PluginStateFile,
    plugin_id: &str,
) -> Result<Vec<Destination>, PluginError> {
    let plugin = state.find(plugin_id).ok_or(PluginError::NotInstalled)?;
    if !plugin.consented_permissions.contains(&Permission::Network) {
        return Err(PluginError::PermissionDenied {
            permission: Permission::Network.as_str().to_string(),
        });
    }
    Ok(plugin
        .consented_destinations
        .iter()
        .filter_map(|d| parse_destination(d).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::store::{InstalledPluginState, PluginSource};

    fn state_with(permissions: Vec<Permission>, destinations: &[&str]) -> PluginStateFile {
        PluginStateFile {
            schema_version: 1,
            third_party_warning_acknowledged: true,
            developer_mode: false,
            plugins: vec![InstalledPluginState {
                id: "net-plugin".into(),
                version: "1.0.0".into(),
                source: PluginSource::Github {
                    owner: "o".into(),
                    repo: "r".into(),
                },
                enabled: true,
                consented_permissions: permissions,
                consented_destinations: destinations.iter().map(|s| s.to_string()).collect(),
                generation: 0,
                pending_consent: None,
                disabled_reason: None,
                installed_at: "2026-01-01T00:00:00Z".into(),
            }],
        }
    }

    #[test]
    fn requires_installed_plugin() {
        let state = state_with(vec![Permission::Network], &["api.example.com"]);
        assert_eq!(
            consented_network_destinations(&state, "other"),
            Err(PluginError::NotInstalled)
        );
    }

    #[test]
    fn requires_network_permission() {
        let state = state_with(vec![Permission::NotesRead], &["api.example.com"]);
        assert_eq!(
            consented_network_destinations(&state, "net-plugin"),
            Err(PluginError::PermissionDenied {
                permission: "network".into()
            })
        );
    }

    #[test]
    fn returns_parsed_consented_destinations() {
        let state = state_with(
            vec![Permission::Network],
            &["api.example.com", "localhost:3000", "not a destination"],
        );
        let dests = consented_network_destinations(&state, "net-plugin").unwrap();
        assert_eq!(
            dests,
            vec![
                parse_destination("api.example.com").unwrap(),
                parse_destination("localhost:3000").unwrap(),
            ]
        );
    }
}
