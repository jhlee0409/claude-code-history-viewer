//! The real menu bar: built from the spec, wired to the frontend (plan §4.4).
//!
//! - `initial_menu` builds the menu at startup in the saved UI language (or
//!   the system's), every command enabled.
//! - `handle_menu_event` records an app command's click or accelerator in the
//!   menu journal (`MenuJournal`: numbered, kept until acknowledged) and emits
//!   it to the frontend as one `menu-command` event. OS items (copy, quit...)
//!   never reach it.
//! - `menu_journal` / `ack_menu_events`: the frontend pulls what it has not
//!   run (startup, a reload, a new listener) and acknowledges what it ran.
//! - `sync_menu_state` takes the frontend's language and command state: a new
//!   language rebuilds the menu; otherwise changed items are updated in place.
//!   The state is only shown: the page owns the shortcuts and re-checks a
//!   command when its menu event runs. It also carries the page's tab in
//!   front, which the journal stamps on every event chosen after it.
//!
//! One app-wide menu-event handler is registered once at startup, so a
//! rebuilt menu adds no listener.

use super::bridge::{ItemState, MenuBridge, MenuStatePayload, SyncOutcome};
use super::journal::{JournalSnapshot, MenuJournal};
use super::labels::Labels;
use super::manifest::{manifest, MenuId, Os, PredefinedKind};
use super::spec::{build_spec, ItemSpec, MenuSpec};
use std::collections::HashMap;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
    HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// The event the frontend listens on (`MENU_COMMAND_EVENT` in `nativeMenu.ts`).
pub const MENU_COMMAND_EVENT: &str = "menu-command";

/// macOS gives the Window and Help menus their system extras (window list,
/// help search) by these ids.
fn submenu_id(menu: MenuId) -> &'static str {
    match menu {
        MenuId::Window => WINDOW_SUBMENU_ID,
        MenuId::Help => HELP_SUBMENU_ID,
        other => other.submenu_id(),
    }
}

fn predefined<R: Runtime>(
    app: &AppHandle<R>,
    kind: PredefinedKind,
    label: &str,
    labels: &Labels,
) -> tauri::Result<PredefinedMenuItem<R>> {
    let text = Some(label);
    match kind {
        PredefinedKind::About => {
            let metadata = AboutMetadata {
                name: Some(labels.app_name()),
                version: Some(app.package_info().version.to_string()),
                ..Default::default()
            };
            PredefinedMenuItem::about(app, text, Some(metadata))
        }
        PredefinedKind::Services => PredefinedMenuItem::services(app, text),
        PredefinedKind::Hide => PredefinedMenuItem::hide(app, text),
        PredefinedKind::HideOthers => PredefinedMenuItem::hide_others(app, text),
        PredefinedKind::ShowAll => PredefinedMenuItem::show_all(app, text),
        PredefinedKind::Quit => PredefinedMenuItem::quit(app, text),
        PredefinedKind::Undo => PredefinedMenuItem::undo(app, text),
        PredefinedKind::Redo => PredefinedMenuItem::redo(app, text),
        PredefinedKind::Cut => PredefinedMenuItem::cut(app, text),
        PredefinedKind::Copy => PredefinedMenuItem::copy(app, text),
        PredefinedKind::Paste => PredefinedMenuItem::paste(app, text),
        PredefinedKind::SelectAll => PredefinedMenuItem::select_all(app, text),
        PredefinedKind::Fullscreen => PredefinedMenuItem::fullscreen(app, text),
        PredefinedKind::Minimize => PredefinedMenuItem::minimize(app, text),
        PredefinedKind::Maximize => PredefinedMenuItem::maximize(app, text),
        PredefinedKind::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, text),
    }
}

/// Build `spec` as a real menu, each command item in its synced state.
fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    spec: &MenuSpec,
    states: &HashMap<String, ItemState>,
    labels: &Labels,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for sub in &spec.submenus {
        let submenu = Submenu::with_id(app, submenu_id(sub.menu), &sub.label, true)?;
        for item in &sub.items {
            match item {
                ItemSpec::Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
                ItemSpec::Predefined { kind, label, .. } => {
                    submenu.append(&predefined(app, *kind, label, labels)?)?;
                }
                ItemSpec::Command {
                    id,
                    label,
                    accelerator,
                    toggle,
                } => {
                    let state = states.get(id);
                    let enabled = state.map_or(true, |s| s.enabled);
                    if *toggle {
                        let checked = state.and_then(|s| s.checked).unwrap_or(false);
                        submenu.append(&CheckMenuItem::with_id(
                            app,
                            id.as_str(),
                            label,
                            enabled,
                            checked,
                            accelerator.as_deref(),
                        )?)?;
                    } else {
                        submenu.append(&MenuItem::with_id(
                            app,
                            id.as_str(),
                            label,
                            enabled,
                            accelerator.as_deref(),
                        )?)?;
                    }
                }
            }
        }
        menu.append(&submenu)?;
    }
    Ok(menu)
}

/// Every leaf item of a built menu.
fn leaf_items<R: Runtime>(menu: &Menu<R>) -> Vec<MenuItemKind<R>> {
    let mut leaves = Vec::new();
    for item in menu.items().unwrap_or_default() {
        if let Some(submenu) = item.as_submenu() {
            leaves.extend(submenu.items().unwrap_or_default());
        }
    }
    leaves
}

/// The app-command ids of a built menu, in menu order (its OS items excluded).
pub fn built_command_ids<R: Runtime>(menu: &Menu<R>) -> Vec<String> {
    leaf_items(menu)
        .into_iter()
        .filter(|item| item.as_menuitem().is_some() || item.as_check_menuitem().is_some())
        .map(|item| item.id().as_ref().to_string())
        .collect()
}

/// Check the built menu against the manifest's spec (the T11a invariant:
/// menu ids = manifest). A mismatch is a defect: logged, and fatal in debug.
fn verify_built<R: Runtime>(menu: &Menu<R>, spec: &MenuSpec, language: &str) {
    let built = built_command_ids(menu);
    let expected: Vec<&str> = spec.command_ids();
    if built != expected {
        log::error!("native menu ids {built:?} differ from the manifest {expected:?}");
        debug_assert_eq!(built, expected, "native menu ids = manifest");
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "[menu] built in {language}: {} submenus, {} commands: {}",
        spec.submenus.len(),
        built.len(),
        built.join(",")
    );
    #[cfg(not(debug_assertions))]
    let _ = language;
}

fn build_for<R: Runtime>(
    app: &AppHandle<R>,
    language: &str,
    states: &HashMap<String, ItemState>,
) -> tauri::Result<Menu<R>> {
    let labels = Labels::new(language);
    let spec = build_spec(manifest(), Os::current(), &labels);
    let menu = build_menu(app, &spec, states, &labels)?;
    verify_built(&menu, &spec, labels.language());
    Ok(menu)
}

/// The UI language saved by the frontend (`settings.json` in the app data
/// folder, written by `useLanguageStore`), else the system's.
fn startup_language<R: Runtime>(app: &AppHandle<R>) -> String {
    let saved = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("settings.json")).ok())
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|value| value.get("language")?.as_str().map(str::to_string));
    saved
        .or_else(tauri_plugin_os::locale)
        .unwrap_or_else(|| "en".to_string())
}

/// The startup menu, built in `setup` (the path resolver exists by then).
pub fn initial_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let bridge = app.state::<MenuBridge>();
    bridge.set_language(&startup_language(app));
    build_for(app, &bridge.language(), &bridge.states())
}

fn find_item<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<MenuItemKind<R>> {
    let menu = app.menu()?;
    leaf_items(&menu)
        .into_iter()
        .find(|item| item.id().as_ref() == id)
}

fn apply_state<R: Runtime>(item: &MenuItemKind<R>, state: ItemState) -> tauri::Result<()> {
    if let Some(check) = item.as_check_menuitem() {
        check.set_enabled(state.enabled)?;
        if let Some(checked) = state.checked {
            check.set_checked(checked)?;
        }
    } else if let Some(normal) = item.as_menuitem() {
        normal.set_enabled(state.enabled)?;
    }
    Ok(())
}

/// The app-wide menu-event handler (`Builder::on_menu_event`).
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let bridge = app.state::<MenuBridge>();
    if let Some(event) = app.state::<MenuJournal>().record(manifest(), id) {
        // A page that is not listening (startup, a reload) pulls it from the
        // journal instead; a failed emit loses nothing.
        if let Err(error) = app.emit_to("main", MENU_COMMAND_EVENT, &event) {
            log::warn!("menu event {} kept for the next pull: {error}", event.seq);
        }
    }
    // A checkbox item ticks itself when chosen. Put it back to the app's
    // state; the frontend's next sync ticks it if the command did toggle.
    if let Some(checked) = bridge.checked(id) {
        if let Some(check) = find_item(app, id)
            .as_ref()
            .and_then(|i| i.as_check_menuitem())
        {
            let _ = check.set_checked(checked);
        }
    }
}

/// The frontend reports its language and command state; the menu shows it.
#[tauri::command]
pub async fn sync_menu_state(
    app: AppHandle,
    bridge: State<'_, MenuBridge>,
    journal: State<'_, MenuJournal>,
    state: MenuStatePayload,
) -> Result<(), String> {
    // First, whatever happens to the menu: the stamp of the next menu events.
    journal.report_front_tab(state.front_tab_id.clone());
    let outcome = bridge.sync(manifest(), state);
    if let Err(error) = apply_outcome(&app, &outcome) {
        bridge.apply_failed();
        return Err(error.to_string());
    }
    Ok(())
}

/// Every menu event the frontend has not acknowledged, oldest first.
#[tauri::command]
pub fn menu_journal(journal: State<'_, MenuJournal>) -> JournalSnapshot {
    journal.snapshot()
}

/// The frontend ran every menu event up to `seq` of run `epoch`.
#[tauri::command]
pub fn ack_menu_events(journal: State<'_, MenuJournal>, epoch: String, seq: u64) {
    journal.ack(&epoch, seq);
}

fn apply_outcome<R: Runtime>(app: &AppHandle<R>, outcome: &SyncOutcome) -> tauri::Result<()> {
    if outcome.rebuild {
        let menu = build_for(app, &outcome.language, &outcome.items)?;
        app.set_menu(menu)?;
    } else if !outcome.items.is_empty() {
        if let Some(menu) = app.menu() {
            for item in leaf_items(&menu) {
                if let Some(state) = outcome.items.get(item.id().as_ref()) {
                    apply_state(&item, *state)?;
                }
            }
        }
    }
    Ok(())
}
