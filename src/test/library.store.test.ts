/**
 * The sidebar library on the wired store (plan T7): opening a session adds it
 * to "Recent" (persisted, at most 12); starring records the session's ref;
 * a legacy star learns its ref once its project's sessions load; a library
 * entry opens through its ref, loading one project only. Also the A2 flow:
 * star A → move to B → open A from the library → restart → open again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession, MessagePage, UserMetadata } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import i18n from "@/i18n";
import { useAppStore } from "@/store/useAppStore";
import { RECENT_STORAGE_KEY, favoritesOf, loadRecent } from "@/navigation/library";
import { openSessionRef } from "@/navigation/openSessionRef";

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
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
  provider: "claude",
  summary: `summary ${id}`,
});

const A = project("a");
const B = project("b");
const A1 = sessionOf(A, "a1");
const B1 = sessionOf(B, "b1");
const LIST: Record<string, ClaudeSession[]> = { [A.path]: [A1], [B.path]: [B1] };
const PAGE: MessagePage = { messages: [], total_count: 0, has_more: false, next_offset: 0 };

/** The metadata the fake backend holds; `update_session_metadata` writes it. */
let disk: UserMetadata;
const pristine = useAppStore.getState();

beforeEach(() => {
  localStorage.clear();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
  disk = { version: 1, sessions: {}, projects: {}, settings: {} };
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case "load_provider_sessions_page": {
        const sessions = LIST[String(args.projectPath)] ?? [];
        return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
      }
      case "load_project_sessions":
        return LIST[String(args.projectPath)] ?? [];
      case "load_provider_messages_paginated":
        return PAGE;
      case "update_session_metadata": {
        const update = JSON.parse(JSON.stringify(args.update)) as Record<string, unknown>;
        const empty = Object.keys(update).length === 0;
        const sessions = { ...disk.sessions };
        if (empty) delete sessions[String(args.sessionId)];
        else sessions[String(args.sessionId)] = update;
        disk = { ...disk, sessions };
        return disk;
      }
      default:
        return null;
    }
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B], recentSessions: [] });
});

const state = () => useAppStore.getState();
const loadsOf = (command: string) => apiMock.mock.calls.filter(([c]) => c === command);

describe("recent sessions", () => {
  it("records each opened session, newest first, and persists the list", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await state().navigate({ view: "conversation", project: B, session: B1 });
    await state().navigate({ view: "analytics" });

    expect(state().recentSessions.map((e) => e.ref.filePath)).toEqual([B1.file_path, A1.file_path]);
    expect(loadRecent().map((e) => e.ref.filePath)).toEqual([B1.file_path, A1.file_path]);
    expect(JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]")[0].title).toBe("summary b1");
  });

  it("a screen switch or closing the session records nothing", async () => {
    await state().navigate({ view: "conversation", project: A });
    await state().navigate({ view: "analytics" });
    expect(state().recentSessions).toEqual([]);
  });
});

describe("favourites", () => {
  it("starring records the ref; unstarring drops star and ref", async () => {
    await state().toggleSessionFavorite(A1);
    expect(disk.sessions.a1).toEqual({
      starred: true,
      ref: { provider: "claude", filePath: A1.file_path, sessionId: "a1", actualSessionId: "a1" },
    });
    expect(favoritesOf(state().userMetadata).map((f) => f.sessionId)).toEqual(["a1"]);

    await state().toggleSessionFavorite(A1);
    expect(disk.sessions.a1).toBeUndefined();
    expect(favoritesOf(state().userMetadata)).toEqual([]);
  });

  it("a failed save says so", async () => {
    apiMock.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await state().toggleSessionFavorite(A1);
    expect(toastMock.error).toHaveBeenCalledWith(i18n.t("session.favorite.saveError"));
  });

  it("a legacy star (no ref) learns its ref when its project's sessions load", async () => {
    disk = { ...disk, sessions: { a1: { starred: true } } };
    useAppStore.setState({ userMetadata: disk });
    expect(favoritesOf(state().userMetadata)[0]?.ref).toBeNull();

    await state().backfillFavoriteRefs([A1, B1]);

    expect(disk.sessions.a1?.ref?.filePath).toBe(A1.file_path);
    expect(favoritesOf(state().userMetadata)[0]?.ref?.filePath).toBe(A1.file_path);
    expect(loadsOf("update_session_metadata")).toHaveLength(1);
  });
});

describe("openSessionRef", () => {
  it("star A, move to B, open A from the library, restart, open it again (A2)", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await state().toggleSessionFavorite(A1);
    await state().navigate({ view: "conversation", project: B, session: B1 });

    const [favourite] = favoritesOf(state().userMetadata);
    expect(await openSessionRef(favourite!.ref!)).toBe("opened");
    expect(state().selectedSession?.file_path).toBe(A1.file_path);
    // Only A's list was read to find it, not every project's.
    expect(loadsOf("load_project_sessions").map(([, a]) => a.projectPath)).toEqual([A.path]);

    // Restart: a fresh store with what is on disk.
    useAppStore.setState(pristine, true);
    useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B], userMetadata: disk });
    const [again] = favoritesOf(state().userMetadata);
    expect(await openSessionRef(again!.ref!)).toBe("opened");
    expect(state().selectedSession?.file_path).toBe(A1.file_path);
    expect(state().view).toBe("conversation");
  });

  it("uses the open project's list without loading it again", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await state().navigate({ session: null });
    apiMock.mockClear();
    expect(await openSessionRef({ provider: "claude", filePath: A1.file_path, sessionId: "a1" })).toBe("opened");
    expect(loadsOf("load_project_sessions")).toHaveLength(0);
  });

  it("a session that is gone says so and stays put", async () => {
    expect(await openSessionRef({ provider: "claude", filePath: "/p/a/gone.jsonl", sessionId: "gone" })).toBe(
      "notFound",
    );
    expect(await openSessionRef({ provider: "claude", filePath: "/elsewhere/x.jsonl", sessionId: "x" })).toBe(
      "notFound",
    );
    expect(toastMock.error).toHaveBeenCalledTimes(2);
    expect(state().selectedSession).toBeNull();
  });

  it("a navigation that starts while the list loads wins", async () => {
    let release: () => void = () => {};
    apiMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(LIST[A.path]))),
    );
    const opening = openSessionRef({ provider: "claude", filePath: A1.file_path, sessionId: "a1" });
    await state().navigate({ view: "globalStats" });
    release();
    expect(await opening).toBe("superseded");
    expect(state().view).toBe("globalStats");
    expect(state().selectedSession).toBeNull();
  });
});
