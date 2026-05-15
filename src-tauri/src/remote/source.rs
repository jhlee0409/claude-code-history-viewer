//! Data model for remote SSH sources. Mirrors `src/types/core/remoteSource.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RemoteSystemKind {
    Linux,
    Windows,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RemoteAuth {
    Key {
        #[serde(rename = "keyPath")]
        key_path: String,
        #[serde(
            rename = "passphraseRef",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        passphrase_ref: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        passphrase: Option<String>,
    },
    Password {
        #[serde(
            rename = "passwordRef",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        password_ref: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<String>,
    },
}

/// Per-provider remote-path overrides. Each provider accepts **multiple paths**
/// — required for the cc-slack-style multi-tenant container layout where each
/// worker writes into its own `~/.cc-slack-data/<worker>/.claude` dir.
///
/// Paths support a single `*` per segment (no `**`, no `?` glob) — translated
/// against the remote filesystem at sync time.
///
/// Backwards-compat: a bare string is also accepted on the wire and treated as
/// a one-element list (settings written by older builds keep working).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProviderPaths {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_string_or_vec"
    )]
    pub claude: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_string_or_vec"
    )]
    pub codex: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_string_or_vec"
    )]
    pub opencode: Option<Vec<String>>,
}

/// Accept either `"~/.claude"` or `["~/a", "~/b"]` for any provider field, so
/// older settings written before multi-path support deserialise unchanged.
fn deserialize_string_or_vec<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrVec {
        Single(String),
        Multi(Vec<String>),
    }
    let opt: Option<StringOrVec> = Option::deserialize(deserializer)?;
    Ok(opt.map(|sv| match sv {
        StringOrVec::Single(s) => vec![s],
        StringOrVec::Multi(v) => v,
    }))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RemoteSyncStatus {
    Idle,
    Syncing,
    Ok,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncStats {
    pub files_total: u64,
    pub files_updated: u64,
    pub files_skipped: u64,
    pub bytes_transferred: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSource {
    pub id: String,
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub system: RemoteSystemKind,
    pub auth: RemoteAuth,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<RemoteProviderPaths>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub podman: Option<RemotePodmanSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_status: Option<RemoteSyncStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_stats: Option<RemoteSyncStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemotePodmanSettings {
    #[serde(default = "default_podman_enabled")]
    pub enabled: bool,
}

fn default_podman_enabled() -> bool {
    true
}

impl RemoteSource {
    #[must_use]
    pub fn podman_enabled(&self) -> bool {
        self.system == RemoteSystemKind::Linux
            && self
                .podman
                .as_ref()
                .map_or(true, |settings| settings.enabled)
    }
}

/// Default remote paths per OS family.
///
/// The first entry covers the **cc-slack multi-tenant container layout** used
/// by `scripts/deploy-multi.sh` in the cc-slack repo: each worker bind-mounts
/// `~/.cc-slack-data/<worker>/.claude` etc. into its container so AI logins
/// and conversation history don't bleed across workers. The second entry is
/// the standard single-user location.
///
/// Both Linux and Windows ship the same defaults — every supported AI tool
/// follows XDG-style layout on Windows too (verified against
/// `~/.local/share/opencode/` on Windows hosts).
#[must_use]
pub fn default_paths_for(_system: RemoteSystemKind) -> RemoteProviderPaths {
    RemoteProviderPaths {
        claude: Some(vec![
            "~/.cc-slack-data/*/.claude".to_string(),
            "~/.claude".to_string(),
        ]),
        codex: Some(vec!["~/.codex".to_string()]),
        opencode: Some(vec![
            "~/.cc-slack-data/*/.opencode".to_string(),
            "~/.local/share/opencode".to_string(),
        ]),
    }
}

/// Resolve a tilde-prefixed path against a remote home directory.
/// `~/.claude` + `/home/foo` → `/home/foo/.claude`.
/// `~/.claude` + `C:\Users\foo` → `C:\Users\foo\.claude` (Windows-style join).
#[must_use]
pub fn expand_tilde(path: &str, remote_home: &str, system: RemoteSystemKind) -> String {
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix('~')) {
        let separator = match system {
            RemoteSystemKind::Linux => '/',
            RemoteSystemKind::Windows => '\\',
        };
        let trimmed_home = remote_home.trim_end_matches(['/', '\\']);
        let trimmed_rest = rest.trim_start_matches(['/', '\\']);
        if trimmed_rest.is_empty() {
            trimmed_home.to_string()
        } else {
            format!("{trimmed_home}{separator}{trimmed_rest}")
        }
    } else {
        path.to_string()
    }
}

/// Translate a single shell-style wildcard segment (`*` matches any run of
/// non-separator chars) into a `regex::Regex`. Other regex metacharacters are
/// escaped so a literal segment like `worker.dev` matches as-is.
#[must_use]
pub fn wildcard_segment_to_regex(segment: &str) -> regex::Regex {
    let mut pat = String::with_capacity(segment.len() + 4);
    pat.push('^');
    for ch in segment.chars() {
        if ch == '*' {
            pat.push_str(".*");
        } else {
            for esc in regex::escape(&ch.to_string()).chars() {
                pat.push(esc);
            }
        }
    }
    pat.push('$');
    // Pattern is built from escaped chars + `.*` only — always valid.
    regex::Regex::new(&pat).expect("wildcard regex must compile")
}

/// Iteratively expand a path containing `*` wildcards using a caller-provided
/// `read_dir_names` async callback. Pure path logic — no SFTP coupling — so it
/// can be unit-tested with a `HashMap`-backed fake.
///
/// Limits/quirks:
/// * Wildcards are per-segment (`*` matches anything within one path segment;
///   no recursive `**`).
/// * If `read_dir_names` returns `Err` for a candidate prefix, that branch is
///   silently dropped (treated as "no matches"). Real callers want this — a
///   missing `~/.cc-slack-data/` shouldn't crash the whole sync.
/// * Output paths use the supplied `system`'s separator throughout.
pub async fn expand_globs<F, Fut>(
    path: &str,
    system: RemoteSystemKind,
    mut read_dir_names: F,
) -> Vec<String>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<Vec<String>>>,
{
    let separator = match system {
        RemoteSystemKind::Linux => '/',
        RemoteSystemKind::Windows => '\\',
    };
    let sep_str = separator.to_string();

    let mut queue: Vec<String> = vec![path.to_string()];
    let mut out: Vec<String> = Vec::new();

    while let Some(p) = queue.pop() {
        if !p.contains('*') {
            out.push(p);
            continue;
        }
        // Split into segments, preserving any leading absolute marker.
        let segments: Vec<&str> = p.split(['/', '\\']).collect();
        let Some(idx) = segments.iter().position(|s| s.contains('*')) else {
            out.push(p);
            continue;
        };
        if idx == 0 {
            // Wildcard before any separator — would match the FS root, refuse.
            continue;
        }
        let prefix = segments[..idx].join(&sep_str);
        let suffix_segments = &segments[idx + 1..];
        let pattern = wildcard_segment_to_regex(segments[idx]);

        let entries = match read_dir_names(prefix.clone()).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        for name in entries {
            if !pattern.is_match(&name) {
                continue;
            }
            let mut parts: Vec<String> = Vec::with_capacity(2 + suffix_segments.len());
            parts.push(prefix.clone());
            parts.push(name);
            for s in suffix_segments {
                parts.push((*s).to_string());
            }
            queue.push(parts.join(&sep_str));
        }
    }

    // Stable order so cache subdirs (and consequently injected customClaudePath
    // ordering) don't churn between sync runs.
    out.sort();
    out.dedup();
    out
}

/// Per-provider sub-paths to sync, relative to the provider's base dir.
/// Anything outside this whitelist is **never** transferred — this excludes
/// credential files (`auth.json`, `credentials.json`, `mcp-auth.json`),
/// caches, logs, and debug data.
#[derive(Debug, Clone, Copy)]
pub struct ProviderWhitelist {
    pub provider: ProviderKind,
    /// Sub-paths to recursively include. Each entry is matched as a directory
    /// or single-file under the provider base dir.
    pub include: &'static [&'static str],
    /// File-extension filter — `None` means "any file".
    pub extension_filter: Option<&'static [&'static str]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Claude,
    Codex,
    OpenCode,
}

impl ProviderKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderKind::Claude => "claude",
            ProviderKind::Codex => "codex",
            ProviderKind::OpenCode => "opencode",
        }
    }
}

#[must_use]
pub fn sync_whitelist() -> &'static [ProviderWhitelist] {
    &[
        ProviderWhitelist {
            provider: ProviderKind::Claude,
            include: &["projects"],
            extension_filter: Some(&["jsonl"]),
        },
        ProviderWhitelist {
            provider: ProviderKind::Codex,
            include: &["sessions"],
            extension_filter: Some(&["jsonl"]),
        },
        ProviderWhitelist {
            provider: ProviderKind::OpenCode,
            // Pull main DB + WAL/SHM (so SQLite can replay) plus storage tree.
            // Snapshot is included for diff-viewing fidelity.
            include: &[
                "opencode.db",
                "opencode.db-wal",
                "opencode.db-shm",
                "storage",
                "snapshot",
            ],
            extension_filter: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn expand_tilde_linux() {
        assert_eq!(
            expand_tilde("~/.claude", "/home/foo", RemoteSystemKind::Linux),
            "/home/foo/.claude"
        );
    }

    #[test]
    fn expand_tilde_windows() {
        assert_eq!(
            expand_tilde("~/.claude", "C:\\Users\\foo", RemoteSystemKind::Windows),
            "C:\\Users\\foo\\.claude"
        );
    }

    #[test]
    fn expand_tilde_passthrough_for_absolute() {
        assert_eq!(
            expand_tilde("/etc/foo", "/home/x", RemoteSystemKind::Linux),
            "/etc/foo"
        );
    }

    #[test]
    fn auth_serialisation_roundtrip() {
        let key = RemoteAuth::Key {
            key_path: "/home/foo/.ssh/id_ed25519".to_string(),
            passphrase_ref: None,
            passphrase: Some("hunter2".to_string()),
        };
        let json = serde_json::to_string(&key).unwrap();
        assert!(json.contains("\"type\":\"key\""));
        assert!(json.contains("\"keyPath\""));
        let back: RemoteAuth = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, RemoteAuth::Key { .. }));
    }

    #[test]
    fn paths_deserialise_legacy_string_form() {
        // Old settings written before multi-path support stored each provider
        // path as a bare string. Must keep loading without breaking the user.
        let json = r#"{"claude":"~/.claude","codex":"~/.codex"}"#;
        let parsed: RemoteProviderPaths = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.claude, Some(vec!["~/.claude".to_string()]));
        assert_eq!(parsed.codex, Some(vec!["~/.codex".to_string()]));
        assert_eq!(parsed.opencode, None);
    }

    #[test]
    fn paths_deserialise_array_form() {
        let json = r#"{"claude":["~/a","~/b"]}"#;
        let parsed: RemoteProviderPaths = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.claude,
            Some(vec!["~/a".to_string(), "~/b".to_string()])
        );
    }

    #[test]
    fn paths_serialise_as_array() {
        let v = RemoteProviderPaths {
            claude: Some(vec!["~/.claude".to_string()]),
            codex: None,
            opencode: None,
        };
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#"{"claude":["~/.claude"]}"#);
    }

    #[test]
    fn defaults_include_cc_slack_pattern_first() {
        let d = default_paths_for(RemoteSystemKind::Linux);
        let claude = d.claude.unwrap();
        assert_eq!(claude[0], "~/.cc-slack-data/*/.claude");
        assert_eq!(claude[1], "~/.claude");
        let opencode = d.opencode.unwrap();
        assert_eq!(opencode[0], "~/.cc-slack-data/*/.opencode");
        assert_eq!(opencode[1], "~/.local/share/opencode");
        // Codex isn't bind-mounted by cc-slack — only the standard path.
        assert_eq!(d.codex.unwrap(), vec!["~/.codex".to_string()]);
    }

    #[test]
    fn wildcard_regex_matches_any_segment() {
        let r = wildcard_segment_to_regex("*");
        assert!(r.is_match("dbg"));
        assert!(r.is_match("worker-example-dev"));
        // Inner segments only — separator chars are not in the candidate name
        // because `expand_globs` matches against single dir entries.
        assert!(r.is_match(""));
    }

    #[test]
    fn wildcard_regex_with_literal_prefix() {
        let r = wildcard_segment_to_regex("worker-*");
        assert!(r.is_match("worker-A"));
        assert!(r.is_match("worker-prod-1"));
        assert!(!r.is_match("dbg"));
        assert!(!r.is_match("X-worker-A"));
    }

    #[test]
    fn wildcard_regex_escapes_metachars() {
        let r = wildcard_segment_to_regex("worker.dev");
        // `.` must be a literal dot, not the regex any-char.
        assert!(r.is_match("worker.dev"));
        assert!(!r.is_match("workerXdev"));
    }

    #[tokio::test]
    async fn expand_globs_no_wildcard_passthrough() {
        let calls: HashMap<String, Vec<String>> = HashMap::new();
        let out = expand_globs("/home/user/.claude", RemoteSystemKind::Linux, |dir| {
            let v = calls.get(&dir).cloned().unwrap_or_default();
            async move { Ok(v) }
        })
        .await;
        assert_eq!(out, vec!["/home/user/.claude".to_string()]);
    }

    #[tokio::test]
    async fn expand_globs_single_wildcard() {
        let mut calls: HashMap<String, Vec<String>> = HashMap::new();
        calls.insert(
            "/home/user/.cc-slack-data".to_string(),
            vec![
                "dbg".to_string(),
                "dbg2".to_string(),
                "worker-example-dev".to_string(),
            ],
        );
        let out = expand_globs(
            "/home/user/.cc-slack-data/*/.claude",
            RemoteSystemKind::Linux,
            |dir| {
                let v = calls.get(&dir).cloned().unwrap_or_default();
                async move { Ok(v) }
            },
        )
        .await;
        assert_eq!(
            out,
            vec![
                "/home/user/.cc-slack-data/dbg/.claude".to_string(),
                "/home/user/.cc-slack-data/dbg2/.claude".to_string(),
                "/home/user/.cc-slack-data/worker-example-dev/.claude".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn expand_globs_filters_by_pattern() {
        let mut calls: HashMap<String, Vec<String>> = HashMap::new();
        calls.insert(
            "/srv".to_string(),
            vec![
                "worker-A".to_string(),
                "worker-B".to_string(),
                "unrelated".to_string(),
            ],
        );
        let out = expand_globs("/srv/worker-*/.claude", RemoteSystemKind::Linux, |dir| {
            let v = calls.get(&dir).cloned().unwrap_or_default();
            async move { Ok(v) }
        })
        .await;
        assert_eq!(
            out,
            vec![
                "/srv/worker-A/.claude".to_string(),
                "/srv/worker-B/.claude".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn expand_globs_silently_drops_failed_listing() {
        // No entry in the fake → callback returns empty; sync should not blow up.
        let out = expand_globs(
            "/missing/*/.claude",
            RemoteSystemKind::Linux,
            |_dir| async { Err(anyhow::anyhow!("no such dir")) },
        )
        .await;
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn expand_globs_windows_separators() {
        let mut calls: HashMap<String, Vec<String>> = HashMap::new();
        calls.insert(
            "C:\\Users\\foo\\.cc-slack-data".to_string(),
            vec!["dbg".to_string()],
        );
        let out = expand_globs(
            "C:\\Users\\foo\\.cc-slack-data\\*\\.claude",
            RemoteSystemKind::Windows,
            |dir| {
                let v = calls.get(&dir).cloned().unwrap_or_default();
                async move { Ok(v) }
            },
        )
        .await;
        assert_eq!(
            out,
            vec!["C:\\Users\\foo\\.cc-slack-data\\dbg\\.claude".to_string()]
        );
    }
}
