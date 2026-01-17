mod models;
mod commands;
mod utils;

use crate::commands::{project::*, session::*, stats::*, update::*, secure_update::*, feedback::*};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
                        get_claude_folder_path,
            validate_claude_folder,
            scan_projects,
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
            check_for_updates,
            check_for_updates_secure,
            verify_download_integrity,
            send_feedback,
            get_system_info,
            open_github_issues
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}