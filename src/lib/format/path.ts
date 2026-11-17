/**
 * Path formatting for display (plan §4.4, F3a).
 *
 * One rule for every place the app shows a file path: shorten it only against
 * a base the caller can vouch for, in this order —
 *
 *   1. the message's working directory (`cwd`),
 *   2. the project root,
 *   3. the user's home directory (`~`),
 *
 * and otherwise show it whole (`absolute`). There is no guessing: a path that
 * sits under none of the given bases is never shortened against something
 * else (a sibling project, a home directory inferred from the path itself).
 *
 * The formatter is pure string work. It does not touch the disk, so a symlink
 * and its target are two different strings.
 *
 * Shortened forms always join with `/` (as `elideProjectRoot` does for the
 * Edits list); a path shown whole keeps its own separators.
 */
import { elideProjectRoot, splitPathParts } from "@/utils/pathUtils";

export type PathKind = "cwd" | "project" | "home" | "absolute";

export interface PathContext {
  /** The working directory recorded on the message the path came from. */
  cwd?: string | null;
  /** The project's root directory. */
  projectRoot?: string | null;
  /** The user's home directory, when known for certain. */
  homeDir?: string | null;
}

export interface FormattedPath {
  /**
   * Display text before the name, ending in a separator when non-empty, so
   * `dir + name` is the whole display string.
   */
  dir: string;
  /** The final segment (file or folder name), never shortened. */
  name: string;
  /** The path exactly as recorded — for `title`, copy and `data-path`. */
  full: string;
  /** Which base the display is relative to; `absolute` = shown as recorded. */
  kind: PathKind;
}

const SEPARATOR = /[\\/]/;

/** `C:` alone is a drive, not a folder. */
const isDriveSegment = (segment: string) => /^[A-Za-z]:$/.test(segment);

/**
 * A base must name a real folder: `/`, `C:\` or an empty string would turn
 * every absolute path into a misleading relative one.
 */
function isUsableBase(base: string | null | undefined): base is string {
  if (!base) return false;
  const withoutPrefix = base.replace(/^[\\/]{2}\?[\\/](?:UNC[\\/])?/i, "");
  return splitPathParts(withoutPrefix).some((part) => !isDriveSegment(part));
}

/** Split display text into `dir` (with trailing separator) and `name`. */
function splitDisplay(text: string): { dir: string; name: string } {
  // A trailing separator names the same folder; keep a bare root as is.
  const trimmed = text.replace(/[\\/]+$/, "");
  // Empty, or a bare root (`/`, `\\`): nothing to split.
  if (trimmed === "") return { dir: "", name: text };
  let cut = -1;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    if (SEPARATOR.test(trimmed.charAt(i))) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return { dir: "", name: trimmed };
  return { dir: trimmed.slice(0, cut + 1), name: trimmed.slice(cut + 1) };
}

/** The path relative to `base`, or `null` when it does not sit strictly under it. */
function relativeTo(path: string, base: string | null | undefined): string | null {
  if (!isUsableBase(base)) return null;
  const rest = elideProjectRoot(path, base);
  if (rest === path || rest === "") return null;
  return rest;
}

export function formatPath(path: string, ctx: PathContext = {}): FormattedPath {
  const make = (text: string, kind: PathKind): FormattedPath => ({
    ...splitDisplay(text),
    full: path,
    kind,
  });

  const underCwd = relativeTo(path, ctx.cwd);
  if (underCwd !== null) return make(underCwd, "cwd");

  const underProject = relativeTo(path, ctx.projectRoot);
  if (underProject !== null) return make(underProject, "project");

  if (isUsableBase(ctx.homeDir)) {
    const underHome = elideProjectRoot(path, ctx.homeDir);
    if (underHome !== path) {
      return make(underHome === "" ? "~" : `~/${underHome}`, "home");
    }
  }

  return make(path, "absolute");
}

/** A folder spelling without its trailing separator; a bare root stays as is. */
const trimDir = (dir: string) => (dir.length > 1 ? dir.replace(/[\\/]+$/, "") : dir);

/**
 * The hints one path can show, shortest first: more and more parent folders
 * of its display text, then its whole display folder (keeping `~`, `/` or
 * `C:\`), then folders the display had dropped (from `full`), and last the
 * folder — or the whole path — exactly as recorded.
 */
function hintLadder(path: FormattedPath): string[] {
  const shown = splitPathParts(`${path.dir}${path.name}`);
  const recorded = splitPathParts(path.full);
  const ladder: string[] = [];
  const add = (hint: string) => {
    if (ladder[ladder.length - 1] !== hint) ladder.push(hint);
  };
  for (let k = 2; k < shown.length; k += 1) add(shown.slice(-k, -1).join("/"));
  add(trimDir(path.dir));
  for (let k = shown.length + 1; k < recorded.length; k += 1) add(recorded.slice(-k, -1).join("/"));
  add(trimDir(splitDisplay(path.full).dir));
  add(path.full);
  return ladder;
}

interface HintEntry {
  path: FormattedPath;
  ladder: string[];
  /** Index into `ladder` of the hint currently chosen. */
  level: number;
}

/**
 * For each path, the parent folders to show beside its name so that
 * same-named files can be told apart (VS Code style): `""` when the name
 * alone is unique, otherwise as little context as makes every same-named
 * file's hint different. Files whose shortened labels match (say `lib/index.ts`
 * under the cwd and under the project root) fall back to the folders the
 * shortening dropped, then to the folder as recorded. The same path shown the
 * same way gets the same hint.
 */
export function disambiguate(paths: readonly FormattedPath[]): string[] {
  // One entry per distinct file *as shown*; duplicates share its hint.
  const keyOf = (p: FormattedPath) => `${p.full}\u0000${p.dir}${p.name}`;
  const entries = new Map<string, HintEntry>();
  for (const path of paths) {
    if (!entries.has(keyOf(path))) entries.set(keyOf(path), { path, ladder: hintLadder(path), level: 0 });
  }

  const byName = new Map<string, HintEntry[]>();
  for (const entry of entries.values()) {
    const group = byName.get(entry.path.name) ?? [];
    group.push(entry);
    byName.set(entry.path.name, group);
  }

  const hints = new Map<string, string>();
  for (const group of byName.values()) {
    const files = new Set(group.map((e) => e.path.full));
    if (files.size === 1) {
      for (const entry of group) hints.set(keyOf(entry.path), "");
      continue;
    }
    const hintOf = (e: HintEntry) => e.ladder[e.level] ?? e.path.full;
    // Raise the colliding entries one step at a time until no two different
    // files share a hint. Each ladder ends with the full path, which differs
    // for different files, so this ends.
    for (;;) {
      const clashing = group.filter((e) =>
        group.some((other) => other.path.full !== e.path.full && hintOf(other) === hintOf(e)),
      );
      const raisable = clashing.filter((e) => e.level < e.ladder.length - 1);
      if (raisable.length === 0) break;
      for (const entry of raisable) entry.level += 1;
    }
    for (const entry of group) hints.set(keyOf(entry.path), hintOf(entry));
  }

  return paths.map((path) => hints.get(keyOf(path)) ?? "");
}

/**
 * The home directory, from the path the backend's `get_claude_folder_path`
 * returned. That command builds `<OS home>/.claude`, so its parent *is* home.
 *
 * Pass only that value. A folder the user chose — even one named `.claude`
 * (`/Volumes/backup/.claude`) — says nothing about home; the app keeps home
 * unknown then and paths stay whole.
 */
export function homeDirFromDefaultClaudePath(defaultClaudePath: string | null | undefined): string | null {
  if (!defaultClaudePath) return null;
  const trimmed = defaultClaudePath.replace(/[\\/]+$/, "");
  const { dir, name } = splitDisplay(trimmed);
  if (name !== ".claude") return null;
  const parent = trimDir(dir);
  return isUsableBase(parent) ? parent : null;
}
