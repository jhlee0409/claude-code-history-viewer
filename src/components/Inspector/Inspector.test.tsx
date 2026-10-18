/**
 * The inspector (plan T9a): tabs, keyboard, focus on open/close, Escape,
 * and the Tokens and Info tabs' data - owned by the open session, with
 * their loading and error states.
 *
 * Real store and real i18n (en); only the message navigator (moved as is,
 * covered by `MessageNavigator.*.test.tsx`), the clipboard and toasts are
 * stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession, SessionTokenStats } from "@/types";

const { clipboard, toastSuccess, toastError } = vi.hoisted(() => ({
  clipboard: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/utils/clipboard", () => ({ copyTextToClipboard: clipboard }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/MessageNavigator", () => ({
  MessageNavigator: (props: { embedded?: boolean; asideId?: string }) => (
    <div id={props.asideId} data-stub="MessageNavigator" data-embedded={String(props.embedded)} />
  ),
}));

import i18n from "@/i18n";
import { useAppStore } from "@/store/useAppStore";
import { INSPECTOR_STORAGE_KEY } from "@/store/slices/inspectorSlice";
import { Inspector } from "./Inspector";
import { INSPECTOR_TOGGLE_ID, toggleInspector } from "./inspectorFocus";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/me/alpha",
  session_count: 2,
  message_count: 10,
  last_modified: "2026-01-02T00:00:00.000Z",
  provider: "claude",
};
const session = (n: number): ClaudeSession => ({
  session_id: `s${n}`,
  actual_session_id: `uuid-${n}`,
  file_path: `/p/alpha/s${n}.jsonl`,
  project_name: "alpha",
  message_count: 42 + n,
  first_message_time: "2026-01-01T10:00:00.000Z",
  last_message_time: "2026-01-01T11:30:00.000Z",
  last_modified: "2026-01-01T11:30:00.000Z",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
});
const S1 = session(1);
const S2 = session(2);

const stats = (sessionId: string, total: number): SessionTokenStats => ({
  session_id: sessionId,
  project_name: "alpha",
  total_input_tokens: total / 2,
  total_output_tokens: total / 2,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_reasoning_tokens: 0,
  total_tokens: total,
  message_count: 3,
  first_message_time: "2026-01-01T10:00:00.000Z",
  last_message_time: "2026-01-01T11:30:00.000Z",
  most_used_tools: [],
  model_distribution: [
    {
      model_name: "claude-opus-4",
      message_count: 2,
      token_count: total * 0.75,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      reasoning_tokens: 0,
    },
    {
      model_name: "claude-haiku-4",
      message_count: 1,
      token_count: total * 0.25,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      reasoning_tokens: 0,
    },
  ],
});

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
const loadSessionTokenStats = vi.fn(async () => {});

function arrange(patch: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    selectedProject: PROJECT,
    selectedSession: S1,
    isInspectorOpen: true,
    loadSessionTokenStats,
    ...patch,
  });
}

/** The inspector beside a stand-in for the toolbar's toggle. */
function renderInspector() {
  return render(
    <>
      <button id={INSPECTOR_TOGGLE_ID} type="button">
        toggle
      </button>
      <Inspector messages={[]} width={280} isResizing={false} onResizeStart={vi.fn()} />
    </>,
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  useAppStore.setState(pristine, true);
  loadSessionTokenStats.mockClear();
  clipboard.mockClear();
  toastSuccess.mockClear();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("Inspector tabs", () => {
  it("names itself, lists Outline · Tokens · Info, and opens on the outline", () => {
    arrange();
    renderInspector();
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    const tablist = within(aside).getByRole("tablist", { name: "Inspector sections" });
    expect(within(tablist).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Outline", "Tokens", "Info"]);
    expect(tab("Outline")).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAttribute("aria-labelledby", tab("Outline").id);
    expect(tab("Outline")).toHaveAttribute("aria-controls", panel().id);
    // The navigator itself, moved as is, drawing contents only.
    const navigator = panel().querySelector('[data-stub="MessageNavigator"]');
    expect(navigator).toHaveAttribute("data-embedded", "true");
  });

  it("is one tab stop: only the selected tab is focusable", () => {
    arrange();
    renderInspector();
    expect(tab("Outline")).toHaveAttribute("tabindex", "0");
    expect(tab("Tokens")).toHaveAttribute("tabindex", "-1");
    expect(tab("Info")).toHaveAttribute("tabindex", "-1");
  });

  it("switches tabs on click and keeps the choice for the next launch", () => {
    arrange();
    renderInspector();
    fireEvent.click(tab("Info"));
    expect(tab("Info")).toHaveAttribute("aria-selected", "true");
    expect(state().inspectorTab).toBe("info");
    expect(JSON.parse(localStorage.getItem(INSPECTOR_STORAGE_KEY) ?? "{}")).toMatchObject({ open: true, tab: "info" });

    // A later render (another session, a reopened panel) starts there.
    cleanup();
    renderInspector();
    expect(tab("Info")).toHaveAttribute("aria-selected", "true");
  });

  it("moves between tabs with the arrow keys, Home and End, wrapping around", () => {
    arrange();
    renderInspector();
    tab("Outline").focus();
    fireEvent.keyDown(tab("Outline"), { key: "ArrowRight" });
    expect(tab("Tokens")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Tokens"));
    fireEvent.keyDown(tab("Tokens"), { key: "End" });
    expect(document.activeElement).toBe(tab("Info"));
    fireEvent.keyDown(tab("Info"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Outline"));
    fireEvent.keyDown(tab("Outline"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("Info"));
    fireEvent.keyDown(tab("Info"), { key: "Home" });
    expect(document.activeElement).toBe(tab("Outline"));
  });
});

describe("Inspector focus and Escape", () => {
  it("Escape inside closes it, returns focus to the toolbar button, and stops there", () => {
    arrange();
    renderInspector();
    const documentEscape = vi.fn();
    document.addEventListener("keydown", documentEscape);
    try {
      tab("Outline").focus();
      fireEvent.keyDown(tab("Outline"), { key: "Escape" });
      expect(state().isInspectorOpen).toBe(false);
      expect(document.activeElement?.id).toBe(INSPECTOR_TOGGLE_ID);
      // Selection mode and other window-level Escape handlers do not also run.
      expect(documentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", documentEscape);
    }
  });

  it("ignores Escape that ends an IME composition or that an inner control handled", () => {
    arrange();
    renderInspector();
    fireEvent.keyDown(tab("Outline"), { key: "Escape", isComposing: true });
    fireEvent.keyDown(tab("Outline"), { key: "Escape", keyCode: 229 });
    expect(state().isInspectorOpen).toBe(true);

    const inner = panel();
    inner.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(inner, { key: "Escape" });
    expect(state().isInspectorOpen).toBe(true);
  });

  it("the close button closes it and returns focus to the toolbar button", () => {
    arrange();
    renderInspector();
    const close = screen.getByRole("button", { name: "Close inspector" });
    close.focus();
    fireEvent.click(close);
    expect(state().isInspectorOpen).toBe(false);
    expect(document.activeElement?.id).toBe(INSPECTOR_TOGGLE_ID);
  });

  it("opening from the toolbar or ⌘⇧M focuses the selected tab", async () => {
    arrange({ isInspectorOpen: false, inspectorTab: "tokens" });
    const view = renderInspector();
    act(() => toggleInspector());
    expect(state().isInspectorOpen).toBe(true);
    view.rerender(
      <>
        <button id={INSPECTOR_TOGGLE_ID} type="button">
          toggle
        </button>
        <Inspector messages={[]} width={280} isResizing={false} onResizeStart={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(document.activeElement).toBe(tab("Tokens")));
  });

  it("closing with ⌘⇧M while focus is elsewhere leaves focus where it is", () => {
    arrange();
    render(
      <>
        <input aria-label="transcript find" />
        <button id={INSPECTOR_TOGGLE_ID} type="button">
          toggle
        </button>
        <Inspector messages={[]} width={280} isResizing={false} onResizeStart={vi.fn()} />
      </>,
    );
    const find = screen.getByLabelText("transcript find");
    find.focus();
    act(() => toggleInspector());
    expect(state().isInspectorOpen).toBe(false);
    expect(document.activeElement).toBe(find);
  });
});

describe("Tokens tab (owned by the open session)", () => {
  it("shows its loading state and asks for this session's totals once", async () => {
    arrange({ inspectorTab: "tokens" });
    renderInspector();
    expect(within(panel()).getByText("Loading token usage…")).toBeTruthy();
    await waitFor(() => expect(loadSessionTokenStats).toHaveBeenCalledTimes(1));
    expect(loadSessionTokenStats).toHaveBeenCalledWith(S1.file_path);
  });

  it("never shows another session's totals", () => {
    arrange({
      inspectorTab: "tokens",
      sessionTokenStats: stats("uuid-2", 9_000_000),
      sessionTokenStatsOwner: S2.file_path,
    });
    renderInspector();
    expect(within(panel()).queryAllByText("9.0M")).toEqual([]);
    expect(within(panel()).getByText("Loading token usage…")).toBeTruthy();
  });

  it("shows the session's totals and its per-model split", () => {
    arrange({
      inspectorTab: "tokens",
      sessionTokenStats: stats("uuid-1", 2_000_000),
      sessionConversationTokenStats: stats("uuid-1", 1_500_000),
      sessionTokenStatsOwner: S1.file_path,
    });
    renderInspector();
    const body = panel();
    const rows = (region: string) =>
      Array.from(within(body).getByRole("region", { name: region }).querySelectorAll("dt")).map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ]);
    expect(within(body).getByRole("region", { name: "Total Tokens" }).textContent).toContain("2.0M");
    // One metric per row: label, then value and share.
    expect(rows("Breakdown")).toEqual([
      ["Input Tokens", "1.0M50%"],
      ["Output Tokens", "1.0M50%"],
    ]);
    expect(rows("By model")).toEqual([
      ["claude-opus-4", "1.5M75%"],
      ["claude-haiku-4", "500.0K25%"],
    ]);
    // Billing: total, conversation, the rest (no cost without priced models).
    expect(rows("Billing Breakdown").map(([label, value]) => [label, value?.slice(0, 4)])).toEqual([
      ["Billing Total", "2.0M"],
      ["Conversation Only", "1.5M"],
      ["Non-conversation", "500."],
    ]);
    expect(loadSessionTokenStats).not.toHaveBeenCalled();
  });

  it("shows its own failure with a retry, and does not ask again by itself", async () => {
    arrange({
      inspectorTab: "tokens",
      sessionTokenStatsError: "backend down",
      sessionTokenStatsErrorOwner: S1.file_path,
    });
    renderInspector();
    const alert = within(panel()).getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load this session's token usage");
    expect(alert.textContent).toContain("backend down");
    expect(loadSessionTokenStats).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loadSessionTokenStats).toHaveBeenCalledWith(S1.file_path);
  });

  it("does not show another session's failure", async () => {
    arrange({
      inspectorTab: "tokens",
      sessionTokenStatsError: "other session failed",
      sessionTokenStatsErrorOwner: S2.file_path,
    });
    renderInspector();
    expect(within(panel()).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(loadSessionTokenStats).toHaveBeenCalledWith(S1.file_path));
  });

  it("does not ask again once the session's load answered, even with nothing", () => {
    // An answer of nothing is still an answer: keying the next load on
    // "no totals" instead re-asked on every render, a load loop.
    arrange({ inspectorTab: "tokens", sessionTokenStats: null, sessionTokenStatsOwner: S1.file_path });
    renderInspector();
    expect(loadSessionTokenStats).not.toHaveBeenCalled();
  });

  it("waits for a token load already running instead of starting a second one", () => {
    arrange({ inspectorTab: "tokens", isLoadingTokenStats: true });
    renderInspector();
    expect(loadSessionTokenStats).not.toHaveBeenCalled();
  });
});

describe("Info tab", () => {
  it("lists the session's project, provider, models, count, times, id and file", () => {
    arrange({
      inspectorTab: "info",
      sessionTokenStats: stats("uuid-1", 1000),
      sessionTokenStatsOwner: S1.file_path,
    });
    renderInspector();
    const body = panel();
    const row = (label: string) => {
      const term = within(body).getByText(label, { selector: "dt" });
      return term.nextElementSibling as HTMLElement;
    };
    expect(row("Project").textContent).toBe("alpha/home/me/alpha");
    expect(row("Provider").textContent).toBe("Claude Code");
    expect(within(row("Models")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "claude-opus-4",
      "claude-haiku-4",
    ]);
    expect(row("Messages").textContent).toBe("43");
    expect(row("Started").querySelector("time")).toHaveAttribute("dateTime", S1.first_message_time);
    expect(row("Last activity").querySelector("time")).toHaveAttribute("dateTime", S1.last_message_time);
    expect(row("Session ID").textContent).toContain("uuid-1");
    expect(row("File").textContent).toContain(S1.file_path);
  });

  it("shows the project and file paths with ~ when the backend reported home", () => {
    const claudeFile = "/home/me/.claude/projects/-home-me-alpha/s1.jsonl";
    arrange({
      inspectorTab: "info",
      claudePath: "/home/me/.claude",
      homeDir: "/home/me",
      selectedSession: { ...S1, file_path: claudeFile },
    });
    renderInspector();
    const row = (label: string) => within(panel()).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

    const projectPath = row("Project").querySelector("[data-path]");
    expect(projectPath).toHaveAttribute("data-path-kind", "home");
    expect(projectPath).toHaveAttribute("data-path", "/home/me/alpha");
    expect(projectPath).toHaveAttribute("title", "/home/me/alpha");
    expect(projectPath?.textContent).toBe("~/alpha");

    const filePath = row("File").querySelector("[data-path]");
    expect(filePath).toHaveAttribute("data-path-kind", "home");
    expect(filePath).toHaveAttribute("title", claudeFile);
    expect(filePath?.textContent).toBe("~/.claude/projects/-home-me-alpha/s1.jsonl");
    // The file name stays whole; only the folders may ellipsise.
    expect(filePath?.querySelector('[data-path-part="name"]')?.textContent).toBe("s1.jsonl");
  });

  it.each([
    ["a custom folder", "/data/claude-config"],
    // A custom folder named `.claude` says nothing about home either.
    ["a custom folder named .claude", "/home/.claude"],
  ])("keeps paths whole when home is unknown (%s)", (_, claudePath) => {
    arrange({ inspectorTab: "info", claudePath, homeDir: null });
    renderInspector();
    const row = (label: string) => within(panel()).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
    for (const [label, full] of [["Project", "/home/me/alpha"], ["File", S1.file_path]] as const) {
      const el = row(label).querySelector("[data-path]");
      expect(el, label).toHaveAttribute("data-path-kind", "absolute");
      expect(el?.textContent, label).toBe(full);
    }
  });

  it.each([
    ["empty", ""],
    ["unparseable", "not a date"],
  ])("says Unknown for an %s time, with no machine-readable date", (_, time) => {
    // Subagent sessions are synthesised with empty first/last message times.
    arrange({ inspectorTab: "info", selectedSession: { ...S1, first_message_time: time, last_message_time: time } });
    renderInspector();
    const row = (label: string) => within(panel()).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
    for (const label of ["Started", "Last activity"]) {
      expect(row(label).textContent, label).toBe(i18n.t("common.unknown"));
      expect(row(label).textContent, label).not.toContain("Invalid Date");
      expect(row(label).querySelector("time"), label).toBeNull();
    }
  });

  it("copies the full file path and the session id", async () => {
    arrange({ inspectorTab: "info", claudePath: "/p/.claude", homeDir: "/p" });
    renderInspector();
    // Shown shortened (`~/alpha/s1.jsonl`), copied whole.
    expect(screen.getByRole("button", { name: "Copy file path" }).closest("dd")?.textContent).toBe("~/alpha/s1.jsonl");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));
    });
    expect(clipboard).toHaveBeenCalledWith(S1.file_path);
    expect(toastSuccess).toHaveBeenCalledWith("File path copied");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: i18n.t("session.copySessionId") }));
    });
    expect(clipboard).toHaveBeenCalledWith("uuid-1");
  });

  it("says the models are loading, or could not be loaded, without blocking the rest", () => {
    arrange({ inspectorTab: "info" });
    renderInspector();
    const models = () => within(panel()).getByText("Models", { selector: "dt" }).nextElementSibling;
    expect(models()?.textContent).toBe(i18n.t("common.loading"));
    expect(within(panel()).getByText("43")).toBeTruthy();

    cleanup();
    arrange({ inspectorTab: "info", sessionTokenStatsError: "x", sessionTokenStatsErrorOwner: S1.file_path });
    renderInspector();
    expect(models()?.textContent).toBe("Couldn't load the models");
  });
});
