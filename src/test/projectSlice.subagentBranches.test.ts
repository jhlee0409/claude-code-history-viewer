import { afterEach, describe, expect, it, vi } from "vitest";
import { openMessageResult } from "@/navigation/paletteOpen";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage, ClaudeProject, ClaudeSession } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn() }));

const project: ClaudeProject = {
  provider: "kilo", path: "kilo://test", actual_path: "/test", name: "Test project",
  session_count: 2, subagent_count: 1, message_count: 3, last_modified: "2026-11-03T00:00:00Z",
};
const session = (id: string, parent?: string): ClaudeSession => ({
  provider: "kilo", session_id: `kilo://${id}`, actual_session_id: id, file_path: `${project.path}/${id}`,
  parent_session_id: parent, project_name: project.name, message_count: 1, summary: id,
  first_message_time: project.last_modified, last_message_time: project.last_modified,
  last_modified: project.last_modified, has_tool_use: false, has_errors: false,
});
const newest = session("newest");
const old = session("old");
const run = session("run", old.session_id);
const hit: ClaudeMessage = {
  uuid: "msg-run", sessionId: run.actual_session_id, projectPath: project.path, provider: "kilo",
  type: "user", content: "Find this subagent message", timestamp: project.last_modified,
};
const initial = useAppStore.getState();

afterEach(() => {
  useAppStore.setState(initial);
  vi.mocked(api).mockReset();
});

describe("database subagent branch anchors", () => {
  it("opens a search hit off-page, survives a refresh, and deduplicates when its page arrives", async () => {
    useAppStore.setState({
      projects: [project], selectedProject: project, sessions: [newest], sessionsTotal: 2,
      sessionsOffset: 1, hasMoreSessions: true, selectedSession: null,
    });
    vi.mocked(api).mockImplementation(async (command, payload) => {
      if (command === "load_provider_sessions") return [newest, old, run];
      if (command === "load_provider_messages_paginated") {
        return { messages: [hit], total_count: 1, next_offset: 1, has_more: false };
      }
      if (command === "get_session_subagents") return [];
      if (command !== "load_provider_sessions_page") throw new Error(`Unexpected ${command}`);
      if (payload?.offset === 1) {
        return { sessions: [old, run], total: 2, subagentCount: 1, nextOffset: 2, hasMore: false };
      }
      expect(payload?.anchorSessionPath).toBe(run.file_path);
      const anchorOnly = payload?.limit === 0;
      return {
        sessions: anchorOnly ? [old, run] : [newest, old, run], total: 2,
        subagentCount: 1, nextOffset: anchorOnly ? 0 : 1, hasMore: true,
      };
    });
    const get = useAppStore.getState;

    expect(await openMessageResult(hit)).toBe(true);
    expect(get().selectedSession?.file_path).toBe(run.file_path);
    expect(get().targetMessageUuid).toBe(hit.uuid);
    expect(get().sessions).toEqual([old, run, newest]);
    expect(get().sessionsOffset).toBe(1);

    await get().reloadProjectSessions(project);
    expect(get().selectedSession?.session_id).toBe(run.session_id);
    expect(get().sessionsOffset).toBe(1);
    await get().loadMoreSessions();
    expect(get().sessions.map((row) => row.session_id)).toEqual([newest.session_id, old.session_id, run.session_id]);
    expect(get().sessionsOffset).toBe(2);
    expect(get().hasMoreSessions).toBe(false);
  });
});
