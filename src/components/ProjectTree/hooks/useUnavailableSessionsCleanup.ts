import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { supportsSessionDeletion } from "@/utils/providers";

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

interface DeletedSession {
  session: ClaudeSession;
}

interface FailedSession {
  session?: ClaudeSession;
  error: string;
}

interface ProjectCleanupResult {
  deleted: DeletedSession[];
  failed: FailedSession[];
  skipped: number;
}

/**
 * Deletes every deletable session belonging to projects whose last-known
 * working directory is gone. Sessions are loaded through the normal provider
 * reader first, so this reuses the hardened single-session `delete_session`
 * command (path validation, database lookup, trash fallback) rather than
 * adding a second deletion path.
 */
export function useUnavailableSessionsCleanup() {
  const { t } = useTranslation();
  const [isClearing, setIsClearing] = useState(false);

  const clearUnavailableSessions = useCallback(
    async (projects: ClaudeProject[]) => {
      if (projects.length === 0 || isClearing) return;
      if (useAppStore.getState().isServerReadOnly) return;

      setIsClearing(true);
      try {
        const uniqueProjects = Array.from(
          new Map(projects.map((project) => [project.path, project])).values()
        );

        const results = await mapWithConcurrency<
          ClaudeProject,
          ProjectCleanupResult
        >(uniqueProjects, 3, async (project) => {
          const provider = project.provider ?? "claude";
          try {
            const sessions = await api<ClaudeSession[]>("load_provider_sessions", {
              provider,
              projectPath: project.path,
              excludeSidechain: false,
            });
            const deletable = sessions.filter((session) =>
              supportsSessionDeletion(session.provider ?? provider)
            );

            const outcomes = await mapWithConcurrency<
              ClaudeSession,
              { session: ClaudeSession; ok: boolean; error?: string }
            >(deletable, 4, async (session) => {
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
            });

            return {
              deleted: outcomes
                .filter((outcome) => outcome.ok)
                .map((outcome) => ({ session: outcome.session })),
              failed: outcomes
                .filter((outcome) => !outcome.ok)
                .map((outcome) => ({
                  session: outcome.session,
                  error: outcome.error ?? "Delete failed",
                })),
              skipped: sessions.length - deletable.length,
            };
          } catch (error) {
            return {
              deleted: [],
              failed: [
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              ],
              skipped: 0,
            };
          }
        });

        const deleted = results.flatMap((result) => result.deleted);
        const failed = results.flatMap((result) => result.failed);
        const skipped = results.reduce((total, result) => total + result.skipped, 0);

        if (deleted.length > 0) {
          const deletedFiles = new Set(
            deleted.map(({ session }) => session.file_path)
          );
          const state = useAppStore.getState();
          state.setSessions(
            state.sessions.filter((session) => !deletedFiles.has(session.file_path))
          );
          if (
            state.selectedSession &&
            deletedFiles.has(state.selectedSession.file_path)
          ) {
            state.setSelectedSession(null);
          }

          await useAppStore.getState().refreshAllConversations();
        }

        const skippedNote =
          skipped > 0
            ? t("project.unavailableCleanup.skipped", {
                count: skipped,
                defaultValue:
                  "{{count}} session(s) skipped because their provider doesn't support deletion.",
              })
            : undefined;

        if (deleted.length > 0 && failed.length === 0) {
          toast.success(
            t("project.unavailableCleanup.success", {
              count: deleted.length,
              defaultValue: "Cleared {{count}} session(s)",
            }),
            { description: skippedNote }
          );
        } else if (deleted.length > 0) {
          console.error("[unavailable cleanup] some sessions failed", failed);
          toast.error(
            t("project.unavailableCleanup.partial", {
              deleted: deleted.length,
              failed: failed.length,
              defaultValue: "Cleared {{deleted}}, failed {{failed}}",
            }),
            { description: failed[0]?.error ?? skippedNote }
          );
        } else if (failed.length > 0) {
          console.error("[unavailable cleanup] failed", failed);
          toast.error(
            t("project.unavailableCleanup.error", "Failed to clear sessions"),
            { description: failed[0]?.error ?? skippedNote }
          );
        } else {
          toast.warning(
            t("project.unavailableCleanup.none", "No sessions were deleted"),
            { description: skippedNote }
          );
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : String(error);
        console.error("[unavailable cleanup] failed", error);
        toast.error(
          t("project.unavailableCleanup.error", "Failed to clear sessions"),
          { description }
        );
      } finally {
        setIsClearing(false);
      }
    },
    [isClearing, t]
  );

  return { isClearing, clearUnavailableSessions };
}
