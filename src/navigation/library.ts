/**
 * The sidebar library's lists (plan T7): recently opened sessions and
 * favourites. Pure; the store keeps the recent list (`navigationSlice`) and
 * the favourites live in the user metadata (`SessionMetadata.starred` +
 * `ref`).
 *
 * Both lists name a session by its `SessionRef` (provider + file path, the
 * load key), so an entry opens without scanning every project
 * (`openSessionRef`). A favourite starred before `ref` existed has none until
 * its project is opened; it is listed as "location check needed".
 */
import type { ClaudeProject, ClaudeSession, UserMetadata } from "@/types";
import { sessionRefOf, type SessionRef } from "./place";

/** At most this many recent sessions are kept (plan T7). */
export const RECENT_LIMIT = 12;

/** localStorage key of the persisted recent list. */
export const RECENT_STORAGE_KEY = "library.recent.v1";

export interface RecentEntry {
  ref: SessionRef;
  /** The session's summary when it was opened; the custom name wins at render. */
  title: string;
  /** Epoch ms of the last opening. */
  openedAt: number;
}

/** The entry for an opened session. */
export function recentEntryOf(session: ClaudeSession, openedAt: number): RecentEntry {
  return {
    ref: sessionRefOf(session) as SessionRef,
    title: session.summary ?? "",
    openedAt,
  };
}

/** Put `entry` first; the same file opened again moves up, and the list stays bounded. */
export function pushRecent(
  list: readonly RecentEntry[],
  entry: RecentEntry,
  limit: number = RECENT_LIMIT,
): RecentEntry[] {
  return [entry, ...list.filter((e) => e.ref.filePath !== entry.ref.filePath)].slice(0, limit);
}

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseRef(value: unknown): SessionRef | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isString(r.provider) || !isString(r.filePath) || !isString(r.sessionId)) return null;
  return {
    provider: r.provider,
    filePath: r.filePath,
    sessionId: r.sessionId,
    ...(isString(r.actualSessionId) ? { actualSessionId: r.actualSessionId } : {}),
  };
}

/** A stored recent list, validated: malformed entries are dropped, never thrown. */
export function parseRecent(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const ref = parseRef(e.ref);
    if (!ref || typeof e.openedAt !== "number") continue;
    if (out.some((o) => o.ref.filePath === ref.filePath)) continue;
    out.push({ ref, title: typeof e.title === "string" ? e.title : "", openedAt: e.openedAt });
  }
  return out.slice(0, RECENT_LIMIT);
}

export function loadRecent(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): RecentEntry[] {
  try {
    const raw = storage?.getItem(RECENT_STORAGE_KEY);
    return raw ? parseRecent(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveRecent(
  list: readonly RecentEntry[],
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode, quota): the list lives for this run.
  }
}

export interface FavoriteEntry {
  /** The metadata key (`session_id`). */
  sessionId: string;
  /** Where it lives; absent for a star saved before refs existed. */
  ref: SessionRef | null;
  /** The user's custom name, if any. */
  customName?: string;
}

/** Starred sessions, in metadata order; legacy stars (no ref) last. */
export function favoritesOf(metadata: Pick<UserMetadata, "sessions">): FavoriteEntry[] {
  const withRef: FavoriteEntry[] = [];
  const legacy: FavoriteEntry[] = [];
  for (const [sessionId, meta] of Object.entries(metadata.sessions ?? {})) {
    if (!meta?.starred) continue;
    const ref = parseRef(meta.ref);
    const entry: FavoriteEntry = {
      sessionId,
      ref,
      ...(meta.customName ? { customName: meta.customName } : {}),
    };
    (ref ? withRef : legacy).push(entry);
  }
  return [...withRef, ...legacy];
}

/**
 * Starred sessions among `sessions` that still lack a ref: opening their
 * project is when a legacy star learns where it lives (plan T7).
 */
export function favoritesMissingRef(
  metadata: Pick<UserMetadata, "sessions">,
  sessions: readonly ClaudeSession[],
): ClaudeSession[] {
  return sessions.filter((s) => {
    const meta = metadata.sessions?.[s.session_id];
    return meta?.starred === true && !parseRef(meta.ref);
  });
}

/**
 * The project a session file belongs to: the project whose storage path
 * contains the file, on a path-segment boundary (`/a/proj` never claims
 * `/a/proj2/x`). The provider narrows the match when given.
 */
export function findProjectForSessionPath(
  projects: readonly ClaudeProject[],
  filePath: string,
  provider?: string,
): ClaudeProject | undefined {
  const contains = (p: ClaudeProject) => {
    if (!filePath.startsWith(p.path)) return false;
    if (filePath.length === p.path.length) return true;
    const next = filePath.charAt(p.path.length);
    return next === "/" || next === "\\";
  };
  const sameProvider = (p: ClaudeProject) => provider === undefined || (p.provider ?? "claude") === provider;
  return projects.find((p) => sameProvider(p) && contains(p)) ?? projects.find(contains);
}
