//! The native app menu (plan §4.4, T11a).
//!
//! The menu bar - App (macOS), File, Edit, View, Go, Window, Help - is built
//! from the same command manifest the frontend registry reads
//! (`src/commands/manifest.json`), titled from the frontend's own locale
//! files, and rebuilt when the UI language changes. App commands run in the
//! frontend through one `menu-command` event; OS items (copy, quit...) run
//! natively.
//!
//! - `manifest`: the embedded manifest.
//! - `labels`: titles in the five UI languages.
//! - `spec`: the menus one platform shows, as data (unit-tested).
//! - `bridge`: the frontend handshake - ready, queue, state (unit-tested).
//! - `native`: the Tauri menu, the event handler, `sync_menu_state`.

pub mod bridge;
pub mod labels;
pub mod manifest;
pub mod native;
pub mod spec;

pub use bridge::MenuBridge;
pub use native::{handle_menu_event, initial_menu};
