use serde::Deserialize;
use tauri::command;

use crate::remote::source::{RemoteAuth, RemoteSource};

const SERVICE: &str = "claude-code-history-viewer.remote";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreRemoteCredentialParam {
    pub source_id: String,
    pub kind: String,
    pub secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRemoteCredentialParam {
    pub credential_ref: String,
}

fn credential_key(source_id: &str, kind: &str) -> Result<String, String> {
    let clean_id = source_id.replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_',
        "_",
    );
    let clean_kind = kind.replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_',
        "_",
    );
    if clean_id.is_empty() || clean_kind.is_empty() {
        return Err("credential source id and kind are required".to_string());
    }
    Ok(format!("{clean_id}:{clean_kind}"))
}

fn entry_for_ref(credential_ref: &str) -> Result<keyring::Entry, String> {
    if credential_ref.trim().is_empty() {
        return Err("credential_ref is required".to_string());
    }
    keyring::Entry::new(SERVICE, credential_ref).map_err(|e| e.to_string())
}

fn get_secret(credential_ref: &str) -> Result<String, String> {
    entry_for_ref(credential_ref)?
        .get_password()
        .map_err(|e| e.to_string())
}

#[command]
pub async fn store_remote_credential(param: StoreRemoteCredentialParam) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if param.secret.is_empty() {
            return Err("secret is required".to_string());
        }
        let credential_ref = credential_key(&param.source_id, &param.kind)?;
        entry_for_ref(&credential_ref)?
            .set_password(&param.secret)
            .map_err(|e| e.to_string())?;
        Ok(credential_ref)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[command]
pub async fn delete_remote_credential(param: DeleteRemoteCredentialParam) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = entry_for_ref(&param.credential_ref)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

pub fn resolve_source_credentials(source: &RemoteSource) -> Result<RemoteSource, String> {
    let mut resolved = source.clone();
    resolved.auth = match &source.auth {
        RemoteAuth::Key {
            key_path,
            passphrase_ref,
            passphrase,
        } => RemoteAuth::Key {
            key_path: key_path.clone(),
            passphrase_ref: passphrase_ref.clone(),
            passphrase: match (passphrase.as_ref(), passphrase_ref.as_ref()) {
                (Some(value), _) if !value.is_empty() => Some(value.clone()),
                (_, Some(reference)) => Some(get_secret(reference)?),
                _ => None,
            },
        },
        RemoteAuth::Password {
            password_ref,
            password,
        } => RemoteAuth::Password {
            password_ref: password_ref.clone(),
            password: match (password.as_ref(), password_ref.as_ref()) {
                (Some(value), _) if !value.is_empty() => Some(value.clone()),
                (_, Some(reference)) => Some(get_secret(reference)?),
                _ => None,
            },
        },
    };
    Ok(resolved)
}
