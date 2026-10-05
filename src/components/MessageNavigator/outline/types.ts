import type { NavigatorEntryData } from "../types";

/** Counts shown on a closed turn's header: a zero count is omitted by the UI, not shown as zero. */
export interface TurnCounts {
  replies: number;
  toolCalls: number;
  agentsStarted: number;
  agentUpdates: number;
}

/** A plain row inside an open turn, carrying its already-built navigator entry. */
export interface OutlineMessageChild {
  type: "message";
  key: string;
  entry: NavigatorEntryData;
}

/** One row per distinct agent task, replacing its individual notification rows. */
export interface OutlineTaskChild {
  type: "task";
  key: string;
  taskId: string | undefined;
  /** Last non-empty summary across the task's blocks. */
  label: string | undefined;
  /** Number of notification BLOCKS, not rows: one row can hold several blocks. */
  updateCount: number;
  /** Any failed status (isFailedTaskStatus) outranks; else the most recent defined status. */
  status: string | undefined;
  /** uuid of the row holding the task's LAST block. */
  navigateUuid: string;
  /** timestamp of that last row. */
  timestamp: string;
}

export type OutlineChildRow = OutlineMessageChild | OutlineTaskChild;

export interface TurnGroup {
  /** turnStartUuid, or LEADING_TURN_KEY for the leading group. */
  key: string;
  turnStartUuid: string | null;
  /** 1-based among real turns in the loaded window; null for the leading group. */
  turnNumber: number | null;
  /** The turn-start row's entry; null for the leading group. */
  header: NavigatorEntryData | null;
  /** First row of the group. */
  firstUuid: string;
  counts: TurnCounts;
  /** EXCLUDES the turn-start row itself (the header represents it). */
  children: OutlineChildRow[];
  /** Every row uuid in the group, header included, in order. */
  uuids: string[];
}

export const LEADING_TURN_KEY = "outline-leading";
