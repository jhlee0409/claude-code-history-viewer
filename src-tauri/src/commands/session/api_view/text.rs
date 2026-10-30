//! Text of transcript lines and request messages, for previews and for
//! checking whether a line's text reached a request.

use super::lines::str_field;
use serde_json::Value;

const PREVIEW_CHARS: usize = 300;
const SNIPPET_CHARS: usize = 120;
const MIN_SNIPPET_CHARS: usize = 8;

/// The text a line contributes to the conversation, as best it can be told.
pub(super) fn line_text(value: &Value) -> String {
    match str_field(value, "type") {
        Some("attachment") => attachment_text(value),
        Some("user" | "assistant") => value
            .pointer("/message/content")
            .map(content_text)
            .unwrap_or_default(),
        Some("system" | "queue-operation") => {
            str_field(value, "content").unwrap_or_default().to_string()
        }
        _ => String::new(),
    }
}

fn attachment_text(value: &Value) -> String {
    if let Some(rendered) = value.get("rendered").and_then(Value::as_array) {
        let parts: Vec<String> = rendered
            .iter()
            .map(|r| r.get("content").map(content_text).unwrap_or_default())
            .filter(|s| !s.is_empty())
            .collect();
        if !parts.is_empty() {
            return parts.join("\n");
        }
    }
    let attachment = value.get("attachment").unwrap_or(&Value::Null);
    ["content", "stdout", "text", "prompt"]
        .iter()
        .find_map(|k| {
            attachment
                .get(*k)
                .map(content_text)
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_default()
}

/// Text of a message `content`: a string, or the text inside its blocks.
pub(super) fn content_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .map(block_text)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn block_text(block: &Value) -> String {
    for key in ["text", "thinking"] {
        if let Some(text) = str_field(block, key) {
            return text.to_string();
        }
    }
    match block.get("content") {
        Some(inner) => content_text(inner),
        None => block.get("input").map(Value::to_string).unwrap_or_default(),
    }
}

/// Every string in a value, joined; what a request's messages say.
pub(super) fn all_strings(value: &Value, out: &mut String) {
    match value {
        Value::String(s) => {
            out.push_str(s);
            out.push('\n');
        }
        Value::Array(items) => items.iter().for_each(|v| all_strings(v, out)),
        Value::Object(map) => map.values().for_each(|v| all_strings(v, out)),
        _ => {}
    }
}

/// A distinctive piece of `text` to look for: its longest line, trimmed and
/// cut short. `None` when the text is too short to tell anything.
pub(super) fn snippet(text: &str) -> Option<String> {
    let longest = text
        .lines()
        .map(str::trim)
        .max_by_key(|l| l.chars().count())?;
    if longest.chars().count() < MIN_SNIPPET_CHARS {
        return None;
    }
    Some(longest.chars().take(SNIPPET_CHARS).collect())
}

pub(super) fn preview(text: &str, value: &Value) -> String {
    let source = if text.trim().is_empty() {
        value.to_string()
    } else {
        text.to_string()
    };
    source.chars().take(PREVIEW_CHARS).collect()
}
