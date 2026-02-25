//! Shared application state for the Axum web server.
//!
//! This state is shared between all Axum request handlers and mirrors
//! the Tauri managed state for metadata operations.

use crate::commands::metadata::MetadataState;
use std::sync::Arc;

/// Shared state accessible by all Axum route handlers.
#[derive(Clone)]
pub struct AppState {
    /// Metadata state shared with Tauri (wrapped in Arc for Axum Clone requirement)
    pub metadata: Arc<MetadataState>,
}
