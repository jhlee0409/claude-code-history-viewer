import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ClaudeContentArrayRenderer } from "../contentRenderer/ClaudeContentArrayRenderer";
import { CodexFileChangeProvider, CodexUnassignedFileChanges } from "./CodexFileChanges";
import { assistant } from "./transcriptItems.fixtures";
import { toolOutcome } from "./toolOutcome";
import type { ClaudeMessage } from "@/types";
import { codexChangeEvents, unifiedSections } from "./codexFileChangeModel";

const patch = "*** Begin Patch\n*** Update File: a.ts\n@@\n-input-old\n+input-new\n*** End Patch";
const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -41,2 +51,2 @@\n keep\n-producer-old\n+producer-new\n";
const call = assistant("call", [{ type: "tool_use", id: "patch-id", name: "apply_patch", input: { patch } }]);
const turn = { started: { turn_id: "t" }, context: { turn_id: "t" } };
const event = { timestamp: "2026-01-01T00:00:00Z", type: "event_msg", payload: { type: "item_completed", turn_id: "t", item: { type: "FileChange", id: "patch-id", status: "completed", changes: { "a.ts": { type: "update", unified_diff: diff, move_path: null } } } } };
const messages: ClaudeMessage[] = [{ ...call, provider: "codex", codexEvidence: { turn } }, { ...assistant("carrier"), provider: "codex", codexEvidence: { turn, fileChanges: [{ sourceLine: 4, record: event }] } }];

describe("producer FileChange through the actual paired renderer", () => {
  it.each(["en", "ko", "ja", "zh-CN", "zh-TW"])("shows failed and declined status in standalone and matched Result routes (%s)", async locale => {
    await act(() => i18n.changeLanguage(locale));
    try {
      for (const status of ["failed", "declined"] as const) {
        const carrier = { ...messages[1]!, codexEvidence: { turn, fileChanges: [{ sourceLine: 4, record: { ...event, payload: { ...event.payload, item: { ...event.payload.item, status } } } }] } };
        const label = i18n.t(`codexFileChange.${status}`);
        const standalone = render(<ExpandKeyProvider value="status-alone"><CodexFileChangeProvider messages={[carrier]}><CodexUnassignedFileChanges message={carrier} /></CodexFileChangeProvider></ExpandKeyProvider>);
        expect(standalone.container.querySelector("[data-codex-file-change]")?.textContent).toContain(label);
        standalone.unmount();
        const paired = render(<ExpandKeyProvider value="status-paired"><CodexFileChangeProvider messages={[messages[0]!, carrier]}><ClaudeContentArrayRenderer provider="codex" content={call.content} /></CodexFileChangeProvider></ExpandKeyProvider>);
        const toggle = paired.container.querySelector<HTMLButtonElement>("[data-tool-row] button[aria-expanded]")!;
        if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
        expect(paired.container.querySelector("[data-codex-file-change]")?.textContent).toContain(label);
        expect(paired.container.querySelector("[data-tool-row]")?.getAttribute("data-tool-verdict")).toBe("failed");
        expect(paired.container.textContent).toContain("producer-new");
        paired.unmount();
      }
    } finally { await act(() => i18n.changeLanguage("en")); }
  });
  it("preserves D-R4 interruption and conflict precedence with explicit FileChange failures", () => {
    const use = { name: "apply_patch", id: "patch-id" };
    for (const status of ["failed", "declined"]) {
      const changes = [{ status }];
      expect(toolOutcome(use, [], "other", "codex", changes)).toMatchObject({ lifecycle: "completed", verdict: "failed", reason: "provider-error" });
      expect(toolOutcome(use, [{ content: "not evidence", toolUseResult: { exit_code: 0 } }], "other", "codex", changes)).toMatchObject({ verdict: "failed", reason: "conflict", exitCode: 0 });
      expect(toolOutcome(use, [{ toolUseResult: { interrupted: true } }], "other", "codex", changes)).toMatchObject({ lifecycle: "interrupted", verdict: "unknown" });
      expect(toolOutcome(use, [], "other", "claude", changes)).toMatchObject({ lifecycle: "no-result", verdict: "unknown" });
    }
    expect(toolOutcome(use, [], "other", "codex", [{ status: "completed" }])).toMatchObject({ lifecycle: "completed", verdict: "unknown" });
  });
  it("reads legacy PatchApplyEnd success without treating absent evidence as completion", () => {
    for (const [success, expected] of [[false, "failed"], [true, "completed"], [undefined, "unknown"]] as const) {
      const carrier = { ...messages[1]!, codexEvidence: { fileChanges: [{ sourceLine: 4, record: { type: "event_msg", payload: { type: "patch_apply_end", call_id: "patch-id", changes: event.payload.item.changes, ...(success === undefined ? {} : { success }) } } }] } };
      expect(codexChangeEvents([carrier])[0]?.status).toBe(expected);
    }
  });
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
