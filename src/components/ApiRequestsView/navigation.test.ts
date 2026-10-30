import { describe, expect, it } from "vitest";
import type { ApiRequest, SourceLine } from "@/types/apiView.types";
import { buildLinks } from "./navigation";
import { sameAsMessages } from "./timeline";

const base: ApiRequest = {
  id: "",
  line: null,
  timestamp: null,
  query_source: null,
  shape_hash: null,
  base: null,
  params: null,
  cache_control: null,
  keep: 0,
  total_messages: 0,
  new_messages: [],
  response: null,
  inputs: [],
};

const toolResultLine: SourceLine = {
  line: 8,
  uuid: null,
  kind: "user:tool_result",
  label: null,
  timestamp: null,
  preview: "",
  content: [],
  record: false,
  tool_use_id: "toolu_1",
  in_request: true,
  found_in: 2,
};

const calling: ApiRequest = {
  ...base,
  id: "R1",
  response: {
    request_id: null,
    message_ids: [],
    lines: [6, 7],
    uuids: [],
    timestamp: null,
    model: null,
    stop_reason: null,
    usage: null,
    content: [{ type: "thinking" }, { type: "tool_use", id: "toolu_1", name: "Bash" }],
  },
};

const answering: ApiRequest = {
  ...base,
  id: "R2",
  inputs: [toolResultLine],
  new_messages: [
    { index: 1, role: "assistant", content: [], source: { kind: "lines", lines: [6, 7] } },
    { index: 2, role: "user", content: [], source: { kind: "lines", lines: [8] } },
    { index: 3, role: "user", content: [], source: { kind: "blob", line: 12 } },
  ],
};

describe("buildLinks", () => {
  it("ties a tool call to the request that made it and the one that sent its result", () => {
    const links = buildLinks({ recorded: true, line_count: 20, shapes: [], requests: [calling, answering], unattributed: [] });
    expect(links.toolUses.get("toolu_1")).toEqual({ requestId: "R1", number: 1, name: "Bash" });
    expect(links.toolResults.get("toolu_1")).toEqual({ requestId: "R2", number: 2, line: 8 });
    expect(links.responses.get(6)).toEqual({ requestId: "R1", number: 1 });
  });
});

describe("sameAsMessages", () => {
  it("maps only single-line messages to their line", () => {
    expect([...sameAsMessages(answering)]).toEqual([[8, 2]]);
  });
});
