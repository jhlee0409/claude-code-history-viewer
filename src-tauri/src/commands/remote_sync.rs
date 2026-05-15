//! Tauri commands exposing the remote sync engine to the frontend.
//!
//! All commands accept full `RemoteSource` objects rather than IDs so the
//! frontend can sync transient/unsaved configurations during the connection-
//! test flow without persisting them first.

use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::task::JoinSet;

use crate::remote::sftp_client::SftpSession;
use crate::remote::source::RemoteSource;
use crate::remote::sync::{sync_one, SyncOutcome};

const SYNC_TIMEOUT: Duration = Duration::from_secs(600);

fn public_error(error: anyhow::Error) -> String {
    let message = format!("{error:#}");
    message
        .lines()
        .map(|line| {
            if line.to_ascii_lowercase().contains("password")
                || line.to_ascii_lowercase().contains("passphrase")
            {
                "authentication failed".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn public_string_error(error: String) -> String {
    public_error(anyhow::anyhow!(error))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub remote_home: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn test_remote_connection(source: RemoteSource) -> Result<ConnectionTestResult, String> {
    let source = crate::commands::remote_credentials::resolve_source_credentials(&source)
        .map_err(public_string_error)?;
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
                message: Some(format!("home resolve failed: {}", public_error(e))),
            }),
        },
        Err(e) => Ok(ConnectionTestResult {
            ok: false,
            remote_home: None,
            // `{:#}` includes the full anyhow context chain, not just the top message.
            message: Some(public_error(e)),
        }),
    }
}

#[tauri::command]
pub async fn sync_remote_source(source: RemoteSource) -> Result<SyncOutcome, String> {
    let source = crate::commands::remote_credentials::resolve_source_credentials(&source)
        .map_err(public_string_error)?;
    tokio::time::timeout(SYNC_TIMEOUT, sync_one(&source))
        .await
        .map_err(|_| format!("sync timed out after {}s", SYNC_TIMEOUT.as_secs()))?
        .map_err(public_error)
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
    let mut task_sources = HashMap::new();
    for source in sources.into_iter().filter(|s| s.enabled) {
        let source_id = source.id.clone();
        let handle = set.spawn(async move {
            let id = source.id.clone();
            let result =
                match crate::commands::remote_credentials::resolve_source_credentials(&source) {
                    Ok(source) => tokio::time::timeout(SYNC_TIMEOUT, sync_one(&source)).await,
                    Err(error) => Ok(Err(anyhow::anyhow!(error))),
                };
            let item = match result {
                Ok(Ok(outcome)) => SyncOneResult {
                    source_id: id.clone(),
                    success: true,
                    outcome: Some(outcome),
                    error: None,
                },
                Ok(Err(e)) => SyncOneResult {
                    source_id: id.clone(),
                    success: false,
                    outcome: None,
                    error: Some(public_error(e)),
                },
                Err(_) => SyncOneResult {
                    source_id: id.clone(),
                    success: false,
                    outcome: None,
                    error: Some(format!("sync timed out after {}s", SYNC_TIMEOUT.as_secs())),
                },
            };
            (id, item)
        });
        task_sources.insert(handle.id(), source_id);
    }

    let mut results = Vec::new();
    while let Some(joined) = set.join_next().await {
        match joined {
            Ok((_id, r)) => results.push(r),
            Err(e) => results.push(SyncOneResult {
                source_id: task_sources
                    .get(&e.id())
                    .cloned()
                    .unwrap_or_else(|| e.id().to_string()),
                success: false,
                outcome: None,
                error: Some(format!("task panic: {e}")),
            }),
        }
    }

    Ok(results)
}
