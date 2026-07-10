import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeSession } from "@/types";

/**
 * Run an async task over `items` with at most `limit` in flight at once.
 * Preserves input order in the returned results. Used so a mass delete of many
 * sessions doesn't fire hundreds of simultaneous OS-trash operations.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index] as T);
    }
  });

  await Promise.all(workers);
  return results;
}

type DeleteOutcome =
  | { session: ClaudeSession; ok: true }
  | { session: ClaudeSession; ok: false; error: string };

/**
 * Mass operations for the multi-select session list. Reuses the hardened
 * single-session `delete_session` command (path validation, symlink guard,
 * trash-with-fallback, Codex DB cleanup) in a concurrency-limited loop rather
 * than adding a parallel backend delete path.
 */
export function useSessionBatchActions() {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  const copyIds = useCallback(
    async (sessions: ClaudeSession[]) => {
      if (sessions.length === 0) return;
      const text = sessions.map((s) => s.actual_session_id).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        toast.success(
          t("session.selection.copiedIds", {
            count: sessions.length,
            defaultValue: "Copied {{count}} session ID(s)",
          })
        );
      } catch (error) {
        console.error("[session selection] copy ids failed", error);
        toast.error(t("copyButton.error", "Copy failed"));
      }
    },
    [t]
  );

  const deleteSessions = useCallback(
    async (sessions: ClaudeSession[]) => {
      if (sessions.length === 0) return;

      setIsDeleting(true);
      try {
        const results = await mapWithConcurrency<ClaudeSession, DeleteOutcome>(
          sessions,
          6,
          async (session) => {
            try {
              await api("delete_session", { filePath: session.file_path });
              return { session, ok: true };
            } catch (error) {
              return {
                session,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }
        );

        const deleted = results.filter(
          (r): r is Extract<DeleteOutcome, { ok: true }> => r.ok
        );
        const failed = results.filter(
          (r): r is Extract<DeleteOutcome, { ok: false }> => !r.ok
        );

        // Prune deleted sessions from the store in a single update and drop the
        // open session if it was among them.
        if (deleted.length > 0) {
          const deletedIds = new Set(deleted.map((r) => r.session.session_id));
          const { sessions: current, setSessions, selectedSession, setSelectedSession } =
            useAppStore.getState();
          setSessions(current.filter((s) => !deletedIds.has(s.session_id)));
          if (selectedSession && deletedIds.has(selectedSession.session_id)) {
            setSelectedSession(null);
          }
        }

        if (failed.length === 0) {
          toast.success(
            t("session.selection.deleteSuccess", {
              count: deleted.length,
              defaultValue: "Deleted {{count}} session(s)",
            })
          );
        } else {
          console.error("[session selection] batch delete had failures", failed);
          toast.error(
            t("session.selection.deletePartial", {
              deleted: deleted.length,
              failed: failed.length,
              defaultValue: "Deleted {{deleted}}, failed {{failed}}",
            }),
            { description: failed[0]?.error }
          );
        }

        // Leave selection mode once the operation resolves (matches the
        // single-delete flow, which closes its dialog on completion).
        useAppStore.getState().exitSessionSelectionMode();
      } finally {
        setIsDeleting(false);
      }
    },
    [t]
  );

  return { isDeleting, deleteSessions, copyIds };
}
