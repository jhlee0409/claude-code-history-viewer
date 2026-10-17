//! The menu's side of the frontend handshake (plan §4.4), kept free of Tauri
//! types so its rules are unit-tested:
//!
//! - A menu event reaches the frontend only once it is ready. Until its first
//!   `sync_menu_state` (and again from a page reload until the next one) the
//!   event is queued, and the queue is handed back in that sync's reply.
//! - A sync carries the UI language and each menu command's enabled/checked
//!   state. A new language means the menu is rebuilt in it; otherwise only
//!   the items whose state changed are updated.
//! - Ids outside the manifest's menu commands are ignored: a menu event for
//!   one is not forwarded, a state for one is not kept.

use super::labels::resolve_language;
use super::manifest::Manifest;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;

/// The most queued events kept; older ones are dropped first.
const MAX_PENDING: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct ItemState {
    pub enabled: bool,
    #[serde(default)]
    pub checked: Option<bool>,
}

/// The `sync_menu_state` argument (`MenuState` in `src/commands/nativeMenu.ts`).
#[derive(Debug, Clone, Deserialize)]
pub struct MenuStatePayload {
    pub language: String,
    #[serde(default)]
    pub items: HashMap<String, ItemState>,
}

/// What to do with a menu event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dispatch {
    /// Send it to the frontend now.
    Emit,
    /// The frontend is not ready; it was queued.
    Queued,
    /// Not an app command (an OS item, an unknown id).
    Ignore,
}

/// What a sync asks the native menu to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncOutcome {
    /// Rebuild the menu in `language` with every state in `items`.
    pub rebuild: bool,
    pub language: String,
    /// When not rebuilding: only the items whose state changed.
    pub items: HashMap<String, ItemState>,
    /// Queued menu events for the frontend to run, oldest first.
    pub pending: Vec<String>,
}

#[derive(Debug, Default)]
struct Inner {
    ready: bool,
    pending: Vec<String>,
    /// The language the current menu is titled in.
    language: String,
    items: HashMap<String, ItemState>,
}

#[derive(Debug)]
pub struct MenuBridge {
    inner: Mutex<Inner>,
}

impl MenuBridge {
    /// A bridge for a menu built in `language` with every item enabled.
    pub fn new(language: &str) -> MenuBridge {
        MenuBridge {
            inner: Mutex::new(Inner {
                language: resolve_language(language).to_string(),
                ..Inner::default()
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves plain data behind; keep going.
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Retitle before the first menu is built (the saved UI language is known
    /// only once the app's data folder is).
    pub fn set_language(&self, language: &str) {
        self.lock().language = resolve_language(language).to_string();
    }

    pub fn language(&self) -> String {
        self.lock().language.clone()
    }

    /// The states last synced, for building a menu.
    pub fn states(&self) -> HashMap<String, ItemState> {
        self.lock().items.clone()
    }

    pub fn on_menu_event(&self, manifest: &Manifest, id: &str) -> Dispatch {
        if !manifest.is_menu_command(id) {
            return Dispatch::Ignore;
        }
        let mut inner = self.lock();
        if inner.ready {
            return Dispatch::Emit;
        }
        if inner.pending.len() == MAX_PENDING {
            inner.pending.remove(0);
        }
        inner.pending.push(id.to_string());
        Dispatch::Queued
    }

    /// The page started (re)loading: hold menu events until it syncs again.
    pub fn page_loading(&self) {
        self.lock().ready = false;
    }

    /// The checked state last synced for a toggle item.
    pub fn checked(&self, id: &str) -> Option<bool> {
        self.lock().items.get(id).and_then(|state| state.checked)
    }

    pub fn sync(&self, manifest: &Manifest, payload: MenuStatePayload) -> SyncOutcome {
        let mut inner = self.lock();
        inner.ready = true;
        let pending = std::mem::take(&mut inner.pending);
        let mut changed = HashMap::new();
        for (id, state) in payload.items {
            if !manifest.is_menu_command(&id) {
                log::warn!("sync_menu_state: ignoring unknown menu command {id:?}");
                continue;
            }
            if inner.items.get(&id) != Some(&state) {
                inner.items.insert(id.clone(), state);
                changed.insert(id, state);
            }
        }
        let language = resolve_language(&payload.language);
        let rebuild = inner.language != language;
        if rebuild {
            inner.language = language.to_string();
        }
        SyncOutcome {
            rebuild,
            language: inner.language.clone(),
            items: if rebuild {
                inner.items.clone()
            } else {
                changed
            },
            pending,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::manifest::manifest;

    fn payload(language: &str, items: &[(&str, bool)]) -> MenuStatePayload {
        MenuStatePayload {
            language: language.into(),
            items: items
                .iter()
                .map(|(id, enabled)| {
                    (
                        (*id).to_string(),
                        ItemState {
                            enabled: *enabled,
                            checked: None,
                        },
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn queues_menu_events_until_the_frontend_syncs_then_hands_them_back() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        assert_eq!(bridge.on_menu_event(m, "palette.open"), Dispatch::Queued);
        assert_eq!(bridge.on_menu_event(m, "go.back"), Dispatch::Queued);
        let outcome = bridge.sync(m, payload("en", &[]));
        assert_eq!(outcome.pending, vec!["palette.open", "go.back"]);
        assert_eq!(bridge.on_menu_event(m, "go.back"), Dispatch::Emit);
        assert_eq!(
            bridge.sync(m, payload("en", &[])).pending,
            Vec::<String>::new()
        );
    }

    #[test]
    fn queues_again_while_the_page_reloads() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.sync(m, payload("en", &[]));
        bridge.page_loading();
        assert_eq!(bridge.on_menu_event(m, "tab.new"), Dispatch::Queued);
        assert_eq!(bridge.sync(m, payload("en", &[])).pending, vec!["tab.new"]);
    }

    #[test]
    fn ignores_os_items_and_unknown_ids() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.sync(m, payload("en", &[]));
        assert_eq!(bridge.on_menu_event(m, "edit.copy"), Dispatch::Ignore);
        assert_eq!(bridge.on_menu_event(m, "no.such"), Dispatch::Ignore);
        let outcome = bridge.sync(m, payload("en", &[("no.such", true)]));
        assert!(outcome.items.is_empty());
    }

    #[test]
    fn keeps_a_bounded_queue() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        for _ in 0..(MAX_PENDING + 5) {
            bridge.on_menu_event(m, "go.back");
        }
        bridge.on_menu_event(m, "go.forward");
        let pending = bridge.sync(m, payload("en", &[])).pending;
        assert_eq!(pending.len(), MAX_PENDING);
        assert_eq!(pending.last().map(String::as_str), Some("go.forward"));
    }

    #[test]
    fn rebuilds_on_a_language_change_and_updates_only_changed_items_otherwise() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        let first = bridge.sync(
            m,
            payload("en", &[("go.back", false), ("go.forward", false)]),
        );
        assert!(!first.rebuild);
        assert_eq!(first.items.len(), 2);
        let second = bridge.sync(
            m,
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(!second.rebuild);
        assert_eq!(second.items.keys().collect::<Vec<_>>(), vec!["go.back"]);
        let third = bridge.sync(
            m,
            payload("ko", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(third.rebuild);
        assert_eq!(third.language, "ko");
        assert_eq!(third.items.len(), 2, "a rebuild applies every state");
        assert_eq!(bridge.language(), "ko");
        let same = bridge.sync(
            m,
            payload("ko-KR", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(!same.rebuild, "ko-KR is the same app language as ko");
    }

    #[test]
    fn remembers_the_checked_state_of_a_toggle() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        let mut state = payload("en", &[]);
        state.items.insert(
            "view.toggleMinimap".into(),
            ItemState {
                enabled: true,
                checked: Some(true),
            },
        );
        bridge.sync(m, state);
        assert_eq!(bridge.checked("view.toggleMinimap"), Some(true));
        assert_eq!(bridge.checked("go.back"), None);
    }

    #[test]
    fn parses_the_frontend_payload() {
        let json = r#"{"language":"ja","items":{"view.toggleInspector":{"enabled":true,"checked":false},"go.back":{"enabled":false}}}"#;
        let parsed: MenuStatePayload = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.language, "ja");
        assert_eq!(
            parsed.items["view.toggleInspector"],
            ItemState {
                enabled: true,
                checked: Some(false)
            }
        );
        assert_eq!(parsed.items["go.back"].checked, None);
    }
}
