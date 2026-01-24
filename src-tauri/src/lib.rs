pub mod commands;
pub mod models;
pub mod utils;

#[cfg(test)]
pub mod test_utils;

use crate::commands::{
    feedback::{get_system_info, open_github_issues, send_feedback},
    project::{get_claude_folder_path, scan_projects, validate_claude_folder},
    session::{
        get_recent_edits, get_session_message_count, load_project_sessions, load_session_messages,
        load_session_messages_paginated, restore_file, search_messages,
    },
    stats::{
        get_global_stats_summary, get_project_stats_summary, get_project_token_stats,
        get_session_comparison, get_session_token_stats,
    },
};

#[cfg(not(debug_assertions))]
use dotenvy_macro::dotenv;
#[cfg(not(debug_assertions))]
use tauri_plugin_aptabase::EventTracker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

    // Aptabase analytics - production only
    #[cfg(not(debug_assertions))]
    {
        builder =
            builder.plugin(tauri_plugin_aptabase::Builder::new(dotenv!("APTABASE_KEY")).build());
    }
    builder
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
            send_feedback,
            get_system_info,
            open_github_issues
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_handler, _event| {
            // Production only: track app lifecycle events
            #[cfg(not(debug_assertions))]
            match _event {
                tauri::RunEvent::Ready { .. } => {
                    _handler.track_event("app_started", None);
                }
                tauri::RunEvent::Exit { .. } => {
                    _handler.track_event("app_exited", None);
                    _handler.flush_events_blocking();
                }
                _ => {}
            }
        });
}
