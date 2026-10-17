//! The menu's side of the frontend handshake (plan §4.4), kept free of Tauri
//! types so its rules are unit-tested:
//!
//! - A menu event reaches the frontend only once it is ready. Until its first
//!   `sync_menu_state` has been applied to the native menu (and again from a
//!   page reload until the next one) the event is queued; `applied` marks the
//!   frontend ready and hands the queue back, oldest first, in that sync's
//!   reply. An event chosen while a sync is being applied is queued too, so
//!   it follows the queue; a failed apply keeps the queue for the next sync.
//! - A sync carries the UI language and each menu command's enabled/checked
//!   state. A new language means the menu is rebuilt in it; otherwise only
//!   the items whose state changed are updated. When applying a sync fails
//!   the native menu's state is unknown, so the next sync rebuilds it whole
//!   (`apply_failed`).
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
}

#[derive(Debug, Default)]
struct Inner {
    ready: bool,
    pending: Vec<String>,
    /// The language the current menu is titled in.
    language: String,
    items: HashMap<String, ItemState>,
    /// The last sync was not applied: the native menu may differ from `items`.
    dirty: bool,
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

    /// Applying the last sync failed: the next one rebuilds the whole menu.
    pub fn apply_failed(&self) {
        self.lock().dirty = true;
    }

    /// The checked state last synced for a toggle item.
    pub fn checked(&self, id: &str) -> Option<bool> {
        self.lock().items.get(id).and_then(|state| state.checked)
    }

    /// What the native menu must do for `payload`. The frontend is not ready
    /// until that is done (`applied`).
    pub fn sync(&self, manifest: &Manifest, payload: MenuStatePayload) -> SyncOutcome {
        let mut inner = self.lock();
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
        let rebuild = inner.dirty || inner.language != language;
        if rebuild {
            inner.language = language.to_string();
            inner.dirty = false;
        }
        SyncOutcome {
            rebuild,
            language: inner.language.clone(),
            items: if rebuild {
                inner.items.clone()
            } else {
                changed
            },
        }
    }

    /// The sync is applied: the frontend is ready. Returns the queued menu
    /// events, oldest first, for the sync's reply.
    pub fn applied(&self) -> Vec<String> {
        let mut inner = self.lock();
        inner.ready = true;
        std::mem::take(&mut inner.pending)
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
        bridge.sync(m, payload("en", &[]));
        assert_eq!(bridge.applied(), vec!["palette.open", "go.back"]);
        assert_eq!(bridge.on_menu_event(m, "go.back"), Dispatch::Emit);
        bridge.sync(m, payload("en", &[]));
        assert_eq!(bridge.applied(), Vec::<String>::new());
    }

    #[test]
    fn queues_again_while_the_page_reloads() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.sync(m, payload("en", &[]));
        bridge.applied();
        bridge.page_loading();
        assert_eq!(bridge.on_menu_event(m, "tab.new"), Dispatch::Queued);
        bridge.sync(m, payload("en", &[]));
        assert_eq!(bridge.applied(), vec!["tab.new"]);
    }

    #[test]
    fn stays_unready_until_the_sync_is_applied_and_hands_back_events_queued_meanwhile() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        assert_eq!(bridge.on_menu_event(m, "tab.new"), Dispatch::Queued);
        bridge.sync(m, payload("en", &[("go.back", true)]));
        // The native menu is being updated: not ready yet.
        assert_eq!(bridge.on_menu_event(m, "tab.close"), Dispatch::Queued);
        assert_eq!(bridge.applied(), vec!["tab.new", "tab.close"]);
        assert_eq!(bridge.on_menu_event(m, "go.back"), Dispatch::Emit);
    }

    #[test]
    fn a_failed_apply_keeps_the_queue_for_the_next_sync() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.on_menu_event(m, "tab.new");
        bridge.sync(m, payload("en", &[]));
        bridge.apply_failed();
        assert_eq!(bridge.on_menu_event(m, "tab.close"), Dispatch::Queued);
        bridge.sync(m, payload("en", &[]));
        assert_eq!(bridge.applied(), vec!["tab.new", "tab.close"]);
    }

    #[test]
    fn ignores_os_items_and_unknown_ids() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.sync(m, payload("en", &[]));
        bridge.applied();
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
        bridge.sync(m, payload("en", &[]));
        let pending = bridge.applied();
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
    fn a_failed_apply_makes_the_next_sync_apply_every_state_again() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.sync(
            m,
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        bridge.apply_failed();
        let retry = bridge.sync(
            m,
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(
            retry.rebuild,
            "the native menu's state is unknown: rebuild it"
        );
        assert_eq!(retry.items.len(), 2);
        let next = bridge.sync(
            m,
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(!next.rebuild);
        assert!(next.items.is_empty());
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
