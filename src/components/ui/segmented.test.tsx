import { useState } from "react";
import fs from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetricModeToggle } from "./MetricModeToggle";
import type { MetricMode } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));

describe("metric single-selection adoption", () => {
  it("draws a radio selection without shadows using the shared role and focus tokens", () => {
    const css = fs.readFileSync("src/index.css", "utf8");
    expect(css).toContain('.segmented-item[aria-checked="true"]');
    const section = css.slice(css.indexOf("  .segmented {"), css.indexOf("  /* === Elevated Surface"));
    expect(section).not.toMatch(/box-shadow|duration-200/);
    expect(section).toContain("var(--focus-ring)");
  });
  it("characterizes labels and callback values before replacing the control", () => {
    const change = vi.fn();
    render(<MetricModeToggle value="tokens" onChange={change} />);
    fireEvent.click(screen.getByText("Cost (Est.)"));
    expect(change).toHaveBeenCalledExactlyOnceWith("cost_estimated");
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("Metric")).toBeInTheDocument();
  });

  it("exposes a named radiogroup and selects with arrows through one Tab stop", () => {
    function Example() {
      const [value, setValue] = useState<MetricMode>("tokens");
      return <MetricModeToggle value={value} onChange={setValue} />;
    }
    render(<Example />);
    expect(screen.getByRole("radiogroup", { name: "Metric" })).toBeInTheDocument();
    const tokens = screen.getByRole("radio", { name: "Tokens" });
    const cost = screen.getByRole("radio", { name: "Cost (Est.)" });
    expect(tokens).toHaveAttribute("aria-checked", "true");
    expect([tokens.tabIndex, cost.tabIndex]).toEqual([0, -1]);
    act(() => tokens.focus());
    fireEvent.keyDown(tokens, { key: "ArrowRight" });
    expect(cost).toHaveFocus();
    expect(cost).toHaveAttribute("aria-checked", "true");
    expect([tokens.tabIndex, cost.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(cost, { key: "ArrowRight" });
    expect(tokens).toHaveFocus();
    expect(tokens).toHaveAttribute("aria-checked", "true");
  });
});
