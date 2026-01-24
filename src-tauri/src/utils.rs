use memchr::memchr_iter;

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
}
