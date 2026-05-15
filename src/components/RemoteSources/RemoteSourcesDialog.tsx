/**
 * RemoteSourcesDialog
 *
 * Modal for managing SSH remote machines whose AI session history we want to
 * pull into local cache. After a successful sync, each remote's local cache
 * directory is registered as a `customClaudePath` so the existing scanner
 * picks it up unmodified — no extra "remote source" plumbing in the rest of
 * the app.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Plug,
  RefreshCw,
  Trash2,
  Pencil,
  Check,
  X,
  Plus,
  Loader2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/useAppStore";
import { api } from "@/services/api";
import {
  DEFAULT_REMOTE_PATHS,
  DEFAULT_SSH_PORT,
  type InjectedPaths,
  type MissingPath,
  type RemoteAuth,
  type RemoteProviderPaths,
  type RemoteSource,
  type RemoteSyncStats,
  type RemoteSystemKind,
} from "@/types";

interface RemoteSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ConnectionTestResult {
  ok: boolean;
  remoteHome?: string;
  message?: string;
}

interface SyncOutcome {
  sourceId: string;
  stats: RemoteSyncStats;
  injectedPaths: InjectedPaths;
  missingPaths: MissingPath[];
}

interface SyncOneResult {
  sourceId: string;
  success: boolean;
  outcome?: SyncOutcome;
  error?: string;
}

const emptyDraft = (): RemoteSource => ({
  id: crypto.randomUUID(),
  enabled: true,
  host: "",
  port: DEFAULT_SSH_PORT,
  username: "",
  system: "linux",
  auth: { type: "key", keyPath: "" },
});

function stripRemoteSourceSecrets(source: RemoteSource): RemoteSource {
  if (source.auth.type === "key") {
    const auth = {
      type: "key" as const,
      keyPath: source.auth.keyPath,
      passphraseRef: source.auth.passphraseRef,
    };
    return { ...source, auth };
  }
  return { ...source, auth: { type: "password", passwordRef: source.auth.passwordRef } };
}

async function persistDraftSecrets(source: RemoteSource): Promise<RemoteSource> {
  if (source.auth.type === "key") {
    if (!source.auth.passphrase) return source;
    const passphraseRef = await api<string>("store_remote_credential", {
      param: {
        sourceId: source.id,
        kind: "passphrase",
        secret: source.auth.passphrase,
      },
    });
    return {
      ...source,
      auth: {
        type: "key",
        keyPath: source.auth.keyPath,
        passphraseRef,
      },
    };
  }
  if (!source.auth.password) return source;
  const passwordRef = await api<string>("store_remote_credential", {
    param: {
      sourceId: source.id,
      kind: "password",
      secret: source.auth.password,
    },
  });
  return {
    ...source,
    auth: {
      type: "password",
      passwordRef,
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function RemoteSourcesDialog({ open, onOpenChange }: RemoteSourcesDialogProps) {
  const { t } = useTranslation();
  const userMetadata = useAppStore((s) => s.userMetadata);
  const updateUserSettings = useAppStore((s) => s.updateUserSettings);
  const scanProjects = useAppStore((s) => s.scanProjects);

  const sources = userMetadata?.settings?.remoteSources ?? [];

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<RemoteSource | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [testResults, setTestResults] = React.useState<Record<string, ConnectionTestResult>>({});
  const [globalError, setGlobalError] = React.useState<string | null>(null);

  const persistSources = React.useCallback(
    async (next: RemoteSource[]) => {
      const safeSources = next.map(stripRemoteSourceSecrets);
      await updateUserSettings({ remoteSources: safeSources });
      // Round-trip check: `updateUserSettings` swallows backend errors into
      // `console.error`, so verify the store actually reflects what we asked for.
      // A mismatch usually means the Rust `UserSettings` struct is missing a
      // serde field and silently dropped the value.
      const latest =
        useAppStore.getState().userMetadata?.settings?.remoteSources ?? [];
      const idMismatch =
        safeSources.length !== latest.length ||
        safeSources.some((s, i) => s.id !== latest[i]?.id);
      if (idMismatch) {
        throw new Error(
          `Save did not persist: expected ${safeSources.length} source(s), backend stored ${latest.length}.`,
        );
      }
    },
    [updateUserSettings],
  );

  const startAdd = () => {
    setDraft(emptyDraft());
    setEditingId(null);
  };

  const startEdit = (source: RemoteSource) => {
    setDraft({ ...source });
    setEditingId(source.id);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditingId(null);
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.host.trim() || !draft.username.trim()) {
      setGlobalError(t("remoteSources.error.hostUserRequired", "Host and username are required."));
      return;
    }
    if (draft.auth.type === "key" && !draft.auth.keyPath.trim()) {
      setGlobalError(t("remoteSources.error.keyPathRequired", "Key path is required."));
      return;
    }
    try {
      const savedDraft = await persistDraftSecrets(draft);
      const next = editingId
        ? sources.map((s) => (s.id === editingId ? savedDraft : s))
        : [...sources, savedDraft];
      await persistSources(next);
      setDraft(null);
      setEditingId(null);
      setGlobalError(null);
    } catch (err) {
      setGlobalError(String(err));
    }
  };

  const removeSource = async (id: string) => {
    if (!window.confirm(t("remoteSources.confirmDelete", "Delete this remote machine? Cached data will be kept."))) {
      return;
    }
    try {
      const source = sources.find((s) => s.id === id);
      const credentialRefs = [
        source?.auth.type === "key" ? source.auth.passphraseRef : undefined,
        source?.auth.type === "password" ? source.auth.passwordRef : undefined,
      ].filter(Boolean);
      await Promise.all(
        credentialRefs.map((credentialRef) =>
          api("delete_remote_credential", { param: { credentialRef } }).catch(() => undefined)
        )
      );
      await persistSources(sources.filter((s) => s.id !== id));
    } catch (err) {
      setGlobalError(String(err));
    }
  };

  const testConnection = async (source: RemoteSource) => {
    const sourceToTest = editingId === source.id && draft ? draft : source;
    setBusyId(source.id);
    setTestResults((prev) => ({ ...prev, [source.id]: { ok: false, message: "..." } }));
    try {
      const result = await api<ConnectionTestResult>("test_remote_connection", {
        source: sourceToTest,
      });
      setTestResults((prev) => ({ ...prev, [source.id]: result }));
      if (result.ok) {
        await recordSyncResult(source, null, null);
        toast.success(
          t("remoteSources.testOk", "Connected. Remote home: {{home}}", { home: result.remoteHome ?? "?" }),
        );
      } else {
        toast.error(result.message ?? t("remoteSources.testFailed", "Connection failed"));
      }
    } catch (err) {
      const msg = String(err);
      setTestResults((prev) => ({ ...prev, [source.id]: { ok: false, message: msg } }));
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  const applyInjectedPaths = React.useCallback(
    async (source: RemoteSource, outcome: SyncOutcome) => {
      const labelBase = `🌐 ${source.host}${source.port === DEFAULT_SSH_PORT ? "" : `:${source.port}`}`;
      const existing =
        useAppStore.getState().userMetadata?.settings?.customClaudePaths ?? [];
      const normalizePath = (path: string) => path.replace(/[\\/]+$/, "");

      // Build label = base [+ tag for non-claude provider] [+ discriminator if multi-root].
      // The discriminator suffix only kicks in when this provider has >1 matched
      // root (so single-tenant hosts still see the clean "🌐 host" label).
      const buildEntries = (
        roots: typeof outcome.injectedPaths.claude,
        providerTag: string,
      ): Array<[string, string, typeof roots[number]["source"]]> => {
        const multi = roots.length > 1;
        return roots.map((r) => {
          let label = r.source?.displayLabel ?? labelBase;
          if (!r.source && providerTag) label += ` (${providerTag}${multi ? `/${r.discriminator}` : ""})`;
          else if (!r.source && multi) label += ` [${r.discriminator}]`;
          return [r.localPath, label, r.source];
        });
      };

      const entries: Array<[string, string, typeof outcome.injectedPaths.claude[number]["source"]]> = [
        ...buildEntries(outcome.injectedPaths.claude, ""),
        ...buildEntries(outcome.injectedPaths.codex, "codex"),
        ...buildEntries(outcome.injectedPaths.opencode, "opencode"),
      ];

      const byPath = new Map(existing.map((cp) => [normalizePath(cp.path), cp]));
      let changed = false;
      for (const [path, label, source] of entries) {
        const normalizedPath = normalizePath(path);
        const previous = byPath.get(normalizedPath);
        const next = previous
          ? {
              ...previous,
              path: normalizedPath,
              label,
              source,
            }
          : {
              path: normalizedPath,
              label,
              source,
            };
        if (
          !previous ||
          previous.path !== next.path ||
          previous.label !== next.label ||
          JSON.stringify(previous.source) !== JSON.stringify(next.source)
        ) {
          changed = true;
        }
        byPath.set(normalizedPath, next);
      }
      if (changed) {
        await updateUserSettings({
          customClaudePaths: Array.from(byPath.values()),
        });
      }
    },
    [updateUserSettings],
  );

  const reportMissingPaths = React.useCallback(
    (source: RemoteSource, missing: MissingPath[]) => {
      if (missing.length === 0) return;
      // Reason → human-readable note
      const lines = missing.map((m) => {
        const reason =
          m.reason === "not_found"
            ? t("remoteSources.missing.notFound", "no match")
            : t("remoteSources.missing.empty", "matched but empty");
        return `${m.provider}: ${m.configuredPath} — ${reason}`;
      });
      toast.warning(
        t("remoteSources.missingTitle", "{{host}}: {{n}} configured path(s) returned nothing", {
          host: source.host,
          n: missing.length,
        }),
        { description: lines.join("\n") },
      );
    },
    [t],
  );

  const recordSyncResult = async (
    source: RemoteSource,
    outcome: SyncOutcome | null,
    error: string | null,
  ) => {
    const stamped: RemoteSource = {
      ...source,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: error ? "error" : "ok",
      lastSyncError: error ?? undefined,
      lastSyncStats: outcome?.stats,
    };
    const latestSources = useAppStore.getState().userMetadata?.settings?.remoteSources ?? sources;
    await persistSources(latestSources.map((s) => (s.id === source.id ? stamped : s)));
  };

  const syncOne = async (source: RemoteSource) => {
    const sourceToSync = editingId === source.id && draft ? draft : source;
    setBusyId(source.id);
    setGlobalError(null);
    try {
      const outcome = await api<SyncOutcome>("sync_remote_source", { source: sourceToSync });
      await applyInjectedPaths(sourceToSync, outcome);
      await recordSyncResult(source, outcome, null);
      toast.success(
        t("remoteSources.syncOk", "{{host}}: {{updated}} updated, {{skipped}} skipped, {{bytes}} transferred", {
          host: sourceToSync.host,
          updated: outcome.stats.filesUpdated,
          skipped: outcome.stats.filesSkipped,
          bytes: formatBytes(outcome.stats.bytesTransferred),
        }),
      );
      reportMissingPaths(sourceToSync, outcome.missingPaths);
      await scanProjects();
    } catch (err) {
      const msg = String(err);
      await recordSyncResult(source, null, msg);
      toast.error(`${source.host}: ${msg}`);
    } finally {
      setBusyId(null);
    }
  };

  const syncAll = async () => {
    if (sources.length === 0) return;
    setBusyId("__all__");
    setGlobalError(null);
    try {
      const results = await api<SyncOneResult[]>("sync_all_remote_sources", { sources });
      let ok = 0;
      let failed = 0;
      for (const r of results) {
        const source = sources.find((s) => s.id === r.sourceId);
        if (!source) continue;
        if (r.success && r.outcome) {
          await applyInjectedPaths(source, r.outcome);
          await recordSyncResult(source, r.outcome, null);
          reportMissingPaths(source, r.outcome.missingPaths);
          ok += 1;
        } else {
          await recordSyncResult(source, null, r.error ?? "unknown error");
          failed += 1;
        }
      }
      if (ok > 0) {
        toast.success(t("remoteSources.syncAllOk", "{{ok}} synced, {{failed}} failed", { ok, failed }));
      } else if (failed > 0) {
        toast.error(t("remoteSources.syncAllAllFailed", "All {{failed}} hosts failed to sync", { failed }));
      }
      await scanProjects();
    } catch (err) {
      setGlobalError(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const updateDraft = <K extends keyof RemoteSource>(key: K, value: RemoteSource[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  };

  const updateAuth = (auth: RemoteAuth) => {
    if (!draft) return;
    setDraft({ ...draft, auth });
  };

  const updatePaths = (paths: RemoteProviderPaths | undefined) => {
    if (!draft) return;
    setDraft({ ...draft, paths });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("remoteSources.title", "Remote machines")}</DialogTitle>
          <DialogDescription>
            {t(
              "remoteSources.description",
            "Pull AI session history from SSH-accessible Linux/Windows machines. Passwords and key passphrases are stored in the OS credential manager, not in user settings.",
            )}
          </DialogDescription>
        </DialogHeader>

        {globalError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{globalError}</span>
          </div>
        )}

        {sources.length === 0 && !draft && (
          <p className="text-sm text-muted-foreground italic">
            {t("remoteSources.empty", "No remote machines configured yet.")}
          </p>
        )}

        <div className="space-y-2">
          {sources.map((source) => {
            const isBusy = busyId === source.id || busyId === "__all__";
            const test = testResults[source.id];
            const lastStatus = source.lastSyncStatus;
            return (
              <div
                key={source.id}
                className="rounded-md border border-border/60 p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">
                      {source.username}@{source.host}
                      {source.port !== DEFAULT_SSH_PORT && `:${source.port}`}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        {source.system}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        {source.auth.type}
                      </Badge>
                      {!source.enabled && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          {t("remoteSources.disabled", "disabled")}
                        </Badge>
                      )}
                      {lastStatus === "ok" && source.lastSyncStats && (
                        <span className="text-[10px] text-muted-foreground">
                          {t("remoteSources.lastSync", "last: {{updated}}↑ {{skipped}}= {{bytes}}", {
                            updated: source.lastSyncStats.filesUpdated,
                            skipped: source.lastSyncStats.filesSkipped,
                            bytes: formatBytes(source.lastSyncStats.bytesTransferred),
                          })}
                        </span>
                      )}
                      {lastStatus === "error" && (
                        <span
                          className="text-[10px] text-destructive truncate max-w-xs"
                          title={source.lastSyncError}
                        >
                          ⚠ {source.lastSyncError}
                        </span>
                      )}
                      {test && (
                        <span
                          className={`text-[10px] ${test.ok ? "text-green-600" : "text-destructive"}`}
                        >
                          {test.ok ? `✓ ${test.remoteHome ?? ""}` : `✗ ${test.message ?? ""}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => testConnection(source)}
                      disabled={isBusy}
                      aria-label={t("remoteSources.testConnection", "Test connection")}
                      title={t("remoteSources.testConnection", "Test connection")}
                    >
                      {busyId === source.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plug className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => syncOne(source)}
                      disabled={isBusy || !source.enabled}
                      aria-label={t("remoteSources.sync", "Sync")}
                      title={t("remoteSources.sync", "Sync")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => startEdit(source)}
                      disabled={isBusy}
                      aria-label={t("common.edit", "Edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeSource(source.id)}
                      disabled={isBusy}
                      aria-label={t("common.delete", "Delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {draft ? (
          <DraftForm
            draft={draft}
            isEditing={Boolean(editingId)}
            onChange={updateDraft}
            onAuthChange={updateAuth}
            onPathsChange={updatePaths}
            onSave={saveDraft}
            onCancel={cancelEdit}
          />
        ) : (
          <div className="flex justify-between gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={startAdd}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("remoteSources.addHost", "Add machine")}
            </Button>
            {sources.length > 0 && (
              <Button
                size="sm"
                onClick={syncAll}
                disabled={busyId !== null}
              >
                {busyId === "__all__" ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                {t("remoteSources.syncAll", "Sync all")}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DraftFormProps {
  draft: RemoteSource;
  isEditing: boolean;
  onChange: <K extends keyof RemoteSource>(key: K, value: RemoteSource[K]) => void;
  onAuthChange: (auth: RemoteAuth) => void;
  onPathsChange: (paths: RemoteProviderPaths | undefined) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Convert textarea content to a non-empty trimmed list, or undefined if all blank. */
function parsePathLines(text: string): string[] | undefined {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function DraftForm({
  draft,
  isEditing,
  onChange,
  onAuthChange,
  onPathsChange,
  onSave,
  onCancel,
}: DraftFormProps) {
  const { t } = useTranslation();
  const idHost = React.useId();
  const idPort = React.useId();
  const idUser = React.useId();
  const idAuthValue = React.useId();
  const idPassphrase = React.useId();
  const idClaudePaths = React.useId();
  const idCodexPaths = React.useId();
  const idOpenCodePaths = React.useId();
  const [pathsOpen, setPathsOpen] = React.useState(
    () => Boolean(draft.paths?.claude || draft.paths?.codex || draft.paths?.opencode),
  );

  const defaults = DEFAULT_REMOTE_PATHS[draft.system];

  const updateProviderPaths = (
    provider: keyof RemoteProviderPaths,
    raw: string,
  ) => {
    const parsed = parsePathLines(raw);
    const nextPaths: RemoteProviderPaths = {
      ...draft.paths,
      [provider]: parsed,
    };
    // Collapse to undefined when every field is empty so the backend uses defaults.
    if (!nextPaths.claude && !nextPaths.codex && !nextPaths.opencode) {
      onPathsChange(undefined);
    } else {
      onPathsChange(nextPaths);
    }
  };

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground">
        {isEditing ? t("remoteSources.editHost", "Edit machine") : t("remoteSources.addHost", "Add machine")}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label htmlFor={idHost} className="text-xs">
            {t("remoteSources.host", "Host")}
          </Label>
          <Input
            id={idHost}
            value={draft.host}
            onChange={(e) => onChange("host", e.target.value)}
            placeholder="192.168.1.10"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={idPort} className="text-xs">
            {t("remoteSources.port", "Port")}
          </Label>
          <Input
            id={idPort}
            type="number"
            value={draft.port}
            onChange={(e) => onChange("port", Number(e.target.value) || DEFAULT_SSH_PORT)}
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={idUser} className="text-xs">
            {t("remoteSources.username", "Username")}
          </Label>
          <Input
            id={idUser}
            value={draft.username}
            onChange={(e) => onChange("username", e.target.value)}
            placeholder="root"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("remoteSources.system", "System")}</Label>
          <Select
            value={draft.system}
            onValueChange={(v) => onChange("system", v as RemoteSystemKind)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="linux">{t("remoteSources.systemLinux", "Linux / macOS")}</SelectItem>
              <SelectItem value="windows">{t("remoteSources.systemWindows", "Windows")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs">{t("remoteSources.authType", "Auth")}</Label>
          <Select
            value={draft.auth.type}
            onValueChange={(v) => {
              if (v === "key") onAuthChange({ type: "key", keyPath: "" });
              else onAuthChange({ type: "password", password: "" });
            }}
          >
            <SelectTrigger className="h-7 text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="key">{t("remoteSources.authKey", "SSH key")}</SelectItem>
              <SelectItem value="password">{t("remoteSources.authPassword", "Password")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft.auth.type === "key" ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={idAuthValue} className="text-xs">
                {t("remoteSources.keyPath", "Private key path")}
              </Label>
              <Input
                id={idAuthValue}
                value={draft.auth.keyPath}
                onChange={(e) => onAuthChange({ ...draft.auth, type: "key", keyPath: e.target.value })}
                placeholder={t("remoteSources.keyPathPlaceholder", "C:\\Users\\you\\.ssh\\id_ed25519")}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={idPassphrase} className="text-xs">
                {t("remoteSources.passphrase", "Passphrase (optional)")}
              </Label>
              <Input
                id={idPassphrase}
                type="password"
                value={draft.auth.passphrase ?? ""}
                onChange={(e) =>
                  onAuthChange({
                    ...draft.auth,
                    type: "key",
                    keyPath: draft.auth.type === "key" ? draft.auth.keyPath : "",
                    passphrase: e.target.value || undefined,
                  })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor={idAuthValue} className="text-xs">
              {t("remoteSources.password", "Password")}
            </Label>
            <Input
              id={idAuthValue}
              type="password"
              value={draft.auth.password ?? ""}
              onChange={(e) => onAuthChange({ type: "password", password: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id={`${idHost}-enabled`}
          checked={draft.enabled}
          onCheckedChange={(c) => onChange("enabled", c)}
        />
        <Label htmlFor={`${idHost}-enabled`} className="text-xs">
          {t("remoteSources.enabled", "Enabled (included in 'Sync all')")}
        </Label>
      </div>

      <Collapsible open={pathsOpen} onOpenChange={setPathsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="font-medium">
              {t("remoteSources.pathOverrides", "Path overrides (one per line, * supported)")}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${pathsOpen ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <p className="text-[10px] text-muted-foreground">
            {t(
              "remoteSources.pathOverridesHint",
              "Leave blank to use defaults. Wildcards (*) match one path segment — useful for cc-slack-style multi-tenant layouts.",
            )}
          </p>
          <div className="space-y-1">
            <Label htmlFor={idClaudePaths} className="text-xs">
              {t("remoteSources.claudePaths", "Claude paths")}
            </Label>
            <Textarea
              id={idClaudePaths}
              value={(draft.paths?.claude ?? []).join("\n")}
              onChange={(e) => updateProviderPaths("claude", e.target.value)}
              placeholder={defaults.claude.join("\n")}
              className="font-mono text-xs min-h-[3rem]"
              rows={2}
              spellCheck={false}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={idCodexPaths} className="text-xs">
              {t("remoteSources.codexPaths", "Codex paths")}
            </Label>
            <Textarea
              id={idCodexPaths}
              value={(draft.paths?.codex ?? []).join("\n")}
              onChange={(e) => updateProviderPaths("codex", e.target.value)}
              placeholder={defaults.codex.join("\n")}
              className="font-mono text-xs min-h-[2.5rem]"
              rows={1}
              spellCheck={false}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={idOpenCodePaths} className="text-xs">
              {t("remoteSources.opencodePaths", "OpenCode paths")}
            </Label>
            <Textarea
              id={idOpenCodePaths}
              value={(draft.paths?.opencode ?? []).join("\n")}
              onChange={(e) => updateProviderPaths("opencode", e.target.value)}
              placeholder={defaults.opencode.join("\n")}
              className="font-mono text-xs min-h-[3rem]"
              rows={2}
              spellCheck={false}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" />
          {t("common.cancel", "Cancel")}
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onSave}>
          <Check className="h-3.5 w-3.5 mr-1" />
          {t("common.save", "Save")}
        </Button>
      </div>
    </div>
  );
}
