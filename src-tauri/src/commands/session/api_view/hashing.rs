//! Message hashes as Claude Code computes them for `tail`: SHA-256 of the
//! message's JSON with sorted keys and no whitespace.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt::Write;

/// Hash an API message (`{"role", "content"}`).
pub(super) fn message_hash(role: &str, content: &Value) -> String {
    let mut map = serde_json::Map::new();
    map.insert("role".into(), Value::String(role.into()));
    map.insert("content".into(), content.clone());
    let mut out = String::new();
    write_canonical(&Value::Object(map), &mut out);
    hex(&Sha256::digest(out.as_bytes()))
}

/// Compact JSON with object keys sorted, independent of the map's order
/// (`serde_json` may be built with `preserve_order`).
fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                write_canonical(&map[key], out);
            }
            out.push('}');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}
