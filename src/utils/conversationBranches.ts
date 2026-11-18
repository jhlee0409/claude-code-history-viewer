/**
 * Conversation branches (#782): which messages are on the path being read,
 * and where each fork's switcher goes.
 *
 * `get_conversation_branches` reads the whole session and reports its forks
 * (an edited prompt, `/rewind`, a resume at an earlier message). Everything
 * here works on whatever window is loaded: a message's alternative comes from
 * `membership`, never from walking parents through the window.
 */
import type { ClaudeMessage, ConversationBranches } from "@/types";

/** The alternative chosen at a fork: the fork entry's uuid → the alternative's head uuid. */
export type BranchSelections = Readonly<Record<string, string>>;

export const NO_BRANCH_SELECTIONS: BranchSelections = Object.freeze({});

/** The shown alternative of each point: the user's choice, else the one Claude Code resumes. */
function shownOptions(branches: ConversationBranches, selections: BranchSelections): number[] {
  return branches.points.map((point) => {
    const chosen = selections[point.parentUuid];
    const id = chosen === undefined
      ? undefined
      : point.optionIds.find((option) => branches.options[option]?.headUuid === chosen);
    return id ?? point.defaultOption;
  });
}

/** The alternatives a message sits in, innermost first; empty above every fork. */
function* optionChain(branches: ConversationBranches, uuid: string): Generator<number> {
  let option: number | null | undefined = Object.hasOwn(branches.membership, uuid)
    ? branches.membership[uuid]
    : undefined;
  // Each step moves to an enclosing point, so a well-formed answer ends
  // within `points.length` steps; the bound keeps a malformed one finite.
  for (let step = 0; option != null && step <= branches.points.length; step++) {
    yield option;
    const point: number | undefined = branches.options[option]?.point;
    option = point === undefined ? undefined : branches.points[point]?.parentOption;
  }
}

function isShown(branches: ConversationBranches, shown: number[], uuid: string): boolean {
  for (const option of optionChain(branches, uuid)) {
    const point = branches.options[option]?.point;
    if (point !== undefined && shown[point] !== option) return false;
  }
  return true;
}

/**
 * The messages on the shown path, in their order. The same array when nothing
 * is hidden, so a session without forks keeps its identity downstream.
 */
export function filterToShownPath(
  messages: ClaudeMessage[],
  branches: ConversationBranches | null,
  selections: BranchSelections,
): ClaudeMessage[] {
  if (!branches || branches.points.length === 0) return messages;
  const shown = shownOptions(branches, selections);
  const kept = messages.filter((message) => isShown(branches, shown, message.uuid));
  return kept.length === messages.length ? messages : kept;
}

/**
 * Selections under which `uuid` is shown: every fork above it switched to the
 * alternative it sits in. The same object when it is already shown (or not
 * below any fork), so a navigation to a visible message changes nothing.
 */
export function selectionsShowing(
  uuid: string,
  branches: ConversationBranches | null,
  selections: BranchSelections,
): BranchSelections {
  if (!branches || branches.points.length === 0) return selections;
  const shown = shownOptions(branches, selections);
  let next: Record<string, string> | null = null;
  for (const option of optionChain(branches, uuid)) {
    const entry = branches.options[option];
    const point = entry && branches.points[entry.point];
    if (!entry || !point || shown[entry.point] === option) continue;
    next ??= { ...selections };
    next[point.parentUuid] = entry.headUuid;
  }
  return next ?? selections;
}

/**
 * `filterToShownPath` remembering its last answer, so a selector or a cached
 * full-session fetch hands out one array until an input changes.
 */
export function createShownPathFilter(): typeof filterToShownPath {
  let last: {
    messages: ClaudeMessage[];
    branches: ConversationBranches | null;
    selections: BranchSelections;
    result: ClaudeMessage[];
  } | null = null;
  return (messages, branches, selections) => {
    if (last && last.messages === messages && last.branches === branches && last.selections === selections) {
      return last.result;
    }
    const result = filterToShownPath(messages, branches, selections);
    last = { messages, branches, selections, result };
    return result;
  };
}

/** One fork's switcher, as a row shows it. */
export interface BranchSwitch {
  /** The fork's entry: selections are keyed by it. */
  parentUuid: string;
  /** Head uuid of each alternative, in the order they were written. */
  headUuids: string[];
  /** Index of the shown alternative in `headUuids`. */
  position: number;
  /**
   * `after`: below the fork's own message, so switching leaves the row (and
   * the focus on it) where it is. `before`: on the shown alternative's first
   * row, when the fork's message is not on screen (an older page, or an
   * entry the transcript folds away such as a tool result).
   */
  placement: "before" | "after";
}

/**
 * Where each fork's switcher goes, given the uuids of the shown rows in
 * order. Forks inside an alternative that is not shown get none.
 */
export function branchSwitchesByMessage(
  rowUuids: readonly string[],
  branches: ConversationBranches,
  selections: BranchSelections,
): Map<string, BranchSwitch[]> {
  const shown = shownOptions(branches, selections);
  const switches = new Map<string, BranchSwitch[]>();
  const place = (uuid: string, point: number, placement: BranchSwitch["placement"]) => {
    const { parentUuid, optionIds } = branches.points[point]!;
    const entry: BranchSwitch = {
      parentUuid,
      headUuids: optionIds.map((option) => branches.options[option]?.headUuid ?? ""),
      position: Math.max(0, optionIds.indexOf(shown[point]!)),
      placement,
    };
    const existing = switches.get(uuid);
    if (existing) existing.push(entry);
    else switches.set(uuid, [entry]);
  };

  const rows = new Set(rowUuids);
  const placed = new Set<number>();
  branches.points.forEach((point, index) => {
    if (!rows.has(point.parentUuid)) return;
    placed.add(index);
    place(point.parentUuid, index, "after");
  });
  if (placed.size === branches.points.length) return switches;

  for (const uuid of rowUuids) {
    const outerFirst = [...optionChain(branches, uuid)].reverse();
    for (const option of outerFirst) {
      const point = branches.options[option]?.point;
      if (point === undefined || placed.has(point)) continue;
      placed.add(point);
      place(uuid, point, "before");
    }
    if (placed.size === branches.points.length) break;
  }
  return switches;
}
