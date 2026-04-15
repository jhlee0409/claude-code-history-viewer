//! CLI argument parsing for the desktop binary.
//!
//! The `--serve` flag (`WebUI` headless mode) is handled inline in `lib.rs` for
//! historical reasons. This module adds a `--session <value>` flag that asks
//! the GUI to preload a specific Claude Code session at startup. The resolved
//! hint is exposed to the frontend via the `get_startup_session_hint` Tauri
//! command; the React side then navigates to that session once projects are
//! loaded.
//!
//! Commit A (this change) accepts UUID / UUID-prefix values only. Commit B
//! extends the parser to accept paths, sesslog folder names, and free-text
//! titles.

use serde::Serialize;
use tauri::State;

/// Newtype wrapper so we can pass `Option<SessionHint>` through Tauri's typed
/// managed-state API. `tauri::State<T>` keys by type, so wrapping in a named
/// struct avoids any accidental collision with a future `Option<T>` managed by
/// another subsystem.
#[derive(Default)]
pub struct StartupSessionHint(pub Option<SessionHint>);

/// Tauri command returning the CLI-supplied session hint, if any.
///
/// The frontend calls this on mount after projects have loaded; `None` means
/// "no preload requested, run the normal UI".
#[tauri::command]
#[must_use]
pub fn get_startup_session_hint(state: State<'_, StartupSessionHint>) -> Option<SessionHint> {
    state.0.clone()
}

/// A CLI-supplied hint asking the frontend to preload a specific session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHint {
    /// Resolution strategy. In Commit A this is only [`SessionHintKind::Uuid`].
    pub kind: SessionHintKind,
    /// The raw value as supplied on the command line.
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionHintKind {
    Uuid,
}

/// Parse `--session <value>` or `--session=<value>` from a raw argv vec.
///
/// Returns `None` if the flag is absent, the value is missing, or the value
/// does not look like a UUID or UUID prefix.
#[must_use]
pub fn parse_session_hint(args: &[String]) -> Option<SessionHint> {
    let raw = extract_flag_value(args, "--session")?;
    if is_uuid_like(&raw) {
        Some(SessionHint {
            kind: SessionHintKind::Uuid,
            value: raw,
        })
    } else {
        None
    }
}

/// Extract the value of `--flag=value` or `--flag value` from argv.
///
/// A flag without a following value (or followed by another flag starting
/// with `--`) yields `None`.
fn extract_flag_value(args: &[String], flag: &str) -> Option<String> {
    let prefix = format!("{flag}=");
    for (idx, arg) in args.iter().enumerate() {
        if let Some(after) = arg.strip_prefix(&prefix) {
            if after.is_empty() {
                return None;
            }
            return Some(after.to_string());
        }
        if arg == flag {
            return args
                .get(idx + 1)
                .filter(|next| !next.starts_with("--"))
                .cloned();
        }
    }
    None
}

/// A UUID is 36 chars with four dashes; a prefix is any 8-35 char slice of
/// the canonical form. We accept anything hex-or-dash of length 8..=36.
fn is_uuid_like(value: &str) -> bool {
    let len = value.len();
    if !(8..=36).contains(&len) {
        return false;
    }
    value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn returns_none_when_no_flag_present() {
        let args = argv(&["app", "--serve"]);
        assert!(parse_session_hint(&args).is_none());
    }

    #[test]
    fn parses_space_separated_uuid() {
        let args = argv(&["app", "--session", "1265cd74-caa9-472e-b343-c4f44b5cf12c"]);
        let hint = parse_session_hint(&args).expect("hint");
        assert_eq!(hint.kind, SessionHintKind::Uuid);
        assert_eq!(hint.value, "1265cd74-caa9-472e-b343-c4f44b5cf12c");
    }

    #[test]
    fn parses_equals_form() {
        let args = argv(&["app", "--session=1265cd74-caa9-472e-b343-c4f44b5cf12c"]);
        let hint = parse_session_hint(&args).expect("hint");
        assert_eq!(hint.value, "1265cd74-caa9-472e-b343-c4f44b5cf12c");
    }

    #[test]
    fn accepts_uuid_prefix() {
        let args = argv(&["app", "--session", "1265cd74"]);
        let hint = parse_session_hint(&args).expect("hint");
        assert_eq!(hint.value, "1265cd74");
    }

    #[test]
    fn rejects_non_hex_value() {
        let args = argv(&["app", "--session", "hello-world-not-a-uuid"]);
        // "hello-world-not-a-uuid" contains non-hex chars — rejected.
        assert!(parse_session_hint(&args).is_none());
    }

    #[test]
    fn rejects_too_short_value() {
        let args = argv(&["app", "--session", "1265cd7"]);
        assert!(parse_session_hint(&args).is_none());
    }

    #[test]
    fn rejects_too_long_value() {
        let args = argv(&[
            "app",
            "--session",
            "1265cd74-caa9-472e-b343-c4f44b5cf12c-extra",
        ]);
        assert!(parse_session_hint(&args).is_none());
    }

    #[test]
    fn returns_none_when_flag_value_is_another_flag() {
        let args = argv(&["app", "--session", "--serve"]);
        assert!(parse_session_hint(&args).is_none());
    }

    #[test]
    fn returns_none_when_flag_has_no_following_argument() {
        let args = argv(&["app", "--session"]);
        assert!(parse_session_hint(&args).is_none());
    }

    #[test]
    fn returns_none_when_equals_form_has_empty_value() {
        let args = argv(&["app", "--session="]);
        assert!(parse_session_hint(&args).is_none());
    }
}
