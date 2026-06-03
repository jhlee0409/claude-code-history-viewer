//! Aggregator for the unified GitHub Copilot provider.
//!
//! All three Copilot client surfaces — terminal CLI, Desktop app, and the
//! VS Code Copilot Chat extension — surface to the frontend as a single
//! provider with id `"copilot"`. Per-session disambiguation lives in the
//! `entrypoint` field (`copilot-cli` / `copilot-desktop` / `copilot-vscode`),
//! which the existing source-filter UI already understands.
//!
//! The aggregator calls into the three concrete scanners
//! (`copilot_cli`, `copilot_desktop`, `vscode`) and groups their results by
//! `actual_path` so a folder that has, say, both Copilot CLI sessions AND a
//! VS Code Copilot Chat history collapses into one project entry.
//!
//! Routing back to the right sub-scanner is done lazily: project paths
//! produced by the aggregator are minted with the synthetic
//! `copilot://<actual_path>` scheme, and `load_sessions` re-scans the three
//! sub-scanners and filters their projects by matching `actual_path`. This
//! costs us one extra scan on session-load, but avoids encoding multiple
//! storage hashes into the project URL.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::{copilot_cli, vscode, ProviderInfo};
use std::collections::HashMap;
use std::path::Path;

/// Public provider id stamped on every record.
pub const PROVIDER_ID: &str = "copilot";

/// Synthetic URL scheme for merged Copilot projects.
const PROJECT_SCHEME: &str = "copilot://";

/// Detect a Copilot installation. Reports available if any of the three
/// sub-providers has data on disk.
pub fn detect() -> Option<ProviderInfo> {
    let cli = copilot_cli::detect();
    let desktop = copilot_cli::detect_desktop();
    let vsc = vscode::detect();

    // Prefer the Copilot CLI/Desktop base path (`~/.copilot`) when available,
    // since that's where the bulk of session data lives. Fall back to the
    // VS Code user-data root.
    let base_path = cli
        .as_ref()
        .map(|i| i.base_path.clone())
        .or_else(|| desktop.as_ref().map(|i| i.base_path.clone()))
        .or_else(|| vsc.as_ref().map(|i| i.base_path.clone()))?;

    let is_available = cli.as_ref().is_some_and(|i| i.is_available)
        || desktop.as_ref().is_some_and(|i| i.is_available)
        || vsc.as_ref().is_some_and(|i| i.is_available);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "GitHub Copilot".to_string(),
        base_path,
        is_available,
    })
}

/// Normalise an `actual_path` so equivalent CLI and VS Code references
/// collapse to the same key. VS Code records workspace folders as
/// `file:///path` URIs while the CLI uses bare filesystem paths; we drop
/// the `file://` prefix so they group together.
fn group_key(actual_path: &str) -> String {
    actual_path
        .strip_prefix("file://")
        .unwrap_or(actual_path)
        .trim_end_matches('/')
        .to_string()
}

fn merge_projects(parts: Vec<ClaudeProject>) -> Vec<ClaudeProject> {
    let mut grouped: HashMap<String, Vec<ClaudeProject>> = HashMap::new();
    for project in parts {
        let key = group_key(&project.actual_path);
        grouped.entry(key).or_default().push(project);
    }

    let mut merged: Vec<ClaudeProject> = grouped
        .into_iter()
        .map(|(key, mut group)| {
            // Use the first project as the template; aggregate counters.
            group.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
            let template = group.first().cloned().expect("group is non-empty");
            let session_count = group.iter().map(|p| p.session_count).sum();
            let message_count = group.iter().map(|p| p.message_count).sum();
            let last_modified = group
                .iter()
                .map(|p| p.last_modified.as_str())
                .max()
                .unwrap_or("")
                .to_string();
            // Prefer a non-`file://` actual_path for display so the UI shows
            // a plain filesystem path.
            let actual_path = group
                .iter()
                .map(|p| p.actual_path.as_str())
                .find(|p| !p.starts_with("file://"))
                .unwrap_or(&template.actual_path)
                .to_string();
            let name = Path::new(&actual_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| template.name.clone());
            ClaudeProject {
                name,
                path: format!("{PROJECT_SCHEME}{key}"),
                actual_path,
                session_count,
                message_count,
                last_modified,
                git_info: None,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: None,
                custom_directory_label: template.custom_directory_label,
            }
        })
        .collect();

    merged.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    merged
}

/// Scan all three Copilot sub-providers and return one merged project list.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let mut all = Vec::new();
    if let Ok(p) = copilot_cli::scan_projects() {
        all.extend(p);
    }
    if let Ok(p) = copilot_cli::scan_desktop_projects() {
        all.extend(p);
    }
    if let Ok(p) = vscode::scan_projects() {
        all.extend(p);
    }
    Ok(merge_projects(all))
}

/// WSL/custom-path variant. `copilot_base_path` is the `~/.copilot` directory
/// for the CLI+Desktop scan; `vscode_user_data_path` is the VS Code user-data
/// dir. Either may be `None` to skip that sub-scan.
pub fn scan_projects_from_paths(
    copilot_base_path: Option<&str>,
    vscode_user_data_path: Option<&Path>,
    custom_directory_label: Option<&str>,
) -> Result<Vec<ClaudeProject>, String> {
    let mut all = Vec::new();
    if let Some(base) = copilot_base_path {
        if let Ok(p) = copilot_cli::scan_projects_from_path(base, custom_directory_label) {
            all.extend(p);
        }
        if let Ok(p) = copilot_cli::scan_desktop_projects_from_path(base, custom_directory_label) {
            all.extend(p);
        }
    }
    if let Some(base) = vscode_user_data_path {
        if let Ok(p) = vscode::scan_projects_from_user_data_path(base, custom_directory_label) {
            all.extend(p);
        }
    }
    Ok(merge_projects(all))
}

/// Strip the `copilot://` scheme from a merged project path.
fn parse_project_path(project_path: &str) -> &str {
    project_path.strip_prefix(PROJECT_SCHEME).unwrap_or(project_path)
}

/// Load sessions for a merged project. Re-scans the three sub-providers and
/// filters by matching `actual_path` (after normalisation), then concatenates
/// `load_sessions` results from each sub-source whose project matches.
pub fn load_sessions(project_path: &str, exclude: bool) -> Result<Vec<ClaudeSession>, String> {
    let target_key = group_key(parse_project_path(project_path));
    let mut sessions = Vec::new();

    let collect = |scanned: Vec<ClaudeProject>,
                   loader: &dyn Fn(&str, bool) -> Result<Vec<ClaudeSession>, String>,
                   sink: &mut Vec<ClaudeSession>| {
        for p in scanned {
            if group_key(&p.actual_path) == target_key {
                if let Ok(s) = loader(&p.path, exclude) {
                    sink.extend(s);
                }
            }
        }
    };

    if let Ok(scanned) = copilot_cli::scan_projects() {
        collect(scanned, &copilot_cli::load_sessions, &mut sessions);
    }
    if let Ok(scanned) = copilot_cli::scan_desktop_projects() {
        collect(scanned, &copilot_cli::load_sessions, &mut sessions);
    }
    if let Ok(scanned) = vscode::scan_projects() {
        collect(scanned, &vscode::load_sessions, &mut sessions);
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Heuristic: does this look like a VS Code chat session file path?
fn is_vscode_session_path(session_path: &str) -> bool {
    (session_path.contains("/workspaceStorage/") || session_path.contains("\\workspaceStorage\\"))
        && (session_path.contains("/chatSessions/") || session_path.contains("\\chatSessions\\"))
}

/// Load messages by sniffing the session file path and dispatching to the
/// correct sub-scanner. Both copilot_cli and vscode loaders already stamp
/// `provider: "copilot"` on each message because we updated their constants.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    if is_vscode_session_path(session_path) {
        vscode::load_messages(session_path)
    } else {
        copilot_cli::load_messages(session_path)
    }
}

/// Search across all three sub-providers and merge results, capping at `limit`.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let mut out = Vec::new();
    if let Ok(r) = copilot_cli::search(query, limit) {
        out.extend(r);
    }
    if let Ok(r) = copilot_cli::search_desktop(query, limit) {
        out.extend(r);
    }
    if let Ok(r) = vscode::search(query, limit) {
        out.extend(r);
    }
    out.truncate(limit);
    Ok(out)
}

/// WSL/custom-path search variant.
pub fn search_from_paths(
    copilot_base_path: Option<&str>,
    vscode_user_data_path: Option<&Path>,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    let mut out = Vec::new();
    if let Some(base) = copilot_base_path {
        if let Ok(r) = copilot_cli::search_from_path(base, query, limit) {
            out.extend(r);
        }
        if let Ok(r) = copilot_cli::search_desktop_from_path(base, query, limit) {
            out.extend(r);
        }
    }
    if let Some(base) = vscode_user_data_path {
        if let Ok(r) = vscode::search_from_user_data_path(base, query, limit) {
            out.extend(r);
        }
    }
    out.truncate(limit);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(actual_path: &str, path: &str, sessions: usize, messages: usize) -> ClaudeProject {
        ClaudeProject {
            name: Path::new(actual_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| actual_path.to_string()),
            path: path.to_string(),
            actual_path: actual_path.to_string(),
            session_count: sessions,
            message_count: messages,
            last_modified: "2026-01-01T00:00:00Z".to_string(),
            git_info: None,
            provider: Some("copilot".to_string()),
            storage_type: None,
            custom_directory_label: None,
        }
    }

    #[test]
    fn group_key_strips_file_prefix_and_trailing_slash() {
        assert_eq!(group_key("/Users/me/repo"), "/Users/me/repo");
        assert_eq!(group_key("file:///Users/me/repo"), "/Users/me/repo");
        assert_eq!(group_key("file:///Users/me/repo/"), "/Users/me/repo");
    }

    #[test]
    fn merge_collapses_cli_and_vscode_for_same_folder() {
        let cli = project("/Users/me/repo", "copilot-cli:///Users/me/repo", 2, 50);
        let vsc = project(
            "file:///Users/me/repo",
            "vscode:///Users/me/.vscode/workspaceStorage/abc",
            3,
            70,
        );
        let merged = merge_projects(vec![cli, vsc]);
        assert_eq!(merged.len(), 1);
        let p = &merged[0];
        assert_eq!(p.session_count, 5);
        assert_eq!(p.message_count, 120);
        assert_eq!(p.actual_path, "/Users/me/repo");
        assert_eq!(p.path, "copilot:///Users/me/repo");
        assert_eq!(p.provider.as_deref(), Some("copilot"));
    }

    #[test]
    fn merge_keeps_distinct_folders_separate() {
        let a = project("/repo/a", "copilot-cli:///repo/a", 1, 5);
        let b = project("/repo/b", "copilot-cli:///repo/b", 2, 10);
        let merged = merge_projects(vec![a, b]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn parse_project_path_strips_scheme() {
        assert_eq!(parse_project_path("copilot:///repo/a"), "/repo/a");
        assert_eq!(parse_project_path("/repo/a"), "/repo/a");
    }

    #[test]
    fn is_vscode_session_path_detects_chatsessions_files() {
        assert!(is_vscode_session_path(
            "/Users/me/Library/Application Support/Code/User/workspaceStorage/abc/chatSessions/x.jsonl"
        ));
        assert!(is_vscode_session_path(
            r"C:\Users\me\AppData\Roaming\Code\User\workspaceStorage\abc\chatSessions\x.jsonl"
        ));
        assert!(!is_vscode_session_path(
            "/Users/me/.copilot/session-state/abc/events.jsonl"
        ));
    }
}
