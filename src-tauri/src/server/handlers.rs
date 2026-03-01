//! Axum HTTP handlers that wrap existing Tauri command functions.
//!
//! Each handler deserializes JSON request body, calls the underlying command,
//! and returns the result as JSON. The command function signatures are unchanged.

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

use super::state::AppState;
use crate::commands;

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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFileParams {
    pub file_path: String,
    pub content: String,
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
pub struct ProviderMessagesParams {
    pub provider: String,
    pub session_path: String,
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
    pub filters: Option<Value>,
    #[serde(default)]
    pub limit: Option<usize>,
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
    scan_projects,
    ClaudePathParam,
    |p: ClaudePathParam| async move { commands::project::scan_projects(p.claude_path).await }
);

handler_json!(get_git_log, GitLogParams, |p: GitLogParams| async move {
    commands::project::get_git_log(p.actual_path, p.limit).await
});

handler_json!(
    load_project_sessions,
    LoadProjectSessionsParams,
    |p: LoadProjectSessionsParams| async move {
        commands::session::load_project_sessions(p.project_path, p.exclude_sidechain).await
    }
);

handler_json!(
    load_session_messages,
    SessionPathParam,
    |p: SessionPathParam| async move { commands::session::load_session_messages(p.session_path).await }
);

handler_json!(
    load_session_messages_paginated,
    PaginatedParams,
    |p: PaginatedParams| async move {
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
        commands::session::get_session_message_count(p.session_path, p.exclude_sidechain).await
    }
);

handler_json!(
    search_messages,
    SearchParams,
    |p: SearchParams| async move {
        commands::session::search_messages(p.claude_path, p.query, p.filters, p.limit).await
    }
);

handler_json!(
    get_recent_edits,
    RecentEditsParams,
    |p: RecentEditsParams| async move {
        commands::session::get_recent_edits(p.project_path, p.offset, p.limit).await
    }
);

handler_json!(
    restore_file,
    RestoreFileParams,
    |p: RestoreFileParams| async move { commands::session::restore_file(p.file_path, p.content).await }
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
    commands::claude_settings::read_text_file(p.path).await
});

handler_json!(
    write_text_file,
    WriteFileParams,
    |p: WriteFileParams| async move {
        commands::claude_settings::write_text_file(p.path, p.content).await
    }
);

handler_json!(
    rename_session_native,
    RenameSessionParams,
    |p: RenameSessionParams| async move {
        commands::session::rename_session_native(p.file_path, p.new_title).await
    }
);

handler_json!(
    reset_session_native_name,
    PathParam,
    |p: PathParam| async move { commands::session::reset_session_native_name(p.path).await }
);

handler_json!(
    rename_opencode_session_title,
    RenameOpenCodeParams,
    |p: RenameOpenCodeParams| async move {
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
        commands::stats::get_global_stats_summary(
            p.claude_path.unwrap_or_default(),
            p.active_providers,
            p.stats_mode,
            p.start_date,
            p.end_date,
        )
        .await
    }
);

handler_json!(
    get_settings_by_scope,
    SettingsScopeParams,
    |p: SettingsScopeParams| async move {
        commands::claude_settings::get_settings_by_scope(p.scope, p.project_path).await
    }
);

handler_json!(
    save_settings,
    SaveSettingsParams,
    |p: SaveSettingsParams| async move {
        commands::claude_settings::save_settings(p.scope, p.content, p.project_path).await
    }
);

handler_json!(
    get_all_settings,
    OptionalProjectPath,
    |p: OptionalProjectPath| async move {
        commands::claude_settings::get_all_settings(p.project_path).await
    }
);

handler_json!(
    get_all_mcp_servers,
    OptionalProjectPath,
    |p: OptionalProjectPath| async move {
        commands::claude_settings::get_all_mcp_servers(p.project_path).await
    }
);

handler_json!(
    save_mcp_servers,
    SaveMcpServersParams,
    |p: SaveMcpServersParams| async move {
        commands::claude_settings::save_mcp_servers(p.source, p.servers, p.project_path).await
    }
);

handler_json!(
    get_claude_json_config,
    OptionalProjectPath,
    |p: OptionalProjectPath| async move {
        commands::claude_settings::get_claude_json_config(p.project_path).await
    }
);

// ─── Handlers: MULTI-PROVIDER ─────────────────────────────────────────────────

handler_json!(
    scan_all_projects,
    ScanAllProjectsParams,
    |p: ScanAllProjectsParams| async move {
        commands::multi_provider::scan_all_projects(p.claude_path, p.active_providers).await
    }
);

handler_json!(
    load_provider_sessions,
    ProviderSessionsParams,
    |p: ProviderSessionsParams| async move {
        commands::multi_provider::load_provider_sessions(
            p.provider,
            p.project_path,
            p.exclude_sidechain,
        )
        .await
    }
);

handler_json!(
    load_provider_messages,
    ProviderMessagesParams,
    |p: ProviderMessagesParams| async move {
        commands::multi_provider::load_provider_messages(p.provider, p.session_path).await
    }
);

handler_json!(
    search_all_providers,
    SearchAllProvidersParams,
    |p: SearchAllProvidersParams| async move {
        commands::multi_provider::search_all_providers(
            p.claude_path,
            p.query,
            p.active_providers,
            p.filters,
            p.limit,
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

    // Load from disk
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

#[derive(Deserialize)]
pub struct SaveUserMetadataParams {
    pub metadata: crate::models::UserMetadata,
}

pub async fn save_user_metadata(
    State(state): State<Arc<AppState>>,
    Json(p): Json<SaveUserMetadataParams>,
) -> Result<Json<Value>, ApiError> {
    let metadata = p.metadata;
    let meta_clone = metadata.clone();
    tokio::task::spawn_blocking(move || commands::metadata::save_metadata_to_disk(&meta_clone))
        .await
        .map_err(|e| ApiError(format!("Task join error: {e}")))??;

    let mut cached = state
        .metadata
        .metadata
        .lock()
        .map_err(|e| ApiError(format!("Lock error: {e}")))?;
    *cached = Some(metadata);
    Ok(Json(Value::Null))
}

pub async fn update_session_metadata(
    State(state): State<Arc<AppState>>,
    Json(p): Json<UpdateSessionMetadataParams>,
) -> Result<Json<Value>, ApiError> {
    let metadata_to_save = {
        let mut cached = state
            .metadata
            .metadata
            .lock()
            .map_err(|e| ApiError(format!("Lock error: {e}")))?;
        let metadata = cached.get_or_insert_with(crate::models::UserMetadata::new);
        if p.update.is_empty() {
            metadata.sessions.remove(&p.session_id);
        } else {
            metadata.sessions.insert(p.session_id, p.update);
        }
        metadata.clone()
    };

    let meta_clone = metadata_to_save.clone();
    tokio::task::spawn_blocking(move || commands::metadata::save_metadata_to_disk(&meta_clone))
        .await
        .map_err(|e| ApiError(format!("Task join error: {e}")))??;

    Ok(Json(serde_json::to_value(metadata_to_save).map_err(
        |e| ApiError(format!("Serialization error: {e}")),
    )?))
}

pub async fn update_project_metadata(
    State(state): State<Arc<AppState>>,
    Json(p): Json<UpdateProjectMetadataParams>,
) -> Result<Json<Value>, ApiError> {
    let metadata_to_save = {
        let mut cached = state
            .metadata
            .metadata
            .lock()
            .map_err(|e| ApiError(format!("Lock error: {e}")))?;
        let metadata = cached.get_or_insert_with(crate::models::UserMetadata::new);
        if p.update.is_empty() {
            metadata.projects.remove(&p.project_path);
        } else {
            metadata.projects.insert(p.project_path, p.update);
        }
        metadata.clone()
    };

    let meta_clone = metadata_to_save.clone();
    tokio::task::spawn_blocking(move || commands::metadata::save_metadata_to_disk(&meta_clone))
        .await
        .map_err(|e| ApiError(format!("Task join error: {e}")))??;

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
    let settings = p.settings;
    let metadata_to_save = {
        let mut cached = state
            .metadata
            .metadata
            .lock()
            .map_err(|e| ApiError(format!("Lock error: {e}")))?;
        let metadata = cached.get_or_insert_with(crate::models::UserMetadata::new);
        metadata.settings = settings;
        metadata.clone()
    };

    let meta_clone = metadata_to_save.clone();
    tokio::task::spawn_blocking(move || commands::metadata::save_metadata_to_disk(&meta_clone))
        .await
        .map_err(|e| ApiError(format!("Task join error: {e}")))??;

    Ok(Json(serde_json::to_value(metadata_to_save).map_err(
        |e| ApiError(format!("Serialization error: {e}")),
    )?))
}

pub async fn is_project_hidden(
    State(state): State<Arc<AppState>>,
    Json(p): Json<ProjectPathParam>,
) -> Result<Json<Value>, ApiError> {
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
