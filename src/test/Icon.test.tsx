import { render } from "@testing-library/react";
import { Search, Star } from "lucide-react";
import { describe, expect, it } from "vitest";

import { Icon, IconProvider } from "@/components/icon/Icon";
import { ICON_SIZES, ICON_STROKE } from "@/components/icon/iconRules";

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  return svg;
};

describe("<Icon>", () => {
  it("offers exactly the three decided sizes", () => {
    expect(ICON_SIZES).toEqual([14, 16, 24]);
  });

  it("draws 14 and 16 with a 1.75 stroke and 24 with a 1.5 stroke", () => {
    expect(ICON_STROKE).toEqual({ 14: 1.75, 16: 1.75, 24: 1.5 });
  });

  it("defaults to 16 px at stroke 1.75", () => {
    const svg = svgOf(render(<Icon icon={Search} />).container);
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
  });

  it.each([
    [14, "1.75"],
    [24, "1.5"],
  ] as const)("renders size %i with stroke %s", (size, stroke) => {
    const svg = svgOf(render(<Icon icon={Star} size={size} />).container);
    expect(svg.getAttribute("width")).toBe(String(size));
    expect(svg.getAttribute("height")).toBe(String(size));
    expect(svg.getAttribute("stroke-width")).toBe(stroke);
  });

  it("is hidden from assistive tech unless labelled", () => {
    const hidden = svgOf(render(<Icon icon={Search} />).container);
    expect(hidden.getAttribute("aria-hidden")).toBe("true");
    const labelled = svgOf(render(<Icon icon={Search} aria-label="Search" />).container);
    expect(labelled.getAttribute("aria-hidden")).toBeNull();
  });

  it("passes className through to the svg", () => {
    const svg = svgOf(render(<Icon icon={Search} className="text-accent" />).container);
    expect(svg.classList.contains("text-accent")).toBe(true);
    expect(svg.classList.contains("lucide-search")).toBe(true);
  });
});

describe("<IconProvider>", () => {
  it("gives a bare lucide icon the 16 px / 1.75 default", () => {
    const svg = svgOf(
      render(
        <IconProvider>
          <Search />
        </IconProvider>
      ).container
    );
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
  });

  it("keeps the wrapper's own stroke for 24 px", () => {
    const svg = svgOf(
      render(
        <IconProvider>
          <Icon icon={Search} size={24} />
        </IconProvider>
      ).container
    );
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
  });
});
