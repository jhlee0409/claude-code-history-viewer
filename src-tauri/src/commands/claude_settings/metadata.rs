//! Read-time evidence, not a writability/access grant. See docs/development/settings-metadata.md.
use super::AllSettings;
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::PathBuf};

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingsFileState {
    Present,
    Missing,
    ReadError,
    NoProject,
    Unsupported,
    ResolveError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeMetadata {
    pub path: Option<String>,
    pub state: SettingsFileState,
    /// Scope policy only. False does not promise that a save will succeed.
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsScopesMetadata {
    pub user: SettingsScopeMetadata,
    pub project: SettingsScopeMetadata,
    pub local: SettingsScopeMetadata,
    pub managed: SettingsScopeMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsMetadata {
    pub server_home: Option<String>,
    pub scopes: SettingsScopesMetadata,
}

/// Classify an unsuccessful target probe independently of raw legacy contents.
fn state_for_read_error(path: &std::path::Path, error: &std::io::Error) -> SettingsFileState {
    if error.kind() != std::io::ErrorKind::NotFound {
        return SettingsFileState::ReadError;
    }
    // Windows may report NotFound when an ancestor is a file, whereas Unix
    // reports NotADirectory. Establish the nearest existing parent before
    // treating this as ordinary absence. Only metadata is probed: no content
    // opens, canonicalized imaginary paths, directory creation or write grants.
    for ancestor in path.ancestors().skip(1) {
        match fs::metadata(ancestor) {
            Ok(meta) => {
                return if meta.is_dir() {
                    SettingsFileState::Missing
                } else {
                    SettingsFileState::ReadError
                };
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return SettingsFileState::ReadError,
        }
    }
    SettingsFileState::ReadError
}

/// Injection keeps fixtures independent of process environment and real managed files.
/// Production passes the same resolver used by `get_settings_by_scope` and `save_settings`.
pub(super) fn collect_settings(
    home: Option<PathBuf>,
    project: Option<&str>,
    managed_supported: bool,
    resolve: impl Fn(&str) -> Result<PathBuf, String>,
) -> AllSettings {
    let observe = |scope: &str| {
        let mut evidence = SettingsScopeMetadata {
            path: None,
            state: SettingsFileState::ResolveError,
            read_only: scope == "managed",
        };
        if matches!(scope, "project" | "local") && project.is_none() {
            evidence.state = SettingsFileState::NoProject;
            return (None, evidence);
        }
        if scope == "managed" && !managed_supported {
            evidence.state = SettingsFileState::Unsupported;
            return (None, evidence);
        }
        let Ok(path) = resolve(scope) else {
            return (None, evidence);
        };
        // Keep the resolver's write-target spelling, including missing parents.
        // Canonicalizing the final file here would mislabel an atomic-save target.
        evidence.path = Some(path.to_string_lossy().into_owned());
        match fs::metadata(&path) {
            Err(error) => {
                evidence.state = state_for_read_error(&path, &error);
                // Preserve read_settings_file's legacy exists() fallback, including
                // inaccessible or non-directory parents. Metadata retains the error.
                let legacy = (!path.exists()).then(|| "{}".to_string());
                (legacy, evidence)
            }
            Ok(meta) if !meta.is_file() => {
                evidence.state = SettingsFileState::ReadError;
                (None, evidence)
            }
            Ok(_) => {
                // Existing settings reads follow file symlinks. Resolve that alias
                // first, then reuse the regular-file reader's handle checks so a
                // FIFO/link swapped after the probe cannot block the command.
                let content = fs::canonicalize(&path)
                    .and_then(|canonical| {
                        super::super::stats::session_files::open_history_file(&canonical)
                    })
                    .and_then(|mut file| {
                        let mut text = String::new();
                        file.read_to_string(&mut text)?;
                        Ok(text)
                    })
                    .ok();
                evidence.state = if content.is_some() {
                    SettingsFileState::Present
                } else {
                    SettingsFileState::ReadError
                };
                (content, evidence)
            }
        }
    };
    let (user, user_meta) = observe("user");
    let (project, project_meta) = observe("project");
    let (local, local_meta) = observe("local");
    let (managed, managed_meta) = observe("managed");
    AllSettings {
        user,
        project,
        local,
        managed,
        metadata: Some(SettingsMetadata {
            server_home: home.map(|p| p.to_string_lossy().into_owned()),
            scopes: SettingsScopesMetadata {
                user: user_meta,
                project: project_meta,
                local: local_meta,
                managed: managed_meta,
            },
        }),
    }
}
