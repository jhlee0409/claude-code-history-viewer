//! Axum HTTP handlers that wrap existing Tauri command functions.
//!
//! Each handler deserializes JSON request body, calls the underlying command,
//! and returns the result as JSON. The command function signatures are unchanged.

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

use super::state::AppState;
use crate::commands;

// ─── History-root guard ───────────────────────────────────────────────────────

/// Caller-supplied session / project paths must sit under a configured history
/// root. Applied here, at the HTTP trust boundary, rather than in the commands,
/// which desktop also calls with paths from its own scans and folder picker.
fn require_history_path(path: &str) -> Result<(), String> {
    commands::session::is_safe_session_path(std::path::Path::new(path))
}

/// A Claude base directory (`~/.claude`-shaped) is accepted when its
/// `projects/` folder is a history root. Empty means "use the default".
fn require_claude_base(base: &str) -> Result<(), String> {
    if base.is_empty() {
        return Ok(());
    }
    require_history_path(
        &std::path::Path::new(base)
            .join("projects")
            .to_string_lossy(),
    )
}

fn require_claude_bases(
    base: Option<&str>,
    custom: Option<&[commands::multi_provider::CustomClaudePathParam]>,
) -> Result<(), String> {
    require_claude_base(base.unwrap_or_default())?;
    custom
        .unwrap_or_default()
        .iter()
        .try_for_each(|c| require_claude_base(&c.path))
}

// ─── Known-project guard ──────────────────────────────────────────────────────

/// The one message returned for any project directory the history does not
/// record, whether it exists or not.
const UNKNOWN_PROJECT_DIR: &str = "Project directory is not a known project";

/// How long a scanned list of known project directories is reused.
const KNOWN_PROJECTS_TTL: std::time::Duration = std::time::Duration::from_secs(30);

/// A miss rescans only if the list is at least this old, so a burst of
/// unknown paths costs one scan rather than one each.
const RESCAN_ON_MISS_AFTER: std::time::Duration = std::time::Duration::from_secs(5);

/// Whether the endpoint writes into the project directory.
#[derive(Clone, Copy, PartialEq)]
enum ProjectAccess {
    Read,
    Write,
}

struct KnownProjects {
    roots: Vec<PathBuf>,
    scanned_at: std::time::Instant,
    dirs: Vec<PathBuf>,
}

static KNOWN_PROJECTS: std::sync::Mutex<Option<KnownProjects>> = std::sync::Mutex::new(None);

/// Resolve symlinks when the path exists, then normalise for comparison.
fn comparable_path(path: &std::path::Path) -> PathBuf {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    commands::session::normalize_path_for_comparison(&resolved)
}

/// Whether `candidate` (already comparable) is the working directory of a
/// Claude project in one of the configured Claude directories — the same
/// `actual_path` values `scan_projects` hands the frontend.
///
/// Ceiling: a refresh is one `scan_projects` per Claude directory, the same
/// cost as the already-exposed `/scan_projects` endpoint. The list is reused
/// for `KNOWN_PROJECTS_TTL`; a miss rescans (so a project that just appeared
/// is accepted) at most once per `RESCAN_ON_MISS_AFTER`, which is also how
/// long a new project can be refused. The scan runs outside the lock, so
/// concurrent refreshes may each scan once; the last one is kept. If that
/// ever shows up in profiles, reuse the frontend's own scan result.
fn is_known_project_dir(candidate: &std::path::Path) -> bool {
    let roots = commands::session::allowed_claude_roots();
    {
        let cache = KNOWN_PROJECTS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(cached) = cache.as_ref().filter(|c| c.roots == roots) {
            let age = cached.scanned_at.elapsed();
            if age < KNOWN_PROJECTS_TTL && cached.dirs.iter().any(|d| d == candidate) {
                return true;
            }
            if age < RESCAN_ON_MISS_AFTER {
                return false;
            }
        }
    }
    let dirs: Vec<PathBuf> = roots
        .iter()
        .flat_map(|root| {
            commands::project::scan_projects_blocking(root.to_string_lossy().into_owned())
        })
        .map(|project| comparable_path(std::path::Path::new(&project.actual_path)))
        .collect();
    let known = dirs.iter().any(|d| d == candidate);
    *KNOWN_PROJECTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(KnownProjects {
        roots,
        scanned_at: std::time::Instant::now(),
        dirs,
    });
    known
}

/// Caller-supplied project directories (a repository working directory, not a
/// history path) must be one the history records. Symlinks are resolved first,
/// so a link to anywhere else is judged by its target. A recorded project whose
/// directory is gone can still be read (there is nothing there), but not
/// written, which would recreate it.
async fn require_known_project_dir(path: &str, access: ProjectAccess) -> Result<(), String> {
    let requested = std::path::Path::new(path).to_path_buf();
    let allowed = tauri::async_runtime::spawn_blocking(move || {
        let lexically_plain = requested.is_absolute()
            && !requested
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir));
        let present = requested.is_dir();
        lexically_plain
            && (present || access == ProjectAccess::Read)
            && is_known_project_dir(&comparable_path(&requested))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?;
    if allowed {
        Ok(())
    } else {
        Err(UNKNOWN_PROJECT_DIR.to_string())
    }
}

/// Settings scopes / MCP sources that read or write inside the project
/// directory. The others (`user`, `managed`, `user_*`) ignore `projectPath`,
/// which the frontend sends along regardless.
fn uses_project_dir(scope_or_source: &str) -> bool {
    matches!(
        scope_or_source,
        "project" | "local" | "project_mcp" | "local_claude_json"
    )
}

// ─── Error type ───────────────────────────────────────────────────────────────

/// Unified error response for API endpoints.
pub struct ApiError(String);

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": self.0 })),
        )
            .into_response()
    }
}

impl From<String> for ApiError {
    fn from(s: String) -> Self {
        Self(s)
    }
}

// ─── Macros for boilerplate reduction ─────────────────────────────────────────

/// Handler with no parameters.
macro_rules! handler_no_params {
    ($name:ident, $cmd:path) => {
        pub async fn $name() -> Result<Json<Value>, ApiError> {
            let result = $cmd().await.map_err(ApiError::from)?;
            Ok(Json(serde_json::to_value(result).map_err(|e| {
                ApiError(format!("Serialization error: {e}"))
            })?))
        }
    };
}

/// Handler with JSON body parameters (no state).
macro_rules! handler_json {
    ($name:ident, $params:ty, $body:expr) => {
        pub async fn $name(Json(p): Json<$params>) -> Result<Json<Value>, ApiError> {
            let result = $body(p).await.map_err(ApiError::from)?;
            Ok(Json(serde_json::to_value(result).map_err(|e| {
                ApiError(format!("Serialization error: {e}"))
            })?))
        }
    };
}

// ─── Parameter structs ────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathParam {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogParams {
    pub actual_path: String,
    pub limit: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudePathParam {
    pub claude_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathParam {
    pub project_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPathParam {
    pub session_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProjectSessionsParams {
    pub project_path: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProjectSessionsPageParams {
    pub project_path: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedParams {
    pub session_path: String,
    pub offset: usize,
    pub limit: usize,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCountParams {
    pub session_path: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    pub claude_path: String,
    pub query: String,
    #[serde(default)]
    pub filters: Value,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEditsParams {
    pub project_path: String,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
    /// Narrow the scan to a single session's JSONL file.
    #[serde(default)]
    pub session_file_path: Option<String>,
    /// "file" (default) for one row per file, "edit" for one row per edit.
    #[serde(default)]
    pub grouping: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFileParams {
    pub file_path: String,
    pub content: String,
    /// The project whose recorded edits authorise this write (#525).
    pub project_path: String,
    /// Narrows the authorising scan to one session, matching the panel's
    /// session scope.
    #[serde(default)]
    pub session_file_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdParam {
    pub id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokenStatsParams {
    pub session_path: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub stats_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTokenStatsParams {
    pub project_path: String,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub stats_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatsSummaryParams {
    pub project_path: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub stats_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionComparisonParams {
    pub session_id: String,
    pub project_path: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub stats_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStatsParams {
    #[serde(default)]
    pub claude_path: Option<String>,
    #[serde(default)]
    pub active_providers: Option<Vec<String>>,
    #[serde(default)]
    pub stats_mode: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub custom_claude_paths: Option<Vec<commands::multi_provider::CustomClaudePathParam>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeParams {
    pub scope: String,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsParams {
    pub scope: String,
    pub content: String,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionalProjectPath {
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMcpServersParams {
    pub source: String,
    pub servers: String,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileParams {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct SaveScreenshotParams {
    pub path: String,
    pub data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionParams {
    pub file_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSessionParams {
    pub file_path: String,
    pub new_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOpenCodeParams {
    pub session_path: String,
    pub new_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanAllProjectsParams {
    #[serde(default)]
    pub claude_path: Option<String>,
    #[serde(default)]
    pub active_providers: Option<Vec<String>>,
    #[serde(default)]
    pub custom_claude_paths: Option<Vec<commands::multi_provider::CustomClaudePathParam>>,
    #[serde(default)]
    pub wsl_enabled: Option<bool>,
    #[serde(default)]
    pub wsl_excluded_distros: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSessionsParams {
    pub provider: String,
    pub project_path: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSessionByPathParams {
    pub provider: String,
    pub project_path: String,
    pub file_path: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSessionsPageParams {
    pub provider: String,
    pub project_path: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMessagesParams {
    pub provider: String,
    pub session_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMessagesPaginatedParams {
    pub provider: String,
    pub session_path: String,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMessageOffsetParams {
    pub provider: String,
    pub session_path: String,
    pub message_uuid: String,
    #[serde(default)]
    pub exclude_sidechain: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllProvidersParams {
    #[serde(default)]
    pub claude_path: Option<String>,
    pub query: String,
    #[serde(default)]
    pub active_providers: Option<Vec<String>>,
    #[serde(default)]
    pub wsl_providers: Option<Vec<String>>,
    #[serde(default)]
    pub filters: Option<Value>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub custom_claude_paths: Option<Vec<commands::multi_provider::CustomClaudePathParam>>,
    #[serde(default)]
    pub wsl_enabled: Option<bool>,
    #[serde(default)]
    pub wsl_excluded_distros: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdParam {
    pub session_id: String,
    #[serde(default)]
    pub fallback_summary: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionMetadataParams {
    pub session_id: String,
    pub update: crate::models::SessionMetadata,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectMetadataParams {
    pub project_path: String,
    pub update: crate::models::ProjectMetadata,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpScopeParam {
    #[serde(default)]
    pub scope: Option<String>,
}

// ─── Handlers: NO PARAMS ──────────────────────────────────────────────────────

handler_no_params!(
    get_claude_folder_path,
    commands::project::get_claude_folder_path
);
handler_no_params!(
    detect_claude_config_dir,
    commands::project::detect_claude_config_dir
);
handler_no_params!(get_system_info, commands::feedback::get_system_info);
handler_no_params!(detect_providers, commands::multi_provider::detect_providers);
handler_no_params!(load_presets, commands::settings::load_presets);
handler_no_params!(load_mcp_presets, commands::mcp_presets::load_mcp_presets);
handler_no_params!(
    load_unified_presets,
    commands::unified_presets::load_unified_presets
);
handler_no_params!(
    get_metadata_folder_path,
    commands::metadata::get_metadata_folder_path
);

pub async fn get_server_config(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "readOnly": state.read_only,
    })))
}

/// Note: scope parameter is accepted for API contract compatibility but not used
/// by the underlying command (it always reads the global MCP config).
pub async fn get_mcp_servers(Json(_p): Json<McpScopeParam>) -> Result<Json<Value>, ApiError> {
    let result = commands::claude_settings::get_mcp_servers()
        .await
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::to_value(result).map_err(|e| {
        ApiError(format!("Serialization error: {e}"))
    })?))
}

// ─── Handlers: SIMPLE PARAMS ──────────────────────────────────────────────────

handler_json!(
    validate_claude_folder,
    PathParam,
    |p: PathParam| async move { commands::project::validate_claude_folder(p.path).await }
);

handler_json!(
    validate_custom_claude_dir,
    PathParam,
    |p: PathParam| async move { commands::project::validate_custom_claude_dir(p.path).await }
);

handler_json!(
    scan_projects,
    ClaudePathParam,
    |p: ClaudePathParam| async move {
        require_claude_base(&p.claude_path)?;
        commands::project::scan_projects(p.claude_path).await
    }
);

handler_json!(get_git_log, GitLogParams, |p: GitLogParams| async move {
    require_known_project_dir(&p.actual_path, ProjectAccess::Read).await?;
    commands::project::get_git_log(p.actual_path, p.limit).await
});

handler_json!(
    load_project_sessions,
    LoadProjectSessionsParams,
    |p: LoadProjectSessionsParams| async move {
        require_history_path(&p.project_path)?;
        commands::session::load_project_sessions(p.project_path, p.exclude_sidechain).await
    }
);

handler_json!(
    load_project_sessions_page,
    LoadProjectSessionsPageParams,
    |p: LoadProjectSessionsPageParams| async move {
        require_history_path(&p.project_path)?;
        commands::session::load_project_sessions_page(
            p.project_path,
            p.exclude_sidechain,
            p.offset,
            p.limit,
        )
        .await
    }
);

handler_json!(
    load_session_messages,
    SessionPathParam,
    |p: SessionPathParam| async move {
        require_history_path(&p.session_path)?;
        commands::session::load_session_messages(p.session_path).await
    }
);

handler_json!(
    load_session_messages_paginated,
    PaginatedParams,
    |p: PaginatedParams| async move {
        require_history_path(&p.session_path)?;
        commands::session::load_session_messages_paginated(
            p.session_path,
            p.offset,
            p.limit,
            p.exclude_sidechain,
        )
        .await
    }
);

handler_json!(
    get_session_message_count,
    MessageCountParams,
    |p: MessageCountParams| async move {
        require_history_path(&p.session_path)?;
        commands::session::get_session_message_count(p.session_path, p.exclude_sidechain).await
    }
);

handler_json!(
    get_session_subagents,
    SessionPathParam,
    |p: SessionPathParam| async move {
        require_history_path(&p.session_path)?;
        commands::session::get_session_subagents(p.session_path).await
    }
);

handler_json!(
    search_messages,
    SearchParams,
    |p: SearchParams| async move {
        require_claude_base(&p.claude_path)?;
        commands::session::search_messages(p.claude_path, p.query, p.filters, p.limit).await
    }
);

handler_json!(
    get_recent_edits,
    RecentEditsParams,
    |p: RecentEditsParams| async move {
        require_history_path(&p.project_path)?;
        if let Some(session) = &p.session_file_path {
            require_history_path(session)?;
        }
        commands::session::get_recent_edits(
            p.project_path,
            p.offset,
            p.limit,
            p.session_file_path,
            p.grouping,
        )
        .await
    }
);

// Write a file back to disk from a recorded edit.
//
// A plain `handler_json!` now: the decision no longer depends on how this
// server is bound.
//
// This used to gate on the bind address plus authentication, because the
// export allowlist does not cover a user's project directory and applying it
// unconditionally would have broken the feature. The command authorises
// against the project's recorded edit history instead (#525), which is both
// tighter and independent of the socket: the only writable paths are ones the
// session logs name as edit targets, on loopback and off it alike.
//
// Command-level validation (absolute path, no null bytes, no `..`, atomic
// write) still runs underneath.
handler_json!(
    restore_file,
    RestoreFileParams,
    |p: RestoreFileParams| async move {
        // The edit history that authorises the write must itself be history.
        require_history_path(&p.project_path)?;
        if let Some(session) = &p.session_file_path {
            require_history_path(session)?;
        }
        commands::session::restore_file(p.file_path, p.content, p.project_path, p.session_file_path)
            .await
    }
);

handler_json!(get_preset, IdParam, |p: IdParam| async move {
    commands::settings::get_preset(p.id).await
});

handler_json!(delete_preset, IdParam, |p: IdParam| async move {
    commands::settings::delete_preset(p.id).await
});

handler_json!(get_mcp_preset, IdParam, |p: IdParam| async move {
    commands::mcp_presets::get_mcp_preset(p.id).await
});

handler_json!(delete_mcp_preset, IdParam, |p: IdParam| async move {
    commands::mcp_presets::delete_mcp_preset(p.id).await
});

handler_json!(get_unified_preset, IdParam, |p: IdParam| async move {
    commands::unified_presets::get_unified_preset(p.id).await
});

handler_json!(delete_unified_preset, IdParam, |p: IdParam| async move {
    commands::unified_presets::delete_unified_preset(p.id).await
});

handler_json!(read_text_file, PathParam, |p: PathParam| async move {
    // WebUI: enforce directory allowlist (Tauri desktop relies on OS dialog)
    let path = PathBuf::from(&p.path);
    commands::claude_settings::is_safe_path(&path)?;
    commands::claude_settings::read_text_file(p.path).await
});

handler_json!(
    write_text_file,
    WriteFileParams,
    |p: WriteFileParams| async move {
        // WebUI: enforce directory allowlist (Tauri desktop relies on OS dialog)
        let path = PathBuf::from(&p.path);
        commands::claude_settings::is_safe_path(&path)?;
        commands::claude_settings::write_text_file(p.path, p.content).await
    }
);

handler_json!(
    save_screenshot,
    SaveScreenshotParams,
    |p: SaveScreenshotParams| async move {
        // WebUI endpoint must stay within safe export directories.
        let path = PathBuf::from(&p.path);
        commands::claude_settings::is_safe_path(&path)?;
        commands::claude_settings::save_screenshot(p.path, p.data).await
    }
);

handler_json!(
    delete_session,
    DeleteSessionParams,
    |p: DeleteSessionParams| async move {
        // ForgeCode uses opaque URI scheme handled inside the command;
        // file-path callers are constrained to the provider session roots.
        if !p.file_path.starts_with("forgecode://") && !p.file_path.starts_with("forgecode-db://") {
            require_history_path(&p.file_path)?;
        }
        commands::session::delete_session(p.file_path).await
    }
);

handler_json!(
    rename_session_native,
    RenameSessionParams,
    |p: RenameSessionParams| async move {
        if !p.file_path.starts_with("forgecode://") && !p.file_path.starts_with("forgecode-db://") {
            require_history_path(&p.file_path)?;
        }
        commands::session::rename_session_native(p.file_path, p.new_title).await
    }
);

handler_json!(
    reset_session_native_name,
    PathParam,
    |p: PathParam| async move {
        if !p.path.starts_with("forgecode://") && !p.path.starts_with("forgecode-db://") {
            require_history_path(&p.path)?;
        }
        commands::session::reset_session_native_name(p.path).await
    }
);

handler_json!(
    rename_opencode_session_title,
    RenameOpenCodeParams,
    |p: RenameOpenCodeParams| async move {
        require_history_path(&p.session_path)?;
        commands::session::rename_opencode_session_title(p.session_path, p.new_title).await
    }
);

// ─── Handlers: STRUCT PARAMS ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SavePresetParams {
    pub input: crate::commands::settings::PresetInput,
}

handler_json!(
    save_preset,
    SavePresetParams,
    |p: SavePresetParams| async move { commands::settings::save_preset(p.input).await }
);

#[derive(Deserialize)]
pub struct SaveMcpPresetParams2 {
    pub input: crate::commands::mcp_presets::MCPPresetInput,
}

handler_json!(
    save_mcp_preset,
    SaveMcpPresetParams2,
    |p: SaveMcpPresetParams2| async move { commands::mcp_presets::save_mcp_preset(p.input).await }
);

#[derive(Deserialize)]
pub struct SaveUnifiedPresetParams {
    pub input: crate::commands::unified_presets::UnifiedPresetInput,
}

handler_json!(
    save_unified_preset,
    SaveUnifiedPresetParams,
    |p: SaveUnifiedPresetParams| async move {
        commands::unified_presets::save_unified_preset(p.input).await
    }
);

#[derive(Deserialize)]
pub struct SendFeedbackParams {
    pub feedback: crate::commands::feedback::FeedbackData,
}

handler_json!(
    send_feedback,
    SendFeedbackParams,
    |p: SendFeedbackParams| async move { commands::feedback::send_feedback(p.feedback).await }
);

/// Special handler: returns URL instead of opening browser on server.
pub async fn open_github_issues() -> Result<Json<Value>, ApiError> {
    let url = "https://github.com/jhlee0409/claude-code-history-viewer/issues/new";
    Ok(Json(
        serde_json::json!({ "url": url, "note": "Open this URL in your browser" }),
    ))
}

// ─── Handlers: COMPLEX PARAMS ─────────────────────────────────────────────────

handler_json!(
    get_session_token_stats,
    SessionTokenStatsParams,
    |p: SessionTokenStatsParams| async move {
        if commands::stats::is_claude_session_path(&p.session_path) {
            require_history_path(&p.session_path)?;
        }
        commands::stats::get_session_token_stats(
            p.session_path,
            p.start_date,
            p.end_date,
            p.stats_mode,
        )
        .await
    }
);

handler_json!(
    get_project_token_stats,
    ProjectTokenStatsParams,
    |p: ProjectTokenStatsParams| async move {
        if commands::stats::is_claude_project_path(&p.project_path) {
            require_history_path(&p.project_path)?;
        }
        commands::stats::get_project_token_stats(
            p.project_path,
            p.offset,
            p.limit,
            p.start_date,
            p.end_date,
            p.stats_mode,
        )
        .await
    }
);

handler_json!(
    get_project_stats_summary,
    ProjectStatsSummaryParams,
    |p: ProjectStatsSummaryParams| async move {
        if commands::stats::is_claude_project_path(&p.project_path) {
            require_history_path(&p.project_path)?;
        }
        commands::stats::get_project_stats_summary(
            p.project_path,
            p.start_date,
            p.end_date,
            p.stats_mode,
        )
        .await
    }
);

handler_json!(
    get_session_comparison,
    SessionComparisonParams,
    |p: SessionComparisonParams| async move {
        if commands::stats::is_claude_project_path(&p.project_path) {
            require_history_path(&p.project_path)?;
        }
        commands::stats::get_session_comparison(
            p.session_id,
            p.project_path,
            p.start_date,
            p.end_date,
            p.stats_mode,
        )
        .await
    }
);

handler_json!(
    get_global_stats_summary,
    GlobalStatsParams,
    |p: GlobalStatsParams| async move {
        require_claude_bases(p.claude_path.as_deref(), p.custom_claude_paths.as_deref())?;
        commands::stats::get_global_stats_summary(
            p.claude_path.unwrap_or_default(),
            p.active_providers,
            p.stats_mode,
            p.start_date,
            p.end_date,
            p.custom_claude_paths,
        )
        .await
    }
);

handler_json!(
    get_settings_by_scope,
    SettingsScopeParams,
    |p: SettingsScopeParams| async move {
        if let (true, Some(path)) = (uses_project_dir(&p.scope), &p.project_path) {
            require_known_project_dir(path, ProjectAccess::Read).await?;
        }
        commands::claude_settings::get_settings_by_scope(p.scope, p.project_path).await
    }
);

handler_json!(
    save_settings,
    SaveSettingsParams,
    |p: SaveSettingsParams| async move {
        if let (true, Some(path)) = (uses_project_dir(&p.scope), &p.project_path) {
            require_known_project_dir(path, ProjectAccess::Write).await?;
        }
        commands::claude_settings::save_settings(p.scope, p.content, p.project_path).await
    }
);

handler_json!(
    get_all_settings,
    OptionalProjectPath,
    |p: OptionalProjectPath| async move {
        if let Some(path) = &p.project_path {
            require_known_project_dir(path, ProjectAccess::Read).await?;
        }
        commands::claude_settings::get_all_settings(p.project_path).await
    }
);

handler_json!(
    get_all_mcp_servers,
    OptionalProjectPath,
    |p: OptionalProjectPath| async move {
        if let Some(path) = &p.project_path {
            require_known_project_dir(path, ProjectAccess::Read).await?;
        }
        commands::claude_settings::get_all_mcp_servers(p.project_path).await
    }
);

handler_json!(
    save_mcp_servers,
    SaveMcpServersParams,
    |p: SaveMcpServersParams| async move {
        if let (true, Some(path)) = (uses_project_dir(&p.source), &p.project_path) {
            require_known_project_dir(path, ProjectAccess::Write).await?;
        }
        commands::claude_settings::save_mcp_servers(p.source, p.servers, p.project_path).await
    }
);

handler_json!(
    get_claude_json_config,
    OptionalProjectPath,
    |p: OptionalProjectPath| async move {
        if let Some(path) = &p.project_path {
            require_known_project_dir(path, ProjectAccess::Read).await?;
        }
        commands::claude_settings::get_claude_json_config(p.project_path).await
    }
);

// ─── Handlers: MULTI-PROVIDER ─────────────────────────────────────────────────

handler_json!(
    scan_all_projects,
    ScanAllProjectsParams,
    |p: ScanAllProjectsParams| async move {
        require_claude_bases(p.claude_path.as_deref(), p.custom_claude_paths.as_deref())?;
        commands::multi_provider::scan_all_projects(
            p.claude_path,
            p.active_providers,
            p.custom_claude_paths,
            p.wsl_enabled,
            p.wsl_excluded_distros,
        )
        .await
    }
);

handler_json!(
    load_provider_sessions,
    ProviderSessionsParams,
    |p: ProviderSessionsParams| async move {
        if p.provider == "claude" {
            require_history_path(&p.project_path)?;
        }
        commands::multi_provider::load_provider_sessions(
            p.provider,
            p.project_path,
            p.exclude_sidechain,
        )
        .await
    }
);

handler_json!(
    load_provider_sessions_page,
    ProviderSessionsPageParams,
    |p: ProviderSessionsPageParams| async move {
        if p.provider == "claude" {
            require_history_path(&p.project_path)?;
        }
        commands::multi_provider::load_provider_sessions_page(
            p.provider,
            p.project_path,
            p.exclude_sidechain,
            p.offset,
            p.limit,
        )
        .await
    }
);

handler_json!(
    load_provider_session_by_path,
    ProviderSessionByPathParams,
    |p: ProviderSessionByPathParams| async move {
        if p.provider == "claude" {
            require_history_path(&p.project_path)?;
        }
        commands::multi_provider::load_provider_session_by_path(
            p.provider,
            p.project_path,
            p.file_path,
            p.exclude_sidechain,
        )
        .await
    }
);

handler_json!(
    load_provider_messages,
    ProviderMessagesParams,
    |p: ProviderMessagesParams| async move {
        if p.provider == "claude" {
            require_history_path(&p.session_path)?;
        }
        commands::multi_provider::load_provider_messages(p.provider, p.session_path).await
    }
);

handler_json!(
    load_provider_messages_paginated,
    ProviderMessagesPaginatedParams,
    |p: ProviderMessagesPaginatedParams| async move {
        if p.provider == "claude" {
            require_history_path(&p.session_path)?;
        }
        commands::multi_provider::load_provider_messages_paginated(
            p.provider,
            p.session_path,
            p.offset,
            p.limit,
            p.exclude_sidechain,
        )
        .await
    }
);

handler_json!(
    get_provider_message_offset,
    ProviderMessageOffsetParams,
    |p: ProviderMessageOffsetParams| async move {
        if p.provider == "claude" {
            require_history_path(&p.session_path)?;
        }
        commands::multi_provider::get_provider_message_offset(
            p.provider,
            p.session_path,
            p.message_uuid,
            p.exclude_sidechain,
        )
        .await
    }
);

handler_json!(
    search_all_providers,
    SearchAllProvidersParams,
    |p: SearchAllProvidersParams| async move {
        require_claude_bases(p.claude_path.as_deref(), p.custom_claude_paths.as_deref())?;
        commands::multi_provider::search_all_providers(
            p.claude_path,
            p.query,
            p.active_providers,
            p.wsl_providers,
            p.filters,
            p.limit,
            p.custom_claude_paths,
            p.wsl_enabled,
            p.wsl_excluded_distros,
        )
        .await
    }
);

// ─── Handlers: STATE PARAMS (MetadataState) ───────────────────────────────────

pub async fn load_user_metadata(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let ms = &state.metadata;

    // Check cache first
    {
        let cached = ms
            .metadata
            .lock()
            .map_err(|e| ApiError(format!("Lock error: {e}")))?;
        if let Some(ref meta) = *cached {
            return Ok(Json(
                serde_json::to_value(meta.clone())
                    .map_err(|e| ApiError(format!("Serialization error: {e}")))?,
            ));
        }
    }

    // Load from disk. A load racing a save must not put the pre-save file
    // back in the cache.
    let _write = ms.write_lock.lock().await;
    let path = commands::metadata::get_user_data_path().map_err(ApiError::from)?;
    let metadata = tokio::task::spawn_blocking(move || {
        if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read metadata: {e}"))?;
            serde_json::from_str::<crate::models::UserMetadata>(&content)
                .map_err(|e| format!("Failed to parse metadata: {e}"))
        } else {
            Ok(crate::models::UserMetadata::new())
        }
    })
    .await
    .map_err(|e| ApiError(format!("Task join error: {e}")))??;

    // Cache
    let mut cached = ms
        .metadata
        .lock()
        .map_err(|e| ApiError(format!("Lock error: {e}")))?;
    *cached = Some(metadata.clone());

    Ok(Json(serde_json::to_value(metadata).map_err(|e| {
        ApiError(format!("Serialization error: {e}"))
    })?))
}

/// Persist metadata written through the `WebUI`.
///
/// Custom Claude directories widen the history roots every path check allows,
/// so over the `WebUI` they are server configuration (desktop app,
/// `CLAUDE_CONFIG_DIR`, or `user-data.json` on the host): the list already on
/// disk is kept and any incoming value is ignored, while every other field
/// saves normally; the one entry accepted is the host's own `CLAUDE_CONFIG_DIR`.
/// Ignoring rather than rejecting keeps the frontend, which
/// always sends the full settings object, able to save everything else. The
/// cache is updated to what was actually written.
///
/// `mutate` is applied to the current metadata under the metadata write lock
/// (see `commands::metadata::mutate_and_save`), so concurrent saves are
/// serialized and none is lost.
async fn save_webui_metadata(
    state: &AppState,
    mutate: impl FnOnce(&mut crate::models::UserMetadata) + Send + 'static,
) -> Result<crate::models::UserMetadata, ApiError> {
    commands::metadata::mutate_and_save(&state.metadata, move |metadata| {
        mutate(metadata);
        keep_persisted_custom_claude_paths(metadata);
    })
    .await
    .map_err(ApiError::from)
}

fn keep_persisted_custom_claude_paths(metadata: &mut crate::models::UserMetadata) {
    let incoming = std::mem::take(&mut metadata.settings.custom_claude_paths);
    let mut kept = commands::metadata::get_user_data_path()
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<crate::models::UserMetadata>(&content).ok())
        .map(|persisted| persisted.settings.custom_claude_paths)
        .unwrap_or_default();
    // `CLAUDE_CONFIG_DIR` is set on the host, so the frontend recording it
    // (it registers the detected value automatically) adds no new root.
    let same =
        |a: &str, b: &str| a.trim_end_matches(['/', '\\']) == b.trim_end_matches(['/', '\\']);
    if let Some(config_dir) = commands::project::claude_config_dir() {
        if !kept.iter().any(|c| same(&c.path, &config_dir)) {
            kept.extend(
                incoming
                    .into_iter()
                    .filter(|c| same(&c.path, &config_dir))
                    .take(1),
            );
        }
    }
    metadata.settings.custom_claude_paths = kept;
}

#[derive(Deserialize)]
pub struct SaveUserMetadataParams {
    pub metadata: crate::models::UserMetadata,
}

pub async fn save_user_metadata(
    State(state): State<Arc<AppState>>,
    Json(p): Json<SaveUserMetadataParams>,
) -> Result<Json<Value>, ApiError> {
    save_webui_metadata(&state, move |m| *m = p.metadata).await?;
    Ok(Json(Value::Null))
}

pub async fn update_session_metadata(
    State(state): State<Arc<AppState>>,
    Json(p): Json<UpdateSessionMetadataParams>,
) -> Result<Json<Value>, ApiError> {
    let metadata_to_save = save_webui_metadata(&state, move |metadata| {
        if p.update.is_empty() {
            metadata.sessions.remove(&p.session_id);
        } else {
            metadata.sessions.insert(p.session_id, p.update);
        }
    })
    .await?;

    Ok(Json(serde_json::to_value(metadata_to_save).map_err(
        |e| ApiError(format!("Serialization error: {e}")),
    )?))
}

pub async fn update_project_metadata(
    State(state): State<Arc<AppState>>,
    Json(p): Json<UpdateProjectMetadataParams>,
) -> Result<Json<Value>, ApiError> {
    commands::metadata::validate_project_metadata_key(&p.project_path).map_err(ApiError::from)?;

    let metadata_to_save = save_webui_metadata(&state, move |metadata| {
        if p.update.is_empty() {
            metadata.projects.remove(&p.project_path);
        } else {
            metadata.projects.insert(p.project_path, p.update);
        }
    })
    .await?;

    Ok(Json(serde_json::to_value(metadata_to_save).map_err(
        |e| ApiError(format!("Serialization error: {e}")),
    )?))
}

#[derive(Deserialize)]
pub struct UpdateUserSettingsParams {
    pub settings: crate::models::UserSettings,
}

pub async fn update_user_settings(
    State(state): State<Arc<AppState>>,
    Json(p): Json<UpdateUserSettingsParams>,
) -> Result<Json<Value>, ApiError> {
    let metadata_to_save =
        save_webui_metadata(&state, move |metadata| metadata.settings = p.settings).await?;

    Ok(Json(serde_json::to_value(metadata_to_save).map_err(
        |e| ApiError(format!("Serialization error: {e}")),
    )?))
}

pub async fn is_project_hidden(
    State(state): State<Arc<AppState>>,
    Json(p): Json<ProjectPathParam>,
) -> Result<Json<Value>, ApiError> {
    commands::metadata::validate_project_metadata_key(&p.project_path).map_err(ApiError::from)?;

    let cached = state
        .metadata
        .metadata
        .lock()
        .map_err(|e| ApiError(format!("Lock error: {e}")))?;
    let hidden = cached
        .as_ref()
        .map(|m| m.is_project_hidden(&p.project_path))
        .unwrap_or(false);
    Ok(Json(serde_json::to_value(hidden).map_err(|e| {
        ApiError(format!("Serialization error: {e}"))
    })?))
}

pub async fn get_session_display_name(
    State(state): State<Arc<AppState>>,
    Json(p): Json<SessionIdParam>,
) -> Result<Json<Value>, ApiError> {
    let cached = state
        .metadata
        .metadata
        .lock()
        .map_err(|e| ApiError(format!("Lock error: {e}")))?;
    let name = cached
        .as_ref()
        .and_then(|m| m.get_session(&p.session_id))
        .and_then(|s| s.custom_name.clone())
        .or(p.fallback_summary);
    Ok(Json(serde_json::to_value(name).map_err(|e| {
        ApiError(format!("Serialization error: {e}"))
    })?))
}

// ─── Handlers: APP_HANDLE (Disabled in web mode) ──────────────────────────────

pub async fn start_file_watcher() -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "error": "File watcher is not available in web mode. Use manual refresh.",
        "disabled": true
    })))
}

pub async fn stop_file_watcher() -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "disabled": true
    })))
}

// ─── Handlers: ARCHIVE ────────────────────────────────────────────────────────

handler_no_params!(
    get_archive_base_path,
    commands::archive::get_archive_base_path
);
handler_no_params!(list_archives, commands::archive::list_archives);
handler_no_params!(
    get_archive_disk_usage,
    commands::archive::get_archive_disk_usage
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateArchiveParams {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub session_file_paths: Vec<String>,
    pub source_provider: String,
    pub source_project_path: String,
    pub source_project_name: String,
    #[serde(default = "default_true")]
    pub include_subagents: bool,
}

fn default_true() -> bool {
    true
}

handler_json!(
    create_archive,
    CreateArchiveParams,
    |p: CreateArchiveParams| async move {
        require_history_path(&p.source_project_path)?;
        p.session_file_paths
            .iter()
            .try_for_each(|path| require_history_path(path))?;
        commands::archive::create_archive(
            p.name,
            p.description,
            p.session_file_paths,
            p.source_provider,
            p.source_project_path,
            p.source_project_name,
            p.include_subagents,
        )
        .await
    }
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveIdParam {
    pub archive_id: String,
}

handler_json!(
    delete_archive,
    ArchiveIdParam,
    |p: ArchiveIdParam| async move { commands::archive::delete_archive(p.archive_id).await }
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameArchiveParams {
    pub archive_id: String,
    pub new_name: String,
}

handler_json!(
    rename_archive,
    RenameArchiveParams,
    |p: RenameArchiveParams| async move {
        commands::archive::rename_archive(p.archive_id, p.new_name).await
    }
);

handler_json!(
    get_archive_sessions,
    ArchiveIdParam,
    |p: ArchiveIdParam| async move { commands::archive::get_archive_sessions(p.archive_id).await }
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadArchiveMessagesParams {
    pub archive_id: String,
    pub session_file_name: String,
}

handler_json!(
    load_archive_session_messages,
    LoadArchiveMessagesParams,
    |p: LoadArchiveMessagesParams| async move {
        commands::archive::load_archive_session_messages(p.archive_id, p.session_file_name).await
    }
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiringSessionsParams {
    pub project_path: String,
    #[serde(default)]
    pub threshold_days: Option<i64>,
}

handler_json!(
    get_expiring_sessions,
    ExpiringSessionsParams,
    |p: ExpiringSessionsParams| async move {
        require_history_path(&p.project_path)?;
        commands::archive::get_expiring_sessions(p.project_path, p.threshold_days.unwrap_or(7))
            .await
    }
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionParams {
    pub session_file_path: String,
    pub format: String,
}

handler_json!(
    export_session,
    ExportSessionParams,
    |p: ExportSessionParams| async move {
        require_history_path(&p.session_file_path)?;
        commands::archive::export_session(p.session_file_path, p.format).await
    }
);

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serial_test::serial;

    fn outside_project() -> (tempfile::TempDir, String) {
        let outside = tempfile::tempdir().unwrap();
        let project = outside.path().join("projects").join("proj");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("session.jsonl"), "{}\n").unwrap();
        let path = project.to_string_lossy().to_string();
        (outside, path)
    }

    #[tokio::test]
    #[serial]
    async fn provider_sessions_page_rejects_project_outside_history_roots() {
        let _home = crate::test_utils::SandboxHome::new();
        let (_outside, project_path) = outside_project();

        let res = load_provider_sessions_page(Json(ProviderSessionsPageParams {
            provider: "claude".to_string(),
            project_path,
            exclude_sidechain: None,
            offset: None,
            limit: None,
        }))
        .await;

        assert!(res.is_err(), "out-of-root project was served");
    }

    #[tokio::test]
    #[serial]
    async fn session_messages_rejects_file_outside_history_roots() {
        let _home = crate::test_utils::SandboxHome::new();
        let (_outside, project_path) = outside_project();
        let session_path = format!("{project_path}/session.jsonl");

        let res = load_session_messages(Json(SessionPathParam { session_path })).await;

        assert!(res.is_err(), "out-of-root session file was served");
    }

    fn metadata_state() -> Arc<AppState> {
        let (event_tx, _rx) =
            tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(1);
        Arc::new(AppState {
            metadata: Arc::new(commands::metadata::MetadataState::default()),
            start_time: std::time::Instant::now(),
            auth: crate::server::auth::AuthState::Disabled,
            read_only: false,
            loopback_bind: false,
            event_tx,
        })
    }

    fn persisted_metadata() -> crate::models::UserMetadata {
        let path = commands::metadata::get_user_data_path().unwrap();
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn custom_path(path: &std::path::Path) -> crate::models::CustomClaudePath {
        crate::models::CustomClaudePath {
            path: path.to_string_lossy().to_string(),
            label: None,
        }
    }

    /// Custom Claude directories are server configuration: saving through the
    /// `WebUI` keeps the persisted list and still saves every other field.
    #[tokio::test]
    #[serial]
    async fn webui_metadata_saves_keep_persisted_custom_claude_paths() {
        let home = crate::test_utils::SandboxHome::new();
        let configured = home.path().join("configured-claude");
        let mut initial = crate::models::UserMetadata::new();
        initial.settings.custom_claude_paths = vec![custom_path(&configured)];
        commands::metadata::save_metadata_to_disk(&initial).unwrap();
        let state = metadata_state();
        let injected = home.path().join("injected");

        let mut metadata = initial.clone();
        metadata.settings.custom_claude_paths = vec![custom_path(&injected)];
        metadata.settings.hidden_patterns = vec!["tmp-*".to_string()];
        let _ = save_user_metadata(
            State(Arc::clone(&state)),
            Json(SaveUserMetadataParams { metadata }),
        )
        .await
        .unwrap_or_else(|_| panic!("save_user_metadata failed"));
        let saved = persisted_metadata();
        assert_eq!(
            saved.settings.custom_claude_paths,
            initial.settings.custom_claude_paths
        );
        assert_eq!(saved.settings.hidden_patterns, vec!["tmp-*".to_string()]);

        let mut settings = saved.settings.clone();
        settings.custom_claude_paths = Vec::new();
        settings.hidden_patterns = vec!["other-*".to_string()];
        let _ = update_user_settings(
            State(Arc::clone(&state)),
            Json(UpdateUserSettingsParams { settings }),
        )
        .await
        .unwrap_or_else(|_| panic!("update_user_settings failed"));
        let saved = persisted_metadata();
        assert_eq!(
            saved.settings.custom_claude_paths,
            initial.settings.custom_claude_paths
        );
        assert_eq!(saved.settings.hidden_patterns, vec!["other-*".to_string()]);
    }

    /// `CLAUDE_CONFIG_DIR` is already server configuration, so the frontend's
    /// automatic registration of it still persists; nothing else is added.
    #[tokio::test]
    #[serial]
    async fn webui_metadata_saves_accept_the_claude_config_dir_entry() {
        let home = crate::test_utils::SandboxHome::new();
        let config_dir = home.path().join("config-claude");
        std::fs::create_dir_all(config_dir.join("projects")).unwrap();
        let previous = std::env::var_os("CLAUDE_CONFIG_DIR");
        std::env::set_var("CLAUDE_CONFIG_DIR", &config_dir);
        commands::metadata::save_metadata_to_disk(&crate::models::UserMetadata::new()).unwrap();

        let mut settings = crate::models::UserSettings::default();
        settings.custom_claude_paths = vec![
            crate::models::CustomClaudePath {
                path: config_dir.to_string_lossy().to_string(),
                label: Some("CLAUDE_CONFIG_DIR".to_string()),
            },
            custom_path(&home.path().join("injected")),
        ];
        let res = update_user_settings(
            State(metadata_state()),
            Json(UpdateUserSettingsParams { settings }),
        )
        .await;

        match previous {
            Some(v) => std::env::set_var("CLAUDE_CONFIG_DIR", v),
            None => std::env::remove_var("CLAUDE_CONFIG_DIR"),
        }
        assert!(res.is_ok(), "update_user_settings failed");
        let saved = persisted_metadata().settings.custom_claude_paths;
        assert_eq!(saved.len(), 1, "{saved:?}");
        assert_eq!(saved[0].path, config_dir.to_string_lossy());
    }

    /// Concurrent `WebUI` session updates must all survive on disk and in the
    /// cache; an older save must not overwrite a newer one.
    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    #[serial]
    async fn webui_concurrent_session_updates_are_all_persisted() {
        const N: usize = 16;
        let _home = crate::test_utils::SandboxHome::new();
        let state = metadata_state();
        let barrier = Arc::new(tokio::sync::Barrier::new(N));

        let tasks: Vec<_> = (0..N)
            .map(|i| {
                let (state, barrier) = (Arc::clone(&state), Arc::clone(&barrier));
                tokio::spawn(async move {
                    barrier.wait().await;
                    update_session_metadata(
                        State(state),
                        Json(UpdateSessionMetadataParams {
                            session_id: format!("session-{i}"),
                            update: crate::models::SessionMetadata {
                                custom_name: Some(format!("name-{i}")),
                                ..Default::default()
                            },
                        }),
                    )
                    .await
                    .is_ok()
                })
            })
            .collect();
        for t in tasks {
            assert!(t.await.unwrap(), "update_session_metadata failed");
        }

        assert_eq!(persisted_metadata().sessions.len(), N, "disk lost updates");
        let cached = state.metadata.metadata.lock().unwrap().clone().unwrap();
        assert_eq!(cached.sessions.len(), N, "cache lost updates");
    }

    /// Path-bearing provider ids pass the history-root check as ids, so the
    /// provider loader itself must confine them.
    #[tokio::test]
    #[serial]
    async fn provider_messages_rejects_path_bearing_ids_outside_their_roots() {
        let _home = crate::test_utils::SandboxHome::new();
        let outside = tempfile::tempdir().unwrap();

        let aider_dir = outside.path().join("proj");
        std::fs::create_dir_all(&aider_dir).unwrap();
        let history = aider_dir.join(".aider.chat.history.md");
        std::fs::write(
            &history,
            "# aider chat started at 2025-03-26 14:32:01\n\n#### hello\n\nhi there\n",
        )
        .unwrap();

        let cline_base = outside.path().join("saoudrizwan.claude-dev");
        let task = cline_base.join("tasks").join("1700000000000");
        std::fs::create_dir_all(&task).unwrap();
        std::fs::write(
            task.join("ui_messages.json"),
            r#"[{"type":"say","say":"text","text":"hello","ts":1700000000000}]"#,
        )
        .unwrap();

        for (provider, session_path) in [
            ("aider", format!("aider://{}#0", history.display())),
            (
                "cline",
                format!("cline://{}:1700000000000", cline_base.display()),
            ),
        ] {
            let res = load_provider_messages(Json(ProviderMessagesParams {
                provider: provider.to_string(),
                session_path,
            }))
            .await;
            assert!(res.is_err(), "{provider} served a path outside its roots");
        }
    }

    #[tokio::test]
    #[serial]
    async fn session_by_path_rejects_project_outside_history_roots() {
        let _home = crate::test_utils::SandboxHome::new();
        let (_outside, project_path) = outside_project();
        let file_path = format!("{project_path}/session.jsonl");

        let res = load_provider_session_by_path(Json(ProviderSessionByPathParams {
            provider: "claude".to_string(),
            project_path,
            file_path,
            exclude_sidechain: None,
        }))
        .await;

        let Err(ApiError(message)) = res else {
            panic!("out-of-root project was served");
        };
        assert_eq!(message, commands::session::OUTSIDE_HISTORY_ROOTS);
    }

    #[tokio::test]
    #[serial]
    async fn session_by_path_serves_default_claude_project() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join(".claude").join("projects").join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let file = project.join("session.jsonl");
        std::fs::write(
            &file,
            "{\"type\":\"user\",\"uuid\":\"u1\",\"sessionId\":\"s1\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
        )
        .unwrap();

        let res = load_provider_session_by_path(Json(ProviderSessionByPathParams {
            provider: "claude".to_string(),
            project_path: project.to_string_lossy().to_string(),
            file_path: file.to_string_lossy().to_string(),
            exclude_sidechain: None,
        }))
        .await;

        assert!(res.is_ok(), "in-root session was rejected");
    }

    #[tokio::test]
    #[serial]
    async fn provider_sessions_page_serves_default_claude_project() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join(".claude").join("projects").join("proj");
        std::fs::create_dir_all(&project).unwrap();

        let res = load_provider_sessions_page(Json(ProviderSessionsPageParams {
            provider: "claude".to_string(),
            project_path: project.to_string_lossy().to_string(),
            exclude_sidechain: None,
            offset: None,
            limit: None,
        }))
        .await;

        assert!(res.is_ok(), "in-root project was rejected");
    }

    // ─── Known project directories ───────────────────────────────────────

    /// A project directory on disk plus a Claude session that records it as
    /// its `cwd`, which makes it a known project.
    fn known_project(home: &crate::test_utils::SandboxHome) -> (tempfile::TempDir, String) {
        let repo = tempfile::tempdir().unwrap();
        let cwd = repo.path().canonicalize().unwrap();
        let history = home.path().join(".claude").join("projects").join("-repo");
        std::fs::create_dir_all(&history).unwrap();
        std::fs::write(
            history.join("s1.jsonl"),
            serde_json::json!({
                "type": "user",
                "uuid": "u1",
                "sessionId": "s1",
                "timestamp": "2026-01-01T00:00:00Z",
                "cwd": cwd.to_string_lossy(),
                "message": { "role": "user", "content": "hi" }
            })
            .to_string()
                + "\n",
        )
        .unwrap();
        (repo, cwd.to_string_lossy().to_string())
    }

    fn rejected_as_unknown<T>(res: Result<T, ApiError>) {
        let Err(ApiError(message)) = res else {
            panic!("unknown project directory was accepted");
        };
        assert_eq!(message, UNKNOWN_PROJECT_DIR);
    }

    #[tokio::test]
    #[serial]
    async fn save_settings_rejects_unknown_project_dir_without_writing() {
        let home = crate::test_utils::SandboxHome::new();
        let _known = known_project(&home);
        let unknown = tempfile::tempdir().unwrap();

        for scope in ["project", "local"] {
            let res = save_settings(Json(SaveSettingsParams {
                scope: scope.to_string(),
                content: "{}".to_string(),
                project_path: Some(unknown.path().to_string_lossy().to_string()),
            }))
            .await;
            rejected_as_unknown(res);
        }
        assert!(!unknown.path().join(".claude").exists(), "file was written");
    }

    #[tokio::test]
    #[serial]
    async fn save_mcp_servers_rejects_unknown_project_dir_without_writing() {
        let home = crate::test_utils::SandboxHome::new();
        let _known = known_project(&home);
        let unknown = tempfile::tempdir().unwrap();

        for source in ["project_mcp", "local_claude_json"] {
            let res = save_mcp_servers(Json(SaveMcpServersParams {
                source: source.to_string(),
                servers: "{}".to_string(),
                project_path: Some(unknown.path().to_string_lossy().to_string()),
            }))
            .await;
            rejected_as_unknown(res);
        }
        assert!(
            !unknown.path().join(".mcp.json").exists(),
            "file was written"
        );
        assert!(
            !home.path().join(".claude.json").exists(),
            "unknown project was recorded in ~/.claude.json"
        );
    }

    #[tokio::test]
    #[serial]
    async fn settings_readers_reject_unknown_project_dir() {
        let home = crate::test_utils::SandboxHome::new();
        let _known = known_project(&home);
        let unknown = tempfile::tempdir().unwrap();
        let path = unknown.path().to_string_lossy().to_string();

        rejected_as_unknown(
            get_settings_by_scope(Json(SettingsScopeParams {
                scope: "local".to_string(),
                project_path: Some(path.clone()),
            }))
            .await,
        );
        let body = || {
            Json(OptionalProjectPath {
                project_path: Some(path.clone()),
            })
        };
        rejected_as_unknown(get_all_settings(body()).await);
        rejected_as_unknown(get_all_mcp_servers(body()).await);
        rejected_as_unknown(get_claude_json_config(body()).await);
    }

    #[tokio::test]
    #[serial]
    async fn save_settings_writes_to_known_project_dir() {
        let home = crate::test_utils::SandboxHome::new();
        let (_repo, cwd) = known_project(&home);

        let res = save_settings(Json(SaveSettingsParams {
            scope: "local".to_string(),
            content: "{}".to_string(),
            project_path: Some(cwd.clone()),
        }))
        .await;

        assert!(
            res.is_ok(),
            "known project rejected: {:?}",
            res.err().map(|e| e.0)
        );
        assert!(std::path::Path::new(&cwd)
            .join(".claude")
            .join("settings.local.json")
            .exists());
    }

    #[tokio::test]
    #[serial]
    async fn user_scope_settings_ignore_project_path() {
        let home = crate::test_utils::SandboxHome::new();
        let unknown = tempfile::tempdir().unwrap();

        let res = save_settings(Json(SaveSettingsParams {
            scope: "user".to_string(),
            content: "{}".to_string(),
            project_path: Some(unknown.path().to_string_lossy().to_string()),
        }))
        .await;
        assert!(
            res.is_ok(),
            "user scope rejected: {:?}",
            res.err().map(|e| e.0)
        );

        let res = save_mcp_servers(Json(SaveMcpServersParams {
            source: "user_claude_json".to_string(),
            servers: "{}".to_string(),
            project_path: Some(unknown.path().to_string_lossy().to_string()),
        }))
        .await;
        assert!(
            res.is_ok(),
            "user MCP source rejected: {:?}",
            res.err().map(|e| e.0)
        );
        assert!(home.path().join(".claude").join("settings.json").exists());
        assert!(!unknown.path().join(".claude").exists());
    }

    #[tokio::test]
    #[serial]
    async fn git_log_rejects_unknown_project_dir() {
        let home = crate::test_utils::SandboxHome::new();
        let _known = known_project(&home);
        let unknown = tempfile::tempdir().unwrap();

        rejected_as_unknown(
            get_git_log(Json(GitLogParams {
                actual_path: unknown.path().to_string_lossy().to_string(),
                limit: 1,
            }))
            .await,
        );
    }

    #[tokio::test]
    #[serial]
    async fn git_log_runs_in_known_project_dir() {
        let home = crate::test_utils::SandboxHome::new();
        let (_repo, cwd) = known_project(&home);

        let res = get_git_log(Json(GitLogParams {
            actual_path: cwd,
            limit: 1,
        }))
        .await;
        assert!(
            res.is_ok(),
            "known project rejected: {:?}",
            res.err().map(|e| e.0)
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn symlink_to_known_project_dir_is_accepted() {
        let home = crate::test_utils::SandboxHome::new();
        let (_repo, cwd) = known_project(&home);
        // The link's own path is not a known project; only its target is.
        let links = tempfile::tempdir().unwrap();
        let link = links.path().join("repo-link");
        std::os::unix::fs::symlink(&cwd, &link).unwrap();

        let res = save_settings(Json(SaveSettingsParams {
            scope: "local".to_string(),
            content: "{}".to_string(),
            project_path: Some(link.to_string_lossy().to_string()),
        }))
        .await;

        assert!(
            res.is_ok(),
            "link to a known project rejected: {:?}",
            res.err().map(|e| e.0)
        );
        assert!(std::path::Path::new(&cwd)
            .join(".claude")
            .join("settings.local.json")
            .exists());
    }

    #[test]
    #[serial]
    fn misses_right_after_a_scan_do_not_rescan() {
        let home = crate::test_utils::SandboxHome::new();
        let _known = known_project(&home);
        let unknown = tempfile::tempdir().unwrap();
        assert!(!is_known_project_dir(&comparable_path(unknown.path())));

        // A project recorded after that scan is not picked up by an
        // immediate miss: a burst of unknown paths costs one scan, not one each.
        let later = tempfile::tempdir().unwrap();
        let history = home.path().join(".claude").join("projects").join("-later");
        std::fs::create_dir_all(&history).unwrap();
        std::fs::write(
            history.join("s2.jsonl"),
            serde_json::json!({
                "type": "user",
                "uuid": "u2",
                "sessionId": "s2",
                "timestamp": "2026-01-01T00:00:00Z",
                "cwd": later.path().canonicalize().unwrap().to_string_lossy(),
                "message": { "role": "user", "content": "hi" }
            })
            .to_string()
                + "\n",
        )
        .unwrap();
        assert!(!is_known_project_dir(&comparable_path(later.path())));
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn linked_claude_dir_in_known_project_is_not_written() {
        let home = crate::test_utils::SandboxHome::new();
        let (_repo, cwd) = known_project(&home);
        let elsewhere = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), std::path::Path::new(&cwd).join(".claude"))
            .unwrap();

        let res = save_settings(Json(SaveSettingsParams {
            scope: "local".to_string(),
            content: "{}".to_string(),
            project_path: Some(cwd),
        }))
        .await;

        assert!(res.is_err(), "wrote through a linked .claude");
        assert_eq!(std::fs::read_dir(elsewhere.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn symlink_to_unknown_dir_is_rejected() {
        let home = crate::test_utils::SandboxHome::new();
        let (repo, _cwd) = known_project(&home);
        let unknown = tempfile::tempdir().unwrap();
        // A link inside the known project that points somewhere else.
        let link = repo.path().join("elsewhere");
        std::os::unix::fs::symlink(unknown.path(), &link).unwrap();

        rejected_as_unknown(
            save_settings(Json(SaveSettingsParams {
                scope: "local".to_string(),
                content: "{}".to_string(),
                project_path: Some(link.to_string_lossy().to_string()),
            }))
            .await,
        );
        assert!(!unknown.path().join(".claude").exists(), "file was written");
    }

    #[tokio::test]
    #[serial]
    async fn known_project_whose_dir_is_gone_reads_but_does_not_write() {
        let home = crate::test_utils::SandboxHome::new();
        let (repo, cwd) = known_project(&home);
        drop(repo);

        let res = get_all_settings(Json(OptionalProjectPath {
            project_path: Some(cwd.clone()),
        }))
        .await;
        assert!(
            res.is_ok(),
            "read of a recorded project rejected: {:?}",
            res.err().map(|e| e.0)
        );

        rejected_as_unknown(
            save_settings(Json(SaveSettingsParams {
                scope: "local".to_string(),
                content: "{}".to_string(),
                project_path: Some(cwd.clone()),
            }))
            .await,
        );
        assert!(
            !std::path::Path::new(&cwd).exists(),
            "deleted project dir was recreated"
        );
    }
}
