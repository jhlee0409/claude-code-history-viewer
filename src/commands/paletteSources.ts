/**
 * The ⌘K palette's place sources (plan T10): the projects and sessions a
 * query finds, and which providers' messages the message search reaches.
 * Pure; the palette (`GlobalSearchModal`) renders the hits as cmdk groups in
 * the order Commands, Projects, Sessions, Messages.
 *
 * Projects and sessions are matched here, synchronously, from what the app
 * already holds (the scanned project list, the open project's loaded
 * sessions, the library's recent and starred sessions): typing never waits
 * for them. Messages come from the backend search (`usePaletteMessageSearch`).
 */
import type { FavoriteEntry, RecentEntry } from "@/navigation/library";
import type { SessionRef } from "@/navigation/place";
import type { ClaudeProject, ClaudeSession, ProviderId } from "@/types";
import { getProjectDisplayName } from "@/utils/pathUtils";
import { WSL_SEARCHABLE_PROVIDER_IDS } from "@/utils/providers";

/** What the session and message sources search: the open project, or everything. */
export type PaletteScope = "project" | "all";

/** Rows a place group shows before its "Show N more" item. */
export const GROUP_LIMIT = 5;

/** Message rows shown before "Show all N messages". */
export const MESSAGE_PREVIEW_LIMIT = 8;

/** The message search runs from this many characters (the backend's own floor). */
export const MIN_MESSAGE_QUERY = 2;

const providerOf = (p: { provider?: string | null }): string => p.provider ?? "claude";

/** The query's words, lowercased. */
export function queryWords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLocaleLowerCase());
}

/**
 * Where `query`'s words occur in `text` (every occurrence, case-insensitive),
 * as sorted, merged `[start, end)` ranges - what a row highlights.
 */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const lower = text.toLocaleLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(word, from);
      if (at === -1) break;
      ranges.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/**
 * How well `text` matches `words`, lower is better, or null when a word is
 * missing: 0 the text starts with the first word, 1 every word starts a word
 * of the text, 2 the words occur anywhere.
 */
function rankText(text: string, words: readonly string[]): number | null {
  if (words.length === 0) return null;
  const lower = text.toLocaleLowerCase();
  if (!words.every((word) => lower.includes(word))) return null;
  if (lower.startsWith(words[0]!)) return 0;
  const textWords = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.every((word) => textWords.some((w) => w.startsWith(word))) ? 1 : 2;
}

const time = (value: string | undefined): number => {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export interface ProjectHit {
  project: ClaudeProject;
  /** The name the sidebar shows for it. */
  label: string;
}

/**
 * The projects `query` finds: every word in the display name or the decoded
 * path. Hidden projects are left out, as in the sidebar. Better matches
 * first, then the most recently active.
 */
export function matchProjects(
  query: string,
  projects: readonly ClaudeProject[],
  isHidden: (project: ClaudeProject) => boolean,
): ProjectHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const hits: Array<ProjectHit & { rank: number }> = [];
  for (const project of projects) {
    if (isHidden(project)) continue;
    const label = getProjectDisplayName(project);
    const byName = rankText(label, words);
    const byPath = byName === null ? rankText(project.actual_path || project.path, words) : null;
    const rank = byName ?? (byPath === null ? null : 3);
    if (rank === null) continue;
    hits.push({ project, label, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || time(b.project.last_modified) - time(a.project.last_modified));
  return hits.map(({ project, label }) => ({ project, label }));
}

/** How a session row opens. */
export type SessionTarget =
  /** A session of the open project's loaded list, opened as its sidebar row is. */
  | { kind: "loaded"; session: ClaudeSession; project: ClaudeProject }
  /** A library entry (recent, starred) of any project, opened by its ref. */
  | { kind: "ref"; ref: SessionRef };

export interface SessionCandidate {
  /** The session's file: one row per file. */
  key: string;
  title: string;
  provider: string;
  /** The listing project's display name, when known. */
  projectLabel?: string;
  target: SessionTarget;
}

export interface SessionSources {
  scope: PaletteScope;
  /** The open project's loaded sessions (`projectSlice.sessions`). */
  sessions: readonly ClaudeSession[];
  selectedProject: ClaudeProject | null;
  recent: readonly RecentEntry[];
  favorites: readonly FavoriteEntry[];
  projects: readonly ClaudeProject[];
  /** The title the app shows for a session: its custom name, else `fallback`. */
  titleOf: (sessionId: string, fallback: string) => string;
}

/**
 * Every session the palette can offer, before matching. Scope "project":
 * the open project's loaded sessions. Scope "all": those, then the
 * library's recent and starred sessions of any project - the sessions the
 * app knows without reading every project's list. Each file once; a star
 * saved before refs existed has no place to open and is left out.
 */
export function sessionCandidates(sources: SessionSources): SessionCandidate[] {
  const { scope, sessions, selectedProject, recent, favorites, projects, titleOf } = sources;
  const out: SessionCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: SessionCandidate) => {
    if (seen.has(candidate.key)) return;
    seen.add(candidate.key);
    out.push(candidate);
  };
  if (selectedProject) {
    const projectLabel = getProjectDisplayName(selectedProject);
    for (const session of sessions) {
      add({
        key: session.file_path,
        title: titleOf(session.session_id, session.summary?.trim() || ""),
        provider: providerOf(session),
        projectLabel,
        target: { kind: "loaded", session, project: selectedProject },
      });
    }
  }
  if (scope === "project") return out.filter((c) => c.title);

  const labelFor = (ref: SessionRef): string | undefined => {
    const listing = ref.projectPath
      ? projects.find((p) => providerOf(p) === ref.provider && p.path === ref.projectPath)
      : undefined;
    return listing ? getProjectDisplayName(listing) : undefined;
  };
  for (const entry of recent) {
    add({
      key: entry.ref.filePath,
      title: titleOf(entry.ref.sessionId, entry.title.trim()),
      provider: entry.ref.provider,
      projectLabel: labelFor(entry.ref),
      target: { kind: "ref", ref: entry.ref },
    });
  }
  for (const favorite of favorites) {
    if (!favorite.ref) continue;
    add({
      key: favorite.ref.filePath,
      title: favorite.customName?.trim() || titleOf(favorite.sessionId, ""),
      provider: favorite.ref.provider,
      projectLabel: labelFor(favorite.ref),
      target: { kind: "ref", ref: favorite.ref },
    });
  }
  return out.filter((c) => c.title);
}

/** The candidates `query` finds by title: better matches first, else in list order. */
export function matchSessions(query: string, candidates: readonly SessionCandidate[]): SessionCandidate[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  return candidates
    .map((candidate, index) => ({ candidate, index, rank: rankText(candidate.title, words) }))
    .filter((hit): hit is typeof hit & { rank: number } => hit.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((hit) => hit.candidate);
}

/**
 * Providers `search_all_providers` searches on this machine (Rust,
 * `commands/multi_provider.rs`); a test holds the two lists equal. A new
 * provider without a search shows up in the palette's Messages group as
 * "not searched" instead of silently finding nothing.
 */
export const MESSAGE_SEARCH_PROVIDERS: readonly ProviderId[] = [
  "aider",
  "amazonq",
  "antigravity",
  "claude",
  "cline",
  "codebuddy",
  "codex",
  "continue",
  "copilot",
  "crush",
  "cursor",
  "cursor-agent",
  "forgecode",
  "gemini",
  "goose",
  "grok",
  "kilo",
  "kimi",
  "kiro",
  "llm",
  "ompi",
  "opencode",
  "openhands",
  "openinterpreter",
  "pearai",
  "pi",
  "qwen",
  "trae",
  "vibe",
  "zcode",
  "zed",
];

const SEARCHED = new Set<string>(MESSAGE_SEARCH_PROVIDERS);
const WSL_SEARCHED = new Set<string>(WSL_SEARCHABLE_PROVIDER_IDS);

/** A project listed from a WSL distro (its scan labels it `WSL: <distro>`). */
const isWslProject = (project: ClaudeProject): boolean =>
  project.custom_directory_label?.startsWith("WSL:") ?? false;

/** Whether the message search reaches `project`'s conversations. */
export function isMessageSearchable(project: ClaudeProject): boolean {
  const provider = providerOf(project);
  return isWslProject(project) ? WSL_SEARCHED.has(provider) : SEARCHED.has(provider);
}

/**
 * The providers of `projects` whose messages the search cannot reach, each
 * once, in first-listed order: the Messages group names them, so an empty
 * result is not read as "no match there".
 */
export function unsearchableProviders(projects: readonly ClaudeProject[]): string[] {
  const out: string[] = [];
  for (const project of projects) {
    const provider = providerOf(project);
    if (!isMessageSearchable(project) && !out.includes(provider)) out.push(provider);
  }
  return out;
}

/** cmdk item values of the place rows (commands: `commandItemValue`). */
export const projectItemValue = (project: ClaudeProject): string =>
  `project:${providerOf(project)}:${project.path}`.trim();
export const sessionItemValue = (candidate: SessionCandidate): string => `session:${candidate.key}`.trim();
export const MORE_PROJECTS_VALUE = "more:projects";
export const MORE_SESSIONS_VALUE = "more:sessions";
export const MORE_MESSAGES_VALUE = "more:messages";
export const RETRY_MESSAGES_VALUE = "retry:messages";
