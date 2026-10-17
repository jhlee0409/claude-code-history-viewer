/**
 * Segmented controls show which item is selected, clearly, in every theme.
 *
 * The selected item used to be `bg-card shadow-sm` on a `bg-muted/30` track:
 * in the dark theme the card (L 0.16) on the track over the background
 * (~L 0.15) measured about 1.1:1, so Session/Project, the density buttons,
 * Overview/Tokens and Project overview/Session details read as unselected.
 * One shared style (`.segmented` / `.segmented-item` in index.css) now draws
 * the selected item with its own surface and an accent outline (WCAG 1.4.11
 * non-text contrast, 3:1, against both the selected surface and the track), and
 * every segmented control uses it, keyed on its `aria-pressed` /
 * `aria-selected` state.
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { block, contrast, oklch } from "./utils/oklchContrast";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
  }),
}));

import { RecentEditsDensityToggle, RecentEditsScopeToggle } from "@/components/RecentEditsViewer/RecentEditsToggles";
import { AnalyticsSubTabs } from "@/components/AnalyticsDashboard/AnalyticsSubTabs";
import { MetricModeToggle } from "@/components/ui/MetricModeToggle";
import { MobileAnalyticsSubNav } from "@/layouts/shell/MobileAnalyticsSubNav";

const NON_TEXT = 3;
const AA_SMALL_TEXT = 4.5;
const THEMES = {
  light: ":root",
  dark: ".dark",
  "high contrast": ".high-contrast",
  "dark high contrast": ".dark.high-contrast",
} as const;

const CSS = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const SRC = path.resolve(__dirname, "..");

describe("segmented control contrast (selected vs unselected)", () => {
  for (const [label, selector] of Object.entries(THEMES)) {
    const rule = () => block(selector);
    const ratio = (a: string, b: string) => contrast(oklch(rule(), a), oklch(rule(), b));

    it(`${label}: the selected item's outline stands out from the track (${NON_TEXT}:1)`, () => {
      const r = ratio("segmented-selected-border", "segmented-track");
      expect(r, `${label}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it(`${label}: the selected item's outline stands out from its own surface (${NON_TEXT}:1)`, () => {
      const r = ratio("segmented-selected-border", "segmented-selected");
      expect(r, `${label}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it(`${label}: the selected label is readable (${AA_SMALL_TEXT}:1)`, () => {
      const r = ratio("segmented-selected-foreground", "segmented-selected");
      expect(r, `${label}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it(`${label}: an unselected label is readable on the track (${AA_SMALL_TEXT}:1)`, () => {
      const r = ratio("muted-foreground", "segmented-track");
      expect(r, `${label}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }

  for (const [label, selector] of Object.entries(THEMES)) {
    it(`${label}: the keyboard-focus ring stands out from the track it sits on (${NON_TEXT}:1)`, () => {
      // The ring is drawn outside the item (outline + offset), over the track.
      const r = contrast(oklch(block(selector), "accent"), oklch(block(selector), "segmented-track"));
      expect(r, `${label}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT);
    });
  }

  it("keyboard focus has its own shared ring: an outline outside the item, no layout shift", () => {
    // The global `:focus-visible` rule removes the browser outline, so every
    // segmented control needs this one; the selected state (an inset 1px
    // border) is not a focus indicator.
    const focus = CSS.match(/\.segmented-item:focus-visible\s*\{([^}]*)\}/);
    expect(focus, "no shared .segmented-item:focus-visible rule in index.css").not.toBeNull();
    const body = focus![1]!;
    expect(body).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/);
    expect(body).toMatch(/outline-offset:\s*1px/);
    // An outline takes no space; anything that does would move the row.
    expect(body).not.toMatch(/\b(border|padding|margin|width|height)\s*:/);
    // Inside the components layer, so it beats the base layer's outline reset.
    const components = CSS.indexOf("@layer components {");
    const at = CSS.indexOf(".segmented-item:focus-visible");
    expect(at).toBeGreaterThan(components);
    expect(at).toBeLessThan(CSS.indexOf("@layer utilities {", components));
  });

  // data-active: an item that is the current state but not a toggle (the
  // palette's "Search in «project» ✕" pill, a button that clears it).
  it("the selected state is drawn from those tokens, for aria-pressed, aria-selected, aria-current and data-active", () => {
    const selected = CSS.match(
      /\.segmented-item\[aria-pressed="true"\],\s*\.segmented-item\[aria-selected="true"\],\s*\.segmented-item\[aria-current="page"\],\s*\.segmented-item\[data-active="true"\]\s*\{([^}]*)\}/
    );
    expect(selected, "no shared selected rule in index.css").not.toBeNull();
    const body = selected![1]!;
    expect(body).toMatch(/background-color:\s*var\(--segmented-selected\)/);
    expect(body).toMatch(/color:\s*var\(--segmented-selected-foreground\)/);
    expect(body).toMatch(/var\(--segmented-selected-border\)/);
    expect(CSS).toMatch(/\.segmented\s*\{[^}]*background-color:\s*var\(--segmented-track\)/);
  });
});

describe("every segmented control uses the shared style", () => {
  const selectedItem = () =>
    screen
      .queryAllByRole("button")
      .concat(screen.queryAllByRole("tab"))
      .filter(
        (el) =>
          el.getAttribute("aria-pressed") === "true" ||
          el.getAttribute("aria-selected") === "true" ||
          el.getAttribute("aria-current") === "page"
      );

  const expectShared = () => {
    const items = selectedItem();
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.classList.contains("segmented-item")).toBe(true);
    expect(item.parentElement?.classList.contains("segmented")).toBe(true);
    // No per-site selected colours fighting the shared rule.
    expect(item.className).not.toMatch(/\bbg-card\b|\bshadow-sm\b/);
  };

  it("Edits scope (Session / Project)", () => {
    render(<RecentEditsScopeToggle value="project" onChange={() => {}} />);
    expectShared();
  });

  it("Edits density, icon-only: each button is named and has a tooltip", () => {
    render(<RecentEditsDensityToggle value="compact" onChange={() => {}} />);
    expectShared();
    for (const button of screen.getAllByRole("button")) {
      const name = button.getAttribute("aria-label");
      expect(name).toBeTruthy();
      expect(button.getAttribute("title")).toBe(name);
    }
  });

  it("analytics sub-tabs (Overview / Tokens)", () => {
    render(<AnalyticsSubTabs value="tokens" onChange={() => {}} />);
    expectShared();
  });

  it("the phone's analytics nav (Overview / Tokens / Edits)", () => {
    render(<MobileAnalyticsSubNav view="edits" analyticsActions={{} as never} />);
    expectShared();
  });

  it("metric mode (Tokens / Cost)", () => {
    render(<MetricModeToggle value="tokens" onChange={() => {}} />);
    expectShared();
  });

  it("every segmented item relies on the shared focus ring (no per-control focus utilities)", () => {
    // A per-site ring would draw a second, different indicator on one control
    // and hide that the shared rule is missing elsewhere.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
          const text = fs.readFileSync(full, "utf8");
          // Each class string (or cn(...) call) that names segmented-item.
          for (const match of text.matchAll(/(?:cn\([^)]*\)|"[^"]*")/gs)) {
            const classes = match[0];
            if (!/\bsegmented-item\b/.test(classes)) continue;
            if (/focus-visible:|focus-ring-inset|\bfocus:/.test(classes)) {
              offenders.push(path.relative(SRC, full));
            }
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it.each([
    ["Edits scope", () => <RecentEditsScopeToggle value="project" onChange={() => {}} />],
    ["Edits density", () => <RecentEditsDensityToggle value="compact" onChange={() => {}} />],
    ["analytics sub-tabs", () => <AnalyticsSubTabs value="tokens" onChange={() => {}} />],
    ["metric mode", () => <MetricModeToggle value="tokens" onChange={() => {}} />],
    ["phone analytics nav", () => <MobileAnalyticsSubNav view="analytics" analyticsActions={{} as never} />],
  ])("%s: rendered items carry only the shared focus style", (_name, ui) => {
    const { container } = render(ui());
    const items = container.querySelectorAll(".segmented-item");
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.className).not.toMatch(/focus-visible:|focus-ring-inset|\bfocus:/);
    }
  });

  it("no component keeps the old faint selected style (bg-card + shadow-sm on a muted track)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          const text = fs.readFileSync(full, "utf8");
          if (/["'`][^"'`]*\bbg-card text-foreground shadow-sm\b/.test(text)) {
            offenders.push(path.relative(SRC, full));
          }
        }
      }
    };
    walk(path.join(SRC, "components"));
    walk(path.join(SRC, "layouts"));
    expect(offenders).toEqual([]);
  });

  it("the project analytics tablist (Project overview / Session details) uses it", () => {
    const text = fs.readFileSync(path.join(SRC, "components/AnalyticsDashboard/AnalyticsDashboard.tsx"), "utf8");
    const tablist = text.slice(text.indexOf('role="tablist"'), text.indexOf("{/* Global Date Picker */}"));
    expect(tablist).toMatch(/className="segmented\b/);
    expect(tablist.match(/segmented-item/g)?.length).toBe(2);
  });
});
