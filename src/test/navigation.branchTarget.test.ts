/**
 * A jump to a message in an alternative that is not shown (#782) switches it
 * in; when that alternative lies wholly before the loaded window the
 * transcript has no rows left to look the target up from, so the store pages
 * back to it itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { ClaudeMessage, ClaudeSession, ConversationBranches } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { useAppStore } from "@/store/useAppStore";
import { selectDisplayedMessages } from "@/store/slices/messageSlice";

const message = (uuid: string): ClaudeMessage =>
  ({ uuid, type: "user", sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", isSidechain: false }) as unknown as ClaudeMessage;

const session: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/home/u/.claude/projects/p/s1.jsonl",
  project_name: "p",
  message_count: 8,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
};

const old = ["old-0", "old-1", "old-2"];
const fresh = ["new-0", "new-1", "new-2"];
const file = ["u1", "fork", ...old, ...fresh].map(message);
const branches: ConversationBranches = {
  points: [{ parentUuid: "fork", optionIds: [0, 1], defaultOption: 1, parentOption: null }],
  options: [
    { point: 0, headUuid: "old-0", anchorUuid: "old-0" },
    { point: 0, headUuid: "new-0", anchorUuid: "new-0" },
  ],
  membership: Object.fromEntries([...old.map((u) => [u, 0]), ...fresh.map((u) => [u, 1])]),
};

describe("navigateToMessage into an alternative before the loaded window", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "get_provider_message_offset") {
        const index = file.findIndex((m) => m.uuid === args.messageUuid);
        return index === -1 ? null : file.length - 1 - index;
      }
      if (command === "load_provider_messages_paginated") {
        const end = file.length - (args.offset as number);
        const start = Math.max(0, end - (args.limit as number));
        return {
          messages: file.slice(start, end),
          total_count: file.length,
          has_more: start > 0,
          next_offset: (args.offset as number) + (end - start),
        };
      }
      return null;
    });
  });

  it("pages back to the target when the switched-in path has no loaded rows", async () => {
    // The window holds only the resumed alternative.
    useAppStore.setState({
      selectedSession: session,
      messages: fresh.map(message),
      conversationBranches: branches,
      pagination: { currentOffset: 3, pageSize: 3, totalCount: file.length, hasMore: true, isLoadingMore: false },
    });

    useAppStore.getState().navigateToMessage("old-1");

    expect(useAppStore.getState().branchSelections).toEqual({ fork: "old-0" });
    await waitFor(() => {
      expect(selectDisplayedMessages(useAppStore.getState()).map((m) => m.uuid)).toContain("old-1");
    });
    expect(useAppStore.getState().targetMessageUuid).toBe("old-1");
  });
});
