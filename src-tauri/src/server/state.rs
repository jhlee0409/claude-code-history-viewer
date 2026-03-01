//! Shared application state for the Axum web server.
//!
//! This state is shared between all Axum request handlers and mirrors
//! the Tauri managed state for metadata operations.

use crate::commands::metadata::MetadataState;
use crate::commands::watcher::FileWatchEvent;
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
    /// Bearer token for API authentication. `None` means auth is disabled (`--no-auth`).
    pub auth_token: Option<String>,
    /// Broadcast channel for file-change events (SSE consumers subscribe here).
    pub event_tx: broadcast::Sender<FileWatchEvent>,
}
