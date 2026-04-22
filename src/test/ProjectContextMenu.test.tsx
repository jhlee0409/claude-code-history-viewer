/**
 * @fileoverview Integration tests for ProjectContextMenu listener wiring.
 * Verifies scroll-close, resize-close, rAF arm guard, and cleanup symmetry.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ProjectContextMenu } from "../components/ProjectContextMenu";
import type { ClaudeProject } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const project: ClaudeProject = {
  name: "demo",
  path: "/tmp/demo",
  actual_path: "/tmp/demo",
  session_count: 0,
  last_modified: new Date().toISOString(),
  provider: "claude",
};

function makeProps(overrides: Partial<React.ComponentProps<typeof ProjectContextMenu>> = {}) {
  return {
    project,
    position: { x: 100, y: 100 },
    onClose: vi.fn(),
    onHide: vi.fn(),
    onUnhide: vi.fn(),
    isHidden: false,
    ...overrides,
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("ProjectContextMenu listener wiring", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("closes on document scroll after the rAF arm", async () => {
    const onClose = vi.fn();
    render(<ProjectContextMenu {...makeProps({ onClose })} />);
    await nextFrame();
    document.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on window resize after the rAF arm", async () => {
    const onClose = vi.fn();
    render(<ProjectContextMenu {...makeProps({ onClose })} />);
    await nextFrame();
    window.dispatchEvent(new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores scroll fired before the rAF arm (synchronous scroll burst on mount)", () => {
    const onClose = vi.fn();
    render(<ProjectContextMenu {...makeProps({ onClose })} />);
    document.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes both listeners on unmount (cleanup symmetric with capture flag)", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<ProjectContextMenu {...makeProps({ onClose })} />);
    await nextFrame();
    unmount();
    document.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
