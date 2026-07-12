import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { ExpiringSession } from "../types";
import {
  createArchiveSlice,
  type ArchiveSlice,
} from "../store/slices/archiveSlice";

vi.mock("../services/archiveApi", () => ({
  archiveApi: {
    listArchives: vi.fn(),
    createArchive: vi.fn(),
    deleteArchive: vi.fn(),
    renameArchive: vi.fn(),
    getArchiveSessions: vi.fn(),
    getDiskUsage: vi.fn(),
    getExpiringSessions: vi.fn(),
    exportSession: vi.fn(),
  },
}));

import { archiveApi } from "../services/archiveApi";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const createExpiringSession = (
  filePath: string,
  projectName: string,
): ExpiringSession => ({
  session: {
    session_id: filePath,
    actual_session_id: filePath.split("/").pop()?.replace(".jsonl", "") ?? "session",
    file_path: filePath,
    project_name: projectName,
    message_count: 3,
    first_message_time: "2026-03-01T00:00:00.000Z",
    last_message_time: "2026-03-01T00:05:00.000Z",
    last_modified: "2026-03-01T00:05:00.000Z",
    has_tool_use: false,
    has_errors: false,
    summary: `${projectName} session`,
    provider: "claude",
  },
  daysRemaining: 2,
  fileSizeBytes: 128,
  subagentCount: 0,
});

const createTestStore = () =>
  create<ArchiveSlice>()((set, get) => ({
    ...createArchiveSlice(
      set as Parameters<typeof createArchiveSlice>[0],
      get as Parameters<typeof createArchiveSlice>[1],
    ),
  }));

const createReadOnlyTestStore = () =>
  create<ArchiveSlice & { isServerReadOnly: boolean }>()((set, get) => ({
    isServerReadOnly: true,
    ...createArchiveSlice(
      set as unknown as Parameters<typeof createArchiveSlice>[0],
      get as unknown as Parameters<typeof createArchiveSlice>[1],
    ),
  }));

describe("archiveSlice", () => {
  const mockGetExpiringSessions = vi.mocked(archiveApi.getExpiringSessions);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects archive mutations locally in server read-only mode", async () => {
    const useStore = createReadOnlyTestStore();

    await expect(
      useStore.getState().createArchive({
        name: "Snapshot",
        sessionFilePaths: ["/tmp/session.jsonl"],
        sourceProvider: "claude",
        sourceProjectPath: "/tmp/project",
        sourceProjectName: "project",
      }),
    ).rejects.toThrow("Server is running in read-only mode");

    expect(archiveApi.createArchive).not.toHaveBeenCalled();
    expect(useStore.getState().archive.error).toBe(
      "Server is running in read-only mode",
    );
  });

  it("ignores stale expiring-session responses when a newer request wins", async () => {
    const useStore = createTestStore();
    const first = createDeferred<ExpiringSession[]>();
    const second = createDeferred<ExpiringSession[]>();
    const projectASessions = [
      createExpiringSession("/projects/a/session-a.jsonl", "Project A"),
    ];
    const projectBSessions = [
      createExpiringSession("/projects/b/session-b.jsonl", "Project B"),
    ];

    mockGetExpiringSessions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstLoad = useStore
      .getState()
      .loadExpiringSessions("/projects/a", 7);
    const secondLoad = useStore
      .getState()
      .loadExpiringSessions("/projects/b", 3);

    expect(useStore.getState().archive.isLoadingExpiring).toBe(true);

    second.resolve(projectBSessions);
    await secondLoad;

    expect(useStore.getState().archive.expiringSessions).toEqual(projectBSessions);
    expect(useStore.getState().archive.expiringError).toBeNull();
    expect(useStore.getState().archive.isLoadingExpiring).toBe(false);

    first.resolve(projectASessions);
    await firstLoad;

    expect(useStore.getState().archive.expiringSessions).toEqual(projectBSessions);
    expect(useStore.getState().archive.expiringError).toBeNull();
    expect(useStore.getState().archive.isLoadingExpiring).toBe(false);
  });
});
