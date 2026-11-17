/**
 * Regression test: toggling the sidechain filter must reload in place.
 *
 * `selectSession` treats a call as an in-place reload (keeping the subagent
 * stack, pagination and search index) only when the session is still
 * selected. `setExcludeSidechain` used to go through `selectProject`, which
 * nulls the selection first, so a subagent view was reloaded as a top-level
 * session with sidechain messages excluded — i.e. blank, with no way back.
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { ClaudeProject, ClaudeSession } from "../types";
import { createSettingsSlice } from "../store/slices/settingsSlice";
import type { AppStore } from "../store/useAppStore";

vi.mock("@/services/storage", () => ({
  storageAdapter: { load: vi.fn() },
}));

const project = { name: "p", path: "/p" } as ClaudeProject;
const session = {
  session_id: "s1",
  file_path: "/p/s1.jsonl",
} as ClaudeSession;

function createTestStore() {
  const selectedAtSelectSession: Array<ClaudeSession | null> = [];
  const store = create<AppStore>()((set, get, api) => ({
    ...createSettingsSlice(set, get, api),
    selectedProject: project,
    selectedSession: session,
    selectProject: vi.fn(async () => {
      set({ selectedSession: null });
    }),
    reloadProjectSessions: vi.fn(async () => {}),
    reloadCurrent: vi.fn(async () => {
      selectedAtSelectSession.push(get().selectedSession);
    }),
  }) as unknown as AppStore);
  return { store, selectedAtSelectSession };
}

describe("setExcludeSidechain", () => {
  it("reloads the project without dropping the selected session", () => {
    const { store, selectedAtSelectSession } = createTestStore();

    store.getState().setExcludeSidechain(true);

    expect(store.getState().excludeSidechain).toBe(true);
    expect(store.getState().selectProject).not.toHaveBeenCalled();
    expect(store.getState().reloadProjectSessions).toHaveBeenCalledWith(project);
    expect(store.getState().reloadCurrent).toHaveBeenCalledWith("filter");
    // Still selected when the reload runs => it is an in-place reload.
    expect(selectedAtSelectSession).toEqual([session]);
  });
});
