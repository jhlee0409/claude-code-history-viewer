import { expect, it } from "vitest";
import { legacyOwnership } from "@/components/MessageViewer/helpers/sourceEnvelopeOwnership";
import { hasToolResult, hasToolUse } from "@/utils/typeGuards";
import type { ClaudeMessage } from "@/types";

it.each(["assistant", "user"])("ignores null raw content when resolving %s envelope ownership", type => {
  const message = { type, content: [null], toolUse: { name: "Read" }, toolUseResult: "result" } as unknown as ClaudeMessage;
  expect(legacyOwnership(message)).toEqual({ value: "result", call: type === "assistant", result: true });
  const structured = { ...message, content: [null, { type: "tool_use", id: "call" }, { type: "tool_result", tool_use_id: "call" }] } as unknown as ClaudeMessage;
  expect(legacyOwnership(structured)).toEqual({ value: "result", call: false, result: false });
});

it("ignores null entries on sibling raw-content scans", () => {
  const message = { type: "assistant", content: [null, { type: "tool_use", id: "call" }, { type: "tool_result", tool_use_id: "call" }] } as unknown as ClaudeMessage;
  expect(hasToolUse(message)).toBe(true);
  expect(hasToolResult(message)).toBe(true);
});
