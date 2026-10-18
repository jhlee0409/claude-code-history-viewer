/**
 * A session row opens in the project that lists it, never in another project
 * that happens to carry the same name (T7 re-review F2).
 *
 * Codex names a project and its sessions after the last segment of the
 * working directory, so `/work/a/repo` and `/work/b/repo` are both "repo";
 * its session files live under `~/.codex/sessions`, not under the project's
 * `codex://` path. The shell used to fall back to the first project with the
 * session's `project_name`, opening (and recording in Recent) the wrong one.
 *
 * Driven through the real shell: App, AppLayout, ProjectTree and the real
 * store; only screen bodies and the backend are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, waitFor, within } from "@testing-library/react";
import type { MouseEvent, ReactNode } from "react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  Toaster: () => null,
}));
const clipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>(async () => {}));
vi.mock("@/utils/clipboard", () => ({ copyTextToClipboard: clipboard }));
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
vi.mock("@/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));
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
import { useSessionEditing } from "@/components/SessionItem/hooks/useSessionEditing";

type Provider = "claude" | "codex";

const projectAt = (provider: Provider, dir: "a" | "b", lastModified: string): ClaudeProject => ({
  name: "repo",
  path: provider === "claude" ? `/home/u/.claude/projects/-work-${dir}-repo` : `codex:///work/${dir}/repo`,
  actual_path: `/work/${dir}/repo`,
  session_count: 1,
  message_count: 1,
  last_modified: lastModified,
  provider,
});
const sessionIn = (p: ClaudeProject, id: string, summary: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path:
    p.provider === "claude"
      ? `${p.path}/${id}.jsonl`
      : `/home/u/.codex/sessions/2026/10/17/rollout-2026-10-17T00-00-00-${id}.jsonl`,
  project_name: "repo",
  provider: p.provider as ClaudeSession["provider"],
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "2026-10-17T00:00:00.000Z",
  has_errors: false,
  has_tool_use: false,
  summary,
});

function fixture(provider: Provider) {
  // A is listed first (newer), so "the first project named repo" is A.
  const A = projectAt(provider, "a", "2026-10-17T00:00:00.000Z");
  const B = projectAt(provider, "b", "2026-10-16T00:00:00.000Z");
  const A1 = sessionIn(A, "a1", "Alpha one");
  const B1 = sessionIn(B, "b1", "Beta one");
  const lists: Record<string, ClaudeSession[]> = { [A.path]: [A1], [B.path]: [B1] };
  return { A, B, A1, B1, lists };
}

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();

function serve(lists: Record<string, ClaudeSession[]>) {
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const list = lists[String(args.projectPath)] ?? [];
    switch (command) {
      case "load_project_sessions":
      case "load_provider_sessions":
        return list;
      case "load_provider_sessions_page":
        return { sessions: list, total: list.length, nextOffset: list.length, hasMore: false };
      case "load_provider_messages_paginated":
        return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
      case "get_session_subagents":
      case "search_messages":
        return [];
      default:
        return null;
    }
  });
}

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  // An earlier test's navigation leaves its session in the URL (the WebUI
  // deep link), which the next shell would open on start.
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  apiMock.mockReset();
  clipboard.mockClear();
  useAppStore.setState(pristine, true);
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
    </ThemeProvider>
  );
  await act(async () => {});
}

const sidebar = () => document.getElementById("project-explorer")!;
const projectRow = (p: ClaudeProject) =>
  sidebar().querySelector<HTMLElement>(`[data-row="project"][data-project-path="${p.path}"]`)!;

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

function openIn(p: ClaudeProject, sessions: ClaudeSession[], projects: ClaudeProject[]) {
  useAppStore.setState({
    claudePath: "/home/u/.claude",
    activeProviders: ["claude", "codex"],
    projects,
    selectedProject: p,
    sessions,
    sessionsTotal: sessions.length,
    hasMoreSessions: false,
    selectedSession: null,
    view: "conversation",
    isMetadataLoaded: true,
    isInspectorOpen: false,
  } as never);
}

describe.each(["codex", "claude"] as const)("%s: two projects named \"repo\"", (provider) => {
  it("a row of the open project B opens in B and Recent records B", async () => {
    const { A, B, B1, lists } = fixture(provider);
    serve(lists);
    openIn(B, [B1], [A, B]);
    await renderShell();

    await click(within(sidebar()).getByText("Beta one"));

    await waitFor(() => expect(state().selectedSession?.file_path).toBe(B1.file_path));
    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().recentSessions[0]?.ref.projectPath).toBe(B.path);
  });

  it("a row of B's preview, with A open, opens in B and Recent records B", async () => {
    const { A, B, A1, B1, lists } = fixture(provider);
    serve(lists);
    openIn(A, [A1], [A, B]);
    await renderShell();
    expect(projectRow(B).getAttribute("aria-expanded")).toBe("false");

    await click(projectRow(B).querySelector("[data-chevron]")!);
    const row = await within(sidebar()).findByText("Beta one");
    await click(row);

    await waitFor(() => expect(state().selectedSession?.file_path).toBe(B1.file_path));
    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().recentSessions[0]?.ref.projectPath).toBe(B.path);
  });

  it("the resume command of B's row runs in B's directory, with A open", async () => {
    const { A, B, A1, B1 } = fixture(provider);
    openIn(A, [A1], [A, B]);

    const { result } = renderHook(() => useSessionEditing(B1, B));
    await act(async () => {
      await result.current.handleCopyResumeCommand({ stopPropagation() {} } as unknown as MouseEvent);
    });

    expect(clipboard).toHaveBeenCalledTimes(1);
    const command = clipboard.mock.calls[0]![0];
    expect(command).toContain(B.actual_path);
    expect(command).not.toContain(A.actual_path);
  });
});

it("codex: a row of the open project's full list (Show all) opens in that project", async () => {
  const { A, B, lists } = fixture("codex");
  const many = Array.from({ length: 7 }, (_, i) => sessionIn(B, `b${i + 1}`, `Beta ${i + 1}`));
  lists[B.path] = many;
  serve(lists);
  openIn(B, many, [A, B]);
  await renderShell();

  await click(within(sidebar()).getByText(i18n.t("project.sessions.showAll", { count: many.length })));
  await click(within(sidebar()).getByText("Beta 7"));

  await waitFor(() => expect(state().selectedSession?.file_path).toBe(many[6]!.file_path));
  expect(state().selectedProject?.path).toBe(B.path);
  expect(state().recentSessions[0]?.ref.projectPath).toBe(B.path);
});
