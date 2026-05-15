//! Backup and restore helpers for AI conversation history.

use crate::models::ProjectSource;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::command;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBackupRoot {
    pub provider: String,
    pub label: String,
    pub relative_path: String,
    pub source: Option<ProjectSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBackupManifest {
    pub version: u32,
    pub exported_at: String,
    pub roots: Vec<HistoryBackupRoot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBackupResult {
    pub backup_path: String,
    pub roots: Vec<HistoryBackupRoot>,
    pub files_copied: usize,
    pub bytes_copied: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredHistoryRoot {
    pub provider: String,
    pub path: String,
    pub label: String,
    pub source: Option<ProjectSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRestoreResult {
    pub restored_path: String,
    pub roots: Vec<RestoredHistoryRoot>,
    pub files_copied: usize,
    pub bytes_copied: u64,
}

#[derive(Default)]
struct CopyStats {
    files: usize,
    bytes: u64,
}

fn app_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer"))
}

fn safe_backup_name() -> String {
    Utc::now()
        .format("cchv-history-backup-%Y%m%d-%H%M%S")
        .to_string()
}

fn copy_dir_recursive(src: &Path, dest: &Path, stats: &mut CopyStats) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    if !src.is_dir() {
        return Err(format!("Source is not a directory: {}", src.display()));
    }
    for entry in WalkDir::new(src).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        let rel = entry.path().strip_prefix(src).map_err(|e| e.to_string())?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = dest.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let bytes = fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
            stats.files += 1;
            stats.bytes = stats.bytes.saturating_add(bytes);
        }
    }
    Ok(())
}

fn copy_file_if_exists(src: &Path, dest: &Path, stats: &mut CopyStats) -> Result<(), String> {
    if !src.is_file() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = fs::copy(src, dest).map_err(|e| e.to_string())?;
    stats.files += 1;
    stats.bytes = stats.bytes.saturating_add(bytes);
    Ok(())
}

fn copy_claude_history(src: &Path, dest: &Path, stats: &mut CopyStats) -> Result<(), String> {
    copy_dir_recursive(&src.join("projects"), &dest.join("projects"), stats)
}

fn copy_codex_history(src: &Path, dest: &Path, stats: &mut CopyStats) -> Result<(), String> {
    copy_dir_recursive(&src.join("sessions"), &dest.join("sessions"), stats)?;
    copy_dir_recursive(
        &src.join("archived_sessions"),
        &dest.join("archived_sessions"),
        stats,
    )
}

fn copy_opencode_history(src: &Path, dest: &Path, stats: &mut CopyStats) -> Result<(), String> {
    for name in ["opencode.db", "opencode.db-wal", "opencode.db-shm"] {
        copy_file_if_exists(&src.join(name), &dest.join(name), stats)?;
    }
    copy_dir_recursive(&src.join("storage"), &dest.join("storage"), stats)?;
    copy_dir_recursive(&src.join("snapshot"), &dest.join("snapshot"), stats)
}

fn write_manifest(path: &Path, manifest: &HistoryBackupManifest) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(path.join("manifest.json"), content).map_err(|e| e.to_string())
}

fn read_manifest(path: &Path) -> Result<HistoryBackupManifest, String> {
    let content = fs::read_to_string(path.join("manifest.json")).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn resolve_backup_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(relative_path);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("Invalid backup root path: {relative_path}"));
    }
    Ok(root.join(rel_path))
}

fn add_root(
    roots: &mut Vec<HistoryBackupRoot>,
    provider: &str,
    label: &str,
    relative_path: &str,
    source: Option<ProjectSource>,
) {
    roots.push(HistoryBackupRoot {
        provider: provider.to_string(),
        label: label.to_string(),
        relative_path: relative_path.replace('\\', "/"),
        source,
    });
}

fn collect_remote_roots(
    backup_root: &Path,
    roots: &mut Vec<HistoryBackupRoot>,
    stats: &mut CopyStats,
) -> Result<(), String> {
    let remote_cache = app_data_dir()?.join("remote-cache");
    if !remote_cache.is_dir() {
        return Ok(());
    }

    let dest = backup_root.join("remote-cache");
    copy_dir_recursive(&remote_cache, &dest, stats)?;

    for entry in WalkDir::new(&dest)
        .min_depth(2)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir())
    {
        let path = entry.path();
        let Some(parent_name) = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
        else {
            continue;
        };
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        let provider = match parent_name {
            ".claude" => Some("claude"),
            ".codex" => Some("codex"),
            "opencode" => Some("opencode"),
            _ => None,
        };
        if let Some(provider) = provider {
            let rel = path.strip_prefix(backup_root).map_err(|e| e.to_string())?;
            add_root(
                roots,
                provider,
                &format!("Remote {provider}: {file_name}"),
                &rel.to_string_lossy(),
                Some(ProjectSource {
                    id: format!("restored-remote:{provider}:{file_name}"),
                    kind: "restored-remote".to_string(),
                    display_label: format!("Restored remote {provider}: {file_name}"),
                    debug_label: None,
                }),
            );
        }
    }
    Ok(())
}

#[command]
pub async fn export_history_backup(path: String) -> Result<HistoryBackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let destination = PathBuf::from(path);
        if !destination.is_absolute() {
            return Err("Destination directory must be absolute".to_string());
        }
        fs::create_dir_all(&destination).map_err(|e| e.to_string())?;

        let backup_path = destination.join(safe_backup_name());
        fs::create_dir_all(&backup_path).map_err(|e| e.to_string())?;

        let mut roots = Vec::new();
        let mut stats = CopyStats::default();

        if let Some(path) = crate::providers::claude::get_base_path() {
            copy_claude_history(
                Path::new(&path),
                &backup_path.join("providers/.claude"),
                &mut stats,
            )?;
            add_root(
                &mut roots,
                "claude",
                "Claude Code",
                "providers/.claude",
                None,
            );
        }
        if let Some(path) = crate::providers::codex::get_base_path() {
            copy_codex_history(
                Path::new(&path),
                &backup_path.join("providers/.codex"),
                &mut stats,
            )?;
            add_root(&mut roots, "codex", "Codex CLI", "providers/.codex", None);
        }
        if let Some(path) = crate::providers::opencode::get_base_path() {
            copy_opencode_history(
                Path::new(&path),
                &backup_path.join("providers/opencode"),
                &mut stats,
            )?;
            add_root(
                &mut roots,
                "opencode",
                "OpenCode",
                "providers/opencode",
                None,
            );
        }

        collect_remote_roots(&backup_path, &mut roots, &mut stats)?;

        let manifest = HistoryBackupManifest {
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            roots: roots.clone(),
        };
        write_manifest(&backup_path, &manifest)?;

        Ok(HistoryBackupResult {
            backup_path: backup_path.to_string_lossy().to_string(),
            roots,
            files_copied: stats.files,
            bytes_copied: stats.bytes,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[command]
pub async fn restore_history_backup(path: String) -> Result<HistoryRestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(path);
        if !source.is_absolute() {
            return Err("Backup directory must be absolute".to_string());
        }
        let manifest = read_manifest(&source)?;

        let restore_root = app_data_dir()?
            .join("restored-backups")
            .join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
        fs::create_dir_all(&restore_root).map_err(|e| e.to_string())?;

        let mut stats = CopyStats::default();
        copy_dir_recursive(&source, &restore_root, &mut stats)?;

        let roots = manifest
            .roots
            .into_iter()
            .map(|root| {
                let restored_path =
                    resolve_backup_relative_path(&restore_root, &root.relative_path)?;
                Ok(RestoredHistoryRoot {
                    provider: root.provider,
                    path: restored_path.to_string_lossy().to_string(),
                    label: format!("Restored: {}", root.label),
                    source: root.source.or_else(|| {
                        Some(ProjectSource {
                            id: format!("restored:{}", root.relative_path),
                            kind: "restored-backup".to_string(),
                            display_label: format!("Restored: {}", root.label),
                            debug_label: Some(restore_root.to_string_lossy().to_string()),
                        })
                    }),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(HistoryRestoreResult {
            restored_path: restore_root.to_string_lossy().to_string(),
            roots,
            files_copied: stats.files,
            bytes_copied: stats.bytes,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_history_copy_uses_whitelist() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join(".claude");
        fs::create_dir_all(source.join("projects/project-a")).unwrap();
        fs::create_dir_all(source.join("cache")).unwrap();
        fs::write(source.join("projects/project-a/session.jsonl"), "{}\n").unwrap();
        fs::write(source.join("auth.json"), "secret").unwrap();
        fs::write(source.join("cache/blob"), "cache").unwrap();

        let dest = tmp.path().join("backup/.claude");
        let mut stats = CopyStats::default();
        copy_claude_history(&source, &dest, &mut stats).unwrap();

        assert!(dest.join("projects/project-a/session.jsonl").is_file());
        assert!(!dest.join("auth.json").exists());
        assert!(!dest.join("cache/blob").exists());
        assert_eq!(stats.files, 1);
    }

    #[test]
    fn opencode_history_copy_skips_auth_and_logs() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("opencode");
        fs::create_dir_all(source.join("storage/session_diff")).unwrap();
        fs::create_dir_all(source.join("log")).unwrap();
        fs::write(source.join("opencode.db"), "db").unwrap();
        fs::write(source.join("auth.json"), "secret").unwrap();
        fs::write(source.join("log/debug.log"), "debug").unwrap();
        fs::write(source.join("storage/session_diff/a.json"), "{}").unwrap();

        let dest = tmp.path().join("backup/opencode");
        let mut stats = CopyStats::default();
        copy_opencode_history(&source, &dest, &mut stats).unwrap();

        assert!(dest.join("opencode.db").is_file());
        assert!(dest.join("storage/session_diff/a.json").is_file());
        assert!(!dest.join("auth.json").exists());
        assert!(!dest.join("log/debug.log").exists());
        assert_eq!(stats.files, 2);
    }

    #[test]
    fn manifest_relative_paths_cannot_escape_restore_root() {
        let root = Path::new("C:/restore/root");
        assert!(resolve_backup_relative_path(root, "providers/.claude").is_ok());
        assert!(resolve_backup_relative_path(root, "../outside").is_err());
        assert!(resolve_backup_relative_path(root, "/outside").is_err());
    }
}
