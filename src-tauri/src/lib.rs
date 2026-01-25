pub mod commands;
pub mod models;
pub mod utils;

#[cfg(test)]
pub mod test_utils;

use crate::commands::{
    feedback::{get_system_info, open_github_issues, send_feedback},
    metadata::{
        get_metadata_folder_path, get_session_display_name, is_project_hidden, load_user_metadata,
        save_user_metadata, update_project_metadata, update_session_metadata, update_user_settings,
        MetadataState,
    },
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

// NOTE: Aptabase temporarily disabled due to Tokio runtime panic
// The plugin requires a Tokio runtime at initialization, but Tauri's runtime
// isn't started yet when plugins are registered. This causes:
// "there is no reactor running, must be called from the context of a Tokio 1.x runtime"
// See: https://github.com/jhlee0409/claude-code-history-viewer/issues/63
// TODO: Re-enable when tauri-plugin-aptabase is updated to support Tauri 2.x properly
// #[cfg(not(debug_assertions))]
// use dotenvy_macro::dotenv;
// #[cfg(not(debug_assertions))]
// use tauri_plugin_aptabase::EventTracker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init());

    // Aptabase analytics - TEMPORARILY DISABLED
    // See comment at top of file for details on the Tokio runtime panic issue
    // #[cfg(not(debug_assertions))]
    // {
    //     builder =
    //         builder.plugin(tauri_plugin_aptabase::Builder::new(dotenv!("APTABASE_KEY")).build());
    // }

    builder
        .manage(MetadataState::default())
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
            open_github_issues,
            // Metadata commands
            get_metadata_folder_path,
            load_user_metadata,
            save_user_metadata,
            update_session_metadata,
            update_project_metadata,
            update_user_settings,
            is_project_hidden,
            get_session_display_name
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {
            // Production only: track app lifecycle events
            // TEMPORARILY DISABLED - Aptabase plugin causes runtime panic
            // #[cfg(not(debug_assertions))]
            // match _event {
            //     tauri::RunEvent::Ready { .. } => {
            //         let _ = _handler.track_event("app_started", None);
            //     }
            //     tauri::RunEvent::Exit { .. } => {
            //         let _ = _handler.track_event("app_exited", None);
            //         _handler.flush_events_blocking();
            //     }
            //     _ => {}
            // }
        });
}
