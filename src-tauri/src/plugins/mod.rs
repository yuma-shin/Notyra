//! プラグインシステムの Rust ロジック（コマンドから分離した、単体テスト可能な判定処理）。
//!
//! コマンド関数は `commands/plugin*.rs` に置く。

pub mod barrier;
pub mod destination;
pub mod diagnostics;
pub mod error;
pub mod gateway;
pub mod notes_scope;
pub mod package;
pub mod protocol;
pub mod store;

pub use error::PluginError;

#[cfg(test)]
mod property_tests;
