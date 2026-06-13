import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { api } from "../services/api";
import {
  createProjectSlice,
  type ProjectSlice,
} from "../store/slices/projectSlice";
import {
  DEFAULT_USER_METADATA,
  type ClaudeProject,
  type ProviderInfo,
  type UserMetadata,
} from "../types";

vi.mock("../services/api", () => ({
  api: vi.fn(),
}));

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

type TestStore = ProjectSlice & {
  providers: ProviderInfo[];
  userMetadata: UserMetadata;
  updateUserSettings: ReturnType<typeof vi.fn>;
  excludeSidechain: boolean;
};

const createMockProject = (
  name: string,
  provider?: ClaudeProject["provider"],
): ClaudeProject => ({
  name,
  path: `/sessions/${name}`,
  actual_path: `/workspace/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "2026-01-01T00:00:00.000Z",
  git_info: null,
  ...(provider ? { provider } : {}),
});

const createTestStore = () =>
  create<TestStore>()((set, get) => ({
    providers: [],
    userMetadata: DEFAULT_USER_METADATA,
    updateUserSettings: vi.fn().mockResolvedValue(undefined),
    excludeSidechain: true,
    ...createProjectSlice(
      set as Parameters<typeof createProjectSlice>[0],
      get as Parameters<typeof createProjectSlice>[1],
      undefined as never,
    ),
  }));

describe("projectSlice scanProjects", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it("hydrates Claude projects before a slower multi-provider scan completes", async () => {
    const store = createTestStore();
    const claudeProject = createMockProject("claude-only");
    const codexProject = createMockProject("codex-project", "codex");
    const fullScan = createDeferred<ClaudeProject[]>();

    store.setState({
      claudePath: "/root/.claude",
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
        {
          id: "codex",
          display_name: "Codex",
          base_path: "/root/.codex",
          is_available: true,
        },
      ],
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([claudeProject]);
      }
      if (command === "scan_all_projects") {
        return fullScan.promise;
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const scanPromise = store.getState().scanProjects();
    await Promise.resolve();

    expect(store.getState().isLoadingProjects).toBe(true);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
    ]);

    fullScan.resolve([{ ...claudeProject, provider: "claude" }, codexProject]);
    await scanPromise;

    expect(store.getState().isLoadingProjects).toBe(false);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
      codexProject,
    ]);
  });
});
