import type { ClassifiedRow } from "../classifiedRows";
import type { NavigatorEntryData } from "../types";
import {
  countToolUseBlocks,
  isFailedTaskStatus,
  isTurnStart,
  parseTaskNotifications,
} from "../../MessageViewer/helpers/messageKinds";
import {
  LEADING_TURN_KEY,
  type OutlineChildRow,
  type OutlineTaskChild,
  type TurnCounts,
  type TurnGroup,
} from "./types";

function computeCounts(turnRows: ClassifiedRow[]): TurnCounts {
  let replies = 0;
  let toolCalls = 0;
  let agentUpdates = 0;
  const taskIds = new Set<string>();

  for (const row of turnRows) {
    if (row.info.kind === "reply") {
      replies += 1;
      toolCalls += countToolUseBlocks(row.message);
    } else if (row.info.kind === "tool") {
      toolCalls += countToolUseBlocks(row.message);
    } else if (row.info.kind === "agent-update") {
      agentUpdates += 1;
      for (const block of parseTaskNotifications(row.info.text ?? "")) {
        if (block.taskId !== undefined) taskIds.add(block.taskId);
      }
    }
  }

  return { replies, toolCalls, agentsStarted: taskIds.size, agentUpdates };
}

/**
 * Replaces every agent-update row in `childRows` with one row per distinct
 * task id among its `<task-notification>` blocks. A block with no task id
 * never merges with another block, since there is no stable id to merge it
 * by (Design, "One row per agent task").
 */
function buildChildren(childRows: ClassifiedRow[], turnKey: string): OutlineChildRow[] {
  const children: OutlineChildRow[] = [];
  const indexByMergeKey = new Map<string, number>();
  // Each task row's uuids as a set, so collecting them stays linear when one
  // task posts many updates.
  const uuidSetByIndex = new Map<number, Set<string>>();

  for (const row of childRows) {
    if (row.info.kind !== "agent-update") {
      children.push({ type: "message", key: row.entry.uuid, entry: row.entry });
      continue;
    }

    const blocks = parseTaskNotifications(row.info.text ?? "");
    blocks.forEach((block, blockIndex) => {
      const hasTaskId = block.taskId !== undefined;
      const mergeKey = hasTaskId ? `id:${block.taskId}` : `row:${row.entry.uuid}:${blockIndex}`;
      const childKey = hasTaskId
        ? `${turnKey}::task:${block.taskId}`
        : `${turnKey}::task:${row.entry.uuid}:${blockIndex}`;

      const existingIndex = indexByMergeKey.get(mergeKey);
      if (existingIndex === undefined) {
        const task: OutlineTaskChild = {
          type: "task",
          key: childKey,
          taskId: block.taskId,
          label: block.summary || undefined,
          updateCount: 1,
          status: block.status,
          navigateUuid: row.entry.uuid,
          uuids: [row.entry.uuid],
          timestamp: row.entry.timestamp,
        };
        indexByMergeKey.set(mergeKey, children.length);
        uuidSetByIndex.set(children.length, new Set(task.uuids));
        children.push(task);
        return;
      }

      // Later blocks for the same key update the existing row; they never
      // add a new one (Design, "One row per agent task", step 3).
      const existing = children[existingIndex] as OutlineTaskChild;
      if (block.summary) existing.label = block.summary;
      existing.updateCount += 1;
      if (block.status !== undefined) {
        // Any failed status outranks, regardless of position; otherwise the
        // most recent defined status wins (Verified constraints: this
        // diverges from `entryStatus`'s "first status" rule on purpose).
        if (isFailedTaskStatus(block.status) || !isFailedTaskStatus(existing.status)) {
          existing.status = block.status;
        }
      }
      existing.navigateUuid = row.entry.uuid;
      const seen = uuidSetByIndex.get(existingIndex);
      if (seen && !seen.has(row.entry.uuid)) {
        seen.add(row.entry.uuid);
        existing.uuids.push(row.entry.uuid);
      }
      existing.timestamp = row.entry.timestamp;
    });
  }

  return children;
}

function buildTurnGroup(
  turnRows: ClassifiedRow[],
  key: string,
  turnStartUuid: string | null,
  turnNumber: number | null,
  header: NavigatorEntryData | null,
): TurnGroup {
  const firstRow = turnRows[0];
  if (!firstRow) {
    // Every caller passes a non-empty slice (the leading group when
    // non-empty, or a turn's own boundary-to-boundary slice).
    throw new Error("buildTurnGroup requires at least one row");
  }
  // The header, when present, is the turn's first row; children exclude it.
  const childRows = header ? turnRows.slice(1) : turnRows;
  return {
    key,
    turnStartUuid,
    turnNumber,
    header,
    firstUuid: firstRow.entry.uuid,
    counts: computeCounts(turnRows),
    children: buildChildren(childRows, key),
    uuids: turnRows.map((row) => row.entry.uuid),
  };
}

/**
 * Groups a shared, filtered, classified row list into turns. Pure: no React,
 * no store. Boundaries are rows where `isTurnStart(row.info)` is true. Rows
 * before the first boundary (or every row, if there is no boundary at all)
 * form the leading group, omitted when empty.
 */
export function groupTurns(rows: ClassifiedRow[]): TurnGroup[] {
  if (rows.length === 0) return [];

  const boundaryIndices: number[] = [];
  rows.forEach((row, index) => {
    if (isTurnStart(row.info)) boundaryIndices.push(index);
  });

  const groups: TurnGroup[] = [];
  // `??`, not a `.length > 0` ternary: with noUncheckedIndexedAccess, TS
  // still types `boundaryIndices[0]` as `number | undefined` either way, so
  // the fallback has to live in the expression itself.
  const firstBoundary = boundaryIndices[0] ?? rows.length;

  if (firstBoundary > 0) {
    groups.push(
      buildTurnGroup(rows.slice(0, firstBoundary), LEADING_TURN_KEY, null, null, null),
    );
  }

  let turnNumber = 0;
  for (let i = 0; i < boundaryIndices.length; i++) {
    turnNumber += 1;
    const start = boundaryIndices[i];
    const end = i + 1 < boundaryIndices.length ? boundaryIndices[i + 1] : rows.length;
    const turnRows = rows.slice(start, end);
    const headerRow = turnRows[0];
    if (!headerRow) continue; // boundaryIndices are valid, strictly increasing indices; never empty
    groups.push(
      buildTurnGroup(turnRows, headerRow.entry.uuid, headerRow.entry.uuid, turnNumber, headerRow.entry),
    );
  }

  return groups;
}
