/**
 * `useScopedProjectSessions` (plan T10): the session list of the project the
 * ⌘K palette is scoped to. A failed list is reported (`failed`), not passed
 * off as an empty one; `retry` asks for it again; a failure of a project the
 * palette is no longer scoped to is never reported.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { useScopedProjectSessions } from "./useScopedProjectSessions";

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock("@/services/api", () => ({ api: mockApi }));
vi.mock("@/store/useAppStore", () => ({
    useAppStore: Object.assign(() => ({}), { getState: () => ({ excludeSidechain: false }) }),
}));

const project = (name: string): ClaudeProject => ({
    name,
    path: `/store/${name}`,
    actual_path: `/home/me/${name}`,
    session_count: 1,
    message_count: 1,
    last_modified: "2026-01-01T00:00:00Z",
    provider: "claude",
});
const session = (id: string): ClaudeSession => ({
    session_id: id,
    actual_session_id: id,
    file_path: `/store/beta/${id}.jsonl`,
    project_name: "beta",
    message_count: 1,
    first_message_time: "",
    last_message_time: "",
    last_modified: "",
    has_tool_use: false,
    has_errors: false,
    summary: id,
    provider: "claude",
});

const ALPHA = project("alpha");
const BETA = project("beta");
const GAMMA = project("gamma");
const NONE: ClaudeSession[] = [];
function held() {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
const listCalls = (p: ClaudeProject) =>
    mockApi.mock.calls.filter(([command, args]) => command === "load_project_sessions" && args.projectPath === p.path);

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useScopedProjectSessions", () => {
    it("a failed list is reported as failed, with no sessions", async () => {
        mockApi.mockRejectedValue(new Error("list unavailable"));
        const { result } = renderHook(() => useScopedProjectSessions(BETA, ALPHA, NONE));
        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.sessions).toEqual([]);
    });

    it("retry asks for the list again; its answer clears the failure", async () => {
        mockApi.mockRejectedValueOnce(new Error("list unavailable")).mockResolvedValueOnce([session("b1")]);
        const { result } = renderHook(() => useScopedProjectSessions(BETA, ALPHA, NONE));
        await waitFor(() => expect(result.current.failed).toBe(true));
        act(() => result.current.retry());
        // Asked again: not failed while it is.
        expect(result.current.failed).toBe(false);
        await waitFor(() => expect(result.current.sessions.map((s) => s.session_id)).toEqual(["b1"]));
        expect(result.current.failed).toBe(false);
        expect(listCalls(BETA)).toHaveLength(2);
    });

    it("a failure of a project the scope has left is never reported", async () => {
        const beta = held();
        mockApi.mockImplementation((_command: string, args: { projectPath: string }) =>
            args.projectPath === BETA.path ? beta.promise : Promise.resolve([session("g1")]),
        );
        const { result, rerender } = renderHook(({ scoped }) => useScopedProjectSessions(scoped, ALPHA, NONE), {
            initialProps: { scoped: BETA as ClaudeProject | null },
        });
        rerender({ scoped: GAMMA });
        await act(async () => beta.reject(new Error("late")));
        await waitFor(() => expect(result.current.sessions.map((s) => s.session_id)).toEqual(["g1"]));
        expect(result.current.failed).toBe(false);
        rerender({ scoped: null });
        expect(result.current.failed).toBe(false);
    });

    it("back on a project that failed before, its old failure does not show while it is asked again", async () => {
        const again = held();
        const betaAnswers = [Promise.reject(new Error("first")), again.promise];
        // Gamma's list never lands: the scope comes back before it does.
        mockApi.mockImplementation((_command: string, args: { projectPath: string }) =>
            args.projectPath === BETA.path ? betaAnswers.shift() : held().promise,
        );
        const { result, rerender } = renderHook(({ scoped }) => useScopedProjectSessions(scoped, ALPHA, NONE), {
            initialProps: { scoped: BETA as ClaudeProject | null },
        });
        await waitFor(() => expect(result.current.failed).toBe(true));
        rerender({ scoped: GAMMA });
        expect(result.current.failed).toBe(false);
        rerender({ scoped: BETA });
        expect(result.current.failed).toBe(false);
        expect(listCalls(BETA)).toHaveLength(2);
        await act(async () => again.resolve([session("b1")]));
        expect(result.current).toMatchObject({ failed: false, sessions: [expect.objectContaining({ session_id: "b1" })] });
    });

    it("a failure landing after unmount is dropped", async () => {
        const beta = held();
        mockApi.mockReturnValue(beta.promise);
        const { unmount } = renderHook(() => useScopedProjectSessions(BETA, ALPHA, NONE));
        unmount();
        await act(async () => beta.reject(new Error("late")));
        expect(console.error).not.toHaveBeenCalled();
    });

    it("the open project is never asked for, and never fails", () => {
        const open = [session("a1")];
        const { result } = renderHook(() => useScopedProjectSessions(ALPHA, ALPHA, open));
        expect(result.current).toMatchObject({ sessions: open, failed: false });
        expect(mockApi).not.toHaveBeenCalled();
    });
});
