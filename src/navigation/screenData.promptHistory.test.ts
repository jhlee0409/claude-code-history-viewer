/**
 * Session analytics of a prompt-history session (#764): its transcript, and
 * the usage its replies carried, are gone, so it is never ranked among the
 * project's sessions, and no earlier session's comparison stays beside it.
 * Its token totals are still asked for (the backend answers "not recorded").
 */
import { describe, expect, it, vi } from "vitest";
import type { FullAppStore } from "@/store/slices/types";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { loadSessionAnalytics } from "./screenData";

vi.mock("./ownership", () => ({
  ownPlace: () => () => true,
  ownWork: () => ({ ownsData: () => true, ownsFeedback: () => true }),
}));

const project = { path: "/home/u/.claude/projects/-a", provider: "claude" } as ClaudeProject;

const session = (overrides: Partial<ClaudeSession>): ClaudeSession =>
  ({
    session_id: "/home/u/.claude/projects/-a/abc.jsonl",
    actual_session_id: "abc",
    file_path: "/home/u/.claude/projects/-a/abc.jsonl",
    ...overrides,
  }) as ClaudeSession;

function fakeStore() {
  const store = {
    loadSessionComparison: vi.fn().mockResolvedValue({ rank_by_tokens: 1 }),
    loadSessionTokenStats: vi.fn().mockResolvedValue(undefined),
    setAnalyticsLoadingSessionComparison: vi.fn(),
    setAnalyticsSessionComparison: vi.fn(),
    setAnalyticsSessionComparisonError: vi.fn(),
  };
  return { store, get: () => store as unknown as FullAppStore };
}

describe("loadSessionAnalytics: prompt history (#764)", () => {
  it("does not compare a prompt-history session and clears any comparison", async () => {
    const { store, get } = fakeStore();
    const promptHistory = session({
      file_path: "/home/u/.claude/projects/-a/def.prompt-history",
      storage_type: "prompt_history",
    });

    await loadSessionAnalytics(get, project, promptHistory);

    expect(store.loadSessionComparison).not.toHaveBeenCalled();
    expect(store.setAnalyticsSessionComparison).toHaveBeenCalledWith(null);
    expect(store.loadSessionTokenStats).toHaveBeenCalledWith(promptHistory.file_path);
    expect(store.setAnalyticsSessionComparisonError).toHaveBeenCalledWith(null);
  });

  it("still compares a session with a transcript", async () => {
    const { store, get } = fakeStore();
    const transcript = session({});

    await loadSessionAnalytics(get, project, transcript);

    expect(store.loadSessionComparison).toHaveBeenCalledWith("abc", project.path);
    expect(store.setAnalyticsSessionComparison).toHaveBeenCalledWith(
      { rank_by_tokens: 1 },
      transcript.file_path,
    );
  });
});
