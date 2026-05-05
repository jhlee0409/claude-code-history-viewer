//! Sync engine: pull whitelisted files from a remote SSH source into the
//! local cache directory, doing `(size, mtime)` incremental skipping.
//!
//! Cache layout per source:
//! ```text
//! ~/.claude-history-viewer/remote-cache/<host>__<id-prefix>/
//!   .claude/projects/<project>/<session>.jsonl
//!   .codex/sessions/<...>/<rollout>.jsonl
//!   opencode/{opencode.db, opencode.db-wal, storage/..., snapshot/...}
//! ```
//! Each provider's local root is then registered as a custom scan path
//! by the frontend so the existing scanner picks it up unmodified.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::remote::sftp_client::SftpSession;
use crate::remote::source::{
    default_paths_for, expand_tilde, sync_whitelist, ProviderKind, RemoteSource, RemoteSyncStats,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub source_id: String,
    pub stats: RemoteSyncStats,
    pub injected_paths: InjectedPaths,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectedPaths {
    pub claude: Option<String>,
    pub codex: Option<String>,
    pub opencode: Option<String>,
}

/// Returns the local cache root for one remote source.
fn local_cache_root(source: &RemoteSource) -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not locate user home directory")?;
    let sanitised_host = source.host.replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '.' && c != '_',
        "_",
    );
    let id_prefix: String = source.id.chars().take(8).collect();
    Ok(home
        .join(".claude-history-viewer")
        .join("remote-cache")
        .join(format!("{sanitised_host}__{id_prefix}")))
}

pub async fn sync_one(source: &RemoteSource) -> Result<SyncOutcome> {
    let started = Instant::now();
    let cache_root = local_cache_root(source)?;

    let session = SftpSession::connect(source).await.with_context(|| {
        format!(
            "connect to {}@{}:{}",
            source.username, source.host, source.port
        )
    })?;

    let remote_home = session.remote_home().await.context("resolve remote home")?;

    let defaults = default_paths_for(source.system);
    let user_paths = source.paths.clone().unwrap_or_default();

    let claude_remote = user_paths
        .claude
        .or(defaults.claude)
        .unwrap_or_else(|| "~/.claude".to_string());
    let codex_remote = user_paths
        .codex
        .or(defaults.codex)
        .unwrap_or_else(|| "~/.codex".to_string());
    let opencode_remote = user_paths
        .opencode
        .or(defaults.opencode)
        .unwrap_or_else(|| "~/.local/share/opencode".to_string());

    let mut stats = RemoteSyncStats::default();
    let mut injected = InjectedPaths::default();

    for wl in sync_whitelist() {
        let (remote_root, local_provider_root) = match wl.provider {
            ProviderKind::Claude => (
                expand_tilde(&claude_remote, &remote_home, source.system),
                cache_root.join(".claude"),
            ),
            ProviderKind::Codex => (
                expand_tilde(&codex_remote, &remote_home, source.system),
                cache_root.join(".codex"),
            ),
            ProviderKind::OpenCode => (
                expand_tilde(&opencode_remote, &remote_home, source.system),
                cache_root.join("opencode"),
            ),
        };

        // Skip provider entirely if the root directory doesn't exist on remote.
        if session.stat_optional(&remote_root).await.is_none() {
            continue;
        }

        let mut provider_synced_any = false;
        for include in wl.include {
            let remote_target =
                format!("{}/{}", remote_root.trim_end_matches(['/', '\\']), include);
            let local_target = local_provider_root.join(include);

            let Some(attrs) = session.stat_optional(&remote_target).await else {
                continue;
            };
            let permissions = attrs.permissions.unwrap_or(0);
            // POSIX: top 4 bits of permissions encode the file type.
            // 0o170000 mask, 0o040000 = directory.
            let is_dir = permissions & 0o170_000 == 0o040_000;

            if is_dir {
                let files = session
                    .list_recursive(&remote_target, wl.extension_filter)
                    .await?;
                stats.files_total = stats.files_total.saturating_add(files.len() as u64);
                for f in files {
                    let local_path = local_target.join(&f.rel_path);
                    if file_unchanged(&local_path, f.size, f.mtime_secs).await {
                        stats.files_skipped = stats.files_skipped.saturating_add(1);
                    } else {
                        let bytes = session.download_file(&f.abs_path, &local_path).await?;
                        stats.files_updated = stats.files_updated.saturating_add(1);
                        stats.bytes_transferred = stats.bytes_transferred.saturating_add(bytes);
                    }
                    // Always (re-)stamp mtime, even when skipping. This both
                    // gives fresh downloads the right value and repairs files
                    // stamped under earlier sync strategies (e.g. raw fs mtime
                    // before the JSONL last-message-timestamp logic existed).
                    let mtime_to_set = pick_mtime(&local_path, f.mtime_secs);
                    let _ = set_local_mtime(&local_path, mtime_to_set).await;
                    provider_synced_any = true;
                }
            } else {
                stats.files_total = stats.files_total.saturating_add(1);
                let local_path = local_target;
                let size = attrs.size.unwrap_or(0);
                let mtime = u64::from(attrs.mtime.unwrap_or(0));
                if file_unchanged(&local_path, size, mtime).await {
                    stats.files_skipped = stats.files_skipped.saturating_add(1);
                } else {
                    let bytes = session.download_file(&remote_target, &local_path).await?;
                    stats.files_updated = stats.files_updated.saturating_add(1);
                    stats.bytes_transferred = stats.bytes_transferred.saturating_add(bytes);
                }
                // Same idempotent re-stamp for single-file includes (e.g. opencode.db).
                let mtime_to_set = pick_mtime(&local_path, mtime);
                let _ = set_local_mtime(&local_path, mtime_to_set).await;
                provider_synced_any = true;
            }
        }

        if provider_synced_any {
            let path_str = local_provider_root.to_string_lossy().into_owned();
            match wl.provider {
                ProviderKind::Claude => injected.claude = Some(path_str),
                ProviderKind::Codex => injected.codex = Some(path_str),
                ProviderKind::OpenCode => injected.opencode = Some(path_str),
            }
        }
    }

    stats.duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    Ok(SyncOutcome {
        source_id: source.id.clone(),
        stats,
        injected_paths: injected,
    })
}

/// Returns true when local file matches remote (no download needed).
async fn file_unchanged(local_path: &Path, remote_size: u64, remote_mtime: u64) -> bool {
    let Ok(meta) = tokio::fs::metadata(local_path).await else {
        return false;
    };
    if meta.len() != remote_size {
        return false;
    }
    // For JSONL files we deliberately rewrite the local mtime to the last
    // message's timestamp post-download (better UX in the project list), so
    // local mtime no longer matches remote fs mtime — fall back to size-only
    // comparison. Safe because JSONL is append-only: same size = same content.
    if local_path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
        return true;
    }
    let local_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());

    // SFTP didn't expose mtime → fall back to size-only match.
    remote_mtime == 0 || local_mtime.abs_diff(remote_mtime) < 2
}

/// Choose the mtime to stamp onto a freshly-downloaded file.
///
/// For `.jsonl` session files we prefer the timestamp of the **last message**
/// inside the file over the SFTP-reported fs mtime: Claude Code occasionally
/// touches old session files for bookkeeping (native rename, history rotate),
/// which makes the fs mtime "now" even though the conversation ended weeks
/// ago. The project tree shows the file mtime, so we stamp it with the real
/// conversation time for a sensible UI.
///
/// Falls back to `remote_fs_mtime` for non-JSONL files or when the JSONL has
/// no parseable timestamp.
fn pick_mtime(local_path: &Path, remote_fs_mtime: u64) -> u64 {
    if local_path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
        return remote_fs_mtime;
    }
    extract_jsonl_last_message_timestamp(local_path).unwrap_or(remote_fs_mtime)
}

/// Read the trailing portion of a JSONL file and return the most-recent
/// `timestamp` field as unix seconds.
fn extract_jsonl_last_message_timestamp(path: &Path) -> Option<u64> {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};

    const TAIL_BYTES: u64 = 64 * 1024;

    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if len == 0 {
        return None;
    }
    let read_from = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(read_from)).ok()?;

    // Collect non-empty lines from the tail; iterate them in reverse so we
    // pick the last (most-recent) message that has a parseable timestamp.
    let lines: Vec<String> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .collect();

    for line in lines.iter().rev() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(ts_str) = v.get("timestamp").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
            let secs = dt.timestamp();
            if secs > 0 {
                return Some(secs as u64);
            }
        }
    }
    None
}

async fn set_local_mtime(path: &Path, mtime_secs: u64) -> Result<()> {
    if mtime_secs == 0 {
        return Ok(());
    }
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<()> {
        use std::time::{Duration, UNIX_EPOCH};
        let target = UNIX_EPOCH + Duration::from_secs(mtime_secs);
        let f = std::fs::OpenOptions::new().write(true).open(&path)?;
        f.set_modified(target)?;
        Ok(())
    })
    .await??;
    Ok(())
}

#[cfg(test)]
mod integration_tests {
    //! End-to-end tests against a real SSH host. Default-ignored so CI doesn't
    //! need an SSH server; run manually with:
    //!
    //! ```text
    //! PODMAN_SSH_PORT=59265 \
    //! PODMAN_SSH_KEY="C:\Users\...\machine" \
    //! cargo test -p claude-code-history-viewer remote::sync::integration -- --ignored --nocapture
    //! ```
    //!
    //! The host is expected to have the test fixtures from the bootstrap
    //! script (see PR description) under `~/.claude/`, `~/.codex/`, and
    //! `~/.local/share/opencode/`.

    use super::*;
    use crate::remote::source::{RemoteAuth, RemoteSource, RemoteSystemKind};

    fn build_source(key_path: String, port: u16) -> RemoteSource {
        RemoteSource {
            id: "test-podman-machine".to_string(),
            enabled: true,
            host: "127.0.0.1".to_string(),
            port,
            username: "user".to_string(),
            system: RemoteSystemKind::Linux,
            auth: RemoteAuth::Key {
                key_path,
                passphrase: None,
            },
            paths: None,
            last_sync_at: None,
            last_sync_status: None,
            last_sync_error: None,
            last_sync_stats: None,
        }
    }

    #[tokio::test]
    #[ignore = "requires a live SSH server with seeded fixtures; run manually"]
    async fn sync_against_podman_pulls_whitelisted_files_only() {
        let key_path = std::env::var("PODMAN_SSH_KEY").expect("PODMAN_SSH_KEY required");
        let port: u16 = std::env::var("PODMAN_SSH_PORT")
            .expect("PODMAN_SSH_PORT required")
            .parse()
            .expect("PODMAN_SSH_PORT must be a number");
        let source = build_source(key_path, port);

        // Clean previous cache so the run is reproducible.
        let cache = local_cache_root(&source).expect("cache root resolves");
        if cache.exists() {
            std::fs::remove_dir_all(&cache).expect("clean previous cache");
        }

        let outcome = sync_one(&source).await.expect("sync should succeed");

        eprintln!("sync stats: {:?}", outcome.stats);
        eprintln!("injected: {:?}", outcome.injected_paths);

        // Whitelisted files we expect to be pulled.
        let expected = [
            ".claude/projects/test-proj-a/sess1.jsonl",
            ".claude/projects/test-proj-b/sub/sess2.jsonl",
            ".codex/sessions/2026/04/30/rollout-test.jsonl",
            "opencode/storage/session_diff/ses_test.json",
        ];
        for rel in expected {
            let p = cache.join(rel);
            assert!(p.exists(), "expected synced file missing: {}", p.display());
        }

        // Decoys that must NEVER cross the wire.
        let forbidden = [
            ".claude/credentials.json",
            ".claude/cache/big.bin",
            ".claude/debug/dump.log",
        ];
        for rel in forbidden {
            let p = cache.join(rel);
            assert!(
                !p.exists(),
                "decoy file should not have been synced: {}",
                p.display()
            );
        }

        // First-run file count: all four expected files freshly downloaded.
        assert!(
            outcome.stats.files_updated >= 4,
            "expected >=4 updated, got {}",
            outcome.stats.files_updated
        );
        assert_eq!(
            outcome.stats.files_skipped, 0,
            "no files should be skipped on a clean run"
        );

        // Injected paths point at the per-provider cache subdirs.
        assert!(outcome.injected_paths.claude.is_some());
        assert!(outcome.injected_paths.codex.is_some());
        assert!(outcome.injected_paths.opencode.is_some());

        // Second run: nothing should be re-downloaded (incremental skip).
        let outcome2 = sync_one(&source).await.expect("re-sync should succeed");
        eprintln!("second sync stats: {:?}", outcome2.stats);
        assert_eq!(
            outcome2.stats.files_updated, 0,
            "incremental run should download zero files, got {}",
            outcome2.stats.files_updated
        );
        assert!(
            outcome2.stats.files_skipped >= 4,
            "incremental run should skip the 4 known files, got {}",
            outcome2.stats.files_skipped
        );
    }
}
