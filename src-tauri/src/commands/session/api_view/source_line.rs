//! Transcript lines as the request view shows them: what kind of line it
//! is, everything it says, and where its text landed in a request.

use super::lines::{str_field, ParsedLines};
use super::text::{all_strings, line_text, preview, snippet};
use super::{ApiRequest, SourceLine};
use serde_json::Value;

/// The text of each new message of a request, by message index.
pub(super) type MessageTexts = Vec<(usize, String)>;

pub(super) fn message_texts(request: &ApiRequest) -> MessageTexts {
    request
        .new_messages
        .iter()
        .map(|message| {
            let mut out = String::new();
            all_strings(&message.content, &mut out);
            (message.index, out)
        })
        .collect()
}

/// The first message whose text contains `needle`.
pub(super) fn locate(texts: &MessageTexts, needle: &str) -> Option<usize> {
    texts
        .iter()
        .find(|(_, text)| text.contains(needle))
        .map(|(index, _)| *index)
}

/// Line `i` as shown inside a request whose messages say `texts`, or as a
/// line outside every request when `texts` is `None`.
pub(super) fn source_line(
    parsed: &ParsedLines,
    i: usize,
    texts: Option<&MessageTexts>,
) -> SourceLine {
    let value = parsed.get(i).unwrap_or(&Value::Null);
    let text = line_text(value);
    let content = content(value, &text);
    // A request without recorded messages (an inferred one) cannot be checked.
    let checked = texts.filter(|t| !t.is_empty());
    let found_in = checked.and_then(|t| snippet(&text).and_then(|needle| locate(t, &needle)));
    let in_request = checked.and_then(|_| snippet(&text).map(|_| found_in.is_some()));
    SourceLine {
        line: i + 1,
        uuid: str_field(value, "uuid").map(str::to_string),
        kind: kind(value),
        label: label(value),
        timestamp: str_field(value, "timestamp").map(str::to_string),
        preview: preview(&text, value),
        record: matches!(content, Content::Record),
        content: content.into_value(value),
        tool_use_id: tool_use_id(value),
        in_request,
        found_in,
    }
}

/// `type`, refined by what the line is: a tool result, a meta or compact
/// summary line, an attachment type, a subtype or a queue operation.
fn kind(value: &Value) -> String {
    let base = str_field(value, "type").unwrap_or("unknown");
    let detail = match base {
        "user" => user_kind(value),
        _ => value
            .pointer("/attachment/type")
            .and_then(Value::as_str)
            .or_else(|| str_field(value, "subtype"))
            .or_else(|| str_field(value, "operation")),
    };
    match detail {
        Some(detail) => format!("{base}:{detail}"),
        None => base.to_string(),
    }
}

fn user_kind(value: &Value) -> Option<&'static str> {
    if tool_results(value).next().is_some() {
        Some("tool_result")
    } else if value.get("isCompactSummary").and_then(Value::as_bool) == Some(true) {
        Some("compact")
    } else if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
        Some("meta")
    } else {
        None
    }
}

fn tool_results(value: &Value) -> impl Iterator<Item = &Value> {
    value
        .pointer("/message/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|b| str_field(b, "type") == Some("tool_result"))
}

fn label(value: &Value) -> Option<String> {
    if tool_results(value).any(|b| b.get("is_error").and_then(Value::as_bool) == Some(true)) {
        return Some("error".to_string());
    }
    let attachment = value.get("attachment")?;
    str_field(attachment, "hookName")
        .or_else(|| str_field(attachment, "hookEvent"))
        .map(str::to_string)
}

/// The tool call a line belongs to: the call a tool result answers, or the
/// call a hook ran around.
fn tool_use_id(value: &Value) -> Option<String> {
    tool_results(value)
        .find_map(|b| str_field(b, "tool_use_id"))
        .or_else(|| {
            value
                .pointer("/attachment/toolUseID")
                .and_then(Value::as_str)
        })
        .map(str::to_string)
}

/// Everything the line says, in full: a message's content, the text an
/// attachment or system line put into the context, or, when it put none,
/// the whole record.
enum Content {
    Value(Value),
    Record,
}

impl Content {
    fn into_value(self, record: &Value) -> Value {
        match self {
            Self::Value(value) => value,
            Self::Record => record.clone(),
        }
    }
}

fn content(value: &Value, text: &str) -> Content {
    match str_field(value, "type") {
        Some("user" | "assistant") => Content::Value(
            value
                .pointer("/message/content")
                .cloned()
                .unwrap_or(Value::Null),
        ),
        Some("attachment" | "system" | "queue-operation") if !text.is_empty() => {
            Content::Value(Value::String(text.to_string()))
        }
        _ => Content::Record,
    }
}
