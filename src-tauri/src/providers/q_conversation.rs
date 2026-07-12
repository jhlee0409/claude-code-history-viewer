//! Shared `ConversationState` → message conversion for the Amazon Q CLI lineage.
//!
//! Amazon Q CLI (`amazon-q/data.sqlite3`, table `conversations`) and its
//! rebrand Kiro CLI (`kiro-cli/data.sqlite3`, table `conversations_v2`) store
//! the **same** serialized `ConversationState` in their `value` column — only
//! the surrounding table/row layout differs. This module owns the value→message
//! conversion both providers share; it's parameterized by `provider` so each
//! tags its own id.
//!
//! `value` JSON: `{ "history": [ { "user": {...}, "assistant": {...} }, ... ] }`
//! with externally-tagged enums:
//! - `user.content`: `Prompt{prompt}` | `ToolUseResults{tool_use_results}` |
//!   `CancelledToolUses{prompt?, tool_use_results}`
//! - `assistant`: `Response{message_id?, content}` |
//!   `ToolUse{message_id?, content, tool_uses[]{id,name,args}}`

use crate::models::ClaudeMessage;
use crate::utils::build_provider_message;
use serde_json::{json, Value};

/// Parse a `ConversationState` `value` JSON string into messages, in order.
pub(crate) fn parse_history(
    provider: &str,
    value_json: &str,
    session_id: &str,
) -> Vec<ClaudeMessage> {
    let Ok(json) = serde_json::from_str::<Value>(value_json) else {
        return Vec::new();
    };
    let Some(history) = json.get("history").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut messages = Vec::new();
    for (i, entry) in history.iter().enumerate() {
        if let Some(user) = entry.get("user") {
            if let Some(msg) = convert_user_message(provider, user, session_id, i) {
                messages.push(msg);
            }
        }
        if let Some(assistant) = entry.get("assistant") {
            if let Some(msg) = convert_assistant_message(provider, assistant, session_id, i) {
                messages.push(msg);
            }
        }
    }
    messages
}

/// The (first, last) user-turn ISO timestamps in a history, if any. Amazon Q's
/// v1 `conversations` table has no `created_at`/`updated_at` columns, so session
/// times are derived from these. `last` falls back to `first` for single-turn
/// conversations.
pub(crate) fn history_time_bounds(value_json: &str) -> (Option<String>, Option<String>) {
    let Ok(json) = serde_json::from_str::<Value>(value_json) else {
        return (None, None);
    };
    let Some(history) = json.get("history").and_then(Value::as_array) else {
        return (None, None);
    };
    let mut times = history
        .iter()
        .filter_map(|e| {
            e.get("user")
                .and_then(|u| u.get("timestamp"))
                .and_then(Value::as_str)
        })
        .filter(|s| !s.is_empty());
    let first = times.next().map(str::to_string);
    // next_back() (not last()) avoids re-walking the whole iterator; gives the
    // last remaining timestamp, falling back to `first` for single-turn chats.
    let last = times
        .next_back()
        .map(str::to_string)
        .or_else(|| first.clone());
    (first, last)
}

/// Build a short session summary from the first user prompt in the history.
pub(crate) fn first_prompt_summary(value_json: &str, max_chars: usize) -> Option<String> {
    let json = serde_json::from_str::<Value>(value_json).ok()?;
    let history = json.get("history").and_then(Value::as_array)?;
    history.iter().find_map(|e| {
        e.get("user")?
            .get("content")?
            .get("Prompt")?
            .get("prompt")?
            .as_str()
            .map(|s| s.chars().take(max_chars).collect::<String>())
    })
}

/// Number of renderable messages a history would produce (user + assistant).
pub(crate) fn message_count(value_json: &str) -> usize {
    parse_history("", value_json, "count").len()
}

pub(crate) fn convert_user_message(
    provider: &str,
    user: &Value,
    session_id: &str,
    idx: usize,
) -> Option<ClaudeMessage> {
    let timestamp = user
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let content_obj = user.get("content")?;
    let mut blocks: Vec<Value> = Vec::new();

    if let Some(prompt) = content_obj.get("Prompt") {
        if let Some(text) = prompt.get("prompt").and_then(Value::as_str) {
            if !text.is_empty() {
                blocks.push(json!({"type": "text", "text": text}));
            }
        }
    } else if let Some(tool_results) = content_obj.get("ToolUseResults") {
        push_tool_results(&mut blocks, tool_results);
    } else if let Some(cancelled) = content_obj.get("CancelledToolUses") {
        // A cancelled turn may carry a prompt plus the partial tool results.
        if let Some(text) = cancelled.get("prompt").and_then(Value::as_str) {
            if !text.is_empty() {
                blocks.push(json!({"type": "text", "text": text}));
            }
        }
        push_tool_results(&mut blocks, cancelled);
    }

    if blocks.is_empty() {
        return None;
    }

    Some(build_provider_message(
        provider,
        format!("{session_id}-user-{idx}"),
        session_id,
        timestamp,
        "user",
        Some("user"),
        Some(Value::Array(blocks)),
        None,
    ))
}

/// Append `tool_result` blocks from an object holding `tool_use_results[]`.
fn push_tool_results(blocks: &mut Vec<Value>, holder: &Value) {
    let Some(results) = holder.get("tool_use_results").and_then(Value::as_array) else {
        return;
    };
    for tr in results {
        let tool_use_id = tr.get("tool_use_id").and_then(Value::as_str).unwrap_or("");
        let text = tr
            .get("content")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|c| c.get("Text").and_then(Value::as_str))
            .unwrap_or("");
        blocks.push(json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": text
        }));
    }
}

pub(crate) fn convert_assistant_message(
    provider: &str,
    assistant: &Value,
    session_id: &str,
    idx: usize,
) -> Option<ClaudeMessage> {
    let mut blocks: Vec<Value> = Vec::new();

    if let Some(response) = assistant.get("Response") {
        let text = response
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !text.is_empty() {
            blocks.push(json!({"type": "text", "text": text}));
        }
    } else if let Some(tool_use) = assistant.get("ToolUse") {
        let text = tool_use
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !text.is_empty() {
            blocks.push(json!({"type": "text", "text": text}));
        }
        if let Some(tools) = tool_use.get("tool_uses").and_then(Value::as_array) {
            for tool in tools {
                let id = tool.get("id").and_then(Value::as_str).unwrap_or("");
                let name = tool
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let args = tool
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::default()));
                blocks.push(json!({
                    "type": "tool_use",
                    "id": id,
                    "name": map_tool_name(name),
                    "input": args
                }));
            }
        }
    }

    if blocks.is_empty() {
        return None;
    }

    let msg_id = assistant
        .get("Response")
        .or_else(|| assistant.get("ToolUse"))
        .and_then(|v| v.get("message_id"))
        .and_then(Value::as_str)
        .unwrap_or("");

    Some(build_provider_message(
        provider,
        if msg_id.is_empty() {
            format!("{session_id}-asst-{idx}")
        } else {
            msg_id.to_string()
        },
        session_id,
        String::new(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(blocks)),
        None,
    ))
}

/// Map Amazon Q / Kiro tool names to the canonical names the viewer renders.
fn map_tool_name(name: &str) -> &str {
    match name {
        "execute_bash" => "Bash",
        "read_file" | "file_read" => "Read",
        "write_file" | "file_write" | "create_file" => "Write",
        "list_directory" => "Glob",
        "search_files" | "grep" => "Grep",
        "web_search" => "WebSearch",
        "web_fetch" => "WebFetch",
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convert_user_prompt() {
        let user = json!({
            "content": {"Prompt": {"prompt": "hello world"}},
            "timestamp": "2025-10-08T10:50:49.220865-07:00"
        });
        let msg = convert_user_message("amazonq", &user, "sess-1", 0).unwrap();
        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.provider.as_deref(), Some("amazonq"));
        assert_eq!(msg.uuid, "sess-1-user-0");
    }

    #[test]
    fn convert_assistant_response() {
        let asst = json!({"Response": {"message_id": "abc", "content": "Hello!"}});
        let msg = convert_assistant_message("kiro", &asst, "sess-1", 0).unwrap();
        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.provider.as_deref(), Some("kiro"));
        assert_eq!(msg.uuid, "abc"); // message_id wins over the synthetic id
        let arr = msg.content.unwrap();
        assert_eq!(arr[0]["text"], "Hello!");
    }

    #[test]
    fn convert_assistant_tool_use_maps_name() {
        let asst = json!({
            "ToolUse": {
                "message_id": "xyz",
                "content": "Let me run that",
                "tool_uses": [{"id": "t1", "name": "execute_bash", "args": {"command": "ls"}}]
            }
        });
        let msg = convert_assistant_message("amazonq", &asst, "sess-1", 1).unwrap();
        let arr = msg.content.unwrap().as_array().unwrap().clone();
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[1]["type"], "tool_use");
        assert_eq!(arr[1]["name"], "Bash");
    }

    #[test]
    fn convert_user_tool_results() {
        let user = json!({
            "content": {"ToolUseResults": {"tool_use_results": [
                {"tool_use_id": "t1", "content": [{"Text": "output here"}]}
            ]}},
            "timestamp": "2025-10-08T10:51:00-07:00"
        });
        let msg = convert_user_message("amazonq", &user, "sess-1", 1).unwrap();
        let arr = msg.content.unwrap().as_array().unwrap().clone();
        assert_eq!(arr[0]["type"], "tool_result");
        assert_eq!(arr[0]["tool_use_id"], "t1");
        assert_eq!(arr[0]["content"], "output here");
    }

    #[test]
    fn convert_cancelled_tool_uses_prompt_and_results() {
        let user = json!({
            "content": {"CancelledToolUses": {
                "prompt": "stop",
                "tool_use_results": [{"tool_use_id": "t9", "content": [{"Text": "partial"}]}]
            }},
            "timestamp": ""
        });
        let msg = convert_user_message("amazonq", &user, "s", 0).unwrap();
        let arr = msg.content.unwrap().as_array().unwrap().clone();
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "stop");
        assert_eq!(arr[1]["type"], "tool_result");
        assert_eq!(arr[1]["tool_use_id"], "t9");
    }

    #[test]
    fn parse_history_walks_user_and_assistant() {
        let value = json!({
            "history": [
                {
                    "user": {"content": {"Prompt": {"prompt": "hi"}}, "timestamp": "2025-10-08T10:00:00Z"},
                    "assistant": {"Response": {"message_id": "m1", "content": "hello"}}
                }
            ]
        })
        .to_string();
        let msgs = parse_history("amazonq", &value, "sess-1");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[1].role.as_deref(), Some("assistant"));
        assert_eq!(message_count(&value), 2);
        let (first, last) = history_time_bounds(&value);
        assert_eq!(first.as_deref(), Some("2025-10-08T10:00:00Z"));
        assert_eq!(last.as_deref(), Some("2025-10-08T10:00:00Z")); // single turn -> last = first
        assert_eq!(first_prompt_summary(&value, 80).as_deref(), Some("hi"));
    }

    #[test]
    fn map_tool_names() {
        assert_eq!(map_tool_name("execute_bash"), "Bash");
        assert_eq!(map_tool_name("read_file"), "Read");
        assert_eq!(map_tool_name("unknown_thing"), "unknown_thing");
    }
}
