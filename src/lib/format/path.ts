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

/**
 * For each path, the parent folders to show beside its name so that
 * same-named files can be told apart (VS Code style): as few trailing folders
 * as make the label unique, `""` when the name alone is unique. A path that
 * runs out of folders shows its whole `dir` (keeping `~`, `/` or `C:\`).
 * Identical paths get identical hints.
 */
export function disambiguate(paths: readonly FormattedPath[]): string[] {
  const segmentsOf = paths.map((p) => splitPathParts(`${p.dir}${p.name}`));
  const tail = (segments: string[], k: number) => segments.slice(-k).join("/");

  return paths.map((path, index) => {
    const own = segmentsOf[index] ?? [];
    const rivals = segmentsOf.filter(
      (segments, other) =>
        other !== index &&
        paths[other]?.full !== path.full &&
        segments[segments.length - 1] === own[own.length - 1],
    );
    if (rivals.length === 0) return "";

    for (let k = 2; k <= own.length; k += 1) {
      const label = tail(own, k);
      const clash = rivals.some((segments) => segments.length >= k && tail(segments, k) === label);
      if (clash) continue;
      if (k === own.length) break;
      return own.slice(-k, -1).join("/");
    }
    return path.dir.length > 1 ? path.dir.replace(/[\\/]+$/, "") : path.dir;
  });
}

/**
 * The home directory implied by the Claude folder: the app's default is
 * `<home>/.claude` (`get_claude_folder_path`). A custom folder with another
 * name says nothing about home, so the answer is `null` and paths stay whole.
 */
export function homeDirFromClaudePath(claudePath: string | null | undefined): string | null {
  if (!claudePath) return null;
  const trimmed = claudePath.replace(/[\\/]+$/, "");
  const { dir, name } = splitDisplay(trimmed);
  if (name !== ".claude") return null;
  const parent = dir.length > 1 ? dir.replace(/[\\/]+$/, "") : dir;
  return isUsableBase(parent) ? parent : null;
}
