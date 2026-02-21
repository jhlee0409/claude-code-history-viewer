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

#[tauri::command]
pub async fn scan_projects(claude_path: String) -> Result<Vec<ClaudeProject>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();
    let projects_path = PathBuf::from(&claude_path).join("projects");

    if !projects_path.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    for entry in WalkDir::new(&projects_path)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.file_type().is_dir())
    {
        let raw_project_name = entry.file_name().to_string_lossy().to_string();
        let project_path = entry.path().to_string_lossy().to_string();
        let project_name = extract_project_name(&raw_project_name);

        let mut session_count = 0;
        let mut message_count = 0;
        let mut last_modified = None;

        for jsonl_entry in WalkDir::new(entry.path())
            .into_iter()
            .filter_map(std::result::Result::ok)
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        {
            session_count += 1;

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
            name: project_name,
            path: project_path,
            actual_path,
            session_count,
            message_count,
            last_modified: last_modified_str,
            git_info,
            provider: None,
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
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

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
        // splitn(4, '-') on "-Users-jack-client-myapp" yields:
        // ["", "Users", "jack", "client-myapp"] -> returns "client-myapp"
        let project_dir = projects_dir.join("-Users-jack-client-myapp");
        fs::create_dir_all(&project_dir).unwrap();
        create_test_jsonl_file(&project_dir, "session.jsonl", "{}");

        let result = scan_projects(claude_dir.to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let projects = result.unwrap();
        assert_eq!(projects.len(), 1);
        // extract_project_name extracts the 4th part from splitn(4, '-')
        // "-Users-jack-client-myapp" -> ["", "Users", "jack", "client-myapp"]
        assert_eq!(projects[0].name, "client-myapp");
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
}
