//! The transcript parsed once, with the lookups the API view needs.

use super::hashing::message_hash;
use super::MessageSource;
use serde_json::Value;
use std::collections::HashMap;

pub(super) struct ParsedLines {
    /// Index `i` is line `i + 1`; `None` for blank or malformed lines.
    values: Vec<Option<Value>>,
    uuid_index: HashMap<String, usize>,
}

/// Lines (0-based) of one assistant API message, in file order.
pub(super) struct AssistantTurn {
    pub message_id: String,
    pub lines: Vec<usize>,
}

impl ParsedLines {
    pub fn parse(text: &str) -> Self {
        let values: Vec<Option<Value>> = text
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).ok())
            .collect();
        let mut uuid_index = HashMap::new();
        for (i, value) in values.iter().enumerate() {
            if let Some(uuid) = value.as_ref().and_then(|v| str_field(v, "uuid")) {
                uuid_index.entry(uuid.to_string()).or_insert(i);
            }
        }
        Self { values, uuid_index }
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn get(&self, i: usize) -> Option<&Value> {
        self.values.get(i).and_then(Option::as_ref)
    }

    pub fn iter(&self) -> impl Iterator<Item = (usize, &Value)> {
        self.values
            .iter()
            .enumerate()
            .filter_map(|(i, v)| v.as_ref().map(|v| (i, v)))
    }

    pub fn line_type(&self, i: usize) -> Option<&str> {
        self.get(i).and_then(|v| str_field(v, "type"))
    }

    pub fn by_uuid(&self, uuid: &str) -> Option<usize> {
        self.uuid_index.get(uuid).copied()
    }

    /// Assistant lines grouped by `message.id`, in order of first appearance.
    pub fn assistant_turns(&self) -> Vec<AssistantTurn> {
        let mut turns: Vec<AssistantTurn> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        for (i, value) in self.iter() {
            if str_field(value, "type") != Some("assistant") {
                continue;
            }
            let Some(id) = value.pointer("/message/id").and_then(Value::as_str) else {
                continue;
            };
            if let Some(&t) = index.get(id) {
                turns[t].lines.push(i);
            } else {
                index.insert(id.to_string(), turns.len());
                turns.push(AssistantTurn {
                    message_id: id.to_string(),
                    lines: vec![i],
                });
            }
        }
        turns
    }

    /// Concatenated `message.content` blocks of the given lines.
    pub fn merged_content(&self, lines: &[usize]) -> Vec<Value> {
        lines
            .iter()
            .filter_map(|&i| self.get(i)?.pointer("/message/content")?.as_array())
            .flatten()
            .cloned()
            .collect()
    }

    /// Every message a `tail` hash can name: blobs, user lines and assistant
    /// turns, keyed by hash, with their role and content.
    pub fn hash_index(&self) -> HashMap<String, (String, Value, MessageSource)> {
        let mut index = HashMap::new();
        for (i, value) in self.iter() {
            match str_field(value, "type") {
                Some("api-request-blob") => {
                    if let (Some(hash), Some(message)) =
                        (str_field(value, "hash"), value.get("message"))
                    {
                        let role = str_field(message, "role").unwrap_or("user").to_string();
                        let content = message.get("content").cloned().unwrap_or(Value::Null);
                        index.insert(
                            hash.to_string(),
                            (role, content, MessageSource::Blob { line: i + 1 }),
                        );
                    }
                }
                Some("user") => {
                    if let Some(message) = value.get("message") {
                        let role = str_field(message, "role").unwrap_or("user").to_string();
                        let content = message.get("content").cloned().unwrap_or(Value::Null);
                        let source = MessageSource::Lines { lines: vec![i + 1] };
                        index
                            .entry(message_hash(&role, &content))
                            .or_insert((role, content, source));
                    }
                }
                _ => {}
            }
        }
        for turn in self.assistant_turns() {
            let content = Value::Array(self.merged_content(&turn.lines));
            let source = MessageSource::Lines {
                lines: turn.lines.iter().map(|i| i + 1).collect(),
            };
            index.entry(message_hash("assistant", &content)).or_insert((
                "assistant".to_string(),
                content,
                source,
            ));
        }
        index
    }
}

pub(super) fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}
