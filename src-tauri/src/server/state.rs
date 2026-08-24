//! Shared application state for the Axum web server.
//!
//! This state is shared between all Axum request handlers and mirrors
//! the Tauri managed state for metadata operations.

use crate::commands::metadata::MetadataState;
use crate::commands::watcher::FileWatchEvent;
use crate::server::auth::AuthState;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::broadcast;

/// Shared state accessible by all Axum route handlers.
#[derive(Clone)]
pub struct AppState {
    /// Metadata state shared with Tauri (wrapped in Arc for Axum Clone requirement)
    pub metadata: Arc<MetadataState>,
    /// Server start time for uptime calculation.
    pub start_time: Instant,
    /// `WebUI` authentication mode.
    pub auth: AuthState,
    /// Whether mutating `WebUI` API endpoints should be rejected.
    pub read_only: bool,
    /// Whether the server is bound to a loopback address.
    ///
    /// The trust boundary for filesystem writes. On loopback the caller and the
    /// server are the same machine, so writing outside the export allowlist is
    /// no more dangerous than the desktop app doing it. Bound to a routable
    /// address it is a different machine, and an authenticated request should
    /// not be able to write anywhere on this one.
    ///
    /// Deliberately `false` when unknown: a construction site that forgets this
    /// field gets the restrictive behaviour, not the permissive one.
    pub loopback_bind: bool,
    /// Broadcast channel for file-change events (SSE consumers subscribe here).
    pub event_tx: broadcast::Sender<FileWatchEvent>,
}
