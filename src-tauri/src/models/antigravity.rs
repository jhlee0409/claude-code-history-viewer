use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 与 antigravity-token-monitor 的 `PersistedSessionState` 结构一致
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedSessionState {
    pub signature: String,
    pub latest: SessionTotals,
    pub snapshots: Vec<SessionSnapshot>,
    pub lifecycle: SessionLifecycle,
}

/// 快照条目（delta 增量）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    #[serde(rename = "capturedAt")]
    pub captured_at: u64, // Unix ms
    #[serde(rename = "inputTokens")]
    pub input_tokens: u64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u64,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: u64,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: u64,
    #[serde(rename = "reasoningTokens")]
    pub reasoning_tokens: u64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    pub mode: String, // "reported" | "estimated"
}

/// Session 的生命周期状态
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionLifecycleStatus {
    #[default]
    Active,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionLifecycle {
    pub status: SessionLifecycleStatus,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: u64,
    #[serde(rename = "archivedAt", skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
}

/// 单个 session 的 token 汇总（与 monitor 中 `SessionTotals` 一致）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionTotals {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub label: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "lastModifiedMs")]
    pub last_modified_ms: u64,
    pub mode: String,
    pub source: String, // "filesystem" | "rpc-artifact"
    #[serde(rename = "evidenceCount")]
    pub evidence_count: u32,
    #[serde(rename = "messageCount", skip_serializing_if = "Option::is_none")]
    pub message_count: Option<u32>,
    #[serde(rename = "inputTokens")]
    pub input_tokens: u64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u64,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: u64,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: u64,
    #[serde(rename = "reasoningTokens")]
    pub reasoning_tokens: u64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    #[serde(rename = "modelTotals", skip_serializing_if = "Option::is_none")]
    pub model_totals: Option<HashMap<String, u64>>,
}

/// 加载后的完整状态（sessions map keyed by sessionId）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AntigravityState {
    #[serde(rename = "lastPollAt", skip_serializing_if = "Option::is_none")]
    pub last_poll_at: Option<u64>,
    pub sessions: HashMap<String, PersistedSessionState>,
}

/// Antigravity 项目汇总 — 供前端展示
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntigravityProjectSummary {
    #[serde(rename = "sessionCount")]
    pub session_count: usize,
    #[serde(rename = "activeSessions")]
    pub active_sessions: usize,
    #[serde(rename = "archivedSessions")]
    pub archived_sessions: usize,
    #[serde(rename = "totalInputTokens")]
    pub total_input_tokens: u64,
    #[serde(rename = "totalOutputTokens")]
    pub total_output_tokens: u64,
    #[serde(rename = "totalCacheReadTokens")]
    pub total_cache_read_tokens: u64,
    #[serde(rename = "totalCacheWriteTokens")]
    pub total_cache_write_tokens: u64,
    #[serde(rename = "totalReasoningTokens")]
    pub total_reasoning_tokens: u64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    #[serde(rename = "snapshotsCount")]
    pub snapshots_count: usize,
    pub sessions: Vec<AntigravitySessionInfo>,
}

/// 单个 session 列表摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntigravitySessionInfo {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub label: String,
    pub lifecycle: String, // "active" | "archived"
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: u64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    #[serde(rename = "snapshotsCount")]
    pub snapshots_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_antigravity_state_default() {
        let state = AntigravityState::default();
        assert!(state.sessions.is_empty());
        assert!(state.last_poll_at.is_none());
    }

    #[test]
    fn test_session_lifecycle_status_default() {
        let lifecycle = SessionLifecycle::default();
        assert!(matches!(lifecycle.status, SessionLifecycleStatus::Active));
        assert_eq!(lifecycle.last_seen_at, 0);
        assert!(lifecycle.archived_at.is_none());
    }

    #[test]
    fn test_session_totals_default() {
        let totals = SessionTotals::default();
        assert_eq!(totals.total_tokens, 0);
        assert_eq!(totals.input_tokens, 0);
    }

    #[test]
    fn test_antigravity_state_serialization() {
        let state = AntigravityState {
            last_poll_at: Some(1_700_000_000_000),
            sessions: HashMap::new(),
        };
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: AntigravityState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.last_poll_at, Some(1_700_000_000_000));
    }

    #[test]
    fn test_lifecycle_status_serialization() {
        let active = SessionLifecycleStatus::Active;
        let json = serde_json::to_string(&active).unwrap();
        assert_eq!(json, "\"active\"");

        let archived = SessionLifecycleStatus::Archived;
        let json2 = serde_json::to_string(&archived).unwrap();
        assert_eq!(json2, "\"archived\"");
    }

    #[test]
    fn test_parse_persisted_session_state_from_json() {
        let json = r#"{
            "signature": "test-sig",
            "latest": {
                "sessionId": "sess-001",
                "label": "Test",
                "filePath": "/tmp/test.jsonl",
                "lastModifiedMs": 1700000000000,
                "mode": "reported",
                "source": "filesystem",
                "evidenceCount": 5,
                "inputTokens": 1000,
                "outputTokens": 500,
                "cacheReadTokens": 200,
                "cacheWriteTokens": 100,
                "reasoningTokens": 0,
                "totalTokens": 1800
            },
            "snapshots": [],
            "lifecycle": {
                "status": "active",
                "lastSeenAt": 1700000000000
            }
        }"#;

        let state: PersistedSessionState = serde_json::from_str(json).unwrap();
        assert_eq!(state.signature, "test-sig");
        assert_eq!(state.latest.total_tokens, 1800);
        assert!(state.snapshots.is_empty());
    }
}
