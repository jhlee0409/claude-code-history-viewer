import type { ApiRequest, ApiView, SourceLine } from "@/types/apiView.types";

export type TimelineItem =
  | { kind: "request"; request: ApiRequest; number: number; shapeChanged: boolean }
  | { kind: "loose"; lines: SourceLine[] };

/**
 * The line a request sits at in the file: its record, or for an inferred
 * request the first line that fed it, which precedes its response.
 */
export function requestAnchor(request: ApiRequest): number {
  return (
    request.line ??
    request.inputs[0]?.line ??
    request.response?.lines[0] ??
    Number.MAX_SAFE_INTEGER
  );
}

/**
 * Requests in file order, with the lines that belong to no request placed
 * as runs between the requests they were written between.
 */
export function buildTimeline(view: ApiView): TimelineItem[] {
  const requests = view.requests
    .map((request, i) => ({ request, number: i + 1, anchor: requestAnchor(request) }))
    .sort((a, b) => a.anchor - b.anchor);
  const items: TimelineItem[] = [];
  let loose = 0;
  let previousShape: string | null = null;
  const flushLooseBefore = (anchor: number) => {
    const run: SourceLine[] = [];
    while (loose < view.unattributed.length && view.unattributed[loose]!.line < anchor) {
      run.push(view.unattributed[loose]!);
      loose += 1;
    }
    if (run.length > 0) items.push({ kind: "loose", lines: run });
  };
  for (const { request, number, anchor } of requests) {
    flushLooseBefore(anchor);
    const shapeChanged = request.shape_hash != null && request.shape_hash !== previousShape;
    if (request.shape_hash != null) previousShape = request.shape_hash;
    items.push({ kind: "request", request, number, shapeChanged });
  }
  flushLooseBefore(Number.MAX_SAFE_INTEGER);
  return items;
}

/**
 * Lines that are one of the request's messages verbatim (a user line the
 * request sent as is), by line number → message index.
 */
export function sameAsMessages(request: ApiRequest): Map<number, number> {
  const same = new Map<number, number>();
  for (const message of request.new_messages) {
    if (message.source.kind === "lines" && message.source.lines.length === 1) {
      same.set(message.source.lines[0]!, message.index);
    }
  }
  return same;
}

/** The notice to show when some or all requests were inferred. */
export function inferredNotice(
  view: ApiView
): "messageViewer.apiView.inferred" | "messageViewer.apiView.inferredPartial" | null {
  if (!view.recorded) return "messageViewer.apiView.inferred";
  return view.requests.some((r) => r.line == null) ? "messageViewer.apiView.inferredPartial" : null;
}

/** Cache breakpoints as "messageIndex:blockIndex" keys. */
export function cacheBreakpoints(cacheControl: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(cacheControl)) return keys;
  for (const entry of cacheControl) {
    if (entry == null || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (Array.isArray(path) && path[0] === "messages" && path[2] === "content") {
      keys.add(`${String(path[1])}:${String(path[3])}`);
    }
  }
  return keys;
}

export interface UsageSummary {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export function usageSummary(usage: unknown): UsageSummary | null {
  if (usage == null || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const n = (key: string) => (typeof u[key] === "number" ? (u[key] as number) : 0);
  return {
    input: n("input_tokens"),
    cacheRead: n("cache_read_input_tokens"),
    cacheWrite: n("cache_creation_input_tokens"),
    output: n("output_tokens"),
  };
}
