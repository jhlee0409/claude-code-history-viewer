/**
 * A Recent entry with a timestamp no Date can hold (T7 review R8) used to
 * throw `RangeError: Invalid time value` when the disclosure expanded
 * (`new Date(1e100).toISOString()`). Stored entries are validated on load,
 * and the list renders such an entry without its time instead of crashing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { useAppStore } from "@/store/useAppStore";
import { LibrarySection } from "@/components/ProjectTree/components/LibrarySection";
import { RECENT_STORAGE_KEY, loadRecent, parseRecent, type RecentEntry } from "@/navigation/library";

const ref = (id: string) => ({ provider: "claude", filePath: `/p/a/${id}.jsonl`, sessionId: id });
const entry = (id: string, openedAt: unknown) => ({ ref: ref(id), title: `title ${id}`, openedAt });

const pristine = useAppStore.getState();
beforeEach(() => {
  cleanup();
  localStorage.clear();
  useAppStore.setState(pristine, true);
});

describe("stored Recent timestamps", () => {
  it("only times a Date can hold are kept", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const parsed = parseRecent([
      entry("huge", 1e100),
      entry("negativeHuge", -1e100),
      entry("pastLimit", 8.64e15 + 1),
      entry("fraction", now + 0.5),
      entry("text", "2026-10-16"),
      entry("ok", now),
    ]);
    expect(parsed.map((e) => e.ref.sessionId)).toEqual(["fraction", "ok"]);
    for (const e of parsed) expect(() => new Date(e.openedAt).toISOString()).not.toThrow();
  });

  it("a list saved with a bad time loads without it", () => {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify([entry("bad", 1e100), entry("good", 1)]));
    expect(loadRecent().map((e) => e.ref.sessionId)).toEqual(["good"]);
  });
});

describe("the Recent disclosure", () => {
  it("renders an entry whose time cannot be shown, without the time", () => {
    const bad = entry("bad", 1e100) as RecentEntry;
    const good = entry("good", Date.now() - 60_000) as RecentEntry;
    useAppStore.setState({ recentSessions: [bad, good] });
    render(<LibrarySection activeItem={null} onGlobalStatsClick={() => {}} />);

    expect(() => fireEvent.click(document.querySelector('[data-library-item="recent"]')!)).not.toThrow();
    expect(screen.getByText("title bad")).toBeTruthy();
    expect(screen.getByText("title good")).toBeTruthy();
    expect(document.querySelectorAll("[data-library-entry]")).toHaveLength(2);
  });
});
