//! GitHub Copilot Desktop provider.
//!
//! Copilot Desktop shares its on-disk format and base directory
//! (`~/.copilot/session-state/<sessionId>/`) with the Copilot CLI. The two are
//! distinguished per-session by `<sessionDir>/workspace.yaml::client_name`:
//!
//! * `github/autopilot` → Copilot Desktop (this provider)
//! * `github/cli` (or missing) → Copilot CLI
//!
//! All scanning, loading, and search logic lives in [`super::copilot_cli`];
//! this module is a thin wrapper that selects the Desktop variant.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::{copilot_cli, ProviderInfo};

pub fn detect() -> Option<ProviderInfo> {
    copilot_cli::detect_desktop()
}

pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    copilot_cli::scan_desktop_projects()
}

pub fn scan_projects_from_user_data_path(
    user_data_path: &str,
    custom_directory_label: Option<&str>,
) -> Result<Vec<ClaudeProject>, String> {
    copilot_cli::scan_desktop_projects_from_path(user_data_path, custom_directory_label)
}

pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    // `parse_project_path` recovers the ClientKind from the URL scheme, so the
    // shared loader already filters by Desktop when given a `copilot-desktop://`
    // path. No extra wrapper logic needed.
    copilot_cli::load_sessions(project_path, exclude_sidechain)
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    // The shared loader inspects `workspace.yaml` to stamp the right provider
    // id on each message.
    copilot_cli::load_messages(session_path)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    copilot_cli::search_desktop(query, limit)
}

pub fn search_from_path(
    base_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    copilot_cli::search_desktop_from_path(base_path, query, limit)
}
