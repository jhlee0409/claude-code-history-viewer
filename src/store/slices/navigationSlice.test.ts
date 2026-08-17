import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeSession } from "@/types";
import { createNavigationSlice } from "./navigationSlice";

const session: ClaudeSession = {
  session_id: "display-session",
  actual_session_id: "canonical-session",
  file_path: "/tmp/session.jsonl",
  project_name: "demo",
  message_count: 1,
  first_message_time: "2026-08-09T00:00:00Z",
  last_message_time: "2026-08-09T00:00:00Z",
  last_modified: "2026-08-09T00:00:00Z",
  has_tool_use: false,
  has_errors: false,
};

describe("navigationSlice WebUI history", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, "", "/");
  });

  it("pushes the selected session and target message into the URL", () => {
    const set = vi.fn();
    const get = () => ({ selectedSession: session });
    const slice = createNavigationSlice(set as never, get as never, {} as never);

    slice.navigateToMessage("message-123");

    expect(set).toHaveBeenCalledWith({
      targetMessageUuid: "message-123",
      shouldHighlightTarget: true,
    });
    expect(readLocation()).toEqual({
      session: "canonical-session",
      message: "message-123",
    });
  });

  it("can replace or suppress browser-history updates", () => {
    const set = vi.fn();
    const get = () => ({ selectedSession: session });
    const slice = createNavigationSlice(set as never, get as never, {} as never);
    const replaceState = vi.spyOn(window.history, "replaceState");

    slice.navigateToMessage("message-123", { history: "replace" });
    slice.navigateToMessage("message-456", { history: "none" });

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(readLocation()).toEqual({
      session: "canonical-session",
      message: "message-123",
    });
  });
});

function readLocation() {
  const url = new URL(window.location.href);
  return {
    session: url.searchParams.get("session"),
    message: url.searchParams.get("msg"),
  };
}
