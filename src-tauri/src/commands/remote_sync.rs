//! Tauri commands exposing the remote sync engine to the frontend.
//!
//! All commands accept full `RemoteSource` objects rather than IDs so the
//! frontend can sync transient/unsaved configurations during the connection-
//! test flow without persisting them first.

use serde::Serialize;
use tokio::task::JoinSet;

use crate::remote::sftp_client::SftpSession;
use crate::remote::source::RemoteSource;
use crate::remote::sync::{sync_one, SyncOutcome};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub remote_home: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn test_remote_connection(source: RemoteSource) -> Result<ConnectionTestResult, String> {
    match SftpSession::connect(&source).await {
        Ok(sess) => match sess.remote_home().await {
            Ok(home) => Ok(ConnectionTestResult {
                ok: true,
                remote_home: Some(home),
                message: None,
            }),
            Err(e) => Ok(ConnectionTestResult {
                ok: false,
                remote_home: None,
                message: Some(format!("home resolve failed: {e:#}")),
            }),
        },
        Err(e) => Ok(ConnectionTestResult {
            ok: false,
            remote_home: None,
            // `{:#}` includes the full anyhow context chain, not just the top message.
            message: Some(format!("{e:#}")),
        }),
    }
}

#[tauri::command]
pub async fn sync_remote_source(source: RemoteSource) -> Result<SyncOutcome, String> {
    sync_one(&source).await.map_err(|e| format!("{e:#}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOneResult {
    pub source_id: String,
    pub success: bool,
    pub outcome: Option<SyncOutcome>,
    pub error: Option<String>,
}

/// Sync every enabled source concurrently. Failures on individual hosts are
/// captured per-source and never abort the overall run — the UI displays a
/// status badge per host.
#[tauri::command]
pub async fn sync_all_remote_sources(
    sources: Vec<RemoteSource>,
) -> Result<Vec<SyncOneResult>, String> {
    let mut set = JoinSet::new();
    for source in sources.into_iter().filter(|s| s.enabled) {
        set.spawn(async move {
            let id = source.id.clone();
            match sync_one(&source).await {
                Ok(outcome) => SyncOneResult {
                    source_id: id,
                    success: true,
                    outcome: Some(outcome),
                    error: None,
                },
                Err(e) => SyncOneResult {
                    source_id: id,
                    success: false,
                    outcome: None,
                    error: Some(format!("{e:#}")),
                },
            }
        });
    }

    let mut results = Vec::new();
    while let Some(joined) = set.join_next().await {
        match joined {
            Ok(r) => results.push(r),
            Err(e) => results.push(SyncOneResult {
                source_id: String::new(),
                success: false,
                outcome: None,
                error: Some(format!("task panic: {e}")),
            }),
        }
    }

    Ok(results)
}
