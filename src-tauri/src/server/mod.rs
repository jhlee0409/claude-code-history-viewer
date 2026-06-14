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
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use self::auth::{
    auth_error_response, clear_auth_cookies_response, csrf_valid, login_response, AuthLoginRequest,
    AuthState, AuthenticatedRequest,
};
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
pub fn build_router(state: Arc<AppState>, host: &str, port: u16, dist_dir: Option<&str>) -> Router {
    // Restrict CORS when auth is enabled; permissive only for --no-auth.
    let cors = if state.auth.is_enabled() {
        let origin = format!("http://{host}:{port}")
            .parse::<HeaderValue>()
            .unwrap_or_else(|_| HeaderValue::from_static("http://localhost:3727"));
        CorsLayer::new()
            .allow_origin(origin)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([
                header::CONTENT_TYPE,
                header::AUTHORIZATION,
                HeaderName::from_static("x-csrf-token"),
            ])
    } else {
        CorsLayer::new()
            .allow_origin(tower_http::cors::Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([
                header::CONTENT_TYPE,
                header::AUTHORIZATION,
                HeaderName::from_static("x-csrf-token"),
            ])
    };

    let protected_api = Router::new()
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
    let router = build_router(state, host, port, dist_dir);

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
    use axum::body::Body;
    use tower::ServiceExt;

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
        let app = build_router(test_state(Some("secret-token")), "127.0.0.1", 3727, None);
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
        let app = build_router(test_state(Some("secret-token")), "127.0.0.1", 3727, None);
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
        let app = build_router(test_state(Some("secret-token")), "127.0.0.1", 3727, None);
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
        let app = build_router(test_account_state(), "127.0.0.1", 3727, None);
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
        let app = build_router(test_account_state(), "127.0.0.1", 3727, None);
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
}
