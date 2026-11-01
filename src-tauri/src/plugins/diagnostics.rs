//! セッション内の Plugin 診断情報（永続化しない）。
//!
//! - PluginErrorEntry: Plugin ごとに最新 [`MAX_ERRORS_PER_PLUGIN`] 件を保持する
//! - KeybindingConflict: メインウィンドウの PluginHost が報告した最新の一覧
//!
//! JSON の形は `src/shared/plugin/types.ts` の `PluginErrorEntry` / `KeybindingConflict` と一致させる。

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// Plugin ごとに保持するエラーの件数
pub const MAX_ERRORS_PER_PLUGIN: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginErrorSource {
    Load,
    Activate,
    Deactivate,
    Command,
    Markdown,
    Theme,
    SidePanel,
    EditorExtension,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginErrorEntry {
    pub plugin_id: String,
    pub source: PluginErrorSource,
    pub message: String,
    pub window_label: String,
    /// ISO 8601
    pub at: String,
}

/// `KeybindingConflict.with` の `'builtin'`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BuiltinMarker {
    #[serde(rename = "builtin")]
    Builtin,
}

/// `KeybindingConflict.with`（`'builtin' | { pluginId }`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConflictWith {
    Builtin(BuiltinMarker),
    #[serde(rename_all = "camelCase")]
    Plugin { plugin_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingConflict {
    pub plugin_id: String,
    pub key: String,
    pub command: String,
    pub with: ConflictWith,
}

#[derive(Default)]
pub struct PluginDiagnostics {
    /// 記録順（古い順）
    errors: Mutex<Vec<PluginErrorEntry>>,
    keybinding_conflicts: Mutex<Vec<KeybindingConflict>>,
}

impl PluginDiagnostics {
    pub fn new() -> Self {
        Self::default()
    }

    /// エラーを記録する。同じ Plugin のエラーが上限を超えたら、その Plugin の最も古いものを捨てる。
    pub fn push_error(&self, entry: PluginErrorEntry) {
        let mut errors = self.errors.lock();
        let plugin_id = entry.plugin_id.clone();
        errors.push(entry);
        let count = errors.iter().filter(|e| e.plugin_id == plugin_id).count();
        if count > MAX_ERRORS_PER_PLUGIN {
            let mut to_drop = count - MAX_ERRORS_PER_PLUGIN;
            errors.retain(|e| {
                if to_drop > 0 && e.plugin_id == plugin_id {
                    to_drop -= 1;
                    false
                } else {
                    true
                }
            });
        }
    }

    pub fn errors(&self) -> Vec<PluginErrorEntry> {
        self.errors.lock().clone()
    }

    /// アンインストールした Plugin のエラーを消す
    pub fn clear_errors_for(&self, plugin_id: &str) {
        self.errors.lock().retain(|e| e.plugin_id != plugin_id);
    }

    pub fn set_keybinding_conflicts(&self, conflicts: Vec<KeybindingConflict>) {
        *self.keybinding_conflicts.lock() = conflicts;
    }

    pub fn keybinding_conflicts(&self) -> Vec<KeybindingConflict> {
        self.keybinding_conflicts.lock().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(plugin_id: &str, message: &str) -> PluginErrorEntry {
        PluginErrorEntry {
            plugin_id: plugin_id.into(),
            source: PluginErrorSource::Activate,
            message: message.into(),
            window_label: "main".into(),
            at: "2026-07-04T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn keeps_latest_entries_per_plugin() {
        let d = PluginDiagnostics::new();
        for i in 0..25 {
            d.push_error(entry("a", &i.to_string()));
            if i % 5 == 0 {
                d.push_error(entry("b", &format!("b{i}")));
            }
        }
        let errors = d.errors();
        let a: Vec<_> = errors.iter().filter(|e| e.plugin_id == "a").map(|e| e.message.clone()).collect();
        let expected: Vec<_> = (5..25).map(|i| i.to_string()).collect();
        assert_eq!(a, expected);
        // 他の Plugin のエラーは捨てない
        assert_eq!(errors.iter().filter(|e| e.plugin_id == "b").count(), 5);

        d.clear_errors_for("a");
        assert!(d.errors().iter().all(|e| e.plugin_id == "b"));
    }

    #[test]
    fn json_shapes_match_typescript_types() {
        let mut e = entry("p", "boom");
        e.source = PluginErrorSource::EditorExtension;
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({
                "pluginId": "p",
                "source": "editorExtension",
                "message": "boom",
                "windowLabel": "main",
                "at": "2026-07-04T00:00:00.000Z"
            })
        );

        let input = json!([
            { "pluginId": "a", "key": "Ctrl-k", "command": "a:x", "with": "builtin" },
            { "pluginId": "b", "key": "Ctrl-j", "command": "b:y", "with": { "pluginId": "a" } }
        ]);
        let parsed: Vec<KeybindingConflict> = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(parsed[0].with, ConflictWith::Builtin(BuiltinMarker::Builtin));
        assert_eq!(parsed[1].with, ConflictWith::Plugin { plugin_id: "a".into() });
        assert_eq!(serde_json::to_value(&parsed).unwrap(), input);
    }
}
