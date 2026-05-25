//! Sync engine: pull whitelisted files from a remote SSH source into the
//! local cache directory, doing `(size, mtime)` incremental skipping.
//!
//! Cache layout per source. Each remote provider root that survives glob
//! expansion gets its own discriminator subdirectory so multiple workers on
//! the same host don't overwrite each other:
//! ```text
//! ~/.claude-history-viewer/remote-cache/<host>__<id-prefix>/
//!   .claude/<discriminator>/projects/<project>/<session>.jsonl
//!   .codex/<discriminator>/sessions/<...>/<rollout>.jsonl
//!   opencode/<discriminator>/{opencode.db, storage/, snapshot/}
//! ```
//! `<discriminator>` is the basename of the parent of the matched remote root
//! — e.g. `~/.cc-slack-data/dbg/.claude` → `dbg`. Each provider subdir is
//! registered as its own `customClaudePath` by the frontend so the existing
//! scanner picks it up unmodified.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::remote::sftp_client::SftpSession;
use crate::remote::source::{
    default_paths_for, expand_globs, expand_tilde, sync_whitelist, ProviderKind, RemoteSource,
    RemoteSyncStats, RemoteSystemKind,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub source_id: String,
    pub stats: RemoteSyncStats,
    pub injected_paths: InjectedPaths,
    /// Configured paths the user supplied that produced no synced files.
    /// Surfaced in the UI so the user can tell when their override is wrong
    /// (e.g. typo, container moved, no AI history yet).
    pub missing_paths: Vec<MissingPath>,
}

/// Local provider-root cache dirs that should be registered as additional
/// scan paths. Each entry is one matched remote root.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectedPaths {
    pub claude: Vec<InjectedRoot>,
    pub codex: Vec<InjectedRoot>,
    pub opencode: Vec<InjectedRoot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectedRoot {
    /// Absolute local path that the frontend should add to `customClaudePaths`.
    pub local_path: String,
    /// Human-readable discriminator (e.g. `dbg`) for use in UI labels.
    pub discriminator: String,
    /// Original remote root this cache mirrors. Useful for debugging in toasts.
    pub remote_path: String,
    /// Source identity to attach to projects scanned from this injected root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<HistorySource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySource {
    pub id: String,
    pub kind: String,
    pub display_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingPath {
    /// `"claude"` / `"codex"` / `"opencode"`.
    pub provider: String,
    /// The path string as the user typed it (or the default that was applied).
    pub configured_path: String,
    pub reason: MissingReason,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MissingReason {
    /// Glob expansion produced zero matches on the remote filesystem.
    NotFound,
    /// At least one matched root existed but contained no whitelisted files.
    Empty,
}

/// Returns the local cache root for one remote source.
fn local_cache_root(source: &RemoteSource) -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not locate user home directory")?;
    let sanitised_host = source.host.replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '.' && c != '_',
        "_",
    );
    let id_prefix = sanitize_segment(&source.id);
    let id_prefix = if id_prefix.is_empty() {
        "unknown".to_string()
    } else {
        id_prefix.chars().take(32).collect()
    };
    Ok(home
        .join(".claude-history-viewer")
        .join("remote-cache")
        .join(format!("{sanitised_host}__{id_prefix}")))
}

/// Filesystem-safe slug derived from one path segment. Anything outside
/// `[A-Za-z0-9._-]` collapses to `_` so a discriminator like
/// `worker example dev` becomes `worker_example_dev`.
fn sanitize_segment(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Pick a human-friendly subdir name distinguishing this remote root from
/// other matched roots in the same provider. Uses the basename of the parent
/// of the provider root — for `~/.cc-slack-data/dbg/.claude` that's `dbg`,
/// for `~/.claude` it's the home dir's basename (typically the username).
fn discriminator_for(remote_root: &str) -> String {
    let segments: Vec<&str> = remote_root
        .split(['/', '\\'])
        .filter(|s| !s.is_empty())
        .collect();
    // segments.last() is the provider root (e.g. ".claude"); we want the one
    // before that.
    let parent = segments.iter().rev().nth(1).copied().unwrap_or("default");
    let sanitised = sanitize_segment(parent);
    if sanitised.is_empty() {
        "default".to_string()
    } else {
        sanitised
    }
}

/// Append `__2`, `__3`, … if `base` collides with an already-used discriminator
/// within this provider's sync run. Pure function — keeps `sync_one` readable.
fn unique_discriminator(base: &str, used: &HashSet<String>) -> String {
    if !used.contains(base) {
        return base.to_string();
    }
    for i in 2..=1000 {
        let candidate = format!("{base}__{i}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    // Effectively unreachable — 1000+ remote roots with the same parent name
    // is so far outside the design envelope that giving up is fine.
    format!("{base}__overflow")
}

#[derive(Debug, Clone)]
struct RootCandidate {
    provider: ProviderKind,
    path: String,
    configured_path: String,
    source: Option<HistorySource>,
    report_missing: bool,
    register_if_cached: bool,
}

#[derive(Debug, Clone)]
struct PodmanContainer {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PodmanManifestEntry {
    rel_path: String,
    size: u64,
    mtime_secs: u64,
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn provider_cache_subdir(provider: ProviderKind) -> &'static str {
    match provider {
        ProviderKind::Claude => ".claude",
        ProviderKind::Codex => ".codex",
        ProviderKind::OpenCode => "opencode",
    }
}

fn validate_remote_relative_path(rel_path: &str) -> Result<()> {
    if rel_path.is_empty()
        || rel_path.starts_with('/')
        || rel_path.starts_with('\\')
        || rel_path.contains('\0')
        || rel_path.contains(':')
    {
        anyhow::bail!("unsafe remote relative path");
    }

    for segment in rel_path.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." {
            anyhow::bail!("unsafe remote relative path");
        }
    }

    let path = Path::new(rel_path);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir | Component::CurDir
            )
        })
    {
        anyhow::bail!("unsafe remote relative path");
    }

    Ok(())
}

async fn ensure_local_write_path_safe(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if let Ok(meta) = tokio::fs::symlink_metadata(&current).await {
            if meta.file_type().is_symlink() {
                anyhow::bail!("refusing to write through symlink: {}", current.display());
            }
        }
    }
    Ok(())
}

fn safe_join_remote_relative(base: &Path, rel_path: &str) -> Result<PathBuf> {
    validate_remote_relative_path(rel_path)?;
    Ok(base.join(rel_path))
}

fn is_nested_provider_root(remote_root: &str, provider: ProviderKind) -> bool {
    let provider_dir = provider_cache_subdir(provider);
    let mut segments = remote_root
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .rev();
    matches!(
        (segments.next(), segments.next()),
        (Some(child), Some(parent)) if child == provider_dir && parent == provider_dir
    )
}

fn provider_container_paths(
    provider: ProviderKind,
    container_home: &str,
    opencode_home: Option<&str>,
    xdg_data_home: Option<&str>,
) -> Vec<String> {
    match provider {
        ProviderKind::Claude => vec![expand_tilde(
            "~/.claude",
            container_home,
            RemoteSystemKind::Linux,
        )],
        ProviderKind::Codex => vec![expand_tilde(
            "~/.codex",
            container_home,
            RemoteSystemKind::Linux,
        )],
        ProviderKind::OpenCode => {
            let mut paths = Vec::new();
            if let Some(home) = opencode_home.filter(|s| !s.trim().is_empty()) {
                paths.push(home.trim().to_string());
            }
            if let Some(xdg) = xdg_data_home.filter(|s| !s.trim().is_empty()) {
                paths.push(format!("{}/opencode", xdg.trim().trim_end_matches('/')));
            }
            paths.push(expand_tilde(
                "~/.local/share/opencode",
                container_home,
                RemoteSystemKind::Linux,
            ));
            paths.push(expand_tilde(
                "~/.opencode",
                container_home,
                RemoteSystemKind::Linux,
            ));
            paths.sort();
            paths.dedup();
            paths
        }
    }
}

fn remote_endpoint_label(source: &RemoteSource) -> String {
    if source.port == 22 {
        format!("{}@{}", source.username, source.host)
    } else {
        format!("{}@{}:{}", source.username, source.host, source.port)
    }
}

fn podman_source_label(source: &RemoteSource, container: &PodmanContainer) -> String {
    format!(
        "Podman: {} @ {}",
        container.name,
        remote_endpoint_label(source)
    )
}

fn podman_manifest_path(
    cache_root: &Path,
    source: &RemoteSource,
    container: &PodmanContainer,
    provider: ProviderKind,
) -> PathBuf {
    cache_root
        .join(".podman-manifests")
        .join(sanitize_segment(&source.id))
        .join(sanitize_segment(&container.id))
        .join(format!("{}.json", provider.as_str()))
}

async fn write_podman_manifest(path: &Path, manifest: &[PodmanManifestEntry]) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let content = serde_json::to_string_pretty(manifest)?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, content).await?;
    if tokio::fs::try_exists(path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(path).await;
    }
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

async fn podman_manifest(
    session: &SftpSession,
    container: &PodmanContainer,
    provider: ProviderKind,
    provider_root: &str,
) -> Result<Vec<PodmanManifestEntry>> {
    let script = match provider {
        ProviderKind::Claude => format!(
            "cd {} 2>/dev/null && find projects -type f -name '*.jsonl' -printf '%p\\t%s\\t%T@\\n'",
            shell_quote(provider_root)
        ),
        ProviderKind::Codex => format!(
            "cd {} 2>/dev/null && find sessions -type f -name '*.jsonl' -printf '%p\\t%s\\t%T@\\n'",
            shell_quote(provider_root)
        ),
        ProviderKind::OpenCode => format!(
            "cd {} 2>/dev/null && {{ for f in opencode.db opencode.db-wal opencode.db-shm; do [ -f \"$f\" ] && printf '%s\\t%s\\t%s\\n' \"$f\" \"$(stat -c %s \"$f\")\" \"$(stat -c %Y \"$f\")\"; done; find storage snapshot -type f -printf '%p\\t%s\\t%T@\\n' 2>/dev/null; }}",
            shell_quote(provider_root)
        ),
    };
    let command = format!(
        "podman exec {} sh -lc {}",
        shell_quote(&container.id),
        shell_quote(&script)
    );
    let output = session.exec_command(&command).await?;
    if output.exit_status != 0 && output.stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut entries = output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let rel_path = parts.next()?.trim().trim_start_matches("./").to_string();
            let size = parts.next()?.trim().parse::<u64>().ok()?;
            let mtime_raw = parts.next()?.trim();
            let mtime_secs = mtime_raw
                .split('.')
                .next()
                .unwrap_or(mtime_raw)
                .parse::<u64>()
                .ok()?;
            if rel_path.is_empty() || validate_remote_relative_path(&rel_path).is_err() {
                None
            } else {
                Some(PodmanManifestEntry {
                    rel_path,
                    size,
                    mtime_secs,
                })
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    entries.dedup_by(|a, b| a.rel_path == b.rel_path);
    Ok(entries)
}

async fn find_container_provider_root(
    session: &SftpSession,
    container: &PodmanContainer,
    provider: ProviderKind,
    container_home: &str,
    opencode_home: Option<&str>,
    xdg_data_home: Option<&str>,
) -> Result<Option<(String, Vec<PodmanManifestEntry>)>> {
    for candidate in
        provider_container_paths(provider, container_home, opencode_home, xdg_data_home)
    {
        let test_cmd = format!(
            "podman exec {} sh -lc {}",
            shell_quote(&container.id),
            shell_quote(&format!("test -e {}", shell_quote(&candidate)))
        );
        let exists = session.exec_command(&test_cmd).await?;
        if exists.exit_status != 0 {
            continue;
        }
        let manifest = podman_manifest(session, container, provider, &candidate).await?;
        if !manifest.is_empty() {
            return Ok(Some((candidate, manifest)));
        }
    }
    Ok(None)
}

async fn discover_podman_roots(
    source: &RemoteSource,
    session: &SftpSession,
    remote_home: &str,
    cache_root: &Path,
) -> Result<Vec<RootCandidate>> {
    if source.system != RemoteSystemKind::Linux {
        return Ok(Vec::new());
    }

    let output = session
        .exec_command(
            "command -v podman >/dev/null 2>&1 && podman ps --format '{{.ID}}\t{{.Names}}' || true",
        )
        .await?;
    if output.exit_status != 0 {
        log::warn!(
            "Podman discovery command exited with {} on {}: {}",
            output.exit_status,
            source.host,
            output.stderr.trim()
        );
        return Ok(Vec::new());
    }

    let containers = output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let id = parts.next()?.trim();
            let name = parts.next().unwrap_or(id).trim();
            if id.is_empty() {
                None
            } else {
                Some(PodmanContainer {
                    id: id.to_string(),
                    name: name.to_string(),
                })
            }
        })
        .collect::<Vec<_>>();

    let mut roots = Vec::new();
    for container in containers {
        let home_cmd = format!(
            "podman exec {} sh -lc {}",
            shell_quote(&container.id),
            shell_quote("printf '%s' \"$HOME\"")
        );
        let home_output = session.exec_command(&home_cmd).await?;
        if home_output.exit_status != 0 {
            continue;
        }
        let container_home = home_output.stdout.trim();
        if container_home.is_empty() {
            continue;
        }
        let env_cmd = format!(
            "podman exec {} sh -lc {}",
            shell_quote(&container.id),
            shell_quote("printf '%s\\t%s' \"${OPENCODE_HOME:-}\" \"${XDG_DATA_HOME:-}\"")
        );
        let env_output = session.exec_command(&env_cmd).await?;
        let mut env_parts = env_output.stdout.splitn(2, '\t');
        let opencode_home = env_parts.next().map(str::trim).filter(|s| !s.is_empty());
        let xdg_data_home = env_parts.next().map(str::trim).filter(|s| !s.is_empty());

        for provider in [
            ProviderKind::Claude,
            ProviderKind::Codex,
            ProviderKind::OpenCode,
        ] {
            let provider_dir = provider_cache_subdir(provider);
            let Some((expanded, manifest)) = find_container_provider_root(
                session,
                &container,
                provider,
                container_home,
                opencode_home,
                xdg_data_home,
            )
            .await?
            else {
                continue;
            };

            let test_cmd = format!(
                "podman exec {} sh -lc {}",
                shell_quote(&container.id),
                shell_quote(&format!("test -e {}", shell_quote(&expanded)))
            );
            let exists = session.exec_command(&test_cmd).await?;
            if exists.exit_status != 0 {
                continue;
            }

            let staging_root = format!(
                "{}/.claude-history-viewer/podman-staging/{}/{}/{}/{}",
                remote_home.trim_end_matches('/'),
                sanitize_segment(&source.id),
                sanitize_segment(&container.id),
                provider_dir,
                sanitize_segment(&container.name)
            );
            let manifest_path = podman_manifest_path(cache_root, source, &container, provider);
            let changed_files = manifest.clone();

            let clear_cmd = format!(
                "rm -rf {dest} && mkdir -p {dest}",
                dest = shell_quote(&staging_root),
            );
            let cleared = session.exec_command(&clear_cmd).await?;
            if cleared.exit_status != 0 {
                log::warn!(
                    "Podman staging reset failed for {}:{} on {}: {}",
                    container.name,
                    expanded,
                    source.host,
                    cleared.stderr.trim()
                );
                continue;
            }

            for entry in &changed_files {
                if validate_remote_relative_path(&entry.rel_path).is_err() {
                    log::warn!(
                        "Skipping unsafe Podman manifest path for {} on {}: {}",
                        container.name,
                        source.host,
                        entry.rel_path
                    );
                    continue;
                }
                let remote_file = format!(
                    "{}/{}",
                    expanded.trim_end_matches('/'),
                    entry.rel_path.trim_start_matches('/')
                );
                let staging_file = format!(
                    "{}/{}",
                    staging_root.trim_end_matches('/'),
                    entry.rel_path.trim_start_matches('/')
                );
                let copy_cmd = format!(
                    "mkdir -p {parent} && podman cp {container}:{src} {dest}",
                    parent = shell_quote(
                        staging_file
                            .rsplit_once('/')
                            .map_or(staging_root.as_str(), |(parent, _)| parent)
                    ),
                    container = shell_quote(&container.id),
                    src = shell_quote(&remote_file),
                    dest = shell_quote(&staging_file),
                );
                let copied = session.exec_command(&copy_cmd).await?;
                if copied.exit_status != 0 {
                    log::warn!(
                        "Podman copy failed for {}:{} on {}: {}",
                        container.name,
                        remote_file,
                        source.host,
                        copied.stderr.trim()
                    );
                }
            }
            write_podman_manifest(&manifest_path, &manifest).await?;

            let source_id = format!("{}:podman:{}", source.id, container.id);
            roots.push(RootCandidate {
                provider,
                path: staging_root,
                configured_path: format!("podman:{}:{}", container.name, expanded),
                source: Some(HistorySource {
                    id: source_id,
                    kind: "podman-container".to_string(),
                    display_label: podman_source_label(source, &container),
                    debug_label: Some(format!(
                        "{}@{}:{} / podman / {}",
                        source.username, source.host, source.port, container.name
                    )),
                }),
                report_missing: false,
                register_if_cached: true,
            });
        }
    }

    Ok(roots)
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

    let user_paths = source.paths.clone().unwrap_or_default();
    let defaults = default_paths_for(source.system);

    // Required(...).unwrap() pattern is fine here because default_paths_for
    // always populates every provider; this would fire only if someone
    // hand-edited the constant to leave a None.
    let claude_paths = user_paths
        .claude
        .or(defaults.claude)
        .unwrap_or_else(|| vec!["~/.claude".to_string()]);
    let codex_paths = user_paths
        .codex
        .or(defaults.codex)
        .unwrap_or_else(|| vec!["~/.codex".to_string()]);
    let opencode_paths = user_paths
        .opencode
        .or(defaults.opencode)
        .unwrap_or_else(|| vec!["~/.local/share/opencode".to_string()]);

    let podman_roots = if source.podman_enabled() {
        discover_podman_roots(source, &session, &remote_home, &cache_root)
            .await
            .unwrap_or_else(|e| {
                log::warn!(
                    "Podman discovery failed for {}@{}:{}: {e}",
                    source.username,
                    source.host,
                    source.port
                );
                Vec::new()
            })
    } else {
        Vec::new()
    };

    let mut stats = RemoteSyncStats::default();
    let mut injected = InjectedPaths::default();
    let mut missing: Vec<MissingPath> = Vec::new();

    for wl in sync_whitelist() {
        let (configured_paths, provider_subdir): (&Vec<String>, &str) = match wl.provider {
            ProviderKind::Claude => (&claude_paths, ".claude"),
            ProviderKind::Codex => (&codex_paths, ".codex"),
            ProviderKind::OpenCode => (&opencode_paths, "opencode"),
        };
        let mut candidates: Vec<RootCandidate> = configured_paths
            .iter()
            .map(|path| RootCandidate {
                provider: wl.provider,
                path: expand_tilde(path, &remote_home, source.system),
                configured_path: path.clone(),
                source: None,
                report_missing: true,
                register_if_cached: false,
            })
            .collect();
        candidates.extend(
            podman_roots
                .iter()
                .filter(|root| root.provider == wl.provider)
                .cloned(),
        );
        let provider_cache_root = cache_root.join(provider_subdir);
        let mut used_discriminators: HashSet<String> = HashSet::new();

        for candidate in candidates {
            let resolved = candidate.path.clone();
            let session_ref = &session;
            let matched = expand_globs(&resolved, source.system, |dir| async move {
                session_ref.read_dir_names(&dir).await
            })
            .await;

            if matched.is_empty() {
                if candidate.report_missing {
                    missing.push(MissingPath {
                        provider: wl.provider.as_str().to_string(),
                        configured_path: candidate.configured_path.clone(),
                        reason: MissingReason::NotFound,
                    });
                }
                continue;
            }

            let mut configured_synced_any = false;
            for remote_root in matched {
                if is_nested_provider_root(&remote_root, wl.provider) {
                    continue;
                }

                // Race guard: glob expansion saw the dir in its parent listing,
                // but it may have been deleted before we stat it directly.
                if session.stat_optional(&remote_root).await.is_none() {
                    continue;
                }

                let base_discriminator = discriminator_for(&remote_root);
                let discriminator = unique_discriminator(&base_discriminator, &used_discriminators);
                let local_root = provider_cache_root.join(&discriminator);

                let mut root_synced_any = false;
                for include in wl.include {
                    let remote_target =
                        format!("{}/{}", remote_root.trim_end_matches(['/', '\\']), include);
                    let local_target = local_root.join(include);

                    let Some(attrs) = session.stat_optional(&remote_target).await else {
                        continue;
                    };
                    let permissions = attrs.permissions.unwrap_or(0);
                    // POSIX: top 4 bits encode the file type. 0o040000 = directory.
                    let is_dir = permissions & 0o170_000 == 0o040_000;

                    if is_dir {
                        let files = session
                            .list_recursive(&remote_target, wl.extension_filter)
                            .await?;
                        stats.files_total = stats.files_total.saturating_add(files.len() as u64);
                        for f in files {
                            let local_path = safe_join_remote_relative(&local_target, &f.rel_path)?;
                            ensure_local_write_path_safe(&local_path).await?;
                            if file_unchanged(&local_path, f.size, f.mtime_secs).await {
                                stats.files_skipped = stats.files_skipped.saturating_add(1);
                            } else {
                                let bytes = session.download_file(&f.abs_path, &local_path).await?;
                                stats.files_updated = stats.files_updated.saturating_add(1);
                                stats.bytes_transferred =
                                    stats.bytes_transferred.saturating_add(bytes);
                            }
                            // Always (re-)stamp mtime, even when skipping. This
                            // gives fresh downloads the right value AND repairs
                            // files stamped under earlier sync strategies.
                            let mtime_to_set = pick_mtime(&local_path, f.mtime_secs);
                            let _ = set_local_mtime(&local_path, mtime_to_set).await;
                            root_synced_any = true;
                        }
                    } else {
                        stats.files_total = stats.files_total.saturating_add(1);
                        let local_path = local_target;
                        ensure_local_write_path_safe(&local_path).await?;
                        let size = attrs.size.unwrap_or(0);
                        let mtime = u64::from(attrs.mtime.unwrap_or(0));
                        if file_unchanged(&local_path, size, mtime).await {
                            stats.files_skipped = stats.files_skipped.saturating_add(1);
                        } else {
                            let bytes = session.download_file(&remote_target, &local_path).await?;
                            stats.files_updated = stats.files_updated.saturating_add(1);
                            stats.bytes_transferred = stats.bytes_transferred.saturating_add(bytes);
                        }
                        let mtime_to_set = pick_mtime(&local_path, mtime);
                        let _ = set_local_mtime(&local_path, mtime_to_set).await;
                        root_synced_any = true;
                    }
                }

                if root_synced_any || (candidate.register_if_cached && local_root.exists()) {
                    used_discriminators.insert(discriminator.clone());
                    let injection = InjectedRoot {
                        local_path: local_root.to_string_lossy().into_owned(),
                        discriminator,
                        remote_path: remote_root.clone(),
                        source: candidate.source.clone(),
                    };
                    match wl.provider {
                        ProviderKind::Claude => injected.claude.push(injection),
                        ProviderKind::Codex => injected.codex.push(injection),
                        ProviderKind::OpenCode => injected.opencode.push(injection),
                    }
                    configured_synced_any = true;
                }
            }

            if candidate.report_missing && !configured_synced_any {
                missing.push(MissingPath {
                    provider: wl.provider.as_str().to_string(),
                    configured_path: candidate.configured_path.clone(),
                    reason: MissingReason::Empty,
                });
            }
        }
    }

    stats.duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    Ok(SyncOutcome {
        source_id: source.id.clone(),
        stats,
        injected_paths: injected,
        missing_paths: missing,
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
mod unit_tests {
    use super::*;

    #[test]
    fn discriminator_picks_parent_basename_linux() {
        assert_eq!(
            discriminator_for("/home/user/.cc-slack-data/dbg/.claude"),
            "dbg"
        );
        assert_eq!(discriminator_for("/home/user/.claude"), "user");
    }

    #[test]
    fn discriminator_picks_parent_basename_windows() {
        assert_eq!(
            discriminator_for("C:\\Users\\foo\\.cc-slack-data\\worker-A\\.claude"),
            "worker-A"
        );
        assert_eq!(discriminator_for("C:\\Users\\foo\\.claude"), "foo");
    }

    #[test]
    fn discriminator_sanitises_unsafe_chars() {
        assert_eq!(
            discriminator_for("/srv/worker example dev/.claude"),
            "worker_example_dev"
        );
    }

    #[test]
    fn discriminator_collision_appends_suffix() {
        let mut used: HashSet<String> = HashSet::new();
        used.insert("dbg".to_string());
        used.insert("dbg__2".to_string());
        assert_eq!(unique_discriminator("dbg", &used), "dbg__3");
        assert_eq!(unique_discriminator("worker", &used), "worker");
    }

    #[test]
    fn nested_provider_root_is_rejected() {
        assert!(is_nested_provider_root(
            "/home/user/.claude/.claude",
            ProviderKind::Claude
        ));
        assert!(is_nested_provider_root(
            "C:\\Users\\foo\\.codex\\.codex",
            ProviderKind::Codex
        ));
        assert!(is_nested_provider_root(
            "/home/user/opencode/opencode",
            ProviderKind::OpenCode
        ));
        assert!(!is_nested_provider_root(
            "/home/user/.cc-slack-data/dbg/.claude",
            ProviderKind::Claude
        ));
        assert!(!is_nested_provider_root(
            "/home/user/.claude",
            ProviderKind::Claude
        ));
    }

    #[test]
    fn remote_relative_path_rejects_traversal_and_absolute_paths() {
        assert!(validate_remote_relative_path("projects/foo/session.jsonl").is_ok());
        assert!(validate_remote_relative_path("../escape.jsonl").is_err());
        assert!(validate_remote_relative_path("projects/../escape.jsonl").is_err());
        assert!(validate_remote_relative_path("/tmp/escape.jsonl").is_err());
        assert!(validate_remote_relative_path("\\tmp\\escape.jsonl").is_err());
        assert!(validate_remote_relative_path("C:\\Users\\escape.jsonl").is_err());
        assert!(validate_remote_relative_path("projects//escape.jsonl").is_err());
    }
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
    //! `~/.local/share/opencode/`, **plus** a `~/.cc-slack-data/<worker>/`
    //! tree to exercise the multi-tenant glob default.

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
                passphrase_ref: None,
                passphrase: None,
            },
            paths: None,
            podman: None,
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
        eprintln!("missing: {:?}", outcome.missing_paths);

        // With the cc-slack default glob in place, the standard fixture path
        // (`~/.claude/projects/...`) is now reached via the second default,
        // and any seeded `~/.cc-slack-data/<worker>/.claude` shows up under
        // its own discriminator.
        assert!(
            !outcome.injected_paths.claude.is_empty(),
            "expected at least one injected claude root"
        );

        // Decoys that must NEVER cross the wire.
        let forbidden = [
            ".claude/credentials.json",
            ".claude/cache/big.bin",
            ".claude/debug/dump.log",
        ];
        for entry in &outcome.injected_paths.claude {
            for rel in forbidden {
                let p = std::path::Path::new(&entry.local_path).join(rel);
                assert!(
                    !p.exists(),
                    "decoy file should not have been synced: {}",
                    p.display()
                );
            }
        }
    }
}
