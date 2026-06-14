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
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
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
use tower_http::cors::CorsLayer;
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
    let cors = if state.auth_token.is_some() {
        let origin = format!("http://{host}:{port}")
            .parse::<HeaderValue>()
            .unwrap_or_else(|_| HeaderValue::from_static("http://localhost:3727"));
        CorsLayer::new()
            .allow_origin(origin)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
    } else {
        CorsLayer::new()
            .allow_origin(tower_http::cors::Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
    };

    let api = Router::new()
        // SSE endpoint for real-time file change events
        .route("/events", get(sse_handler))
        // Project commands
        .route("/get_claude_folder_path", post(h::get_claude_folder_path))
        .route("/validate_claude_folder", post(h::validate_claude_folder))
        .route(
            "/validate_custom_claude_dir",
            post(h::validate_custom_claude_dir),
        )
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
        .route("/get_session_subagents", post(h::get_session_subagents))
        .route("/search_messages", post(h::search_messages))
        .route("/get_recent_edits", post(h::get_recent_edits))
        .route("/restore_file", post(h::restore_file))
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
        .route("/load_provider_messages", post(h::load_provider_messages))
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
            auth_middleware,
        ));

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
        let index_for_root = spa_index.clone();
        let index_for_fallback = spa_index.clone();
        let spa_root = get(move || {
            let index = index_for_root.clone();
            async move { spa_index_response(index) }
        });
        let spa_fallback = get(move || {
            let index = index_for_fallback.clone();
            async move { spa_index_response(index) }
        });
        let serve_dir = ServeDir::new(dist);
        app = app
            .route("/", spa_root)
            .fallback_service(serve_dir.fallback(spa_fallback));
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
                if constant_time_eq(token.as_bytes(), expected.as_bytes()) {
                    return Ok(next.run(request).await);
                }
            }
        }
    }

    // 2. Check ?token= query parameter only for SSE endpoint
    // (EventSource cannot set custom Authorization headers).
    if allow_query_token(&request) {
        if let Some(query) = request.uri().query() {
            for pair in query.split('&') {
                if let Some(token) = pair.strip_prefix("token=") {
                    let decoded = urlencoding::decode(token).unwrap_or_default();
                    if constant_time_eq(decoded.as_bytes(), expected.as_bytes()) {
                        return Ok(next.run(request).await);
                    }
                }
            }
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

/// Query-token auth is allowed only for SSE endpoint requests.
fn allow_query_token(request: &Request) -> bool {
    if request.method() != Method::GET {
        return false;
    }
    matches!(request.uri().path(), "/api/events" | "/events")
}

/// Constant-time byte comparison to prevent timing side-channel attacks on token validation.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
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
    let (data, mime) = if let Some(file) = EmbeddedAssets::get(path) {
        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();
        (Body::from(file.data.into_owned()), mime)
    } else if let Some(index) = embedded_index_body(&base_path) {
        (index, "text/html".to_string())
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
        .body(data)
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

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("Invalid server address");

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
    use axum::body::to_bytes;
    use axum::body::Body;
    use tower::ServiceExt;

    fn test_state() -> Arc<AppState> {
        let (event_tx, _rx) =
            tokio::sync::broadcast::channel::<crate::commands::watcher::FileWatchEvent>(1);
        Arc::new(AppState {
            metadata: Arc::new(MetadataState::default()),
            start_time: std::time::Instant::now(),
            auth_token: None,
            event_tx,
        })
    }

    #[test]
    fn test_allow_query_token_only_for_sse_get() {
        let sse_get = Request::builder()
            .method(Method::GET)
            .uri("/api/events?token=abc")
            .body(Body::empty())
            .unwrap();
        assert!(allow_query_token(&sse_get));

        let api_post = Request::builder()
            .method(Method::POST)
            .uri("/api/scan_projects?token=abc")
            .body(Body::empty())
            .unwrap();
        assert!(!allow_query_token(&api_post));

        let non_sse_get = Request::builder()
            .method(Method::GET)
            .uri("/api/load_project_sessions?token=abc")
            .body(Body::empty())
            .unwrap();
        assert!(!allow_query_token(&non_sse_get));
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
        let app = build_router(test_state(), "127.0.0.1", 3727, None, "/viewer");
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
        let app = build_router(test_state(), "127.0.0.1", 3727, None, "/viewer");
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
        let app = build_router(test_state(), "127.0.0.1", 3727, None, "/viewer");
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
        let app = build_router(test_state(), "127.0.0.1", 3727, None, "/viewer");
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
}
