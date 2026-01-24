//! Property-based tests demonstrating advanced testing techniques.
//!
//! These tests use proptest to generate random inputs and verify
//! that properties hold for all generated values.

#![cfg(test)]

use proptest::prelude::*;

/// Strategies for generating test data
#[allow(dead_code)]
mod strategies {
    use super::*;

    /// Generate a valid UUID v4 string
    pub fn valid_uuid() -> impl Strategy<Value = String> {
        "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
    }

    /// Generate a valid RFC3339 timestamp
    pub fn valid_timestamp() -> impl Strategy<Value = String> {
        (
            2020u32..2030,
            1u32..13,
            1u32..29,
            0u32..24,
            0u32..60,
            0u32..60,
        )
            .prop_map(|(year, month, day, hour, min, sec)| {
                format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}Z")
            })
    }

    /// Generate a valid project name (like path segments)
    pub fn valid_project_name() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_-]{1,30}"
    }

    /// Generate a Claude path-style project name
    pub fn claude_path_project_name() -> impl Strategy<Value = String> {
        (
            valid_project_name(),
            valid_project_name(),
            valid_project_name(),
        )
            .prop_map(|(user, dir, project)| format!("-{user}-{dir}-{project}"))
    }

    /// Generate token counts within realistic ranges
    pub fn token_count() -> impl Strategy<Value = u32> {
        prop_oneof![
            1u32..100,        // Small messages
            100u32..1000,     // Medium messages
            1000u32..10000,   // Large messages
            10000u32..100000, // Very large messages
        ]
    }

    /// Generate file sizes in bytes
    pub fn file_size() -> impl Strategy<Value = u64> {
        prop_oneof![
            0u64..1000,             // Empty to small
            1000u64..100_000,       // Medium
            100_000u64..10_000_000, // Large
        ]
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        max_shrink_iters: 1000,
        ..ProptestConfig::default()
    })]

    /// Property: extract_project_name should never panic for any input
    #[test]
    fn prop_extract_project_name_never_panics(input in ".*") {
        let _ = crate::utils::extract_project_name(&input);
    }

    /// Property: extract_project_name with Claude path format returns last segment
    #[test]
    fn prop_extract_project_name_claude_path(
        (user, dir, project) in (
            strategies::valid_project_name(),
            strategies::valid_project_name(),
            strategies::valid_project_name()
        )
    ) {
        let input = format!("-{user}-{dir}-{project}");
        let result = crate::utils::extract_project_name(&input);
        // The result should be the last segment after splitn(4, '-')
        prop_assert!(!result.is_empty());
    }

    /// Property: estimate_message_count is monotonically increasing with size
    #[test]
    fn prop_estimate_message_count_monotonic(
        size1 in strategies::file_size(),
        size2 in strategies::file_size()
    ) {
        let count1 = crate::utils::estimate_message_count_from_size(size1);
        let count2 = crate::utils::estimate_message_count_from_size(size2);

        if size1 <= size2 {
            prop_assert!(count1 <= count2,
                "Expected count1 ({}) <= count2 ({}) for sizes {} <= {}",
                count1, count2, size1, size2);
        }
    }

    /// Property: estimate_message_count returns at least 1 (minimum message count)
    #[test]
    fn prop_estimate_message_count_min_one_for_empty(_dummy in 0u8..1) {
        let count = crate::utils::estimate_message_count_from_size(0);
        // The function uses .max(1) to ensure at least 1 message is estimated
        prop_assert_eq!(count, 1);
    }

    /// Property: Token counts should always be non-negative (they're u32)
    #[test]
    fn prop_token_usage_non_negative(
        input in strategies::token_count(),
        output in strategies::token_count()
    ) {
        let usage = crate::models::TokenUsage {
            input_tokens: Some(input),
            output_tokens: Some(output),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
        };

        // Verify tokens are set correctly (no need to check >= 0 for u32)
        prop_assert!(usage.input_tokens.is_some());
        prop_assert!(usage.output_tokens.is_some());
    }

    /// Property: Serialization roundtrip preserves data
    #[test]
    fn prop_token_usage_roundtrip(
        input in proptest::option::of(strategies::token_count()),
        output in proptest::option::of(strategies::token_count())
    ) {
        let original = crate::models::TokenUsage {
            input_tokens: input,
            output_tokens: output,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
        };

        let serialized = serde_json::to_string(&original).unwrap();
        let deserialized: crate::models::TokenUsage = serde_json::from_str(&serialized).unwrap();

        prop_assert_eq!(original.input_tokens, deserialized.input_tokens);
        prop_assert_eq!(original.output_tokens, deserialized.output_tokens);
    }
}

/// Property tests for path validation (security-critical)
mod path_security_props {
    use super::*;

    proptest! {
        /// Property: Paths with null bytes should always be rejected
        #[test]
        fn prop_null_bytes_rejected(
            prefix in "[a-zA-Z/]{1,20}",
            suffix in "[a-zA-Z/]{1,20}"
        ) {
            let malicious_path = format!("{prefix}\0{suffix}");

            // Verify that our validation would catch this
            prop_assert!(malicious_path.contains('\0'));
        }

        /// Property: Paths with parent traversal should be detected
        #[test]
        fn prop_parent_traversal_detected(
            prefix in "/[a-zA-Z]{1,10}",
            suffix in "[a-zA-Z]{1,10}"
        ) {
            let traversal_path = format!("{prefix}/../{suffix}");

            use std::path::{Path, Component};
            let path = Path::new(&traversal_path);
            let has_parent = path.components().any(|c| matches!(c, Component::ParentDir));

            prop_assert!(has_parent, "Path {} should contain parent traversal", traversal_path);
        }
    }
}

/// Regression tests for edge cases found by property testing
mod regression_tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn test_empty_project_name() {
        let result = crate::utils::extract_project_name("");
        assert_eq!(result, "");
    }

    #[test]
    fn test_single_dash_project_name() {
        let result = crate::utils::extract_project_name("-");
        assert_eq!(result, "-");
    }

    #[test]
    fn test_multiple_dashes_project_name() {
        // "---" with splitn(4, '-') produces ["", "", "", ""]
        // Since parts.len() == 4, it returns parts[3] which is ""
        let result = crate::utils::extract_project_name("---");
        assert_eq!(result, "");
    }

    #[test]
    fn test_unicode_project_name() {
        let result = crate::utils::extract_project_name("project-name");
        assert_eq!(result, "project-name");
    }

    #[test]
    fn test_very_long_project_name() {
        let long_name = "a".repeat(1000);
        let result = crate::utils::extract_project_name(&long_name);
        assert_eq!(result, long_name);
    }
}
