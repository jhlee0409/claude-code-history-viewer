/**
 * claude.ai account exports (#674): the store actions that register and
 * forget an export, and the Settings section that drives them.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createMetadataSlice } from "../store/slices/metadataSlice";
import type { FullAppStore } from "../store/slices/types";
import type { ClaudeProject, ProviderId, UserMetadata } from "../types";
import { DEFAULT_USER_METADATA } from "../types";
import { ClaudeAiExportsSection } from "../components/SettingsManager/sections/ClaudeAiExportsSection";

const mockApi = vi.fn();
vi.mock("@/services/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const platform = vi.hoisted(() => ({ tauri: false }));
vi.mock("@/utils/platform", () => ({ isTauri: () => platform.tauri, isWindows: () => false }));

const EXPORT = "/Users/me/Downloads/data-2026-11-18.zip";
const exportProject: ClaudeProject = {
  name: "Claude.ai",
  path: "claude-ai://89eecd2a602885c0/chats",
  actual_path: "claude-ai://89eecd2a602885c0/chats",
  session_count: 1,
  message_count: 2,
  last_modified: "2026-02-14T10:04:41.000Z",
  provider: "claude-ai",
};

function metadataWith(exports: { path: string; label?: string }[]): UserMetadata {
  return {
    ...DEFAULT_USER_METADATA,
    settings: { ...DEFAULT_USER_METADATA.settings, claudeAiExports: exports },
  };
}

function makeStore(activeProviders: ProviderId[]) {
  const scanProjects = vi.fn(async () => undefined);
  const clearProjectSelection = vi.fn();
  const store = create<FullAppStore>()((set, get, api) => ({
    ...(createMetadataSlice(set, get, api) as unknown as FullAppStore),
    activeProviders,
    setActiveProviders: (ids: ProviderId[]) => set({ activeProviders: ids }),
    scanProjects,
    clearProjectSelection,
    projects: [] as ClaudeProject[],
    selectedProject: null,
  }));
  return { store, scanProjects, clearProjectSelection };
}

describe("claude.ai export store actions", () => {
  beforeEach(() => mockApi.mockReset());

  it("registering an export saves it, shows the provider and rescans", async () => {
    const { store, scanProjects } = makeStore(["claude"]);
    mockApi.mockResolvedValueOnce({
      metadata: metadataWith([{ path: EXPORT, label: "Personal" }]),
      conversations: 4,
      projects: 3,
    });

    const added = await store.getState().addClaudeAiExport(EXPORT, "Personal");

    expect(mockApi).toHaveBeenCalledWith("add_claude_ai_export", { path: EXPORT, label: "Personal" });
    expect(added.conversations).toBe(4);
    expect(store.getState().userMetadata.settings.claudeAiExports).toEqual([
      { path: EXPORT, label: "Personal" },
    ]);
    expect(store.getState().activeProviders).toEqual(["claude", "claude-ai"]);
    expect(scanProjects).toHaveBeenCalledTimes(1);
  });

  it("a refused export changes nothing", async () => {
    const { store, scanProjects } = makeStore(["claude"]);
    mockApi.mockRejectedValueOnce("Not a claude.ai export: no conversations.json found");

    await expect(store.getState().addClaudeAiExport(EXPORT)).rejects.toBe(
      "Not a claude.ai export: no conversations.json found"
    );
    expect(store.getState().activeProviders).toEqual(["claude"]);
    expect(scanProjects).not.toHaveBeenCalled();
  });

  it("removing the last export drops the provider and leaves an open export project", async () => {
    const { store, scanProjects, clearProjectSelection } = makeStore(["claude", "claude-ai"]);
    store.setState({
      userMetadata: metadataWith([{ path: EXPORT }]),
      selectedProject: exportProject,
      projects: [],
    });
    mockApi.mockResolvedValueOnce(metadataWith([]));

    await store.getState().removeClaudeAiExport(EXPORT);

    expect(mockApi).toHaveBeenCalledWith("remove_claude_ai_export", { path: EXPORT });
    expect(store.getState().activeProviders).toEqual(["claude"]);
    expect(scanProjects).toHaveBeenCalledTimes(1);
    expect(clearProjectSelection).toHaveBeenCalledTimes(1);
  });

  it("removing an export when only claude.ai was shown falls back to Claude Code", async () => {
    const { store } = makeStore(["claude-ai"]);
    mockApi.mockResolvedValueOnce(metadataWith([]));
    await store.getState().removeClaudeAiExport(EXPORT);
    expect(store.getState().activeProviders).toEqual(["claude"]);
  });
});

const section = vi.hoisted(() => ({
  state: {
    userMetadata: { settings: { claudeAiExports: [] as { path: string; label?: string }[] } },
    addClaudeAiExport: vi.fn(),
    removeClaudeAiExport: vi.fn(),
  },
}));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof section.state) => unknown) => selector(section.state),
    { getState: () => section.state }
  ),
}));

describe("ClaudeAiExportsSection", () => {
  beforeEach(() => {
    platform.tauri = false;
    section.state.userMetadata.settings.claudeAiExports = [];
    section.state.addClaudeAiExport.mockReset();
    section.state.removeClaudeAiExport.mockReset();
    toast.success.mockReset();
  });

  const openForm = () => {
    render(<ClaudeAiExportsSection isExpanded onToggle={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.claudeAiExports.add" }));
  };

  it("adds a typed path with its label and reports what it holds", async () => {
    section.state.addClaudeAiExport.mockResolvedValue({ conversations: 4, projects: 3 });
    openForm();
    expect(screen.getByText("settings.claudeAiExports.webPathHint")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("settings.claudeAiExports.path"), {
      target: { value: ` ${EXPORT}/ ` },
    });
    fireEvent.change(screen.getByLabelText("settings.claudeAiExports.label"), {
      target: { value: "Personal" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "settings.claudeAiExports.add" }).at(-1)!);

    await waitFor(() =>
      expect(section.state.addClaudeAiExport).toHaveBeenCalledWith(EXPORT, "Personal")
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('settings.claudeAiExports.added {"count":4}')
    );
  });

  it("shows why the backend refused a path", async () => {
    section.state.addClaudeAiExport.mockRejectedValue("This looks like a ChatGPT export");
    openForm();
    fireEvent.change(screen.getByLabelText("settings.claudeAiExports.path"), {
      target: { value: EXPORT },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "settings.claudeAiExports.add" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("This looks like a ChatGPT export");
  });

  it("refuses an export that is already listed without asking the backend", () => {
    section.state.userMetadata.settings.claudeAiExports = [{ path: EXPORT }];
    openForm();
    fireEvent.change(screen.getByLabelText("settings.claudeAiExports.path"), {
      target: { value: EXPORT },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "settings.claudeAiExports.add" }).at(-1)!);
    expect(screen.getByRole("alert")).toHaveTextContent("settings.claudeAiExports.duplicate");
    expect(section.state.addClaudeAiExport).not.toHaveBeenCalled();
  });

  it("removes a listed export after confirmation", async () => {
    section.state.userMetadata.settings.claudeAiExports = [{ path: EXPORT, label: "Personal" }];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ClaudeAiExportsSection isExpanded onToggle={() => undefined} />);
    expect(screen.getByText("Personal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "settings.claudeAiExports.remove" }));
    await waitFor(() => expect(section.state.removeClaudeAiExport).toHaveBeenCalledWith(EXPORT));
  });

  it("is read-only on a read-only server", () => {
    section.state.userMetadata.settings.claudeAiExports = [{ path: EXPORT }];
    render(<ClaudeAiExportsSection isExpanded onToggle={() => undefined} readOnly />);
    expect(screen.getByText(EXPORT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings.claudeAiExports.add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "settings.claudeAiExports.remove" })).toBeNull();
  });
});
