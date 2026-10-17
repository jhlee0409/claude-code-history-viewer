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

    /// Applying the last sync failed: the next one rebuilds the whole menu.
    pub fn apply_failed(&self) {
        self.lock().dirty = true;
    }

    /// The checked state last synced for a toggle item.
    pub fn checked(&self, id: &str) -> Option<bool> {
        self.lock().items.get(id).and_then(|state| state.checked)
    }

    /// What the native menu must do for `payload`.
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
        let outcome = bridge.sync(m, payload("en", &[("no.such", true)]));
        assert!(outcome.items.is_empty());
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
