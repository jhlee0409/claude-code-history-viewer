//! The command manifest (`src/commands/manifest.json`), read by the native menu.
//!
//! The frontend's command registry and this menu read the same file, so the
//! menu cannot list a command the frontend does not handle, or miss one it
//! does (plan §4.4). The file is embedded at compile time.

use serde::Deserialize;
use std::sync::OnceLock;

const MANIFEST_JSON: &str = include_str!("../../../src/commands/manifest.json");

/// A desktop platform, as the manifest names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Os {
    Mac,
    Win,
    Linux,
}

impl Os {
    pub const ALL: [Os; 3] = [Os::Mac, Os::Win, Os::Linux];

    /// The platform this binary runs on.
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(target_os = "windows") {
            Os::Win
        } else {
            Os::Linux
        }
    }
}

/// A native menu. `App` is the macOS application menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MenuId {
    App,
    File,
    Edit,
    View,
    Go,
    Window,
    Help,
}

impl MenuId {
    /// Menu bar order.
    pub const ORDER: [MenuId; 7] = [
        MenuId::App,
        MenuId::File,
        MenuId::Edit,
        MenuId::View,
        MenuId::Go,
        MenuId::Window,
        MenuId::Help,
    ];

    /// The i18n key of the menu's title (the app menu is titled with the app name).
    pub fn label_key(self) -> &'static str {
        match self {
            MenuId::App => "common.appName",
            MenuId::File => "common.menu.file",
            MenuId::Edit => "common.menu.edit",
            MenuId::View => "common.menu.view",
            MenuId::Go => "common.menu.go",
            MenuId::Window => "common.menu.window",
            MenuId::Help => "common.menu.help",
        }
    }

    /// The submenu's own id in the built menu.
    pub fn submenu_id(self) -> &'static str {
        match self {
            MenuId::App => "menu.app",
            MenuId::File => "menu.file",
            MenuId::Edit => "menu.edit",
            MenuId::View => "menu.view",
            MenuId::Go => "menu.go",
            MenuId::Window => "menu.window",
            MenuId::Help => "menu.help",
        }
    }
}

/// `frontend`: an app command the frontend registry runs; `predefined`: an OS item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Frontend,
    Predefined,
}

/// The OS-provided menu items the manifest may name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PredefinedKind {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Maximize,
    BringAllToFront,
}

/// Accelerators per desktop platform. The manifest's `web` entry belongs to
/// the browser build and does not concern the native menu.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Shortcuts {
    pub mac: Option<String>,
    pub win: Option<String>,
    pub linux: Option<String>,
}

impl Shortcuts {
    pub fn for_os(&self, os: Os) -> Option<&str> {
        match os {
            Os::Mac => self.mac.as_deref(),
            Os::Win => self.win.as_deref(),
            Os::Linux => self.linux.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PlatformFlags {
    pub mac: bool,
    pub win: bool,
    pub linux: bool,
}

impl PlatformFlags {
    pub fn for_os(&self, os: Os) -> bool {
        match os {
            Os::Mac => self.mac,
            Os::Win => self.win,
            Os::Linux => self.linux,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub label_key: String,
    #[serde(default)]
    pub menu_label_key: Option<String>,
    pub shortcut: Option<Shortcuts>,
    pub source: Source,
    #[serde(default)]
    pub predefined: Option<PredefinedKind>,
    /// Platforms a predefined item exists on; a frontend command exists on all.
    #[serde(default)]
    pub platforms: Option<Vec<Os>>,
    pub menu: Option<MenuId>,
    /// Where an `app` entry goes on Windows and Linux, which have no app menu.
    #[serde(default)]
    pub menu_elsewhere: Option<MenuId>,
    #[serde(default)]
    pub separator_before: bool,
    #[serde(default)]
    pub toggle: bool,
    #[serde(default)]
    pub exception_reason: Option<String>,
}

impl Entry {
    pub fn exists_on(&self, os: Os) -> bool {
        self.platforms
            .as_ref()
            .map_or(true, |list| list.contains(&os))
    }

    /// The menu this entry goes in on `os`, if any.
    pub fn menu_on(&self, os: Os) -> Option<MenuId> {
        if !self.exists_on(os) {
            return None;
        }
        match self.menu? {
            MenuId::App if os != Os::Mac => self.menu_elsewhere,
            menu => Some(menu),
        }
    }

    /// Whether it sits somewhere other than its own `menu` on `os` (an app-menu entry off macOS).
    pub fn relocated_on(&self, os: Os) -> bool {
        os != Os::Mac && self.menu == Some(MenuId::App)
    }

    pub fn shortcut_on(&self, os: Os) -> Option<&str> {
        self.shortcut.as_ref().and_then(|s| s.for_os(os))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub native_shortcuts: PlatformFlags,
    pub commands: Vec<Entry>,
}

impl Manifest {
    pub fn parse(json: &str) -> Result<Manifest, serde_json::Error> {
        serde_json::from_str(json)
    }

    pub fn entry(&self, id: &str) -> Option<&Entry> {
        self.commands.iter().find(|entry| entry.id == id)
    }

    /// Whether `id` is an app command the native menu sends to the frontend.
    pub fn is_menu_command(&self, id: &str) -> bool {
        self.entry(id)
            .is_some_and(|entry| entry.source == Source::Frontend && entry.menu.is_some())
    }
}

/// The embedded manifest. A malformed manifest is a build defect the tests catch.
pub fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| Manifest::parse(MANIFEST_JSON).expect("src/commands/manifest.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_manifest_parses() {
        let manifest = Manifest::parse(MANIFEST_JSON).expect("manifest parses");
        assert!(!manifest.commands.is_empty());
    }

    #[test]
    fn predefined_entries_name_their_item_and_platforms() {
        for entry in &manifest().commands {
            match entry.source {
                Source::Predefined => {
                    assert!(entry.predefined.is_some(), "{} names its item", entry.id);
                    assert!(entry.platforms.is_some(), "{} lists platforms", entry.id);
                    assert!(entry.menu.is_some(), "{} has a menu", entry.id);
                }
                Source::Frontend => {
                    assert!(entry.predefined.is_none(), "{}", entry.id);
                    if entry.menu.is_none() {
                        assert!(
                            entry.exception_reason.is_some(),
                            "{} is in no menu and says why (D6)",
                            entry.id
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn app_menu_entries_have_a_place_off_macos() {
        for entry in &manifest().commands {
            if entry.menu != Some(MenuId::App) {
                continue;
            }
            let elsewhere = Os::ALL
                .iter()
                .any(|os| *os != Os::Mac && entry.exists_on(*os));
            if elsewhere {
                assert!(
                    matches!(entry.menu_elsewhere, Some(MenuId::File | MenuId::Help)),
                    "{} needs menuElsewhere",
                    entry.id
                );
            }
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<&str> = manifest().commands.iter().map(|e| e.id.as_str()).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count);
    }
}
