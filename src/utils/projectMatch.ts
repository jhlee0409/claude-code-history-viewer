import type { ClaudeProject, ClaudeSession } from "../types";

/**
 * Locate the sidebar project that owns a session about to be selected.
 *
 * Matching rules, in order:
 * 1. Restrict candidates to the session's own provider. Display names are
 *    not unique across providers (e.g. a Kimi Code project and a Claude
 *    project can share the same working directory basename), and picking a
 *    cross-provider name twin switches the sidebar selection away from the
 *    project the user is looking at — hiding its session list.
 * 2. Path-prefix match at a path-segment boundary. The raw comparison covers
 *    plain paths (Claude) and providers whose session file_path carries the
 *    project scheme (opencode://, forgecode://). Providers like kimi:// and
 *    kimicode:// prefix the *project* path with a scheme while the session
 *    file_path stays a raw filesystem path, so the project path is also
 *    tried with its scheme stripped.
 * 3. Display-name equality within the same provider, for providers whose
 *    on-disk session paths cannot be derived from the project path at all
 *    (e.g. codex:// sessions live under ~/.codex/sessions, not the cwd).
 */
export function findProjectForSession(
  projects: ClaudeProject[],
  session: Pick<ClaudeSession, "file_path" | "project_name" | "provider">
): ClaudeProject | undefined {
  const sessionProvider = session.provider ?? "claude";
  const sameProvider = projects.filter(
    (p) => (p.provider ?? "claude") === sessionProvider
  );
  const candidates = sameProvider.length > 0 ? sameProvider : projects;

  if (session.file_path) {
    const fp = session.file_path;
    const matchesAtBoundary = (base: string): boolean => {
      if (!fp.startsWith(base)) return false;
      if (fp.length === base.length) return true;
      const next = fp.charAt(base.length);
      return next === "/" || next === "\\";
    };
    const byPath = candidates.find((p) => {
      if (matchesAtBoundary(p.path)) return true;
      const schemeEnd = p.path.indexOf("://");
      return schemeEnd >= 0 && matchesAtBoundary(p.path.slice(schemeEnd + 3));
    });
    if (byPath) return byPath;
  }
  return candidates.find((p) => p.name === session.project_name);
}
