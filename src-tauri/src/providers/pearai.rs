//! `PearAI` provider.
//!
//! `PearAI` is a fork of Continue that rebrands the global directory from
//! `~/.continue` to `~/.pearai`. The session store format is identical
//! (`<sessionId>.json` + `sessions.json` index), so this module is a thin
//! wrapper over the shared [`super::continue_dev`] family core.
//!
//! Unlike Continue, `PearAI` here does NOT honor `CONTINUE_GLOBAL_DIR`: doing
//! so would let a Continue user's override dir be scanned twice (once per
//! provider) and mislabel Continue sessions as `PearAI`. `PearAI` uses
//! `~/.pearai` exclusively.

use super::continue_dev::{
    base_path_for, detect_for, load_messages_for, load_sessions_for, scan_projects_for, search_for,
    Family,
};
use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};

pub(crate) const PEARAI: Family = Family {
    provider_id: "pearai",
    display_name: "PearAI",
    home_subdir: ".pearai",
    global_dir_env: None,
    scheme: "pearai://",
};

/// Detect a `PearAI` installation.
pub fn detect() -> Option<ProviderInfo> {
    detect_for(&PEARAI)
}

/// Base path for `PearAI` sessions: `~/.pearai/sessions`.
pub fn get_base_path() -> Option<String> {
    base_path_for(&PEARAI)
}

/// Scan `PearAI` projects under the default sessions root.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_projects_for(&PEARAI)
}

/// Load the sessions belonging to one `PearAI` project.
pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_for(&PEARAI, project_path, exclude_sidechain)
}

/// Load all messages from a single `PearAI` session file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    load_messages_for(&PEARAI, session_path)
}

/// Search across all `PearAI` sessions.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    search_for(&PEARAI, query, limit)
}
