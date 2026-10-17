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
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
  }),
}));

import { RecentEditsDensityToggle, RecentEditsScopeToggle } from "@/components/RecentEditsViewer/RecentEditsToggles";
import { AnalyticsSubTabs } from "@/components/AnalyticsDashboard/AnalyticsSubTabs";
import { MetricModeToggle } from "@/components/ui/MetricModeToggle";

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

  it("the selected state is drawn from those tokens, for both aria-pressed and aria-selected", () => {
    const selected = CSS.match(
      /\.segmented-item\[aria-pressed="true"\],\s*\.segmented-item\[aria-selected="true"\]\s*\{([^}]*)\}/
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
      .filter((el) => el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true");

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

  it("metric mode (Tokens / Cost)", () => {
    render(<MetricModeToggle value="tokens" onChange={() => {}} />);
    expectShared();
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
