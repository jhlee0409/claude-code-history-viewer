use crate::models::{GitInfo, GitWorktreeType};
use memchr::memchr_iter;
use std::fs;
use std::path::Path;

/// Estimated average bytes per JSONL line (used for capacity pre-allocation)
/// Based on typical Claude message sizes (800-1200 bytes average)
const ESTIMATED_BYTES_PER_LINE: usize = 500;

/// Average bytes per message for file size estimation
const AVERAGE_MESSAGE_SIZE_BYTES: f64 = 1000.0;

/// Find line boundaries in a memory-mapped buffer using memchr (SIMD-accelerated)
/// Returns a vector of (start, end) byte positions for each line
/// Empty lines are skipped
#[inline]
pub fn find_line_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::with_capacity(data.len() / ESTIMATED_BYTES_PER_LINE);
    let mut start = 0;

    for pos in memchr_iter(b'\n', data) {
        if pos > start {
            ranges.push((start, pos));
        }
        start = pos + 1;
    }

    // Handle last line without trailing newline
    if start < data.len() {
        ranges.push((start, data.len()));
    }

    ranges
}

/// Find line start positions (for compatibility with existing load.rs patterns)
/// Returns positions where each line starts
#[inline]
pub fn find_line_starts(data: &[u8]) -> Vec<usize> {
    let mut starts = Vec::with_capacity(data.len() / ESTIMATED_BYTES_PER_LINE + 1);
    starts.push(0);

    for pos in memchr_iter(b'\n', data) {
        if pos + 1 < data.len() {
            starts.push(pos + 1);
        }
    }

    starts
}

pub fn extract_project_name(raw_project_name: &str) -> String {
    if raw_project_name.starts_with('-') {
        let parts: Vec<&str> = raw_project_name.splitn(4, '-').collect();
        if parts.len() == 4 {
            parts[3].to_string()
        } else {
            raw_project_name.to_string()
        }
    } else {
        raw_project_name.to_string()
    }
}

/// Estimate message count from file size (more accurate calculation)
pub fn estimate_message_count_from_size(file_size: u64) -> usize {
    // Average JSON message is 800-1200 bytes (using AVERAGE_MESSAGE_SIZE_BYTES)
    // Small files are treated as having at least 1 message
    ((file_size as f64 / AVERAGE_MESSAGE_SIZE_BYTES).ceil() as usize).max(1)
}

// ===== Git Worktree Detection =====

/// Decode Claude session storage path to actual project path
///
/// Claude stores sessions in ~/.claude/projects/ with the project path encoded:
/// - `/Users/jack/.claude/projects/-Users-jack-my-project` → `/Users/jack/my-project`
/// - `/Users/jack/.claude/projects/-tmp-feature-my-project` → `/tmp/feature-my-project`
///
/// This function uses filesystem existence checks to correctly decode paths
/// where the project name itself contains hyphens.
pub fn decode_project_path(session_storage_path: &str) -> String {
    // 1. Try reading originalPath from sessions-index.json (most reliable)
    let index_path = Path::new(session_storage_path).join("sessions-index.json");
    if let Ok(content) = std::fs::read_to_string(&index_path) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(original) = parsed.get("originalPath").and_then(|v| v.as_str()) {
                if !original.is_empty() && Path::new(original).is_absolute() {
                    return original.to_string();
                }
            }
        }
    }

    // 2. Fallback: decode from encoded directory name
    const MARKER: &str = ".claude/projects/";
    if let Some(marker_pos) = session_storage_path.find(MARKER) {
        let encoded = &session_storage_path[marker_pos + MARKER.len()..];
        if let Some(stripped) = encoded.strip_prefix('-') {
            // Try filesystem-based decoding (recursive)
            if let Some(path) = decode_with_filesystem_check(stripped) {
                return path;
            }

            // Fallback: use heuristic decoding (still uses original encoded with dash)
            let parts: Vec<&str> = encoded.splitn(4, '-').collect();
            if parts.len() >= 4 {
                return format!("/{}/{}/{}", parts[1], parts[2], parts[3]);
            } else if parts.len() == 3 {
                return format!("/{}/{}", parts[1], parts[2]);
            } else if parts.len() == 2 {
                return format!("/{}", parts[1]);
            }
        }
    }
    session_storage_path.to_string()
}

/// Decode path by checking filesystem existence at each possible split point
///
/// For `-Users-jack-client-claude-code-history-viewer`:
/// 1. Check `/Users` (exists? continue)
/// 2. Check `/Users/jack` (exists? continue)
/// 3. Check `/Users/jack/client` (exists? continue)
/// 4. Check `/Users/jack/client/claude-code-history-viewer` (exists? ✓ return this)
fn decode_with_filesystem_check(encoded: &str) -> Option<String> {
    decode_recursive(encoded, "")
}

/// Recursively decode hyphen-separated path segments by checking filesystem existence.
///
/// For each hyphen in `encoded`, tries treating it as a `/` separator.
/// When a valid directory is found, recurses on the remaining string.
/// This handles nested directories like "claude-code-history-viewer-src-tauri"
/// → "claude-code-history-viewer/src-tauri".
fn decode_recursive(encoded: &str, base_path: &str) -> Option<String> {
    decode_recursive_inner(encoded, base_path, 0)
}

fn decode_recursive_inner(encoded: &str, base_path: &str, depth: usize) -> Option<String> {
    if depth > 20 {
        return None;
    }
    if encoded.is_empty() {
        if !base_path.is_empty() && Path::new(base_path).exists() {
            return Some(base_path.to_string());
        }
        return None;
    }

    let hyphen_positions: Vec<usize> = encoded
        .char_indices()
        .filter(|(_, c)| *c == '-')
        .map(|(i, _)| i)
        .collect();

    // Try each hyphen as a potential path separator
    for &pos in &hyphen_positions {
        let segment = &encoded[..pos];
        if segment.is_empty() {
            continue;
        }

        let candidate = if base_path.is_empty() {
            format!("/{segment}")
        } else {
            format!("{base_path}/{segment}")
        };

        // Use symlink_metadata to avoid following symlinks
        let is_real_dir = std::fs::symlink_metadata(&candidate)
            .map(|m| m.file_type().is_dir())
            .unwrap_or(false);

        if is_real_dir {
            let remaining = &encoded[pos + 1..];
            if remaining.is_empty() {
                return Some(candidate);
            }

            // First try: remaining as a single leaf (no more splitting needed)
            let full_path = format!("{candidate}/{remaining}");
            let full_path_is_real = std::fs::symlink_metadata(&full_path)
                .map(|m| !m.file_type().is_symlink())
                .unwrap_or(false);
            if full_path_is_real {
                return Some(full_path);
            }

            // Recurse: remaining may itself contain hyphens that are path separators
            if let result @ Some(_) = decode_recursive_inner(remaining, &candidate, depth + 1) {
                return result;
            }
        }
    }

    // No hyphen worked as separator — treat entire encoded as a single segment
    if !base_path.is_empty() {
        let full_path = format!("{base_path}/{encoded}");
        if Path::new(&full_path).exists() {
            return Some(full_path);
        }
    }

    None
}

/// Extract main git directory from gitdir path
///
/// `/Users/jack/main/.git/worktrees/feature` → `/Users/jack/main/.git`
fn extract_main_git_dir(gitdir: &str) -> Option<String> {
    const WORKTREES_MARKER: &str = "/.git/worktrees/";
    if let Some(pos) = gitdir.find(WORKTREES_MARKER) {
        return Some(format!("{}/.git", &gitdir[..pos]));
    }
    None
}

/// Detect git worktree information for a project
///
/// Detection method:
/// 1. If `.git` is a directory → [`Main`] (main repository)
/// 2. If `.git` is a file → Parse content to get [`Linked`] (linked worktree)
/// 3. If `.git` doesn't exist → [`NotGit`]
///
/// [`Main`]: GitWorktreeType::Main
/// [`Linked`]: GitWorktreeType::Linked
/// [`NotGit`]: GitWorktreeType::NotGit
pub fn detect_git_worktree_info(project_path: &str) -> Option<GitInfo> {
    let actual_path = decode_project_path(project_path);
    let git_path = Path::new(&actual_path).join(".git");

    if !git_path.exists() {
        return Some(GitInfo {
            worktree_type: GitWorktreeType::NotGit,
            main_project_path: None,
        });
    }

    if git_path.is_dir() {
        // Main repository
        return Some(GitInfo {
            worktree_type: GitWorktreeType::Main,
            main_project_path: None,
        });
    }

    if git_path.is_file() {
        // Linked worktree - parse .git file content
        // Content format: "gitdir: /path/to/main/.git/worktrees/branch-name"
        if let Ok(content) = fs::read_to_string(&git_path) {
            if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                let gitdir = gitdir.trim();
                // /path/to/main/.git/worktrees/branch-name -> /path/to/main/.git
                if let Some(main_git_dir) = extract_main_git_dir(gitdir) {
                    // /path/to/main/.git -> /path/to/main
                    let main_project_path = Path::new(&main_git_dir)
                        .parent()
                        .map(|p| p.to_string_lossy().to_string());

                    return Some(GitInfo {
                        worktree_type: GitWorktreeType::Linked,
                        main_project_path,
                    });
                }
            }
        }
    }

    // Fallback: can't determine
    Some(GitInfo {
        worktree_type: GitWorktreeType::NotGit,
        main_project_path: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== Line Utils Tests =====

    #[test]
    fn test_find_line_ranges_empty() {
        let data = b"";
        let ranges = find_line_ranges(data);
        assert!(ranges.is_empty());
    }

    #[test]
    fn test_find_line_ranges_single_line_no_newline() {
        let data = b"hello world";
        let ranges = find_line_ranges(data);
        assert_eq!(ranges, vec![(0, 11)]);
    }

    #[test]
    fn test_find_line_ranges_single_line_with_newline() {
        let data = b"hello world\n";
        let ranges = find_line_ranges(data);
        assert_eq!(ranges, vec![(0, 11)]);
    }

    #[test]
    fn test_find_line_ranges_multiple_lines() {
        let data = b"line1\nline2\nline3";
        let ranges = find_line_ranges(data);
        assert_eq!(ranges, vec![(0, 5), (6, 11), (12, 17)]);
    }

    #[test]
    fn test_find_line_ranges_with_empty_lines() {
        let data = b"line1\n\nline3\n";
        let ranges = find_line_ranges(data);
        // Empty lines are skipped (start == end after newline)
        assert_eq!(ranges, vec![(0, 5), (7, 12)]);
    }

    #[test]
    fn test_find_line_ranges_only_newlines() {
        let data = b"\n\n\n";
        let ranges = find_line_ranges(data);
        assert!(ranges.is_empty());
    }

    #[test]
    fn test_find_line_starts_empty() {
        let data = b"";
        let starts = find_line_starts(data);
        assert_eq!(starts, vec![0]);
    }

    #[test]
    fn test_find_line_starts_single_line() {
        let data = b"hello";
        let starts = find_line_starts(data);
        assert_eq!(starts, vec![0]);
    }

    #[test]
    fn test_find_line_starts_multiple_lines() {
        let data = b"line1\nline2\nline3";
        let starts = find_line_starts(data);
        assert_eq!(starts, vec![0, 6, 12]);
    }

    // ===== Project Name Tests =====

    #[test]
    fn test_extract_project_name_with_prefix() {
        // Test raw project name with dash prefix (e.g., "-user-home-project")
        let result = extract_project_name("-user-home-project");
        assert_eq!(result, "project");
    }

    #[test]
    fn test_extract_project_name_with_complex_prefix() {
        // Test raw project name with multiple parts
        let result = extract_project_name("-usr-local-myproject");
        assert_eq!(result, "myproject");
    }

    #[test]
    fn test_extract_project_name_without_prefix() {
        // Test raw project name without dash prefix
        let result = extract_project_name("simple-project");
        assert_eq!(result, "simple-project");
    }

    #[test]
    fn test_extract_project_name_empty() {
        let result = extract_project_name("");
        assert_eq!(result, "");
    }

    #[test]
    fn test_extract_project_name_only_dashes() {
        // When there are fewer than 4 parts, return original
        let result = extract_project_name("-a-b");
        assert_eq!(result, "-a-b");
    }

    #[test]
    fn test_extract_project_name_exact_four_parts() {
        let result = extract_project_name("-a-b-c");
        assert_eq!(result, "c");
    }

    #[test]
    fn test_estimate_message_count_zero_size() {
        // Minimum should be 1
        let result = estimate_message_count_from_size(0);
        assert_eq!(result, 1);
    }

    #[test]
    fn test_estimate_message_count_small_file() {
        // 500 bytes -> ceil(0.5) = 1
        let result = estimate_message_count_from_size(500);
        assert_eq!(result, 1);
    }

    #[test]
    fn test_estimate_message_count_medium_file() {
        // 2500 bytes -> ceil(2.5) = 3
        let result = estimate_message_count_from_size(2500);
        assert_eq!(result, 3);
    }

    #[test]
    fn test_estimate_message_count_large_file() {
        // 10000 bytes -> ceil(10.0) = 10
        let result = estimate_message_count_from_size(10000);
        assert_eq!(result, 10);
    }

    #[test]
    fn test_estimate_message_count_exact_boundary() {
        // 1000 bytes -> ceil(1.0) = 1
        let result = estimate_message_count_from_size(1000);
        assert_eq!(result, 1);
    }

    // ===== Git Worktree Detection Tests =====

    #[test]
    fn test_decode_project_path_session_storage() {
        assert_eq!(
            decode_project_path("/Users/jack/.claude/projects/-Users-jack-my-project"),
            "/Users/jack/my-project"
        );
    }

    #[test]
    fn test_decode_project_path_tmp() {
        assert_eq!(
            decode_project_path("/Users/jack/.claude/projects/-tmp-feature-my-project"),
            "/tmp/feature/my-project"
        );
    }

    #[test]
    fn test_decode_project_path_regular() {
        assert_eq!(decode_project_path("/some/other/path"), "/some/other/path");
    }

    #[test]
    fn test_extract_main_git_dir_valid() {
        assert_eq!(
            extract_main_git_dir("/Users/jack/main/.git/worktrees/feature"),
            Some("/Users/jack/main/.git".to_string())
        );
    }

    #[test]
    fn test_extract_main_git_dir_invalid() {
        assert_eq!(extract_main_git_dir("/some/path/without/worktrees"), None);
    }

    #[test]
    fn test_detect_git_worktree_info_not_git() {
        use tempfile::TempDir;
        let temp_dir = TempDir::new().unwrap();
        // No .git file or directory

        let result = detect_git_worktree_info(temp_dir.path().to_str().unwrap());
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.worktree_type, GitWorktreeType::NotGit);
    }

    #[test]
    fn test_detect_git_worktree_info_main_repo() {
        use tempfile::TempDir;
        let temp_dir = TempDir::new().unwrap();
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir(&git_dir).unwrap();

        let result = detect_git_worktree_info(temp_dir.path().to_str().unwrap());
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.worktree_type, GitWorktreeType::Main);
        assert!(info.main_project_path.is_none());
    }

    #[test]
    fn test_detect_git_worktree_info_linked() {
        use std::io::Write;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let git_file = temp_dir.path().join(".git");
        let mut file = fs::File::create(&git_file).unwrap();
        writeln!(
            file,
            "gitdir: /Users/jack/main-project/.git/worktrees/feature-branch"
        )
        .unwrap();

        let result = detect_git_worktree_info(temp_dir.path().to_str().unwrap());
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.worktree_type, GitWorktreeType::Linked);
        assert_eq!(
            info.main_project_path,
            Some("/Users/jack/main-project".to_string())
        );
    }
}
