//! SFTP connection wrapper built on `russh` + `russh-sftp`.
//!
//! No `known_hosts` checking — this is an offline desktop app where the user
//! has explicitly configured each remote source. Trust is established at
//! configuration time, not at connection time.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use russh::client::{self, Handle};
use russh::ChannelMsg;
use russh_sftp::client::SftpSession as RusshSftp;
use russh_sftp::protocol::FileAttributes;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::remote::source::{RemoteAuth, RemoteSource};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const INACTIVITY_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
pub struct RemoteFileMeta {
    /// Path relative to the listing base (e.g. `projects/foo/bar.jsonl`).
    pub rel_path: String,
    /// Full remote path usable for `download_file` (e.g. `/home/x/.claude/projects/foo/bar.jsonl`).
    pub abs_path: String,
    pub size: u64,
    /// Modification time in seconds since UNIX epoch.
    pub mtime_secs: u64,
}

#[derive(Debug, Clone)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: u32,
}

struct AcceptAllHandler;

#[async_trait]
impl client::Handler for AcceptAllHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SftpSession {
    pub sftp: RusshSftp,
    /// Held to keep the SSH transport alive for the lifetime of `sftp`.
    ssh: Handle<AcceptAllHandler>,
    pub host: String,
    pub username: String,
}

impl SftpSession {
    pub async fn connect(source: &RemoteSource) -> Result<Self> {
        let addr = (source.host.as_str(), source.port);

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(INACTIVITY_TIMEOUT),
            ..<client::Config as Default>::default()
        });

        let mut handle = tokio::time::timeout(
            CONNECT_TIMEOUT,
            client::connect(config, addr, AcceptAllHandler),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Connect timed out after {}s to {}:{}",
                CONNECT_TIMEOUT.as_secs(),
                source.host,
                source.port
            )
        })?
        .with_context(|| format!("SSH connect to {}:{}", source.host, source.port))?;

        let auth_ok = match &source.auth {
            RemoteAuth::Password { password } => handle
                .authenticate_password(&source.username, password)
                .await
                .context("password authentication")?,
            RemoteAuth::Key {
                key_path,
                passphrase,
            } => {
                let key = russh_keys::load_secret_key(key_path, passphrase.as_deref())
                    .with_context(|| format!("load private key {key_path}"))?;
                handle
                    .authenticate_publickey(&source.username, Arc::new(key))
                    .await
                    .context("publickey authentication")?
            }
        };

        if !auth_ok {
            return Err(anyhow!(
                "SSH authentication rejected for {}@{}",
                source.username,
                source.host
            ));
        }

        let channel = handle
            .channel_open_session()
            .await
            .context("open SSH session channel")?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .context("request sftp subsystem")?;
        let sftp = RusshSftp::new(channel.into_stream())
            .await
            .context("init sftp session")?;

        Ok(Self {
            sftp,
            ssh: handle,
            host: source.host.clone(),
            username: source.username.clone(),
        })
    }

    /// Resolve the remote `$HOME` directory using SFTP `canonicalize(".")`.
    pub async fn remote_home(&self) -> Result<String> {
        self.sftp
            .canonicalize(".")
            .await
            .map_err(|e| anyhow!("canonicalize remote home: {e:?}"))
    }

    /// Execute a non-interactive remote shell command over the existing SSH transport.
    pub async fn exec_command(&self, command: &str) -> Result<ExecOutput> {
        let mut channel = self
            .ssh
            .channel_open_session()
            .await
            .context("open SSH exec channel")?;
        channel
            .exec(true, command)
            .await
            .with_context(|| format!("exec remote command: {command}"))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;

        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus {
                    exit_status: status,
                } => exit_status = Some(status),
                _ => {}
            }
        }

        Ok(ExecOutput {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            exit_status: exit_status.unwrap_or(255),
        })
    }

    /// Returns `Some(attrs)` when the path exists and is statable, `None` otherwise.
    pub async fn stat_optional(&self, path: &str) -> Option<FileAttributes> {
        self.sftp.metadata(path.to_string()).await.ok()
    }

    /// List one directory non-recursively, returning entry names (no `.` / `..`).
    /// Used by the glob-expander to walk wildcard segments.
    pub async fn read_dir_names(&self, path: &str) -> Result<Vec<String>> {
        let entries = self
            .sftp
            .read_dir(path.to_string())
            .await
            .map_err(|e| anyhow!("read_dir {path}: {e:?}"))?;
        let mut names = Vec::new();
        for entry in entries {
            let name = entry.file_name();
            if name != "." && name != ".." {
                names.push(name);
            }
        }
        Ok(names)
    }

    /// Recursive directory walk via SFTP. Skips unreadable subdirectories.
    pub async fn list_recursive(
        &self,
        base: &str,
        ext_filter: Option<&[&str]>,
    ) -> Result<Vec<RemoteFileMeta>> {
        let mut out = Vec::new();
        let mut stack = vec![base.trim_end_matches(['/', '\\']).to_string()];

        while let Some(dir) = stack.pop() {
            let entries = match self.sftp.read_dir(dir.clone()).await {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let full = format!("{dir}/{name}");
                let ftype = entry.file_type();

                if ftype.is_dir() {
                    stack.push(full);
                } else if ftype.is_file() {
                    let pass = match ext_filter {
                        None => true,
                        Some(exts) => {
                            let lower = name.to_ascii_lowercase();
                            exts.iter().any(|e| lower.ends_with(&format!(".{e}")))
                        }
                    };
                    if pass {
                        let attrs = entry.metadata();
                        let rel_path = full
                            .strip_prefix(base.trim_end_matches(['/', '\\']))
                            .unwrap_or(&full)
                            .trim_start_matches('/')
                            .to_string();
                        out.push(RemoteFileMeta {
                            rel_path,
                            abs_path: full,
                            size: attrs.size.unwrap_or(0),
                            mtime_secs: u64::from(attrs.mtime.unwrap_or(0)),
                        });
                    }
                }
            }
        }

        Ok(out)
    }

    /// Atomic download: stream remote → tmp file in target dir → rename.
    /// Returns bytes written.
    pub async fn download_file(&self, remote_path: &str, local_path: &Path) -> Result<u64> {
        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("create parent dir {}", parent.display()))?;
        }

        let mut remote_file = self
            .sftp
            .open(remote_path.to_string())
            .await
            .with_context(|| format!("open remote {remote_path}"))?;

        // Buffer in memory — typical AI session files are <100 MB.
        let mut buf = Vec::new();
        remote_file
            .read_to_end(&mut buf)
            .await
            .with_context(|| format!("read remote {remote_path}"))?;

        let tmp_path = {
            let mut p = local_path.to_path_buf();
            let mut name = p.file_name().unwrap_or_default().to_os_string();
            name.push(".part");
            p.set_file_name(name);
            p
        };

        let mut local = tokio::fs::File::create(&tmp_path)
            .await
            .with_context(|| format!("create tmp file {}", tmp_path.display()))?;
        local
            .write_all(&buf)
            .await
            .with_context(|| format!("write tmp {}", tmp_path.display()))?;
        local.flush().await?;
        drop(local);

        // Windows: rename fails if destination exists; remove first.
        if tokio::fs::try_exists(local_path).await.unwrap_or(false) {
            let _ = tokio::fs::remove_file(local_path).await;
        }
        tokio::fs::rename(&tmp_path, local_path)
            .await
            .with_context(|| {
                format!("rename {} -> {}", tmp_path.display(), local_path.display())
            })?;

        Ok(buf.len() as u64)
    }
}
