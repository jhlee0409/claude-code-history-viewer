/**
 * Primitive state colours, computed from the tokens in every theme (inner-UI
 * plan F2a, G-ST5 · ST7, §4.1).
 *
 * The classes each primitive actually renders are read here (button
 * variants, field controls, the switch's track and thumb) and painted the
 * way a browser composites them: a translucent `bg-x/85` state layer over
 * the canvas or a card, in all four themes (light, dark and both high
 * contrast themes; `pnpm ui:states` screenshots only light and dark).
 *
 * - A step shows: rest → hover → pressed each moves a pixel by more than
 *   the `ui:states` judge's channel threshold (statesJudge CHANNEL_DELTA).
 * - Labels stay readable on every step (WCAG 4.5:1); a switch thumb and its
 *   track stay apart (3:1); a field's border and a switch's off track
 *   (`--line-input`) stand out from the surface (3:1).
 * - Disabled is its own look (tokens), told apart from rest.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CHANNEL_DELTA } from "../../scripts/ui-capture/lib/statesJudge.mjs";
import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  THEME_NAMES,
  channelDelta,
  contrastSrgb8,
  createTokenResolver,
  over,
  srgb8,
  type Srgb8,
  type ThemeName,
} from "./utils/oklchContrast";

const tokens = createTokenResolver();
const px = (theme: ThemeName, token: string) => srgb8(tokens.color(theme, token));

const STEP = CHANNEL_DELTA + 1;
const AA_TEXT = 4.5;
const NON_TEXT = 3;
const BACKDROPS = ["background", "card"] as const;
/** Type steps share the `text-` prefix with colours. */
const TEXT_SIZES = new Set(["caption", "list", "body", "code", "title", "lg", "xl", "2xl", "xs", "sm", "base"]);

interface Paint {
  token: string;
  alpha: number;
}

/** The `prop` colour (`bg`, `text`, `border`) a class list sets under `variant` (\"\" = no variant). */
function paint(classes: string[], variant: string, prop: "bg" | "text" | "border"): Paint | undefined {
  const re = new RegExp(`^${variant.replace(/[[\]()=]/g, "\\$&")}${prop}-([a-z][\\w-]*?)(?:/(\\d+))?$`);
  let found: Paint | undefined;
  for (const c of classes) {
    const m = re.exec(c);
    if (!m) continue;
    const token = m[1] ?? "";
    if (prop === "text" && TEXT_SIZES.has(token)) continue;
    if (prop === "border" && /^\d+$/.test(token)) continue;
    found = { token, alpha: m[2] ? Number(m[2]) / 100 : 1 }; // last one wins, as in the merged class list
  }
  return found;
}

/** The pixel of `p` over `back` (`transparent` → the backdrop itself). */
function paintOver(theme: ThemeName, p: Paint | undefined, back: Srgb8): Srgb8 {
  if (!p || p.token === "transparent") return back;
  return p.alpha < 1 ? over(px(theme, p.token), p.alpha, back) : px(theme, p.token);
}

const fmt = (c: Srgb8) => `rgb(${c.join(",")})`;

describe("Button state colours", () => {
  const VARIANTS = ["primary", "destructive", "outline", "secondary", "ghost"] as const;

  for (const variant of VARIANTS) {
    const classes = buttonVariants({ variant }).split(/\s+/);
    const fills = {
      rest: paint(classes, "", "bg"),
      hover: paint(classes, "hover:", "bg"),
      pressed: paint(classes, "active:", "bg"),
      disabled: paint(classes, "data-disabled:", "bg"),
    };
    const labels = {
      rest: paint(classes, "", "text") ?? { token: "foreground", alpha: 1 },
      hover: paint(classes, "hover:", "text"),
      disabled: paint(classes, "data-disabled:", "text"),
    };

    for (const theme of THEME_NAMES) {
      for (const backdrop of BACKDROPS) {
        it(`${variant} · ${theme} · on ${backdrop}: hover and pressed are visible steps with readable labels`, () => {
          const back = px(theme, backdrop);
          const rest = paintOver(theme, fills.rest, back);
          const hover = paintOver(theme, fills.hover ?? fills.rest, back);
          const pressed = paintOver(theme, fills.pressed ?? fills.hover ?? fills.rest, back);
          const steps = `rest ${fmt(rest)} → hover ${fmt(hover)} → pressed ${fmt(pressed)}`;
          expect(channelDelta(rest, hover), steps).toBeGreaterThanOrEqual(STEP);
          expect(channelDelta(hover, pressed), steps).toBeGreaterThanOrEqual(STEP);

          const restLabel = px(theme, labels.rest.token);
          const hoverLabel = px(theme, (labels.hover ?? labels.rest).token);
          for (const [state, fill, label] of [
            ["rest", rest, restLabel],
            ["hover", hover, hoverLabel],
            ["pressed", pressed, hoverLabel],
          ] as const) {
            const ratio = contrastSrgb8(label, fill);
            expect(ratio, `${state}: label ${fmt(label)} on ${fmt(fill)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
          }
        });

        it(`${variant} · ${theme} · on ${backdrop}: disabled is its own look`, () => {
          const back = px(theme, backdrop);
          expect(labels.disabled?.token, "disabled label token").toBe("fg-disabled");
          const rest = paintOver(theme, fills.rest, back);
          const disabled = paintOver(theme, fills.disabled ?? fills.rest, back);
          const restLabel = px(theme, labels.rest.token);
          const disabledLabel = px(theme, "fg-disabled");
          expect(Math.max(channelDelta(rest, disabled), channelDelta(restLabel, disabledLabel))).toBeGreaterThanOrEqual(STEP);
        });
      }
    }
  }

  it("link: hover underlines, pressed thickens the underline", () => {
    const classes = buttonVariants({ variant: "link" }).split(/\s+/);
    expect(classes).toContain("hover:underline");
    expect(classes).toContain("active:decoration-2");
  });
});

describe("Field control states (Input, Textarea, Select)", () => {
  const classes = inputVariants({ variant: "default" }).split(/\s+/);
  const rest = paint(classes, "", "border");
  const hover = paint(classes, "hover:", "border");
  const invalid = paint(classes, "aria-invalid:", "border");
  const invalidHover = paint(classes, "aria-invalid:hover:", "border");

  for (const theme of THEME_NAMES) {
    for (const backdrop of BACKDROPS) {
      it(`${theme} · on ${backdrop}: the border stands out (3:1) and hover is a visible step`, () => {
        const back = px(theme, backdrop);
        expect(rest?.token).toBe("line-input");
        const restLine = paintOver(theme, rest, back);
        const hoverLine = paintOver(theme, hover ?? rest, back);
        expect(contrastSrgb8(restLine, back)).toBeGreaterThanOrEqual(NON_TEXT);
        expect(channelDelta(restLine, hoverLine)).toBeGreaterThanOrEqual(STEP);
      });

      it(`${theme} · on ${backdrop}: invalid — the danger line stands out (3:1) and hover is a visible step`, () => {
        const back = px(theme, backdrop);
        expect(invalid?.token).toBe("status-danger-line");
        const line = paintOver(theme, invalid, back);
        const hoverLine = paintOver(theme, invalidHover ?? invalid, back);
        expect(contrastSrgb8(line, back)).toBeGreaterThanOrEqual(NON_TEXT);
        expect(channelDelta(line, hoverLine)).toBeGreaterThanOrEqual(STEP);
      });
    }
  }
});

describe("Switch state colours", () => {
  const { container } = render(<Switch aria-label="probe" />);
  const track = container.querySelector("button")!.className.split(/\s+/);
  const thumb = container.querySelector("button > span")!.className.split(/\s+/);
  const on = "data-[state=checked]:";

  for (const theme of THEME_NAMES) {
    for (const backdrop of BACKDROPS) {
      it(`${theme} · on ${backdrop}: off — outlined track, readable thumb, visible hover and pressed steps`, () => {
        const back = px(theme, backdrop);
        // A state without its own class keeps the rest look.
        const border = paintOver(theme, paint(track, "", "border"), back);
        const hoverBorder = paintOver(theme, paint(track, "enabled:hover:", "border") ?? paint(track, "", "border"), back);
        const fill = paintOver(theme, paint(track, "", "bg"), back);
        const pressedFill = paintOver(theme, paint(track, "enabled:active:", "bg") ?? paint(track, "", "bg"), back);
        const knob = paintOver(theme, paint(thumb, "", "bg"), back);
        expect(contrastSrgb8(border, back), "track border vs surface").toBeGreaterThanOrEqual(NON_TEXT);
        expect(contrastSrgb8(knob, fill), "thumb vs track").toBeGreaterThanOrEqual(NON_TEXT);
        expect(contrastSrgb8(knob, pressedFill), "thumb vs pressed track").toBeGreaterThanOrEqual(NON_TEXT);
        expect(channelDelta(border, hoverBorder), "hover").toBeGreaterThanOrEqual(STEP);
        expect(channelDelta(fill, pressedFill), "pressed").toBeGreaterThanOrEqual(STEP);
      });

      it(`${theme} · on ${backdrop}: on — filled track, readable thumb, visible hover and pressed steps`, () => {
        const back = px(theme, backdrop);
        const onFill = paint(track, on, "bg");
        const onHover = paint(track, `${on}enabled:hover:`, "bg") ?? onFill;
        const fill = paintOver(theme, onFill, back);
        const hoverFill = paintOver(theme, onHover, back);
        const pressedFill = paintOver(theme, paint(track, `${on}enabled:active:`, "bg") ?? onHover, back);
        const knob = paintOver(theme, paint(thumb, on, "bg"), back);
        expect(contrastSrgb8(fill, back), "track vs surface").toBeGreaterThanOrEqual(NON_TEXT);
        for (const [state, f] of [
          ["rest", fill],
          ["hover", hoverFill],
          ["pressed", pressedFill],
        ] as const) {
          expect(contrastSrgb8(knob, f), `thumb vs ${state} track`).toBeGreaterThanOrEqual(NON_TEXT);
        }
        expect(channelDelta(fill, hoverFill), "hover").toBeGreaterThanOrEqual(STEP);
        expect(channelDelta(hoverFill, pressedFill), "pressed").toBeGreaterThanOrEqual(STEP);
      });

      it(`${theme} · on ${backdrop}: disabled is told apart from enabled, off and on`, () => {
        const back = px(theme, backdrop);
        const knobOff = paintOver(theme, paint(thumb, "", "bg"), back);
        const knobOffDisabled = paintOver(theme, paint(thumb, "data-disabled:", "bg") ?? paint(thumb, "", "bg"), back);
        const fillOn = paintOver(theme, paint(track, on, "bg"), back);
        const fillOnDisabled = paintOver(theme, paint(track, `data-disabled:${on}`, "bg") ?? paint(track, on, "bg"), back);
        expect(channelDelta(knobOff, knobOffDisabled), "off: thumb").toBeGreaterThanOrEqual(STEP);
        expect(channelDelta(fillOn, fillOnDisabled), "on: track").toBeGreaterThanOrEqual(STEP);
      });
    }
  }
});
