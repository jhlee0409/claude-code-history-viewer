pub mod cli;
pub mod cli_args;
pub mod commands;
pub mod export;
pub mod models;
pub mod providers;
pub mod utils;
pub mod wsl;

#[cfg(feature = "webui-server")]
pub mod server;

#[cfg(feature = "webui-server")]
const ALLOW_UNSAFE_NO_AUTH_FLAG: &str = "--allow-unsafe-no-auth";

#[cfg(feature = "webui-server")]
const MIN_CUSTOM_TOKEN_LENGTH: usize = 32;

#[cfg(feature = "webui-server")]
const AUTH_USER_FLAG: &str = "--auth-user";

#[cfg(feature = "webui-server")]
const AUTH_PASSWORD_HASH_FLAG: &str = "--auth-password-hash";

#[cfg(feature = "webui-server")]
const SECURE_COOKIES_FLAG: &str = "--secure-cookies";

#[cfg(feature = "webui-server")]
const PRINT_PASSWORD_HASH_FLAG: &str = "--print-password-hash";

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
        restore_file, search_messages,
    },
    settings::{delete_preset, get_preset, load_presets, save_preset},
    stats::{
        get_global_stats_summary, get_project_stats_summary, get_project_token_stats,
        get_session_comparison, get_session_token_stats,
    },
    unified_presets::{
        delete_unified_preset, get_unified_preset, load_unified_presets, save_unified_preset,
    },
    update::force_quit_and_relaunch,
    watcher::{start_file_watcher, stop_file_watcher},
    wsl::{detect_wsl_distros, is_wsl_available},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Headless session export (issue #343): `--export <id|path> [--format html|json]
    // [--output <file>]`. Handled before any GUI/webview so it works over SSH/CI
    // with no display.
    {
        let args: Vec<String> = std::env::args().collect();
        if args
            .iter()
            .any(|a| a == "--export" || a.starts_with("--export="))
        {
            std::process::exit(export::run_export(&args));
        }
    }

    // Check for --serve flag (WebUI server mode)
    #[cfg(feature = "webui-server")]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|a| a == "--serve") {
            run_server(&args);
            return;
        }
    }

    run_tauri();
}

/// Run the normal Tauri desktop application.
fn run_tauri() {
    configure_linux_ime_environment();

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
        .plugin(tauri_plugin_os::init());

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
            // Antigravity token-monitor commands
            load_antigravity_state,
            get_antigravity_session,
            get_antigravity_project_summary,
            // Updater fallback
            force_quit_and_relaunch
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

#[cfg(test)]
mod ime_environment_tests {
    use super::linux_ime_environment_updates;

    #[test]
    fn linux_ime_environment_sets_missing_ibus_variables_when_ibus_is_available() {
        let updates = linux_ime_environment_updates(None, None, Some("unix:path=/tmp/ibus"));

        assert_eq!(
            updates,
            vec![("GTK_IM_MODULE", "ibus"), ("XMODIFIERS", "@im=ibus"),]
        );
    }

    #[test]
    fn linux_ime_environment_preserves_existing_values() {
        let updates =
            linux_ime_environment_updates(Some("custom-gtk"), Some("@im=custom"), Some("ibus"));

        assert!(updates.is_empty());
    }

    #[test]
    fn linux_ime_environment_uses_existing_ibus_values_as_signal() {
        let updates = linux_ime_environment_updates(Some("ibus"), None, None);

        assert_eq!(updates, vec![("XMODIFIERS", "@im=ibus")]);
    }

    #[test]
    fn linux_ime_environment_does_nothing_without_ibus_signal() {
        let updates = linux_ime_environment_updates(None, None, None);

        assert!(updates.is_empty());
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_ime_environment() {
    // configure_linux_ime_environment runs during process startup before Tauri
    // spawns threads, so applying linux_ime_environment_updates with
    // std::env::set_var avoids the Rust 2024 environment mutation hazard.
    let gtk_im_module = std::env::var("GTK_IM_MODULE").ok();
    let xmodifiers = std::env::var("XMODIFIERS").ok();
    let ibus_address = std::env::var("IBUS_ADDRESS").ok();

    for (key, value) in linux_ime_environment_updates(
        gtk_im_module.as_deref(),
        xmodifiers.as_deref(),
        ibus_address.as_deref(),
    ) {
        std::env::set_var(key, value);
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_ime_environment() {}

// Pure helper used by the Linux IME setup above and exercised by unit tests;
// gated to where it is referenced so non-Linux release builds do not see it as
// dead code under `-D warnings`.
#[cfg(any(target_os = "linux", test))]
fn linux_ime_environment_updates(
    gtk_im_module: Option<&str>,
    xmodifiers: Option<&str>,
    ibus_address: Option<&str>,
) -> Vec<(&'static str, &'static str)> {
    let has_ibus_signal = [gtk_im_module, xmodifiers, ibus_address]
        .into_iter()
        .flatten()
        .any(|value| value.contains("ibus"));

    if !has_ibus_signal {
        return Vec::new();
    }

    let mut updates = Vec::new();

    if gtk_im_module.map_or(true, str::is_empty) {
        updates.push(("GTK_IM_MODULE", "ibus"));
    }

    if xmodifiers.map_or(true, str::is_empty) {
        updates.push(("XMODIFIERS", "@im=ibus"));
    }

    updates
}

/// Run the Axum-based `WebUI` server (headless mode).
#[cfg(feature = "webui-server")]
fn run_server(args: &[String]) {
    use std::sync::Arc;

    match maybe_print_password_hash(args) {
        Ok(true) => return,
        Ok(false) => {}
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    }

    let port = crate::cli_args::extract_flag_value(args, "--port")
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3727);
    let host = crate::cli_args::extract_flag_value(args, "--host")
        .unwrap_or_else(|| "0.0.0.0".to_string());
    let dist_dir = crate::cli_args::extract_flag_value(args, "--dist");
    let read_only = args.iter().any(|a| a == "--read-only");
    let base_path = crate::cli_args::extract_flag_value(args, "--base-path")
        .map(|value| {
            server::normalize_base_path(&value).unwrap_or_else(|error| {
                eprintln!("❌ Invalid --base-path: {error}");
                std::process::exit(2);
            })
        })
        .unwrap_or_else(|| "/".to_string());

    let resolved_auth = resolve_auth(args).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(2);
    });
    let allow_unsafe_no_auth = args.iter().any(|a| a == ALLOW_UNSAFE_NO_AUTH_FLAG);

    if let Err(message) =
        validate_auth_startup_options(&host, resolved_auth.auth.is_enabled(), allow_unsafe_no_auth)
    {
        eprintln!("{message}");
        std::process::exit(2);
    }

    if let Err(message) = validate_account_cookie_security(&host, &resolved_auth.startup) {
        eprintln!("{message}");
        std::process::exit(2);
    }

    let metadata = Arc::new(MetadataState::default());
    let (event_tx, _rx) =
        tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(256);

    let state = Arc::new(server::state::AppState {
        metadata,
        start_time: std::time::Instant::now(),
        auth: resolved_auth.auth.clone(),
        read_only,
        event_tx,
    });

    // Print access info — resolve a routable IP when bound to 0.0.0.0
    let display_host = if host == "0.0.0.0" {
        get_local_ip().unwrap_or_else(|| host.clone())
    } else {
        host.clone()
    };
    let display_addr = format!("{display_host}:{port}");
    match &resolved_auth.startup {
        AuthStartup::Token { token, source } => {
            let preview: String = token.chars().take(8).collect();
            eprintln!("🔑 Auth token enabled: {preview}...");
            if is_weak_custom_token(token, *source) {
                eprintln!(
                    "⚠ Custom auth token is shorter than {MIN_CUSTOM_TOKEN_LENGTH} characters; use a strong random token for network access."
                );
            }
            eprintln!(
                "   Open in browser: http://{display_addr}{}",
                server_base_href(&base_path)
            );

            match source {
                AuthTokenSource::Generated => {
                    if let Some(path) = write_generated_token_file(token) {
                        eprintln!("   Generated token saved to: {}", path.to_string_lossy());
                        eprintln!("   First login: append '?token=<token-from-file>' to the URL");
                    } else {
                        eprintln!(
                            "⚠ Failed to persist generated token. Re-run with --token <value>."
                        );
                    }
                }
                AuthTokenSource::Cli | AuthTokenSource::Env => {
                    eprintln!("   First login: append '?token=<your-token>' to the URL");
                }
            }
        }
        AuthStartup::Account {
            username,
            source,
            secure_cookies,
        } => {
            eprintln!("🔐 Account auth enabled for user: {username}");
            eprintln!(
                "   Credentials source: {}",
                match source {
                    AccountAuthSource::Cli => "CLI flags",
                    AccountAuthSource::Env => "environment variables",
                }
            );
            if *secure_cookies {
                eprintln!("   Secure cookies enabled; serve behind HTTPS.");
            } else if !is_loopback_bind_host(&host) {
                eprintln!(
                    "⚠ Secure cookies are disabled. Add {SECURE_COOKIES_FLAG} when using HTTPS reverse proxy."
                );
            }
            eprintln!(
                "   Open in browser: http://{display_addr}{}",
                server_base_href(&base_path)
            );
        }
        AuthStartup::Disabled => {
            eprintln!("🔓 Authentication disabled (--no-auth)");
            if !is_loopback_bind_host(&host) {
                eprintln!(
                    "⚠ WARNING: --no-auth on a non-loopback host exposes your data to the network!"
                );
                eprintln!("  Anyone on your network can read your conversation history without authentication.");
            }
            eprintln!(
                "   Open in browser: http://{display_addr}{}",
                server_base_href(&base_path)
            );
        }
    }
    if read_only {
        eprintln!("🔒 Read-only mode enabled: mutating API endpoints will return 403");
    }

    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(async {
        // Start background file watcher (sends events to broadcast channel)
        let _watcher_handle = start_server_file_watcher(&state);

        server::start(state, &host, port, dist_dir.as_deref(), &base_path).await;
    });
}

#[cfg(feature = "webui-server")]
fn server_base_href(base_path: &str) -> String {
    if base_path == "/" {
        "/".to_string()
    } else {
        format!("{base_path}/")
    }
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

#[cfg(feature = "webui-server")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AccountAuthSource {
    Cli,
    Env,
}

#[cfg(feature = "webui-server")]
struct ResolvedAuth {
    auth: server::auth::AuthState,
    startup: AuthStartup,
}

#[cfg(feature = "webui-server")]
enum AuthStartup {
    Disabled,
    Token {
        token: String,
        source: AuthTokenSource,
    },
    Account {
        username: String,
        source: AccountAuthSource,
        secure_cookies: bool,
    },
}

#[cfg(feature = "webui-server")]
fn resolve_auth(args: &[String]) -> Result<ResolvedAuth, String> {
    if args.iter().any(|a| a == "--no-auth") {
        return Ok(ResolvedAuth {
            auth: server::auth::AuthState::Disabled,
            startup: AuthStartup::Disabled,
        });
    }

    let secure_cookies = secure_cookies_enabled(args);
    if let Some(account) = resolve_account_auth(args, secure_cookies)? {
        return Ok(account);
    }

    let Some((token, source)) = resolve_auth_token(args) else {
        return Ok(ResolvedAuth {
            auth: server::auth::AuthState::Disabled,
            startup: AuthStartup::Disabled,
        });
    };

    Ok(ResolvedAuth {
        auth: server::auth::AuthState::Token {
            token: token.clone(),
            secure_cookies,
        },
        startup: AuthStartup::Token { token, source },
    })
}

#[cfg(feature = "webui-server")]
fn resolve_account_auth(
    args: &[String],
    secure_cookies: bool,
) -> Result<Option<ResolvedAuth>, String> {
    let username_from_cli = require_non_empty_flag(args, AUTH_USER_FLAG)?;
    let hash_from_cli = require_non_empty_flag(args, AUTH_PASSWORD_HASH_FLAG)?;
    let username_from_env = non_empty_env("CCHV_AUTH_USERNAME");
    let hash_from_env = non_empty_env("CCHV_AUTH_PASSWORD_HASH");

    let username = username_from_cli
        .clone()
        .or(username_from_env)
        .unwrap_or_default();
    let password_hash = hash_from_cli.clone().or(hash_from_env).unwrap_or_default();

    if username.is_empty() && password_hash.is_empty() {
        return Ok(None);
    }
    if username.is_empty() {
        return Err(
            "Account auth is missing a username. Set --auth-user or CCHV_AUTH_USERNAME."
                .to_string(),
        );
    }
    if password_hash.is_empty() {
        return Err(
            "Account auth is missing a password hash. Set --auth-password-hash or CCHV_AUTH_PASSWORD_HASH."
                .to_string(),
        );
    }
    if !server::auth::password_hash_is_valid(&password_hash) {
        return Err("Account auth password hash must be a valid Argon2 PHC string.".to_string());
    }

    let source = if username_from_cli.is_some() || hash_from_cli.is_some() {
        AccountAuthSource::Cli
    } else {
        AccountAuthSource::Env
    };

    Ok(Some(ResolvedAuth {
        auth: server::auth::AuthState::Account(std::sync::Arc::new(
            server::auth::AccountAuth::new(username.clone(), password_hash, secure_cookies),
        )),
        startup: AuthStartup::Account {
            username,
            source,
            secure_cookies,
        },
    }))
}

#[cfg(feature = "webui-server")]
fn require_non_empty_flag(args: &[String], flag: &str) -> Result<Option<String>, String> {
    if let Some(value) = crate::cli_args::extract_flag_value(args, flag) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(format!("{flag} must not be empty"));
        }
        return Ok(Some(trimmed.to_string()));
    }
    if crate::cli_args::has_explicit_empty_flag(args, flag) {
        return Err(format!("{flag} must not be empty"));
    }
    Ok(None)
}

#[cfg(feature = "webui-server")]
fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(feature = "webui-server")]
fn secure_cookies_enabled(args: &[String]) -> bool {
    args.iter().any(|a| a == SECURE_COOKIES_FLAG)
        || non_empty_env("CCHV_SECURE_COOKIES")
            .map(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false)
}

#[cfg(feature = "webui-server")]
fn maybe_print_password_hash(args: &[String]) -> Result<bool, String> {
    let requested = args
        .iter()
        .any(|arg| arg == PRINT_PASSWORD_HASH_FLAG || arg.starts_with("--print-password-hash="));
    if !requested {
        return Ok(false);
    }

    let cli_value = crate::cli_args::extract_flag_value(args, PRINT_PASSWORD_HASH_FLAG)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if cli_value.is_some() {
        eprintln!(
            "⚠ Passing the password on the command line exposes it in your shell history and process list. \
Prefer: CCHV_AUTH_PASSWORD=<password> {PRINT_PASSWORD_HASH_FLAG}"
        );
    }

    let password = cli_value
        .or_else(|| non_empty_env("CCHV_AUTH_PASSWORD"))
        .ok_or_else(|| {
            format!(
                "Set {PRINT_PASSWORD_HASH_FLAG} <password> or CCHV_AUTH_PASSWORD before generating a password hash."
            )
        })?;

    let hash = server::auth::hash_password_argon2id(&password)?;
    println!("{hash}");
    Ok(true)
}

#[cfg(feature = "webui-server")]
fn validate_auth_startup_options(
    host: &str,
    auth_enabled: bool,
    allow_unsafe_no_auth: bool,
) -> Result<(), String> {
    if auth_enabled || is_loopback_bind_host(host) || allow_unsafe_no_auth {
        return Ok(());
    }

    Err(format!(
        "Refusing to start with --no-auth on non-loopback host '{host}'. \
Use --host 127.0.0.1 for local-only access, enable token auth, or add \
{ALLOW_UNSAFE_NO_AUTH_FLAG} if you intentionally want unauthenticated network access."
    ))
}

/// Account auth issues a multi-day session bearer cookie. On a non-loopback bind
/// without secure cookies (i.e. plain HTTP), that cookie travels in cleartext and can
/// be sniffed and replayed to hijack the session. Refuse to start in that case rather
/// than only warning — mirroring the `--no-auth` guard. Loopback binds (local-only) and
/// `--secure-cookies` (HTTPS / TLS-terminating reverse proxy) are allowed.
#[cfg(feature = "webui-server")]
fn validate_account_cookie_security(host: &str, startup: &AuthStartup) -> Result<(), String> {
    if let AuthStartup::Account {
        secure_cookies: false,
        ..
    } = startup
    {
        if !is_loopback_bind_host(host) {
            return Err(format!(
                "Refusing to start account auth on non-loopback host '{host}' without secure cookies. \
The session cookie would be sent in cleartext and could be hijacked. \
Add {SECURE_COOKIES_FLAG} when serving over HTTPS (e.g. behind a TLS reverse proxy), \
or use --host 127.0.0.1 for local-only access."
            ));
        }
    }
    Ok(())
}

#[cfg(all(test, feature = "webui-server"))]
mod auth_startup_tests {
    use super::*;

    fn account(secure_cookies: bool) -> AuthStartup {
        AuthStartup::Account {
            username: "admin".to_string(),
            source: AccountAuthSource::Cli,
            secure_cookies,
        }
    }

    #[test]
    fn account_insecure_cookies_refused_on_non_loopback() {
        assert!(validate_account_cookie_security("0.0.0.0", &account(false)).is_err());
        assert!(validate_account_cookie_security("192.168.1.10", &account(false)).is_err());
    }

    #[test]
    fn account_insecure_cookies_allowed_on_loopback() {
        assert!(validate_account_cookie_security("127.0.0.1", &account(false)).is_ok());
        assert!(validate_account_cookie_security("localhost", &account(false)).is_ok());
    }

    #[test]
    fn account_secure_cookies_allowed_anywhere() {
        assert!(validate_account_cookie_security("0.0.0.0", &account(true)).is_ok());
    }

    #[test]
    fn non_account_modes_are_unaffected() {
        assert!(validate_account_cookie_security("0.0.0.0", &AuthStartup::Disabled).is_ok());
        assert!(validate_account_cookie_security(
            "0.0.0.0",
            &AuthStartup::Token {
                token: "x".to_string(),
                source: AuthTokenSource::Cli,
            },
        )
        .is_ok());
    }
}

#[cfg(feature = "webui-server")]
fn is_loopback_bind_host(host: &str) -> bool {
    let normalized = host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.');

    if normalized.eq_ignore_ascii_case("localhost") {
        return true;
    }

    normalized
        .parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

#[cfg(feature = "webui-server")]
fn is_weak_custom_token(token: &str, source: AuthTokenSource) -> bool {
    !matches!(source, AuthTokenSource::Generated) && token.chars().count() < MIN_CUSTOM_TOKEN_LENGTH
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
                crate::commands::watcher::prime_watch_signatures(path);
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

    if let Some(kimi_base) = providers::kimi::get_base_path() {
        let sessions = PathBuf::from(kimi_base).join("sessions");
        if sessions.is_dir() {
            paths.push(sessions);
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

    if let Some(codebuddy_base) = providers::codebuddy::get_base_path() {
        let codebuddy_projects = PathBuf::from(codebuddy_base);
        if codebuddy_projects.is_dir() {
            paths.push(codebuddy_projects);
        }
    }

    if let Some(cursor_agent_base) = providers::cursor_agent::get_base_path() {
        let cursor_agent_projects = PathBuf::from(cursor_agent_base);
        if cursor_agent_projects.is_dir() {
            paths.push(cursor_agent_projects);
        }
    }

    if let Some(continue_base) = providers::continue_dev::get_base_path() {
        let continue_sessions = PathBuf::from(continue_base);
        if continue_sessions.is_dir() {
            paths.push(continue_sessions);
        }
    }

    if let Some(pearai_base) = providers::pearai::get_base_path() {
        let pearai_sessions = PathBuf::from(pearai_base);
        if pearai_sessions.is_dir() {
            paths.push(pearai_sessions);
        }
    }

    if let Some(goose_base) = providers::goose::get_base_path() {
        let goose_sessions = PathBuf::from(goose_base);
        if goose_sessions.is_dir() {
            paths.push(goose_sessions);
        }
    }

    if let Some(llm_base) = providers::llm::get_base_path() {
        let llm_dir = PathBuf::from(llm_base);
        if llm_dir.is_dir() {
            paths.push(llm_dir);
        }
    }

    if let Some(amazon_q_base) = providers::amazon_q::get_base_path() {
        let amazon_q_dir = PathBuf::from(amazon_q_base);
        if amazon_q_dir.is_dir() {
            paths.push(amazon_q_dir);
        }
    }

    if let Some(copilot_base) = providers::copilot_cli::get_base_path() {
        let session_state = PathBuf::from(copilot_base).join("session-state");
        if session_state.is_dir() {
            paths.push(session_state);
        }
    }

    for vscode_base in providers::vscode::get_base_paths() {
        let ws_storage = vscode_base.join("workspaceStorage");
        if ws_storage.is_dir() {
            paths.push(ws_storage);
        }
    }

    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect::<Vec<_>>()
}
