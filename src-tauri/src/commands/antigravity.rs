use crate::models::{
    AntigravityProjectSummary, AntigravitySessionInfo, AntigravityState, PersistedSessionState,
    SessionLifecycle, SessionLifecycleStatus, SessionTotals,
};
use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const ESTIMATED_PROMPT_RATIO: f64 = 0.62;

static MODEL_ALIAS_MAP: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    HashMap::from([
        ("MODEL_PLACEHOLDER_M37", "gemini-3.1-pro-high"),
        ("MODEL_PLACEHOLDER_M36", "gemini-3.1-pro-low"),
        ("MODEL_PLACEHOLDER_M18", "gemini-3-flash"),
        ("MODEL_PLACEHOLDER_M8", "gemini-3-pro-high"),
        ("MODEL_PLACEHOLDER_M7", "gemini-3-pro-low"),
        ("MODEL_PLACEHOLDER_M9", "gemini-3-pro-image"),
        ("MODEL_PLACEHOLDER_M26", "claude-opus-4-6-thinking"),
        ("MODEL_PLACEHOLDER_M35", "claude-sonnet-4-6-thinking"),
        ("MODEL_PLACEHOLDER_M12", "claude-opus-4-5-thinking"),
        ("MODEL_OPENAI_GPT_OSS_120B_MEDIUM", "gpt-oss-120b-medium"),
        ("MODEL_CLAUDE_4_5_SONNET", "claude-sonnet-4-5"),
        (
            "MODEL_CLAUDE_4_5_SONNET_THINKING",
            "claude-sonnet-4-5-thinking",
        ),
    ])
});

// ============================================================================
// Internal helpers — fully testable (no Tauri state dependency)
// ============================================================================

/// 定位 antigravity 根目录：`~/.gemini/antigravity`
pub fn get_antigravity_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".gemini").join("antigravity"))
}

/// Resolves the antigravity root directory, with fallback discovery logic.
///
/// First checks the default `~/.gemini/antigravity` path, then falls back to
/// external state directories discovered via platform-specific config locations.
pub fn resolve_antigravity_root() -> Option<PathBuf> {
    let default_root = get_antigravity_root();
    if default_root.as_ref().is_some_and(|root| root.exists()) {
        return default_root;
    }

    discover_external_state_dirs()
        .into_iter()
        .next()
        .or(default_root)
}

/// Resolves the antigravity root from an arbitrary path by walking up the directory
/// tree and looking for the `.token-monitor/rpc-cache/v1` marker.
///
/// Returns `None` when no marker is found. Callers used to receive a
/// `default_root` fallback here, which meant any path that didn't match
/// the marker was silently accepted as if it lived under the default
/// antigravity install — that made downstream `path_in_resolved` checks
/// trivially pass for arbitrary paths. Refuse to guess: missing marker
/// now means "this is not a recognizable antigravity root".
pub fn antigravity_root_from_path(path: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(path);
    let default_root = get_antigravity_root();

    if let Some(root) = &default_root {
        if candidate.starts_with(root) {
            return Some(root.clone());
        }
    }

    let mut current = if candidate.is_dir() {
        candidate
    } else {
        candidate.parent()?.to_path_buf()
    };

    loop {
        if current
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .exists()
        {
            return Some(current);
        }

        if !current.pop() {
            break;
        }
    }

    None
}

/// Returns the RPC cache root path for a given antigravity root.
pub fn get_antigravity_rpc_cache_root(root: &Path) -> PathBuf {
    root.join(".token-monitor").join("rpc-cache").join("v1")
}

/// Discovers external state directories across platform-specific config locations.
///
/// On macOS searches `~/Library/Application Support`; on Windows `dirs::data_dir()`;
/// on Linux checks `~/.config` and platform config dirs. Looks for directories
/// containing a `monitor-state.json` file in their global storage subdirectory.
fn discover_external_state_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let bases = if cfg!(target_os = "macos") {
        dirs::home_dir()
            .map(|home| vec![home.join("Library").join("Application Support")])
            .unwrap_or_default()
    } else if cfg!(target_os = "windows") {
        dirs::data_dir().map(|dir| vec![dir]).unwrap_or_default()
    } else {
        let mut candidates = Vec::new();
        if let Some(config_dir) = dirs::config_dir() {
            candidates.push(config_dir);
        }
        if let Some(home) = dirs::home_dir() {
            let fallback = home.join(".config");
            if !candidates.iter().any(|candidate| candidate == &fallback) {
                candidates.push(fallback);
            }
        }
        candidates
    };

    for base in bases {
        let Ok(app_entries) = std::fs::read_dir(base) else {
            continue;
        };

        for app_entry in app_entries.flatten() {
            let Ok(file_type) = app_entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }

            let global_storage = app_entry.path().join("User").join("globalStorage");
            if !global_storage.exists() {
                continue;
            }
            if let Ok(meta) = std::fs::symlink_metadata(&global_storage) {
                if meta.file_type().is_symlink() {
                    continue;
                }
            }

            let Ok(storage_entries) = std::fs::read_dir(&global_storage) else {
                continue;
            };
            for storage_entry in storage_entries.flatten() {
                let Ok(file_type) = storage_entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() || !file_type.is_dir() {
                    continue;
                }

                let candidate = storage_entry.path();
                if candidate.join("monitor-state.json").exists() {
                    dirs.push(candidate);
                }
            }
        }
    }

    dirs
}

/// Metadata extracted from an RPC cache `manifest.json` file.
#[derive(Default)]
struct RpcManifestInfo {
    /// Unix timestamp (ms) when the state was exported.
    exported_at_ms: u64,
    /// Unix timestamp (ms) of the server's last modification.
    server_last_modified_ms: u64,
}

/// Accumulates token usage across multiple usage records in a session.
#[derive(Default)]
struct RpcSessionAggregate {
    /// Number of usage records processed.
    record_count: u32,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens: u64,
    total_tokens: u64,
    first_seen_ms: Option<u64>,
    last_seen_ms: Option<u64>,
    /// Maps model name -> total tokens used.
    model_totals: HashMap<String, u64>,
}

/// Represents a candidate session discovered in the antigravity brain directory.
struct SessionCandidate {
    session_id: String,
    session_dir: PathBuf,
    file_paths: Vec<PathBuf>,
    last_modified_ms: u64,
    label_hint: String,
}

/// Parses an RFC3339 timestamp string to Unix milliseconds.
fn parse_rfc3339_to_ms(raw: &str) -> Option<u64> {
    let timestamp_ms = chrono::DateTime::parse_from_rfc3339(raw)
        .ok()?
        .timestamp_millis();
    if timestamp_ms < 0 {
        return None;
    }
    u64::try_from(timestamp_ms).ok()
}

/// Returns the file's modification time in Unix milliseconds, or 0 on error.
fn file_mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads and parses the `manifest.json` file from an RPC cache directory.
fn read_rpc_manifest(dir: &Path) -> RpcManifestInfo {
    let path = dir.join("manifest.json");
    let Ok(content) = std::fs::read_to_string(path) else {
        return RpcManifestInfo::default();
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return RpcManifestInfo::default();
    };

    RpcManifestInfo {
        exported_at_ms: value["exportedAt"].as_u64().unwrap_or(0),
        server_last_modified_ms: value["serverLastModifiedMs"].as_u64().unwrap_or(0),
    }
}

/// Resolves a model placeholder string to its canonical model name.
fn resolve_model_alias(model: &str) -> String {
    MODEL_ALIAS_MAP
        .get(model)
        .copied()
        .unwrap_or(model)
        .to_string()
}

/// Checks whether a session ID contains only safe characters (alphanumeric, underscore, hyphen).
fn is_valid_antigravity_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
}

/// Counts step records in a JSON value (records with `"recordType": "step"`).
fn count_step_rows(value: &Value) -> u32 {
    match value {
        Value::Object(record) => {
            u32::from(record.get("recordType").and_then(Value::as_str) == Some("step"))
        }
        _ => 0,
    }
}

/// Counts messages (step rows) in a JSON object or array of records.
fn count_messages(value: &Value) -> u32 {
    match value {
        Value::Object(record) => match record.get("records") {
            Some(Value::Array(arr)) => arr.iter().map(count_step_rows).sum(),
            _ => count_step_rows(value),
        },
        _ => 0,
    }
}

/// Estimates token count from raw text length using a 4-char-per-token heuristic.
fn estimate_tokens(text: &str) -> u64 {
    let normalized = text.trim();
    if normalized.is_empty() {
        return 0;
    }

    ((normalized.len() as f64) / 4.0).round().max(1.0) as u64
}

/// Recursively collects all string values from a JSON structure into `output`.
fn collect_text_from_json(value: &Value, output: &mut String) {
    match value {
        Value::String(text) if !text.trim().is_empty() => {
            output.push('\n');
            output.push_str(text);
        }
        Value::Array(items) => {
            for item in items {
                collect_text_from_json(item, output);
            }
        }
        Value::Object(map) => {
            for value in map.values() {
                collect_text_from_json(value, output);
            }
        }
        _ => {}
    }
}

/// Parses a usage record and accumulates its token data into the aggregate.
/// Returns `true` if the record was a usage record, `false` otherwise.
fn parse_usage_record(record: &Value, aggregate: &mut RpcSessionAggregate) -> bool {
    if record["recordType"].as_str() != Some("usage") {
        return false;
    }

    let input = record["inputTokens"].as_u64().unwrap_or(0);
    let output = record["outputTokens"].as_u64().unwrap_or(0);
    let cache_read = record["cacheReadTokens"].as_u64().unwrap_or(0);
    let cache_write = record["cacheWriteTokens"].as_u64().unwrap_or(0);
    let reasoning = record["reasoningTokens"].as_u64().unwrap_or(0);
    let reported_total = record["totalTokens"].as_u64().unwrap_or(0);
    let normalized_total =
        reported_total.max(input + output + cache_read + cache_write + reasoning);

    aggregate.record_count += 1;
    aggregate.input_tokens += input;
    aggregate.output_tokens += output;
    aggregate.cache_read_tokens += cache_read;
    aggregate.cache_write_tokens += cache_write;
    aggregate.reasoning_tokens += reasoning;
    aggregate.total_tokens += normalized_total;

    let model = resolve_model_alias(record["model"].as_str().unwrap_or("unknown"));
    *aggregate.model_totals.entry(model).or_insert(0) += normalized_total;

    if let Some(created_at) = record["raw"]["chatModel"]["chatStartMetadata"]["createdAt"].as_str()
    {
        if let Some(ms) = parse_rfc3339_to_ms(created_at) {
            aggregate.first_seen_ms = Some(match aggregate.first_seen_ms {
                Some(current) => current.min(ms),
                None => ms,
            });
            aggregate.last_seen_ms = Some(match aggregate.last_seen_ms {
                Some(current) => current.max(ms),
                None => ms,
            });
        }
    }

    true
}

/// Recursively collects all file paths under `dir` into `files`, skipping
/// system files (`.DS_Store`, `Thumbs.db`, backup files with `~` suffix) and symlinks.
fn collect_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read {} entry: {}", dir.display(), e))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect {}: {}", path.display(), e))?;
        if file_type.is_symlink() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy().to_lowercase();
        if file_name == ".ds_store" || file_name == "thumbs.db" || file_name.ends_with('~') {
            continue;
        }

        if file_type.is_dir() {
            collect_files(&path, files)?;
        } else {
            files.push(path);
        }
    }

    Ok(())
}

/// Scans the `brain/` directory for session candidates, returning them sorted
/// by last modification time (newest first).
fn scan_brain_candidates(root: &Path) -> Result<Vec<SessionCandidate>, String> {
    let brain_dir = root.join("brain");
    let conversations_dir = root.join("conversations");
    if !brain_dir.exists() {
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&brain_dir)
        .map_err(|e| format!("Failed to read {}: {}", brain_dir.display(), e))?;
    let mut sessions = Vec::new();

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }

        let session_id = entry.file_name().to_string_lossy().to_string();
        // Defense-in-depth: refuse any brain-dir name that wouldn't be
        // safe to embed in a file path (e.g. `..`, `foo/bar`, control
        // chars). The entry filename is read straight from disk so the
        // allowlist guards against an attacker-placed directory.
        if !is_valid_antigravity_session_id(&session_id) {
            continue;
        }
        let session_dir = entry.path();
        let mut file_paths = Vec::new();
        collect_files(&session_dir, &mut file_paths)?;

        let pb_path = conversations_dir.join(format!("{session_id}.pb"));
        // Defense-in-depth: reject symlinks even though the parent
        // directory was already symlink-guarded — a symlinked .pb
        // artifact could point outside the trusted antigravity root.
        if let Ok(meta) = std::fs::symlink_metadata(&pb_path) {
            if !meta.file_type().is_symlink() && meta.file_type().is_file() {
                file_paths.push(pb_path);
            }
        }

        let mut last_modified_ms = 0;
        for file_path in &file_paths {
            last_modified_ms = last_modified_ms.max(file_mtime_ms(file_path));
        }

        if file_paths.is_empty() {
            continue;
        }

        sessions.push(SessionCandidate {
            session_id: session_id.clone(),
            session_dir,
            file_paths,
            last_modified_ms,
            label_hint: session_id,
        });
    }

    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_modified_ms));
    Ok(sessions)
}

/// Resolves a human-readable label for a session by reading `task.md`,
/// `implementation_plan.md`, or `walkthrough.md` and extracting the first `#` heading.
fn resolve_label(session_dir: &Path, fallback: &str) -> String {
    for label_file in ["task.md", "implementation_plan.md", "walkthrough.md"] {
        let path = session_dir.join(label_file);
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("# ") {
                return rest.trim().trim_start_matches("Task:").trim().to_string();
            }
        }
    }

    fallback.to_string()
}

/// Parses token usage from a list of files (jsonl, json, md, txt, log, yaml).
/// Returns the aggregated token counts, message count, and concatenated text.
fn parse_token_files(token_file_paths: &[PathBuf]) -> (RpcSessionAggregate, u32, String) {
    let mut aggregate = RpcSessionAggregate::default();
    let mut message_count = 0u32;
    let mut estimated_text = String::new();

    for file_path in token_file_paths {
        let ext = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        // Defense-in-depth: only read regular files. The parent rpc-cache
        // directory is symlink-guarded upstream, but the entries within
        // it could still be symlinks (pointing outside the root) or
        // non-regular files (FIFOs, devices, …) that could block or
        // misbehave under `read_to_string`. Match the same guard used
        // by `load_active_state` / `load_archive_states`.
        let Ok(meta) = std::fs::symlink_metadata(file_path) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(file_path) else {
            continue;
        };

        match ext.as_str() {
            "jsonl" => {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    estimated_text.push('\n');
                    estimated_text.push_str(trimmed);
                    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                        continue;
                    };
                    message_count += count_step_rows(&value);
                    parse_usage_record(&value, &mut aggregate);
                }
            }
            "json" => {
                estimated_text.push('\n');
                estimated_text.push_str(content.trim());
                let Ok(value) = serde_json::from_str::<Value>(&content) else {
                    continue;
                };
                message_count += count_messages(&value);
                collect_text_from_json(&value, &mut estimated_text);
            }
            "md" | "txt" | "log" | "yaml" | "yml" => {
                estimated_text.push('\n');
                estimated_text.push_str(&content);
            }
            _ => {}
        }
    }

    (aggregate, message_count, estimated_text)
}

#[allow(clippy::too_many_arguments)]
/// Builds a `PersistedSessionState` from token files and metadata for a single session.
fn build_session_state(
    session_id: &str,
    label_dir: &Path,
    storage_dir: &Path,
    label_hint: &str,
    token_file_paths: &[PathBuf],
    last_modified_ms: u64,
    source: &str,
    lifecycle_status: SessionLifecycleStatus,
) -> PersistedSessionState {
    let (aggregate, message_count, estimated_text) = parse_token_files(token_file_paths);
    let label = resolve_label(label_dir, label_hint);
    let is_reported = aggregate.record_count > 0;
    let total_tokens = if is_reported {
        aggregate.total_tokens
    } else {
        estimate_tokens(&estimated_text)
    };
    let estimated_input_tokens = ((total_tokens as f64) * ESTIMATED_PROMPT_RATIO).round() as u64;

    let latest = SessionTotals {
        session_id: session_id.to_string(),
        label,
        file_path: storage_dir.to_string_lossy().to_string(),
        last_modified_ms,
        mode: if is_reported {
            "reported".to_string()
        } else {
            "estimated".to_string()
        },
        source: source.to_string(),
        evidence_count: aggregate.record_count,
        message_count: Some(if message_count > 0 {
            message_count
        } else {
            aggregate.record_count
        }),
        input_tokens: if is_reported {
            aggregate.input_tokens
        } else {
            estimated_input_tokens
        },
        output_tokens: if is_reported {
            aggregate.output_tokens
        } else {
            total_tokens.saturating_sub(estimated_input_tokens)
        },
        cache_read_tokens: aggregate.cache_read_tokens,
        cache_write_tokens: aggregate.cache_write_tokens,
        reasoning_tokens: aggregate.reasoning_tokens,
        total_tokens,
        model_totals: if aggregate.model_totals.is_empty() {
            None
        } else {
            Some(aggregate.model_totals)
        },
    };

    let signature = format!("{source}:{session_id}:{last_modified_ms}");
    let last_seen_at = aggregate.last_seen_ms.unwrap_or(last_modified_ms);
    let archived_at =
        matches!(lifecycle_status, SessionLifecycleStatus::Archived).then_some(last_modified_ms);

    PersistedSessionState {
        signature,
        latest,
        snapshots: vec![],
        lifecycle: SessionLifecycle {
            status: lifecycle_status,
            last_seen_at,
            archived_at,
        },
    }
}

/// Builds the full `AntigravityState` by scanning the antigravity root directory:
/// first from `brain/` candidates, then from the RPC cache directory.
fn build_state_from_token_monitor_sources(root: &Path) -> Result<AntigravityState, String> {
    let rpc_root = get_antigravity_rpc_cache_root(root);
    let mut sessions = HashMap::new();
    let mut seen_ids = HashSet::new();

    for candidate in scan_brain_candidates(root)? {
        let rpc_dir = rpc_root.join(&candidate.session_id);
        let manifest = read_rpc_manifest(&rpc_dir);
        let usage_path = rpc_dir.join("usage.jsonl");
        let steps_path = rpc_dir.join("steps.jsonl");
        let has_rpc_artifact = usage_path.exists() || steps_path.exists();

        let (token_file_paths, source, effective_last_modified) = if has_rpc_artifact {
            let mut token_paths = Vec::new();
            if usage_path.exists() {
                token_paths.push(usage_path.clone());
            }
            if steps_path.exists() {
                token_paths.push(steps_path.clone());
            }
            let last_modified = [
                candidate.last_modified_ms,
                file_mtime_ms(&usage_path),
                file_mtime_ms(&steps_path),
                manifest.exported_at_ms,
                manifest.server_last_modified_ms,
            ]
            .into_iter()
            .max()
            .unwrap_or(candidate.last_modified_ms);
            (token_paths, "rpc-artifact", last_modified)
        } else {
            (
                candidate.file_paths.clone(),
                "filesystem",
                candidate.last_modified_ms,
            )
        };

        // Synthesize a session from whichever source is available.
        // Previously the no-rpc-artifact branch skipped the candidate
        // entirely, relying on the rpc-cache scan below to pick it up
        // later — but that scan only walks the rpc-cache directory, so
        // brain/-only sessions never reached the synthesized state.
        //
        // The storage_dir becomes the session's user-facing file_path
        // (used by "Reveal in Finder" etc.). Point it at the actual
        // data location: rpc_dir when token files come from rpc-cache,
        // session_dir for filesystem-only sessions whose rpc_dir does
        // not exist on disk.
        let storage_dir = if has_rpc_artifact {
            rpc_dir.clone()
        } else {
            candidate.session_dir.clone()
        };
        let persisted = build_session_state(
            &candidate.session_id,
            &candidate.session_dir,
            &storage_dir,
            &candidate.label_hint,
            &token_file_paths,
            effective_last_modified,
            source,
            SessionLifecycleStatus::Active,
        );
        seen_ids.insert(candidate.session_id.clone());
        sessions.insert(candidate.session_id, persisted);
    }

    if rpc_root.exists() {
        let entries = std::fs::read_dir(&rpc_root)
            .map_err(|e| format!("Failed to read {}: {}", rpc_root.display(), e))?;
        for entry in entries.flatten() {
            let session_dir = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().to_string();
            // Same allowlist applied to brain/ candidates: a directory
            // dropped into rpc-cache must look like a session id before
            // we trust it as a path component or HashMap key.
            if !is_valid_antigravity_session_id(&session_id) {
                continue;
            }
            if seen_ids.contains(&session_id) {
                continue;
            }

            let usage_path = session_dir.join("usage.jsonl");
            let steps_path = session_dir.join("steps.jsonl");
            let mut token_paths = Vec::new();
            if usage_path.exists() {
                token_paths.push(usage_path.clone());
            }
            if steps_path.exists() {
                token_paths.push(steps_path.clone());
            }
            if token_paths.is_empty() {
                continue;
            }

            let manifest = read_rpc_manifest(&session_dir);
            let last_modified = [
                file_mtime_ms(&usage_path),
                file_mtime_ms(&steps_path),
                manifest.exported_at_ms,
                manifest.server_last_modified_ms,
            ]
            .into_iter()
            .max()
            .unwrap_or_else(|| file_mtime_ms(&session_dir));

            let persisted = build_session_state(
                &session_id,
                &session_dir,
                &session_dir,
                &session_id,
                &token_paths,
                last_modified,
                "rpc-artifact",
                SessionLifecycleStatus::Archived,
            );
            sessions.insert(session_id, persisted);
        }
    }

    Ok(AntigravityState {
        last_poll_at: None,
        sessions,
    })
}

/// Alias for `build_state_from_token_monitor_sources` — discovers sessions
/// from both the `brain/` directory and the RPC cache.
fn build_state_from_rpc_cache(root: &Path) -> Result<AntigravityState, String> {
    build_state_from_token_monitor_sources(root)
}

/// 从单个 JSON 文件读取 `AntigravityState`
pub fn load_state_file(path: &Path) -> Result<AntigravityState, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str::<AntigravityState>(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// 读取活跃状态 `monitor-state.json`
pub fn load_active_state(root: &Path) -> Option<AntigravityState> {
    let active_path = root.join("monitor-state.json");
    // Defense-in-depth: refuse to follow a symlinked monitor-state.json
    // even though the parent directory is trusted. `symlink_metadata`
    // also implicitly checks for existence.
    let meta = std::fs::symlink_metadata(&active_path).ok()?;
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return None;
    }
    load_state_file(&active_path).ok()
}

/// 扫描并读取所有归档文件 `monitor-state.archive-YYYY-MM.json`
pub fn load_archive_states(root: &Path) -> Vec<AntigravityState> {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut named = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        if name_str.starts_with("monitor-state.archive-")
            && Path::new(&name_str)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            let archive_path = entry.path();
            // Same defense-in-depth as load_active_state: refuse
            // symlinked archive files regardless of platform
            // (DirEntry::file_type follows symlinks on some targets).
            let Ok(meta) = std::fs::symlink_metadata(&archive_path) else {
                continue;
            };
            if meta.file_type().is_symlink() || !meta.file_type().is_file() {
                continue;
            }
            if let Ok(state) = load_state_file(&archive_path) {
                named.push((name_str, state));
            }
        }
    }
    named.sort_by(|a, b| a.0.cmp(&b.0));
    named.into_iter().map(|(_, s)| s).collect()
}

/// 合并多个状态：后者（active）覆盖前者（archive）中的相同 `session_id`
///
/// 与 antigravity-token-monitor 的 `mergeSessionMaps` 逻辑一致
pub fn merge_states(
    archive_states: Vec<AntigravityState>,
    active: Option<AntigravityState>,
) -> AntigravityState {
    let mut merged: HashMap<String, PersistedSessionState> = HashMap::new();

    // Apply archives first (oldest → newest)
    for archive in archive_states {
        for (id, session) in archive.sessions {
            merged.insert(id, session);
        }
    }

    // Active overrides archives; preserve its last_poll_at so the
    // frontend can show when the monitor last refreshed.
    let last_poll_at = active.as_ref().and_then(|a| a.last_poll_at);
    if let Some(active_state) = active {
        for (id, session) in active_state.sessions {
            merged.insert(id, session);
        }
    }

    AntigravityState {
        last_poll_at,
        sessions: merged,
    }
}

/// 聚合计算项目汇总 — 纯函数，易于测试
pub fn compute_project_summary(state: &AntigravityState) -> AntigravityProjectSummary {
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut total_cache_read = 0u64;
    let mut total_cache_write = 0u64;
    let mut total_reasoning = 0u64;
    let mut total_tokens = 0u64;
    let mut active_count = 0usize;
    let mut archived_count = 0usize;
    let mut snapshots_total = 0usize;
    let mut sessions_info: Vec<AntigravitySessionInfo> = Vec::new();

    for (session_id, session_state) in &state.sessions {
        let totals = &session_state.latest;
        total_input += totals.input_tokens;
        total_output += totals.output_tokens;
        total_cache_read += totals.cache_read_tokens;
        total_cache_write += totals.cache_write_tokens;
        total_reasoning += totals.reasoning_tokens;
        total_tokens += totals.total_tokens;
        snapshots_total += session_state.snapshots.len();

        let lifecycle_str = match session_state.lifecycle.status {
            SessionLifecycleStatus::Active => {
                active_count += 1;
                "active".to_string()
            }
            SessionLifecycleStatus::Archived => {
                archived_count += 1;
                "archived".to_string()
            }
        };

        sessions_info.push(AntigravitySessionInfo {
            session_id: session_id.clone(),
            label: totals.label.clone(),
            lifecycle: lifecycle_str,
            last_seen_at: session_state.lifecycle.last_seen_at,
            total_tokens: totals.total_tokens,
            snapshots_count: session_state.snapshots.len(),
        });
    }

    sessions_info.sort_by_key(|s| std::cmp::Reverse(s.total_tokens));

    AntigravityProjectSummary {
        session_count: state.sessions.len(),
        active_sessions: active_count,
        archived_sessions: archived_count,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cache_read_tokens: total_cache_read,
        total_cache_write_tokens: total_cache_write,
        total_reasoning_tokens: total_reasoning,
        total_tokens,
        snapshots_count: snapshots_total,
        sessions: sessions_info,
    }
}

/// 加载并合并状态（可注入根路径，便于测试）
pub fn load_antigravity_state_impl(root: &Path) -> Result<AntigravityState, String> {
    if root.exists() {
        let active = load_active_state(root);
        let archive_states = load_archive_states(root);
        let merged = merge_states(archive_states, active);
        if !merged.sessions.is_empty() {
            return Ok(merged);
        }

        let rpc_state = build_state_from_rpc_cache(root)?;
        if !rpc_state.sessions.is_empty() {
            return Ok(rpc_state);
        }
    }

    for external_root in discover_external_state_dirs() {
        let external_active = load_active_state(&external_root);
        let external_archives = load_archive_states(&external_root);
        let external_merged = merge_states(external_archives, external_active);
        if !external_merged.sessions.is_empty() {
            return Ok(external_merged);
        }
    }

    Ok(AntigravityState::default())
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub async fn load_antigravity_state() -> Result<AntigravityState, String> {
    let root = resolve_antigravity_root().ok_or("Cannot determine antigravity root directory")?;
    load_antigravity_state_impl(&root)
}

#[tauri::command]
pub async fn get_antigravity_session(
    session_id: String,
) -> Result<Option<PersistedSessionState>, String> {
    if !is_valid_antigravity_session_id(&session_id) {
        return Err("Invalid antigravity session_id".to_string());
    }
    let root = resolve_antigravity_root().ok_or("Cannot determine antigravity root directory")?;
    let state = load_antigravity_state_impl(&root)?;
    Ok(state.sessions.get(&session_id).cloned())
}

#[tauri::command]
pub async fn get_antigravity_project_summary(
    root_path: Option<String>,
) -> Result<AntigravityProjectSummary, String> {
    // Resolution order: marker-anchored root from the supplied path,
    // then the platform-discovered default. The previous middle step
    // (accept `PathBuf::from(root_path)` directly) weakened the marker
    // contract — it would admit any supplied path even when the marker
    // walk failed.
    let root = root_path
        .as_deref()
        .and_then(antigravity_root_from_path)
        .or_else(resolve_antigravity_root)
        .ok_or("Cannot determine antigravity root directory")?;
    let state = load_antigravity_state_impl(&root)?;
    Ok(compute_project_summary(&state))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        PersistedSessionState, SessionLifecycle, SessionLifecycleStatus, SessionTotals,
    };
    use tempfile::TempDir;

    fn make_session(
        id: &str,
        total_tokens: u64,
        status: SessionLifecycleStatus,
    ) -> PersistedSessionState {
        PersistedSessionState {
            signature: format!("sig-{id}"),
            latest: SessionTotals {
                session_id: id.to_string(),
                label: format!("Session {id}"),
                total_tokens,
                input_tokens: total_tokens / 2,
                output_tokens: total_tokens / 4,
                cache_read_tokens: total_tokens / 8,
                cache_write_tokens: total_tokens / 8,
                ..Default::default()
            },
            snapshots: vec![],
            lifecycle: SessionLifecycle {
                status,
                last_seen_at: 1_700_000_000_000,
                archived_at: None,
            },
        }
    }

    #[test]
    fn test_merge_states_active_overrides_archive() {
        let mut archive_sessions = HashMap::new();
        archive_sessions.insert(
            "sess-001".to_string(),
            make_session("sess-001", 1000, SessionLifecycleStatus::Archived),
        );
        let archive = AntigravityState {
            last_poll_at: None,
            sessions: archive_sessions,
        };

        let mut active_sessions = HashMap::new();
        active_sessions.insert(
            "sess-001".to_string(),
            make_session("sess-001", 5000, SessionLifecycleStatus::Active),
        );
        let active = AntigravityState {
            last_poll_at: Some(1_700_000_001_000),
            sessions: active_sessions,
        };

        let merged = merge_states(vec![archive], Some(active));
        let session = merged.sessions.get("sess-001").unwrap();
        // Active value (5000) should win over archive value (1000)
        assert_eq!(session.latest.total_tokens, 5000);
    }

    #[test]
    fn test_merge_states_preserves_archive_only_sessions() {
        let mut archive_sessions = HashMap::new();
        archive_sessions.insert(
            "old-sess".to_string(),
            make_session("old-sess", 999, SessionLifecycleStatus::Archived),
        );
        let archive = AntigravityState {
            last_poll_at: None,
            sessions: archive_sessions,
        };

        let merged = merge_states(vec![archive], None);
        assert!(merged.sessions.contains_key("old-sess"));
        assert_eq!(merged.sessions.len(), 1);
    }

    #[test]
    fn test_merge_states_empty() {
        let merged = merge_states(vec![], None);
        assert!(merged.sessions.is_empty());
        assert!(merged.last_poll_at.is_none());
    }

    #[test]
    fn test_merge_states_preserves_active_last_poll_at() {
        let archive = AntigravityState {
            last_poll_at: None,
            sessions: HashMap::new(),
        };
        let active = AntigravityState {
            last_poll_at: Some(1_700_000_002_000),
            sessions: HashMap::new(),
        };

        let merged = merge_states(vec![archive], Some(active));
        assert_eq!(merged.last_poll_at, Some(1_700_000_002_000));
    }

    #[test]
    fn test_merge_states_no_active_drops_archive_last_poll_at() {
        // Archive states intentionally don't carry their own poll time,
        // so a merge without an active state results in `None`.
        let archive = AntigravityState {
            last_poll_at: Some(1_700_000_000_000),
            sessions: HashMap::new(),
        };
        let merged = merge_states(vec![archive], None);
        assert!(merged.last_poll_at.is_none());
    }

    #[test]
    fn test_compute_project_summary_counts() {
        let mut sessions = HashMap::new();
        sessions.insert(
            "s1".to_string(),
            make_session("s1", 2000, SessionLifecycleStatus::Active),
        );
        sessions.insert(
            "s2".to_string(),
            make_session("s2", 1000, SessionLifecycleStatus::Archived),
        );
        let state = AntigravityState {
            last_poll_at: None,
            sessions,
        };

        let summary = compute_project_summary(&state);
        assert_eq!(summary.session_count, 2);
        assert_eq!(summary.active_sessions, 1);
        assert_eq!(summary.archived_sessions, 1);
        assert_eq!(summary.total_tokens, 3000);
    }

    #[test]
    fn test_compute_project_summary_sorted_by_tokens() {
        let mut sessions = HashMap::new();
        sessions.insert(
            "a".to_string(),
            make_session("a", 100, SessionLifecycleStatus::Active),
        );
        sessions.insert(
            "b".to_string(),
            make_session("b", 9000, SessionLifecycleStatus::Active),
        );
        sessions.insert(
            "c".to_string(),
            make_session("c", 500, SessionLifecycleStatus::Active),
        );
        let state = AntigravityState {
            last_poll_at: None,
            sessions,
        };

        let summary = compute_project_summary(&state);
        // Should be sorted descending by tokens
        assert_eq!(summary.sessions[0].total_tokens, 9000);
        assert_eq!(summary.sessions[2].total_tokens, 100);
    }

    #[test]
    fn test_load_state_file_invalid_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, "not valid json").unwrap();
        let result = load_state_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_state_file_valid() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("monitor-state.json");
        let state = AntigravityState::default();
        let json = serde_json::to_string(&state).unwrap();
        std::fs::write(&path, &json).unwrap();

        let loaded = load_state_file(&path).unwrap();
        assert!(loaded.sessions.is_empty());
    }

    #[test]
    fn test_load_archive_states_filters_correctly() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        // Valid archive files
        let state = AntigravityState::default();
        let json = serde_json::to_string(&state).unwrap();
        std::fs::write(root.join("monitor-state.archive-2025-06.json"), &json).unwrap();
        std::fs::write(root.join("monitor-state.archive-2025-07.json"), &json).unwrap();

        // Should NOT be picked up
        std::fs::write(root.join("monitor-state.json"), &json).unwrap();
        std::fs::write(root.join("other-file.json"), &json).unwrap();

        let archives = load_archive_states(root);
        assert_eq!(archives.len(), 2);
    }

    #[test]
    fn test_load_antigravity_state_impl_missing_dir() {
        let state = load_antigravity_state_impl(Path::new("/nonexistent/path/xyz")).unwrap();
        assert!(state.sessions.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn test_load_active_state_rejects_symlink() {
        let dir = TempDir::new().unwrap();
        // Real, valid state file lives outside the root we'll scan from.
        let target = dir.path().join("real-state.json");
        let state = AntigravityState::default();
        std::fs::write(&target, serde_json::to_string(&state).unwrap()).unwrap();

        // Inside the scanned root, monitor-state.json is a symlink to it.
        let root = dir.path().join("scan-root");
        std::fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink(&target, root.join("monitor-state.json")).unwrap();

        // Defense-in-depth: refuse to follow the symlink even though
        // the link target is valid JSON.
        assert!(load_active_state(&root).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn test_load_archive_states_rejects_symlinked_archive() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("real-archive.json");
        let state = AntigravityState::default();
        std::fs::write(&target, serde_json::to_string(&state).unwrap()).unwrap();

        let root = dir.path().join("scan-root");
        std::fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink(&target, root.join("monitor-state.archive-2025-06.json"))
            .unwrap();
        // A real archive file alongside the symlink should still be picked up.
        std::fs::write(
            root.join("monitor-state.archive-2025-07.json"),
            serde_json::to_string(&state).unwrap(),
        )
        .unwrap();

        let archives = load_archive_states(&root);
        assert_eq!(archives.len(), 1);
    }

    #[test]
    fn test_antigravity_root_from_path_returns_none_when_marker_absent() {
        // A temp directory that has none of the antigravity layout
        // (no `.token-monitor/rpc-cache/v1`) and is outside the default
        // root must NOT resolve to anything — the function used to fall
        // back to `default_root` here, silently making the supplied
        // path look legitimate.
        let dir = TempDir::new().unwrap();
        let unrelated_dir = dir.path().join("not-antigravity");
        std::fs::create_dir(&unrelated_dir).unwrap();

        let resolved = antigravity_root_from_path(&unrelated_dir.to_string_lossy());
        assert!(
            resolved.is_none(),
            "expected None for marker-absent path, got {resolved:?}",
        );
    }

    #[test]
    fn test_antigravity_root_from_path_finds_marker_in_parent() {
        // Sanity check that the happy path (the supplied path lives
        // under a directory that has the `.token-monitor/rpc-cache/v1`
        // marker) still resolves to that root.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();
        let nested = root.join("brain").join("sess-x");
        std::fs::create_dir_all(&nested).unwrap();

        let resolved = antigravity_root_from_path(&nested.to_string_lossy()).unwrap();
        assert_eq!(resolved, root);
    }

    #[test]
    fn test_build_state_includes_filesystem_only_brain_session() {
        // Regression: a brain/ candidate that has token-bearing files
        // but no rpc-cache directory was previously dropped on the
        // floor. It should be synthesized from the filesystem source.
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();
        let session_dir = root.join("brain").join("sess-fs");
        std::fs::create_dir_all(&session_dir).unwrap();
        // Drop a minimal text-bearing file so the candidate is admitted.
        std::fs::write(session_dir.join("task.md"), "# Test session\n").unwrap();

        let state = build_state_from_token_monitor_sources(root).unwrap();
        assert!(state.sessions.contains_key("sess-fs"));
        let session = state.sessions.get("sess-fs").unwrap();
        assert_eq!(session.latest.source, "filesystem");
        // file_path must point at the on-disk brain/ directory, not
        // the (non-existent) rpc-cache sibling. UI "Reveal in Finder"
        // and similar actions depend on this being a real path.
        assert_eq!(
            session.latest.file_path,
            session_dir.to_string_lossy().to_string()
        );
    }

    #[test]
    fn test_scan_brain_candidates_rejects_invalid_session_id() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        let brain_dir = root.join("brain");
        std::fs::create_dir_all(&brain_dir).unwrap();
        // Names outside the [A-Za-z0-9_-]+ allowlist must be ignored
        // even when they hold token-bearing files. Stick to characters
        // that are legal on every supported filesystem (Windows
        // disallows `:`, `/`, etc.) so the test runs cross-platform.
        for bad in ["..weird", "has space", "has.dot", "has+plus"] {
            let s = brain_dir.join(bad);
            std::fs::create_dir_all(&s).unwrap();
            std::fs::write(s.join("task.md"), "# bad\n").unwrap();
        }
        // Sanity: a well-formed name in the same directory is still picked up.
        let good = brain_dir.join("good-session-1");
        std::fs::create_dir_all(&good).unwrap();
        std::fs::write(good.join("task.md"), "# good\n").unwrap();

        let candidates = scan_brain_candidates(root).unwrap();
        let ids: Vec<&str> = candidates.iter().map(|c| c.session_id.as_str()).collect();
        assert_eq!(ids, vec!["good-session-1"]);
    }

    #[test]
    fn test_load_antigravity_state_impl_falls_back_to_rpc_cache() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let rpc_dir = root
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .join("sess-rpc");
        std::fs::create_dir_all(&rpc_dir).unwrap();
        std::fs::create_dir_all(root.join("brain").join("sess-rpc")).unwrap();

        let usage = r#"{"recordType":"usage","sessionId":"sess-rpc","sequence":0,"model":"gemini-3-pro-high","inputTokens":100,"outputTokens":50,"cacheReadTokens":25,"cacheWriteTokens":10,"reasoningTokens":5,"totalTokens":190,"raw":{"chatModel":{"chatStartMetadata":{"createdAt":"2026-04-12T00:00:00Z"}}}}"#;
        std::fs::write(rpc_dir.join("usage.jsonl"), format!("{usage}\n")).unwrap();

        let state = load_antigravity_state_impl(root).unwrap();
        let session = state.sessions.get("sess-rpc").unwrap();
        assert_eq!(state.sessions.len(), 1);
        assert_eq!(session.latest.total_tokens, 190);
        assert_eq!(session.latest.input_tokens, 100);
        assert_eq!(session.latest.cache_write_tokens, 10);
        assert_eq!(session.latest.reasoning_tokens, 5);
        assert_eq!(
            session.latest.file_path,
            rpc_dir.to_string_lossy().to_string()
        );
    }

    #[tokio::test]
    async fn test_get_antigravity_project_summary_uses_explicit_root_path() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let rpc_dir = root
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .join("sess-explicit-root");
        std::fs::create_dir_all(&rpc_dir).unwrap();
        std::fs::create_dir_all(root.join("brain").join("sess-explicit-root")).unwrap();

        let usage = r#"{"recordType":"usage","sessionId":"sess-explicit-root","sequence":0,"model":"gemini-3-pro-high","inputTokens":120,"outputTokens":80,"cacheReadTokens":40,"cacheWriteTokens":20,"reasoningTokens":10,"totalTokens":270,"raw":{"chatModel":{"chatStartMetadata":{"createdAt":"2026-04-12T00:00:00Z"}}}}"#;
        std::fs::write(rpc_dir.join("usage.jsonl"), format!("{usage}\n")).unwrap();

        let summary = get_antigravity_project_summary(Some(root.to_string_lossy().to_string()))
            .await
            .unwrap();

        assert_eq!(summary.session_count, 1);
        assert_eq!(summary.total_tokens, 270);
        assert_eq!(summary.sessions[0].session_id, "sess-explicit-root");
    }
}
