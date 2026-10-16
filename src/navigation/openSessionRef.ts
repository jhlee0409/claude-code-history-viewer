/**
 * Open a session named by its `SessionRef` (the sidebar library's recent and
 * favourite entries, plan T7): find its project by path, find the session in
 * that project's list, and navigate there. One project is loaded, not every
 * project (the CLI hint resolver scans them all).
 *
 * The selected project's list is already in the store and is used as is.
 * Any navigation that begins while the list loads owns the screen; this one
 * then gives up silently (`ownPlace`).
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { loadSessionsFor, matchByPath, openSessionHint } from "@/lib/preloadSession";
import { useAppStore } from "@/store/useAppStore";
import { ownPlace } from "./ownership";
import { findProjectForSessionPath } from "./library";
import type { SessionRef } from "./place";

export type OpenSessionRefResult = "opened" | "notFound" | "superseded";

export async function openSessionRef(ref: SessionRef): Promise<OpenSessionRefResult> {
  const get = useAppStore.getState;
  const owns = ownPlace(get);
  const { projects, selectedProject, sessions, excludeSidechain } = get();
  const project = findProjectForSessionPath(projects, ref.filePath, ref.provider);
  if (!project) {
    toast.error(i18n.t("globalSearch.sessionNotFound"));
    return "notFound";
  }

  const listed =
    selectedProject?.path === project.path ? matchByPath(sessions, ref.filePath) : undefined;
  const session = listed ?? matchByPath(await loadSessionsFor(project, excludeSidechain), ref.filePath);
  if (!owns()) return "superseded";
  if (!session) {
    toast.error(i18n.t("globalSearch.sessionNotFound"));
    return "notFound";
  }
  const arrived = await get().navigate({ view: "conversation", project, session });
  return arrived ? "opened" : "superseded";
}

/**
 * A favourite starred before refs existed: only its id is known, so it is
 * found the way a CLI `--session <uuid>` is (every project scanned).
 */
export function openLegacyFavorite(sessionId: string): Promise<{ handled: boolean; matched: boolean }> {
  return openSessionHint(
    { kind: "uuid", value: sessionId },
    { t: (key, fallback) => i18n.t(key, { defaultValue: fallback ?? key }) },
  );
}
