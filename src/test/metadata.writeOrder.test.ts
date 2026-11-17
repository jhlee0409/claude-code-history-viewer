/**
 * Metadata writes replace a whole session record on the backend
 * (`update_session_metadata`), so two writes built from the same snapshot
 * lose one of them (T7 review R3). A legacy favourite's ref backfill and an
 * unstar made meanwhile used to resurrect the star.
 *
 * Writes now go out one at a time, each built from the state the previous
 * one left; the backfill re-checks the star when its turn comes. The fake
 * backend below commits a request when the test releases it, in any order,
 * with the real replacement semantics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession, UserMetadata } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { useAppStore } from "@/store/useAppStore";

const PROJECT: ClaudeProject = {
  name: "a",
  path: "/p/a",
  actual_path: "/home/a",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
};
const S: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/p/a/s1.jsonl",
  project_name: "a",
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
};

let disk: UserMetadata;
/** Requests the backend has received and not answered yet. */
let inFlight: { args: Record<string, unknown>; commit: () => void }[];
let maxInFlight: number;
const pristine = useAppStore.getState();

beforeEach(() => {
  disk = { version: 1, sessions: { s1: { starred: true } }, projects: {}, settings: {} };
  inFlight = [];
  maxInFlight = 0;
  apiMock.mockReset();
  apiMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    if (command !== "update_session_metadata") return Promise.resolve(null);
    return new Promise<UserMetadata>((resolve) => {
      const request = {
        args,
        commit: () => {
          const update = JSON.parse(JSON.stringify(args.update)) as Record<string, unknown>;
          const sessions = { ...disk.sessions };
          if (Object.keys(update).length === 0) delete sessions[String(args.sessionId)];
          else sessions[String(args.sessionId)] = update;
          disk = { ...disk, sessions };
          inFlight = inFlight.filter((r) => r !== request);
          resolve(disk);
        },
      };
      inFlight.push(request);
      maxInFlight = Math.max(maxInFlight, inFlight.length);
    });
  });
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    projects: [PROJECT],
    selectedProject: PROJECT,
    sessions: [S],
    userMetadata: disk,
    isMetadataLoaded: true,
  });
});

const state = () => useAppStore.getState();
const tick = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
/** Answer whatever is in flight, newest first, until nothing is left. */
async function drainNewestFirst() {
  await tick();
  while (inFlight.length > 0) {
    inFlight[inFlight.length - 1]!.commit();
    await tick();
  }
}

describe("a legacy favourite's ref backfill races another write", () => {
  it("an unstar made while the backfill is in flight stays unstarred", async () => {
    const backfill = state().backfillFavoriteRefs([S]);
    await tick();
    const unstar = state().toggleSessionFavorite(S, PROJECT);
    await drainNewestFirst();
    await Promise.all([backfill, unstar]);

    expect(disk.sessions.s1).toBeUndefined();
    expect(state().userMetadata.sessions.s1?.starred).toBeFalsy();
    expect(maxInFlight).toBe(1);
  });

  it("a backfill queued behind an unstar does not write the star back", async () => {
    const unstar = state().toggleSessionFavorite(S, PROJECT);
    const backfill = state().backfillFavoriteRefs([S]);
    await drainNewestFirst();
    await Promise.all([backfill, unstar]);

    expect(disk.sessions.s1).toBeUndefined();
    expect(apiMock.mock.calls.filter(([c]) => c === "update_session_metadata")).toHaveLength(1);
  });

  it("a rename made meanwhile keeps the name, the star and the ref", async () => {
    const backfill = state().backfillFavoriteRefs([S]);
    await tick();
    const rename = state().updateSessionMetadata("s1", { customName: "Named" });
    await drainNewestFirst();
    await Promise.all([backfill, rename]);

    expect(disk.sessions.s1).toMatchObject({ starred: true, customName: "Named", ref: { filePath: S.file_path } });
    expect(state().userMetadata.sessions.s1).toEqual(disk.sessions.s1);
  });

  it("a failed write does not stall the ones behind it", async () => {
    apiMock.mockImplementationOnce(() => Promise.reject(new Error("disk full")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = state().updateSessionMetadata("s1", { customName: "Lost" });
    const second = state().updateSessionMetadata("s1", { customName: "Kept" });
    await drainNewestFirst();
    await Promise.all([first, second]);
    expect(disk.sessions.s1).toMatchObject({ starred: true, customName: "Kept" });
  });
});
