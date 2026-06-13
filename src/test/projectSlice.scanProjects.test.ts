import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { api } from "../services/api";
import {
  createProjectSlice,
  type ProjectSlice,
} from "../store/slices/projectSlice";
import {
  AppErrorType,
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

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
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
  lastModified = "2026-01-01T00:00:00.000Z",
): ClaudeProject => ({
  name,
  path: `/sessions/${name}`,
  actual_path: `/workspace/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: lastModified,
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

  it("publishes each provider as soon as that provider scan completes", async () => {
    const store = createTestStore();
    const claudeProject = createMockProject(
      "claude-only",
      undefined,
      "2026-01-03T00:00:00.000Z",
    );
    const geminiProject = createMockProject(
      "gemini-project",
      "gemini",
      "2026-01-02T00:00:00.000Z",
    );
    const codexProject = createMockProject(
      "codex-project",
      "codex",
      "2026-01-01T00:00:00.000Z",
    );
    const codexScan = createDeferred<ClaudeProject[]>();
    const geminiScan = createDeferred<ClaudeProject[]>();

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
        {
          id: "gemini",
          display_name: "Gemini CLI",
          base_path: "/root/.gemini",
          is_available: true,
        },
      ],
    });

    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "scan_projects") {
        return Promise.resolve([claudeProject]);
      }
      if (command === "scan_all_projects") {
        const provider = (args?.activeProviders as string[] | undefined)?.[0];
        if (provider === "codex") {
          return codexScan.promise;
        }
        if (provider === "gemini") {
          return geminiScan.promise;
        }
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const scanPromise = store.getState().scanProjects();
    await flushMicrotasks();

    expect(store.getState().isLoadingProjects).toBe(true);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
    ]);

    geminiScan.resolve([geminiProject]);
    await flushMicrotasks();

    expect(store.getState().isLoadingProjects).toBe(true);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
      geminiProject,
    ]);

    codexScan.resolve([codexProject]);
    await scanPromise;

    expect(store.getState().isLoadingProjects).toBe(false);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
      geminiProject,
      codexProject,
    ]);
  });

  it("reports provider errors when successful scans return no projects", async () => {
    const store = createTestStore();

    store.setState({
      providers: [
        {
          id: "codex",
          display_name: "Codex",
          base_path: "/root/.codex",
          is_available: true,
        },
        {
          id: "gemini",
          display_name: "Gemini CLI",
          base_path: "/root/.gemini",
          is_available: true,
        },
      ],
    });

    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "scan_all_projects") {
        const provider = (args?.activeProviders as string[] | undefined)?.[0];
        if (provider === "codex") {
          return Promise.resolve([]);
        }
        if (provider === "gemini") {
          return Promise.reject(new Error("scan failed"));
        }
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().scanProjects();

    expect(store.getState().projects).toEqual([]);
    expect(store.getState().error).toEqual({
      type: AppErrorType.UNKNOWN,
      message: "gemini: scan failed",
    });
  });
});
