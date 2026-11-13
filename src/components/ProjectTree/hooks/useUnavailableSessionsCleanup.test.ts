import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { useUnavailableSessionsCleanup } from "./useUnavailableSessionsCleanup";

vi.mock("@/services/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        options?: string | { defaultValue?: string; [name: string]: unknown }
      ) => {
        if (typeof options === "string") return options;
        return options?.defaultValue ?? key;
      },
    }),
  };
});

function createProject(overrides: Partial<ClaudeProject> = {}): ClaudeProject {
  return {
    name: "gone",
    path: "/gone",
    actual_path: "/gone",
    session_count: 1,
    message_count: 1,
    last_modified: "2026-03-20T00:00:00Z",
    provider: "claude",
    path_status: "unavailable",
    ...overrides,
  };
}

function createSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    session_id: "session-1",
    actual_session_id: "session-1",
    file_path: "/gone/session-1.jsonl",
    project_name: "gone",
    message_count: 2,
    first_message_time: "2026-03-20T00:00:00Z",
    last_message_time: "2026-03-20T00:00:00Z",
    last_modified: "2026-03-20T00:00:00Z",
    has_tool_use: false,
    has_errors: false,
    summary: "gone session",
    provider: "claude",
    ...overrides,
  };
}

describe("useUnavailableSessionsCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      isServerReadOnly: false,
      sessions: [],
      selectedSession: null,
      refreshAllConversations: vi.fn().mockResolvedValue(undefined),
      setSessions: (sessions) => useAppStore.setState({ sessions }),
      setSelectedSession: (selectedSession) =>
        useAppStore.setState({ selectedSession }),
    } as never);
  });

  it("deletes every deletable session under unavailable projects", async () => {
    const project = createProject();
    const keep = createSession({
      session_id: "keep",
      file_path: "/keep/session.jsonl",
      project_path: "/keep",
    });
    const gone = createSession();
    useAppStore.setState({
      sessions: [keep, gone],
      selectedSession: gone,
    });

    vi.mocked(api).mockImplementation(async (command, args) => {
      if (command === "load_provider_sessions") {
        expect(args).toMatchObject({
          provider: "claude",
          projectPath: "/gone",
        });
        return [gone];
      }
      if (command === "delete_session") {
        expect(args).toEqual({ filePath: gone.file_path });
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { result } = renderHook(() => useUnavailableSessionsCleanup());

    await act(async () => {
      await result.current.clearUnavailableSessions([project]);
    });

    expect(api).toHaveBeenCalledWith("delete_session", {
      filePath: gone.file_path,
    });
    expect(useAppStore.getState().sessions).toEqual([keep]);
    expect(useAppStore.getState().selectedSession).toBeNull();
    expect(useAppStore.getState().refreshAllConversations).toHaveBeenCalled();
  });

  it("skips cleanup while the app is in server read-only mode", async () => {
    useAppStore.setState({ isServerReadOnly: true });
    const { result } = renderHook(() => useUnavailableSessionsCleanup());

    await act(async () => {
      await result.current.clearUnavailableSessions([createProject()]);
    });

    expect(api).not.toHaveBeenCalled();
  });
});
