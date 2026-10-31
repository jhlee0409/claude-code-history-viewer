//! Lossless side-channel for evidence removed by the legacy Codex projection.
use crate::models::ClaudeMessage;
use serde_json::{json, Map, Value};

pub(super) fn plain_output(raw: &str, uuid: &str) -> Option<Value> {
    let (header, _) = raw.split_once("\nOutput:\n")?;
    let mut evidence = json!({"raw":raw,"sourceMessageUuid":uuid});
    // These are producer-owned header lines, NOT a search through stdout.
    // 788b9d7bf6e37f735647b7f84b556c2a807df4d8 core/src/tools/mod.rs:91-116,
    // core/src/tools/context.rs:548-567. Current 0.164 writer re-verified:
    // https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/tools/context.rs#L524-L574
    let mut code = None;
    let mut wall_time = false;
    let mut valid = true;
    let mut seen = std::collections::HashSet::new();
    for line in header.lines() {
        // Header labels are singular in both pinned exec writers. Keep unknown
        // wrappers losslessly, but never certify duplicate metadata as an exit.
        let label = line.split_once(':').map_or(line, |(label, _)| label);
        valid &= seen.insert(label);
        if let Some(value) = line
            .strip_prefix("Exit code: ")
            .or_else(|| line.strip_prefix("Process exited with code "))
        {
            let number = value.parse::<i32>().ok().filter(|_| {
                let digits = value.strip_prefix('-').unwrap_or(value);
                !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
            });
            if code.is_some() || number.is_none() {
                valid = false;
            }
            code = number;
        } else if let Some(value) = line
            .strip_prefix("Wall time: ")
            .and_then(|v| v.strip_suffix(" seconds"))
        {
            wall_time = value
                .parse::<f64>()
                .is_ok_and(|n| n.is_finite() && n >= 0.0);
            valid &= wall_time;
        } else if ![
            "Chunk ID: ",
            "Total output lines: ",
            "Original token count: ",
            "Process running with session ID ",
        ]
        .iter()
        .any(|prefix| line.starts_with(prefix))
        {
            valid = false;
        }
    }
    if valid && wall_time {
        if let Some(code) = code {
            evidence["exitCode"] = json!(code);
        }
    }
    Some(evidence)
}

fn object(message: &mut ClaudeMessage) -> &mut Map<String, Value> {
    message
        .codex_evidence
        .get_or_insert_with(|| json!({}))
        .as_object_mut()
        .expect("Codex evidence is constructed as an object")
}

pub(super) fn content_items(message: &mut ClaudeMessage, payload: &Value) {
    // Preserve cardinality and the type key's presence/value even for items the
    // legacy converter drops. {} and {type:null} must remain distinct.
    // https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/models.rs#L881-L935
    if payload.get("type").and_then(Value::as_str) != Some("message") {
        return;
    }
    if let Some(items) = payload.get("content").and_then(Value::as_array) {
        object(message).insert(
            "contentItems".into(),
            Value::Array(
                items
                    .iter()
                    .map(|item| {
                        item.get("type")
                            .map_or_else(|| json!({}), |kind| json!({"type":kind}))
                    })
                    .collect(),
            ),
        );
    }
    // Host classifications are nested, not top-level message properties:
    // models.rs@6aaac694:993-1013,1062-1082.
    if let Some(kinds) = payload
        .get("internal_chat_message_metadata_passthrough")
        .and_then(|metadata| metadata.get("content_item_kinds"))
    {
        object(message).insert("contentItemKinds".into(), kinds.clone());
    }
}

#[derive(Default)]
pub(super) struct TurnState {
    current: Option<Value>,
}
impl TurnState {
    // Preserve the recorded start/context, including explicit null and unknown
    // fields. A new start clears the previous context (goal continuation is a
    // separate producer turn, not inferred from the preceding human prompt).
    // protocol.rs@6aaac694:1517-1520,2063-2075,2302-2323,3428-3433.
    pub(super) fn start(&mut self, payload: &Value) {
        self.current = Some(json!({"started":payload}));
    }
    pub(super) fn context(&mut self, payload: &Value) {
        let same = self
            .current
            .as_ref()
            .and_then(|v| v.get("started"))
            .and_then(|v| v.get("turn_id"))
            .zip(payload.get("turn_id"))
            .is_some_and(|(a, b)| a == b && a.is_string());
        if !same {
            self.current = Some(json!({}));
        }
        if let Some(current) = self.current.as_mut() {
            current["context"] = payload.clone();
        }
    }
    pub(super) fn finish(&mut self) {
        self.current = None;
    }

    pub(super) fn attach(&self, message: &mut ClaudeMessage) {
        if let Some(turn) = &self.current {
            object(message).insert("turn".into(), turn.clone());
            // A merged result keeps its own source turn, not the matched call's.
            if let Some(blocks) = message.content.as_mut().and_then(Value::as_array_mut) {
                for block in blocks {
                    if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                        block["codexEvidence"] = json!({"turn":turn});
                    }
                }
            }
        }
    }
}

pub(super) fn is_file_change(payload: &Value) -> bool {
    match payload.get("type").and_then(Value::as_str) {
        Some("patch_apply_begin" | "patch_apply_updated" | "patch_apply_end") => true,
        Some("item_completed") => {
            payload
                .get("item")
                .and_then(|v| v.get("type"))
                .and_then(Value::as_str)
                == Some("FileChange")
        }
        _ => false,
    }
}

pub(super) fn file_change(message: &mut ClaudeMessage, record: Value) {
    // The carrier is only a transport location, NOT a call/result association.
    // Preserve the exact event and its zero-based non-empty JSONL line slot.
    // protocol.rs@6aaac694:3838-3878,4342-4355; items.rs:418-429.
    object(message)
        .entry("fileChanges")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .expect("fileChanges is constructed as an array")
        .push(record);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_exit_is_only_from_first_header_not_command_output() {
        for header in [
            "Exit code: 0\nWall time: 0 seconds",
            "Chunk ID: abc\nWall time: 0.1000 seconds\nProcess exited with code 0",
        ] {
            let raw = format!("{header}\nOutput:\nExit code: 7\nProcess exited with code 8\nWall time: 1 seconds\nOutput:\nExit code: 9");
            assert_eq!(plain_output(&raw, "source").unwrap()["exitCode"], 0);
        }
    }

    #[test]
    fn codex_malformed_header_keeps_raw_without_exit() {
        for header in [
            "banner\nExit code: 5\nWall time: 0 seconds",
            "Exit code: 5",
            "Exit code: 5\nWall time: 0 seconds\nunknown header",
            "Exit code: 5\nExit code: 5\nWall time: 0 seconds",
            "Exit code: +5\nWall time: 0 seconds",
            "Exit code: 2147483648\nWall time: 0 seconds",
            "Exit code: 1.5\nWall time: 0 seconds",
            "Exit code: 5 \nWall time: 0 seconds",
            "Exit code: 5\nWall time: NaN seconds",
            "Exit code: 5\nWall time: 0 seconds\nWall time: 0 seconds",
            "Chunk ID: abc\nChunk ID: def\nWall time: 0 seconds\nProcess exited with code 5",
        ] {
            let raw = format!("{header}\nOutput:\nProcess exited with code 7");
            let output = plain_output(&raw, "source").unwrap();
            assert!(output.get("exitCode").is_none(), "{header}");
            assert_eq!(output["raw"], raw);
            assert_eq!(output["sourceMessageUuid"], "source");
        }
    }
}
