/**
 * LoadingState's generic empty / error drawings follow the icon rules
 * (T5 review, finding 2): 24 px lucide glyphs through `<Icon size={24}>`,
 * stroke 1.5, hidden from assistive tech (the text next to them says it).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { IconProvider } from "@/components/icon/Icon";
import { LoadingState } from "./loading";

afterEach(cleanup);

function stateIcon(props: { error?: string; isEmpty?: boolean }) {
  const { container } = render(
    <IconProvider>
      <LoadingState isLoading={false} {...props}>
        <p>content</p>
      </LoadingState>
    </IconProvider>
  );
  const svgs = container.querySelectorAll("svg");
  expect(svgs).toHaveLength(1);
  return svgs[0] as SVGSVGElement;
}

function expectRuleIcon(svg: SVGSVGElement) {
  expect(svg.classList.contains("lucide"), "a lucide glyph").toBe(true);
  expect(svg.getAttribute("width")).toBe("24");
  expect(svg.getAttribute("height")).toBe("24");
  expect(svg.getAttribute("stroke-width")).toBe("1.5");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  // No size classes that would override the 24 px attributes.
  expect(svg.getAttribute("class") ?? "").not.toMatch(/(^|\s)(w|h|size)-/);
  // No path re-sets its own stroke.
  for (const child of svg.querySelectorAll("[stroke-width]")) {
    expect(child.getAttribute("stroke-width")).toBe("1.5");
  }
}

describe("LoadingState state icons", () => {
  it("empty state draws a 24 px, stroke 1.5, hidden lucide icon", () => {
    expectRuleIcon(stateIcon({ isEmpty: true }));
  });

  it("error state draws a 24 px, stroke 1.5, hidden lucide icon", () => {
    expectRuleIcon(stateIcon({ error: "boom" }));
  });
});
