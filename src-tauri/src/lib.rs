pub mod cli;
pub mod cli_args;
pub mod commands;
pub mod models;
pub mod providers;
pub mod remote;
pub mod utils;
pub mod wsl;

#[cfg(feature = "webui-server")]
pub mod server;

#[cfg(test)]
pub mod test_utils;

use crate::commands::antigravity::{
    get_antigravity_project_summary, get_antigravity_session, load_antigravity_state,
};
use crate::commands::{
    archive::{
        create_archive, delete_archive, export_session, get_archive_base_path,
        get_archive_disk_usage, get_archive_sessions, get_expiring_sessions, list_archives,
        load_archive_session_messages, rename_archive,
    },
    claude_settings::{
        get_all_mcp_servers, get_all_settings, get_claude_json_config, get_mcp_servers,
        get_settings_by_scope, read_text_file, save_mcp_servers, save_screenshot, save_settings,
        write_text_file,
    },
    feedback::{get_system_info, open_github_issues, send_feedback},
    mcp_presets::{delete_mcp_preset, get_mcp_preset, load_mcp_presets, save_mcp_preset},
    metadata::{
        get_metadata_folder_path, get_session_display_name, is_project_hidden, load_user_metadata,
        save_user_metadata, update_project_metadata, update_session_metadata, update_user_settings,
        MetadataState,
    },
    multi_provider::{
        detect_providers, load_provider_messages, load_provider_sessions, scan_all_projects,
        search_all_providers,
    },
    project::{
        detect_claude_config_dir, get_claude_folder_path, get_git_log, scan_projects,
        validate_claude_folder, validate_custom_claude_dir,
    },
    session::{
        delete_session, get_recent_edits, get_session_message_count, get_session_subagents,
        load_project_sessions, load_session_messages, load_session_messages_paginated,
        rename_opencode_session_title, rename_session_native, reset_session_native_name,
        resolve_session_file_path, restore_file, search_messages,
    },
    settings::{delete_preset, get_preset, load_presets, save_preset},
    stats::{
        get_global_stats_summary, get_project_stats_summary, get_project_token_stats,
        get_session_comparison, get_session_token_stats,
    },
    unified_presets::{
        delete_unified_preset, get_unified_preset, load_unified_presets, save_unified_preset,
    },
    watcher::{start_file_watcher, stop_file_watcher},
    wsl::{detect_wsl_distros, is_wsl_available},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // Headless: `--sync-host <id|host>` runs a one-shot remote sync and exits.
    // Intercepted before any plugin or single-instance check so the CLI works
    // independently of any running GUI instance and never opens a window.
    if let Some(target) = cli_args::extract_flag_value(&args, "--sync-host") {
        std::process::exit(run_sync_host_cli(&target));
    }

    // Check for --serve flag (WebUI server mode)
    #[cfg(feature = "webui-server")]
    if args.iter().any(|a| a == "--serve") {
        run_server(&args);
        return;
    }

    run_tauri();
}

/// Headless `--sync-host` entry point.
///
/// Exit codes:
/// * `0` — sync succeeded
/// * `1` — user error (target not found, no sources configured)
/// * `2` — system error (cannot read settings, connection failed, etc.)
fn run_sync_host_cli(target: &str) -> i32 {
    use std::io::Write;

    let code = match do_sync_host_cli(target) {
        Ok(code) => code,
        Err(msg) => {
            eprintln!("error: {msg}");
            2
        }
    };
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    code
}

fn do_sync_host_cli(target: &str) -> Result<i32, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    let user_data = home.join(".claude-history-viewer").join("user-data.json");
    let content = std::fs::read_to_string(&user_data)
        .map_err(|e| format!("cannot read {}: {e}", user_data.display()))?;

    // Use Value so we can round-trip the file and preserve unknown fields.
    let mut json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("parse user-data.json: {e}"))?;

    let remote_sources_value = json
        .get("settings")
        .and_then(|s| s.get("remoteSources"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let sources: Vec<crate::remote::RemoteSource> = serde_json::from_value(remote_sources_value)
        .map_err(|e| format!("parse remoteSources: {e}"))?;

    if sources.is_empty() {
        eprintln!("no remote sources configured");
        return Ok(1);
    }

    // Match precedence: exact id → exact host → id-prefix.
    let matched = sources
        .iter()
        .find(|s| s.id == target)
        .or_else(|| sources.iter().find(|s| s.host == target))
        .or_else(|| sources.iter().find(|s| s.id.starts_with(target)));

    let Some(source) = matched.cloned() else {
        eprintln!("no source matches '{target}'");
        eprintln!("available:");
        for s in &sources {
            eprintln!("  {}  {}@{}:{}", s.id, s.username, s.host, s.port);
        }
        return Ok(1);
    };

    println!(
        "syncing {}@{}:{} ...",
        source.username, source.host, source.port
    );

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("build tokio runtime: {e}"))?;
    let outcome = rt
        .block_on(crate::remote::sync_one(&source))
        .map_err(|e| format!("sync failed: {e}"))?;

    println!(
        "ok: {} updated, {} skipped, {} bytes, {}ms",
        outcome.stats.files_updated,
        outcome.stats.files_skipped,
        outcome.stats.bytes_transferred,
        outcome.stats.duration_ms
    );
    if !outcome.missing_paths.is_empty() {
        eprintln!(
            "note: {} configured path(s) returned nothing:",
            outcome.missing_paths.len()
        );
        for m in &outcome.missing_paths {
            eprintln!("  {} {}: {:?}", m.provider, m.configured_path, m.reason);
        }
    }

    // Mirror the GUI behaviour: register synced cache paths as customClaudePaths
    // so a future GUI launch can scan the pulled data.
    if let Err(e) = inject_paths_into_user_data(&mut json, &source, &outcome) {
        eprintln!("warning: could not update customClaudePaths in memory: {e}");
        return Ok(0);
    }
    if let Err(e) = atomic_write_user_data(&user_data, &json) {
        eprintln!("warning: could not write user-data.json: {e}");
        eprintln!(
            "  (sync data is on disk; add the cache paths above as custom directories in the GUI to view)"
        );
        return Ok(0);
    }

    Ok(0)
}

fn inject_paths_into_user_data(
    json: &mut serde_json::Value,
    source: &crate::remote::RemoteSource,
    outcome: &crate::remote::SyncOutcome,
) -> Result<(), String> {
    const SSH_DEFAULT_PORT: u16 = 22;

    let settings = json
        .as_object_mut()
        .ok_or_else(|| "user-data.json root is not an object".to_string())?
        .entry("settings")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| "settings is not an object".to_string())?;

    let paths_array = settings
        .entry("customClaudePaths")
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
        .ok_or_else(|| "customClaudePaths is not an array".to_string())?;

    let label_base = if source.port == SSH_DEFAULT_PORT {
        format!("🌐 {}", source.host)
    } else {
        format!("🌐 {}:{}", source.host, source.port)
    };

    // Build (path, label) pairs across all providers and discriminators. The
    // label encodes the discriminator only when there's more than one root for
    // that provider — single-tenant hosts get the clean original label.
    let mut entries: Vec<(String, String, Option<serde_json::Value>)> = Vec::new();
    push_provider_entries(
        &mut entries,
        &outcome.injected_paths.claude,
        &label_base,
        "",
    );
    push_provider_entries(
        &mut entries,
        &outcome.injected_paths.codex,
        &label_base,
        "codex",
    );
    push_provider_entries(
        &mut entries,
        &outcome.injected_paths.opencode,
        &label_base,
        "opencode",
    );

    for (path, label, source_meta) in entries {
        if let Some(existing) = paths_array.iter_mut().find(|v| {
            v.get("path")
                .and_then(serde_json::Value::as_str)
                .map(normalize_registered_path)
                == Some(normalize_registered_path(&path))
        }) {
            existing["path"] = serde_json::json!(normalize_registered_path(&path));
            existing["label"] = serde_json::json!(label);
            if let Some(source_meta) = source_meta {
                existing["source"] = source_meta;
            } else if let Some(obj) = existing.as_object_mut() {
                obj.remove("source");
            }
        } else {
            let mut entry =
                serde_json::json!({ "path": normalize_registered_path(&path), "label": label });
            if let Some(source_meta) = source_meta {
                entry["source"] = source_meta;
            }
            paths_array.push(entry);
        }
    }
    Ok(())
}

fn normalize_registered_path(path: &str) -> String {
    path.trim_end_matches(['\\', '/']).to_string()
}

fn push_provider_entries(
    out: &mut Vec<(String, String, Option<serde_json::Value>)>,
    roots: &[crate::remote::sync::InjectedRoot],
    label_base: &str,
    provider_tag: &str,
) {
    let multi = roots.len() > 1;
    for root in roots {
        let source_label = root
            .source
            .as_ref()
            .map(|source| source.display_label.as_str());
        let label = if let Some(source_label) = source_label {
            source_label.to_string()
        } else {
            match (provider_tag.is_empty(), multi) {
                (true, false) => label_base.to_string(),
                (true, true) => format!("{label_base} [{}]", root.discriminator),
                (false, false) => format!("{label_base} ({provider_tag})"),
                (false, true) => format!("{label_base} ({provider_tag}/{})", root.discriminator),
            }
        };
        let source_meta = root
            .source
            .as_ref()
            .and_then(|source| serde_json::to_value(source).ok());
        out.push((root.local_path.clone(), label, source_meta));
    }
}

fn atomic_write_user_data(path: &std::path::Path, json: &serde_json::Value) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(json).map_err(|e| format!("serialize: {e}"))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &serialized)
        .map_err(|e| format!("write {}: {e}", tmp_path.display()))?;
    // Windows: rename fails if destination exists.
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&tmp_path, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Run the normal Tauri desktop application.
fn run_tauri() {
    const REMOTE_REFRESH_MENU_ID: &str = "remote-refresh";

    // Workaround for WebKitGTK GPU process crash in AppImage environments.
    //
    // AppImage bundles Ubuntu-compiled EGL/Mesa libs, but the system's
    // WebKitGPUProcess (not bundled) inherits LD_LIBRARY_PATH and loads them,
    // causing EGL_BAD_ALLOC on distros with newer Mesa (e.g. Arch Linux).
    //
    // The CI pipeline removes conflicting EGL libs from the AppImage (primary fix).
    // This env var is defense-in-depth for edge cases (NVIDIA driver quirks, etc.).
    //
    // See: https://github.com/jhlee0409/claude-code-history-viewer/issues/186
    // See: https://github.com/tauri-apps/tauri/issues/11988
    // Note: std::env::set_var becomes unsafe in Rust edition 2024.
    // This is safe here because no threads exist yet at this point in startup.
    #[cfg(target_os = "linux")]
    if std::env::var("APPIMAGE")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
    {
        // Only set if not already configured by the user
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    use std::sync::{Arc, Mutex};
    use tauri::menu::{Menu, MenuItem, Submenu};
    use tauri::{Emitter, Manager};

    // Parse CLI args for a session preload hint (e.g. `--session <uuid>`).
    // A missing or unrecognized value yields None; the GUI then runs as usual.
    let startup_session_hint = cli::StartupSessionHint(cli::parse_session_hint(
        &std::env::args().collect::<Vec<_>>(),
    ));

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        // Single-instance plugin MUST be registered first so the second
        // invocation is intercepted before any other plugin does any work.
        // The callback receives the second process's argv; we re-parse it
        // for a session hint and forward to the live window. Any panic in
        // the callback is caught so a malformed argv cannot freeze the
        // already-running window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // Re-focus the main window regardless of hint presence so users
                // get visible feedback that the second launch was intercepted.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                if let Some(hint) = cli::parse_session_hint(&argv) {
                    // Frontend listens on this event (see App.tsx).
                    let _ = app.emit("cli-session-hint", hint);
                }
            }));
            if result.is_err() {
                log::error!("single_instance callback panicked; argv dropped");
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let refresh_item = MenuItem::with_id(
                app,
                REMOTE_REFRESH_MENU_ID,
                "Refresh Remote Sessions",
                true,
                Some("Ctrl+R"),
            )?;
            let actions_menu = Submenu::with_items(app, "Actions", true, &[&refresh_item])?;
            let menu = Menu::with_items(app, &[&actions_menu])?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == REMOTE_REFRESH_MENU_ID {
                let _ = app.emit("remote-refresh-requested", ());
            }
        });

    builder
        .manage(MetadataState::default())
        .manage(startup_session_hint)
        .manage(Arc::new(Mutex::new(None))
            as Arc<
                Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>,
            >)
        .invoke_handler(tauri::generate_handler![
            crate::cli::get_startup_session_hint,
            get_claude_folder_path,
            validate_claude_folder,
            validate_custom_claude_dir,
            detect_claude_config_dir,
            scan_projects,
            get_git_log,
            load_project_sessions,
            load_session_messages,
            load_session_messages_paginated,
            get_session_message_count,
            search_messages,
            get_session_subagents,
            get_recent_edits,
            restore_file,
            resolve_session_file_path,
            get_session_token_stats,
            get_project_token_stats,
            get_project_stats_summary,
            get_session_comparison,
            get_global_stats_summary,
            send_feedback,
            get_system_info,
            open_github_issues,
            // Metadata commands
            get_metadata_folder_path,
            load_user_metadata,
            save_user_metadata,
            update_session_metadata,
            update_project_metadata,
            update_user_settings,
            is_project_hidden,
            get_session_display_name,
            // Settings preset commands
            save_preset,
            load_presets,
            get_preset,
            delete_preset,
            // MCP preset commands
            save_mcp_preset,
            load_mcp_presets,
            get_mcp_preset,
            delete_mcp_preset,
            // Unified preset commands
            save_unified_preset,
            load_unified_presets,
            get_unified_preset,
            delete_unified_preset,
            // Claude Code settings commands
            get_settings_by_scope,
            save_settings,
            get_all_settings,
            get_mcp_servers,
            get_all_mcp_servers,
            save_mcp_servers,
            get_claude_json_config,
            // File I/O commands for export/import
            write_text_file,
            read_text_file,
            save_screenshot,
            delete_session,
            // Native session rename commands
            rename_session_native,
            reset_session_native_name,
            rename_opencode_session_title,
            // File watcher commands
            start_file_watcher,
            stop_file_watcher,
            // Multi-provider commands
            detect_providers,
            scan_all_projects,
            load_provider_sessions,
            load_provider_messages,
            search_all_providers,
            // Archive commands
            get_archive_base_path,
            list_archives,
            create_archive,
            delete_archive,
            rename_archive,
            get_archive_sessions,
            load_archive_session_messages,
            get_archive_disk_usage,
            get_expiring_sessions,
            export_session,
            // WSL commands
            detect_wsl_distros,
            is_wsl_available,
            // Remote SSH source sync commands
            crate::commands::remote_sync::test_remote_connection,
            crate::commands::remote_sync::sync_remote_source,
            crate::commands::remote_sync::sync_all_remote_sources,
            // Antigravity token-monitor commands
            load_antigravity_state,
            get_antigravity_session,
            get_antigravity_project_summary
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS-only: Spotlight / Dock / Finder launches don't re-exec
            // argv, so `tauri-plugin-single-instance` cannot see them. The OS
            // instead delivers the target as an Apple Event that Tauri
            // surfaces as `RunEvent::Opened { urls }`. We convert the first
            // resolvable URL into a `SessionHint` and re-use the same
            // `cli-session-hint` event the single-instance callback emits so
            // the frontend has one unified listener.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Some(hint) = cli::parse_session_hint_from_url(url) {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("cli-session-hint", hint);
                        break;
                    }
                }
            }
            // Prevent unused-variable warnings on non-macOS builds.
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app;
                let _ = event;
            }
        });
}

/// Run the Axum-based `WebUI` server (headless mode).
#[cfg(feature = "webui-server")]
fn run_server(args: &[String]) {
    use std::sync::Arc;

    let port = crate::cli_args::extract_flag_value(args, "--port")
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3727);
    let host = crate::cli_args::extract_flag_value(args, "--host")
        .unwrap_or_else(|| "0.0.0.0".to_string());
    let dist_dir = crate::cli_args::extract_flag_value(args, "--dist");

    // Auth token: --token <value> | --no-auth | auto-generated uuid v4
    let auth_token_info = resolve_auth_token(args);
    let auth_token = auth_token_info.as_ref().map(|(token, _)| token.clone());

    let metadata = Arc::new(MetadataState::default());
    let (event_tx, _rx) =
        tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(256);

    let state = Arc::new(server::state::AppState {
        metadata,
        start_time: std::time::Instant::now(),
        auth_token: auth_token.clone(),
        event_tx,
    });

    // Print access info — resolve a routable IP when bound to 0.0.0.0
    let display_host = if host == "0.0.0.0" {
        get_local_ip().unwrap_or_else(|| host.clone())
    } else {
        host.clone()
    };
    let display_addr = format!("{display_host}:{port}");
    if let Some((token, source)) = auth_token_info {
        let preview: String = token.chars().take(8).collect();
        eprintln!("🔑 Auth token enabled: {preview}...");
        eprintln!("   Open in browser: http://{display_addr}");

        match source {
            AuthTokenSource::Generated => {
                if let Some(path) = write_generated_token_file(&token) {
                    eprintln!("   Generated token saved to: {}", path.to_string_lossy());
                    eprintln!("   First login: append '?token=<token-from-file>' to the URL");
                } else {
                    eprintln!("⚠ Failed to persist generated token. Re-run with --token <value>.");
                }
            }
            AuthTokenSource::Cli | AuthTokenSource::Env => {
                eprintln!("   First login: append '?token=<your-token>' to the URL");
            }
        }
    } else {
        eprintln!("🔓 Authentication disabled (--no-auth)");
        if host == "0.0.0.0" {
            eprintln!("⚠ WARNING: --no-auth with 0.0.0.0 exposes your data to the entire network!");
            eprintln!("  Anyone on your network can read your conversation history without authentication.");
        }
        eprintln!("   Open in browser: http://{display_addr}");
    }

    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(async {
        // Start background file watcher (sends events to broadcast channel)
        let _watcher_handle = start_server_file_watcher(&state);

        server::start(state, &host, port, dist_dir.as_deref()).await;
    });
}

/// Detect the machine's LAN IP address by connecting a UDP socket to an
/// external address.  No actual traffic is sent — the OS just picks the
/// outbound interface, giving us the local IP.
#[cfg(feature = "webui-server")]
fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

#[cfg(feature = "webui-server")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthTokenSource {
    Cli,
    Env,
    Generated,
}

/// Resolve the authentication token from CLI arguments or environment.
///
/// Priority:
/// - `--no-auth` → `None` (auth disabled)
/// - `--token <value>` → `Some(value)` (user-supplied via CLI)
/// - `CCHV_TOKEN` env var → `Some(value)` (user-supplied via env, e.g. systemd)
/// - otherwise → `Some(uuid-v4)` (auto-generated)
#[cfg(feature = "webui-server")]
fn resolve_auth_token(args: &[String]) -> Option<(String, AuthTokenSource)> {
    if args.iter().any(|a| a == "--no-auth") {
        return None;
    }
    if let Some(token) = crate::cli_args::extract_flag_value(args, "--token") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Some((trimmed.to_string(), AuthTokenSource::Cli));
        }
        eprintln!("⚠ --token value is empty; falling back to auto-generated token");
    } else if crate::cli_args::has_explicit_empty_flag(args, "--token") {
        // `extract_flag_value` returns None for `--token=` and for a bare
        // `--token` at end-of-argv. Neither case should silently auto-generate
        // a token without warning the operator their config is broken.
        eprintln!("⚠ --token value is empty; falling back to auto-generated token");
    }
    if let Ok(token) = std::env::var("CCHV_TOKEN") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Some((trimmed.to_string(), AuthTokenSource::Env));
        }
    }
    Some((uuid::Uuid::new_v4().to_string(), AuthTokenSource::Generated))
}

/// Persist auto-generated token to a local file instead of logging the full secret.
#[cfg(feature = "webui-server")]
fn write_generated_token_file(token: &str) -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".claude-history-viewer");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("webui-token.txt");
    std::fs::write(&path, format!("{token}\n")).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Some(path)
}

/// Start a `notify`-based file watcher that pushes change events into the
/// broadcast channel on `state.event_tx`.
///
/// Returns the debouncer handle — it must be kept alive for the watcher to
/// continue running.  Returns `None` if the watched directory doesn't exist.
#[cfg(feature = "webui-server")]
fn start_server_file_watcher(
    state: &std::sync::Arc<server::state::AppState>,
) -> Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>> {
    let watch_paths = collect_watch_paths();
    if watch_paths.is_empty() {
        eprintln!("⚠ No supported provider directories found; real-time file watcher disabled");
        return None;
    }

    let tx = state.event_tx.clone();

    let mut debouncer = notify_debouncer_mini::new_debouncer(
        std::time::Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = result {
                for event in events {
                    if let Some(watch_event) = crate::commands::watcher::to_file_watch_event(&event)
                    {
                        crate::commands::session::invalidate_search_cache();
                        // Ignore send errors (no active subscribers yet)
                        let _ = tx.send(watch_event);
                    }
                }
            }
        },
    )
    .ok()?;

    let mut watched_count = 0usize;
    for path in &watch_paths {
        match debouncer
            .watcher()
            .watch(path, notify::RecursiveMode::Recursive)
        {
            Ok(()) => {
                watched_count += 1;
                eprintln!("👁 File watcher active: {}", path.display());
            }
            Err(e) => {
                eprintln!("⚠ Failed to watch {}: {e}", path.display());
            }
        }
    }

    if watched_count == 0 {
        eprintln!("⚠ Real-time updates disabled (no watch path could be registered)");
        return None;
    }

    Some(debouncer)
}

/// Collect available provider directories to watch for live session file updates.
#[cfg(feature = "webui-server")]
fn collect_watch_paths() -> Vec<std::path::PathBuf> {
    use std::collections::HashSet;
    use std::path::PathBuf;

    let mut paths: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        let claude_projects = home.join(".claude").join("projects");
        if claude_projects.is_dir() {
            paths.push(claude_projects);
        }

        // Load custom Claude paths from user-data.json
        let user_data_path = home.join(".claude-history-viewer").join("user-data.json");
        if let Ok(content) = std::fs::read_to_string(&user_data_path) {
            if let Ok(metadata) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(custom_paths) = metadata
                    .get("settings")
                    .and_then(|s| s.get("customClaudePaths"))
                    .and_then(|v| v.as_array())
                {
                    for entry in custom_paths {
                        if let Some(path_str) = entry.get("path").and_then(|p| p.as_str()) {
                            let custom_base = PathBuf::from(path_str);
                            if let Ok(canonical_projects) =
                                crate::utils::validate_custom_claude_path(&custom_base)
                            {
                                paths.push(canonical_projects);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(codex_base) = providers::codex::get_base_path() {
        let base = PathBuf::from(codex_base);
        let sessions = base.join("sessions");
        let archived_sessions = base.join("archived_sessions");
        if sessions.is_dir() {
            paths.push(sessions);
        }
        if archived_sessions.is_dir() {
            paths.push(archived_sessions);
        }
    }

    if let Some(opencode_base) = providers::opencode::get_base_path() {
        let base = PathBuf::from(&opencode_base);
        let storage = base.join("storage");
        let session = storage.join("session");
        let message = storage.join("message");
        if session.is_dir() {
            paths.push(session);
        }
        if message.is_dir() {
            paths.push(message);
        }
        // Watch opencode.db for SQLite-based storage changes
        let db_path = base.join("opencode.db");
        if db_path.is_file() {
            paths.push(base);
        }
    }

    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect::<Vec<_>>()
}
