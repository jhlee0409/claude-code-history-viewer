//! The menu bar, described before it is built (plan §4.4).
//!
//! `build_spec` turns the manifest into the menus one platform shows, in the
//! manifest's order, with titles in one language. The native builder
//! (`native.rs`) makes the real menu from it one-to-one, so the tests here
//! check the menu the app shows without needing a window system.

use super::labels::Labels;
use super::manifest::{Entry, Manifest, MenuId, Os, PredefinedKind, Source};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemSpec {
    /// An app command: clicking it (or its accelerator) sends its id to the frontend.
    Command {
        id: String,
        label: String,
        accelerator: Option<String>,
        /// A checkbox item, ticked while what it toggles is on.
        toggle: bool,
    },
    /// An OS item (copy, quit...); the OS runs it.
    Predefined {
        id: String,
        kind: PredefinedKind,
        label: String,
    },
    Separator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmenuSpec {
    pub menu: MenuId,
    pub label: String,
    pub items: Vec<ItemSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuSpec {
    pub submenus: Vec<SubmenuSpec>,
}

impl MenuSpec {
    /// The ids of the app commands the menu sends, in menu order.
    pub fn command_ids(&self) -> Vec<&str> {
        self.items()
            .filter_map(|item| match item {
                ItemSpec::Command { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect()
    }

    pub fn items(&self) -> impl Iterator<Item = &ItemSpec> {
        self.submenus
            .iter()
            .flat_map(|submenu| submenu.items.iter())
    }

    pub fn submenu(&self, menu: MenuId) -> Option<&SubmenuSpec> {
        self.submenus.iter().find(|submenu| submenu.menu == menu)
    }
}

fn item_for(entry: &Entry, os: Os, manifest: &Manifest, labels: &Labels) -> Option<ItemSpec> {
    match entry.source {
        Source::Frontend => {
            let label_key = entry.menu_label_key.as_deref().unwrap_or(&entry.label_key);
            // Where the native menu does not own shortcuts yet, the item shows
            // none: the DOM listener runs the key (one owner per runtime).
            let accelerator = manifest
                .native_shortcuts
                .for_os(os)
                .then(|| entry.shortcut_on(os).map(str::to_string))
                .flatten();
            Some(ItemSpec::Command {
                id: entry.id.clone(),
                label: labels.get(label_key),
                accelerator,
                toggle: entry.toggle,
            })
        }
        Source::Predefined => Some(ItemSpec::Predefined {
            id: entry.id.clone(),
            kind: entry.predefined?,
            label: labels.get(&entry.label_key),
        }),
    }
}

fn push(items: &mut Vec<ItemSpec>, item: ItemSpec, separator_before: bool) {
    if separator_before && !matches!(items.last(), None | Some(ItemSpec::Separator)) {
        items.push(ItemSpec::Separator);
    }
    items.push(item);
}

/// The menus `os` shows, titled in `labels`' language.
///
/// - Entries keep the manifest's order; `separatorBefore` starts a group.
/// - Off macOS there is no app menu: its entries go to their `menuElsewhere`
///   menu, after that menu's own entries, each in its own group, About last.
/// - An item the platform lacks (`platforms`) is left out; an empty menu too.
pub fn build_spec(manifest: &Manifest, os: Os, labels: &Labels) -> MenuSpec {
    let mut submenus = Vec::new();
    for menu in MenuId::ORDER {
        if menu == MenuId::App && os != Os::Mac {
            continue;
        }
        let mut items = Vec::new();
        let mut relocated: Vec<&Entry> = Vec::new();
        for entry in &manifest.commands {
            if entry.menu_on(os) != Some(menu) {
                continue;
            }
            if entry.relocated_on(os) {
                relocated.push(entry);
                continue;
            }
            if let Some(item) = item_for(entry, os, manifest, labels) {
                push(&mut items, item, entry.separator_before);
            }
        }
        relocated.sort_by_key(|entry| entry.predefined == Some(PredefinedKind::About));
        for entry in relocated {
            if let Some(item) = item_for(entry, os, manifest, labels) {
                push(&mut items, item, true);
            }
        }
        while matches!(items.last(), Some(ItemSpec::Separator)) {
            items.pop();
        }
        if items.is_empty() {
            continue;
        }
        let label = if menu == MenuId::App {
            labels.app_name()
        } else {
            labels.get(menu.label_key())
        };
        submenus.push(SubmenuSpec { menu, label, items });
    }
    MenuSpec { submenus }
}

/// An accelerator reduced to what the OS matches: modifiers and key.
type Chord = (BTreeSet<&'static str>, String);

fn chord(accelerator: &str, os: Os) -> Chord {
    let mut parts: Vec<&str> = accelerator.split('+').collect();
    let key = parts.pop().unwrap_or_default().to_uppercase();
    let modifiers = parts
        .into_iter()
        .map(|modifier| match (modifier, os) {
            ("Cmd" | "Command" | "Super", _) | ("CmdOrCtrl", Os::Mac) => "cmd",
            ("Ctrl" | "Control" | "CmdOrCtrl", _) => "ctrl",
            ("Alt" | "Option", _) => "alt",
            ("Shift", _) => "shift",
            _ => "unknown",
        })
        .collect();
    (modifiers, key)
}

/// Pairs of entries bound to the same chord on `os`: app commands (whether
/// the menu or the DOM listener runs them there) and the OS items present.
pub fn shortcut_collisions(manifest: &Manifest, os: Os) -> Vec<(String, String, String)> {
    let mut seen: Vec<(Chord, &str)> = Vec::new();
    let mut collisions = Vec::new();
    for entry in &manifest.commands {
        if !entry.exists_on(os) {
            continue;
        }
        let Some(accelerator) = entry.shortcut_on(os) else {
            continue;
        };
        let key = chord(accelerator, os);
        if let Some((_, other)) = seen.iter().find(|(seen_key, _)| *seen_key == key) {
            collisions.push((
                (*other).to_string(),
                entry.id.clone(),
                accelerator.to_string(),
            ));
        } else {
            seen.push((key, entry.id.as_str()));
        }
    }
    collisions
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::labels::LANGUAGES;
    use crate::menu::manifest::manifest;
    use std::collections::HashSet;

    fn spec(os: Os, lang: &str) -> MenuSpec {
        build_spec(manifest(), os, &Labels::new(lang))
    }

    /// The manifest's menu commands: `source: frontend` with a menu.
    fn manifest_menu_commands() -> Vec<&'static str> {
        manifest()
            .commands
            .iter()
            .filter(|e| e.source == Source::Frontend && e.menu.is_some())
            .map(|e| e.id.as_str())
            .collect()
    }

    #[test]
    fn menu_command_ids_equal_the_manifest_on_every_platform() {
        let mut expected = manifest_menu_commands();
        expected.sort_unstable();
        for os in Os::ALL {
            let built = spec(os, "en");
            let mut ids = built.command_ids();
            let count = ids.len();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), count, "{os:?}: a command appears twice");
            assert_eq!(ids, expected, "{os:?}");
        }
    }

    #[test]
    fn no_two_entries_share_a_shortcut() {
        for os in Os::ALL {
            assert_eq!(shortcut_collisions(manifest(), os), vec![], "{os:?}");
        }
    }

    #[test]
    fn the_collision_check_catches_a_duplicate() {
        let mut copy = manifest().clone();
        let back = copy
            .commands
            .iter_mut()
            .find(|e| e.id == "go.back")
            .unwrap();
        back.shortcut.as_mut().unwrap().mac = Some("Cmd+C".into());
        let collisions = shortcut_collisions(&copy, Os::Mac);
        assert_eq!(
            collisions,
            vec![("edit.copy".into(), "go.back".into(), "Cmd+C".into())]
        );
    }

    #[test]
    fn every_accelerator_parses_as_a_native_accelerator() {
        use std::str::FromStr;
        for entry in &manifest().commands {
            for os in Os::ALL {
                if let Some(accelerator) = entry.shortcut_on(os) {
                    assert!(
                        muda::accelerator::Accelerator::from_str(accelerator).is_ok(),
                        "{} on {os:?}: {accelerator}",
                        entry.id
                    );
                }
            }
        }
    }

    #[test]
    fn mac_has_the_seven_menus_in_order() {
        let menus: Vec<MenuId> = spec(Os::Mac, "en")
            .submenus
            .iter()
            .map(|s| s.menu)
            .collect();
        assert_eq!(menus, MenuId::ORDER.to_vec());
    }

    #[test]
    fn windows_and_linux_have_no_app_menu() {
        for os in [Os::Win, Os::Linux] {
            let menus: Vec<MenuId> = spec(os, "en").submenus.iter().map(|s| s.menu).collect();
            assert_eq!(menus, MenuId::ORDER[1..].to_vec(), "{os:?}");
        }
    }

    fn ids(submenu: &SubmenuSpec) -> Vec<&str> {
        submenu
            .items
            .iter()
            .map(|item| match item {
                ItemSpec::Command { id, .. } | ItemSpec::Predefined { id, .. } => id.as_str(),
                ItemSpec::Separator => "-",
            })
            .collect()
    }

    #[test]
    fn mac_app_menu_has_about_settings_updates_and_quit() {
        let built = spec(Os::Mac, "en");
        let app = built.submenu(MenuId::App).unwrap();
        assert_eq!(
            ids(app),
            vec![
                "app.about",
                "-",
                "app.preferences",
                "app.checkForUpdates",
                "-",
                "app.services",
                "-",
                "app.hide",
                "app.hideOthers",
                "app.showAll",
                "-",
                "app.quit"
            ]
        );
        assert!(app.items.contains(&ItemSpec::Command {
            id: "app.preferences".into(),
            label: "Settings…".into(),
            accelerator: Some("Cmd+,".into()),
            toggle: false,
        }));
    }

    #[test]
    fn off_macos_the_app_entries_move_to_file_and_help() {
        let win = spec(Os::Win, "en");
        assert_eq!(
            ids(win.submenu(MenuId::File).unwrap()),
            vec![
                "tab.new",
                "tab.close",
                "-",
                "app.preferences",
                "-",
                "app.quit"
            ]
        );
        assert_eq!(
            ids(win.submenu(MenuId::Help).unwrap()),
            vec![
                "help.feedback",
                "-",
                "app.checkForUpdates",
                "-",
                "app.about"
            ]
        );
        // Linux has no predefined Quit.
        let linux = spec(Os::Linux, "en");
        assert_eq!(
            ids(linux.submenu(MenuId::File).unwrap()),
            vec!["tab.new", "tab.close", "-", "app.preferences"]
        );
    }

    #[test]
    fn go_menu_has_back_forward_settings_manager_and_archive() {
        let built = spec(Os::Mac, "en");
        assert_eq!(
            ids(built.submenu(MenuId::Go).unwrap()),
            vec![
                "go.back",
                "go.forward",
                "-",
                "go.settingsManager",
                "go.archive",
                "-",
                "palette.open"
            ]
        );
        let go = &built.submenu(MenuId::Go).unwrap().items;
        assert!(go.contains(&ItemSpec::Command {
            id: "go.back".into(),
            label: "Back".into(),
            accelerator: Some("Cmd+[".into()),
            toggle: false,
        }));
        assert!(go.contains(&ItemSpec::Command {
            id: "go.settingsManager".into(),
            label: "Open Claude Code Settings".into(),
            accelerator: None,
            toggle: false,
        }));
    }

    #[test]
    fn edit_menu_is_the_os_items_plus_find() {
        let built = spec(Os::Mac, "en");
        assert_eq!(
            ids(built.submenu(MenuId::Edit).unwrap()),
            vec![
                "edit.undo",
                "edit.redo",
                "-",
                "edit.cut",
                "edit.copy",
                "edit.paste",
                "edit.selectAll",
                "-",
                "edit.find"
            ]
        );
        let linux = spec(Os::Linux, "en");
        assert_eq!(
            ids(linux.submenu(MenuId::Edit).unwrap()),
            vec![
                "edit.cut",
                "edit.copy",
                "edit.paste",
                "edit.selectAll",
                "-",
                "edit.find"
            ]
        );
    }

    #[test]
    fn the_window_menu_does_not_take_cmd_w_from_close_tab() {
        let built = spec(Os::Mac, "en");
        let has_close_window = built.items().any(|item| {
            matches!(item, ItemSpec::Predefined { label, .. } if label.contains("Close Window"))
        });
        assert!(!has_close_window);
        let close_tab = built
            .items()
            .find(|item| matches!(item, ItemSpec::Command { id, .. } if id == "tab.close"));
        assert!(matches!(
            close_tab,
            Some(ItemSpec::Command { accelerator: Some(a), .. }) if a == "Cmd+W"
        ));
    }

    #[test]
    fn windows_and_linux_items_carry_no_app_accelerators_until_their_smoke_passes() {
        for os in [Os::Win, Os::Linux] {
            assert!(!manifest().native_shortcuts.for_os(os));
            for item in spec(os, "en").items() {
                if let ItemSpec::Command {
                    id, accelerator, ..
                } = item
                {
                    assert_eq!(accelerator, &None, "{id} on {os:?}");
                }
            }
        }
        assert!(manifest().native_shortcuts.for_os(Os::Mac));
    }

    #[test]
    fn toggles_are_checkbox_items_named_for_what_they_show() {
        let built = spec(Os::Mac, "en");
        let view = &built.submenu(MenuId::View).unwrap().items;
        assert!(view.contains(&ItemSpec::Command {
            id: "view.toggleInspector".into(),
            label: "Inspector".into(),
            accelerator: Some("Cmd+Shift+M".into()),
            toggle: true,
        }));
    }

    #[test]
    fn no_separator_leads_trails_or_doubles() {
        for os in Os::ALL {
            for submenu in spec(os, "en").submenus {
                let items = &submenu.items;
                assert!(!matches!(items.first(), Some(ItemSpec::Separator)));
                assert!(!matches!(items.last(), Some(ItemSpec::Separator)));
                assert!(!items
                    .windows(2)
                    .any(|w| w[0] == ItemSpec::Separator && w[1] == ItemSpec::Separator));
            }
        }
    }

    #[test]
    fn every_label_exists_in_all_five_languages() {
        for lang in LANGUAGES {
            let labels = Labels::new(lang);
            for menu in MenuId::ORDER {
                assert!(labels.has(menu.label_key()), "{lang}: {menu:?}");
            }
            for entry in &manifest().commands {
                assert!(labels.has(&entry.label_key), "{lang}: {}", entry.id);
                if let Some(key) = &entry.menu_label_key {
                    assert!(labels.has(key), "{lang}: {key}");
                }
            }
        }
    }

    #[test]
    fn a_language_change_retitles_the_same_menu() {
        let en = spec(Os::Mac, "en");
        for lang in &LANGUAGES[1..] {
            let other = spec(Os::Mac, lang);
            assert_eq!(other.command_ids(), en.command_ids(), "{lang}");
            assert_eq!(other.submenus.len(), en.submenus.len(), "{lang}");
            let titles: HashSet<&str> = other.submenus[1..]
                .iter()
                .map(|s| s.label.as_str())
                .collect();
            let english: HashSet<&str> =
                en.submenus[1..].iter().map(|s| s.label.as_str()).collect();
            assert!(
                titles.is_disjoint(&english),
                "{lang} menu titles are translated"
            );
        }
        let ko = spec(Os::Mac, "ko");
        assert_eq!(ko.submenu(MenuId::Go).unwrap().label, "이동");
        assert!(ko.items().any(|item| matches!(
            item,
            ItemSpec::Command { id, label, .. } if id == "go.settingsManager" && label == "Claude Code 설정 열기"
        )));
    }
}
