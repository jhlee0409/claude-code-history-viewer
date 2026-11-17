import type { FlattenedMessage, FlattenedMessageItem } from "../MessageViewer/types";
import type { ToolOutcome } from "./toolOutcome";
import { turnStartKinds, type TurnStartKind } from "./isTurnStart";
import { codexAutomatedTurns, codexTurnId } from "./codexTurns";
import { transcriptBlocks } from "./transcriptBlocks";
import { rowVisibility, visibleTranscriptBlocks } from "./sourceVisibility";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";
import type { BlockRender } from "./sourceEnvelope";

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
  render: BlockRender;
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
  /** Unknown when a partial loaded window contains no canonical start evidence. */
  kind: TurnStartKind | "unknown";
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
  /** Snapshot of the entry-filter policy; cached visible rows cannot cross policies. */
  visibilityKey?: string;
  items: readonly TranscriptItem[];
  turns: readonly TranscriptTurn[];
  messageToItemIndexes: ReadonlyMap<string, readonly number[]>;
  messageToFirstBlockId: ReadonlyMap<string, string>;
  blockToItemIndex: ReadonlyMap<string, number>;
  blocks: ReadonlyMap<string, TranscriptBlock>;
  runByBlockId: ReadonlyMap<string, ToolRun>;
  /** Expansion is retained by every run member, not just its first block. */
  expandedBlockIds: ReadonlySet<string>;
}
export interface TranscriptOptions {
  /** Same assistant content filters as production; input rows retain full source evidence. */
  contentTypes?: MessageFilterContentTypes;
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
  const sourceId = "blockId" in target ? target.blockId : target.contentIndex === undefined
    ? model.messageToFirstBlockId.get(target.messageUuid) : `${target.messageUuid}#${target.contentIndex}`;
  if (sourceId === undefined) return null;
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

type DisplayEntry = TranscriptBlock | ToolRun;
function fragment(entries: readonly DisplayEntry[], options: TranscriptOptions): DisplayEntry[][] {
  const parts: DisplayEntry[][] = [];
  let part: DisplayEntry[] = [];
  let height = 0;
  const limit = (options.viewportHeight ?? Number.POSITIVE_INFINITY) * 3;
  for (const entry of entries) {
    const block = entry.kind === "toolRun" ? entry.blocks[0]! : entry;
    const estimate = options.estimateBlockHeight?.(block) ?? 0;
    if (part.length > 0 && (part.length >= 24 || height + estimate > limit)) {
      parts.push(part);
      part = [];
      height = 0;
    }
    part.push(entry);
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
  const messageToFirstBlockId = new Map<string, string>();
  const blockToItemIndex = new Map<string, number>();
  const blocks = new Map<string, TranscriptBlock>();
  const runByBlockId = new Map<string, ToolRun>();
  const expandedBlockIds = new Set(options.expandedBlockIds ?? options.previous?.expandedBlockIds);
  const aliases = new Map<string, string>();
  for (const row of flattened) {
    if (row.type === "message" && rowVisibility(row, options.inSubagent) === "member" && row.groupLeaderUuid) {
      aliases.set(row.message.uuid, row.groupLeaderUuid);
    }
  }
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
  const visibilityKey = JSON.stringify([options.contentTypes?.text ?? true, options.contentTypes?.thinking ?? true, options.contentTypes?.commands ?? true, options.contentTypes?.toolCalls ?? true]);
  const projectedRows = new Map<string, readonly TranscriptBlock[]>();
  const blocksForRow = (row: FlattenedMessageItem): readonly TranscriptBlock[] => {
    const projected = projectedRows.get(row.message.uuid);
    if (projected) return projected;
    const cached = priorRows.get(row.message.uuid);
    const source = cached?.[0]?.source;
    const same = options.previous?.visibilityKey === visibilityKey && source && rendererSignature(row) === rendererSignature(source);
    const result = same ? cached! : visibleTranscriptBlocks(transcriptBlocks(row), options.contentTypes);
    projectedRows.set(row.message.uuid, result);
    return result;
  };
  const automatedUuids = codexAutomatedTurns(flattened.flatMap(row => row.type === "message" ? [row.message] : [])).uuids;
  const boundaryKinds = turnStartKinds(flattened.flatMap(row => row.type === "message" ? [row.message] : []), { inSubagent: options.inSubagent ?? false });
  const starts = new Map(options.turnStartUuids);
  const startKinds = new Map<number, TurnStartKind>();
  for (const row of flattened) {
    if (row.type !== "message") continue;
    const ordinal = membership.get(row.message.uuid);
    const kind = boundaryKinds.get(row.message.uuid) ?? null;
    if (ordinal != null && kind !== null) {
      if (!starts.has(ordinal)) starts.set(ordinal, row.message.uuid);
      if (starts.get(ordinal) === row.message.uuid) startKinds.set(ordinal, kind);
    }
  }
  let current: { ordinal: number | null; rows: FlattenedMessageItem[] } | null = null;
  const flush = () => {
    if (!current) return;
    const first = current.rows[0]!;
    const turnBlocks = current.rows.flatMap(blocksForRow);
    const id = `turn:${(current.ordinal === null ? undefined : starts.get(current.ordinal)) ?? first.message.uuid}`;
    const partial = (!boundaryKinds.has(first.message.uuid) && !automatedUuids.has(first.message.uuid)) || (current.ordinal !== null && starts.has(current.ordinal) && starts.get(current.ordinal) !== first.message.uuid);
    const firstKind = boundaryKinds.get(first.message.uuid) ?? (automatedUuids.has(first.message.uuid) ? "automated" : undefined);
    const kind = (current.ordinal === null ? firstKind : startKinds.get(current.ordinal)) ?? "unknown";
    const prior = priorTurns.get(`${id}:${turnBlocks[0]?.id}`);
    const unchanged = prior?.kind === kind && prior.ordinal === current.ordinal && prior.partial === partial && prior.blocks.length === turnBlocks.length && prior.blocks.every((block, index) => block === turnBlocks[index]);
    const turn: TranscriptTurn = unchanged ? prior : { kind, id, ordinal: current.ordinal, partial, blocks: turnBlocks, summary: summarize(turnBlocks) };
    turns.push(turn);
    const folded = fold(turnBlocks, runByBlockId);
    for (const run of folded) if (run.kind === "toolRun") {
      const retained = run.blocks.some(block => block.sourceBlockIds.some(id => expandedBlockIds.has(id)));
      const revealed = (options.revealTargets ?? []).some(target => run.blocks.some(block =>
        "blockId" in target ? block.sourceBlockIds.includes(target.blockId) : block.messageUuid === target.messageUuid &&
        (target.contentIndex === undefined || block.sourceBlockIds.includes(`${target.messageUuid}#${target.contentIndex}`))));
      run.expanded = options.captureMode === true || retained || revealed;
      if (retained || revealed) for (const block of run.blocks) for (const id of block.sourceBlockIds) expandedBlockIds.add(id);
    }
    const displayed = folded.flatMap(entry => entry.kind === "toolRun" && entry.expanded ? [...entry.blocks] : [entry]);
    const parts = fragment(displayed, options);
    for (const [part, partEntries] of parts.entries()) {
      const partBlocks = partEntries.flatMap(entry => entry.kind === "toolRun" ? [...entry.blocks] : [entry]);
      const itemIndex = items.length;
      items.push({ kind: "turn", id: `${id}:${partBlocks[0]!.id}`, turn, turnStart: part === 0 ? { kind: "turnStart", partial: turn.partial } : null, blocks: partBlocks, entries: partEntries, part: part + 1, parts: parts.length, posinset: 0, setsize: -1 });
      for (const block of partBlocks) {
        if (!messageToFirstBlockId.has(block.messageUuid)) messageToFirstBlockId.set(block.messageUuid, block.id);
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
  let previousProducerTurn: string | undefined;
  for (const row of flattened) {
    if (row.type !== "message") {
      flush();
      items.push({ kind: row.type === "date-divider" ? "date-divider" : "hidden", id: row.type === "date-divider" ? `date:${row.timestamp}` : `hidden:${row.hiddenUuids[0]}`, source: row });
      continue;
    }
    if (rowVisibility(row, options.inSubagent) !== "visible") continue;
    if (blocksForRow(row).length === 0) continue;
    const ordinal = membership.get(row.message.uuid) ?? null;
    const producerTurn = codexTurnId(row.message);
    // The loaded progress row already owns this automated producer cycle. Its
    // first visible context/heartbeat is the outline header, not a second turn.
    const sameAutomatedCycle = producerTurn !== undefined && producerTurn === previousProducerTurn
      && automatedUuids.has(row.message.uuid) && current !== null
      && automatedUuids.has(current.rows[0]!.message.uuid);
    const startsTemporary = ordinal === null && boundaryKinds.has(row.message.uuid) && !sameAutomatedCycle;
    const newProducerTurn = producerTurn !== undefined && previousProducerTurn !== undefined && producerTurn !== previousProducerTurn;
    const entersAutomatedCycle = automatedUuids.has(row.message.uuid) && current !== null && !automatedUuids.has(current.rows[0]!.message.uuid);
    if (current && (current.ordinal !== ordinal || startsTemporary || (ordinal === null && (newProducerTurn || entersAutomatedCycle)))) flush();
    previousProducerTurn = producerTurn;
    current ??= { ordinal, rows: [] };
    current.rows.push(row);
  }
  flush();
  // Date/hidden separators remain in source order as physical chunk boundaries,
  // but cannot turn one known automated producer cycle into multiple turns.
  const cycles = new Map<string, TranscriptTurn[]>();
  for (const turn of turns) {
    const message = turn.blocks[0]?.source.message;
    const producer = message && codexTurnId(message);
    if (turn.kind !== "automated" || !producer) continue;
    const key = JSON.stringify([message.sessionId, producer, turn.ordinal]);
    const segments = cycles.get(key) ?? [];
    segments.push(turn); cycles.set(key, segments);
  }
  const merged = new Map<TranscriptTurn, TranscriptTurn>();
  for (const segments of cycles.values()) {
    if (segments.length < 2) continue;
    const blocks = segments.flatMap(turn => turn.blocks);
    const turn = { ...segments[0]!, blocks, summary: summarize(blocks) };
    for (const segment of segments) merged.set(segment, turn);
  }
  if (merged.size) {
    const logical = [...new Set(turns.map(turn => merged.get(turn) ?? turn))];
    turns.splice(0, turns.length, ...logical);
    const physical = new Map<TranscriptTurn, TurnChunk[]>();
    for (const item of items) if (item.kind === "turn") {
      item.turn = merged.get(item.turn) ?? item.turn;
      const parts = physical.get(item.turn) ?? [];
      parts.push(item); physical.set(item.turn, parts);
    }
    for (const parts of physical.values()) parts.forEach((chunk, index) => {
      chunk.part = index + 1; chunk.parts = parts.length;
      chunk.turnStart = index === 0 ? { kind: "turnStart", partial: chunk.turn.partial } : null;
    });
  }
  const chunks = items.filter((item): item is TurnChunk => item.kind === "turn");
  chunks.forEach((chunk, index) => { chunk.posinset = index + 1; chunk.setsize = options.complete ? chunks.length : -1; });
  for (const [member, leader] of aliases) {
    const indexes = messageToItemIndexes.get(leader);
    const firstId = messageToFirstBlockId.get(leader);
    const block = firstId === undefined ? undefined : blocks.get(firstId);
    if (!indexes || !block) continue;
    messageToItemIndexes.set(member, [...indexes]);
    messageToFirstBlockId.set(member, block.id);
    blocks.set(`${member}#0`, block);
    blockToItemIndex.set(`${member}#0`, indexes[0]!);
  }
  const model: TranscriptModel = { items, turns, messageToItemIndexes, messageToFirstBlockId, blockToItemIndex, blocks, runByBlockId, expandedBlockIds, visibilityKey };
  return model;
}
