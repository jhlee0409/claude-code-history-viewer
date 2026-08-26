/**
 * The standard card was migrated onto `useFileEditActions`, which the compact
 * row already used. These pin the three behaviours that were genuinely
 * different in the card's own copies, so the migration cannot be reverted or
 * re-forked without a test going red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

vi.mock("@/services/api", () => ({ api: vi.fn() }));

vi.mock("@/utils/platform", () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), warning: vi.fn() },
}));

import { FileEditItem } from "./FileEditItem";
import type { RecentFileEdit } from "../../types";

const PROJECT = "/Users/alex/Projects/my-app";

const makeEdit = (overrides: Partial<RecentFileEdit> = {}): RecentFileEdit => ({
  file_path: `${PROJECT}/src/main.ts`,
  timestamp: new Date("2026-08-19T06:37:00Z").toISOString(),
  session_id: "s1",
  operation_type: "edit",
  content_after_change: "after content",
  original_content: "before content",
  lines_added: 3,
  lines_removed: 1,
  ...overrides,
});

const clickCopy = () => {
  const btn = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("title") === "recentEdits.copyContent");
  if (!btn) throw new Error("copy button not found");
  fireEvent.click(btn);
  return btn;
};

describe("FileEditItem action wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a failed copy instead of swallowing it", async () => {
    // The card's own `handleCopy` only did `console.error`, so a clipboard
    // rejection — the ordinary outcome in a non-secure context, or when the
    // document is not focused — looked to the user exactly like success.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<FileEditItem edit={makeEdit()} isDarkMode={false} projectCwd={PROJECT} />);
    clickCopy();

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });

  it("restarts the copied-state countdown on a second click", async () => {
    // Neither transient timer was held, so a click 1.9s after the first
    // inherited the first timer and reverted almost immediately.
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<FileEditItem edit={makeEdit()} isDarkMode={false} projectCwd={PROJECT} />);
    clickCopy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("file-edit-copied")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    clickCopy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // 1.9s into the *first* timer. With a shared, un-reset timer this is where
    // the indicator vanished 100ms after the second click.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(screen.queryByTestId("file-edit-copied")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByTestId("file-edit-copied")).toBeNull();
  });

  it("does not set state after the row unmounts", async () => {
    // A card scrolled out of the list while its timer was pending used to warn
    // and, in React 18 strict builds, leak the update.
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const view = render(
      <FileEditItem edit={makeEdit()} isDarkMode={false} projectCwd={PROJECT} />
    );
    clickCopy();
    await vi.advanceTimersByTimeAsync(0);
    view.unmount();
    await vi.advanceTimersByTimeAsync(5000);

    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("unmounted"))
    ).toBe(false);
    warn.mockRestore();
  });
});
