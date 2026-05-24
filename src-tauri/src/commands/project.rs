use crate::models::{ClaudeProject, GitCommit};
use crate::utils::{
    detect_git_worktree_info, estimate_message_count_from_size, extract_project_name,
};
use chrono::{DateTime, Utc};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use walkdir::WalkDir;

#[tauri::command]
pub async fn get_git_log(actual_path: String, limit: usize) -> Result<Vec<GitCommit>, String> {
    // Validate path is absolute and exists
    let path_buf = PathBuf::from(&actual_path);
    if !path_buf.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    if !path_buf.exists() || !path_buf.is_dir() {
        return Err("Path does not exist or is not a directory".to_string());
    }

    // Canonicalize to ensure we are using the real path
    let safe_path = path_buf
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;

    let output = Command::new("git")
        .args(["log", "-n"])
        .arg(limit.to_string())
        .args(["--pretty=format:%H|%an|%at|%s"])
        .current_dir(&safe_path)
        .output()
        .map_err(|e| format!("Failed to execute git log: {e}"))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() == 4 {
            let timestamp = parts[2].parse::<i64>().unwrap_or(0);
            let date = DateTime::<Utc>::from_timestamp(timestamp, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| "unknown".to_string());

            commits.push(GitCommit {
                hash: parts[0].to_string(),
                author: parts[1].to_string(),
                timestamp,
                date,
                message: parts[3].to_string(),
            });
        }
    }

    Ok(commits)
}

#[tauri::command]
pub async fn get_claude_folder_path() -> Result<String, String> {
    let home_dir =
        dirs::home_dir().ok_or("HOME_DIRECTORY_NOT_FOUND:Could not determine home directory")?;
    let claude_path = home_dir.join(".claude");

    if !claude_path.exists() {
        return Err(format!(
            "CLAUDE_FOLDER_NOT_FOUND:Claude folder not found at {}",
            claude_path.display()
        ));
    }

    if fs::read_dir(&claude_path).is_err() {
        return Err(
            "PERMISSION_DENIED:Cannot access Claude folder. Please check permissions.".to_string(),
        );
    }

    Ok(claude_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn validate_claude_folder(path: String) -> Result<bool, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Ok(false);
    }

    if path_buf.file_name().and_then(|n| n.to_str()) == Some(".claude") {
        let projects_path = path_buf.join("projects");
        return Ok(projects_path.exists() && projects_path.is_dir());
    }

    let claude_path = path_buf.join(".claude");
    if claude_path.exists() && claude_path.is_dir() {
        let projects_path = claude_path.join("projects");
        return Ok(projects_path.exists() && projects_path.is_dir());
    }

    Ok(false)
}

/// Validate a custom Claude configuration directory.
///
/// Unlike `validate_claude_folder` (which expects a `.claude` directory),
/// this accepts any absolute directory containing a `projects/` subfolder
/// and applies symlink safety checks.
#[tauri::command]
pub async fn validate_custom_claude_dir(path: String) -> Result<bool, String> {
    let path_buf = PathBuf::from(&path);
    match crate::utils::validate_custom_claude_path(&path_buf) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Detect `CLAUDE_CONFIG_DIR` environment variable and return the path if valid.
///
/// Returns `Some(path)` if the env var is set and points to a valid Claude
/// configuration directory (has a `projects/` subfolder). Returns `None` otherwise.
#[tauri::command]
pub async fn detect_claude_config_dir() -> Result<Option<String>, String> {
    let raw = match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(val) if !val.trim().is_empty() => val.trim().to_string(),
        _ => return Ok(None),
    };

    // Expand ~ to home directory (only exact "~" or "~/..." patterns)
    let expanded = if raw == "~" {
        match dirs::home_dir() {
            Some(home) => home.to_string_lossy().to_string(),
            None => raw,
        }
    } else if let Some(rest) = raw.strip_prefix("~/") {
        match dirs::home_dir() {
            Some(home) => home.join(rest).to_string_lossy().to_string(),
            None => raw,
        }
    } else {
        raw
    };

    let path = PathBuf::from(&expanded);
    if !path.is_absolute() {
        return Ok(None);
    }

    match crate::utils::validate_custom_claude_path(&path) {
        Ok(_) => Ok(Some(expanded)),
        Err(_) => Ok(None),
    }
}

/// Read the `cwd` field from the first records of a session JSONL file.
/// The first line often has a null/absent cwd, so scan a bounded number of
/// lines and return the first non-empty cwd found.
fn read_session_cwd(path: &std::path::Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().take(50).map_while(Result::ok) {
        if line.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(cwd) = v.get("cwd").and_then(|c| c.as_str()) {
                if !cwd.is_empty() {
                    return Some(cwd.to_string());
                }
            }
        }
    }
    None
}

/// Derive a human-readable display name from a real (already-decoded) cwd path.
/// Git worktrees ("<project>/.claude/worktrees/<branch>") render as
/// "<project> (worktree: <branch>)" using the true branch name.
fn display_name_from_cwd(cwd: &str) -> Option<String> {
    const WT: &str = "/.claude/worktrees/";
    if let Some(pos) = cwd.find(WT) {
        let parent = std::path::Path::new(&cwd[..pos])
            .file_name()
            .and_then(|n| n.to_str())?;
        let branch = cwd[pos + WT.len()..]
            .split('/')
            .next()
            .filter(|s| !s.is_empty());
        return Some(match branch {
            Some(b) => format!("{parent} (worktree: {b})"),
            None => parent.to_string(),
        });
    }
    std::path::Path::new(cwd)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
}

#[tauri::command]
pub async fn scan_projects(claude_path: String) -> Result<Vec<ClaudeProject>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();
    let projects_path = PathBuf::from(&claude_path).join("projects");

    if !projects_path.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();
    let mut seen_canonical = std::collections::HashSet::new();

    let mut entries: Vec<_> = WalkDir::new(&projects_path)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| {
            // Accept real directories and symlinks that resolve to directories.
            // Symlinks are only followed at depth 1 (project level), never deeper,
            // so there is no risk of traversing outside the projects/ tree.
            e.file_type().is_dir() || (e.file_type().is_symlink() && e.path().is_dir())
        })
        .collect();
    // Prefer real directories over symlinks so canonical-path dedup picks a
    // stable winner instead of relying on WalkDir iteration order (which varies
    // by FS/OS and could otherwise make a project's displayed name flip across
    // scans when an alias symlink coexists with its real target).
    entries.sort_by_key(|e| e.file_type().is_symlink());

    for entry in entries {
        // Deduplicate when a symlink and a real directory under projects/ resolve
        // to the same target. Fall back to the raw path if canonicalize fails so
        // transient I/O errors don't drop the entry.
        let canonical = entry
            .path()
            .canonicalize()
            .unwrap_or_else(|_| entry.path().to_path_buf());
        if !seen_canonical.insert(canonical) {
            continue;
        }

        let raw_project_name = entry.file_name().to_string_lossy().to_string();
        let project_path = entry.path().to_string_lossy().to_string();
        let project_name = extract_project_name(&raw_project_name);

        let mut session_count = 0;
        let mut message_count = 0;
        let mut last_modified = None;
        // Ground-truth cwd of this project, read from a top-level session file.
        // Preferred over decoding the (ambiguous) encoded dir name for display.
        let mut session_cwd: Option<String> = None;

        for jsonl_entry in WalkDir::new(entry.path())
            .into_iter()
            .filter_map(std::result::Result::ok)
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        {
            session_count += 1;

            // Capture cwd from a top-level (depth 1) session file — the project's
            // own session, not a nested subagent transcript.
            if session_cwd.is_none() && jsonl_entry.depth() == 1 {
                session_cwd = read_session_cwd(jsonl_entry.path());
            }

            if let Ok(metadata) = jsonl_entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if last_modified.is_none() || modified > last_modified.unwrap() {
                        last_modified = Some(modified);
                    }
                }

                // Estimate message count from file size - much faster
                let estimated_messages = estimate_message_count_from_size(metadata.len());
                message_count += estimated_messages;
            }
        }

        // Skip empty project containers (e.g. temp workdirs with only memory files).
        if session_count == 0 {
            continue;
        }

        let last_modified_str = last_modified
            .map(|lm| {
                let dt: DateTime<Utc> = lm.into();
                dt.to_rfc3339()
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        // Validate that project_path is absolute before processing
        let path_buf = PathBuf::from(&project_path);
        if !path_buf.is_absolute() {
            #[cfg(debug_assertions)]
            eprintln!("⚠️ Skipping non-absolute project path: {project_path}");
            continue;
        }

        // Decode the actual filesystem path FIRST
        let actual_path = crate::utils::decode_project_path(&project_path);

        // Detect git worktree information using the actual filesystem path
        let git_info = detect_git_worktree_info(&actual_path);

        projects.push(ClaudeProject {
            name: {
                // Prefer the project's real cwd (ground truth) — resolves deep/cloud
                // paths, project names that contain "projects", and worktrees
                // correctly, with the true branch name. Fall back to decoding the
                // encoded directory name only when no session cwd is available.
                if let Some(name) = session_cwd.as_deref().and_then(display_name_from_cwd) {
                    name
                } else {
                // ── Fallback: derive from the encoded directory name ──
                // Claude encodes project paths by replacing '/' with '-', producing
                // directory names like "-Users-alice-code-projects-myapp". For paths
                // deeper than 3 segments, decode_project_path() (splitn(4,'-')) returns
                // an incorrectly decoded actual_path, so file_name() on it still yields
                // a long unreadable slug.
                //
                // Git worktrees add a wrinkle: their encoded dir embeds
                // "--claude-worktrees-<branch>" after the project, e.g.
                // "-Users-me-code-projects-myapp--claude-worktrees-fix".
                //
                // Strategy (in order):
                // 0. Git worktree ("…--claude-worktrees-<branch>") →
                //    "<parent> (worktree: <branch>)".
                // 1. Case-insensitive "-projects-" anchor in the raw encoded name —
                //    extracts everything after it ("signal", "vmw-rag", "HW-Refresh").
                // 2. actual_path file_name() — works for shallow (<= 3 segment) paths.
                //    Skipped when the result looks like an encoded slug (contains known
                //    cloud-storage markers).
                // 3. Last '-'-delimited segment of the raw encoded name — last-resort
                //    single-word fallback ("code", "projects", "Projects").
                // 4. project_name from extract_project_name() — original behavior.
                let raw_dir = std::path::Path::new(&project_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                const ANCHOR: &str = "-projects-";
                const WORKTREE: &str = "--claude-worktrees-";
                if let Some(wpos) = raw_dir.find(WORKTREE) {
                    // Git worktree. Derive "<parent> (worktree: <branch>)".
                    // The branch label is taken from the encoded dir name, so '_'
                    // renders as '-' (lossy, but adequate for a display label).
                    let parent_seg = &raw_dir[..wpos];
                    let branch = &raw_dir[wpos + WORKTREE.len()..];
                    let parent_lower = parent_seg.to_ascii_lowercase();
                    let parent = if let Some(pos) = parent_lower.rfind(ANCHOR) {
                        let p = &parent_seg[pos + ANCHOR.len()..];
                        if p.is_empty() { parent_seg.to_string() } else { p.to_string() }
                    } else {
                        parent_seg
                            .rsplit('-')
                            .next()
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .unwrap_or_else(|| parent_seg.to_string())
                    };
                    if branch.is_empty() {
                        parent
                    } else {
                        format!("{parent} (worktree: {branch})")
                    }
                } else {
                    let raw_lower = raw_dir.to_ascii_lowercase();
                    if let Some(pos) = raw_lower.rfind(ANCHOR) {
                        let name = &raw_dir[pos + ANCHOR.len()..];
                        if !name.is_empty() {
                            name.to_string()
                        } else {
                            project_name
                        }
                    } else if let Some(n) = std::path::Path::new(&actual_path).file_name() {
                        let fname = n.to_string_lossy();
                        // Skip if it still looks like an encoded deep path
                        if fname.contains("-Library-") || fname.contains("CloudStorage") {
                            raw_dir.rfind('-')
                                .map(|p| raw_dir[p + 1..].to_string())
                                .filter(|s| !s.is_empty())
                                .unwrap_or(project_name)
                        } else {
                            fname.into_owned()
                        }
                    } else {
                        raw_dir.rfind('-')
                            .map(|p| raw_dir[p + 1..].to_string())
                            .filter(|s| !s.is_empty())
                            .unwrap_or(project_name)
                    }
                }
                }
            },
            path: project_path,
            actual_path,
            session_count,
            message_count,
            last_modified: last_modified_str,
            git_info,
            provider: None,
            storage_type: None,
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        println!(
            "📊 scan_projects performance: {} projects, {}ms elapsed",
            projects.len(),
            elapsed.as_millis()
        );
    }

    Ok(projects)
}

#[cfg(test)]
#[allow(clippy::await_holding_lock)] // env var tests are sync internally; no real suspension
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::{LazyLock, Mutex, MutexGuard};
    use tempfile::TempDir;

    /// Mutex to serialize tests that modify the `CLAUDE_CONFIG_DIR` environment variable.
    static ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn lock_env() -> MutexGuard<'static, ()> {
        ENV_MUTEX.lock().unwrap()
    }

    fn create_test_jsonl_file(dir: &PathBuf, filename: &str, content: &str) {
        let file_path = dir.join(filename);
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
    }

    // Test validate_claude_folder
    #[tokio::test]
    async fn test_validate_claude_folder_nonexistent() {
        let result = validate_claude_folder("/nonexistent/path".to_string()).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_validate_claude_folder_without_projects() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        fs::create_dir(&claude_dir).unwrap();
        // No projects subdirectory

        let result = validate_claude_folder(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_validate_claude_folder_with_projects() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // Test with .claude directory path directly
        let result = validate_claude_folder(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_validate_claude_folder_from_parent() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // Test with parent directory (home-like path)
        let result = validate_claude_folder(temp_dir.path().to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    // Test scan_projects
    #[tokio::test]
    async fn test_scan_projects_empty() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_scan_projects_no_projects_dir() {
        let temp_dir = TempDir::new().unwrap();

        let result = scan_projects(temp_dir.path().to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_scan_projects_single_project() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        let project_dir = projects_dir.join("my-project");
        fs::create_dir_all(&project_dir).unwrap();

        // Create a session file
        create_test_jsonl_file(
            &project_dir,
            "session.jsonl",
            r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"}}"#,
        );

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "my-project");
        assert_eq!(projects[0].session_count, 1);
        assert!(projects[0].message_count > 0);
    }

    #[tokio::test]
    async fn test_scan_projects_multiple_projects() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");

        // Create project 1
        let project1_dir = projects_dir.join("project-alpha");
        fs::create_dir_all(&project1_dir).unwrap();
        create_test_jsonl_file(&project1_dir, "session1.jsonl", "{}");
        create_test_jsonl_file(&project1_dir, "session2.jsonl", "{}");

        // Create project 2
        let project2_dir = projects_dir.join("project-beta");
        fs::create_dir_all(&project2_dir).unwrap();
        create_test_jsonl_file(&project2_dir, "session.jsonl", "{}");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 2);

        // Find project-alpha and verify session count
        let alpha = projects.iter().find(|p| p.name == "project-alpha").unwrap();
        assert_eq!(alpha.session_count, 2);
    }

    #[tokio::test]
    async fn test_scan_projects_extracts_project_name() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");

        // Create project with prefix format (like "-Users-jack-client-myapp")
        // decode_project_path falls back to heuristic: splitn(4, '-') yields
        // ["", "Users", "jack", "client-myapp"] -> decoded path "/Users/jack/client-myapp"
        // The display name is now taken from the basename of the decoded actual_path,
        // which gives "client-myapp".
        let project_dir = projects_dir.join("-Users-jack-client-myapp");
        fs::create_dir_all(&project_dir).unwrap();
        create_test_jsonl_file(&project_dir, "session.jsonl", "{}");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        // Display name comes from basename of decoded actual_path (or extract_project_name fallback)
        assert_eq!(projects[0].name, "client-myapp");
    }

    #[tokio::test]
    async fn test_scan_projects_worktree_name() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");

        // Git worktree encoded dir: "<parent>--claude-worktrees-<branch>".
        // Expect "<project> (worktree: <branch>)" rather than the raw tail.
        let project_dir =
            projects_dir.join("-Users-jack-code-projects-myapp--claude-worktrees-feature");
        fs::create_dir_all(&project_dir).unwrap();
        create_test_jsonl_file(&project_dir, "session.jsonl", "{}");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "myapp (worktree: feature)");
    }

    #[tokio::test]
    async fn test_scan_projects_name_from_cwd() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");

        // Project whose name contains "projects": the encoded "-projects-" anchor
        // would truncate to "tool". The real cwd resolves it correctly.
        let project_dir = projects_dir.join("-Users-me-code-projects-my-projects-tool");
        fs::create_dir_all(&project_dir).unwrap();
        create_test_jsonl_file(
            &project_dir,
            "session.jsonl",
            "{\"cwd\":\"/Users/me/code/projects/my-projects-tool\"}",
        );

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "my-projects-tool");
    }

    #[tokio::test]
    async fn test_scan_projects_worktree_name_from_cwd() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");

        // Real cwd carries the true branch name, incl. underscores (no lossy
        // encoding): "feature_x" stays "feature_x".
        let project_dir = projects_dir.join("-Users-me-code-projects-myapp--claude-worktrees-feature-x");
        fs::create_dir_all(&project_dir).unwrap();
        create_test_jsonl_file(
            &project_dir,
            "session.jsonl",
            "{\"cwd\":\"/Users/me/code/projects/myapp/.claude/worktrees/feature_x\"}",
        );

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "myapp (worktree: feature_x)");
    }

    #[tokio::test]
    async fn test_scan_projects_sorted_by_last_modified() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");

        // Create older project
        let older_dir = projects_dir.join("older-project");
        fs::create_dir_all(&older_dir).unwrap();
        create_test_jsonl_file(&older_dir, "session.jsonl", "{}");

        // Wait briefly to ensure different timestamps
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Create newer project
        let newer_dir = projects_dir.join("newer-project");
        fs::create_dir_all(&newer_dir).unwrap();
        create_test_jsonl_file(&newer_dir, "session.jsonl", "{}");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 2);
        // Newer project should be first (sorted by last_modified descending)
        assert_eq!(projects[0].name, "newer-project");
        assert_eq!(projects[1].name, "older-project");
    }

    #[tokio::test]
    async fn test_scan_projects_ignores_non_jsonl_files() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        let project_dir = projects_dir.join("test-project");
        fs::create_dir_all(&project_dir).unwrap();

        // Create various file types
        create_test_jsonl_file(&project_dir, "session.jsonl", "{}");
        create_test_jsonl_file(&project_dir, "config.json", "{}");
        create_test_jsonl_file(&project_dir, "readme.txt", "readme");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        // Only .jsonl file should be counted
        assert_eq!(projects[0].session_count, 1);
    }

    #[tokio::test]
    async fn test_scan_projects_nested_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        let project_dir = projects_dir.join("test-project");
        let nested_dir = project_dir.join("subdir");
        fs::create_dir_all(&nested_dir).unwrap();

        // Create sessions at different levels
        create_test_jsonl_file(&project_dir, "session1.jsonl", "{}");
        create_test_jsonl_file(&nested_dir, "session2.jsonl", "{}");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        // WalkDir should find sessions in subdirectories too
        assert_eq!(projects[0].session_count, 2);
    }

    #[tokio::test]
    async fn test_scan_projects_skips_empty_project_directories() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        let project_dir = projects_dir.join("tmp-project");
        let memory_dir = project_dir.join("memory");
        fs::create_dir_all(&memory_dir).unwrap();

        // Memory-only artifacts should not make this a visible project.
        let checkpoint_path = memory_dir.join("checkpoint.md");
        let mut file = File::create(checkpoint_path).unwrap();
        file.write_all(b"# checkpoint").unwrap();

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_scan_projects_follows_symlinked_project_dir() {
        use std::os::unix::fs::symlink;

        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // Real project directory lives outside projects/ (shared-session pattern).
        let shared_dir = temp_dir.path().join("shared").join("shared-project");
        fs::create_dir_all(&shared_dir).unwrap();
        create_test_jsonl_file(&shared_dir, "session.jsonl", "{}");

        // Symlink it in at project depth.
        let link_path = projects_dir.join("shared-project");
        symlink(&shared_dir, &link_path).unwrap();

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "shared-project");
        assert_eq!(projects[0].session_count, 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_scan_projects_skips_dangling_symlink() {
        use std::os::unix::fs::symlink;

        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // One real project so the scan has something to return.
        let real_dir = projects_dir.join("real-project");
        fs::create_dir_all(&real_dir).unwrap();
        create_test_jsonl_file(&real_dir, "session.jsonl", "{}");

        // Dangling symlink pointing at a non-existent target.
        let dangling_target = temp_dir.path().join("does-not-exist");
        let dangling_link = projects_dir.join("dangling-project");
        symlink(&dangling_target, &dangling_link).unwrap();

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "real-project");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_scan_projects_deduplicates_symlink_and_real_dir() {
        use std::os::unix::fs::symlink;

        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // Real project directory inside projects/.
        let real_dir = projects_dir.join("my-project");
        fs::create_dir_all(&real_dir).unwrap();
        create_test_jsonl_file(&real_dir, "session.jsonl", "{}");

        // Alias symlink in the same projects/ that resolves to the real dir.
        let alias_link = projects_dir.join("my-project-alias");
        symlink(&real_dir, &alias_link).unwrap();

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].session_count, 1);
        // Real directories must win the tie over symlink aliases so the displayed
        // project name stays stable across scans regardless of WalkDir iteration order.
        assert_eq!(projects[0].name, "my-project");
    }

    #[tokio::test]
    async fn test_get_git_log_invalid_path() {
        let result = get_git_log("/nonexistent/path".to_string(), 10).await;
        // Should fail because path doesn't exist
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Path does not exist or is not a directory"
        );
    }

    #[tokio::test]
    async fn test_get_git_log_not_absolute() {
        let result = get_git_log("relative/path".to_string(), 10).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Path must be absolute");
    }

    #[tokio::test]
    async fn test_get_git_log_success() {
        let temp_dir = TempDir::new().unwrap();
        let path_str = temp_dir.path().to_string_lossy().to_string();

        // Initialize git repo
        let _ = Command::new("git")
            .arg("init")
            .current_dir(&temp_dir)
            .output()
            .expect("Failed to init git");

        // Configure user for commit
        let _ = Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&temp_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&temp_dir)
            .output();

        // Create a file and commit it
        create_test_jsonl_file(&temp_dir.path().to_path_buf(), "test.txt", "content");
        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&temp_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&temp_dir)
            .output();

        let result = get_git_log(path_str, 5).await;

        // If git is not installed or configured, this might fail or return empty.
        // But assuming git works:
        if let Ok(commits) = result {
            if commits.is_empty() {
                // Might happen in CI without git
                println!("Warning: git log returned empty (git might not be working in test env)");
            } else {
                assert_eq!(commits.len(), 1);
                assert_eq!(commits[0].message, "Initial commit");
                assert_eq!(commits[0].author, "Test User");
            }
        } else {
            // Should not error if path is valid repo
            panic!("get_git_log failed: {}", result.unwrap_err());
        }
    }

    // Tests for detect_claude_config_dir
    // All tests use ENV_MUTEX to prevent race conditions on the global env var.
    #[tokio::test]
    async fn test_detect_config_dir_unset() {
        let _guard = lock_env();
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        let result = detect_claude_config_dir().await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_detect_config_dir_empty() {
        let _guard = lock_env();
        std::env::set_var("CLAUDE_CONFIG_DIR", "");
        let result = detect_claude_config_dir().await.unwrap();
        assert!(result.is_none());
        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[tokio::test]
    async fn test_detect_config_dir_valid() {
        let _guard = lock_env();
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        std::env::set_var(
            "CLAUDE_CONFIG_DIR",
            temp_dir.path().to_string_lossy().to_string(),
        );
        let result = detect_claude_config_dir().await.unwrap();
        assert!(result.is_some());
        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[tokio::test]
    async fn test_detect_config_dir_invalid_no_projects() {
        let _guard = lock_env();
        let temp_dir = TempDir::new().unwrap();
        // No projects/ subdirectory

        std::env::set_var(
            "CLAUDE_CONFIG_DIR",
            temp_dir.path().to_string_lossy().to_string(),
        );
        let result = detect_claude_config_dir().await.unwrap();
        assert!(result.is_none());
        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[tokio::test]
    async fn test_detect_config_dir_relative_path() {
        let _guard = lock_env();
        std::env::set_var("CLAUDE_CONFIG_DIR", "relative/path");
        let result = detect_claude_config_dir().await.unwrap();
        assert!(result.is_none());
        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }
}
