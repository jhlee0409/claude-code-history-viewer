//! `WebUI` server module — serves the React SPA and REST API via Axum.
//!
//! This module is only compiled when the `webui-server` Cargo feature is enabled.
//! It spawns an HTTP server inside Tauri's existing Tokio runtime.
//!
//! ## Asset serving
//!
//! The frontend SPA is served in one of two modes:
//! - **Embedded** (default): assets are compiled into the binary via `rust-embed`.
//!   This enables single-binary deployment with no external files.
//! - **External**: `--dist <path>` serves assets from the filesystem.
//!   Useful during development or when overriding the built-in frontend.

pub mod auth;
pub mod handlers;
pub mod state;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{middleware, Json, Router};
use rust_embed::Embed;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;

use self::auth::{
    auth_error_response, clear_auth_cookies_response, csrf_valid, login_response, AuthLoginRequest,
    AuthState, AuthenticatedRequest,
};
use self::handlers as h;
use self::state::AppState;
/// `/api/*` POST routes that are safe to serve while the server is in read-only
/// mode (the read/load/scan/search/export surface).
///
/// Read-only enforcement is **deny-by-default**: `read_only_middleware` rejects any
/// protected POST whose path is not on this allowlist. Listing safe reads (instead
/// of blocking known mutations) means a newly added mutating route is blocked
/// automatically rather than silently leaking through — the safe failure direction.
/// This list must stay in sync with the POST routes registered on `protected_api`
/// in `build_router`; the `read_only_*` tests below pin the current classification.
const READ_ONLY_ALLOWED_API_PATHS: &[&str] = &[
    "/ack_menu_events",
    "/detect_claude_config_dir",
    "/detect_providers",
    "/export_session",
    "/get_all_mcp_servers",
    "/get_all_settings",
    "/get_archive_base_path",
    "/get_archive_disk_usage",
    "/get_archive_sessions",
    "/get_claude_folder_path",
    "/get_claude_json_config",
    "/get_expiring_sessions",
    "/get_git_log",
    "/get_global_stats_summary",
    "/get_mcp_preset",
    "/get_mcp_servers",
    "/get_metadata_folder_path",
    "/get_preset",
    "/get_project_stats_summary",
    "/get_project_token_stats",
    "/get_provider_message_offset",
    "/get_recent_edits",
    "/get_server_config",
    "/get_session_comparison",
    "/get_session_display_name",
    "/get_session_message_count",
    "/get_session_subagents",
    "/get_session_token_stats",
    "/get_settings_by_scope",
    "/get_system_info",
    "/get_unified_preset",
    "/get_usage_breakdown",
    "/is_project_hidden",
    "/list_archives",
    "/load_archive_session_messages",
    "/load_mcp_presets",
    "/load_presets",
    "/load_project_sessions",
    "/load_project_sessions_page",
    "/load_provider_messages",
    "/load_provider_messages_paginated",
    "/load_provider_session_by_path",
    "/load_provider_sessions",
    "/load_provider_sessions_page",
    "/load_session_messages",
    "/load_session_messages_paginated",
    "/load_unified_presets",
    "/load_user_metadata",
    "/menu_journal",
    "/open_github_issues",
    "/read_restore_target",
    "/read_text_file",
    "/scan_all_projects",
    "/scan_projects",
    "/search_all_providers",
    "/search_messages",
    "/sync_menu_state",
    "/validate_claude_folder",
    "/validate_custom_claude_dir",
];

/// The mutating `/api/*` POST routes — rejected in read-only mode. This list is the
/// complement of [`READ_ONLY_ALLOWED_API_PATHS`] over the protected POST surface and
/// exists only so a test can assert the two together cover every registered route
/// (so a newly added route can't be silently misclassified). `/events` is GET-only
/// and never reaches the POST check.
#[cfg(test)]
const READ_ONLY_MUTATING_API_PATHS: &[&str] = &[
    "/create_archive",
    "/delete_archive",
    "/delete_mcp_preset",
    "/delete_preset",
    "/delete_session",
    "/delete_unified_preset",
    "/rename_archive",
    "/rename_opencode_session_title",
    "/rename_session_native",
    "/reset_session_native_name",
    "/restore_file",
    "/save_mcp_preset",
    "/save_mcp_servers",
    "/save_preset",
    "/save_screenshot",
    "/save_settings",
    "/save_unified_preset",
    "/save_user_metadata",
    "/send_feedback",
    "/start_file_watcher",
    "/stop_file_watcher",
    "/update_project_metadata",
    "/update_session_metadata",
    "/update_user_settings",
    "/write_text_file",
];

/// Frontend assets embedded at compile time from the `dist/` directory.
///
/// When building with `cargo build --features webui-server`, the contents of
/// `../dist` (relative to `src-tauri/`) are baked into the binary. At runtime
/// the embedded files are served directly from memory — no filesystem access needed.
#[derive(Embed)]
#[folder = "../dist"]
struct EmbeddedAssets;

#[derive(Clone)]
enum SpaIndex {
    Html(Arc<String>),
    Embedded { base_path: String },
}

/// Build the complete Axum router with all API routes and SPA fallback.
pub fn build_router(
    state: Arc<AppState>,
    host: &str,
    port: u16,
    dist_dir: Option<&str>,
    base_path: &str,
) -> Router {
    let base_path = normalize_base_path(base_path).expect("Invalid WebUI base path");

    // Restrict CORS when auth is enabled; permissive only for --no-auth.
    let origin = if state.auth.is_enabled() {
        let origin = format!("http://{host}:{port}")
            .parse::<HeaderValue>()
            .unwrap_or_else(|_| HeaderValue::from_static("http://localhost:3727"));
        AllowOrigin::exact(origin)
    } else {
        AllowOrigin::any()
    };
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-csrf-token"),
        ]);

    let protected_api = Router::new()
        // SSE endpoint for real-time file change events
        .route("/events", get(sse_handler))
        .route("/get_server_config", post(h::get_server_config))
        // Project commands
        .route("/get_claude_folder_path", post(h::get_claude_folder_path))
        .route(
            "/detect_claude_config_dir",
            post(h::detect_claude_config_dir),
        )
        .route("/validate_claude_folder", post(h::validate_claude_folder))
        .route(
            "/validate_custom_claude_dir",
            post(h::validate_custom_claude_dir),
        )
        .route("/scan_projects", post(h::scan_projects))
        .route("/get_git_log", post(h::get_git_log))
        // Session commands
        .route("/load_project_sessions", post(h::load_project_sessions))
        .route(
            "/load_project_sessions_page",
            post(h::load_project_sessions_page),
        )
        .route("/load_session_messages", post(h::load_session_messages))
        .route(
            "/load_session_messages_paginated",
            post(h::load_session_messages_paginated),
        )
        .route(
            "/get_session_message_count",
            post(h::get_session_message_count),
        )
        .route("/get_session_subagents", post(h::get_session_subagents))
        .route("/search_messages", post(h::search_messages))
        .route("/get_recent_edits", post(h::get_recent_edits))
        .route("/restore_file", post(h::restore_file))
        .route("/read_restore_target", post(h::read_restore_target))
        .route("/delete_session", post(h::delete_session))
        // Rename commands
        .route("/rename_session_native", post(h::rename_session_native))
        .route(
            "/reset_session_native_name",
            post(h::reset_session_native_name),
        )
        .route(
            "/rename_opencode_session_title",
            post(h::rename_opencode_session_title),
        )
        // Stats commands
        .route("/get_session_token_stats", post(h::get_session_token_stats))
        .route("/get_project_token_stats", post(h::get_project_token_stats))
        .route(
            "/get_project_stats_summary",
            post(h::get_project_stats_summary),
        )
        .route("/get_session_comparison", post(h::get_session_comparison))
        .route(
            "/get_global_stats_summary",
            post(h::get_global_stats_summary),
        )
        .route("/get_usage_breakdown", post(h::get_usage_breakdown))
        // Feedback commands
        .route("/send_feedback", post(h::send_feedback))
        .route("/get_system_info", post(h::get_system_info))
        .route("/open_github_issues", post(h::open_github_issues))
        // Native menu bridge: no-ops in the WebUI (no native menu)
        .route("/sync_menu_state", post(h::sync_menu_state))
        .route("/menu_journal", post(h::menu_journal))
        .route("/ack_menu_events", post(h::ack_menu_events))
        // Metadata commands
        .route(
            "/get_metadata_folder_path",
            post(h::get_metadata_folder_path),
        )
        .route("/load_user_metadata", post(h::load_user_metadata))
        .route("/save_user_metadata", post(h::save_user_metadata))
        .route("/update_session_metadata", post(h::update_session_metadata))
        .route("/update_project_metadata", post(h::update_project_metadata))
        .route("/update_user_settings", post(h::update_user_settings))
        .route("/is_project_hidden", post(h::is_project_hidden))
        .route(
            "/get_session_display_name",
            post(h::get_session_display_name),
        )
        // Settings preset commands
        .route("/save_preset", post(h::save_preset))
        .route("/load_presets", post(h::load_presets))
        .route("/get_preset", post(h::get_preset))
        .route("/delete_preset", post(h::delete_preset))
        // MCP preset commands
        .route("/save_mcp_preset", post(h::save_mcp_preset))
        .route("/load_mcp_presets", post(h::load_mcp_presets))
        .route("/get_mcp_preset", post(h::get_mcp_preset))
        .route("/delete_mcp_preset", post(h::delete_mcp_preset))
        // Unified preset commands
        .route("/save_unified_preset", post(h::save_unified_preset))
        .route("/load_unified_presets", post(h::load_unified_presets))
        .route("/get_unified_preset", post(h::get_unified_preset))
        .route("/delete_unified_preset", post(h::delete_unified_preset))
        // Claude settings commands
        .route("/get_settings_by_scope", post(h::get_settings_by_scope))
        .route("/save_settings", post(h::save_settings))
        .route("/get_all_settings", post(h::get_all_settings))
        .route("/get_mcp_servers", post(h::get_mcp_servers))
        .route("/get_all_mcp_servers", post(h::get_all_mcp_servers))
        .route("/save_mcp_servers", post(h::save_mcp_servers))
        .route("/get_claude_json_config", post(h::get_claude_json_config))
        .route("/write_text_file", post(h::write_text_file))
        .route("/read_text_file", post(h::read_text_file))
        .route(
            "/save_screenshot",
            post(h::save_screenshot).layer(DefaultBodyLimit::max(50 * 1024 * 1024)),
        )
        // File watcher (disabled in web mode — SSE replaces it)
        .route("/start_file_watcher", post(h::start_file_watcher))
        .route("/stop_file_watcher", post(h::stop_file_watcher))
        // Multi-provider commands
        .route("/detect_providers", post(h::detect_providers))
        .route("/scan_all_projects", post(h::scan_all_projects))
        .route("/load_provider_sessions", post(h::load_provider_sessions))
        .route(
            "/load_provider_sessions_page",
            post(h::load_provider_sessions_page),
        )
        .route(
            "/load_provider_session_by_path",
            post(h::load_provider_session_by_path),
        )
        .route("/load_provider_messages", post(h::load_provider_messages))
        .route(
            "/load_provider_messages_paginated",
            post(h::load_provider_messages_paginated),
        )
        .route(
            "/get_provider_message_offset",
            post(h::get_provider_message_offset),
        )
        .route("/search_all_providers", post(h::search_all_providers))
        // Archive commands
        .route("/get_archive_base_path", post(h::get_archive_base_path))
        .route("/list_archives", post(h::list_archives))
        .route("/create_archive", post(h::create_archive))
        .route("/delete_archive", post(h::delete_archive))
        .route("/rename_archive", post(h::rename_archive))
        .route("/get_archive_sessions", post(h::get_archive_sessions))
        .route(
            "/load_archive_session_messages",
            post(h::load_archive_session_messages),
        )
        .route("/get_archive_disk_usage", post(h::get_archive_disk_usage))
        .route("/get_expiring_sessions", post(h::get_expiring_sessions))
        .route("/export_session", post(h::export_session))
        // Auth middleware — checks Bearer header or ?token= query param
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            read_only_middleware,
        ))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let api = Router::new()
        .route("/auth/login", post(auth_login_handler))
        .route("/auth/logout", post(auth_logout_handler))
        .merge(protected_api);

    let mut app = Router::new()
        .route("/health", get(health_handler))
        .nest("/api", api)
        .with_state(state)
        // Apply security headers to all responses (API + static assets).
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(cors)
        // Limit request body size to 10 MB to prevent memory exhaustion DoS
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024));

    // Serve React SPA build output as static files.
    // For unknown paths, fall back to index.html with HTTP 200 so client-side routing works.
    let spa_index: SpaIndex;
    if let Some(dist) = dist_dir {
        // External mode: serve from filesystem (development / override)
        let index_html = std::fs::read_to_string(format!("{dist}/index.html"))
            .expect("Failed to read dist/index.html — is --dist correct?");
        let index_html = inject_base_path(&index_html, &base_path);
        spa_index = SpaIndex::Html(Arc::new(index_html));
        let index_for_spa = spa_index.clone();
        let spa = get(move || {
            let index = index_for_spa.clone();
            async move { spa_index_response(index) }
        });
        app = app
            .route("/", spa.clone())
            .fallback_service(ServeDir::new(dist).fallback(spa));
    } else {
        // Embedded mode: serve from rust-embed compiled assets (production default)
        spa_index = SpaIndex::Embedded {
            base_path: base_path.clone(),
        };
        let index_for_root = spa_index.clone();
        let base_path_for_assets = base_path.clone();
        app = app
            .route(
                "/",
                get(move || {
                    let index = index_for_root.clone();
                    async move { spa_index_response(index) }
                }),
            )
            .fallback(get(move |req| {
                let base_path = base_path_for_assets.clone();
                async move { embedded_asset_handler(req, base_path) }
            }));
    }

    if base_path == "/" {
        app
    } else {
        let base_path_with_slash = base_href(&base_path);
        let index_for_base_path = spa_index;
        let base_path_for_fallback = base_path.clone();
        Router::new()
            .nest(&base_path, app)
            .fallback(move |request: Request| {
                let index = index_for_base_path.clone();
                let base_path = base_path_for_fallback.clone();
                let base_path_with_slash = base_path_with_slash.clone();
                async move {
                    let path = request.uri().path();
                    if path == base_path || path == base_path_with_slash {
                        spa_index_response(index)
                    } else {
                        StatusCode::NOT_FOUND.into_response()
                    }
                }
            })
    }
}

/// Normalize a reverse-proxy path prefix for mounting the `WebUI` below `/`.
pub fn normalize_base_path(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return Ok("/".to_string());
    }

    if !trimmed.starts_with('/') {
        return Err("base path must start with '/'".to_string());
    }
    if trimmed.contains('?') || trimmed.contains('#') {
        return Err("base path must not contain query strings or fragments".to_string());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("base path must not contain whitespace".to_string());
    }

    let without_trailing = trimmed.trim_end_matches('/');
    if without_trailing.is_empty() {
        return Ok("/".to_string());
    }

    for segment in without_trailing.split('/').skip(1) {
        if segment.is_empty() {
            return Err("base path must not contain empty segments".to_string());
        }
        if segment == "." || segment == ".." {
            return Err("base path must not contain '.' or '..' segments".to_string());
        }
        // Restrict to URL-unreserved characters so the value cannot break out of the
        // injected `<base href="...">` attribute (defense-in-depth; operator-controlled).
        if !segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~'))
        {
            return Err(
                "base path segments may only contain letters, digits, '-', '_', '.', '~'"
                    .to_string(),
            );
        }
    }

    Ok(without_trailing.to_string())
}

fn base_href(base_path: &str) -> String {
    if base_path == "/" {
        "/".to_string()
    } else {
        format!("{base_path}/")
    }
}

fn inject_base_path(index_html: &str, base_path: &str) -> String {
    let base_path_json = serde_json::to_string(base_path).unwrap_or_else(|_| "\"/\"".to_string());
    let snippet = format!(
        "    <base href=\"{}\" />\n    <script>window.__WEBUI_BASE_PATH__ = {};</script>\n",
        base_href(base_path),
        base_path_json
    );

    if let Some(head_end) = index_html.find("<head>") {
        let insert_at = head_end + "<head>".len();
        let mut html = String::with_capacity(index_html.len() + snippet.len() + 1);
        html.push_str(&index_html[..insert_at]);
        html.push('\n');
        html.push_str(&snippet);
        html.push_str(&index_html[insert_at..]);
        html
    } else {
        format!("{snippet}{index_html}")
    }
}

fn spa_index_response(index: SpaIndex) -> Response {
    match index {
        SpaIndex::Html(html) => Html((*html).clone()).into_response(),
        SpaIndex::Embedded { base_path } => embedded_index_response(base_path),
    }
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

async fn auth_login_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthLoginRequest>,
) -> Response {
    match state.auth.login(&payload) {
        Ok(outcome) => login_response(outcome, state.auth.secure_cookies()),
        Err(failure) => auth_error_response(failure),
    }
}

async fn auth_logout_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    state.auth.logout(&headers);
    clear_auth_cookies_response(state.auth.secure_cookies())
}

/// Apply response security headers globally.
async fn security_headers_middleware(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn read_only_middleware(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    if state.read_only
        && request.method() == Method::POST
        && !is_read_only_allowed_path(request.uri().path())
    {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Server is running in read-only mode"
            })),
        )
            .into_response();
    }

    next.run(request).await
}

/// Whether a protected `/api/*` POST path is on the read-only allowlist. Anything
/// not listed is treated as mutating and rejected when `--read-only` is set.
fn is_read_only_allowed_path(path: &str) -> bool {
    let api_path = path.strip_prefix("/api").unwrap_or(path);
    READ_ONLY_ALLOWED_API_PATHS.contains(&api_path)
}

/// Axum middleware that validates a Bearer token on every `/api/*` request.
///
/// Accepts the token from either:
///   - `Authorization: Bearer <token>` header (normal API calls)
///   - legacy `cchv_auth=<token>` `HttpOnly` cookie (token mode)
///   - `cchv_session=<random-session-id>` `HttpOnly` cookie (account mode)
///   - `?token=<token>` query parameter for SSE only (legacy token mode)
///
/// When auth is disabled (`--no-auth`), all requests pass through.
async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<impl IntoResponse, StatusCode> {
    match state.auth.authenticate(&request) {
        AuthenticatedRequest::None if matches!(state.auth, AuthState::Disabled) => {
            Ok(next.run(request).await)
        }
        AuthenticatedRequest::Token => Ok(next.run(request).await),
        AuthenticatedRequest::Account { csrf_token } => {
            if csrf_valid(&request, &csrf_token) {
                Ok(next.run(request).await)
            } else {
                Err(StatusCode::FORBIDDEN)
            }
        }
        AuthenticatedRequest::None => Err(StatusCode::UNAUTHORIZED),
    }
}

// ---------------------------------------------------------------------------
// SSE endpoint
// ---------------------------------------------------------------------------

/// Server-Sent Events endpoint streaming real-time file change notifications.
///
/// Clients connect via `EventSource` at `GET /api/events?token=<token>`.
/// Each event has:
///   - `event:` field = `session-file-changed` (matching Tauri event names)
///   - `data:` field  = JSON-encoded `FileWatchEvent`
async fn sse_handler(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_tx.subscribe();

    let stream = BroadcastStream::new(rx).filter_map(|result| {
        result.ok().and_then(|file_event| {
            let data = serde_json::to_string(&file_event).ok()?;
            Some(Ok::<_, Infallible>(
                Event::default().event(file_event.event_type).data(data),
            ))
        })
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/// Health check handler — returns minimal status only (unauthenticated endpoint).
async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// ---------------------------------------------------------------------------
// Embedded asset handler
// ---------------------------------------------------------------------------

/// Serve a file from the compiled-in `EmbeddedAssets`.
///
/// - Exact file match → serve with correct `Content-Type`.
/// - No match → serve `index.html` (SPA client-side routing fallback).
fn embedded_asset_handler(req: Request, base_path: String) -> Response {
    let path = req.uri().path().trim_start_matches('/');

    // Try the exact path first, then fall back to index.html for SPA routing.
    let Some(file) = EmbeddedAssets::get(path) else {
        return embedded_index_response(base_path);
    };
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .body(Body::from(file.data.into_owned()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn embedded_index_response(base_path: String) -> Response {
    let Some(body) = embedded_index_body(&base_path) else {
        return (
            StatusCode::NOT_FOUND,
            "index.html not found in embedded assets",
        )
            .into_response();
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html")
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn embedded_index_body(base_path: &str) -> Option<Body> {
    let index = EmbeddedAssets::get("index.html")?;
    let html = String::from_utf8_lossy(&index.data);
    Some(Body::from(inject_base_path(&html, base_path)))
}

/// Start the Axum HTTP server.
pub async fn start(
    state: Arc<AppState>,
    host: &str,
    port: u16,
    dist_dir: Option<&str>,
    base_path: &str,
) {
    let router = build_router(state, host, port, dist_dir, base_path);

    // Resolve via lookup_host so hostnames (e.g. `--host localhost`, which the
    // loopback guard accepts) work and an unresolvable address exits gracefully
    // instead of panicking — SocketAddr::parse alone rejects non-IP hosts.
    let addr: SocketAddr = tokio::net::lookup_host((host, port))
        .await
        .ok()
        .and_then(|mut addrs| addrs.next())
        .unwrap_or_else(|| {
            eprintln!("❌ Could not resolve server address '{host}:{port}'");
            std::process::exit(2);
        });

    if host != "127.0.0.1" {
        eprintln!(
            "⚠ Warning: server is exposed to network ({addr}). Use a token to protect API access."
        );
    }

    eprintln!(
        "🚀 WebUI server running at http://{addr}{}",
        base_href(base_path)
    );
    eprintln!("   Press Ctrl+C to stop");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("❌ Failed to bind to {addr}: {e}");
            eprintln!("   Hint: port {port} may already be in use. Try --port <other>");
            std::process::exit(1);
        });

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Axum server error");
}

/// Wait for SIGINT (Ctrl+C) for graceful shutdown.
///
/// `axum::serve(...).with_graceful_shutdown(...)` waits for every in-flight
/// request to complete before exiting. The SSE stream at `/api/events` is a
/// long-lived response that never completes on its own, so a single Ctrl+C
/// would otherwise hang the process indefinitely (#286).
///
/// To bound the wait, we spawn a fallback task after the first signal: it
/// races a 2-second grace window against a second Ctrl+C and exits the
/// process when either fires. The graceful path still wins for short-lived
/// requests that drain inside the grace window.
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C signal handler");
    eprintln!("\n🛑 Shutting down WebUI server...");

    tokio::spawn(async {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                eprintln!("⚡ Force exit (second Ctrl+C).");
            }
            () = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
        }
        std::process::exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::metadata::MetadataState;
    use crate::server::auth::{
        hash_password_argon2id, AccountAuth, CSRF_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME,
        SESSION_COOKIE_NAME,
    };
    use axum::body::to_bytes;
    use axum::body::Body;
    use serial_test::serial;
    use tower::ServiceExt;

    /// Somewhere no export allowlist would ever cover.
    #[cfg(test)]
    fn restore_gate_probe_path() -> std::path::PathBuf {
        std::env::temp_dir().join("ccv-restore-gate-probe.txt")
    }

    /// #525. The bind-address carve-out is gone: an authenticated loopback
    /// server - the case the old gate existed to permit - must now be refused
    /// just the same when the project has no recorded edit for the path. The
    /// socket is no longer an input to a filesystem decision.
    #[tokio::test]
    #[serial]
    async fn test_restore_refuses_unrecorded_path_even_on_authenticated_loopback() {
        let _home = crate::test_utils::SandboxHome::new();
        let project = tempfile::tempdir().expect("project dir");
        let state = state_with(true, Some("a-token"));
        let app = build_router(state, "127.0.0.1", 3728, None, "/");

        let body = serde_json::json!({
            "filePath": restore_gate_probe_path().to_string_lossy(),
            "content": "should never be written",
            "projectPath": project.path().to_string_lossy(),
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/restore_file")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(
            response.status(),
            StatusCode::OK,
            "loopback plus auth no longer authorises a path the project never edited"
        );
        assert!(
            !restore_gate_probe_path().exists(),
            "the refusal must happen before anything reaches the disk"
        );
    }

    /// Pins the wiring, not just the predicate. Deleting the guard from the
    /// handler leaves both tests above green, which is the failure mode a
    /// pure-function test cannot see.
    #[tokio::test]
    #[serial]
    async fn test_restore_endpoint_refuses_a_path_outside_the_allowlist() {
        let _home = crate::test_utils::SandboxHome::new();
        let state = state_with(false, None);
        let app = build_router(state, "127.0.0.1", 3727, None, "/");

        let project = tempfile::tempdir().expect("project dir");
        let body = serde_json::json!({
            "filePath": restore_gate_probe_path().to_string_lossy(),
            "content": "should never be written",
            "projectPath": project.path().to_string_lossy(),
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/restore_file")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(
            response.status(),
            StatusCode::OK,
            "the endpoint must refuse a path no allowlist covers"
        );
        assert!(
            !restore_gate_probe_path().exists(),
            "the refusal must happen before anything reaches the disk"
        );
    }

    /// POST `body` to `/api/read_restore_target` on a fresh router.
    async fn post_read_restore_target(body: serde_json::Value) -> (StatusCode, String) {
        let app = build_router(state_with(false, None), "127.0.0.1", 3729, None, "/");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/read_restore_target")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    async fn post_usage_breakdown(
        state: Arc<AppState>,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let response = build_router(state, "127.0.0.1", 3731, None, "/")
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/get_usage_breakdown")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| serde_json::Value::String(String::from_utf8_lossy(&bytes).into()));
        (status, value)
    }

    /// ADR 0002: the Axum route serves the same function as the Tauri
    /// command, also in read-only mode, behind the same history-root guard as
    /// the old stats routes.
    #[tokio::test]
    #[serial]
    async fn test_usage_breakdown_route_matches_the_command_and_guards_history_roots() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join(".claude").join("projects").join("p1");
        std::fs::create_dir_all(&project).unwrap();
        let row = serde_json::json!({
            "type": "assistant", "sessionId": "s1", "uuid": "u1",
            "timestamp": "2026-10-15T12:00:00Z",
            "message": {"id": "m1", "role": "assistant", "model": "claude-sonnet-4-5-20250929",
                        "content": [], "usage": {"input_tokens": 100, "output_tokens": 10}}
        });
        std::fs::write(project.join("s1.jsonl"), format!("{row}\n")).unwrap();
        let request = |project_path: &std::path::Path| {
            serde_json::json!({
                "scope": {"kind": "project", "project_path": project_path.to_string_lossy(), "provider": "claude"},
                "stats_mode": "billing_total",
                "intervals": [{"key": "2026-10-15", "start_utc": 1_792_022_400_000_i64, "end_utc": 1_792_108_800_000_i64}],
            })
        };

        let (status, body) = post_usage_breakdown(
            test_state_read_only(),
            serde_json::json!({ "request": request(&project) }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let direct = crate::commands::stats::usage_breakdown::get_usage_breakdown(
            serde_json::from_value(request(&project)).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(body, serde_json::to_value(direct).unwrap());
        assert_eq!(
            body["intervals"][0]["models"][0]["stats"]["token_count"],
            110
        );

        let outside = tempfile::tempdir().unwrap();
        let (status, _) = post_usage_breakdown(
            test_state_read_only(),
            serde_json::json!({ "request": request(outside.path()) }),
        )
        .await;
        assert_ne!(status, StatusCode::OK);
    }

    /// The review probe of `AN0b`, through the route: the root guard checks
    /// the requested directory, so the scan itself must never follow a
    /// symlink out of it — neither a session file nor a project directory.
    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn test_usage_breakdown_route_never_follows_a_symlink_out_of_the_history_root() {
        let home = crate::test_utils::SandboxHome::new();
        let claude = home.path().join(".claude");
        let project = claude.join("projects").join("p");
        std::fs::create_dir_all(&project).unwrap();
        let row = |input: u64| {
            let row = serde_json::json!({
                "type": "assistant", "sessionId": "s", "uuid": "a",
                "timestamp": "2026-10-16T12:00:00Z",
                "message": {"id": "a", "role": "assistant", "model": "claude-sonnet-4-5-20250929",
                            "content": [], "usage": {"input_tokens": input, "output_tokens": 0}}
            });
            format!("{row}\n")
        };
        std::fs::write(project.join("s.jsonl"), row(100)).unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("private.jsonl"), row(4_242)).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("private.jsonl"),
            project.join("escaped.jsonl"),
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), claude.join("projects").join("evil")).unwrap();

        let intervals = serde_json::json!([
            {"key": "2026-10-16", "start_utc": 1_792_108_800_000_i64, "end_utc": 1_792_195_200_000_i64}
        ]);
        let scopes = [
            serde_json::json!({"kind": "project", "project_path": project.to_string_lossy(), "provider": "claude"}),
            serde_json::json!({"kind": "all", "providers": ["claude"],
                               "claude_path": claude.to_string_lossy(), "custom_claude_paths": []}),
        ];
        for scope in scopes {
            let (status, body) = post_usage_breakdown(
                test_state_read_only(),
                serde_json::json!({ "request": {
                    "scope": scope, "stats_mode": "billing_total", "intervals": intervals
                }}),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{body}");
            let tokens: u64 = body["intervals"][0]["models"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["stats"]["token_count"].as_u64().unwrap())
                .sum();
            assert_eq!(tokens, 100, "{scope}: only the history inside the root");
            assert_eq!(
                body["coverage"]["providers"][0]["status"], "partial",
                "{scope}: a refused link is a source that was not read"
            );
        }
    }

    /// #640. The restore preview reads a project file the export allowlist
    /// does not cover, authorised by the same recorded-edit history restore
    /// uses.
    #[tokio::test]
    #[serial]
    async fn test_read_restore_target_reads_a_recorded_project_file() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home
            .path()
            .join(".claude")
            .join("projects")
            .join("-work-app");
        std::fs::create_dir_all(&project).unwrap();
        let workspace = tempfile::tempdir().expect("workspace");
        let target = workspace.path().join("main.rs");
        std::fs::write(&target, "fn main() {}\n").unwrap();
        let record = serde_json::json!({
            "uuid": "u1",
            "sessionId": "s1",
            "timestamp": "2026-10-01T00:00:00Z",
            "type": "user",
            "cwd": workspace.path().to_string_lossy(),
            "toolUseResult": {
                "type": "create",
                "filePath": target.to_string_lossy(),
                "content": "fn main() {}\n",
            }
        });
        std::fs::write(project.join("s1.jsonl"), format!("{record}\n")).unwrap();

        let (status, body) = post_read_restore_target(serde_json::json!({
            "filePath": target.to_string_lossy(),
            "projectPath": project.to_string_lossy(),
        }))
        .await;

        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            serde_json::from_str::<Option<String>>(&body).unwrap(),
            Some("fn main() {}\n".to_string())
        );
    }

    /// The web server's write goes through the same content rule as the desktop
    /// command: only a recorded whole-file version reaches the disk, so an
    /// older frontend sending a row's patch text cannot overwrite the file.
    #[tokio::test]
    #[serial]
    async fn test_restore_endpoint_writes_only_a_recorded_whole_file_version() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home
            .path()
            .join(".claude")
            .join("projects")
            .join("-work-app");
        std::fs::create_dir_all(&project).unwrap();
        let workspace = tempfile::tempdir().expect("workspace");
        let target = workspace.path().join("main.rs");
        let recorded = "fn main() {}\n";
        let record = serde_json::json!({
            "uuid": "u1",
            "sessionId": "s1",
            "timestamp": "2026-10-01T00:00:00Z",
            "type": "user",
            "cwd": workspace.path().to_string_lossy(),
            "toolUseResult": {
                "type": "create",
                "filePath": target.to_string_lossy(),
                "content": recorded,
            }
        });
        std::fs::write(project.join("s1.jsonl"), format!("{record}\n")).unwrap();
        std::fs::write(&target, "edited since\n").unwrap();

        let post = |content: &str| {
            let body = serde_json::json!({
                "filePath": target.to_string_lossy(),
                "content": content,
                "projectPath": project.to_string_lossy(),
            });
            build_router(state_with(false, None), "127.0.0.1", 3730, None, "/").oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/restore_file")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
        };

        let refused = post("*** Begin Patch\n*** Update File: main.rs\n*** End Patch\n")
            .await
            .unwrap();
        assert_ne!(refused.status(), StatusCode::OK);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "edited since\n");

        let restored = post(recorded).await.unwrap();
        assert_eq!(restored.status(), StatusCode::OK);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), recorded);
    }

    /// The handler runs the same project guard `restore_file` does: a project
    /// outside every history root is refused before any read.
    #[tokio::test]
    #[serial]
    async fn test_read_restore_target_refuses_a_project_outside_history_roots() {
        let _home = crate::test_utils::SandboxHome::new();
        let project = tempfile::tempdir().expect("project dir");
        let probe = project.path().join("secret.txt");
        std::fs::write(&probe, "do not leak").unwrap();
        // The project does record an edit to the probe, so the command's own
        // authorisation would admit it: only the handler's guard can refuse.
        let record = serde_json::json!({
            "uuid": "u1",
            "sessionId": "s1",
            "timestamp": "2026-10-01T00:00:00Z",
            "type": "user",
            "cwd": project.path().to_string_lossy(),
            "toolUseResult": {
                "type": "create",
                "filePath": probe.to_string_lossy(),
                "content": "do not leak",
            }
        });
        std::fs::write(project.path().join("s1.jsonl"), format!("{record}\n")).unwrap();

        let (status, body) = post_read_restore_target(serde_json::json!({
            "filePath": probe.to_string_lossy(),
            "projectPath": project.path().to_string_lossy(),
        }))
        .await;

        assert_ne!(status, StatusCode::OK, "{body}");
        assert!(!body.contains("do not leak"), "{body}");
    }

    #[tokio::test]
    #[serial]
    async fn result_metadata_http_matches_native_for_claude_and_codex_windows() {
        use crate::commands::tool_result_metadata_tests::{
            assert_source_metadata, CLAUDE_FIXTURE, CODEX_FIXTURE,
        };
        let home = crate::test_utils::SandboxHome::new();
        for (provider, relative, fixture) in [
            (
                "claude",
                ".claude/projects/contract/s.jsonl",
                CLAUDE_FIXTURE,
            ),
            ("codex", ".codex/sessions/s.jsonl", CODEX_FIXTURE),
        ] {
            let path = home.path().join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, fixture).unwrap();
            for (offset, limit) in [(0, 200), (0, 1), (1, 2), (3, 3), (6, 4), (10, 3), (99, 2)] {
                let direct = crate::commands::multi_provider::load_provider_messages_paginated(
                    provider.into(),
                    path.to_string_lossy().into(),
                    Some(offset),
                    Some(limit),
                    Some(false),
                )
                .await
                .unwrap();
                let (status, response) = post_read_only("load_provider_messages_paginated", serde_json::json!({
                    "provider": provider, "sessionPath": path.to_string_lossy(), "offset": offset, "limit": limit, "excludeSidechain": false,
                })).await;
                assert_eq!(status, StatusCode::OK, "{response}");
                assert_eq!(
                    response,
                    serde_json::to_value(direct).unwrap(),
                    "{provider} offset {offset} limit {limit}"
                );
                if provider == "claude" {
                    assert_source_metadata(&response);
                }
            }
        }
        // The additive contract must not widen history-root authorization.
        let outside = tempfile::tempdir().unwrap();
        let path = outside.path().join("secret.jsonl");
        std::fs::write(&path, CLAUDE_FIXTURE).unwrap();
        let (status, response) = post_read_only(
            "load_provider_messages_paginated",
            serde_json::json!({
                "provider":"claude", "sessionPath":path.to_string_lossy(), "offset":0, "limit":200,
            }),
        )
        .await;
        assert_ne!(status, StatusCode::OK);
        assert!(!response.to_string().contains("unassignable"));
    }

    #[tokio::test]
    #[serial]
    async fn codex_structured_metadata_loopback_http_matches_native() {
        use crate::commands::tool_result_metadata_tests::{
            assert_codex_structured_metadata, CODEX_STRUCTURED_FIXTURE,
        };
        let home = crate::test_utils::SandboxHome::new();
        let app = build_router(test_state_read_only(), "127.0.0.1", 3730, None, "/");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        for (provider, root) in [("codex", ".codex"), ("openinterpreter", ".openinterpreter")] {
            let path = home
                .path()
                .join(root)
                .join("sessions/rollout-structured.jsonl");
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, CODEX_STRUCTURED_FIXTURE).unwrap();
            for (offset, limit) in [(0, 200), (0, 1), (1, 2), (3, 3), (6, 4), (7, 2), (99, 2)] {
                let native = crate::commands::multi_provider::load_provider_messages_paginated(
                    provider.into(),
                    path.to_string_lossy().into(),
                    Some(offset),
                    Some(limit),
                    Some(false),
                )
                .await
                .unwrap();
                let (status, response) = post_loopback_json(address, "load_provider_messages_paginated", serde_json::json!({
                    "provider":provider, "sessionPath":path.to_string_lossy(), "offset":offset, "limit":limit, "excludeSidechain":false,
                })).await;
                assert_eq!(status, 200, "{response}");
                assert_eq!(response, serde_json::to_value(native).unwrap());
                assert_codex_structured_metadata(&response);
            }
            let native = crate::commands::multi_provider::load_provider_messages(
                provider.into(),
                path.to_string_lossy().into(),
            )
            .await
            .unwrap();
            let (status, response) = post_loopback_json(
                address,
                "load_provider_messages",
                serde_json::json!({"provider":provider,"sessionPath":path.to_string_lossy()}),
            )
            .await;
            assert_eq!(status, 200, "{response}");
            assert_eq!(response, serde_json::to_value(native).unwrap());
            assert_codex_structured_metadata(&serde_json::json!({"messages":response}));
        }
        let outside = tempfile::tempdir().unwrap();
        let path = outside.path().join("rollout-secret.jsonl");
        std::fs::write(&path, CODEX_STRUCTURED_FIXTURE).unwrap();
        for provider in ["codex", "openinterpreter", "unknown-trbe"] {
            let (status, response) = post_loopback_json(
                address,
                "load_provider_messages_paginated",
                serde_json::json!({"provider":provider,"sessionPath":path.to_string_lossy()}),
            )
            .await;
            assert_ne!(status, 200, "{provider}: {response}");
            assert!(!response.to_string().contains("result-function"));
        }
        eprintln!("TRbe loopback {address}: 2 providers, 14 paginated windows, 2 non-paginated responses, 3 refusal controls");
        server.abort();
    }

    async fn post_loopback_json(
        address: std::net::SocketAddr,
        route: &str,
        body: serde_json::Value,
    ) -> (u16, serde_json::Value) {
        let route = route.to_string();
        tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            let mut socket = std::net::TcpStream::connect(address).unwrap();
            socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let body = body.to_string();
            write!(socket, "POST /api/{route} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            let mut response = String::new();
            socket.read_to_string(&mut response).unwrap();
            let (headers, body) = response.split_once("\r\n\r\n").unwrap();
            let status = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
            (status, serde_json::from_str(body).unwrap())
        }).await.unwrap()
    }
    /// POST `body` to `/api/<route>` on a fresh read-only router, the mode a
    /// shared `--serve` instance runs in. The body is `Null` when it is not
    /// JSON.
    async fn post_read_only(
        route: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let app = build_router(test_state_read_only(), "127.0.0.1", 3730, None, "/");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/{route}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    /// One Claude JSONL row: a user prompt, or an assistant reply that used
    /// `tokens` input tokens.
    fn history_row(session: &str, uuid: &str, user_text: Option<&str>, tokens: u64) -> String {
        let row = match user_text {
            Some(text) => serde_json::json!({
                "type": "user", "sessionId": session, "uuid": uuid,
                "timestamp": "2026-10-15T12:00:00Z",
                "message": {"role": "user", "content": text}
            }),
            None => serde_json::json!({
                "type": "assistant", "sessionId": session, "uuid": uuid,
                "timestamp": "2026-10-15T12:00:01Z",
                "message": {"id": format!("msg-{uuid}"), "role": "assistant",
                            "model": "claude-sonnet-4-5-20250929", "content": [],
                            "usage": {"input_tokens": tokens, "output_tokens": 0}}
            }),
        };
        format!("{row}\n")
    }

    /// The old stats routes (#691, backported): the history-root guard checks
    /// the requested directory or file, so the scans behind it must never
    /// follow a symlink out of the root: not a session file, not a project
    /// directory, not a session's subagent folder.
    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn test_old_stats_routes_never_follow_a_symlink_out_of_the_history_root() {
        use std::os::unix::fs::symlink;
        let home = crate::test_utils::SandboxHome::new();
        let claude = home.path().join(".claude");
        let project = claude.join("projects").join("p");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("s1.jsonl"), history_row("s1", "a1", None, 100)).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let private = outside.path().join("private.jsonl");
        std::fs::write(&private, history_row("private", "x1", None, 4_242)).unwrap();
        let subagents = outside.path().join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        std::fs::write(
            subagents.join("agent-x.jsonl"),
            history_row("s1", "x2", None, 4_242),
        )
        .unwrap();
        symlink(&private, project.join("escaped.jsonl")).unwrap();
        symlink(outside.path(), claude.join("projects").join("evil")).unwrap();
        symlink(outside.path(), project.join("s1")).unwrap();

        let project_path = project.to_string_lossy();
        let session_path = project.join("s1.jsonl");
        let routes = [
            (
                "get_project_stats_summary",
                serde_json::json!({ "projectPath": project_path }),
            ),
            (
                "get_project_token_stats",
                serde_json::json!({ "projectPath": project_path, "limit": 100 }),
            ),
            (
                "get_session_token_stats",
                serde_json::json!({ "sessionPath": session_path.to_string_lossy() }),
            ),
            (
                "get_global_stats_summary",
                serde_json::json!({
                    "claudePath": claude.to_string_lossy(), "activeProviders": ["claude"]
                }),
            ),
        ];
        let mut tokens_by_route = Vec::new();
        for (route, body) in routes {
            let (status, json) = post_read_only(route, body).await;
            assert_eq!(status, StatusCode::OK, "{route}: {json}");
            let tokens: u64 = match json.get("items") {
                Some(items) => items
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| item["total_tokens"].as_u64().unwrap())
                    .sum(),
                None => json["total_tokens"].as_u64().unwrap(),
            };
            tokens_by_route.push((route, tokens));
        }
        // Only the history inside the root, on every route at once.
        assert_eq!(
            tokens_by_route,
            [
                ("get_project_stats_summary", 100),
                ("get_project_token_stats", 100),
                ("get_session_token_stats", 100),
                ("get_global_stats_summary", 100),
            ]
        );
    }

    /// #693. The root guard lets an empty `claudePath` through as "use the
    /// default", so every route behind it reads `~/.claude`, never a
    /// `projects/` folder relative to the server's working directory. An
    /// absent `claudePath` (global stats) means the same.
    #[tokio::test]
    #[serial]
    async fn test_an_empty_claude_path_reads_the_default_root() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join(".claude").join("projects").join("p");
        std::fs::create_dir_all(&project).unwrap();
        let session = history_row("s1", "u1", Some("needle-693 in the default root"), 0)
            + &history_row("s1", "a1", None, 100);
        std::fs::write(project.join("s1.jsonl"), session).unwrap();

        let claude_only = serde_json::json!(["claude"]);
        let routes = [
            ("scan_projects", serde_json::json!({ "claudePath": "" })),
            (
                "scan_all_projects",
                serde_json::json!({ "claudePath": "", "activeProviders": claude_only }),
            ),
            (
                "search_messages",
                serde_json::json!({ "claudePath": "", "query": "needle-693", "filters": {} }),
            ),
            (
                "search_all_providers",
                serde_json::json!({
                    "claudePath": "", "query": "needle-693", "activeProviders": claude_only
                }),
            ),
        ];
        let mut results = Vec::new();
        for (route, body) in routes {
            let (status, json) = post_read_only(route, body).await;
            assert_eq!(status, StatusCode::OK, "{route}: {json}");
            results.push((route, json.as_array().map(Vec::len)));
        }
        for (label, body) in [
            (
                "get_global_stats_summary tokens, empty claudePath",
                serde_json::json!({ "claudePath": "", "activeProviders": claude_only }),
            ),
            (
                "get_global_stats_summary tokens, no claudePath",
                serde_json::json!({ "activeProviders": claude_only }),
            ),
        ] {
            let (status, json) = post_read_only("get_global_stats_summary", body).await;
            assert_eq!(status, StatusCode::OK, "{label}: {json}");
            results.push((label, json["total_tokens"].as_u64().map(|t| t as usize)));
        }
        // The default root's one project, its one match and its 100 tokens,
        // on every route at once.
        assert_eq!(
            results,
            [
                ("scan_projects", Some(1)),
                ("scan_all_projects", Some(1)),
                ("search_messages", Some(1)),
                ("search_all_providers", Some(1)),
                (
                    "get_global_stats_summary tokens, empty claudePath",
                    Some(100)
                ),
                ("get_global_stats_summary tokens, no claudePath", Some(100)),
            ]
        );
    }

    /// The session routes stay inside the history root as the stats routes
    /// do: the guard checks the requested project or session, so the readers
    /// behind it must never follow a symlink below it, not a session file
    /// and not a session's subagent folder.
    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn test_session_routes_never_follow_a_symlink_out_of_the_history_root() {
        use std::os::unix::fs::symlink;
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join(".claude").join("projects").join("p");
        std::fs::create_dir_all(&project).unwrap();
        let session = history_row("s1", "u1", Some("inside"), 0);
        std::fs::write(project.join("s1.jsonl"), session).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let private = outside.path().join("private.jsonl");
        std::fs::write(&private, history_row("private", "x1", Some("outside"), 0)).unwrap();
        let subagents = outside.path().join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        let subagent = history_row("s1", "x2", Some("outside subagent"), 0);
        std::fs::write(subagents.join("agent-x.jsonl"), subagent).unwrap();
        symlink(&private, project.join("escaped.jsonl")).unwrap();
        symlink(outside.path(), project.join("s1")).unwrap();

        let project_path = project.to_string_lossy();
        let session_path = project.join("s1.jsonl");
        let routes = [
            (
                "load_project_sessions",
                serde_json::json!({ "projectPath": project_path }),
            ),
            (
                "load_provider_sessions",
                serde_json::json!({ "provider": "claude", "projectPath": project_path }),
            ),
            (
                "get_session_subagents",
                serde_json::json!({ "sessionPath": session_path.to_string_lossy() }),
            ),
            (
                "get_expiring_sessions",
                serde_json::json!({ "projectPath": project_path, "thresholdDays": 100_000 }),
            ),
        ];
        let name = |path: &serde_json::Value| {
            std::path::Path::new(path.as_str().unwrap())
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string()
        };
        let mut shown = Vec::new();
        for (route, body) in routes {
            let (status, json) = post_read_only(route, body).await;
            assert_eq!(status, StatusCode::OK, "{route}: {json}");
            let mut items: Vec<String> = json
                .as_array()
                .unwrap()
                .iter()
                .map(|item| match route {
                    "get_session_subagents" => item["summary"].to_string(),
                    "get_expiring_sessions" => format!(
                        "{}: {} subagents",
                        name(&item["session"]["file_path"]),
                        item["subagentCount"]
                    ),
                    _ => format!("{}: {}", name(&item["file_path"]), item["summary"]),
                })
                .collect();
            items.sort();
            shown.push((route, items));
        }
        // Only the history inside the root, on every route at once.
        assert_eq!(
            shown,
            [
                (
                    "load_project_sessions",
                    vec![r#"s1.jsonl: "inside""#.to_string()]
                ),
                (
                    "load_provider_sessions",
                    vec![r#"s1.jsonl: "inside""#.to_string()]
                ),
                ("get_session_subagents", vec![]),
                (
                    "get_expiring_sessions",
                    vec!["s1.jsonl: 0 subagents".to_string()]
                ),
            ]
        );
    }

    /// `post_read_only` on a thread of its own, so a route that never answers
    /// fails the test instead of stalling it: `None` after 10 s, and the
    /// thread is left behind.
    #[cfg(unix)]
    fn post_read_only_within_deadline(
        route: &'static str,
        body: serde_json::Value,
    ) -> Option<(StatusCode, serde_json::Value)> {
        let (sent, received) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Runtime::new().unwrap();
            sent.send(runtime.block_on(post_read_only(route, body)))
        });
        received
            .recv_timeout(std::time::Duration::from_secs(10))
            .ok()
    }

    /// Inside a history root only directories and regular files are history.
    /// The routes answer with a directory and a FIFO named like a session in
    /// the project: the lists skip both, and a route given either as the
    /// session refuses it instead of reading it forever (a directory) or
    /// blocking on it (a FIFO). Every route that reads one Claude session by
    /// its path is refused by the history-root guard before a reader runs, so
    /// none of the single-session readers is reachable with a FIFO here.
    #[cfg(unix)]
    #[test]
    #[serial]
    fn test_session_routes_answer_with_entries_that_are_not_regular_files() {
        let home = crate::test_utils::SandboxHome::new();
        let project = home.path().join(".claude").join("projects").join("q");
        std::fs::create_dir_all(project.join("folder.jsonl")).unwrap();
        let session = history_row("s9", "u9", Some("inside"), 0);
        std::fs::write(project.join("s9.jsonl"), session).unwrap();
        let fifo = project.join("fifo.jsonl");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(made.success());

        let project_path = project.to_string_lossy().to_string();
        let folder_path = project.join("folder.jsonl").to_string_lossy().to_string();
        let fifo_path = fifo.to_string_lossy().to_string();
        let routes = [
            (
                "load_project_sessions",
                serde_json::json!({ "projectPath": project_path }),
            ),
            (
                "load_project_sessions_page",
                serde_json::json!({ "projectPath": project_path }),
            ),
            (
                "load_provider_session_by_path",
                serde_json::json!({
                    "provider": "claude", "projectPath": project_path, "filePath": folder_path
                }),
            ),
            (
                "load_session_messages",
                serde_json::json!({ "sessionPath": fifo_path }),
            ),
            (
                "load_session_messages_paginated",
                serde_json::json!({ "sessionPath": fifo_path, "offset": 0, "limit": 10 }),
            ),
            (
                "get_session_message_count",
                serde_json::json!({ "sessionPath": fifo_path }),
            ),
            (
                "export_session",
                serde_json::json!({ "sessionFilePath": fifo_path, "format": "json" }),
            ),
            (
                "load_provider_messages",
                serde_json::json!({ "provider": "claude", "sessionPath": fifo_path }),
            ),
            (
                "load_provider_messages_paginated",
                serde_json::json!({
                    "provider": "claude", "sessionPath": fifo_path, "offset": 0, "limit": 10
                }),
            ),
            (
                "get_provider_message_offset",
                serde_json::json!({
                    "provider": "claude", "sessionPath": fifo_path, "messageUuid": "u9"
                }),
            ),
            (
                "get_session_token_stats",
                serde_json::json!({ "sessionPath": fifo_path }),
            ),
            (
                "get_recent_edits",
                serde_json::json!({ "projectPath": project_path, "sessionFilePath": fifo_path }),
            ),
        ];
        let answers: Vec<(&str, String)> = routes
            .into_iter()
            .map(|(route, body)| {
                let answer = match post_read_only_within_deadline(route, body) {
                    None => "stalled".to_string(),
                    Some((StatusCode::OK, json)) => {
                        let sessions = json.get("sessions").unwrap_or(&json);
                        format!("{} sessions", sessions.as_array().unwrap().len())
                    }
                    Some((_, json)) => json["error"].as_str().unwrap_or_default().to_string(),
                };
                (route, answer)
            })
            .collect();
        let refused = "Path is not a regular file or directory".to_string();
        assert_eq!(
            answers,
            [
                ("load_project_sessions", "1 sessions".to_string()),
                ("load_project_sessions_page", "1 sessions".to_string()),
                (
                    "load_provider_session_by_path",
                    "Session file is not a regular file".to_string()
                ),
                ("load_session_messages", refused.clone()),
                ("load_session_messages_paginated", refused.clone()),
                ("get_session_message_count", refused.clone()),
                ("export_session", refused.clone()),
                ("load_provider_messages", refused.clone()),
                ("load_provider_messages_paginated", refused.clone()),
                ("get_provider_message_offset", refused.clone()),
                ("get_session_token_stats", refused.clone()),
                ("get_recent_edits", refused),
            ]
        );
    }

    /// An `AppState` differing only in the two inputs the gate reads.
    fn state_with(loopback_bind: bool, auth_token: Option<&str>) -> Arc<AppState> {
        let state = test_state(auth_token);
        let (event_tx, _rx) =
            tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(1);
        Arc::new(AppState {
            metadata: Arc::clone(&state.metadata),
            start_time: state.start_time,
            auth: state.auth.clone(),
            read_only: state.read_only,
            loopback_bind,
            event_tx,
        })
    }

    fn test_state(auth_token: Option<&str>) -> Arc<AppState> {
        let (event_tx, _rx) =
            tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(1);
        Arc::new(AppState {
            metadata: Arc::new(MetadataState::default()),
            start_time: std::time::Instant::now(),
            auth: auth_token
                .map(|token| AuthState::Token {
                    token: token.to_string(),
                    secure_cookies: false,
                })
                .unwrap_or(AuthState::Disabled),
            read_only: false,
            loopback_bind: false,
            event_tx,
        })
    }

    fn test_account_state() -> Arc<AppState> {
        let (event_tx, _rx) =
            tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(1);
        let password_hash = hash_password_argon2id("secret-password").unwrap();
        Arc::new(AppState {
            metadata: Arc::new(MetadataState::default()),
            start_time: std::time::Instant::now(),
            auth: AuthState::Account(Arc::new(AccountAuth::new(
                "admin".to_string(),
                password_hash,
                false,
            ))),
            read_only: false,
            loopback_bind: false,
            event_tx,
        })
    }

    fn test_state_read_only() -> Arc<AppState> {
        let (event_tx, _rx) =
            tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(1);
        Arc::new(AppState {
            metadata: Arc::new(MetadataState::default()),
            start_time: std::time::Instant::now(),
            auth: AuthState::Disabled,
            read_only: true,
            loopback_bind: false,
            event_tx,
        })
    }

    fn cookie_header_from_response(response: &Response) -> String {
        response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(|cookie| cookie.split(';').next())
            .collect::<Vec<_>>()
            .join("; ")
    }

    #[test]
    fn test_allow_query_token_only_for_sse_get() {
        let auth = AuthState::Token {
            token: "abc".to_string(),
            secure_cookies: false,
        };
        let sse_get = Request::builder()
            .method(Method::GET)
            .uri("/api/events?token=abc")
            .body(Body::empty())
            .unwrap();
        assert!(matches!(
            auth.authenticate(&sse_get),
            AuthenticatedRequest::Token
        ));

        let api_post = Request::builder()
            .method(Method::POST)
            .uri("/api/scan_projects?token=abc")
            .body(Body::empty())
            .unwrap();
        assert!(matches!(
            auth.authenticate(&api_post),
            AuthenticatedRequest::None
        ));

        let non_sse_get = Request::builder()
            .method(Method::GET)
            .uri("/api/load_project_sessions?token=abc")
            .body(Body::empty())
            .unwrap();
        assert!(matches!(
            auth.authenticate(&non_sse_get),
            AuthenticatedRequest::None
        ));
    }
    #[test]
    fn test_auth_cookie_token_reads_named_cookie() {
        let auth = AuthState::Token {
            token: "abc 123".to_string(),
            secure_cookies: false,
        };
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/scan_projects")
            .header(header::COOKIE, "theme=dark; cchv_auth=abc%20123; other=1")
            .body(Body::empty())
            .unwrap();

        assert!(matches!(
            auth.authenticate(&request),
            AuthenticatedRequest::Token
        ));
    }

    #[tokio::test]
    async fn test_auth_login_sets_http_only_cookie() {
        let app = build_router(
            test_state(Some("secret-token")),
            "127.0.0.1",
            3727,
            None,
            "/",
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"token":"secret-token"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let cookie = response
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie.contains(&format!("{LEGACY_AUTH_COOKIE_NAME}=secret-token")));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains("Path=/"));
        assert!(cookie.contains("Max-Age=604800"));
    }

    #[tokio::test]
    async fn test_auth_cookie_allows_protected_api() {
        let app = build_router(
            test_state(Some("secret-token")),
            "127.0.0.1",
            3727,
            None,
            "/",
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/events")
                    .header(header::COOKIE, "theme=dark; cchv_auth=secret-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_invalid_auth_login_is_rejected() {
        let app = build_router(
            test_state(Some("secret-token")),
            "127.0.0.1",
            3727,
            None,
            "/",
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"token":"wrong"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_account_login_sets_session_and_csrf_cookies() {
        let app = build_router(test_account_state(), "127.0.0.1", 3727, None, "/");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"username":"admin","password":"secret-password"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let cookies = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();
        assert!(cookies
            .iter()
            .any(|cookie| cookie.contains(&format!("{SESSION_COOKIE_NAME}="))
                && cookie.contains("HttpOnly")
                && cookie.contains("SameSite=Strict")));
        assert!(cookies.iter().any(|cookie| {
            cookie.contains(&format!("{CSRF_COOKIE_NAME}=")) && cookie.contains("SameSite=Strict")
        }));
    }

    #[tokio::test]
    async fn test_account_session_requires_csrf_for_post() {
        let app = build_router(test_account_state(), "127.0.0.1", 3727, None, "/");
        let login_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"username":"admin","password":"secret-password"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie_header = cookie_header_from_response(&login_response);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/get_claude_folder_path")
                    .header(header::COOKIE, cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_read_only_blocks_mutating_api_paths() {
        for path in [
            "/delete_session",
            "/api/delete_session",
            "/api/rename_session_native",
            "/api/update_user_settings",
            "/api/save_settings",
            "/api/write_text_file",
            "/api/create_archive",
        ] {
            assert!(!is_read_only_allowed_path(path), "{path} should be blocked");
        }
    }

    #[test]
    fn test_read_only_allows_read_api_paths() {
        for path in [
            "/get_server_config",
            "/api/get_server_config",
            "/api/load_session_messages",
            "/api/search_messages",
            "/api/get_all_settings",
            "/api/export_session",
        ] {
            assert!(
                is_read_only_allowed_path(path),
                "{path} should remain readable"
            );
        }
    }

    #[test]
    fn test_read_only_blocks_unknown_routes_by_default() {
        // Deny-by-default: a route that is not on the read allowlist (e.g. a future
        // mutating command someone forgets to classify) is blocked rather than leaked.
        for path in ["/api/some_future_command", "/api/purge_everything"] {
            assert!(
                !is_read_only_allowed_path(path),
                "{path} must be denied by default"
            );
        }
    }

    /// Self-maintaining guard: parse every POST route registered in this file and
    /// assert each is classified (allowed read or mutating), and that neither list
    /// has a stale entry. Adding a `.route("/x", post(..))` without classifying it
    /// fails here — the failure mode the read-only allowlist must never regress into.
    #[test]
    fn read_only_classification_covers_every_post_route() {
        use std::collections::HashSet;
        // Scope to the build_router body so doc-comment examples and test-only routers
        // elsewhere in this file are not parsed as real routes.
        let full = include_str!("mod.rs");
        let start = full
            .find("pub fn build_router")
            .expect("build_router definition");
        // End at the test module so this test's own doc-comment route examples and
        // any test-only routers are never parsed as real routes. Only build_router
        // (and the asset/start helpers, which register no routes) precede it.
        let end = full[start..]
            .find("\n#[cfg(test)]")
            .map(|i| start + i)
            .expect("test module marker after build_router");
        let src = &full[start..end];
        // Matches both inline and multi-line `.route( "<path>", post(` forms. Charset
        // is broad (letters/digits/-/_) so a future route can't evade classification.
        let re = regex::Regex::new(r#"\.route\(\s*"(/[A-Za-z0-9_-]+)"\s*,\s*post\("#).unwrap();
        let registered: HashSet<&str> = re
            .captures_iter(src)
            .map(|c| c.get(1).unwrap().as_str())
            .collect();
        let allowed: HashSet<&str> = READ_ONLY_ALLOWED_API_PATHS.iter().copied().collect();
        let mutating: HashSet<&str> = READ_ONLY_MUTATING_API_PATHS.iter().copied().collect();

        assert!(
            allowed.is_disjoint(&mutating),
            "a path is classified as both read and mutating"
        );
        assert!(!registered.is_empty(), "route extraction matched nothing");
        for path in &registered {
            assert!(
                allowed.contains(path) || mutating.contains(path),
                "POST route {path} is unclassified — add it to READ_ONLY_ALLOWED_API_PATHS \
                 (reads) or READ_ONLY_MUTATING_API_PATHS (mutations)"
            );
        }
        for path in allowed.iter().chain(mutating.iter()) {
            assert!(
                registered.contains(path),
                "classified path {path} is not a registered POST route (stale entry)"
            );
        }
    }

    #[test]
    fn test_normalize_base_path() {
        assert_eq!(normalize_base_path("").unwrap(), "/");
        assert_eq!(normalize_base_path("/").unwrap(), "/");
        assert_eq!(normalize_base_path("/viewer/").unwrap(), "/viewer");
        assert_eq!(
            normalize_base_path("/tools/claude-history").unwrap(),
            "/tools/claude-history"
        );

        assert!(normalize_base_path("viewer").is_err());
        assert!(normalize_base_path("/viewer//history").is_err());
        assert!(normalize_base_path("/viewer/../history").is_err());
        assert!(normalize_base_path("/viewer?x=1").is_err());
        assert!(normalize_base_path("/viewer history").is_err());
    }

    #[test]
    fn test_inject_base_path_adds_base_and_runtime_config() {
        let html = "<html><head><title>x</title></head><body></body></html>";
        let injected = inject_base_path(html, "/tools/history");

        assert!(injected.contains("<base href=\"/tools/history/\" />"));
        assert!(injected.contains("window.__WEBUI_BASE_PATH__ = \"/tools/history\";"));
        assert!(injected.find("<base").unwrap() < injected.find("<title>").unwrap());
    }

    #[tokio::test]
    async fn test_prefixed_router_serves_api_under_base_path() {
        let app = build_router(test_state(None), "127.0.0.1", 3727, None, "/viewer");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/viewer/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_prefixed_router_does_not_expose_root_api() {
        let app = build_router(test_state(None), "127.0.0.1", 3727, None, "/viewer");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_prefixed_spa_fallback_injects_base_path() {
        let app = build_router(test_state(None), "127.0.0.1", 3727, None, "/viewer");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/viewer/sessions/abc")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        assert!(body.contains("<base href=\"/viewer/\" />"));
        assert!(body.contains("window.__WEBUI_BASE_PATH__ = \"/viewer\";"));
    }

    #[tokio::test]
    async fn test_prefixed_router_serves_spa_root() {
        let app = build_router(test_state(None), "127.0.0.1", 3727, None, "/viewer");
        for uri in ["/viewer", "/viewer/"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::GET)
                        .uri(uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let body = String::from_utf8(body.to_vec()).unwrap();
            assert!(body.contains("<base href=\"/viewer/\" />"));
        }
    }

    #[tokio::test]
    async fn read_only_mode_blocks_mutations_over_http() {
        let app = build_router(test_state_read_only(), "127.0.0.1", 3727, None, "/");
        // A mutating route is rejected with 403 by the read-only layer.
        let blocked = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/delete_session")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
        // An allowed read route passes the read-only layer (it reaches the handler and
        // is never 403'd by read-only). get_server_config is lightweight and does not
        // touch the filesystem, so this stays fast and deterministic.
        let allowed = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/get_server_config")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(allowed.status(), StatusCode::FORBIDDEN);
    }

    /// The `WebUI` has no native menu: its menu routes are read-only-allowed
    /// no-ops - `sync_menu_state` and `ack_menu_events` do nothing,
    /// `menu_journal` is empty (desktop/WebUI command parity).
    #[tokio::test]
    async fn menu_routes_are_no_ops_in_the_webui() {
        for (route, body, expected) in [
            (
                "sync_menu_state",
                r#"{"state":{"language":"ko","items":{"go.back":{"enabled":true}},"frontTabId":"t1"}}"#,
                serde_json::json!(null),
            ),
            (
                "menu_journal",
                "{}",
                serde_json::json!({ "epoch": "webui", "floor": 0, "events": [] }),
            ),
            (
                "ack_menu_events",
                r#"{"epoch":"webui","seq":3}"#,
                serde_json::json!(null),
            ),
        ] {
            let app = build_router(test_state_read_only(), "127.0.0.1", 3727, None, "/");
            let response = app
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri(format!("/api/{route}"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{route}");
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value, expected, "{route}");
        }
    }

    #[tokio::test]
    async fn read_only_enforcement_survives_base_path_nesting() {
        // .nest(&base_path, app) strips the prefix, so the inner read-only layer must
        // still see /api/... and block mutations under a configured base path.
        let app = build_router(test_state_read_only(), "127.0.0.1", 3727, None, "/viewer");
        let blocked = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/viewer/api/delete_session")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
    }
}
