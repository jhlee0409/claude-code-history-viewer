/**
 * Tab-to-scope in the ⌘K palette (plan T10, owner decision): with a row of
 * the Projects group highlighted, Tab scopes Sessions and Messages to that
 * project without opening it. The scope control then shows one pill
 * ("Search in «project» ✕") in place of the "This project / All projects"
 * buttons; the pill, or Backspace in an empty field, returns to the scope
 * before. Escape still closes the palette. Phones (no Tab key) get the same
 * action as a small button on each project row.
 *
 * Tab anywhere else keeps its usual meaning (focus order), and Tab during
 * an IME composition belongs to the IME. The scoped search is owned like
 * every message search: its project is part of the request's key, so a
 * search in flight when the scope changes never shows its answer.
 *
 * Real dialog (Radix) and cmdk; the store and the backend are stubbed.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandActions, CommandContext } from "@/commands/registry";
import { PlaceOpenersContext } from "@/contexts/placeOpeners";
import type { PlaceOpeners } from "@/navigation/paletteOpen";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { GlobalSearchModal } from "./GlobalSearchModal";

const project = (name: string, extra: Partial<ClaudeProject> = {}): ClaudeProject => ({
    name,
    path: `/store/${name}`,
    actual_path: `/home/me/${name}`,
    session_count: 1,
    message_count: 1,
    last_modified: "2026-01-01T00:00:00Z",
    provider: "claude",
    ...extra,
});
const session = (owner: string, id: string, summary: string): ClaudeSession => ({
    session_id: id,
    actual_session_id: id,
    file_path: `/store/${owner}/${id}.jsonl`,
    project_name: owner,
    message_count: 1,
    first_message_time: "",
    last_message_time: "",
    last_modified: "",
    has_tool_use: false,
    has_errors: false,
    summary,
    provider: "claude",
});

const { mockApi, storeState } = vi.hoisted(() => {
    const state = {
        claudePath: "/home/user/.claude",
        projects: [] as unknown[],
        navigate: vi.fn(),
        sessions: [] as unknown[],
        selectedProject: null as unknown,
        recentSessions: [] as unknown[],
        getSessionDisplayName: (_id: string, fallback?: string) => fallback,
        isProjectHidden: () => false,
        activeProviders: ["claude"],
        clearTargetMessage: vi.fn(),
        userMetadata: { sessions: {}, projects: {}, settings: { wsl: { enabled: false, excludedDistros: [] } } },
        navigationEpoch: 0,
        beginNavigation: () => ++state.navigationEpoch,
        excludeSidechain: false,
    };
    return { mockApi: vi.fn(), storeState: state };
});

vi.mock("@/services/api", () => ({ api: mockApi }));
vi.mock("@/store/useAppStore", () => ({
    useAppStore: Object.assign(() => storeState, { getState: () => storeState }),
}));
vi.mock("react-i18next", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-i18next")>();
    const translate = (key: string, options?: unknown) => {
        if (options && typeof options === "object") {
            const o = options as Record<string, unknown>;
            for (const name of ["count", "providers", "project", "scope"]) {
                if (name in o) return `${key}:${String(o[name])}`;
            }
        }
        return typeof options === "string" ? options : key;
    };
    const stable = { t: translate, i18n: { language: "en" } };
    return { ...actual, useTranslation: () => stable };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

const actions: CommandActions = {
    openPalette: vi.fn(),
    openPreferences: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    focusFind: vi.fn(),
    toggleInspector: vi.fn(),
    toggleMinimap: vi.fn(),
    openSettingsManager: vi.fn(),
    openArchive: vi.fn(),
    openFeedback: vi.fn(),
    checkForUpdates: vi.fn(),
    newTab: vi.fn(),
    closeTab: vi.fn(),
    cycleTab: vi.fn(),
    selectTabAt: vi.fn(),
    zoom: vi.fn(),
};
const context = (): CommandContext => ({
    place: { view: "conversation" },
    runtime: "web",
    isMobile: false,
    canGoBack: true,
    canGoForward: false,
    hasFindTarget: false,
    tabCount: 1,
    ownPlace: () => () => true,
    actions,
});

let openers: PlaceOpeners;

function Harness() {
    const [open, setOpen] = useState(true);
    if (!open) return <div data-testid="closed" />;
    return (
        <PlaceOpenersContext.Provider value={openers}>
            <GlobalSearchModal isOpen onClose={() => setOpen(false)} getCommandContext={context} />
        </PlaceOpenersContext.Provider>
    );
}

const input = () => screen.getByPlaceholderText("globalSearch.placeholder") as HTMLInputElement;
const sleep = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const group = (heading: string) =>
    screen.getAllByRole("group").find((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent === heading);
const selectedOption = () => screen.getAllByRole("option").find((el) => el.getAttribute("aria-selected") === "true");
const hit = (uuid: string, text: string, projectName = "alpha") => ({
    uuid,
    sessionId: "s1",
    projectName,
    timestamp: "2026-01-01T00:00:00Z",
    type: "user",
    content: text,
});
function held() {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
const searches = () => mockApi.mock.calls.filter(([command]) => String(command).startsWith("search"));
const pill = () => screen.queryByRole("button", { name: /^globalSearch\.scope\.pinnedAria:/ });
/** The "This project / All projects" buttons the pill replaces. */
const scopeButtons = () => screen.queryByRole("button", { name: "globalSearch.scope.all" });
const liveScope = () => document.querySelector("[data-palette-scope-live]");
/** Tab as a user presses it in the field; true when the browser keeps its default (focus moves). */
const pressTab = (init: Partial<KeyboardEventInit> & { keyCode?: number } = {}) =>
    fireEvent.keyDown(input(), { key: "Tab", code: "Tab", ...init });

const ALPHA = project("alpha");
const BETA = project("beta-login");
const BETA_SESSIONS = [session("beta-login", "b1", "Login flow rewrite"), session("beta-login", "b2", "Deploy notes")];

/** Search answers by default; a project's session list on request. */
let searchAnswer: () => unknown;
beforeEach(() => {
    vi.clearAllMocks();
    searchAnswer = () => Promise.resolve([]);
    mockApi.mockImplementation((command: string, args: { projectPath?: string }) => {
        if (command === "load_project_sessions" || command === "load_provider_sessions") {
            return Promise.resolve(args.projectPath === BETA.path ? BETA_SESSIONS : []);
        }
        return searchAnswer();
    });
    openers = { openProject: vi.fn(async () => true), openSession: vi.fn(async () => true) };
    storeState.projects = [ALPHA, BETA, project("gamma")];
    storeState.selectedProject = ALPHA;
    storeState.sessions = [session("alpha", "s1", "Fix login bug"), session("alpha", "s2", "Write docs")];
    storeState.recentSessions = [];
    storeState.activeProviders = ["claude"];
    storeState.excludeSidechain = false;
});

/** Type `query` so BETA's row is the highlighted one, then Tab. */
function pinBeta(query = "beta") {
    fireEvent.change(input(), { target: { value: query } });
    expect(selectedOption()?.getAttribute("data-value")).toBe(`project:claude:${BETA.path}`);
    return pressTab();
}

describe("⌘K palette: Tab scopes to the highlighted project", () => {
    it("Tab on a project row scopes to it without opening it; the query stays and the field keeps focus", async () => {
        render(<Harness />);
        input().focus();
        const keptDefault = pinBeta();
        expect(keptDefault).toBe(false);
        await sleep(20);
        expect(openers.openProject).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
        expect(input().value).toBe("beta");
        expect(document.activeElement).toBe(input());
        // The pill names the project and replaces the two scope buttons.
        expect(pill()).toHaveAccessibleName("globalSearch.scope.pinnedAria:beta-login");
        expect(pill()).toHaveTextContent("beta-login");
        expect(scopeButtons()).toBeNull();
    });

    it("searches only that project: messages by its folder and provider, sessions from its own list", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "login" } });
        await waitFor(() => expect(searches()).toHaveLength(1));
        expect(searches()[0]?.[1]).toMatchObject({ filters: {} });
        // "login" lists alpha's session first? No: projects come first; walk to BETA's row.
        while (selectedOption()?.getAttribute("data-value") !== `project:claude:${BETA.path}`) {
            fireEvent.keyDown(input(), { key: "ArrowDown" });
        }
        pressTab();
        await waitFor(() => expect(searches()).toHaveLength(2));
        expect(searches()[1]?.[1]).toMatchObject({ filters: { projects: ["beta-login"] } });
        // Sessions: the pinned project's sessions, not the open project's.
        await waitFor(() =>
            expect(within(group("globalSearch.group.sessions")!).getAllByRole("option").map((o) => o.textContent)).toEqual([
                expect.stringContaining("Login flow rewrite"),
            ]),
        );
        expect(screen.queryByRole("option", { name: /Fix login bug/ })).toBeNull();
        expect(mockApi).toHaveBeenCalledWith("load_project_sessions", expect.objectContaining({ projectPath: BETA.path }));
    });

    it("the pill returns to the scope before: 'All projects' or 'This project'", async () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole("button", { name: "globalSearch.scope.project" }));
        pinBeta();
        expect(scopeButtons()).toBeNull();
        fireEvent.click(pill()!);
        expect(pill()).toBeNull();
        expect(screen.getByRole("button", { name: "globalSearch.scope.project" })).toHaveAttribute("aria-pressed", "true");
        expect(input().value).toBe("beta");
        expect(document.activeElement).toBe(input());
        await waitFor(() => expect(searches().at(-1)?.[1]).toMatchObject({ filters: { projects: ["alpha"] } }));
    });

    it("Backspace in the empty field clears the pill; with text it only edits the text", () => {
        render(<Harness />);
        pinBeta();
        expect(fireEvent.keyDown(input(), { key: "Backspace" })).toBe(true);
        expect(pill()).not.toBeNull();
        fireEvent.change(input(), { target: { value: "" } });
        expect(fireEvent.keyDown(input(), { key: "Backspace" })).toBe(false);
        expect(pill()).toBeNull();
        expect(screen.getByRole("button", { name: "globalSearch.scope.all" })).toHaveAttribute("aria-pressed", "true");
    });

    it("Escape still closes the palette, and it opens again unscoped", () => {
        const { unmount } = render(<Harness />);
        pinBeta();
        fireEvent.keyDown(input(), { key: "Escape" });
        expect(screen.getByTestId("closed")).toBeInTheDocument();
        unmount();
        render(<Harness />);
        expect(pill()).toBeNull();
        expect(scopeButtons()).not.toBeNull();
    });

    it("Tab on another project row moves the scope there", async () => {
        render(<Harness />);
        pinBeta();
        fireEvent.change(input(), { target: { value: "gamma" } });
        expect(pressTab()).toBe(false);
        expect(pill()).toHaveAccessibleName("globalSearch.scope.pinnedAria:gamma");
    });

    it("announces the scope change in a polite live region", () => {
        render(<Harness />);
        const region = liveScope();
        expect(region).toHaveAttribute("aria-live", "polite");
        pinBeta();
        expect(region).toHaveTextContent("globalSearch.live.scopePinned:beta-login");
        fireEvent.click(pill()!);
        expect(region).toHaveTextContent("globalSearch.live.scopeCleared:globalSearch.scope.all");
    });

    it("the footer hints 'Tab' only while a project row is highlighted", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        expect(screen.getByText("globalSearch.scope.tabHint")).toBeInTheDocument();
        fireEvent.change(input(), { target: { value: "docs" } });
        expect(selectedOption()?.textContent).toContain("Write docs");
        expect(screen.queryByText("globalSearch.scope.tabHint")).toBeNull();
    });
});

describe("⌘K palette: Tab elsewhere keeps its meaning", () => {
    it("on a session or command row, Tab is the browser's (no scope)", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "docs" } });
        expect(pressTab()).toBe(true);
        fireEvent.change(input(), { target: { value: "sett" } });
        expect(selectedOption()?.getAttribute("data-value")).toMatch(/^command:/);
        expect(pressTab()).toBe(true);
        expect(pill()).toBeNull();
    });

    it("with nothing listed, and with Shift or a modifier, Tab is the browser's", () => {
        render(<Harness />);
        expect(pressTab()).toBe(true);
        fireEvent.change(input(), { target: { value: "beta" } });
        // (Shift+Tab from the field, the dialog's first stop, is Radix's
        // focus loop: it wraps to the last control, so only "no scope" holds.)
        pressTab({ shiftKey: true });
        expect(pill()).toBeNull();
        expect(pressTab({ altKey: true })).toBe(true);
        expect(pressTab({ ctrlKey: true })).toBe(true);
        expect(pressTab({ metaKey: true })).toBe(true);
        expect(pill()).toBeNull();
    });

    it("Tab on another control of the palette moves focus as before", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        const filter = screen.getByRole("button", { name: "globalSearch.filterType.user" });
        filter.focus();
        expect(fireEvent.keyDown(filter, { key: "Tab" })).toBe(true);
        expect(pill()).toBeNull();
    });

    it("Tab during an IME composition belongs to the IME: no scope, no search", async () => {
        render(<Harness />);
        fireEvent.compositionStart(input());
        fireEvent.change(input(), { target: { value: "beta" } });
        expect(pressTab({ isComposing: true })).toBe(true);
        expect(pressTab({ keyCode: 229 })).toBe(true);
        await sleep(300);
        expect(pill()).toBeNull();
        expect(searches()).toHaveLength(0);
    });
});

describe("⌘K palette: a scoped search is owned by its project", () => {
    it("a scope change mid-flight drops the answer for the scope before", async () => {
        const before = held();
        const after = held();
        const answers = [before.promise, after.promise];
        searchAnswer = () => answers.shift() ?? Promise.resolve([]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        await sleep(300);
        expect(searches()).toHaveLength(1);
        pressTab();
        await act(async () => before.resolve([hit("old", "beta everywhere, stale")]));
        await sleep(300);
        expect(screen.queryByText(/stale/)).toBeNull();
        expect(searches()).toHaveLength(2);
        expect(searches()[1]?.[1]).toMatchObject({ filters: { projects: ["beta-login"] } });
        await act(async () => after.resolve([hit("new", "beta in its project", "beta-login")]));
        await waitFor(() => expect(screen.getByRole("option", { name: /beta in its project/ })).toBeInTheDocument());
    });

    it("clearing the scope mid-flight drops the scoped answer", async () => {
        const scoped = held();
        const answers: Array<Promise<unknown>> = [Promise.resolve([]), scoped.promise];
        searchAnswer = () => answers.shift() ?? Promise.resolve([hit("all", "beta all again")]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        await sleep(300);
        pressTab();
        await sleep(300);
        expect(searches()).toHaveLength(2);
        fireEvent.click(pill()!);
        await act(async () => scoped.resolve([hit("scoped", "beta scoped, stale")]));
        await waitFor(() => expect(screen.getByRole("option", { name: /beta all again/ })).toBeInTheDocument());
        expect(screen.queryByText(/scoped, stale/)).toBeNull();
    });

    it("a late session list of the project before never lands", async () => {
        const betaList = held();
        mockApi.mockImplementation((command: string, args: { projectPath?: string }) => {
            if (command === "load_project_sessions") {
                return args.projectPath === BETA.path ? betaList.promise : Promise.resolve([session("gamma", "g1", "Gamma login")]);
            }
            return Promise.resolve([]);
        });
        render(<Harness />);
        pinBeta("beta");
        fireEvent.change(input(), { target: { value: "gamma" } });
        pressTab();
        fireEvent.change(input(), { target: { value: "login" } });
        await act(async () => betaList.resolve(BETA_SESSIONS));
        await waitFor(() => expect(screen.getByRole("option", { name: /Gamma login/ })).toBeInTheDocument());
        expect(screen.queryByRole("option", { name: /Login flow rewrite/ })).toBeNull();
    });

    it("pinned to a project the search cannot reach, the group says so and nothing is sent", async () => {
        const wsl = project("wsl-codex", { provider: "codex", custom_directory_label: "WSL: Ubuntu" });
        storeState.projects = [ALPHA, wsl];
        storeState.activeProviders = ["claude", "codex"];
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "wsl" } });
        await sleep(300);
        const before = searches().length;
        pressTab();
        await sleep(300);
        expect(within(group("globalSearch.group.messages")!).getByText(/globalSearch\.messages\.unsearchable:/)).toBeInTheDocument();
        expect(searches()).toHaveLength(before);
    });

    it("the open project pinned uses its loaded sessions (no extra list request)", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "alpha" } });
        pressTab();
        expect(pill()).toHaveAccessibleName("globalSearch.scope.pinnedAria:alpha");
        await sleep(20);
        expect(mockApi.mock.calls.filter(([c]) => String(c).startsWith("load_"))).toEqual([]);
    });

    it("a change of the sidechain filter while scoped reads the project's list again, with the new filter", async () => {
        const { rerender } = render(<Harness />);
        pinBeta();
        const betaLists = () =>
            mockApi.mock.calls.filter(([command, args]) => command === "load_project_sessions" && args?.projectPath === BETA.path);
        await waitFor(() => expect(betaLists()).toHaveLength(1));
        storeState.excludeSidechain = true;
        rerender(<Harness />);
        await waitFor(() => expect(betaLists()).toHaveLength(2));
        expect(betaLists().map(([, args]) => args.excludeSidechain)).toEqual([false, true]);
    });
});

describe("⌘K palette: the scoped project's session list fails", () => {
    const failedText = "globalSearch.sessions.failed:beta-login";
    const BETA_RECENT = {
        ref: { provider: "claude", filePath: "/store/beta-login/r1.jsonl", sessionId: "r1", projectPath: BETA.path },
        title: "Login recent work",
        openedAt: 1,
    };
    const betaListCalls = () =>
        mockApi.mock.calls.filter(([command, args]) => command === "load_project_sessions" && args?.projectPath === BETA.path);
    /** BETA's list answers with `answer()`; every other request as usual. */
    const betaListAnswers = (answer: () => Promise<unknown>) =>
        mockApi.mockImplementation((command: string, args: { projectPath?: string }) => {
            if (command === "load_project_sessions") {
                return args.projectPath === BETA.path ? answer() : Promise.resolve([session("gamma", "g1", "Gamma login")]);
            }
            return Promise.resolve([]);
        });

    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("says so in the Sessions group, with 'Try again', and keeps the project's recent sessions", async () => {
        storeState.recentSessions = [BETA_RECENT];
        betaListAnswers(() => Promise.reject(new Error("list unavailable")));
        render(<Harness />);
        pinBeta();
        fireEvent.change(input(), { target: { value: "login" } });
        const sessions = await waitFor(() => {
            const g = group("globalSearch.group.sessions");
            expect(g).toBeDefined();
            expect(within(g!).getByText(failedText)).toBeInTheDocument();
            return g!;
        });
        expect(within(sessions).getByRole("option", { name: /globalSearch\.messages\.retry/ })).toBeInTheDocument();
        expect(within(sessions).getByRole("option", { name: /Login recent work/ })).toBeInTheDocument();
        // Announced politely, in the scope's own live region.
        expect(liveScope()).toHaveTextContent(failedText);
    });

    it("says so with nothing typed too (no recent sessions to fall back on)", async () => {
        betaListAnswers(() => Promise.reject(new Error("list unavailable")));
        render(<Harness />);
        pinBeta();
        fireEvent.change(input(), { target: { value: "" } });
        await waitFor(() => expect(within(group("globalSearch.group.sessions")!).getByText(failedText)).toBeInTheDocument());
    });

    it("'Try again' asks for the list again; its answer replaces the failure", async () => {
        const answers = [() => Promise.reject(new Error("list unavailable")), () => Promise.resolve(BETA_SESSIONS)];
        betaListAnswers(() => answers.shift()!());
        render(<Harness />);
        pinBeta();
        fireEvent.change(input(), { target: { value: "login" } });
        const retry = await screen.findByRole("option", { name: /globalSearch\.messages\.retry/ });
        fireEvent.click(retry);
        await waitFor(() => expect(screen.getByRole("option", { name: /Login flow rewrite/ })).toBeInTheDocument());
        expect(betaListCalls()).toHaveLength(2);
        expect(screen.queryByText(failedText)).toBeNull();
        expect(screen.queryByRole("option", { name: /globalSearch\.messages\.retry/ })).toBeNull();
        expect(liveScope()).not.toHaveTextContent(failedText);
    });

    it("a failure of a project the scope has left never shows", async () => {
        const betaList = held();
        betaListAnswers(() => betaList.promise);
        render(<Harness />);
        pinBeta();
        fireEvent.change(input(), { target: { value: "gamma" } });
        pressTab();
        fireEvent.change(input(), { target: { value: "login" } });
        await act(async () => betaList.reject(new Error("late")));
        await waitFor(() => expect(screen.getByRole("option", { name: /Gamma login/ })).toBeInTheDocument());
        expect(screen.queryByText(failedText)).toBeNull();
        expect(screen.queryByRole("option", { name: /globalSearch\.messages\.retry/ })).toBeNull();
        expect(liveScope()).not.toHaveTextContent(/globalSearch\.sessions\.failed/);
    });

    it("clearing the scope drops its failure", async () => {
        betaListAnswers(() => Promise.reject(new Error("list unavailable")));
        render(<Harness />);
        pinBeta();
        await waitFor(() => expect(within(group("globalSearch.group.sessions")!).getByText(failedText)).toBeInTheDocument());
        fireEvent.click(pill()!);
        expect(screen.queryByText(failedText)).toBeNull();
        expect(liveScope()).toHaveTextContent("globalSearch.live.scopeCleared:globalSearch.scope.all");
    });

    it("a failure landing after the palette closed shows nothing, then or on reopening", async () => {
        const betaList = held();
        betaListAnswers(() => betaList.promise);
        const { unmount } = render(<Harness />);
        pinBeta();
        fireEvent.keyDown(input(), { key: "Escape" });
        expect(screen.getByTestId("closed")).toBeInTheDocument();
        await act(async () => betaList.reject(new Error("late")));
        unmount();
        render(<Harness />);
        await sleep(20);
        expect(screen.queryByText(failedText)).toBeNull();
        expect(console.error).not.toHaveBeenCalled();
    });
});

describe("⌘K palette: phones scope with a row button", () => {
    it("each project row has a 'Search in this project' button that scopes without opening", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        const row = screen.getByRole("option", { name: /beta/ });
        const button = within(row).getByRole("button", { name: "globalSearch.scope.pinAction" });
        expect(button).toHaveAttribute("title", "globalSearch.scope.pinAction");
        fireEvent.pointerDown(button);
        fireEvent.click(button);
        await sleep(20);
        expect(openers.openProject).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
        expect(pill()).toHaveAccessibleName("globalSearch.scope.pinnedAria:beta-login");
        expect(document.activeElement).toBe(input());
    });

    it("the row itself still opens the project", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        fireEvent.click(screen.getByRole("option", { name: /beta/ }));
        await waitFor(() => expect(openers.openProject).toHaveBeenCalledWith(BETA));
    });
});
