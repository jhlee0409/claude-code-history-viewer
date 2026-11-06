import { describe, expect, it } from "vitest";
import type { ApiRequest, ApiView, SourceLine } from "@/types/apiView.types";
import { buildTimeline, cacheBreakpoints, inferredNotice, requestAnchor, usageSummary } from "./timeline";
import { previewHeadline } from "./format";

const line = (n: number): SourceLine => ({
  line: n,
  uuid: null,
  kind: "mode",
  label: null,
  timestamp: null,
  preview: "",
  in_request: null,
});

const request = (id: string, at: number, shape: string | null = null): ApiRequest => ({
  id,
  line: at,
  timestamp: null,
  query_source: null,
  shape_hash: shape,
  base: null,
  params: null,
  cache_control: null,
  keep: 0,
  total_messages: 0,
  new_messages: [],
  response: null,
  inputs: [],
});

const view = (requests: ApiRequest[], unattributed: SourceLine[]): ApiView => ({
  recorded: true,
  line_count: 100,
  shapes: [],
  requests,
  unattributed,
});

describe("buildTimeline", () => {
  it("places loose lines between the requests they were written between", () => {
    const items = buildTimeline(view([request("a", 10), request("b", 20)], [line(3), line(12), line(15), line(40)]));
    expect(
      items.map((item) => (item.kind === "request" ? item.request.id : item.lines.map((l) => l.line).join(",")))
    ).toEqual(["3", "a", "12,15", "b", "40"]);
  });

  it("marks the request where the shape changes", () => {
    const items = buildTimeline(view([request("a", 1, "s1"), request("b", 2, "s1"), request("c", 3, "s2")], []));
    expect(items.map((item) => item.kind === "request" && item.shapeChanged)).toEqual([true, false, true]);
  });

  it("numbers requests in recorded order", () => {
    const items = buildTimeline(view([request("a", 5), request("b", 9)], []));
    expect(items.map((item) => item.kind === "request" && item.number)).toEqual([1, 2]);
  });
});

describe("requestAnchor", () => {
  it("places an inferred request at its first input, not its response", () => {
    const inferred: ApiRequest = {
      ...request("r", 0),
      line: null,
      inputs: [line(10)],
      response: {
        request_id: "r",
        message_ids: [],
        lines: [12],
        uuids: [],
        timestamp: null,
        model: null,
        stop_reason: null,
        usage: null,
        content: [],
      },
    };
    expect(requestAnchor(inferred)).toBe(10);
  });
});

describe("inferredNotice", () => {
  it("tells a fully inferred view from a partly inferred one", () => {
    expect(inferredNotice({ ...view([request("a", 1)], []), recorded: false })).toBe("messageViewer.apiView.inferred");
    expect(inferredNotice(view([{ ...request("a", 1), line: null }, request("b", 5)], []))).toBe(
      "messageViewer.apiView.inferredPartial"
    );
    expect(inferredNotice(view([request("b", 5)], []))).toBeNull();
  });
});

describe("cacheBreakpoints", () => {
  it("keeps only message content paths", () => {
    const keys = cacheBreakpoints([
      { path: ["system", 1], value: {} },
      { path: ["messages", 22, "content", 0], value: {} },
    ]);
    expect([...keys]).toEqual(["22:0"]);
  });

  it("skips entries that are not objects", () => {
    const keys = cacheBreakpoints([null, 3, { path: ["messages", 1, "content", 0] }]);
    expect([...keys]).toEqual(["1:0"]);
  });
});

describe("usageSummary", () => {
  it("reads the token counters and tolerates missing usage", () => {
    expect(usageSummary({ input_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, output_tokens: 9 }))
      .toEqual({ input: 2, cacheRead: 5, cacheWrite: 7, output: 9 });
    expect(usageSummary(null)).toBeNull();
  });
});

describe("previewHeadline", () => {
  it("skips bare wrapper tags", () => {
    expect(previewHeadline("<system-reminder>\n<total_tokens>5 left</total_tokens>\n</system-reminder>")).toBe(
      "<total_tokens>5 left</total_tokens>"
    );
    expect(previewHeadline('<system-reminder id="x">\n\nhello')).toBe("hello");
    expect(previewHeadline("")).toBe("");
  });
});
