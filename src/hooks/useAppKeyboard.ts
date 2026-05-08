import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useModal } from "@/contexts/modal";
import { usePlatform } from "@/contexts/platform";
import { useAppStore } from "@/store/useAppStore";
import { api } from "@/services/api";
import type { RemoteSource, SyncOutcome } from "@/types";
import { DEFAULT_SSH_PORT } from "@/types";

interface SyncOneResult {
  sourceId: string;
  success: boolean;
  outcome?: SyncOutcome;
  error?: string;
}

type RemoteRefreshState = "syncing" | "success" | "error";

function emitRemoteRefreshStatus(state: RemoteRefreshState, message: string) {
  window.dispatchEvent(
    new CustomEvent("remote-refresh-status", {
      detail: { state, message },
    })
  );
}

/**
 * Global keyboard shortcuts for the app.
 * - Cmd+K: open global search
 * - Cmd+Shift+M: toggle message navigator (desktop only)
 */
export function useAppKeyboard() {
  const { openModal } = useModal();
  const { isMobile } = usePlatform();
  const toggleNavigator = useAppStore((s) => s.toggleNavigator);
  const scanProjects = useAppStore((s) => s.scanProjects);
  const updateUserSettings = useAppStore((s) => s.updateUserSettings);

  useEffect(() => {
    let isRefreshing = false;

    const applyInjectedPaths = async (source: RemoteSource, outcome: SyncOutcome) => {
      const state = useAppStore.getState();
      const existing = state.userMetadata?.settings?.customClaudePaths ?? [];
      const labelBase = `🌐 ${source.host}${source.port === DEFAULT_SSH_PORT ? "" : `:${source.port}`}`;
      const normalizePath = (path: string) => path.replace(/[\\/]+$/, "");
      const buildEntries = (
        roots: typeof outcome.injectedPaths.claude,
        providerTag: string,
      ) => {
        const multi = roots.length > 1;
        return roots.map((r) => {
          let label = r.source?.displayLabel ?? labelBase;
          if (!r.source && providerTag) label += ` (${providerTag}${multi ? `/${r.discriminator}` : ""})`;
          else if (!r.source && multi) label += ` [${r.discriminator}]`;
          return { path: r.localPath, label, source: r.source };
        });
      };
      const entries = [
        ...buildEntries(outcome.injectedPaths.claude, ""),
        ...buildEntries(outcome.injectedPaths.codex, "codex"),
        ...buildEntries(outcome.injectedPaths.opencode, "opencode"),
      ];
      const byPath = new Map(existing.map((cp) => [normalizePath(cp.path), cp]));
      let changed = false;
      for (const entry of entries) {
        const normalizedPath = normalizePath(entry.path);
        const previous = byPath.get(normalizedPath);
        const next = previous
          ? {
              ...previous,
              path: normalizedPath,
              label: entry.label,
              source: entry.source,
            }
          : {
              path: normalizedPath,
              label: entry.label,
              source: entry.source,
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
    };

    const syncRemotesAndRefresh = async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      emitRemoteRefreshStatus("syncing", "Syncing remote sessions...");
      try {
        const state = useAppStore.getState();
        const sources = (state.userMetadata?.settings?.remoteSources ?? []).filter(
          (source) => source.enabled
        );
        if (sources.length > 0) {
          const results = await api<SyncOneResult[]>("sync_all_remote_sources", { sources });
          const latestSources = state.userMetadata?.settings?.remoteSources ?? [];
          let ok = 0;
          let failed = 0;
          for (const result of results) {
            const source = sources.find((s) => s.id === result.sourceId);
            if (!source) continue;
            if (result.success && result.outcome) {
              await applyInjectedPaths(source, result.outcome);
              ok += 1;
            } else {
              failed += 1;
            }
          }
          const stampedSources = latestSources.map((source) => {
            const result = results.find((r) => r.sourceId === source.id);
            if (!result) return source;
            return {
              ...source,
              lastSyncAt: new Date().toISOString(),
              lastSyncStatus: result.success ? "ok" as const : "error" as const,
              lastSyncError: result.success ? undefined : result.error ?? "unknown error",
              lastSyncStats: result.outcome?.stats,
            };
          });
          await updateUserSettings({ remoteSources: stampedSources });
          if (ok > 0) {
            const message = `Remote sync complete: ${ok} synced${failed ? `, ${failed} failed` : ""}`;
            emitRemoteRefreshStatus("success", message);
          } else if (failed > 0) {
            const message = `Remote sync failed for ${failed} machine(s)`;
            emitRemoteRefreshStatus("error", message);
          }
        } else {
          emitRemoteRefreshStatus("success", "No enabled remote machines");
        }
        await scanProjects();
      } catch (error) {
        const message = `Refresh failed: ${String(error)}`;
        emitRemoteRefreshStatus("error", message);
      } finally {
        isRefreshing = false;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        openModal("globalSearch");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void syncRemotesAndRefresh();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!isMobile) toggleNavigator();
      }
    };

    let unlistenRemoteRefresh: (() => void) | undefined;
    void listen("remote-refresh-requested", () => {
      void syncRemotesAndRefresh();
    }).then((unlisten) => {
      unlistenRemoteRefresh = unlisten;
    });

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      unlistenRemoteRefresh?.();
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [openModal, toggleNavigator, isMobile, scanProjects, updateUserSettings]);
}
