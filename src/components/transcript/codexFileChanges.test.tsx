import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ClaudeContentArrayRenderer } from "../contentRenderer/ClaudeContentArrayRenderer";
import { CodexFileChangeProvider } from "./CodexFileChanges";
import { assistant } from "./transcriptItems.fixtures";
import type { ClaudeMessage } from "@/types";
import { unifiedSections } from "./codexFileChangeModel";

const patch = "*** Begin Patch\n*** Update File: a.ts\n@@\n-input-old\n+input-new\n*** End Patch";
const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -41,2 +51,2 @@\n keep\n-producer-old\n+producer-new\n";
const call = assistant("call", [{ type: "tool_use", id: "patch-id", name: "apply_patch", input: { patch } }]);
const turn = { started: { turn_id: "t" }, context: { turn_id: "t" } };
const event = { timestamp: "2026-01-01T00:00:00Z", type: "event_msg", payload: { type: "item_completed", turn_id: "t", item: { type: "FileChange", id: "patch-id", status: "completed", changes: { "a.ts": { type: "update", unified_diff: diff, move_path: null } } } } };
const messages: ClaudeMessage[] = [{ ...call, provider: "codex", codexEvidence: { turn } }, { ...assistant("carrier"), provider: "codex", codexEvidence: { turn, fileChanges: [{ sourceLine: 4, record: event }] } }];

describe("producer FileChange through the actual paired renderer", () => {
  it("does not manufacture coordinates for malformed or count-mismatched unified hunks", () => {
    for (const source of ["@@ anchor\n-old\n+new", "@@ -41,2 +51,2 @@\n-old\n+new", "@@ -9007199254740992 +1 @@\n-old\n+new"]) expect(unifiedSections(source)).toBeNull();
    expect(unifiedSections("@@ -41 +51 @@\n-old\n+new\n")?.[0]?.lines).toEqual([{ kind: "del", text: "old", oldNo: 41, newNo: null }, { kind: "add", text: "new", oldNo: null, newNo: 51 }]);
  });
  it("prefers the matching producer diff, retains raw input, and uses only recorded coordinates", () => {
    const { container } = render(<ExpandKeyProvider value="filechange-test"><CodexFileChangeProvider messages={messages}><ClaudeContentArrayRenderer provider="codex" content={call.content} /></CodexFileChangeProvider></ExpandKeyProvider>);
    const toggle = container.querySelector<HTMLButtonElement>("[data-tool-row] button[aria-expanded]")!;
    fireEvent.click(toggle);
    expect(container.querySelector("[data-diff-view]")?.textContent).toContain("producer-new");
    expect(container.querySelector("[data-diff-view]")?.textContent).not.toContain("input-new");
    expect(container.textContent).toContain("input-new");
    expect(container.querySelector("[data-diff-view]")?.textContent).toContain("51");
    expect(container.querySelector("[data-diff-view]")?.textContent).toContain("41");
  });
});
