/**
 * ⌘+click (Ctrl+click elsewhere) on a library entry opens it in a new tab;
 * when nothing opens - the session is gone - the new tab goes away again and
 * the previous tab is back (PR #673 review). Legacy favourites (starred before
 * refs existed) are found by id, and report "not found" the same way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { LibrarySection } from "@/components/ProjectTree/components/LibrarySection";
import { openLegacyFavorite } from "@/navigation/openSessionRef";

const pristine = useAppStore.getState();
beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(toast.error).mockClear();
  useAppStore.setState(pristine, true);
});

const ACTION_CLICK = { metaKey: true, ctrlKey: true };

describe("a legacy favourite whose session is gone", () => {
  it("reports not found, like a ref", async () => {
    await expect(openLegacyFavorite("missing-session")).resolves.toBe("notFound");
  });

  it("⌘+click leaves no new tab behind", async () => {
    useAppStore.setState({
      userMetadata: { ...pristine.userMetadata, sessions: { "missing-session": { starred: true } } },
    });
    const before = useAppStore.getState();
    const tabsBefore = before.documents.length;
    const activeBefore = before.activeDocumentId;

    render(<LibrarySection activeItem={null} onGlobalStatsClick={() => {}} />);
    fireEvent.click(document.querySelector('[data-library-item="favorites"]')!);
    const entry = document.querySelector("[data-library-entry]");
    expect(entry).not.toBeNull();
    fireEvent.click(entry!, ACTION_CLICK);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(useAppStore.getState().activeDocumentId).toBe(activeBefore));
    expect(useAppStore.getState().documents.length).toBe(tabsBefore);
  });
});
