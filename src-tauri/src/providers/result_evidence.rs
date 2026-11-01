//! Source-owned evidence, attached before display merging; never an outcome verdict.
use serde_json::{json, Value};

/// Copy the producer value exactly; never manufacture a false flag for absence.
/// Viewer audit baseline 44644405 pi.rs:1090-1093, crush.rs:505, zed.rs:365.
pub(super) fn copy_error_flag(result: &mut Value, raw: &Value, key: &str) {
    if let Some(flag) = raw.get(key) {
        result["is_error"] = flag.clone();
    }
}

pub(super) fn attach(result: &mut Value, raw: &Value, uuid: &str, session: &str, index: usize) {
    result["toolUseResult"] = raw.clone();
    result["toolUseResultSource"] = json!({
        "messageUuid":uuid,"sessionId":session,"contentIndex":index,"association":"single_result"
    });
}

/// Match only the previous display shape, but return evidence with the message.
pub(super) fn content_matches(content: &Value, query: &str) -> bool {
    let Some(blocks) = content.as_array() else {
        return crate::utils::search_json_value_case_insensitive(content, query);
    };
    blocks.iter().any(|block| {
        if block.get("type").and_then(Value::as_str) == Some("tool_result") {
            block.as_object().is_some_and(|fields| {
                fields.iter().any(|(key, value)| {
                    !matches!(key.as_str(), "toolUseResult" | "toolUseResultSource")
                        && crate::utils::search_json_value_case_insensitive(value, query)
                })
            })
        } else {
            crate::utils::search_json_value_case_insensitive(block, query)
        }
    })
}
