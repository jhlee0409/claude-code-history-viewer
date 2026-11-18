//! Registering claude.ai account exports (#674).
//!
//! An export is added only through [`add_claude_ai_export`], which reads it
//! first: a path that is not a readable claude.ai export (zip or extracted
//! folder) is refused with the reason, and the stored path is the canonical
//! one the provider later reads. Removing an export forgets it and its parsed
//! copy; the export itself is never touched.

use crate::commands::metadata::{mutate_and_save, MetadataState};
use crate::models::{ClaudeAiExport, UserMetadata};
use crate::providers::claude_ai;
use serde::Serialize;
use std::path::Path;
use tauri::State;

/// The saved metadata and what the added export holds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAiExportAdded {
    pub metadata: UserMetadata,
    pub conversations: usize,
    pub projects: usize,
}

fn same_path(a: &str, b: &str) -> bool {
    a.trim_end_matches(['/', '\\']) == b.trim_end_matches(['/', '\\'])
}

/// The canonical form of a path the user chose: absolute, not itself a
/// symbolic link, with every folder on the way resolved.
fn canonical_export_path(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    // A trailing separator would make a zip's path unreadable.
    let raw = match raw.trim_end_matches(['/', '\\']) {
        "" => raw,
        trimmed => trimmed,
    };
    crate::utils::require_absolute_path(raw, "claude.ai export path")?;
    let path = Path::new(raw);
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "claude.ai export must not be a symbolic link: {}",
            path.display()
        ));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Cannot resolve {}: {e}", path.display()))?;
    Ok(crate::utils::strip_windows_extended_prefix(&canonical)
        .to_string_lossy()
        .to_string())
}

/// Read the export at `path` and register it (or relabel it, when it is
/// already registered).
pub(crate) async fn add_claude_ai_export_in(
    state: &MetadataState,
    path: String,
    label: Option<String>,
) -> Result<ClaudeAiExportAdded, String> {
    let (stored, summary) = tauri::async_runtime::spawn_blocking(move || {
        let stored = canonical_export_path(&path)?;
        let summary = claude_ai::inspect(Path::new(&stored))?;
        Ok::<_, String>((stored, summary))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;
    let label = label
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty());
    let metadata = mutate_and_save(state, move |metadata| {
        let exports = &mut metadata.settings.claude_ai_exports;
        match exports.iter_mut().find(|e| same_path(&e.path, &stored)) {
            Some(existing) => existing.label = label,
            None => exports.push(ClaudeAiExport {
                path: stored,
                label,
            }),
        }
    })
    .await?;
    Ok(ClaudeAiExportAdded {
        metadata,
        conversations: summary.conversations,
        projects: summary.projects,
    })
}

/// Forget an export. The export file or folder is left as it is.
pub(crate) async fn remove_claude_ai_export_in(
    state: &MetadataState,
    path: String,
) -> Result<UserMetadata, String> {
    let removed = path.clone();
    let metadata = mutate_and_save(state, move |metadata| {
        metadata
            .settings
            .claude_ai_exports
            .retain(|e| !same_path(&e.path, &removed));
    })
    .await?;
    claude_ai::forget(&path);
    Ok(metadata)
}

/// Register a claude.ai account export (zip or extracted folder) chosen in
/// the native dialog.
#[tauri::command]
pub async fn add_claude_ai_export(
    path: String,
    label: Option<String>,
    state: State<'_, MetadataState>,
) -> Result<ClaudeAiExportAdded, String> {
    add_claude_ai_export_in(state.inner(), path, label).await
}

/// Remove a registered claude.ai account export from Settings.
#[tauri::command]
pub async fn remove_claude_ai_export(
    path: String,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    remove_claude_ai_export_in(state.inner(), path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::claude_ai::test_support::write_export_zip;
    use crate::test_utils::SandboxHome;
    use serial_test::serial;

    fn persisted_exports() -> Vec<ClaudeAiExport> {
        let path = crate::commands::metadata::get_user_data_path().unwrap();
        std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str::<UserMetadata>(&content).ok())
            .map(|m| m.settings.claude_ai_exports)
            .unwrap_or_default()
    }

    #[tokio::test]
    #[serial]
    async fn an_export_is_read_then_registered_relabelled_and_removed() {
        let home = SandboxHome::new();
        let path = home.path().join("data-2026-11-18.zip");
        write_export_zip(&path);
        let stored = path.to_string_lossy().to_string();
        let state = MetadataState::default();

        let added =
            add_claude_ai_export_in(&state, format!("{stored}/"), Some(" Personal ".into()))
                .await
                .unwrap();
        assert_eq!((added.conversations, added.projects), (4, 3));
        let expected = vec![ClaudeAiExport {
            path: stored.clone(),
            label: Some("Personal".to_string()),
        }];
        assert_eq!(added.metadata.settings.claude_ai_exports, expected);
        assert_eq!(persisted_exports(), expected);

        // Adding the same export again relabels it rather than listing it twice.
        let again = add_claude_ai_export_in(&state, stored.clone(), None)
            .await
            .unwrap();
        assert_eq!(
            again.metadata.settings.claude_ai_exports,
            vec![ClaudeAiExport {
                path: stored.clone(),
                label: None
            }]
        );

        let removed = remove_claude_ai_export_in(&state, stored).await.unwrap();
        assert_eq!(removed.settings.claude_ai_exports, Vec::new());
        assert_eq!(persisted_exports(), Vec::new());
        assert!(path.is_file(), "removing an export never deletes it");
    }

    #[tokio::test]
    #[serial]
    async fn a_path_that_is_not_an_export_is_refused_and_not_saved() {
        let home = SandboxHome::new();
        let state = MetadataState::default();
        let empty = home.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();

        for path in [
            "relative/export.zip".to_string(),
            home.path()
                .join("missing.zip")
                .to_string_lossy()
                .to_string(),
            empty.to_string_lossy().to_string(),
        ] {
            assert!(
                add_claude_ai_export_in(&state, path.clone(), None)
                    .await
                    .is_err(),
                "{path}"
            );
        }
        assert_eq!(persisted_exports(), Vec::new());
    }
}
