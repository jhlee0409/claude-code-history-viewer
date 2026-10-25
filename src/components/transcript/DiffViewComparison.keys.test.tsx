/**
 * Expansion state is per diff instance, never shared between siblings
 * (CodeRabbit 4369584587, 4369584589 on PR #732).
 *
 * - Two Recent-edits cards for the same file (two edits, different times)
 *   each keep their own DiffView fold state.
 * - Under one tool-call key, each MultiEdit section's advanced comparison
 *   keeps its own expand state.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { FileEditItem } from "@/components/RecentEditsViewer/FileEditItem";
import type { RecentFileEdit } from "@/types";
import { DiffComparisonBody } from "./DiffViewComparison";

const forty = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useExpandRegistry.setState({ states: {} });
});

describe("expansion state is per diff instance", () => {
  it("two Recent-edits cards for the same file keep their own fold state", () => {
    const base: RecentFileEdit = {
      file_path: "/tmp/same.ts",
      timestamp: "2026-07-14T10:00:00Z",
      session_id: "session-1",
      operation_type: "edit",
      original_content: forty,
      content_after_change: forty.replace("line 20\n", "line twenty\n"),
      lines_added: 1,
      lines_removed: 1,
      cwd: "/tmp",
    };
    const second: RecentFileEdit = { ...base, timestamp: "2026-07-14T11:00:00Z", content_after_change: forty.replace("line 30\n", "line thirty\n") };
    const { container } = render(
      <>
        <div data-card="a"><FileEditItem edit={base} isDarkMode={false} /></div>
        <div data-card="b"><FileEditItem edit={second} isDarkMode={false} /></div>
      </>,
    );
    for (const button of screen.getAllByLabelText(i18n.t("recentEdits.showDiff"))) fireEvent.click(button);
    const a = container.querySelector<HTMLElement>("[data-card='a']")!;
    const b = container.querySelector<HTMLElement>("[data-card='b']")!;
    const firstGap = (card: HTMLElement) => within(card.querySelector<HTMLElement>("[data-diff-gap]")!).getByRole("button");
    fireEvent.click(firstGap(a));
    expect(firstGap(a).getAttribute("aria-expanded")).toBe("true");
    expect(firstGap(b).getAttribute("aria-expanded"), "the other edit of the same file").toBe("false");
  });

  it("each MultiEdit section's advanced comparison keeps its own expand state", () => {
    const long = (tag: string) => Array.from({ length: 30 }, (_, i) => `${tag} ${i} ${"x".repeat(30)}`).join("\n");
    render(
      <ExpandKeyProvider value="msg-multi">
        <DiffComparisonBody
          mode="advanced"
          sections={[
            { oldText: long("a"), newText: long("A") },
            { oldText: long("b"), newText: long("B") },
          ]}
          expandKey="multi"
        />
      </ExpandKeyProvider>,
    );
    const expand = screen.getAllByRole("button", { name: i18n.t("advancedTextDiff.expand") });
    expect(expand).toHaveLength(2);
    fireEvent.click(expand[0]);
    expect(screen.getAllByRole("button", { name: i18n.t("advancedTextDiff.collapse") }), "only the first opened").toHaveLength(1);
    expect(screen.getAllByRole("button", { name: i18n.t("advancedTextDiff.expand") }), "the second stays closed").toHaveLength(1);
  });
});
