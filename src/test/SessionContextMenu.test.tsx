/**
 * @fileoverview Integration tests for SessionContextMenu listener wiring.
 * Verifies scroll-close, resize-close, rAF arm guard, and cleanup symmetry.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SessionContextMenu } from "../components/SessionItem/components/SessionContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function makeProps(overrides: Partial<React.ComponentProps<typeof SessionContextMenu>> = {}) {
  return {
    position: { x: 100, y: 100 },
    hasCustomName: false,
    supportsNativeRename: false,
    providerId: "claude",
    onClose: vi.fn(),
    onRenameClick: vi.fn(),
    onResetCustomName: vi.fn(),
    onNativeRenameClick: vi.fn(),
    onCopySessionId: vi.fn(),
    onCopyResumeCommand: vi.fn(),
    onCopyFilePath: vi.fn(),
    onRevealInFinder: vi.fn(),
    onDeleteSession: vi.fn(),
    ...overrides,
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("SessionContextMenu listener wiring", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("closes on document scroll after the rAF arm", async () => {
    const onClose = vi.fn();
    render(<SessionContextMenu {...makeProps({ onClose })} />);
    await nextFrame();
    document.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on window resize after the rAF arm", async () => {
    const onClose = vi.fn();
    render(<SessionContextMenu {...makeProps({ onClose })} />);
    await nextFrame();
    window.dispatchEvent(new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores scroll fired before the rAF arm (synchronous scroll burst on mount)", () => {
    const onClose = vi.fn();
    render(<SessionContextMenu {...makeProps({ onClose })} />);
    document.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes both listeners on unmount (cleanup symmetric with capture flag)", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<SessionContextMenu {...makeProps({ onClose })} />);
    await nextFrame();
    unmount();
    document.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
