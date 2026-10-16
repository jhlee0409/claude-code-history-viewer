/**
 * The current-date bar shows the date of the first message the user can see.
 *
 * The rows come from a real TanStack virtualizer with the transcript's own
 * overscan, so `getVirtualItems()` starts up to VIRTUALIZER_OVERSCAN rows
 * above the viewport. Reading the date off that first rendered row showed
 * the previous day while the first visible message was already the next day
 * (a June 30 message on screen under a "June 29" bar). Only the scroll
 * element is faked (jsdom has no layout): a 400px viewport at a given scroll
 * offset over fixed 100px rows.
 */
import { act, render, screen } from "@testing-library/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { CurrentDateBar } from "@/components/MessageViewer/components/CurrentDateBar";
import { VIRTUALIZER_OVERSCAN } from "@/components/MessageViewer/helpers/heightEstimation";
import type { FlattenedMessage } from "@/components/MessageViewer/types";
import type { ClaudeMessage } from "@/types";
import { formatDateDivider } from "@/utils/time";

const ROW_PX = 100;
const VIEWPORT_PX = 400;
const DAY1 = "2025-06-29T12:00:00.000Z";
const DAY2 = "2025-06-30T12:00:00.000Z";

function message(index: number, timestamp: string): FlattenedMessage {
  return {
    type: "message",
    message: { uuid: `m${index}`, type: "user", timestamp } as unknown as ClaudeMessage,
    depth: 0,
    originalIndex: index,
    isGroupLeader: false,
    isGroupMember: false,
    isProgressGroupLeader: false,
    isProgressGroupMember: false,
    isTaskOperationGroupLeader: false,
    isTaskOperationGroupMember: false,
    isContinuation: false,
  };
}

/** Rows 0-19: June 29 (divider + 19 messages); row 20 on: June 30. */
const BOUNDARY = 20;
const rows: FlattenedMessage[] = Array.from({ length: 60 }, (_, i) => {
  if (i === 0) return { type: "date-divider", timestamp: DAY1 };
  if (i === BOUNDARY) return { type: "date-divider", timestamp: DAY2 };
  return message(i, i < BOUNDARY ? DAY1 : DAY2);
});

let emitScroll: ((offset: number) => void) | null = null;
/** One element for the whole test: a new one per render re-subscribes. */
const scrollElement = {} as HTMLElement;

function Harness({ initialOffset, sizeOf }: { initialOffset: number; sizeOf?: (i: number) => number }) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (i) => sizeOf?.(i) ?? ROW_PX,
    overscan: VIRTUALIZER_OVERSCAN,
    initialOffset,
    initialRect: { width: 800, height: VIEWPORT_PX },
    observeElementRect: (_instance, cb) => {
      cb({ width: 800, height: VIEWPORT_PX });
      return () => {};
    },
    observeElementOffset: (_instance, cb) => {
      emitScroll = (offset) => cb(offset, false);
      cb(initialOffset, false);
      return () => {
        emitScroll = null;
      };
    },
    scrollToFn: () => {},
  });
  const virtualRows = virtualizer.getVirtualItems();
  return (
    <>
      <span data-testid="first-rendered">{virtualRows[0]?.index}</span>
      <CurrentDateBar
        virtualRows={virtualRows}
        scrollOffset={virtualizer.scrollOffset ?? 0}
        flattenedMessages={rows}
      />
    </>
  );
}

const barText = () => document.querySelector("[data-current-date]")?.textContent ?? "";

describe("CurrentDateBar with the real virtualizer", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("first visible row is the June 30 divider: the bar says June 30, not an overscanned June 29 row", () => {
    render(<Harness initialOffset={BOUNDARY * ROW_PX} />);
    // The precondition the bug needs: rows above the viewport are rendered.
    expect(Number(screen.getByTestId("first-rendered").textContent)).toBeLessThan(BOUNDARY);
    expect(barText()).toBe(formatDateDivider(DAY2));
    expect(formatDateDivider(DAY2)).not.toBe(formatDateDivider(DAY1));
  });

  it("first visible row is a June 30 message part-way into the viewport: June 30", () => {
    render(<Harness initialOffset={(BOUNDARY + 3) * ROW_PX + 40} />);
    expect(barText()).toBe(formatDateDivider(DAY2));
  });

  it("the last June 29 message still shows at the top: June 29", () => {
    render(<Harness initialOffset={BOUNDARY * ROW_PX - 30} />);
    expect(barText()).toBe(formatDateDivider(DAY1));
  });

  it("a sliver (under 16px, e.g. fractional heights after a jump) of June 29 left at the top: June 30", () => {
    render(<Harness initialOffset={BOUNDARY * ROW_PX - 0.5} />);
    expect(barText()).toBe(formatDateDivider(DAY2));
  });

  it("follows scrolls and jumps across the boundary in both directions", () => {
    render(<Harness initialOffset={5 * ROW_PX} />);
    expect(barText()).toBe(formatDateDivider(DAY1));
    act(() => emitScroll?.((BOUNDARY + 10) * ROW_PX));
    expect(barText()).toBe(formatDateDivider(DAY2));
    act(() => emitScroll?.((BOUNDARY - 2) * ROW_PX));
    expect(barText()).toBe(formatDateDivider(DAY1));
    act(() => emitScroll?.(BOUNDARY * ROW_PX));
    expect(barText()).toBe(formatDateDivider(DAY2));
  });

  it("zero-height group members do not count as the visible row", () => {
    // Rows 17-19 (June 29) are collapsed group members: the row after them,
    // the June 30 divider, is what shows at the top.
    const sizeOf = (i: number) => (i >= 17 && i < BOUNDARY ? 0 : ROW_PX);
    render(<Harness initialOffset={17 * ROW_PX} sizeOf={sizeOf} />);
    expect(barText()).toBe(formatDateDivider(DAY2));
  });

  it("switching the language re-formats the label without a scroll", async () => {
    render(<Harness initialOffset={(BOUNDARY + 3) * ROW_PX} />);
    const english = formatDateDivider(DAY2);
    expect(barText()).toBe(english);
    try {
      await act(async () => {
        await i18n.changeLanguage("ko");
      });
      expect(barText()).toBe(formatDateDivider(DAY2));
      expect(barText()).not.toBe(english);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
