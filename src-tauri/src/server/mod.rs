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

pub mod handlers;
pub mod state;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
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
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

use self::handlers as h;
use self::state::AppState;

/// Frontend assets embedded at compile time from the `dist/` directory.
///
/// When building with `cargo build --features webui-server`, the contents of
/// `../dist` (relative to `src-tauri/`) are baked into the binary. At runtime
/// the embedded files are served directly from memory — no filesystem access needed.
#[derive(Embed)]
#[folder = "../dist"]
struct EmbeddedAssets;

/// Build the complete Axum router with all API routes and SPA fallback.
pub fn build_router(state: Arc<AppState>, dist_dir: Option<&str>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        // SSE endpoint for real-time file change events
        .route("/events", get(sse_handler))
        // Project commands
        .route("/get_claude_folder_path", post(h::get_claude_folder_path))
        .route("/validate_claude_folder", post(h::validate_claude_folder))
        .route("/scan_projects", post(h::scan_projects))
        .route("/get_git_log", post(h::get_git_log))
        // Session commands
        .route("/load_project_sessions", post(h::load_project_sessions))
        .route("/load_session_messages", post(h::load_session_messages))
        .route(
            "/load_session_messages_paginated",
            post(h::load_session_messages_paginated),
        )
        .route(
            "/get_session_message_count",
            post(h::get_session_message_count),
        )
        .route("/search_messages", post(h::search_messages))
        .route("/get_recent_edits", post(h::get_recent_edits))
        .route("/restore_file", post(h::restore_file))
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
        // Feedback commands
        .route("/send_feedback", post(h::send_feedback))
        .route("/get_system_info", post(h::get_system_info))
        .route("/open_github_issues", post(h::open_github_issues))
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
        // File watcher (disabled in web mode — SSE replaces it)
        .route("/start_file_watcher", post(h::start_file_watcher))
        .route("/stop_file_watcher", post(h::stop_file_watcher))
        // Multi-provider commands
        .route("/detect_providers", post(h::detect_providers))
        .route("/scan_all_projects", post(h::scan_all_projects))
        .route("/load_provider_sessions", post(h::load_provider_sessions))
        .route("/load_provider_messages", post(h::load_provider_messages))
        .route("/search_all_providers", post(h::search_all_providers))
        // Auth middleware — checks Bearer header or ?token= query param
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let mut app = Router::new()
        .route("/health", get(health_handler))
        .nest("/api", api)
        .with_state(state)
        .layer(cors);

    // Serve React SPA build output as static files.
    // For unknown paths, fall back to index.html with HTTP 200 so client-side routing works.
    if let Some(dist) = dist_dir {
        // External mode: serve from filesystem (development / override)
        let index_html = std::fs::read_to_string(format!("{dist}/index.html"))
            .expect("Failed to read dist/index.html — is --dist correct?");
        let spa_fallback = get(move || std::future::ready(Html(index_html.clone())));
        let serve_dir = ServeDir::new(dist);
        app = app.fallback_service(serve_dir.fallback(spa_fallback));
    } else {
        // Embedded mode: serve from rust-embed compiled assets (production default)
        app = app.fallback(get(embedded_asset_handler));
    }

    app
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/// Axum middleware that validates a Bearer token on every `/api/*` request.
///
/// Accepts the token from either:
///   - `Authorization: Bearer <token>` header (normal API calls)
///   - `?token=<token>` query parameter (`EventSource` / SSE connections)
///
/// When `auth_token` is `None` (i.e. `--no-auth`), all requests pass through.
async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<impl IntoResponse, StatusCode> {
    let Some(expected) = &state.auth_token else {
        return Ok(next.run(request).await);
    };

    // 1. Check Authorization header
    if let Some(header) = request.headers().get("authorization") {
        if let Ok(value) = header.to_str() {
            if let Some(token) = value.strip_prefix("Bearer ") {
                if token == expected.as_str() {
                    return Ok(next.run(request).await);
                }
            }
        }
    }

    // 2. Check ?token= query parameter (for EventSource which cannot set headers)
    if let Some(query) = request.uri().query() {
        for pair in query.split('&') {
            if let Some(token) = pair.strip_prefix("token=") {
                let decoded = urlencoding::decode(token).unwrap_or_default();
                if decoded == *expected {
                    return Ok(next.run(request).await);
                }
            }
        }
    }

    Err(StatusCode::UNAUTHORIZED)
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

/// Health check handler returning server status, version, and uptime.
async fn health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let uptime_secs = state.start_time.elapsed().as_secs();
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_secs": uptime_secs,
    }))
}

// ---------------------------------------------------------------------------
// Embedded asset handler
// ---------------------------------------------------------------------------

/// Serve a file from the compiled-in `EmbeddedAssets`.
///
/// - Exact file match → serve with correct `Content-Type`.
/// - No match → serve `index.html` (SPA client-side routing fallback).
async fn embedded_asset_handler(req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');

    // Try the exact path first, then fall back to index.html for SPA routing.
    let (data, mime) = if let Some(file) = EmbeddedAssets::get(path) {
        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();
        (file.data, mime)
    } else if let Some(index) = EmbeddedAssets::get("index.html") {
        (index.data, "text/html".to_string())
    } else {
        return (
            StatusCode::NOT_FOUND,
            "index.html not found in embedded assets",
        )
            .into_response();
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .body(Body::from(data.into_owned()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Start the Axum HTTP server.
pub async fn start(state: Arc<AppState>, host: &str, port: u16, dist_dir: Option<&str>) {
    let router = build_router(state, dist_dir);

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("Invalid server address");

    if host != "127.0.0.1" {
        eprintln!(
            "⚠ Warning: server is exposed to network ({addr}). Use a token to protect API access."
        );
    }

    eprintln!("🚀 WebUI server running at http://{addr}");
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

/// Wait for SIGINT (Ctrl+C) or SIGTERM for graceful shutdown.
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C signal handler");
    eprintln!("\n🛑 Shutting down WebUI server...");
}
