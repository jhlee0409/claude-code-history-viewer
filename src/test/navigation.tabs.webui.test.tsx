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
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useAppKeyboard", () => ({ useAppKeyboard: () => {} }));
vi.mock("@/hooks/useExternalLinks", () => ({ useExternalLinks: () => {} }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ state: {}, actions: { openView: async () => undefined }, computed: {} }),
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
import { activateTab, currentDocuments, openInNewTab } from "@/navigation/tabs";

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

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
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
