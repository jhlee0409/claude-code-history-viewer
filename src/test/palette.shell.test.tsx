/**
 * ⌘K palette picks, through the real shell (plan T10): App, AppLayout, the
 * header's palette button, the modal provider and container, the palette,
 * the shell's place openers and the real store and navigation. Only the
 * screens' bodies and the backend are stubbed.
 *
 * Each row picks a result and asserts where the app now is: the project,
 * the session, the explicit message target (which outranks a pending scroll
 * anchor, plan §4.3), the tab list for ⌘/Ctrl+Enter, and that a pick
 * superseded by a later navigation writes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toastMock), Toaster: () => null }));
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({ state: { isChecking: false, currentVersion: "1.0.0", hasUpdate: false } }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ platform: "desktop", isDesktop: true, isMobile: false }),
  DesktopOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  MobileOnly: () => null,
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("@/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/platform")>();
  // ⌘ is the action modifier in these rows, whatever the host OS.
  return { ...actual, isMacOS: () => true, isActionModifier: (e: { metaKey: boolean }) => e.metaKey };
});

const { screenStub } = vi.hoisted(() => ({
  screenStub: (name: string) => () => <div data-screen={name} />,
}));
vi.mock("@/components/MessageViewer", () => ({ MessageViewer: screenStub("MessageViewer") }));
vi.mock("@/components/TokenStatsViewer", () => ({ TokenStatsViewer: screenStub("TokenStatsViewer") }));
vi.mock("@/components/AnalyticsDashboard", () => ({ AnalyticsDashboard: screenStub("AnalyticsDashboard") }));
vi.mock("@/components/RecentEditsViewer", () => ({ RecentEditsViewer: screenStub("RecentEditsViewer") }));
vi.mock("@/components/SettingsManager", () => ({ SettingsManager: screenStub("SettingsManager") }));
vi.mock("@/components/SessionBoard/SessionBoard", () => ({ SessionBoard: screenStub("SessionBoard") }));
vi.mock("@/components/ArchiveManager", () => ({ ArchiveManager: screenStub("ArchiveManager") }));
vi.mock("@/components/MessageNavigator", () => ({
  MessageNavigator: (props: { asideId?: string }) => <aside id={props.asideId} data-screen="MessageNavigator" />,
}));
vi.mock("@/components/SimpleUpdateManager", () => ({ SimpleUpdateManager: () => null }));

import i18n from "@/i18n";
import App from "@/App";
import { ModalProvider } from "@/contexts/modal/ModalProvider";
import { ThemeProvider } from "@/contexts/theme";
import { useAppStore } from "@/store/useAppStore";
import { useLanguageStore } from "@/store/useLanguageStore";

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 2,
  message_count: 2,
  last_modified: "2026-01-02T00:00:00.000Z",
  provider: "claude",
});
const session = (owner: string, id: string, summary: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `/p/${owner}/${id}.jsonl`,
  project_name: owner,
  message_count: 2,
  first_message_time: "",
  last_message_time: "",
  last_modified: "2026-01-02T00:00:00.000Z",
  has_tool_use: false,
  has_errors: false,
  summary,
  provider: "claude",
});
const ALPHA = project("alpha");
const BETA = project("beta");
const S1 = session("alpha", "s1", "Alpha first conversation");
const S2 = session("alpha", "s2", "Alpha second conversation");
const B1 = session("beta", "b1", "Beta release notes");
const SESSIONS: Record<string, ClaudeSession[]> = { [ALPHA.path]: [S1, S2], [BETA.path]: [B1] };

const message = (uuid: string, sessionId: string, projectName: string, text: string) => ({
  uuid,
  sessionId,
  projectName,
  timestamp: "2026-01-02T00:00:00.000Z",
  type: "user",
  content: text,
  provider: "claude",
});

/** Search answers by query; a held project list per path (`hold`). */
let searchResults: Record<string, unknown[]> = {};
let held: Record<string, Promise<unknown>> = {};

const pristine = useAppStore.getState();
const pristineLanguage = useLanguageStore.getState();
const state = () => useAppStore.getState();
const t = (key: string) => i18n.t(key);

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
  useLanguageStore.setState(pristineLanguage, true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  searchResults = {};
  held = {};
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const path = String(args.projectPath ?? "");
    switch (command) {
      case "load_project_sessions":
      case "load_provider_sessions":
        if (held[path]) await held[path];
        return SESSIONS[path] ?? [];
      case "load_provider_sessions_page": {
        if (held[path]) await held[path];
        const list = SESSIONS[path] ?? [];
        return { sessions: list, total: list.length, nextOffset: list.length, hasMore: false };
      }
      case "load_provider_messages_paginated":
        return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
      case "get_session_subagents":
        return [];
      case "search_messages":
      case "search_all_providers":
        return searchResults[String(args.query)] ?? [];
      default:
        return null;
    }
  });
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    claudePath: "/home/.claude",
    projects: [ALPHA, BETA],
    sessions: [S1, S2],
    sessionsTotal: 2,
    selectedProject: ALPHA,
    selectedSession: S1,
    view: "conversation",
    isMetadataLoaded: true,
    isInspectorOpen: false,
    refreshAllConversations: vi.fn(async () => {}),
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderShell() {
  render(
    <ThemeProvider>
      <ModalProvider>
        <App />
      </ModalProvider>
    </ThemeProvider>,
  );
  await act(async () => {});
}

const paletteButton = () =>
  within(screen.getByRole("banner")).getAllByRole("button", { name: t("common.commandPalette") })[0]!;
const paletteField = () => screen.queryByPlaceholderText(t("globalSearch.placeholder"));

/** Open ⌘K from the toolbar and type `query`. */
async function openPaletteWith(query: string) {
  await act(async () => {
    fireEvent.click(paletteButton());
  });
  const field = await screen.findByPlaceholderText(t("globalSearch.placeholder"));
  await act(async () => {
    fireEvent.change(field, { target: { value: query } });
  });
  return field;
}

/** Highlight the option named `name` (arrow keys) and press Enter, ⌘ held when `meta`. */
async function pick(field: HTMLElement, name: RegExp, meta = false) {
  const option = await screen.findByRole("option", { name }, { timeout: 2000 });
  for (let i = 0; i < 20 && option.getAttribute("aria-selected") !== "true"; i++) {
    await act(async () => {
      fireEvent.keyDown(field, { key: "ArrowDown" });
    });
  }
  expect(option).toHaveAttribute("aria-selected", "true");
  await act(async () => {
    fireEvent.keyDown(field, { key: "Enter", metaKey: meta });
  });
}

describe("⌘K palette picks land on the right place (real shell)", () => {
  it("a project row opens the project", async () => {
    await renderShell();
    const field = await openPaletteWith("beta");
    await pick(field, /^beta/);
    await waitFor(() => expect(state().selectedProject?.path).toBe(BETA.path));
    expect(paletteField()).toBeNull();
    expect(state().selectedSession).toBeNull();
  });

  it("a session row of the open project opens that session", async () => {
    await renderShell();
    const field = await openPaletteWith("second");
    await pick(field, /Alpha second conversation/);
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(S2.file_path));
    expect(state().selectedProject?.path).toBe(ALPHA.path);
  });

  it("a recent session of another project opens it in its own project", async () => {
    useAppStore.setState({
      recentSessions: [
        { ref: { provider: "claude", filePath: B1.file_path, sessionId: "b1", projectPath: BETA.path }, title: B1.summary!, openedAt: 1 },
      ],
    });
    await renderShell();
    const field = await openPaletteWith("release");
    await pick(field, /Beta release notes/);
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(B1.file_path));
    expect(state().selectedProject?.path).toBe(BETA.path);
  });

  it("a message row of another project opens its session with the message as the target", async () => {
    searchResults["deploy"] = [message("mb", "b1", "beta", "how to deploy")];
    await renderShell();
    const field = await openPaletteWith("deploy");
    await pick(field, /how to deploy/);
    await waitFor(() => expect(state().targetMessageUuid).toBe("mb"));
    expect(state().selectedProject?.path).toBe(BETA.path);
    expect(state().selectedSession?.file_path).toBe(B1.file_path);
    expect(state().view).toBe("conversation");
  });

  it("the explicit target outranks the session's pending scroll anchor", async () => {
    searchResults["hello"] = [message("m1", "s1", "alpha", "hello there")];
    useAppStore.setState({
      pendingAnchor: { documentId: state().activeDocumentId, sessionPath: S1.file_path, anchor: { messageUuid: "old", offset: 0 } },
    } as never);
    await renderShell();
    const field = await openPaletteWith("hello");
    await pick(field, /hello there/);
    await waitFor(() => expect(state().targetMessageUuid).toBe("m1"));
    expect(state().pendingAnchor).toBeNull();
    expect(state().selectedSession?.file_path).toBe(S1.file_path);
  });

  it("⌘+Enter opens the pick in a new tab and keeps the old tab where it was", async () => {
    await renderShell();
    const before = state().activeDocumentId;
    const field = await openPaletteWith("second");
    await pick(field, /Alpha second conversation/, true);
    await waitFor(() => expect(state().documents).toHaveLength(2));
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(S2.file_path));
    expect(state().activeDocumentId).not.toBe(before);
    expect(state().documents.find((d) => d.id === before)?.session?.filePath).toBe(S1.file_path);
  });

  it("⌘+Enter on a message whose session is gone says so, and the new tab goes away", async () => {
    searchResults["ghost"] = [message("mg", "gone", "beta", "ghost message")];
    await renderShell();
    const field = await openPaletteWith("ghost");
    await pick(field, /ghost message/, true);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(t("globalSearch.sessionNotFound")));
    expect(state().documents).toHaveLength(1);
    expect(state().selectedSession?.file_path).toBe(S1.file_path);
  });

  it("a pick superseded by a later navigation writes nothing and says nothing", async () => {
    searchResults["deploy"] = [message("mb", "b1", "beta", "how to deploy")];
    let release!: () => void;
    held[BETA.path] = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderShell();
    const field = await openPaletteWith("deploy");
    await pick(field, /how to deploy/);
    // The lookup in beta is held; the user opens another session meanwhile.
    await act(async () => {
      await state().navigate({ view: "conversation", session: S2 });
    });
    await act(async () => {
      release();
    });
    await act(async () => {});
    expect(state().selectedSession?.file_path).toBe(S2.file_path);
    expect(state().targetMessageUuid).toBeNull();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
