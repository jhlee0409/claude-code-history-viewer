pub mod commands;
pub mod models;
pub mod providers;
pub mod utils;

#[cfg(feature = "webui-server")]
pub mod server;

#[cfg(test)]
pub mod test_utils;

use crate::commands::{
    claude_settings::{
        get_all_mcp_servers, get_all_settings, get_claude_json_config, get_mcp_servers,
        get_settings_by_scope, read_text_file, save_mcp_servers, save_settings, write_text_file,
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
    project::{get_claude_folder_path, get_git_log, scan_projects, validate_claude_folder},
    session::{
        get_recent_edits, get_session_message_count, load_project_sessions, load_session_messages,
        load_session_messages_paginated, rename_opencode_session_title, rename_session_native,
        reset_session_native_name, restore_file, search_messages,
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
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    use std::sync::{Arc, Mutex};

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
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
        .manage(Arc::new(Mutex::new(None))
            as Arc<
                Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>,
            >)
        .invoke_handler(tauri::generate_handler![
            get_claude_folder_path,
            validate_claude_folder,
            scan_projects,
            get_git_log,
            load_project_sessions,
            load_session_messages,
            load_session_messages_paginated,
            get_session_message_count,
            search_messages,
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
            search_all_providers
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}

/// Run the Axum-based `WebUI` server (headless mode).
#[cfg(feature = "webui-server")]
fn run_server(args: &[String]) {
    use std::sync::Arc;

    let port = parse_cli_flag(args, "--port")
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3727);
    let host = parse_cli_flag(args, "--host").unwrap_or_else(|| "127.0.0.1".to_string());
    let dist_dir = parse_cli_flag(args, "--dist");

    let metadata = Arc::new(MetadataState::default());
    let state = Arc::new(server::state::AppState {
        metadata,
        start_time: std::time::Instant::now(),
    });

    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(server::start(state, &host, port, dist_dir.as_deref()));
}

/// Parse a CLI flag value: `--flag value` or `--flag=value`.
#[cfg(feature = "webui-server")]
fn parse_cli_flag(args: &[String], flag: &str) -> Option<String> {
    for (i, arg) in args.iter().enumerate() {
        // --flag=value
        if let Some(val) = arg.strip_prefix(&format!("{flag}=")) {
            return Some(val.to_string());
        }
        // --flag value
        if arg == flag {
            return args.get(i + 1).cloned();
        }
    }
    None
}
