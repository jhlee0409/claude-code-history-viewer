use crate::commands::session::SearchFilters;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const HISTORY_FILE: &str = ".aider.chat.history.md";
const SESSION_HEADER_PREFIX: &str = "# aider chat started at ";

/// Detect Aider by checking top-level project directories for history files.
/// Only does a shallow (depth-1) check to avoid slow recursive scans at startup.
pub fn detect() -> Option<ProviderInfo> {
    let dirs = get_search_dirs();
    // Shallow check: look for .aider.chat.history.md directly in search dirs
    // and their immediate children (depth 1 only, no recursive scan)
    let has_history = dirs.iter().any(|d| {
        if d.join(HISTORY_FILE).is_file() {
            return true;
        }
        // Check one level of subdirectories
        fs::read_dir(d)
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| entry.path().join(HISTORY_FILE).is_file())
    });

    Some(ProviderInfo {
        id: "aider".to_string(),
        display_name: "Aider".to_string(),
        base_path: dirs
            .first()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_available: has_history,
    })
}

/// Scan for all Aider projects
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();

    for history_path in history_files() {
        let project_dir = history_path.parent().ok_or("Invalid history file path")?;
        let content = match fs::read_to_string(&history_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let sessions = split_sessions(&content);
        if sessions.is_empty() {
            continue;
        }

        projects.push(ClaudeProject {
            name: project_name_for(project_dir),
            path: project_path_for(project_dir),
            actual_path: project_dir.to_string_lossy().into_owned(),
            session_count: sessions.len(),
            message_count: sessions.iter().map(|s| count_messages(&s.content)).sum(),
            last_modified: sessions
                .last()
                .and_then(|s| s.timestamp.clone())
                .unwrap_or_default(),
            git_info: None,
            provider: Some("aider".to_string()),
            storage_type: Some("markdown".to_string()),
            custom_directory_label: None,
        });
    }

    Ok(projects)
}

/// Load sessions for an Aider project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let dir = project_path
        .strip_prefix("aider://")
        .unwrap_or(project_path);

    // Validate path is absolute and points to a real directory
    let dir_path = PathBuf::from(dir);
    if !dir_path.is_absolute() {
        return Err("Aider project path must be absolute".to_string());
    }

    let history_path = dir_path.join(HISTORY_FILE);
    if !history_path.is_file() {
        return Ok(Vec::new());
    }
    validate_history_file(&history_path)?;

    let content =
        fs::read_to_string(&history_path).map_err(|e| format!("Failed to read history: {e}"))?;

    let project_name = project_name_for(&dir_path);
    let history_file = history_path.to_string_lossy();

    let sessions_data = split_sessions(&content);
    let mut sessions = Vec::with_capacity(sessions_data.len());

    for (index, session) in sessions_data.iter().enumerate().rev() {
        let message_count = count_messages(&session.content);
        let timestamp = session.timestamp.clone().unwrap_or_default();
        let session_path = session_id_for(&history_file, index);

        sessions.push(ClaudeSession {
            session_id: session_path.clone(),
            actual_session_id: format!("session-{index}"),
            file_path: session_path,
            project_name: project_name.clone(),
            message_count,
            first_message_time: timestamp.clone(),
            last_message_time: timestamp.clone(),
            last_modified: timestamp,
            has_tool_use: session.content.contains("\n> "),
            has_errors: false,
            summary: session.first_user_message.clone(),
            is_renamed: false,
            provider: Some("aider".to_string()),
            storage_type: Some("markdown".to_string()),
            entrypoint: None,
        });
    }

    Ok(sessions)
}

/// Load messages from a specific Aider session
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    // session_path format: aider://<history_file_path>#<session_index>
    let (file_path, session_index) = parse_session_path(session_path)?;

    // Validate: must be absolute, must end with the expected filename
    let path = Path::new(file_path);
    if !path.is_absolute() {
        return Err("Session path must be absolute".to_string());
    }
    validate_history_file(path)?;

    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read history: {e}"))?;

    let sessions = split_sessions(&content);
    let session = sessions
        .get(session_index)
        .ok_or_else(|| format!("Session index {session_index} out of range"))?;

    let base_timestamp = session.timestamp.as_deref().unwrap_or_default();
    let session_id = session_id_for(file_path, session_index);

    Ok(parse_messages(
        &session.content,
        &session_id,
        base_timestamp,
    ))
}

/// Search across all Aider sessions
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    Ok(search_with_filters(
        query,
        limit,
        &SearchFilters::parse(&serde_json::Value::Null),
    ))
}

pub(crate) fn search_with_filters(
    query: &str,
    limit: usize,
    filters: &SearchFilters<'_>,
) -> Vec<ClaudeMessage> {
    if limit == 0 {
        return Vec::new();
    }
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for history_path in history_files() {
        let Some(project_dir) = history_path.parent() else {
            continue;
        };
        let project_name = project_name_for(project_dir);
        let project_path = project_path_for(project_dir);
        if !filters.matches_project(Some(&project_path), Some(&project_name)) {
            continue;
        }
        let content = match fs::read_to_string(&history_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let file_path = history_path.to_string_lossy();

        for (index, session) in split_sessions(&content).iter().enumerate() {
            let base_ts = session.timestamp.as_deref().unwrap_or_default();
            let session_id = session_id_for(&file_path, index);

            for mut msg in parse_messages(&session.content, &session_id, base_ts) {
                if !filters.matches_message(&msg) {
                    continue;
                }
                if msg.content.as_ref().is_some_and(|content| {
                    search_json_value_case_insensitive(content, &query_lower)
                }) {
                    msg.project_name = Some(project_name.clone());
                    msg.project_path = Some(project_path.clone());
                    results.push(msg);
                    if results.len() >= limit {
                        return results;
                    }
                }
            }
        }
    }

    results
}

// ============================================================================
// Private helpers
// ============================================================================

fn project_name_for(project_dir: &Path) -> String {
    project_dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

/// Opaque project identity shared by `scan_projects` and `search`.
fn project_path_for(project_dir: &Path) -> String {
    format!("aider://{}", project_dir.to_string_lossy())
}

fn session_id_for(history_path: &str, index: usize) -> String {
    format!("aider://{history_path}#{index}")
}

/// Visit each discovered history only once, even when search roots overlap.
fn history_files() -> impl Iterator<Item = PathBuf> {
    let mut seen = HashSet::new();
    get_search_dirs()
        .into_iter()
        .flat_map(|dir| find_history_files(&dir, 100))
        .filter(move |path| seen.insert(path.canonicalize().unwrap_or_else(|_| path.clone())))
}

fn get_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = crate::utils::home_dir() {
        for subdir in ["client", "projects", "code", "src", "dev", "work", "repos"] {
            let d = home.join(subdir);
            if d.is_dir() {
                dirs.push(d);
            }
        }
        // Also check home dir itself
        dirs.push(home);
    }
    dirs
}

/// Deepest project directory the scan descends to, below a search dir.
const MAX_SCAN_DEPTH: usize = 4;

/// Directories the scan never descends into.
fn is_scanned_dir_name(name: &str) -> bool {
    !name.starts_with('.')
        && name != "node_modules"
        && name != "target"
        && name != "dist"
        && name != "build"
}

/// Confine a caller-supplied history file to what `scan_projects` can find:
/// below a search dir, within the scan depth, and never inside a directory
/// the scan skips. Both sides are canonicalised, so a symlink is judged by
/// where it points.
fn validate_history_file(path: &Path) -> Result<(), String> {
    if path.file_name().and_then(|n| n.to_str()) != Some(HISTORY_FILE) {
        return Err(format!("Invalid Aider history file: {}", path.display()));
    }
    let outside = || {
        format!(
            "Aider history file is outside the scanned directories: {}",
            path.display()
        )
    };
    let canonical = path.canonicalize().map_err(|_| outside())?;
    let project = canonical.parent().ok_or_else(outside)?;
    // Within scope are also history files a client saved itself through the
    // export allowlist (e.g. ~/Downloads): it only reads back its own bytes.
    let scanned = get_search_dirs()
        .iter()
        // The scan refuses to walk a symlinked search dir; so does this.
        .filter(|dir| !is_symlink(dir))
        .filter_map(|dir| dir.canonicalize().ok())
        .any(|root| {
            project.strip_prefix(&root).is_ok_and(|rel| {
                rel.components().count() <= MAX_SCAN_DEPTH
                    && rel
                        .components()
                        .all(|c| is_scanned_dir_name(&c.as_os_str().to_string_lossy()))
            })
        });
    if scanned {
        Ok(())
    } else {
        Err(outside())
    }
}

fn find_history_files(dir: &Path, max: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    find_history_recursive(dir, &mut files, max, 0, MAX_SCAN_DEPTH);
    files
}

fn find_history_recursive(
    dir: &Path,
    results: &mut Vec<PathBuf>,
    max: usize,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth || results.len() >= max {
        return;
    }
    if is_symlink(dir) {
        return;
    }

    let history = dir.join(HISTORY_FILE);
    if history.is_file() && !is_symlink(&history) {
        results.push(history);
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if results.len() >= max {
                return;
            }
            let path = entry.path();
            if path.is_dir() && !is_symlink(&path) {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if is_scanned_dir_name(&name) {
                    find_history_recursive(&path, results, max, depth + 1, max_depth);
                }
            }
        }
    }
}

struct SessionData {
    timestamp: Option<String>,
    content: String,
    first_user_message: Option<String>,
}

fn split_sessions(content: &str) -> Vec<SessionData> {
    let mut sessions = Vec::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let mut current_timestamp: Option<String> = None;
    let mut first_user_msg: Option<String> = None;

    for line in content.lines() {
        if let Some(ts_str) = line.strip_prefix(SESSION_HEADER_PREFIX) {
            // Save previous session
            if !current_lines.is_empty() {
                sessions.push(SessionData {
                    timestamp: current_timestamp.take(),
                    content: current_lines.join("\n"),
                    first_user_message: first_user_msg.take(),
                });
                current_lines.clear();
            }
            // Parse timestamp: "2025-03-26 14:32:01" → ISO 8601
            current_timestamp = if ts_str.len() >= 19 {
                Some(format!("{}T{}Z", &ts_str[..10], &ts_str[11..19]))
            } else {
                Some(ts_str.to_string())
            };
            first_user_msg = None;
        } else {
            if first_user_msg.is_none() {
                if let Some(user_text) = line.strip_prefix("#### ") {
                    first_user_msg = Some(user_text.to_string());
                }
            }
            current_lines.push(line);
        }
    }

    // Last session
    if !current_lines.is_empty() {
        sessions.push(SessionData {
            timestamp: current_timestamp,
            content: current_lines.join("\n"),
            first_user_message: first_user_msg,
        });
    }

    sessions
}

fn count_messages(content: &str) -> usize {
    let mut count = 0;
    for line in content.lines() {
        if line.starts_with("#### ") {
            count += 1; // user message
        }
    }
    // Rough estimate: each user message has ~1 assistant reply
    count * 2
}

fn parse_messages(content: &str, session_id: &str, base_timestamp: &str) -> Vec<ClaudeMessage> {
    let mut messages = Vec::new();
    let mut current_role: Option<&str> = None; // "user", "assistant", "tool"
    let mut current_text = String::new();
    let mut counter = 0u64;

    let flush = |role: &str,
                 text: &str,
                 session_id: &str,
                 base_timestamp: &str,
                 counter: &mut u64,
                 messages: &mut Vec<ClaudeMessage>| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }
        *counter += 1;

        let (msg_type, msg_role) = match role {
            "user" => ("user", Some("user")),
            "assistant" => ("assistant", Some("assistant")),
            "tool" => ("system", None),
            _ => return,
        };

        let content = serde_json::json!([{"type": "text", "text": trimmed}]);

        let mut msg = build_provider_message(
            "aider",
            format!("aider-{counter}"),
            session_id,
            base_timestamp.to_string(),
            msg_type,
            msg_role,
            Some(content),
            None,
        );

        if role == "tool" {
            msg.subtype = Some("tool_output".to_string());
        }

        messages.push(msg);
    };

    for line in content.lines() {
        if let Some(user_text) = line.strip_prefix("#### ") {
            // Flush previous
            if let Some(role) = current_role {
                flush(
                    role,
                    &current_text,
                    session_id,
                    base_timestamp,
                    &mut counter,
                    &mut messages,
                );
            }
            current_role = Some("user");
            current_text = user_text.to_string();
        } else if let Some(tool_text) = line.strip_prefix("> ") {
            // Flush non-tool content
            if current_role == Some("tool") {
                current_text.push('\n');
                current_text.push_str(tool_text);
            } else {
                if let Some(role) = current_role {
                    flush(
                        role,
                        &current_text,
                        session_id,
                        base_timestamp,
                        &mut counter,
                        &mut messages,
                    );
                }
                current_role = Some("tool");
                current_text = tool_text.to_string();
            }
        } else {
            // Assistant content
            if current_role == Some("assistant") {
                current_text.push('\n');
                current_text.push_str(line);
            } else {
                if let Some(role) = current_role {
                    flush(
                        role,
                        &current_text,
                        session_id,
                        base_timestamp,
                        &mut counter,
                        &mut messages,
                    );
                }
                current_role = Some("assistant");
                current_text = line.to_string();
            }
        }
    }

    // Flush last block
    if let Some(role) = current_role {
        flush(
            role,
            &current_text,
            session_id,
            base_timestamp,
            &mut counter,
            &mut messages,
        );
    }

    messages
}

fn parse_session_path(session_path: &str) -> Result<(&str, usize), String> {
    let path = session_path
        .strip_prefix("aider://")
        .unwrap_or(session_path);

    let (file_path, index_str) = path
        .rsplit_once('#')
        .ok_or_else(|| format!("Invalid session path: {session_path}"))?;

    let index: usize = index_str
        .parse()
        .map_err(|_| format!("Invalid session index: {index_str}"))?;

    Ok((file_path, index))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_HISTORY: &str = r"# aider chat started at 2025-03-26 14:32:01

#### What does this function do?

This function calculates the Fibonacci sequence using memoization.

> Tokens: 1,234 sent, 567 received.

#### Fix the bug in line 42

I'll fix that bug. Here's the corrected code:

```python
def fix():
    pass
```

> Applied edit to src/main.py

# aider chat started at 2025-03-26 15:10:00

#### New session message
";

    #[test]
    fn test_split_sessions() {
        let sessions = split_sessions(SAMPLE_HISTORY);
        assert_eq!(sessions.len(), 2);
        assert_eq!(
            sessions[0].timestamp,
            Some("2025-03-26T14:32:01Z".to_string())
        );
        assert_eq!(
            sessions[1].timestamp,
            Some("2025-03-26T15:10:00Z".to_string())
        );
        assert_eq!(
            sessions[0].first_user_message,
            Some("What does this function do?".to_string())
        );
    }

    #[test]
    fn test_parse_messages() {
        let sessions = split_sessions(SAMPLE_HISTORY);
        let messages = parse_messages(&sessions[0].content, "test-session", "2025-03-26T14:32:01Z");

        // user, assistant, tool, user, assistant, tool
        assert!(messages.len() >= 4);

        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[2].message_type, "system"); // tool output

        assert_eq!(messages[0].provider, Some("aider".to_string()));
    }

    #[test]
    fn test_parse_user_message() {
        let content = "#### Hello world\n\nResponse here";
        let messages = parse_messages(content, "s1", "2025-01-01T00:00:00Z");
        assert_eq!(messages[0].message_type, "user");
        let text = messages[0].content.as_ref().unwrap().as_array().unwrap()[0]["text"]
            .as_str()
            .unwrap();
        assert_eq!(text, "Hello world");
    }

    #[test]
    fn test_parse_session_path() {
        let (file, idx) =
            parse_session_path("aider:///home/user/project/.aider.chat.history.md#3").unwrap();
        assert_eq!(file, "/home/user/project/.aider.chat.history.md");
        assert_eq!(idx, 3);
    }

    #[test]
    fn test_empty_content() {
        let messages = parse_messages("", "s1", "2025-01-01T00:00:00Z");
        assert!(messages.is_empty());
    }

    #[test]
    fn test_tool_output_grouping() {
        let content = "> Line 1\n> Line 2\n> Line 3";
        let messages = parse_messages(content, "s1", "2025-01-01T00:00:00Z");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message_type, "system");
        let text = messages[0].content.as_ref().unwrap().as_array().unwrap()[0]["text"]
            .as_str()
            .unwrap();
        assert!(text.contains("Line 1"));
        assert!(text.contains("Line 3"));
    }

    /// Write `SAMPLE_HISTORY` as `<dir>/.aider.chat.history.md`.
    fn write_history(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let file = dir.join(HISTORY_FILE);
        fs::write(&file, SAMPLE_HISTORY).unwrap();
        file
    }

    #[test]
    #[serial_test::serial]
    fn load_messages_rejects_path_outside_root() {
        let _home = crate::test_utils::SandboxHome::new();
        let outside = tempfile::TempDir::new().unwrap();
        let file = write_history(&outside.path().join("proj"));

        let res = load_messages(&format!("aider://{}#0", file.display()));
        assert!(res.is_err(), "history outside the scanned dirs was read");
        let res = load_sessions(
            &format!("aider://{}", outside.path().join("proj").display()),
            false,
        );
        assert!(res.is_err(), "project outside the scanned dirs was listed");
    }

    #[test]
    #[serial_test::serial]
    fn load_messages_rejects_history_the_scan_skips() {
        let home = crate::test_utils::SandboxHome::new();
        // Hidden directories are never scanned.
        let file = write_history(&home.path().join(".private").join("proj"));

        assert!(load_messages(&format!("aider://{}#0", file.display())).is_err());
    }

    #[test]
    #[serial_test::serial]
    fn load_messages_accepts_history_under_a_scanned_dir() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join("client").join("proj");
        let file = write_history(&project);

        let messages = load_messages(&format!("aider://{}#0", file.display())).unwrap();
        assert!(!messages.is_empty());
        let sessions = load_sessions(&format!("aider://{}", project.display()), false).unwrap();
        assert!(!sessions.is_empty());
    }

    /// The scan never walks a symlinked search dir, so an id through one is
    /// outside what the scan can find.
    #[cfg(unix)]
    #[test]
    #[serial_test::serial]
    fn load_messages_rejects_history_under_a_symlinked_search_dir() {
        let home = crate::test_utils::SandboxHome::new();
        let elsewhere = tempfile::TempDir::new().unwrap();
        let file = write_history(&elsewhere.path().join("proj"));
        std::os::unix::fs::symlink(elsewhere.path(), home.path().join("client")).unwrap();
        let via_link = home.path().join("client").join("proj").join(HISTORY_FILE);
        assert!(via_link.is_file(), "fixture: {} missing", file.display());

        assert!(load_messages(&format!("aider://{}#0", via_link.display())).is_err());
    }

    #[test]
    #[serial_test::serial]
    fn search_hits_carry_scanned_project_path_for_same_named_projects() {
        let home = crate::test_utils::SandboxHome::new();
        write_history(&home.path().join("client").join("client-a").join("app"));
        write_history(&home.path().join("work").join("client-b").join("app"));

        let projects = scan_projects().unwrap();
        let paths: std::collections::HashSet<String> =
            projects.iter().map(|p| p.path.clone()).collect();
        assert_eq!(paths.len(), 2, "two distinct app projects: {paths:?}");
        assert!(projects.iter().all(|p| p.name == "app"));

        let hits = search("fibonacci", 100).unwrap();
        let hit_paths: std::collections::HashSet<String> = hits
            .iter()
            .map(|m| m.project_path.clone().expect("hit has project_path"))
            .collect();
        assert_eq!(hit_paths, paths);
    }
}
