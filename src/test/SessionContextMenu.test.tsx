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
    readOnly: false,
    supportsNativeRename: false,
    supportsResumeCommand: true,
    supportsSessionDeletion: true,
    supportsRevealInFinder: true,
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

  describe("with an anchor row", () => {
    // Sidebar ⟶ row, and an unrelated pane (the transcript) beside it.
    const added: HTMLElement[] = [];
    function layout() {
      const sidebar = document.createElement("div");
      const row = document.createElement("div");
      const transcript = document.createElement("div");
      sidebar.appendChild(row);
      document.body.append(sidebar, transcript);
      added.push(sidebar, transcript);
      return { sidebar, row, transcript };
    }
    afterEach(() => {
      added.splice(0).forEach((node) => node.remove());
    });

    it("stays open while an unrelated pane scrolls (the transcript loading more)", async () => {
      const { row, transcript } = layout();
      const onClose = vi.fn();
      render(<SessionContextMenu {...makeProps({ onClose, position: { x: 100, y: 100, anchor: row } })} />);
      await nextFrame();
      transcript.dispatchEvent(new Event("scroll"));
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closes when a scroll container holding the row scrolls", async () => {
      const { sidebar, row } = layout();
      const onClose = vi.fn();
      render(<SessionContextMenu {...makeProps({ onClose, position: { x: 100, y: 100, anchor: row } })} />);
      await nextFrame();
      sidebar.dispatchEvent(new Event("scroll"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders inside the modal dialog that holds the row (phone drawer), else in <body>", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      const row = document.createElement("div");
      dialog.appendChild(row);
      document.body.appendChild(dialog);
      added.push(dialog);
      const { unmount } = render(<SessionContextMenu {...makeProps({ position: { x: 1, y: 1, anchor: row } })} />);
      expect(dialog.querySelector('[role="menu"]')).not.toBeNull();
      unmount();

      const { row: plainRow } = layout();
      render(<SessionContextMenu {...makeProps({ position: { x: 1, y: 1, anchor: plainRow } })} />);
      const menu = document.querySelector('[role="menu"]');
      expect(menu?.parentElement).toBe(document.body);
    });

    it("closes when the document scrolls", async () => {
      const { row } = layout();
      const onClose = vi.fn();
      render(<SessionContextMenu {...makeProps({ onClose, position: { x: 100, y: 100, anchor: row } })} />);
      await nextFrame();
      document.dispatchEvent(new Event("scroll"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
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
