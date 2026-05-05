//! Remote SSH source sync.
//!
//! Pulls AI-tool session history (Claude Code, Codex CLI, `OpenCode`) from remote
//! Linux/Windows machines over SFTP into a local cache directory. The cached
//! files are then registered as additional scan paths in `customClaudePaths` /
//! analogous settings, so the rest of the app treats them as just another
//! local source.
//!
//! Why SFTP and not rsync/scp: SFTP is part of the SSH protocol — no shell,
//! no platform-specific binary on the remote end. Works against Linux openssh
//! and Windows OpenSSH for Windows servers identically.

pub mod sftp_client;
pub mod source;
pub mod sync;

pub use source::{
    default_paths_for, sync_whitelist, RemoteAuth, RemoteSource, RemoteSyncStats, RemoteSystemKind,
};
pub use sync::{sync_one, SyncOutcome};
