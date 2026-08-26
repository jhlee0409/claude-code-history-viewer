import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

import { PanelDock } from "./PanelDock";
import type { PanelDefinition, PanelId } from "./types";

const panels = {
  recentEdits: {
    id: "recentEdits",
    title: "Recent Edits",
    render: () => <div data-testid="recent-edits-body">rows</div>,
  } satisfies PanelDefinition,
} as Record<PanelId, PanelDefinition>;

describe("PanelDock", () => {
  it("renders no chrome of its own with a single tab", () => {
    render(
      <PanelDock
        groups={[
          { tabs: ["recentEdits"], activeTab: "recentEdits", size: 340 },
        ]}
        panels={panels}
      />
    );

    // The whole point of shipping with one group holding one tab: the dock is
    // visually indistinguishable from a bespoke rail.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("recent-edits-body")).toBeTruthy();
  });

  it("names the aside after the active panel and exposes it as complementary", () => {
    render(
      <PanelDock
        asideId="recent-edits-dock"
        groups={[
          { tabs: ["recentEdits"], activeTab: "recentEdits", size: 340 },
        ]}
        panels={panels}
      />
    );

    const aside = screen.getByRole("complementary", { name: "Recent Edits" });
    // The id is what AppLayout's skip link targets.
    expect(aside.getAttribute("id")).toBe("recent-edits-dock");
  });

  it("applies the group size as a fixed width", () => {
    render(
      <PanelDock
        groups={[
          { tabs: ["recentEdits"], activeTab: "recentEdits", size: 412 },
        ]}
        panels={panels}
      />
    );

    const aside = screen.getByRole("complementary");
    expect(aside.style.width).toBe("412px");
    expect(aside.style.minWidth).toBe("412px");
    expect(aside.style.maxWidth).toBe("412px");
  });

  it("starts a resize from the left edge, because the panel grows leftward", () => {
    const onResizeStart = vi.fn();
    const { container } = render(
      <PanelDock
        groups={[
          { tabs: ["recentEdits"], activeTab: "recentEdits", size: 340 },
        ]}
        panels={panels}
        onResizeStart={onResizeStart}
      />
    );

    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).toBeTruthy();
    fireEvent.mouseDown(handle as Element);

    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(onResizeStart.mock.calls[0]?.[0]).toBe(0);
  });

  it("grows a tab strip once a group holds more than one panel", () => {
    // Guards the hedge the array shape exists for: a second panel must be a new
    // tab, not a refactor.
    const twoPanels = {
      ...panels,
      second: {
        id: "second",
        title: "File Tree",
        render: () => <div data-testid="second-body">tree</div>,
      },
    } as unknown as Record<PanelId, PanelDefinition>;

    const onActivateTab = vi.fn();
    render(
      <PanelDock
        groups={[
          {
            tabs: ["recentEdits", "second" as PanelId],
            activeTab: "recentEdits",
            size: 340,
          },
        ]}
        panels={twoPanels}
        onActivateTab={onActivateTab}
      />
    );

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tab").length).toBe(2);

    fireEvent.click(screen.getByRole("tab", { name: "File Tree" }));
    expect(onActivateTab).toHaveBeenCalledWith(0, "second");
  });

  it("renders nothing when there are no groups", () => {
    const { container } = render(<PanelDock groups={[]} panels={panels} />);
    expect(container.firstChild).toBeNull();
  });
});
