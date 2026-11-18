//! The native menu's state, kept free of Tauri types so its rules are
//! unit-tested (plan §4.4):
//!
//! - A sync carries the UI language and each menu command's enabled/checked
//!   state. A new language means the menu is rebuilt in it; otherwise only
//!   the items whose state changed are updated. When applying a sync fails
//!   the native menu's state is unknown, so the next sync rebuilds it whole
//!   (`apply_failed`).
//! - The state is shown, never relied on: the page owns every shortcut and
//!   `runCommand` re-checks a command when a menu event runs, so a stale item
//!   can neither swallow nor double a key. Menu events themselves go through
//!   the journal (`journal.rs`), not through this state.
//! - Ids outside the manifest's menu commands are ignored.
//! - A sync also carries the page's tab in front (`frontTabId`); it is not
//!   menu state but the journal's stamp for the events chosen from now on
//!   (`MenuJournal::report_front_tab`).
//! - Several windows (issue #656): each window's page syncs its own state,
//!   kept per window. The one menu bar shows the state of the window in front
//!   (`focus`, on every focus change); a sync from a window behind it is kept
//!   for when that window comes to the front and changes nothing shown. The
//!   language of the window in front titles the menu.

use super::labels::resolve_language;
use super::manifest::Manifest;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;

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
    /// The tab in front in the page; absent from an older page.
    #[serde(default, rename = "frontTabId")]
    pub front_tab_id: Option<String>,
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
    /// The language the current menu is titled in.
    language: String,
    /// What the native menu shows: the window in front's state, as applied.
    shown: HashMap<String, ItemState>,
    /// Each window's last synced state, by window label.
    windows: HashMap<String, HashMap<String, ItemState>>,
    /// The window whose state the menu shows; the first to sync until one
    /// comes to the front.
    front: Option<String>,
    /// The last sync was not applied: the native menu may differ from `shown`.
    dirty: bool,
}

impl Inner {
    /// Bring `shown` up to the front window's state: what must change.
    fn show_front(&mut self, rebuild: bool) -> SyncOutcome {
        let wanted = self
            .front
            .as_ref()
            .and_then(|front| self.windows.get(front))
            .cloned()
            .unwrap_or_default();
        let mut changed = HashMap::new();
        for (id, state) in wanted {
            if self.shown.get(&id) != Some(&state) {
                self.shown.insert(id.clone(), state);
                changed.insert(id, state);
            }
        }
        SyncOutcome {
            rebuild,
            language: self.language.clone(),
            items: if rebuild { self.shown.clone() } else { changed },
        }
    }

    /// A rebuild owed after a failed apply, else nothing to rebuild.
    fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }
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

    /// The states the menu shows, for building a menu.
    pub fn states(&self) -> HashMap<String, ItemState> {
        self.lock().shown.clone()
    }

    /// Applying the last sync failed: the next one rebuilds the whole menu.
    pub fn apply_failed(&self) {
        self.lock().dirty = true;
    }

    /// The checked state the menu shows for a toggle item.
    pub fn checked(&self, id: &str) -> Option<bool> {
        self.lock().shown.get(id).and_then(|state| state.checked)
    }

    /// What the native menu must do for window `window`'s `payload`.
    pub fn sync(
        &self,
        manifest: &Manifest,
        window: &str,
        payload: MenuStatePayload,
    ) -> SyncOutcome {
        let mut inner = self.lock();
        let states = inner.windows.entry(window.to_string()).or_default();
        for (id, state) in payload.items {
            if !manifest.is_menu_command(&id) {
                log::warn!("sync_menu_state: ignoring unknown menu command {id:?}");
                continue;
            }
            states.insert(id, state);
        }
        if inner.front.is_none() {
            inner.front = Some(window.to_string());
        }
        if inner.front.as_deref() != Some(window) {
            // Kept for when this window comes to the front.
            return SyncOutcome {
                rebuild: false,
                language: inner.language.clone(),
                items: HashMap::new(),
            };
        }
        let language = resolve_language(&payload.language);
        let rebuild = inner.take_dirty() || inner.language != language;
        inner.language = language.to_string();
        inner.show_front(rebuild)
    }

    /// Window `window` came to the front: the menu shows its state.
    pub fn focus(&self, window: &str) -> SyncOutcome {
        let mut inner = self.lock();
        inner.front = Some(window.to_string());
        let rebuild = inner.take_dirty();
        inner.show_front(rebuild)
    }

    /// Window `window` closed: its state goes; the next window to come to
    /// the front (or to sync) is shown.
    pub fn forget(&self, window: &str) {
        let mut inner = self.lock();
        inner.windows.remove(window);
        if inner.front.as_deref() == Some(window) {
            inner.front = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::manifest::manifest;

    fn payload(language: &str, items: &[(&str, bool)]) -> MenuStatePayload {
        MenuStatePayload {
            front_tab_id: None,
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
    fn ignores_the_state_of_an_unknown_id() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        let outcome = bridge.sync(m, "main", payload("en", &[("no.such", true)]));
        assert!(outcome.items.is_empty());
    }

    #[test]
    fn rebuilds_on_a_language_change_and_updates_only_changed_items_otherwise() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        let first = bridge.sync(
            m,
            "main",
            payload("en", &[("go.back", false), ("go.forward", false)]),
        );
        assert!(!first.rebuild);
        assert_eq!(first.items.len(), 2);
        let second = bridge.sync(
            m,
            "main",
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(!second.rebuild);
        assert_eq!(second.items.keys().collect::<Vec<_>>(), vec!["go.back"]);
        let third = bridge.sync(
            m,
            "main",
            payload("ko", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(third.rebuild);
        assert_eq!(third.language, "ko");
        assert_eq!(third.items.len(), 2, "a rebuild applies every state");
        assert_eq!(bridge.language(), "ko");
        let same = bridge.sync(
            m,
            "main",
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
            "main",
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        bridge.apply_failed();
        let retry = bridge.sync(
            m,
            "main",
            payload("en", &[("go.back", true), ("go.forward", false)]),
        );
        assert!(
            retry.rebuild,
            "the native menu's state is unknown: rebuild it"
        );
        assert_eq!(retry.items.len(), 2);
        let next = bridge.sync(
            m,
            "main",
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
        bridge.sync(m, "main", state);
        assert_eq!(bridge.checked("view.toggleMinimap"), Some(true));
        assert_eq!(bridge.checked("go.back"), None);
    }

    #[test]
    fn the_menu_shows_the_window_in_front_and_keeps_the_others_for_later() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        let main = bridge.sync(m, "main", payload("en", &[("go.back", true)]));
        assert_eq!(main.items.len(), 1, "the first window to sync is shown");
        // A window behind: kept, nothing shown changes - not even its language.
        let behind = bridge.sync(m, "window-2", payload("ko", &[("go.back", false)]));
        assert!(!behind.rebuild);
        assert!(behind.items.is_empty());
        assert_eq!(bridge.language(), "en");
        assert!(bridge.states()["go.back"].enabled);
        // It comes to the front: its state is shown.
        let front = bridge.focus("window-2");
        assert!(!front.rebuild);
        assert_eq!(
            front.items["go.back"],
            ItemState {
                enabled: false,
                checked: None
            }
        );
        // Back to the first window: its state again, with no sync needed.
        let back = bridge.focus("main");
        assert!(back.items["go.back"].enabled);
        // Focusing the window already shown changes nothing.
        assert!(bridge.focus("main").items.is_empty());
    }

    #[test]
    fn a_closed_window_is_forgotten_and_the_next_one_to_sync_is_shown() {
        let bridge = MenuBridge::new("en");
        let m = manifest();
        bridge.sync(m, "window-2", payload("en", &[("go.back", false)]));
        bridge.sync(m, "main", payload("en", &[("go.back", true)]));
        assert!(!bridge.states()["go.back"].enabled, "window-2 synced first");
        bridge.forget("window-2");
        let next = bridge.sync(m, "main", payload("en", &[("go.back", true)]));
        assert!(next.items["go.back"].enabled);
        // A focus owed a rebuild after a failed apply rebuilds.
        bridge.apply_failed();
        assert!(bridge.focus("main").rebuild);
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
        assert_eq!(
            parsed.front_tab_id, None,
            "an older page reports no front tab"
        );
    }

    #[test]
    fn parses_the_front_tab_the_page_reports() {
        let json = r#"{"language":"en","items":{},"frontTabId":"tab-7"}"#;
        let parsed: MenuStatePayload = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.front_tab_id.as_deref(), Some("tab-7"));
    }
}
