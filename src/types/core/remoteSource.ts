/**
 * Remote SSH Source Types
 *
 * Configuration for fetching AI session history from remote machines via SSH/SFTP.
 * Credentials are stored in plaintext within `settings.json` — this app is offline-only.
 */

/** OS family of the remote host. Used only for default path templates. */
export type RemoteSystemKind = "linux" | "windows";

/** SSH key-based auth */
export interface RemoteAuthKey {
  type: "key";
  /** Absolute path on the LOCAL machine to a private key file (OpenSSH format) */
  keyPath: string;
  /** Optional passphrase for an encrypted key. Stored plaintext. */
  passphrase?: string;
}

/** Password-based auth */
export interface RemoteAuthPassword {
  type: "password";
  /** Plaintext password (offline app — no keyring). */
  password: string;
}

export type RemoteAuth = RemoteAuthKey | RemoteAuthPassword;

/** Per-provider remote-path overrides. Empty fields fall back to system defaults. */
export interface RemoteProviderPaths {
  /** Override for ~/.claude on the remote host */
  claude?: string;
  /** Override for ~/.codex on the remote host */
  codex?: string;
  /** Override for ~/.local/share/opencode on the remote host */
  opencode?: string;
}

/** Sync run status for UI feedback */
export type RemoteSyncStatus = "idle" | "syncing" | "ok" | "error";

/** One remote machine the user wants to pull session data from */
export interface RemoteSource {
  /** UUID v4 — stable identifier referenced by CLI and project paths */
  id: string;
  /** Toggle without deleting the entry. Disabled sources are skipped by "Sync All". */
  enabled: boolean;
  /** IP address or hostname */
  host: string;
  /** SSH port (default 22) */
  port: number;
  /** Remote username */
  username: string;
  /** OS family of the remote host */
  system: RemoteSystemKind;
  /** Authentication credentials (plaintext) */
  auth: RemoteAuth;
  /** Optional path overrides; defaults derived from `system` if omitted */
  paths?: RemoteProviderPaths;
  /** Last successful or attempted sync, ISO 8601 */
  lastSyncAt?: string;
  /** Most recent sync state */
  lastSyncStatus?: RemoteSyncStatus;
  /** Error message from the last failed sync */
  lastSyncError?: string;
  /** Stats from the last sync run */
  lastSyncStats?: RemoteSyncStats;
}

export interface RemoteSyncStats {
  /** Total .jsonl/.db/.json files considered on remote */
  filesTotal: number;
  /** Files actually downloaded (changed since last sync) */
  filesUpdated: number;
  /** Files unchanged & skipped */
  filesSkipped: number;
  /** Bytes transferred */
  bytesTransferred: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

/** Per-file progress event emitted to the frontend during a sync run */
export interface RemoteSyncProgress {
  sourceId: string;
  /** Current step description (e.g., "Connecting", "Listing /home/foo/.claude/projects") */
  phase: "connecting" | "listing" | "downloading" | "done" | "error";
  /** Optional file path being processed */
  currentFile?: string;
  /** Files completed so far */
  filesDone: number;
  /** Total files to process (may grow during listing phase) */
  filesTotal: number;
  bytesTransferred: number;
  /** Human-readable error if phase === "error" */
  error?: string;
}

/** Default SSH port */
export const DEFAULT_SSH_PORT = 22;

/**
 * Default remote paths per OS family. The remote app must follow these conventions:
 * - Linux: `~/<dir>` resolved against the user's home
 * - Windows: `%USERPROFILE%\<dir>` (with backslashes; SFTP normalises)
 *
 * OpenCode is identical across OSes (`~/.local/share/opencode`) because the
 * upstream tool uses XDG-style layout on every platform — verified on
 * Windows in this project's repo (see `src-tauri/src/providers/opencode.rs`).
 */
export const DEFAULT_REMOTE_PATHS: Record<RemoteSystemKind, Required<RemoteProviderPaths>> = {
  linux: {
    claude: "~/.claude",
    codex: "~/.codex",
    opencode: "~/.local/share/opencode",
  },
  windows: {
    claude: "~/.claude",
    codex: "~/.codex",
    opencode: "~/.local/share/opencode",
  },
};

/** Helper: produce a stable, filesystem-safe folder name for a source's local cache. */
export const remoteCacheFolderName = (source: Pick<RemoteSource, "id" | "host">): string => {
  const sanitisedHost = source.host.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${sanitisedHost}__${source.id.slice(0, 8)}`;
};
