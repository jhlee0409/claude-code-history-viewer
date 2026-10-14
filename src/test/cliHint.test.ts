/**
 * CLI / deep-link hints against the real store (plan §4.3, §9b F4, D14).
 *
 * Priority: an explicit hint wins over what is on screen. Only a navigation
 * that starts after the hint was accepted (the user's click, a newer hint, a
 * browser back) supersedes it; a reload does not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { useAppStore } from "@/store/useAppStore";
import { selectPlace } from "@/store/slices/navigationSlice";
import { openSessionHint } from "@/lib/preloadSession";

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
});
const sessionOf = (p: ClaudeProject, id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `${p.path}/${id}.jsonl`,
  project_name: p.name,
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
});

const A = project("a");
const B = project("b");
const A1 = sessionOf(A, "11111111-aaaa");
const B1 = sessionOf(B, "22222222-bbbb");
const B2 = sessionOf(B, "33333333-cccc");
const BY_PROJECT: Record<string, ClaudeSession[]> = { [A.path]: [A1], [B.path]: [B1, B2] };

/** Resolver scans (`load_project_sessions`) wait while this is set. */
let holdScan: Promise<void> | null = null;

const t = (_key: string, fallback?: string) => fallback ?? "";
const pristine = useAppStore.getState();
const where = () => {
  const place = selectPlace(useAppStore.getState());
  return [place.view, place.project?.path ?? null, place.session?.filePath ?? null];
};

beforeEach(() => {
  holdScan = null;
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const sessions = BY_PROJECT[String(args.projectPath)] ?? [];
    if (command === "load_project_sessions") {
      if (holdScan) await holdScan;
      return sessions;
    }
    if (command === "load_provider_sessions_page") {
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    if (command === "load_provider_messages_paginated") {
      return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
    }
    if (command === "get_session_subagents") return [];
    return null;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
  window.history.replaceState({}, "", "/");
});

describe("CLI / deep-link hint", () => {
  it("a second launch while a session is open opens the hinted session (F4)", async () => {
    await useAppStore.getState().navigate({ view: "conversation", project: A, session: A1 });

    const result = await openSessionHint({ kind: "uuid", value: B1.actual_session_id }, { t });

    expect(result.matched).toBe(true);
    expect(where()).toEqual(["conversation", B.path, B1.file_path]);
  });

  it("wins over a non-conversation screen and lands on the conversation", async () => {
    await useAppStore.getState().navigate({ view: "conversation", project: A, session: A1 });
    await useAppStore.getState().navigate({ view: "globalStats" });

    await openSessionHint({ kind: "uuid", value: B1.actual_session_id }, { t });

    expect(where()).toEqual(["conversation", B.path, B1.file_path]);
  });

  it("carries a deep link's message target without writing browser history", async () => {
    const before = window.history.length;

    await openSessionHint(
      { kind: "uuid", value: B1.actual_session_id },
      { t, messageId: "m-9" }
    );

    expect(useAppStore.getState().targetMessageUuid).toBe("m-9");
    expect(window.history.length).toBe(before);
  });

  it("loses to the user's click while it is still resolving", async () => {
    let release!: () => void;
    holdScan = new Promise((resolve) => {
      release = resolve;
    });
    const pending = openSessionHint({ kind: "uuid", value: B1.actual_session_id }, { t });

    await useAppStore.getState().navigate({ view: "conversation", project: A, session: A1 });
    release();

    await expect(pending).resolves.toMatchObject({ matched: false });
    expect(where()).toEqual(["conversation", A.path, A1.file_path]);
  });

  it("is not cancelled by a reload while it resolves", async () => {
    await useAppStore.getState().navigate({ view: "conversation", project: A, session: A1 });
    let release!: () => void;
    holdScan = new Promise((resolve) => {
      release = resolve;
    });
    const pending = openSessionHint({ kind: "uuid", value: B1.actual_session_id }, { t });

    await useAppStore.getState().reloadCurrent("watcher");
    release();

    await expect(pending).resolves.toMatchObject({ matched: true });
    expect(where()).toEqual(["conversation", B.path, B1.file_path]);
  });

  it("a newer hint supersedes an older one still resolving", async () => {
    let release!: () => void;
    holdScan = new Promise((resolve) => {
      release = resolve;
    });
    const older = openSessionHint({ kind: "uuid", value: A1.actual_session_id }, { t });
    const newer = openSessionHint({ kind: "uuid", value: B2.actual_session_id }, { t });
    release();

    await expect(newer).resolves.toMatchObject({ matched: true });
    await expect(older).resolves.toMatchObject({ matched: false });
    expect(where()).toEqual(["conversation", B.path, B2.file_path]);
  });
});
