/**
 * Moving a Claude Code session to another project changes its file path,
 * which is also its id: the app's records of it (custom name, notes, star
 * and its `ref`, the recent list) must follow the file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMetadata } from "@/types";
import type { SessionRef } from "@/navigation/place";
import { relocateRecent, type RecentEntry } from "@/navigation/library";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { useAppStore } from "@/store/useAppStore";

const OLD = "/c/projects/-a/s1.jsonl";
const NEW = "/c/projects/-b/s1.jsonl";
const REF: SessionRef = {
  provider: "claude",
  filePath: NEW,
  sessionId: NEW,
  actualSessionId: "s1",
  projectPath: "/c/projects/-b",
};

let disk: UserMetadata;
let failFor: string | null;
const pristine = useAppStore.getState();

beforeEach(() => {
  failFor = null;
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command !== "update_session_metadata") return null;
    if (args.sessionId === failFor) throw new Error("disk full");
    const update = args.update as Record<string, unknown>;
    const sessions = { ...disk.sessions };
    if (Object.keys(update).length === 0) delete sessions[String(args.sessionId)];
    else sessions[String(args.sessionId)] = update;
    disk = { ...disk, sessions };
    return disk;
  });
  useAppStore.setState(pristine, true);
});

function seed(sessions: UserMetadata["sessions"]) {
  disk = { version: 1, sessions, projects: {}, settings: {} };
  useAppStore.setState({ userMetadata: disk, isMetadataLoaded: true });
}

describe("moveSessionMetadata", () => {
  it("moves the record to the new path and points a starred ref there", async () => {
    seed({
      [OLD]: {
        customName: "mine",
        starred: true,
        ref: { provider: "claude", filePath: OLD, sessionId: OLD, projectPath: "/c/projects/-a" },
      },
    });

    await useAppStore.getState().moveSessionMetadata(OLD, NEW, REF);

    const sessions = useAppStore.getState().userMetadata.sessions;
    expect(sessions[OLD]).toBeUndefined();
    expect(sessions[NEW]).toEqual({ customName: "mine", starred: true, ref: REF });
  });

  it("gives a legacy star (no ref yet) the new location", async () => {
    seed({ [OLD]: { starred: true } });
    await useAppStore.getState().moveSessionMetadata(OLD, NEW, REF);
    expect(useAppStore.getState().userMetadata.sessions[NEW]).toEqual({ starred: true, ref: REF });
  });

  it("adds no ref to a session that is not starred", async () => {
    seed({ [OLD]: { notes: "n" } });
    await useAppStore.getState().moveSessionMetadata(OLD, NEW, REF);
    expect(useAppStore.getState().userMetadata.sessions[NEW]).toEqual({ notes: "n" });
  });

  it("does nothing for a session without a record", async () => {
    seed({});
    await useAppStore.getState().moveSessionMetadata(OLD, NEW, REF);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("rejects and keeps the old record when the new one cannot be saved", async () => {
    seed({ [OLD]: { customName: "mine" } });
    failFor = NEW;

    await expect(useAppStore.getState().moveSessionMetadata(OLD, NEW, REF)).rejects.toThrow("disk full");

    const sessions = useAppStore.getState().userMetadata.sessions;
    expect(sessions[OLD]).toEqual({ customName: "mine" });
    expect(sessions[NEW]).toBeUndefined();
  });
});

describe("relocateRecent", () => {
  it("points the moved file's entries at the new ref and keeps the rest", () => {
    const other: RecentEntry = {
      ref: { provider: "claude", filePath: "/x.jsonl", sessionId: "/x.jsonl" },
      title: "x",
      openedAt: 1,
    };
    const moved: RecentEntry = {
      ref: { provider: "claude", filePath: OLD, sessionId: OLD },
      title: "s1",
      openedAt: 2,
    };

    expect(relocateRecent([moved, other], OLD, REF)).toEqual([{ ...moved, ref: REF }, other]);
  });
});
