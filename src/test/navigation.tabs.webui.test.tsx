/**
 * WebUI history × tabs (plan §9b F1) through App's real popstate effect: a
 * URL names its session's tab (`?session=&msg=&tab=`). Browser back brings
 * that tab forward and moves inside it - it never overwrites the tab that
 * happens to be active - and a URL whose tab has been closed opens in a new
 * tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
/** The screens' data loader (`openView`); a test can hold it. */
const openViewMock = vi.hoisted(() => vi.fn(async (view: string): Promise<undefined> => void view));
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useAppKeyboard", () => ({ useAppKeyboard: () => {} }));
vi.mock("@/hooks/useExternalLinks", () => ({ useExternalLinks: () => {} }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ state: {}, actions: { openView: openViewMock }, computed: {} }),
}));
vi.mock("@/hooks/useUpdater", () => ({ useUpdater: () => ({ state: {} }) }));
vi.mock("@/hooks/useLiveStatusMessage", () => ({ useLiveStatusMessage: () => "" }));
vi.mock("@/hooks/useResizablePanel", () => ({
  useResizablePanel: () => ({ width: 256, isResizing: false, handleMouseDown: () => {} }),
}));
vi.mock("@/layouts/AppLayout", () => ({ AppLayout: () => null }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ isDesktop: false, isMobile: false }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import App from "@/App";
import { useAppStore } from "@/store/useAppStore";
import { activateTab, currentDocuments, newTab, openInNewTab } from "@/navigation/tabs";

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
});

const A = project("a");
const B = project("b");
const S1 = sessionOf(A, "s1");
const S2 = sessionOf(B, "s2");
const S3 = sessionOf(B, "s3");

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
const screens = { openView: async () => undefined };
const url = () => new URL(window.location.href).searchParams;

async function popTo(href: string) {
  window.history.replaceState({}, "", href);
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

/** Let every pending promise chain (a stale completion included) run out. */
async function settleAll() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  openViewMock.mockReset();
  openViewMock.mockImplementation(async () => undefined);
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const sessions = args.projectPath === A.path ? [S1] : [S2, S3];
    if (command === "load_project_sessions") return sessions;
    if (command === "load_provider_sessions_page") {
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    if (command === "load_provider_messages_paginated") {
      return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
    }
    if (command === "get_session_subagents") return [];
    return null;
  });
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
  window.history.replaceState({}, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("WebUI back/forward with tabs (§9b F1)", () => {
  it("tab1=S1 → ⌘click tab2=S2 → tab1 → back: tab 2 comes forward, tab 1 keeps S1", async () => {
    render(<App />);
    await act(async () => {
      await state().navigate({ view: "conversation", project: A, session: S1 });
    });
    const tab1 = state().activeDocumentId;
    expect(url().get("tab")).toBe(tab1);

    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: B, session: S2 }));
    });
    const tab2 = state().activeDocumentId;
    const tab2Url = window.location.href;
    expect(url().get("session")).toBe("s2");
    expect(url().get("tab")).toBe(tab2);

    await act(async () => {
      await activateTab(tab1, screens);
    });
    expect(url().get("session")).toBe("s1");
    expect(url().get("tab")).toBe(tab1);

    // Browser back: the URL of tab 2 showing S2.
    const pushes = vi.spyOn(window.history, "pushState");
    await popTo(tab2Url);

    await waitFor(() => expect(state().activeDocumentId).toBe(tab2));
    expect(state().selectedSession?.file_path).toBe(S2.file_path);
    const tabs = currentDocuments();
    expect(tabs.find((d) => d.id === tab1)?.session?.filePath).toBe(S1.file_path);
    expect(tabs).toHaveLength(2);
    // A popstate adds no history of its own.
    expect(pushes).not.toHaveBeenCalled();
  });

  it("back to a tab whose URL names another session moves inside that tab", async () => {
    render(<App />);
    await act(async () => {
      await state().navigate({ view: "conversation", project: B, session: S2 });
    });
    const tab1 = state().activeDocumentId;
    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: A, session: S1 }));
    });
    const tab2 = state().activeDocumentId;

    // An older entry of tab 1, from when it showed S3.
    await popTo(`/?session=s3&tab=${tab1}`);

    await waitFor(() => expect(state().selectedSession?.file_path).toBe(S3.file_path));
    expect(state().activeDocumentId).toBe(tab1);
    expect(currentDocuments().find((d) => d.id === tab2)?.session?.filePath).toBe(S1.file_path);
  });

  it("a superseded back writes nothing: the tab activated meanwhile keeps its session (review #1)", async () => {
    render(<App />);
    await act(async () => {
      await state().navigate({ view: "conversation", project: A, session: S1 });
      await state().navigate({ view: "analytics" });
    });
    const tabA = state().activeDocumentId;
    const tabAUrl = window.location.href;
    expect(url().get("session")).toBe("s1");
    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: B, session: S2 }));
    });
    const tabB = state().activeDocumentId;

    // Back to tab A's URL; a screen data load it starts is held. (The URL
    // names A's session, so A comes forward on the conversation: whatever
    // the activation still awaits when the user moves on must write nothing.)
    let releaseScreen = () => {};
    openViewMock.mockImplementation(() => new Promise<undefined>((resolve) => (releaseScreen = () => resolve(undefined))));
    await popTo(tabAUrl);
    await waitFor(() =>
      expect(
        openViewMock.mock.calls.length > 0 ||
          (state().activeDocumentId === tabA && state().selectedSession?.file_path === S1.file_path && !state().isLoadingMessages),
      ).toBe(true),
    );

    // The user switches to tab B before A's screen has loaded.
    openViewMock.mockImplementation(async () => undefined);
    await act(async () => {
      await activateTab(tabB, screens);
    });
    expect(state().selectedSession?.file_path).toBe(S2.file_path);

    releaseScreen();
    await settleAll();

    expect(state().activeDocumentId).toBe(tabB);
    expect(state().selectedSession?.file_path).toBe(S2.file_path);
    expect(currentDocuments().find((d) => d.id === tabA)?.session?.filePath).toBe(S1.file_path);
  });

  it("back to the blank tab's URL brings the blank tab forward; the new tab keeps its session (review #2)", async () => {
    render(<App />);
    const blank = state().activeDocumentId;
    // The start page's history entry names its tab too.
    const startUrl = window.location.href;
    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: A, session: S1 }));
    });
    const tabB = state().activeDocumentId;
    expect(tabB).not.toBe(blank);

    await popTo(startUrl);
    await settleAll();

    expect(state().activeDocumentId).toBe(blank);
    expect(state().selectedSession).toBeNull();
    expect(currentDocuments().find((d) => d.id === tabB)?.session?.filePath).toBe(S1.file_path);
  });

  it("a URL naming neither a tab nor a session leaves the open tab's session alone", async () => {
    render(<App />);
    await act(async () => {
      await state().navigate({ view: "conversation", project: A, session: S1 });
    });
    const tab = state().activeDocumentId;

    await popTo("/");
    await settleAll();

    expect(state().activeDocumentId).toBe(tab);
    expect(state().selectedSession?.file_path).toBe(S1.file_path);
    expect(state().selectedProject?.path).toBe(A.path);
  });

  it("an old URL naming no tab and a session that is gone leaves the open tab alone", async () => {
    render(<App />);
    await act(async () => {
      await state().navigate({ view: "conversation", project: A, session: S1 });
    });

    await popTo("/?session=gone");
    await settleAll();

    expect(state().selectedSession?.file_path).toBe(S1.file_path);
    expect(state().selectedProject?.path).toBe(A.path);
  });

  it("back/forward through mixed session and sessionless entries of three tabs", async () => {
    render(<App />);
    const tabA = state().activeDocumentId;
    const entries: string[] = [window.location.href]; // A, blank
    await act(async () => {
      await state().navigate({ view: "conversation", project: A, session: S1 });
    });
    entries.push(window.location.href); // A, S1
    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: B, session: S2 }));
    });
    const tabB = state().activeDocumentId;
    entries.push(window.location.href); // B, S2
    await act(async () => {
      await state().navigate({ view: "globalStats" });
    });
    await act(async () => {
      await newTab();
    });
    const tabC = state().activeDocumentId;
    entries.push(window.location.href); // C, blank
    expect(new Set(entries).size).toBe(4);
    expect(new URL(entries[3]!).searchParams.get("tab")).toBe(tabC);

    const at = () => [state().activeDocumentId, state().selectedSession?.file_path ?? null];
    const tabSession = (id: string) => currentDocuments().find((d) => d.id === id)?.session?.filePath ?? null;

    // Back: B (its session, on the conversation the URL names).
    await popTo(entries[2]!);
    await settleAll();
    expect(at()).toEqual([tabB, S2.file_path]);
    // Back: A at S1.
    await popTo(entries[1]!);
    await settleAll();
    expect(at()).toEqual([tabA, S1.file_path]);
    // Back: A before it had a session - A's session closes, its project stays; B keeps S2.
    await popTo(entries[0]!);
    await settleAll();
    expect(at()).toEqual([tabA, null]);
    expect(state().selectedProject?.path).toBe(A.path);
    expect(tabSession(tabB)).toBe(S2.file_path);
    // Forward: A at S1 again, in tab A.
    await popTo(entries[1]!);
    await settleAll();
    expect(at()).toEqual([tabA, S1.file_path]);
    // Forward: B; forward: the blank C. Nothing else changed.
    await popTo(entries[2]!);
    await settleAll();
    expect(at()).toEqual([tabB, S2.file_path]);
    await popTo(entries[3]!);
    await settleAll();
    expect(at()).toEqual([tabC, null]);
    expect(tabSession(tabA)).toBe(S1.file_path);
    expect(tabSession(tabB)).toBe(S2.file_path);
    expect(state().documents.map((d) => d.id)).toEqual([tabA, tabB, tabC]);
  });

  it("back to an app-screen tab's URL brings it forward on its screen and loads it", async () => {
    render(<App />);
    const tabA = state().activeDocumentId;
    await act(async () => {
      await state().navigate({ view: "globalStats" });
    });
    const tabAUrl = window.location.href;
    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: B, session: S2 }));
    });
    const tabB = state().activeDocumentId;
    openViewMock.mockClear();

    await popTo(tabAUrl);
    await settleAll();

    expect(state().activeDocumentId).toBe(tabA);
    expect(state().view).toBe("globalStats");
    expect(openViewMock).toHaveBeenCalledWith("globalStats");
    expect(currentDocuments().find((d) => d.id === tabB)?.session?.filePath).toBe(S2.file_path);
  });

  it("switching between two tabs on no session still names the tab in the URL", async () => {
    render(<App />);
    const tabA = state().activeDocumentId;
    await act(async () => {
      await newTab();
    });
    const tabB = state().activeDocumentId;
    expect(url().get("tab")).toBe(tabB);
    await act(async () => {
      await activateTab(tabA, screens);
    });
    expect(url().get("tab")).toBe(tabA);
  });

  it("a superseded back to a project-screen tab writes nothing once its screen data arrives (review #1)", async () => {
    render(<App />);
    const tabA = state().activeDocumentId;
    await act(async () => {
      await state().navigate({ view: "analytics", project: A });
    });
    const tabAUrl = window.location.href;
    expect(url().get("tab")).toBe(tabA);
    await act(async () => {
      await openInNewTab(() => state().navigate({ view: "conversation", project: B, session: S2 }));
    });
    const tabB = state().activeDocumentId;

    let releaseScreen = () => {};
    openViewMock.mockImplementation(() => new Promise<undefined>((resolve) => (releaseScreen = () => resolve(undefined))));
    await popTo(tabAUrl);
    await waitFor(() => expect(openViewMock).toHaveBeenCalledWith("analytics"));
    openViewMock.mockImplementation(async () => undefined);
    await act(async () => {
      await activateTab(tabB, screens);
    });

    releaseScreen();
    await settleAll();

    expect(state().activeDocumentId).toBe(tabB);
    expect(state().selectedSession?.file_path).toBe(S2.file_path);
    expect(state().view).toBe("conversation");
  });

  it("a URL whose tab was closed opens its session in a new tab", async () => {
    render(<App />);
    await act(async () => {
      await state().navigate({ view: "conversation", project: A, session: S1 });
    });
    const tab1 = state().activeDocumentId;

    await popTo("/?session=s2&tab=closed-tab");

    await waitFor(() => expect(state().selectedSession?.file_path).toBe(S2.file_path));
    expect(state().activeDocumentId).not.toBe(tab1);
    expect(currentDocuments().find((d) => d.id === tab1)?.session?.filePath).toBe(S1.file_path);
    expect(state().documents).toHaveLength(2);
  });
});
