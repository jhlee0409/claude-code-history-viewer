//! Headless session export (issue #343).
//!
//! Renders a session's messages to a standalone HTML report (or raw JSON) without
//! launching the GUI. The HTML rendering is a faithful Rust port of the frontend
//! exporters (`src/services/export/contentExtractor.ts` and `htmlExporter.ts`) so
//! that `--export … --format html` matches the in-app "Export HTML" output.
//!
//! Messages are read from the raw JSONL on disk, where each line is one message
//! object with top-level `type`/`timestamp`/`isSidechain` and the conversation
//! payload nested under `message.{content,model,usage}`.

use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

// ---------------------------------------------------------------------------
// Block extraction — port of contentExtractor.ts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Text,
    Thinking,
    Tool,
    Result,
    Media,
    Search,
    Code,
}

struct ExtractedBlock {
    kind: BlockKind,
    text: String,
}

/// Truncate to at most `max` characters (char-safe), appending `...` when cut.
fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() > max {
        let head: String = text.chars().take(max).collect();
        format!("{head}...")
    } else {
        text.to_string()
    }
}

/// Summarize a tool `input` object into a `key: value, …` one-liner, mirroring
/// `summarizeInput` (strings truncated to 120 chars; only string/bool/number values).
fn summarize_input(input: &serde_json::Map<String, Value>) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (key, val) in input {
        match val {
            Value::String(s) => {
                let truncated = if s.chars().count() > 120 {
                    let head: String = s.chars().take(120).collect();
                    format!("{head}...")
                } else {
                    s.clone()
                };
                parts.push(format!("{key}: {truncated}"));
            }
            Value::Bool(b) => parts.push(format!("{key}: {b}")),
            Value::Number(n) => parts.push(format!("{key}: {n}")),
            _ => {}
        }
    }
    parts.join(", ")
}

/// Read `obj.content[key]` when `content` is a nested object (port of `nested`).
fn nested<'a>(obj: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a Value> {
    obj.get("content")
        .and_then(|c| c.as_object())
        .and_then(|c| c.get(key))
}

fn str_field<'a>(obj: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    obj.get(key).and_then(|v| v.as_str())
}

fn summarized_call(obj: &serde_json::Map<String, Value>, name: &str) -> String {
    let input = obj
        .get("input")
        .and_then(|v| v.as_object())
        .map(summarize_input)
        .unwrap_or_default();
    if input.is_empty() {
        name.to_string()
    } else {
        format!("{name}({input})")
    }
}

/// Flatten a message's `content` into readable blocks. Mirrors `extractBlocks`.
fn extract_blocks(content: &Value) -> Vec<ExtractedBlock> {
    let items = match content {
        Value::String(s) => {
            return vec![ExtractedBlock {
                kind: BlockKind::Text,
                text: s.clone(),
            }]
        }
        Value::Array(items) => items,
        // null, or any non-array object → no blocks
        _ => return Vec::new(),
    };

    let mut blocks: Vec<ExtractedBlock> = Vec::new();

    for item in items {
        let obj = match item.as_object() {
            Some(o) => o,
            None => continue,
        };
        let typ = match obj.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        match typ {
            "text" => {
                if let Some(t) = str_field(obj, "text") {
                    blocks.push(ExtractedBlock {
                        kind: BlockKind::Text,
                        text: t.to_string(),
                    });
                }
            }
            "thinking" => {
                if let Some(t) = str_field(obj, "thinking") {
                    blocks.push(ExtractedBlock {
                        kind: BlockKind::Thinking,
                        text: t.to_string(),
                    });
                }
            }
            "redacted_thinking" => blocks.push(ExtractedBlock {
                kind: BlockKind::Thinking,
                text: "[Redacted thinking]".to_string(),
            }),
            "tool_use" => {
                if let Some(name) = str_field(obj, "name") {
                    blocks.push(ExtractedBlock {
                        kind: BlockKind::Tool,
                        text: summarized_call(obj, name),
                    });
                }
            }
            "tool_result" => {
                if obj.contains_key("content") {
                    let prefix = if obj.get("is_error") == Some(&Value::Bool(true)) {
                        "[Error] "
                    } else {
                        ""
                    };
                    match obj.get("content") {
                        Some(Value::String(c)) => blocks.push(ExtractedBlock {
                            kind: BlockKind::Result,
                            text: format!("{prefix}{}", truncate(c, 500)),
                        }),
                        _ => blocks.push(ExtractedBlock {
                            kind: BlockKind::Result,
                            text: format!("{prefix}[Tool result]"),
                        }),
                    }
                }
            }
            "server_tool_use" => {
                if let Some(name) = str_field(obj, "name") {
                    blocks.push(ExtractedBlock {
                        kind: BlockKind::Tool,
                        text: format!("[Server: {}]", summarized_call(obj, name)),
                    });
                }
            }
            "web_search_tool_result" => {
                let text = match obj.get("content") {
                    Some(Value::Array(arr)) => {
                        let urls: Vec<&str> = arr
                            .iter()
                            .take(5)
                            .filter_map(|r| r.as_object())
                            .filter_map(|r| {
                                r.get("title")
                                    .and_then(|v| v.as_str())
                                    .or_else(|| r.get("url").and_then(|v| v.as_str()))
                            })
                            .collect();
                        if urls.is_empty() {
                            "[Web search results]".to_string()
                        } else {
                            format!("[Web search: {}]", urls.join(", "))
                        }
                    }
                    _ => "[Web search results]".to_string(),
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Search,
                    text,
                });
            }
            "web_fetch_tool_result" => {
                let url = obj
                    .get("content")
                    .and_then(|c| c.as_object())
                    .and_then(|c| c.get("url"))
                    .and_then(|v| v.as_str());
                let text = match url {
                    Some(u) => format!("[Web fetch: {u}]"),
                    None => "[Web fetch result]".to_string(),
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Search,
                    text,
                });
            }
            "code_execution_tool_result" | "bash_code_execution_tool_result" => {
                let stdout = nested(obj, "stdout")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                let stderr = nested(obj, "stderr")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                let mut lines: Vec<String> = Vec::new();
                if let Some(out) = stdout {
                    lines.push(truncate(out, 300));
                }
                if let Some(err) = stderr {
                    lines.push(format!("[stderr] {}", truncate(err, 200)));
                }
                let text = if lines.is_empty() {
                    format!("[{typ}]")
                } else {
                    lines.join("\n")
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Code,
                    text,
                });
            }
            "text_editor_code_execution_tool_result" => {
                let op = nested(obj, "operation")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let path = nested(obj, "path").and_then(|v| v.as_str()).unwrap_or("");
                let text = if path.is_empty() {
                    format!("[File {op}]")
                } else {
                    format!("[File {op}: {path}]")
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Code,
                    text,
                });
            }
            "tool_search_tool_result" => blocks.push(ExtractedBlock {
                kind: BlockKind::Result,
                text: "[Tool search result]".to_string(),
            }),
            "image" => blocks.push(ExtractedBlock {
                kind: BlockKind::Media,
                text: "[Image]".to_string(),
            }),
            "document" => {
                let text = match str_field(obj, "title") {
                    Some(t) => format!("[Document: {t}]"),
                    None => "[Document]".to_string(),
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Media,
                    text,
                });
            }
            "search_result" => {
                let text = match str_field(obj, "title") {
                    Some(t) => format!("[Search: {t}]"),
                    None => "[Search result]".to_string(),
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Search,
                    text,
                });
            }
            "mcp_tool_use" => {
                let server = str_field(obj, "server_name").unwrap_or("");
                let tool = str_field(obj, "tool_name").unwrap_or("");
                let name = if !server.is_empty() && !tool.is_empty() {
                    format!("{server}.{tool}")
                } else if !tool.is_empty() {
                    tool.to_string()
                } else if !server.is_empty() {
                    server.to_string()
                } else {
                    "unknown".to_string()
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Tool,
                    text: format!("[MCP: {}]", summarized_call(obj, &name)),
                });
            }
            "mcp_tool_result" => {
                let prefix = if obj.get("is_error") == Some(&Value::Bool(true)) {
                    "[Error] "
                } else {
                    ""
                };
                let text = match obj.get("content") {
                    Some(Value::String(c)) => format!("{prefix}{}", truncate(c, 500)),
                    Some(Value::Object(c)) => match c.get("text").and_then(|v| v.as_str()) {
                        Some(t) => format!("{prefix}{}", truncate(t, 500)),
                        None => format!("{prefix}[MCP result]"),
                    },
                    _ => format!("{prefix}[MCP result]"),
                };
                blocks.push(ExtractedBlock {
                    kind: BlockKind::Result,
                    text,
                });
            }
            other => blocks.push(ExtractedBlock {
                kind: BlockKind::Text,
                text: format!("[{other}]"),
            }),
        }
    }

    blocks
}

/// Mirror of `isExportable`: drop sidechains and non-conversation message types.
fn is_exportable(msg: &Value) -> bool {
    if msg
        .get("isSidechain")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return false;
    }
    let typ = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    !matches!(
        typ,
        "system" | "summary" | "progress" | "queue-operation" | "file-history-snapshot"
    )
}

// ---------------------------------------------------------------------------
// HTML rendering — port of htmlExporter.ts
// ---------------------------------------------------------------------------

/// Inline stylesheet, kept byte-for-byte in sync with `htmlExporter.ts`'s `CSS`.
const CSS: &str = r"body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #fff; color: #1a1a1a; line-height: 1.6; }
h1 { border-bottom: 2px solid #e5e5e5; padding-bottom: 0.5rem; }
.meta { color: #6b7280; font-size: 0.85em; margin-bottom: 1.5rem; }
.meta span { margin-right: 1.5rem; }
.message { border-bottom: 1px solid #e5e5e5; padding: 1rem 0; }
.role { font-weight: 700; }
.role.user { color: #2563eb; }
.role.assistant { color: #059669; }
.model { color: #9ca3af; font-size: 0.8em; margin-left: 0.5rem; }
.timestamp { color: #9ca3af; font-size: 0.85em; margin-left: 0.5rem; }
.content { margin-top: 0.5rem; word-wrap: break-word; }
.content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 0.75rem 0 0.25rem; font-size: 1.1em; }
.content h1 { font-size: 1.3em; } .content h2 { font-size: 1.15em; }
.content p { margin: 0.4rem 0; }
.content ul, .content ol { margin: 0.4rem 0; padding-left: 1.5rem; }
.content li { margin: 0.15rem 0; }
.content code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.9em; }
.content pre { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 0.5rem 0; }
.content pre code { background: none; padding: 0; color: inherit; }
.content blockquote { margin: 0.5rem 0; padding: 0.5rem 1rem; border-left: 3px solid #d1d5db; background: #f9fafb; color: #4b5563; }
.content blockquote p { margin: 0.2rem 0; }
.content a { color: #2563eb; text-decoration: underline; }
.content hr { border: none; border-top: 1px solid #e5e5e5; margin: 0.75rem 0; }
.content img { max-width: 100%; height: auto; border-radius: 4px; margin: 0.5rem 0; }
.content table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.9em; }
.content th, .content td { border: 1px solid #d1d5db; padding: 0.4rem 0.75rem; text-align: left; }
.content th { background: #f3f4f6; font-weight: 600; }
.content tr:nth-child(even) { background: #f9fafb; }
.tool { background: #f3f4f6; border-left: 3px solid #6366f1; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, monospace; }
.result { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.9em; white-space: pre-wrap; }
.thinking { color: #6b7280; font-style: italic; }
.code-block { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 4px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.9em; margin: 0.5rem 0; white-space: pre-wrap; }
.search { color: #6366f1; font-size: 0.9em; }
.media { color: #9ca3af; font-style: italic; }
.usage { color: #9ca3af; font-size: 0.8em; margin-top: 0.5rem; }
pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.9em; }
details { margin: 0.5rem 0; }
summary { cursor: pointer; color: #6b7280; font-style: italic; }
@media print { body { max-width: 100%; padding: 1rem; } .message { page-break-inside: avoid; } }";

/// Escape the four HTML-significant characters (matches `escapeHtml`; single
/// quotes are intentionally left as-is, as in the TS source).
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Group an integer with thousands separators (approximates `toLocaleString`).
fn group_thousands(n: i64) -> String {
    let neg = n < 0;
    let digits = n.unsigned_abs().to_string();
    let bytes = digits.as_bytes();
    let mut out = String::new();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*b as char);
    }
    if neg {
        format!("-{out}")
    } else {
        out
    }
}

/// Render local date/time as `(YYYY-MM-DD, HH:MM:SS)`. On parse failure both
/// fields fall back to the raw string (matching the TS `NaN` branch).
fn format_timestamp(ts: &str) -> (String, String) {
    match chrono::DateTime::parse_from_rfc3339(ts) {
        Ok(dt) => {
            let local = dt.with_timezone(&chrono::Local);
            (
                local.format("%Y-%m-%d").to_string(),
                local.format("%H:%M:%S").to_string(),
            )
        }
        Err(_) => (ts.to_string(), ts.to_string()),
    }
}

/// Render markdown to HTML. comrak with `unsafe_ = false` (the default) drops raw
/// HTML rather than emitting it, so injected markup never executes. (The TS
/// exporter escapes raw HTML to visible text instead; both are safe — the input
/// is trusted conversation data and raw HTML in message text is rare.)
fn render_markdown(text: &str) -> String {
    let mut options = comrak::Options::default();
    options.render.hardbreaks = true; // matches marked({ breaks: true })
    options.extension.autolink = true;
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    comrak::markdown_to_html(text, &options)
}

fn block_to_html(block: &ExtractedBlock) -> String {
    let escaped = escape_html(&block.text);
    match block.kind {
        BlockKind::Thinking => {
            format!("<details><summary class=\"thinking\">Thinking</summary><p class=\"thinking\">{escaped}</p></details>")
        }
        BlockKind::Tool => format!("<div class=\"tool\">{escaped}</div>"),
        BlockKind::Result => format!("<div class=\"result\">{escaped}</div>"),
        BlockKind::Code => format!("<div class=\"code-block\">{escaped}</div>"),
        BlockKind::Search => format!("<p class=\"search\">{escaped}</p>"),
        BlockKind::Media => format!("<p class=\"media\">{escaped}</p>"),
        BlockKind::Text => render_markdown(&block.text),
    }
}

/// Render a full session to a standalone HTML document. `messages` are the raw
/// JSONL message objects; `session_name` is used as the report title.
pub fn render_session_html(messages: &[Value], session_name: &str) -> String {
    let filtered: Vec<&Value> = messages.iter().filter(|m| is_exportable(m)).collect();

    let ts_of = |m: &Value| {
        m.get("timestamp")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let first = filtered.first().and_then(|m| ts_of(m));
    let last = filtered.last().and_then(|m| ts_of(m));
    let start = first.as_deref().map(format_timestamp);
    let end = last.as_deref().map(format_timestamp);
    let date_range = match (&start, &end) {
        (Some((sd, st)), Some((ed, _))) if ed != sd => {
            let (_, et) = end.as_ref().unwrap();
            format!("{sd} {st} ~ {ed} {et}")
        }
        (Some((sd, st)), Some((_, et))) => format!("{sd} {st} ~ {et}"),
        (Some((sd, st)), None) => format!("{sd} {st}"),
        _ => String::new(),
    };

    let type_is = |m: &Value, t: &str| m.get("type").and_then(|v| v.as_str()) == Some(t);
    let user_count = filtered.iter().filter(|m| type_is(m, "user")).count();
    let assistant_count = filtered.iter().filter(|m| type_is(m, "assistant")).count();

    let mut message_blocks: Vec<String> = Vec::with_capacity(filtered.len());
    for msg in &filtered {
        let is_user = type_is(msg, "user");
        let role = if is_user { "user" } else { "assistant" };
        let role_label = if is_user { "User" } else { "Assistant" };
        // Escape: format_timestamp returns the raw string on parse failure, so a
        // crafted timestamp could otherwise inject markup.
        let time = msg
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|ts| escape_html(&format_timestamp(ts).1))
            .unwrap_or_default();

        let inner = msg.get("message");
        let model_html = if is_user {
            String::new()
        } else {
            inner
                .and_then(|m| m.get("model"))
                .and_then(|v| v.as_str())
                .map(|m| format!("<span class=\"model\">{}</span>", escape_html(m)))
                .unwrap_or_default()
        };

        let content = inner
            .and_then(|m| m.get("content"))
            .cloned()
            .unwrap_or(Value::Null);
        let blocks = extract_blocks(&content);
        let content_html = blocks
            .iter()
            .map(block_to_html)
            .collect::<Vec<_>>()
            .join("\n");

        // Token usage (assistant only)
        let mut usage_html = String::new();
        if !is_user {
            if let Some(usage) = inner
                .and_then(|m| m.get("usage"))
                .and_then(|v| v.as_object())
            {
                let mut parts: Vec<String> = Vec::new();
                if let Some(n) = usage.get("input_tokens").and_then(Value::as_i64) {
                    parts.push(format!("in: {}", group_thousands(n)));
                }
                if let Some(n) = usage.get("output_tokens").and_then(Value::as_i64) {
                    parts.push(format!("out: {}", group_thousands(n)));
                }
                if !parts.is_empty() {
                    let cost = msg
                        .get("costUSD")
                        .or_else(|| inner.and_then(|m| m.get("costUSD")))
                        .and_then(Value::as_f64)
                        .map(|c| format!(" · ${c:.4}"))
                        .unwrap_or_default();
                    usage_html = format!(
                        "<div class=\"usage\">Tokens: {}{cost}</div>",
                        parts.join(" / ")
                    );
                }
            }
        }

        message_blocks.push(format!(
            "<div class=\"message\">\n<span class=\"role {role}\">{role_label}</span>{model_html}\n<span class=\"timestamp\">{time}</span>\n<div class=\"content\">{content_html}</div>\n{usage_html}\n</div>"
        ));
    }

    let title = escape_html(session_name);
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>Session: {title}</title>\n<style>{CSS}</style>\n</head>\n<body>\n<h1>Session: {title}</h1>\n<div class=\"meta\">\n<span>{range}</span>\n<span>{user_count} user / {assistant_count} assistant messages</span>\n</div>\n{body}\n</body>\n</html>",
        range = escape_html(&date_range),
        body = message_blocks.join("\n"),
    )
}

// ---------------------------------------------------------------------------
// JSONL loading
// ---------------------------------------------------------------------------

/// Parse a `.jsonl` transcript into one [`Value`] per non-empty, well-formed line.
pub fn load_jsonl_messages(path: &Path) -> Result<Vec<Value>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to read session file: {e}"))?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(&line) {
            messages.push(val);
        }
    }
    Ok(messages)
}

// ---------------------------------------------------------------------------
// CLI entry point (`--export`)
// ---------------------------------------------------------------------------

use crate::cli_args::extract_flag_value;
use std::path::PathBuf;

const USAGE: &str = "Usage: --export <session-id|/abs/path.jsonl> [--format html|json] [--output <file>]\n\nExport a single session to a standalone HTML report (default) or raw JSON\nwithout launching the GUI. <session-id> is resolved under ~/.claude/projects\n(an id prefix is accepted when unambiguous). Without --output, the result is\nwritten to stdout.";

fn looks_like_session_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Resolve a `--export` argument to a `.jsonl` transcript path. Accepts either an
/// absolute path to a `.jsonl` file, or a session id / id-prefix searched for
/// under `~/.claude/projects`.
fn resolve_session_path(value: &str) -> Result<PathBuf, String> {
    let as_path = Path::new(value);
    if as_path.is_absolute() {
        if as_path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("Session path cannot contain '..' components".to_string());
        }
        if as_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            return Err("Session path must point to a .jsonl file".to_string());
        }
        // Reject symlinks (`is_file` follows them, so a `.jsonl` symlink could
        // point the reader at an arbitrary file).
        match fs::symlink_metadata(as_path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Session path cannot be a symlink".to_string());
            }
            Ok(meta) if !meta.is_file() => {
                return Err(format!("Session path is not a regular file: {value}"));
            }
            Ok(_) => {}
            Err(_) => return Err(format!("Session file not found: {value}")),
        }
        return Ok(as_path.to_path_buf());
    }

    if !looks_like_session_id(value) {
        return Err(format!(
            "'{value}' is not an absolute .jsonl path or a valid session id (allowed: letters, digits, '_', '-')"
        ));
    }

    let projects = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".claude")
        .join("projects");
    if !projects.is_dir() {
        return Err(format!(
            "Claude projects directory not found: {}",
            projects.display()
        ));
    }

    let mut exact: Vec<PathBuf> = Vec::new();
    let mut prefix: Vec<PathBuf> = Vec::new();
    for entry in walkdir::WalkDir::new(&projects)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
            if stem == value {
                exact.push(p.to_path_buf());
            } else if stem.starts_with(value) {
                prefix.push(p.to_path_buf());
            }
        }
    }

    let mut matches = if exact.is_empty() { prefix } else { exact };
    match matches.len() {
        0 => Err(format!(
            "No session found matching '{value}' under {}",
            projects.display()
        )),
        1 => Ok(matches.remove(0)),
        n => Err(format!(
            "'{value}' is ambiguous — {n} sessions match; use the full id or an absolute path"
        )),
    }
}

/// Best-effort display title: a `summary` message if present, else the file stem.
fn session_title(messages: &[Value], path: &Path) -> String {
    messages
        .iter()
        .find_map(|m| {
            if m.get("type").and_then(|t| t.as_str()) == Some("summary") {
                m.get("summary")
                    .and_then(|s| s.as_str())
                    .map(str::to_string)
            } else {
                None
            }
        })
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("session")
                .to_string()
        })
}

/// Handle the `--export` CLI flag. Returns the process exit code.
pub fn run_export(args: &[String]) -> i32 {
    let Some(value) = extract_flag_value(args, "--export") else {
        eprintln!("{USAGE}");
        return 2;
    };

    let format = extract_flag_value(args, "--format").unwrap_or_else(|| "html".to_string());
    if format != "html" && format != "json" {
        eprintln!("Unsupported --format '{format}' (expected 'html' or 'json')");
        return 2;
    }
    let output = extract_flag_value(args, "--output");

    let path = match resolve_session_path(&value) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };

    let messages = match load_jsonl_messages(&path) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    if messages.is_empty() {
        eprintln!("No messages found in {}", path.display());
        return 1;
    }

    let rendered = match format.as_str() {
        "json" => match serde_json::to_string_pretty(&messages) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to serialize JSON: {e}");
                return 1;
            }
        },
        _ => render_session_html(&messages, &session_title(&messages, &path)),
    };

    match output {
        Some(out) => {
            // Atomic write: stage to a temp file in the same directory, then
            // rename, so an interrupted run can't leave a truncated report.
            let out_path = Path::new(&out);
            let tmp_path = out_path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
            if let Err(e) = fs::write(&tmp_path, rendered.as_bytes()) {
                eprintln!("Failed to write {out}: {e}");
                return 1;
            }
            if let Err(e) = crate::commands::fs_utils::atomic_rename(&tmp_path, out_path) {
                let _ = fs::remove_file(&tmp_path);
                eprintln!("Failed to write {out}: {e}");
                return 1;
            }
            eprintln!("Exported {} message(s) to {out}", messages.len());
        }
        None => println!("{rendered}"),
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_string_content() {
        let blocks = extract_blocks(&json!("hello"));
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, BlockKind::Text);
        assert_eq!(blocks[0].text, "hello");
    }

    #[test]
    fn extract_object_content_is_empty() {
        assert!(extract_blocks(&json!({"foo": "bar"})).is_empty());
        assert!(extract_blocks(&Value::Null).is_empty());
    }

    #[test]
    fn extract_tool_use_with_input_summary() {
        let content = json!([
            { "type": "tool_use", "name": "Read", "input": { "file_path": "/a/b.rs", "limit": 50 } }
        ]);
        let blocks = extract_blocks(&content);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, BlockKind::Tool);
        assert!(blocks[0].text.starts_with("Read("));
        assert!(blocks[0].text.contains("file_path: /a/b.rs"));
        assert!(blocks[0].text.contains("limit: 50"));
    }

    #[test]
    fn extract_tool_result_error_prefix_and_truncation() {
        let long = "x".repeat(600);
        let content = json!([
            { "type": "tool_result", "content": long, "is_error": true }
        ]);
        let blocks = extract_blocks(&content);
        assert_eq!(blocks[0].kind, BlockKind::Result);
        assert!(blocks[0].text.starts_with("[Error] "));
        assert!(blocks[0].text.ends_with("..."));
    }

    #[test]
    fn extract_thinking_and_redacted() {
        let content = json!([
            { "type": "thinking", "thinking": "hmm" },
            { "type": "redacted_thinking" }
        ]);
        let blocks = extract_blocks(&content);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].text, "hmm");
        assert_eq!(blocks[1].text, "[Redacted thinking]");
    }

    #[test]
    fn extract_mcp_tool_use() {
        let content = json!([
            { "type": "mcp_tool_use", "server_name": "fs", "tool_name": "read", "input": { "p": "x" } }
        ]);
        let blocks = extract_blocks(&content);
        assert!(blocks[0].text.starts_with("[MCP: fs.read("));
    }

    #[test]
    fn is_exportable_filters_sidechain_and_system() {
        assert!(!is_exportable(
            &json!({ "type": "user", "isSidechain": true })
        ));
        assert!(!is_exportable(&json!({ "type": "system" })));
        assert!(!is_exportable(&json!({ "type": "summary" })));
        assert!(is_exportable(&json!({ "type": "user" })));
        assert!(is_exportable(&json!({ "type": "assistant" })));
    }

    #[test]
    fn escape_html_handles_specials() {
        assert_eq!(
            escape_html("<a href=\"x\">&"),
            "&lt;a href=&quot;x&quot;&gt;&amp;"
        );
    }

    #[test]
    fn group_thousands_formats() {
        assert_eq!(group_thousands(0), "0");
        assert_eq!(group_thousands(999), "999");
        assert_eq!(group_thousands(1234), "1,234");
        assert_eq!(group_thousands(1234567), "1,234,567");
    }

    #[test]
    fn render_html_has_structure_and_escapes_title() {
        let messages = vec![
            json!({ "type": "user", "timestamp": "2026-01-01T10:00:00Z", "message": { "role": "user", "content": "Hello **world**" } }),
            json!({ "type": "assistant", "timestamp": "2026-01-01T10:00:05Z", "message": { "role": "assistant", "model": "claude-x", "content": [{ "type": "text", "text": "Hi" }], "usage": { "input_tokens": 1200, "output_tokens": 7 } } }),
            json!({ "type": "summary", "summary": "should be skipped" }),
        ];
        let html = render_session_html(&messages, "My <Session>");
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("<title>Session: My &lt;Session&gt;</title>"));
        assert!(html.contains("1 user / 1 assistant messages")); // summary excluded
        assert!(html.contains("claude-x"));
        assert!(html.contains("in: 1,200 / out: 7"));
        assert!(html.contains("<strong>world</strong>")); // markdown rendered
        assert!(!html.contains("should be skipped"));
    }

    #[test]
    fn render_markdown_neutralizes_raw_html() {
        // comrak with unsafe_ = false drops raw HTML (the TS exporter escapes it
        // to visible text instead). Either way no executable markup survives.
        let out = render_markdown("hi <script>alert(1)</script>");
        assert!(!out.contains("<script>"));
        assert!(out.contains("hi"));
    }

    #[test]
    fn run_export_html_to_file_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let session = dir.path().join("abc-123.jsonl");
        std::fs::write(
            &session,
            "{\"type\":\"user\",\"timestamp\":\"2026-01-01T10:00:00Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T10:00:01Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}\n",
        )
        .unwrap();
        let out = dir.path().join("out.html");

        let args = vec![
            "app".to_string(),
            "--export".to_string(),
            session.to_string_lossy().to_string(),
            "--format".to_string(),
            "html".to_string(),
            "--output".to_string(),
            out.to_string_lossy().to_string(),
        ];
        assert_eq!(run_export(&args), 0);

        let html = std::fs::read_to_string(&out).unwrap();
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("1 user / 1 assistant messages"));
        assert!(html.contains("hello"));
    }

    #[test]
    fn run_export_json_to_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let session = dir.path().join("s.jsonl");
        std::fs::write(
            &session,
            "{\"type\":\"user\",\"message\":{\"content\":\"x\"}}\n",
        )
        .unwrap();
        let out = dir.path().join("out.json");
        let args = vec![
            "app".into(),
            "--export".into(),
            session.to_string_lossy().to_string(),
            "--format".into(),
            "json".into(),
            "--output".into(),
            out.to_string_lossy().to_string(),
        ];
        assert_eq!(run_export(&args), 0);
        let json = std::fs::read_to_string(&out).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_array());
    }

    #[test]
    fn run_export_rejects_unknown_format() {
        let args = vec![
            "app".into(),
            "--export".into(),
            "/tmp/whatever.jsonl".into(),
            "--format".into(),
            "pdf".into(),
        ];
        assert_eq!(run_export(&args), 2);
    }

    #[test]
    fn run_export_missing_value_returns_usage_code() {
        let args = vec!["app".into(), "--export".into()];
        assert_eq!(run_export(&args), 2);
    }

    #[test]
    fn resolve_rejects_non_jsonl_absolute_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(resolve_session_path(&txt.to_string_lossy()).is_err());
    }

    #[test]
    fn resolve_rejects_invalid_session_id() {
        assert!(resolve_session_path("bad id!").is_err());
        assert!(resolve_session_path("../etc/passwd").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlinked_jsonl() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::TempDir::new().unwrap();
        let real = dir.path().join("real.jsonl");
        std::fs::write(&real, "{}\n").unwrap();
        let link = dir.path().join("link.jsonl");
        symlink(&real, &link).unwrap();

        let err = resolve_session_path(&link.to_string_lossy()).unwrap_err();
        assert!(err.contains("symlink"));
    }
}
