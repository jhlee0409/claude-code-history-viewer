import { render, screen } from "@testing-library/react";
import { MessageCircle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { MetricCard } from "../components/AnalyticsDashboard/components/MetricCard";
import type { GrowthTrend } from "../components/AnalyticsDashboard/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

const renderCard = (trend?: GrowthTrend) =>
  render(
    <MetricCard icon={MessageCircle} label="Messages" value="1.2K" trend={trend} colorVariant="purple" />,
  );

const trendChip = () => screen.queryByTestId("metric-card-trend");

describe("MetricCard trend chip", () => {
  it("renders a percentage for a comparable base", () => {
    renderCard({ kind: "pct", value: 400 });
    const chip = trendChip();
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("400%");
    expect(chip?.className).toContain("text-success");
  });

  it("renders a negative percentage as an absolute value in the destructive style", () => {
    renderCard({ kind: "pct", value: -75 });
    expect(trendChip()?.textContent).toBe("75%");
    expect(trendChip()?.className).toContain("text-destructive");
  });

  it("labels a metric that started from zero as new, without a percentage", () => {
    renderCard({ kind: "new" });
    const chip = trendChip();
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("title", "analytics.trend.newDescription");
    expect(chip?.textContent).toContain("analytics.trend.new");
    expect(chip?.textContent).not.toMatch(/\d|%/);
    expect(chip?.className).toContain("text-success");
  });

  it.each([
    { kind: "up-small-base", key: "analytics.trend.upSmallBase", tone: "text-success" },
    { kind: "down-small-base", key: "analytics.trend.downSmallBase", tone: "text-destructive" },
    { kind: "flat", key: "analytics.trend.flatSmallBase", tone: "text-muted-foreground" },
  ] as const)("renders $kind as an arrow chip with an explanation and no number", ({ kind, key, tone }) => {
    renderCard({ kind });
    const chip = trendChip();
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("title", key);
    expect(screen.getByText(key)).toHaveClass("sr-only");
    expect(chip?.querySelector("svg")).not.toBeNull();
    expect(chip?.textContent).not.toMatch(/\d|%/);
    expect(chip?.className).toContain(tone);
  });

  it.each([undefined, { kind: "none" } as const])("renders no chip for %o", (trend) => {
    renderCard(trend);
    expect(trendChip()).toBeNull();
  });
});
