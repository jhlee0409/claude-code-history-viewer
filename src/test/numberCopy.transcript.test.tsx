/**
 * Copy boundaries inside the transcript (F3b review 7): a renderer's token
 * count is its own numeric display, so copying it gives `5万`, not `5⁠万`;
 * the recorded text around it (a compaction summary, an agent's result)
 * stays outside every boundary and copies exactly as recorded.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemMessageRenderer } from "../components/messageRenderer/SystemMessageRenderer";
import { AgentCard } from "../components/contentRenderer/unifiedCards/AgentCard";
import { ExpandKeyProvider } from "../contexts/CaptureExpandContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: "ja" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const WJ = "\u2060";
const RECORDED = `recorded 1120${WJ}万 and a${WJ}b`;

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

/** Selects `element`'s contents and copies from it: what the handlers put on the clipboard. */
function copyFrom(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  const notPrevented = fireEvent.copy(element, {
    clipboardData: { setData: (type: string, value: string) => void data.set(type, value), getData: () => "" },
  });
  return { prevented: !notPrevented, text: data.get("text/plain") };
}

const boundaries = (container: HTMLElement) => [...container.querySelectorAll("[data-number-copy]")];

describe("copy boundaries in the transcript are the token counts only", () => {
  it("a compaction's before/after tokens copy without joiners; its summary is outside", () => {
    const { container, getByText } = render(
      <ExpandKeyProvider value="copy-compact">
        <SystemMessageRenderer
          subtype="compact_boundary"
          content={RECORDED}
          compactMetadata={{ preTokens: 50_000, postTokens: 12_000 }}
          expandKey="cmp-copy"
        />
      </ExpandKeyProvider>,
    );
    expect(boundaries(container).map((el) => el.textContent)).toEqual([`5${WJ}万 → 1.2${WJ}万 tokens`]);
    expect(copyFrom(boundaries(container)[0]!)).toEqual({ prevented: true, text: "5万 → 1.2万 tokens" });
    const summary = getByText(RECORDED);
    expect(summary.closest("[data-number-copy]")).toBeNull();
    expect(copyFrom(summary)).toEqual({ prevented: false, text: undefined });
  });

  it("a microcompaction's tokens copy without joiners", () => {
    const { container } = render(
      <SystemMessageRenderer subtype="microcompact_boundary" content="" microcompactMetadata={{ preTokens: 50_000 }} />,
    );
    expect(boundaries(container).map((el) => el.textContent)).toEqual([`5${WJ}万 tokens`]);
    expect(copyFrom(boundaries(container)[0]!)).toEqual({ prevented: true, text: "5万 tokens" });
  });

  it("an agent's total tokens copy without joiners; its prompt and result are outside", () => {
    const { container } = render(
      <ExpandKeyProvider value="copy-agent">
        <AgentCard
          toolUse={{ id: "toolu_copy", name: "Task", input: { description: RECORDED, prompt: "do it" } }}
          toolResults={[{ content: RECORDED, totalTokens: 11_200_000, totalDurationMs: 2_000, totalToolUseCount: 3 }]}
        />
      </ExpandKeyProvider>,
    );
    fireEvent.click(container.querySelector('button[aria-expanded="false"]')!); // open the card
    expect(boundaries(container).map((el) => el.textContent)).toEqual([`1120${WJ}万`]);
    expect(copyFrom(boundaries(container)[0]!)).toEqual({ prevented: true, text: "1120万" });
    for (const element of container.querySelectorAll("span")) {
      if (element.textContent === RECORDED) expect(element.closest("[data-number-copy]")).toBeNull();
    }
  });
});
