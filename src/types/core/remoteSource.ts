/**
 * Remote SSH Source Types
 *
 * Configuration for fetching AI session history from remote machines via SSH/SFTP.
 * Passwords and key passphrases are transient only and are not persisted in settings.
 */

/** OS family of the remote host. Used only for default path templates. */
export type RemoteSystemKind = "linux" | "windows";

/** SSH key-based auth */
export interface RemoteAuthKey {
  type: "key";
  /** Absolute path on the LOCAL machine to a private key file (OpenSSH format) */
  keyPath: string;
  /** OS keychain lookup id for the encrypted key passphrase. */
  passphraseRef?: string;
  /** Optional passphrase for an encrypted key. Transient only; not persisted. */
  passphrase?: string;
}

/** Password-based auth */
export interface RemoteAuthPassword {
  type: "password";
  /** OS keychain lookup id for the password. */
  passwordRef?: string;
  /** Transient password. This is stripped before settings are persisted. */
  password?: string;
}

export type RemoteAuth = RemoteAuthKey | RemoteAuthPassword;

/**
 * Per-provider remote-path overrides. Each provider accepts **multiple paths**
 * 鈥?required for the cc-slack multi-tenant container layout where every worker
 * writes into its own `~/.cc-slack-data/<worker>/.claude` dir.
 *
 * Each path supports a single `*` per segment (no `**`, no `?`); the wildcard
 * is expanded against the remote filesystem at sync time.
 *
 * Empty/omitted fields fall back to {@link DEFAULT_REMOTE_PATHS}.
 */
export interface RemoteProviderPaths {
  /** Overrides for ~/.claude on the remote host (glob-supported) */
  claude?: string[];
  /** Overrides for ~/.codex on the remote host */
  codex?: string[];
  /** Overrides for ~/.local/share/opencode on the remote host */
  opencode?: string[];
}

export interface RemotePodmanSettings {
  /** Discover and sync AI history from Podman containers on this machine. */
  enabled: boolean;
}

export interface HistorySource {
  id: string;
  kind: "local" | "wsl" | "ssh" | "podman-container" | string;
  displayLabel: string;
  debugLabel?: string;
}

/** Sync run status for UI feedback */
export type RemoteSyncStatus = "idle" | "syncing" | "ok" | "error";

/** One remote machine the user wants to pull session data from */
export interface RemoteSource {
  /** UUID v4 鈥?stable identifier referenced by CLI and project paths */
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
  /** Authentication config. Secrets are transient and stripped before persistence. */
  auth: RemoteAuth;
  /** Optional path overrides; defaults derived from `system` if omitted */
  paths?: RemoteProviderPaths;
  /** Optional Podman container discovery settings */
  podman?: RemotePodmanSettings;
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

/**
 * One local cache root that a sync run produced 鈥?i.e. one matched remote
 * provider root, mirrored under the per-source cache. The frontend registers
 * each as a `customClaudePath` so the existing scanner picks it up unchanged.
 */
export interface InjectedRoot {
  /** Absolute local path to register as a `customClaudePath` */
  localPath: string;
  /** Human-readable suffix (e.g. `dbg`) used when labelling multi-root sources */
  discriminator: string;
  /** Original remote root this cache mirrors 鈥?surfaced in toasts for debugging */
  remotePath: string;
  /** Source identity to attach to projects scanned from this root */
  source?: HistorySource;
}

/** Per-provider lists of injected cache roots from one sync run */
export interface InjectedPaths {
  claude: InjectedRoot[];
  codex: InjectedRoot[];
  opencode: InjectedRoot[];
}

/** Why a configured path produced no synced files */
export type MissingPathReason = "not_found" | "empty";

/** A configured path the sync run couldn't pull anything from */
export interface MissingPath {
  /** Provider key 鈥?`"claude"` / `"codex"` / `"opencode"` */
  provider: "claude" | "codex" | "opencode";
  /** The path string as the user typed it (or a default) */
  configuredPath: string;
  reason: MissingPathReason;
}

export interface SyncOutcome {
  sourceId: string;
  stats: RemoteSyncStats;
  injectedPaths: InjectedPaths;
  missingPaths: MissingPath[];
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
 * Default remote paths per OS family.
 *
 * The first entry of each provider list covers the **cc-slack multi-tenant
 * container layout** used by `scripts/deploy-multi.sh`: each worker
 * bind-mounts `~/.cc-slack-data/<worker>/.claude` etc. into its container so
 * AI logins and conversation history don't bleed across workers. The second
 * entry is the standard single-user location.
 *
 * Both Linux and Windows ship the same defaults 鈥?every supported AI tool
 * follows XDG-style layout on Windows too (verified against
 * `~/.local/share/opencode/` on Windows hosts).
 */
export const DEFAULT_REMOTE_PATHS: Record<RemoteSystemKind, Required<RemoteProviderPaths>> = {
  linux: {
    claude: ["~/.cc-slack-data/*/.claude", "~/.claude"],
    codex: ["~/.codex"],
    opencode: ["~/.cc-slack-data/*/.opencode", "~/.local/share/opencode"],
  },
  windows: {
    claude: ["~/.cc-slack-data/*/.claude", "~/.claude"],
    codex: ["~/.codex"],
    opencode: ["~/.cc-slack-data/*/.opencode", "~/.local/share/opencode"],
  },
};

/** Helper: produce a stable, filesystem-safe folder name for a source's local cache. */
export const remoteCacheFolderName = (source: Pick<RemoteSource, "id" | "host">): string => {
  const sanitisedHost = source.host.replace(/[^A-Za-z0-9._-]/g, "_");
  const sanitisedId = source.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
  return `${sanitisedHost}__${sanitisedId || "unknown"}`;
};
