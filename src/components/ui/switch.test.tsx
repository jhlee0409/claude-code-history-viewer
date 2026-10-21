/**
 * Switch state contract (inner-UI plan F2a, G-ST7, G-FC3, D10).
 *
 * - Disabled is drawn with the disabled tokens (thumb and track), not by
 *   fading the whole control; a disabled switch is told apart from an
 *   enabled one.
 * - Forced colours: the track has a CanvasText border, the thumb is
 *   CanvasText, the checked track is Highlight (with a HighlightText thumb,
 *   the system pair drawn on Highlight).
 * - The thumb travels at least 8px between off and on.
 * - Keyboard focus is the base ring (no outline-none) and nothing in the
 *   switch casts a shadow.
 *
 * jsdom has no layout and no forced-colours mode: this file checks the
 * behaviour and the classes that carry the contract. The computed styles
 * (forced-colours border/thumb/track colours in real Chromium, the thumb's
 * travel in WebKit and Chromium) are measured by
 * scripts/ui-capture/test/primitives.states.test.mjs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Switch } from "./switch";

afterEach(cleanup);

function renderSwitch(props: React.ComponentProps<typeof Switch> = {}) {
  render(<Switch aria-label="Sync" {...props} />);
  const track = screen.getByRole("switch", { name: "Sync" });
  const thumb = track.querySelector<HTMLElement>("span");
  if (!thumb) throw new Error("no thumb");
  return { track, thumb, classes: (el: HTMLElement) => el.className.split(/\s+/) };
}

/** px of a `translate-x-N` class (Tailwind: N × 4px), 0 when absent. */
const translatePx = (classes: string[], variant: string) => {
  const token = classes.find((c) => c.startsWith(`${variant}translate-x-`));
  if (!token) return 0;
  return Number(token.slice(`${variant}translate-x-`.length)) * 4;
};

describe("Switch", () => {
  it("is a switch that toggles, and a disabled one does not", () => {
    const onCheckedChange = vi.fn();
    const { track } = renderSwitch({ onCheckedChange });
    expect(track).toHaveAttribute("aria-checked", "false");
    fireEvent.click(track);
    expect(track).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    cleanup();

    const disabled = renderSwitch({ disabled: true, onCheckedChange });
    fireEvent.click(disabled.track);
    expect(disabled.track).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(disabled.track).toHaveAttribute("data-disabled");
    expect(disabled.thumb).toHaveAttribute("data-disabled");
  });

  it("draws disabled with tokens, not opacity", () => {
    const { track, thumb, classes } = renderSwitch({ disabled: true });
    for (const el of [track, thumb]) {
      expect(classes(el).filter((c) => /(^|:)opacity-\d+$/.test(c))).toEqual([]);
    }
    expect(classes(thumb)).toContain("data-disabled:bg-fg-disabled");
    expect(classes(track)).toContain("data-disabled:border-line-faint");
    expect(classes(track)).toContain("data-disabled:data-[state=checked]:bg-fg-disabled");
  });

  it("keeps the focus ring and casts no shadow", () => {
    const { track, thumb, classes } = renderSwitch();
    for (const el of [track, thumb]) {
      expect(classes(el).filter((c) => /(^|:)outline-(none|hidden)$/.test(c))).toEqual([]);
      expect(classes(el).filter((c) => /(^|:)shadow(-|$)/.test(c))).toEqual([]);
    }
  });

  it("forced colours: CanvasText track border and thumb, Highlight checked track", () => {
    const { track, thumb, classes } = renderSwitch();
    // `!` (important) is allowed: a hover or pressed fill must not replace the system colour.
    const has = (el: HTMLElement, cls: string) => classes(el).some((c) => c === cls || c === `${cls}!`);
    expect(has(track, "forced-colors:border-[CanvasText]"), "track border").toBe(true);
    expect(has(track, "forced-colors:data-[state=checked]:bg-[Highlight]"), "checked track").toBe(true);
    expect(has(thumb, "forced-colors:bg-[CanvasText]"), "thumb").toBe(true);
    expect(has(thumb, "forced-colors:data-[state=checked]:bg-[HighlightText]"), "checked thumb").toBe(true);
  });

  it("moves the thumb at least 8px between off and on", () => {
    const { thumb, classes } = renderSwitch();
    const off = translatePx(classes(thumb), "data-[state=unchecked]:");
    const on = translatePx(classes(thumb), "data-[state=checked]:");
    expect(on - off).toBeGreaterThanOrEqual(8);
  });
});
