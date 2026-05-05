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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        passphrase: Option<String>,
    },
    Password {
        password: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProviderPaths {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opencode: Option<String>,
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
    pub last_sync_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_status: Option<RemoteSyncStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_stats: Option<RemoteSyncStats>,
}

/// Default remote paths per OS family. Identical for Linux and Windows because
/// every supported AI tool follows XDG-style layout on Windows too — verified
/// against `~/.local/share/opencode/` existing on Windows boxes.
#[must_use]
pub fn default_paths_for(_system: RemoteSystemKind) -> RemoteProviderPaths {
    RemoteProviderPaths {
        claude: Some("~/.claude".to_string()),
        codex: Some("~/.codex".to_string()),
        opencode: Some("~/.local/share/opencode".to_string()),
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
            passphrase: Some("hunter2".to_string()),
        };
        let json = serde_json::to_string(&key).unwrap();
        assert!(json.contains("\"type\":\"key\""));
        assert!(json.contains("\"keyPath\""));
        let back: RemoteAuth = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, RemoteAuth::Key { .. }));
    }
}
