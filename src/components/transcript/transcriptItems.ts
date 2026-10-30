import type { FlattenedMessage, FlattenedMessageItem } from "../MessageViewer/types";
import type { ToolOutcome } from "./toolOutcome";
import { isTurnStart } from "./isTurnStart";
import { transcriptBlocks } from "./transcriptBlocks";

/** EV1a lookup hits projected to uuid → ordinal; absent/null is unknown, never inherited. */
export type TurnMembership = ReadonlyMap<string, number | null>;
export interface TranscriptBlock {
  id: string;
  messageUuid: string;
  contentIndex: number;
  /** Includes paired-result source positions, which navigate to their owning row. */
  sourceBlockIds: readonly string[];
  kind: "prose" | "toolRow" | "notice" | "checklist" | "fallback";
  /** Position-free renderer data; item indexes belong to this model's lookup tables. */
  source: Omit<FlattenedMessageItem, "originalIndex">;
  value: unknown;
  outcome?: ToolOutcome;
  foldable: boolean;
  file?: string;
}
export interface ToolRun {
  kind: "toolRun";
  id: string;
  blocks: readonly TranscriptBlock[];
  expanded: boolean;
}
export interface TurnSummary { tools: number; files: number; failed: number; unverified: number }
export interface TranscriptTurn {
  id: string;
  ordinal: number | null;
  partial: boolean;
  blocks: readonly TranscriptBlock[];
  summary: TurnSummary;
}
export interface TurnChunk {
  kind: "turn";
  id: string;
  turn: TranscriptTurn;
  /** The first fragment owns the visible turnStart; all fragments retain the turn metadata. */
  turnStart: { kind: "turnStart"; partial: boolean } | null;
  blocks: readonly TranscriptBlock[];
  entries: readonly (TranscriptBlock | ToolRun)[];
  part: number;
  parts: number;
  posinset: number;
  setsize: number;
}
export type TranscriptItem = TurnChunk | { kind: "date-divider" | "hidden"; id: string; source: Exclude<FlattenedMessage, FlattenedMessageItem> };
export interface TranscriptModel {
  items: readonly TranscriptItem[];
  turns: readonly TranscriptTurn[];
  messageToItemIndexes: ReadonlyMap<string, readonly number[]>;
  blockToItemIndex: ReadonlyMap<string, number>;
  blocks: ReadonlyMap<string, TranscriptBlock>;
  runByBlockId: ReadonlyMap<string, ToolRun>;
  /** Expansion is retained by every run member, not just its first block. */
  expandedBlockIds: ReadonlySet<string>;
}
export interface TranscriptOptions {
  inSubagent?: boolean;
  /** Canonical start UUIDs from the turn index; lookup hits alone do not contain these. */
  turnStartUuids?: ReadonlyMap<number, string>;
  previous?: TranscriptModel;
  expandedBlockIds?: ReadonlySet<string>;
  captureMode?: boolean;
  revealTargets?: readonly TranscriptTarget[];
  complete?: boolean;
  viewportHeight?: number;
  estimateBlockHeight?: (block: TranscriptBlock) => number;
}
export type TranscriptTarget = { messageUuid: string; contentIndex?: number } | { blockId: string };
export interface TargetLocation { itemIndex: number; blockId: string; expandBlockIds: readonly string[] }

/** The only public target-resolution entry; callers apply expansion before scrolling. */
export function itemIndexForTarget(model: TranscriptModel, target: TranscriptTarget): TargetLocation | null {
  const sourceId = "blockId" in target ? target.blockId : `${target.messageUuid}#${target.contentIndex ?? 0}`;
  const itemIndex = model.blockToItemIndex.get(sourceId);
  const block = model.blocks.get(sourceId);
  if (itemIndex === undefined || !block) return null;
  const run = model.runByBlockId.get(sourceId);
  return { itemIndex, blockId: block.id, expandBlockIds: run && !run.expanded ? run.blocks.flatMap(b => b.sourceBlockIds) : [] };
}

function summarize(blocks: readonly TranscriptBlock[]): TurnSummary {
  const tools = blocks.filter(b => b.kind === "toolRow");
  return {
    tools: tools.length,
    files: new Set(tools.flatMap(b => b.file === undefined ? [] : [b.file])).size,
    failed: tools.filter(b => b.outcome?.verdict === "failed").length,
    unverified: tools.filter(b => b.outcome?.verdict === "unknown").length,
  };
}

function fragment(blocks: readonly TranscriptBlock[], options: TranscriptOptions): TranscriptBlock[][] {
  const parts: TranscriptBlock[][] = [];
  let part: TranscriptBlock[] = [];
  let height = 0;
  const limit = (options.viewportHeight ?? Number.POSITIVE_INFINITY) * 3;
  for (const block of blocks) {
    const estimate = options.estimateBlockHeight?.(block) ?? 0;
    if (part.length > 0 && (part.length >= 24 || height + estimate > limit)) {
      parts.push(part);
      part = [];
      height = 0;
    }
    part.push(block);
    height += estimate;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

function fold(blocks: readonly TranscriptBlock[], runByBlockId: Map<string, ToolRun>): (TranscriptBlock | ToolRun)[] {
  const entries: (TranscriptBlock | ToolRun)[] = [];
  for (let i = 0; i < blocks.length;) {
    const first = blocks[i]!;
    let end = i + 1;
    if (first.foldable) while (end < blocks.length && blocks[end]!.foldable) end++;
    if (end - i >= 2) {
      const run: ToolRun = { kind: "toolRun", id: `run:${first.id}`, blocks: blocks.slice(i, end), expanded: false };
      entries.push(run);
      for (const block of run.blocks) for (const id of block.sourceBlockIds) runByBlockId.set(id, run);
    } else entries.push(first);
    i = end;
  }
  return entries;
}

/** Build-local structural identity: object/map key order is not content; array order is. */
function createRendererSignature() {
  const registryIds = new WeakMap<Map<unknown, unknown>, number>();
  const registryContents = new Map<string, number>();
  const contentSignature = (value: unknown): string => {
    if (value === null || typeof value !== "object") return typeof value === "string" ? JSON.stringify(value) : String(value);
    if (Array.isArray(value)) return `[${value.map(contentSignature).join(",")}]`;
    if (value instanceof Map) {
      let id = registryIds.get(value);
      if (id === undefined) {
        const signature = [...value].map(([key, item]) => `[${contentSignature(key)},${contentSignature(item)}]`).sort().join(",");
        id = registryContents.get(signature);
        if (id === undefined) {
          id = registryContents.size;
          registryContents.set(signature, id);
        }
        registryIds.set(value, id);
      }
      // Intern by complete content, not a hash. A small token also avoids copying and
      // comparing the full shared registry string once per leader. Rescan each build.
      return `map:${id}`;
    }
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${contentSignature(item)}`).join(",")}}`;
  };
  return (source: Omit<FlattenedMessageItem, "originalIndex">): string => {
    // Only the top-level display position is excluded; recorded nested data stays significant.
    return contentSignature(Object.fromEntries(Object.entries(source).filter(([key]) => key !== "originalIndex")));
  };
}

export function buildTranscriptItems(flattened: readonly FlattenedMessage[], membership: TurnMembership, options: TranscriptOptions = {}): TranscriptModel {
  const items: TranscriptItem[] = [];
  const turns: TranscriptTurn[] = [];
  const messageToItemIndexes = new Map<string, number[]>();
  const blockToItemIndex = new Map<string, number>();
  const blocks = new Map<string, TranscriptBlock>();
  const runByBlockId = new Map<string, ToolRun>();
  // Input scanning stays linear (the lookup maps must cover every loaded block).
  // Extraction, pairing, outcomes and summaries are reused outside changed boundaries.
  const priorRows = new Map<string, TranscriptBlock[]>();
  const priorTurns = new Map<string, TranscriptTurn>();
  for (const turn of options.previous?.turns ?? []) {
    priorTurns.set(`${turn.id}:${turn.blocks[0]?.id}`, turn);
    for (const block of turn.blocks) {
      const cached = priorRows.get(block.messageUuid) ?? [];
      cached.push(block);
      priorRows.set(block.messageUuid, cached);
    }
  }
  const rendererSignature = createRendererSignature();
  const blocksForRow = (row: FlattenedMessageItem): readonly TranscriptBlock[] => {
    const cached = priorRows.get(row.message.uuid);
    const source = cached?.[0]?.source;
    const same = source && rendererSignature(row) === rendererSignature(source);
    return same ? cached! : transcriptBlocks(row);
  };
  const starts = new Map(options.turnStartUuids);
  for (const row of flattened) {
    if (row.type !== "message") continue;
    const ordinal = membership.get(row.message.uuid);
    if (ordinal != null && !starts.has(ordinal) && isTurnStart(row.message, { inSubagent: options.inSubagent ?? false })) starts.set(ordinal, row.message.uuid);
  }
  let current: { ordinal: number | null; rows: FlattenedMessageItem[] } | null = null;
  const flush = () => {
    if (!current) return;
    const first = current.rows[0]!;
    const turnBlocks = current.rows.flatMap(blocksForRow);
    const id = `turn:${(current.ordinal === null ? undefined : starts.get(current.ordinal)) ?? first.message.uuid}`;
    const partial = !isTurnStart(first.message, { inSubagent: options.inSubagent ?? false }) || (current.ordinal !== null && starts.has(current.ordinal) && starts.get(current.ordinal) !== first.message.uuid);
    const prior = priorTurns.get(`${id}:${turnBlocks[0]?.id}`);
    const unchanged = prior?.ordinal === current.ordinal && prior.partial === partial && prior.blocks.length === turnBlocks.length && prior.blocks.every((block, index) => block === turnBlocks[index]);
    const turn: TranscriptTurn = unchanged ? prior : { id, ordinal: current.ordinal, partial, blocks: turnBlocks, summary: summarize(turnBlocks) };
    turns.push(turn);
    const parts = fragment(turnBlocks, options);
    for (const [part, partBlocks] of parts.entries()) {
      const itemIndex = items.length;
      items.push({ kind: "turn", id: `${id}:${partBlocks[0]!.id}`, turn, turnStart: part === 0 ? { kind: "turnStart", partial: turn.partial } : null, blocks: partBlocks, entries: fold(partBlocks, runByBlockId), part: part + 1, parts: parts.length, posinset: 0, setsize: -1 });
      for (const block of partBlocks) {
        for (const sourceId of block.sourceBlockIds) {
          blocks.set(sourceId, block);
          blockToItemIndex.set(sourceId, itemIndex);
        }
        const indexes = messageToItemIndexes.get(block.messageUuid) ?? [];
        if (!indexes.includes(itemIndex)) indexes.push(itemIndex);
        messageToItemIndexes.set(block.messageUuid, indexes);
      }
    }
    current = null;
  };
  for (const row of flattened) {
    if (row.type !== "message") {
      flush();
      items.push({ kind: row.type === "date-divider" ? "date-divider" : "hidden", id: row.type === "date-divider" ? `date:${row.timestamp}` : `hidden:${row.hiddenUuids[0]}`, source: row });
      continue;
    }
    const ordinal = membership.get(row.message.uuid) ?? null;
    const startsTemporary = ordinal === null && isTurnStart(row.message, { inSubagent: options.inSubagent ?? false });
    if (current && (current.ordinal !== ordinal || startsTemporary)) flush();
    current ??= { ordinal, rows: [] };
    current.rows.push(row);
  }
  flush();
  const chunks = items.filter((item): item is TurnChunk => item.kind === "turn");
  chunks.forEach((chunk, index) => { chunk.posinset = index + 1; chunk.setsize = options.complete ? chunks.length : -1; });
  const expandedBlockIds = new Set(options.expandedBlockIds ?? options.previous?.expandedBlockIds);
  const model: TranscriptModel = { items, turns, messageToItemIndexes, blockToItemIndex, blocks, runByBlockId, expandedBlockIds };
  for (const target of options.revealTargets ?? []) {
    for (const id of itemIndexForTarget(model, target)?.expandBlockIds ?? []) expandedBlockIds.add(id);
  }
  for (const run of new Set(runByBlockId.values())) {
    const retainedExpansion = run.blocks.some(block => block.sourceBlockIds.some(id => expandedBlockIds.has(id)));
    run.expanded = options.captureMode === true || retainedExpansion;
    if (retainedExpansion) for (const block of run.blocks) for (const id of block.sourceBlockIds) expandedBlockIds.add(id);
  }
  return model;
}
