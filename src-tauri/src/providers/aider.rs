use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use std::fs;
use std::path::{Path, PathBuf};

const HISTORY_FILE: &str = ".aider.chat.history.md";
const SESSION_HEADER_PREFIX: &str = "# aider chat started at ";

/// Detect Aider installations by checking if common project directories exist.
/// Does NOT do a recursive scan — that happens lazily in `scan_projects`.
pub fn detect() -> Option<ProviderInfo> {
    let dirs = get_search_dirs();
    // Quick check: just see if any search directory exists (no recursive scan)
    let has_history = !dirs.is_empty();

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
    let mut seen_paths = std::collections::HashSet::new();

    for search_dir in get_search_dirs() {
        if let Some(files) = find_history_files(&search_dir, 100) {
            for history_path in files {
                // Deduplicate across overlapping search directories
                let canonical = history_path
                    .canonicalize()
                    .unwrap_or_else(|_| history_path.clone());
                if !seen_paths.insert(canonical) {
                    continue;
                }
                let project_dir = history_path.parent().ok_or("Invalid history file path")?;

                let project_name = project_dir
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                let content = match fs::read_to_string(&history_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let sessions = split_sessions(&content);
                let session_count = sessions.len();
                let message_count: usize =
                    sessions.iter().map(|s| count_messages(&s.content)).sum();

                let last_modified = sessions
                    .last()
                    .and_then(|s| s.timestamp.clone())
                    .unwrap_or_default();

                if session_count == 0 {
                    continue;
                }

                projects.push(ClaudeProject {
                    name: project_name,
                    path: format!("aider://{}", project_dir.to_string_lossy()),
                    actual_path: project_dir.to_string_lossy().to_string(),
                    session_count,
                    message_count,
                    last_modified,
                    git_info: None,
                    provider: Some("aider".to_string()),
                    storage_type: Some("markdown".to_string()),
                    custom_directory_label: None,
                });
            }
        }
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

    let content =
        fs::read_to_string(&history_path).map_err(|e| format!("Failed to read history: {e}"))?;

    let project_name = PathBuf::from(dir)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let sessions_data = split_sessions(&content);
    let mut sessions = Vec::with_capacity(sessions_data.len());

    for (index, session) in sessions_data.iter().enumerate().rev() {
        let message_count = count_messages(&session.content);
        let timestamp = session.timestamp.clone().unwrap_or_default();

        sessions.push(ClaudeSession {
            session_id: format!("aider://{}#{}", history_path.to_string_lossy(), index),
            actual_session_id: format!("session-{index}"),
            file_path: history_path.to_string_lossy().to_string(),
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
        });
    }

    Ok(sessions)
}

/// Load messages from a specific Aider session
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    // session_path format: aider://<history_file_path>#<session_index>
    let (file_path, session_index) = parse_session_path(session_path)?;

    // Validate: must be absolute, must end with the expected filename
    let path = PathBuf::from(&file_path);
    if !path.is_absolute() {
        return Err("Session path must be absolute".to_string());
    }
    if path.file_name().and_then(|n| n.to_str()) != Some(HISTORY_FILE) {
        return Err(format!("Invalid Aider history file: {file_path}"));
    }

    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read history: {e}"))?;

    let sessions = split_sessions(&content);
    let session = sessions
        .get(session_index)
        .ok_or_else(|| format!("Session index {session_index} out of range"))?;

    let base_timestamp = session.timestamp.clone().unwrap_or_default();
    let session_id = format!("aider-session-{session_index}");

    Ok(parse_messages(
        &session.content,
        &session_id,
        &base_timestamp,
    ))
}

/// Search across all Aider sessions
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for search_dir in get_search_dirs() {
        if let Some(files) = find_history_files(&search_dir, 100) {
            for history_path in files {
                let content = match fs::read_to_string(&history_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let project_name = history_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                for (index, session) in split_sessions(&content).iter().enumerate() {
                    let base_ts = session.timestamp.clone().unwrap_or_default();
                    let session_id = format!("aider-session-{index}");

                    for mut msg in parse_messages(&session.content, &session_id, &base_ts) {
                        if let Some(ref c) = msg.content {
                            if search_json_value_case_insensitive(c, &query_lower) {
                                msg.project_name = Some(project_name.clone());
                                results.push(msg);
                                if results.len() >= limit {
                                    return Ok(results);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Private helpers
// ============================================================================

fn get_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
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

fn find_history_files(dir: &Path, max: usize) -> Option<Vec<PathBuf>> {
    let mut files = Vec::new();
    find_history_recursive(dir, &mut files, max, 0, 4);
    if files.is_empty() {
        None
    } else {
        Some(files)
    }
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
                // Skip hidden dirs, node_modules, target, etc.
                if !name.starts_with('.')
                    && name != "node_modules"
                    && name != "target"
                    && name != "dist"
                    && name != "build"
                    && name != ".git"
                {
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

fn parse_session_path(session_path: &str) -> Result<(String, usize), String> {
    let path = session_path
        .strip_prefix("aider://")
        .unwrap_or(session_path);

    let (file_path, index_str) = path
        .rsplit_once('#')
        .ok_or_else(|| format!("Invalid session path: {session_path}"))?;

    let index: usize = index_str
        .parse()
        .map_err(|_| format!("Invalid session index: {index_str}"))?;

    Ok((file_path.to_string(), index))
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
}
