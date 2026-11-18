/**
 * Several desktop windows (issue #656): what each window keeps to itself and
 * what reaches every window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, emit, listeners } = vi.hoisted(() => ({
  api: vi.fn(),
  emit: vi.fn(async () => {}),
  listeners: new Map<string, { handler: (event: { payload: unknown }) => void; options: unknown }>(),
}));

vi.mock("@/services/api", () => ({ api }));
vi.mock("@tauri-apps/api/event", () => ({
  emit,
  listen: async (event: string, handler: (event: { payload: unknown }) => void, options?: unknown) => {
    listeners.set(event, { handler, options });
    return () => listeners.delete(event);
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ get: async () => null, set: async () => {}, save: async () => {} }),
}));

import { toast } from "sonner";
import { getCommand, runCommand, type CommandContext } from "@/commands/registry";
import { shortcutFor } from "@/commands/keys";
import { initialDocumentState } from "@/store/slices/documentSlice";
import { TABS_STORAGE_KEY } from "@/navigation/documents";
import {
  openNewWindow,
  openWindowTarget,
  projectWindowTarget,
  sessionWindowTarget,
} from "@/navigation/windows";
import { listenForSettingChanges, listenForUserMetadataChanges, saveSetting } from "@/services/settingsSync";
import { useAppStore } from "@/store/useAppStore";
import { currentWindowLabel, isMainWindow } from "@/utils/platform";
import type { ClaudeProject, ClaudeSession, UserMetadata } from "@/types";

const inWindow = (label: string) => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label } },
  };
};
const inWebUI = () => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const project = { name: "repo", path: "/home/u/.claude/projects/-repo", provider: "claude" } as ClaudeProject;
const session = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/home/u/.claude/projects/-repo/s1.jsonl",
  provider: "claude",
} as ClaudeSession;

beforeEach(() => {
  api.mockReset();
  emit.mockClear();
  listeners.clear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  inWebUI();
  localStorage.clear();
});

describe("window identity", () => {
  it("names the desktop window this page runs in; the WebUI is the main window", () => {
    inWebUI();
    expect(currentWindowLabel()).toBe("main");
    expect(isMainWindow()).toBe(true);
    inWindow("window-2");
    expect(currentWindowLabel()).toBe("window-2");
    expect(isMainWindow()).toBe(false);
  });
});

describe("tabs of the last run", () => {
  it("are restored in the launch window only; a later window starts with one empty tab", () => {
    localStorage.setItem(
      TABS_STORAGE_KEY,
      JSON.stringify({ version: 2, activeId: "a", documents: [{ id: "a", view: "conversation" }] }),
    );
    inWindow("main");
    const main = initialDocumentState();
    inWindow("window-2");
    const second = initialDocumentState();
    expect(second.documents).toHaveLength(1);
    expect(second.tabsRestorePending).toBe(false);
    expect(second.documents[0].id).not.toBe("a");
    // The launch window reads what is stored (whatever it makes of it).
    expect(main.documents).not.toEqual(second.documents);
  });
});

describe("New Window", () => {
  const context = (runtime: "desktop" | "web") =>
    ({
      runtime,
      tabs: { activeId: "t1", ids: ["t1"] },
      ownPlace: () => () => true,
      actions: { newWindow: vi.fn(async () => "window-2") },
    }) as unknown as CommandContext;

  it("is a desktop command on ⌘N and Ctrl+Shift+N", () => {
    const command = getCommand("window.new");
    expect(command?.menu).toBe("file");
    expect(shortcutFor(command?.shortcut ?? null, { os: "mac", runtime: "desktop" })).toBe("Cmd+N");
    expect(shortcutFor(command?.shortcut ?? null, { os: "win", runtime: "desktop" })).toBe("Ctrl+Shift+N");
    expect(shortcutFor(command?.shortcut ?? null, { os: "linux", runtime: "desktop" })).toBe("Ctrl+Shift+N");
    const desktop = context("desktop");
    expect(runCommand("window.new", desktop)).toBe(true);
    expect(desktop.actions.newWindow).toHaveBeenCalledOnce();
    const web = context("web");
    expect(runCommand("window.new", web)).toBe(false);
    expect(web.actions.newWindow).not.toHaveBeenCalled();
  });

  it("asks the backend for a window, empty or on a project or session", async () => {
    api.mockResolvedValue("window-2");
    await openNewWindow();
    expect(api).toHaveBeenLastCalledWith("open_window", { target: null });
    await openNewWindow(projectWindowTarget(project));
    expect(api).toHaveBeenLastCalledWith("open_window", {
      target: { kind: "project", project: { provider: "claude", path: project.path } },
    });
    await openNewWindow(sessionWindowTarget(session, project));
    expect(api).toHaveBeenLastCalledWith("open_window", {
      target: {
        kind: "session",
        session: {
          provider: "claude",
          filePath: session.file_path,
          sessionId: "s1",
          actualSessionId: "s1",
          projectPath: project.path,
        },
      },
    });
  });
});

describe("opening what a window was opened for", () => {
  it("opens its project the way the sidebar does, or says it is gone", async () => {
    useAppStore.setState({ projects: [project] });
    const openProject = vi.fn(async () => true);
    expect(await openWindowTarget(projectWindowTarget(project), { openProject })).toBe(true);
    expect(openProject).toHaveBeenCalledWith(project);
    useAppStore.setState({ projects: [] });
    expect(await openWindowTarget(projectWindowTarget(project), { openProject })).toBe(false);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("reports a session that is gone and stays on the start screen", async () => {
    useAppStore.setState({ projects: [project], selectedProject: null });
    api.mockResolvedValue([]);
    const opened = await openWindowTarget(sessionWindowTarget(session, project), {
      openProject: vi.fn(),
    });
    expect(opened).toBe(false);
    expect(api).toHaveBeenCalledWith("load_project_sessions", expect.objectContaining({ projectPath: project.path }));
    expect(toast.error).toHaveBeenCalledOnce();
    expect(useAppStore.getState().selectedSession).toBeNull();
  });
});

describe("settings shared by every window", () => {
  it("announces a saved preference with the window it came from", async () => {
    inWindow("window-2");
    await saveSetting("fontScale", 110);
    expect(emit).toHaveBeenCalledWith("settings-changed", { key: "fontScale", value: 110, origin: "window-2" });
  });

  it("announces nothing in the WebUI", async () => {
    inWebUI();
    await saveSetting("fontScale", 110);
    expect(emit).not.toHaveBeenCalled();
  });

  it("applies another window's change and ignores its own", async () => {
    inWindow("main");
    const applied = vi.fn();
    const stop = listenForSettingChanges(applied);
    await flush();
    const settings = listeners.get("settings-changed");
    settings?.handler({ payload: { key: "theme", value: "dark", origin: "main" } });
    settings?.handler({ payload: { key: "theme", value: "light", origin: "window-2" } });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledWith("theme", "light");
    stop();
    expect(listeners.has("settings-changed")).toBe(false);
  });

  it("applies preferences in memory, ignoring malformed values", () => {
    const { applySharedSetting } = useAppStore.getState();
    applySharedSetting("fontScale", 120);
    applySharedSetting("sessionSortOrder", "oldest");
    applySharedSetting("sessionSortOrder", "sideways");
    applySharedSetting("showInlineTokenUsage", true);
    applySharedSetting("unknown", 1);
    const state = useAppStore.getState();
    expect(state.fontScale).toBe(120);
    expect(state.sessionSortOrder).toBe("oldest");
    expect(state.showInlineTokenUsage).toBe(true);
  });
});

describe("user metadata shared by every window", () => {
  const metadata = (names: Record<string, string>): UserMetadata => ({
    version: 1,
    sessions: Object.fromEntries(Object.entries(names).map(([id, customName]) => [id, { customName }])),
    projects: {},
    settings: {},
  });

  it("takes each announced save", async () => {
    inWindow("window-2");
    const stop = listenForUserMetadataChanges((saved) => useAppStore.getState().applySharedMetadata(saved));
    await flush();
    listeners.get("user-metadata-changed")?.handler({ payload: metadata({ s1: "renamed elsewhere" }) });
    expect(useAppStore.getState().getSessionDisplayName("s1")).toBe("renamed elsewhere");
    stop();
  });

  it("never lets an answer older than an announcement land over it", async () => {
    useAppStore.setState({ userMetadata: metadata({}) });
    let answer: (value: UserMetadata) => void = () => {};
    api.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const writing = useAppStore.getState().updateSessionMetadata("s1", { customName: "mine" });
    await flush();
    // Another window saved after this one: announced before this answer arrives.
    useAppStore.getState().applySharedMetadata(metadata({ s1: "mine", s2: "theirs" }));
    answer(metadata({ s1: "mine" }));
    await writing;
    expect(Object.keys(useAppStore.getState().userMetadata.sessions).sort()).toEqual(["s1", "s2"]);
  });
});
