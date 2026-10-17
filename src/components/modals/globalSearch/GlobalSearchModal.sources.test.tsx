/**
 * The ⌘K palette's place sources (plan T10): the Projects, Sessions and
 * Messages groups next to Commands, in that order; the scope chip; the
 * message search's ownership (stale answers, closing), its own loading /
 * error / empty states that never hold up the other groups; IME
 * composition; and the live region.
 *
 * Real dialog (Radix) and cmdk; the store and the backend are stubbed. Where
 * a pick lands (the store's place) is covered through the real shell in
 * `src/test/palette.shell.test.tsx`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandActions, CommandContext } from "@/commands/registry";
import { PlaceOpenersContext } from "@/contexts/placeOpeners";
import type { PlaceOpeners } from "@/navigation/paletteOpen";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { GlobalSearchModal } from "./GlobalSearchModal";

/** `n` open tabs t1…tn, the first in front. */
const tabsOf = (n: number) => ({ activeId: "t1", ids: Array.from({ length: n }, (_, i) => `t${i + 1}`) });

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
const session = (id: string, summary: string): ClaudeSession => ({
    session_id: id,
    actual_session_id: id,
    file_path: `/store/alpha/${id}.jsonl`,
    project_name: "alpha",
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
        if (options && typeof options === "object" && "count" in options) return `${key}:${String((options as { count: number }).count)}`;
        if (options && typeof options === "object" && "providers" in options) return `${key}:${String((options as { providers: string }).providers)}`;
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
    selectTab: vi.fn(),
    zoom: vi.fn(),
};
const context = (): CommandContext => ({
    place: { view: "conversation" },
    runtime: "web",
    isMobile: false,
    canGoBack: true,
    canGoForward: false,
    hasFindTarget: false,
    tabs: tabsOf(1),
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

const input = () => screen.getByPlaceholderText("globalSearch.placeholder");
const sleep = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const groupNames = () =>
    within(screen.getByRole("listbox")).getAllByRole("group").map((g) => {
        const id = g.getAttribute("aria-labelledby");
        return id ? document.getElementById(id)?.textContent : null;
    });
const group = (heading: string) =>
    screen.getAllByRole("group").find((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent === heading)!;
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

const ALPHA = project("alpha");
const BETA = project("beta-login");

beforeEach(() => {
    vi.clearAllMocks();
    mockApi.mockResolvedValue([]);
    openers = { openProject: vi.fn(async () => true), openSession: vi.fn(async () => true) };
    storeState.projects = [ALPHA, BETA, project("gamma")];
    storeState.selectedProject = ALPHA;
    storeState.sessions = [session("s1", "Fix login bug"), session("s2", "Write docs")];
    storeState.recentSessions = [];
    storeState.activeProviders = ["claude"];
});

describe("⌘K palette: groups", () => {
    it("lists Commands, Projects, Sessions and Messages, in that order, as labelled groups", async () => {
        mockApi.mockResolvedValue([hit("m1", "the login form")]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "login" } });
        await waitFor(() => expect(screen.getByRole("option", { name: /the login form/ })).toBeInTheDocument());
        expect(groupNames()).toEqual(["globalSearch.group.projects", "globalSearch.group.sessions", "globalSearch.group.messages"]);
        fireEvent.change(input(), { target: { value: "find" } });
        expect(groupNames()[0]).toBe("common.command.groupHeading");
    });

    it("highlights the matched words in project and session rows", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "login" } });
        const marks = Array.from(document.querySelectorAll("[cmdk-item] mark")).map((m) => m.textContent);
        expect(marks).toEqual(["login", "login"]);
    });

    it("lists five rows per place group, then 'Show N more' lists the rest", () => {
        storeState.projects = Array.from({ length: 7 }, (_, i) => project(`web-${i}`));
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "web" } });
        const projects = within(group("globalSearch.group.projects"));
        expect(projects.getAllByRole("option")).toHaveLength(6);
        fireEvent.click(projects.getByRole("option", { name: "globalSearch.showMore:2" }));
        expect(within(group("globalSearch.group.projects")).getAllByRole("option")).toHaveLength(7);
        // The first row it revealed is highlighted.
        expect(selectedOption()?.textContent).toContain("web-5");
    });

    it("Enter on a project row opens the project; on a session row the session with its project", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        fireEvent.keyDown(input(), { key: "Enter" });
        await waitFor(() => expect(openers.openProject).toHaveBeenCalledWith(BETA));
        expect(screen.getByTestId("closed")).toBeInTheDocument();
    });

    it("Enter on a session row opens it as its sidebar row would", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "docs" } });
        expect(selectedOption()?.textContent).toContain("Write docs");
        fireEvent.keyDown(input(), { key: "Enter" });
        await waitFor(() => expect(openers.openSession).toHaveBeenCalledWith(storeState.sessions[1], ALPHA));
    });
});

describe("⌘K palette: message search ownership", () => {
    it("never shows an older query's answer under a newer query", async () => {
        const first = held();
        const second = held();
        mockApi.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await sleep(300);
        fireEvent.change(input(), { target: { value: "hello world" } });
        await sleep(300);
        expect(searches()).toHaveLength(2);
        await act(async () => second.resolve([hit("new", "hello world, newest")]));
        await act(async () => first.resolve([hit("old", "hello, stale")]));
        expect(screen.getByRole("option", { name: /newest/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /stale/ })).toBeNull();
    });

    it("while the search runs, Commands, Projects and Sessions are listed and pickable", async () => {
        mockApi.mockReturnValue(held().promise);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "sett" } });
        await sleep(300);
        expect(within(group("globalSearch.group.messages")).getByText("globalSearch.messages.searching")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /common\.command\.openSettingsManager/ })).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(input(), { key: "Enter" });
        await waitFor(() => expect(actions.openSettingsManager).toHaveBeenCalledTimes(1));
    });

    it("a failed search shows its error in the group, with a retry item that asks again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockApi.mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce([hit("m1", "hello there")]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() =>
            expect(within(group("globalSearch.group.messages")).getByText("globalSearch.messages.failed")).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole("option", { name: /globalSearch\.messages\.retry/ }));
        await waitFor(() => expect(screen.getByRole("option", { name: /hello there/ })).toBeInTheDocument());
        expect(searches()).toHaveLength(2);
    });

    it("says when nothing matched", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "zzz" } });
        await waitFor(() =>
            expect(within(group("globalSearch.group.messages")).getByText("globalSearch.messages.none")).toBeInTheDocument(),
        );
    });

    it("lists eight messages, then 'Show all N messages'", async () => {
        mockApi.mockResolvedValue(Array.from({ length: 10 }, (_, i) => hit(`m${i}`, `hello ${i}`)));
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() => expect(screen.getByRole("option", { name: /globalSearch\.showAllMessages:10/ })).toBeInTheDocument());
        expect(within(group("globalSearch.group.messages")).getAllByRole("option")).toHaveLength(9);
        fireEvent.click(screen.getByRole("option", { name: /globalSearch\.showAllMessages:10/ }));
        expect(within(group("globalSearch.group.messages")).getAllByRole("option")).toHaveLength(10);
    });

    it("closing the palette drops the search in flight and sends no more", async () => {
        const pending = held();
        mockApi.mockReturnValueOnce(pending.promise);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await sleep(300);
        fireEvent.keyDown(input(), { key: "Escape" });
        expect(screen.getByTestId("closed")).toBeInTheDocument();
        await act(async () => pending.resolve([hit("late", "late answer")]));
        await sleep(300);
        expect(searches()).toHaveLength(1);
        expect(screen.queryByText(/late answer/)).toBeNull();
    });

    it("a new highlight stays put when the messages arrive", async () => {
        const pending = held();
        mockApi.mockReturnValueOnce(pending.promise);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "login" } });
        fireEvent.keyDown(input(), { key: "ArrowDown" });
        const chosen = selectedOption();
        expect(chosen?.textContent).toContain("Fix login bug");
        await sleep(300);
        await act(async () => pending.resolve([hit("m1", "login again")]));
        expect(selectedOption()).toBe(chosen);
    });
});

describe("⌘K palette: IME composition", () => {
    it("sends no message search mid-composition, one with the composed text", async () => {
        render(<Harness />);
        const field = input();
        fireEvent.compositionStart(field);
        fireEvent.change(field, { target: { value: "ㄹ" }, nativeEvent: { isComposing: true } });
        fireEvent.change(field, { target: { value: "로" } });
        fireEvent.change(field, { target: { value: "로그" } });
        await sleep(400);
        expect(searches()).toHaveLength(0);
        fireEvent.compositionEnd(field, { target: { value: "로그" } });
        await sleep(400);
        expect(searches()).toHaveLength(1);
        expect(searches()[0]?.[1]).toMatchObject({ query: "로그" });
    });

    // Composition that starts over an existing query ends that query's
    // search: its pending debounce is never sent, its answer in flight is
    // dropped, and the Messages group waits for the composed text.
    const messages = () => within(group("globalSearch.group.messages"));

    it("composition over a typed query cancels its pending search", async () => {
        render(<Harness />);
        const field = input();
        fireEvent.change(field, { target: { value: "hello" } });
        await sleep(80);
        fireEvent.compositionStart(field);
        fireEvent.change(field, { target: { value: "hello로" }, nativeEvent: { isComposing: true } });
        await sleep(400);
        expect(searches()).toHaveLength(0);
        expect(messages().getByText("globalSearch.messages.composing")).toBeInTheDocument();
        fireEvent.compositionEnd(field, { target: { value: "hello로" } });
        await sleep(400);
        expect(searches()).toHaveLength(1);
        expect(searches()[0]?.[1]).toMatchObject({ query: "hello로" });
    });

    it("composition over a query in flight drops its late answer: no stale, selectable row", async () => {
        const pending = held();
        mockApi.mockReturnValueOnce(pending.promise);
        render(<Harness />);
        const field = input();
        fireEvent.change(field, { target: { value: "hello" } });
        await sleep(300);
        expect(searches()).toHaveLength(1);
        fireEvent.compositionStart(field);
        fireEvent.change(field, { target: { value: "hello로" }, nativeEvent: { isComposing: true } });
        await act(async () => pending.resolve([hit("old", "hello stale before IME")]));
        await sleep(50);
        expect(screen.queryByText(/stale before IME/)).toBeNull();
        expect(screen.queryAllByRole("option").filter((o) => o.getAttribute("data-value")?.startsWith("message:"))).toEqual([]);
        expect(messages().getByText("globalSearch.messages.composing")).toBeInTheDocument();
        expect(searches()).toHaveLength(1);
    });

    it("composition start alone ends the query in flight", async () => {
        const pending = held();
        mockApi.mockReturnValueOnce(pending.promise);
        render(<Harness />);
        const field = input();
        fireEvent.change(field, { target: { value: "hello" } });
        await sleep(300);
        fireEvent.compositionStart(field);
        await act(async () => pending.resolve([hit("old", "hello stale before IME")]));
        await sleep(50);
        expect(screen.queryByText(/stale before IME/)).toBeNull();
        expect(screen.queryAllByRole("option").filter((o) => o.getAttribute("data-value")?.startsWith("message:"))).toEqual([]);
        expect(messages().getByText("globalSearch.messages.composing")).toBeInTheDocument();
    });

    it("a late answer of the pre-composition query never shows after the composed one is asked", async () => {
        const old = held();
        mockApi.mockReturnValueOnce(old.promise);
        mockApi.mockResolvedValueOnce([hit("new", "hello로 fresh")]);
        render(<Harness />);
        const field = input();
        fireEvent.change(field, { target: { value: "hello" } });
        await sleep(300);
        fireEvent.compositionStart(field);
        fireEvent.change(field, { target: { value: "hello로" }, nativeEvent: { isComposing: true } });
        fireEvent.compositionEnd(field, { target: { value: "hello로" } });
        await sleep(300);
        await act(async () => old.resolve([hit("old", "hello stale before IME")]));
        await waitFor(() => expect(screen.getByText(/fresh/)).toBeInTheDocument());
        expect(screen.queryByText(/stale before IME/)).toBeNull();
        expect(searches().map((call) => (call[1] as { query: string }).query)).toEqual(["hello", "hello로"]);
    });

    it("keeps matching places while composing", () => {
        storeState.projects = [project("로그인")];
        render(<Harness />);
        fireEvent.compositionStart(input());
        fireEvent.change(input(), { target: { value: "로그" } });
        // (The match is marked, so the name reads "로그 인".)
        expect(screen.getByRole("option", { name: /로그\s*인/ })).toBeInTheDocument();
    });

    it("Enter that confirms a composition picks nothing", async () => {
        render(<Harness />);
        fireEvent.compositionStart(input());
        fireEvent.change(input(), { target: { value: "beta" } });
        fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
        fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
        await sleep(50);
        expect(openers.openProject).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
    });
});

describe("⌘K palette: scope chip", () => {
    const chip = (name: string) => screen.getByRole("button", { name });

    it("defaults to all projects; 'This project' searches the open project's folder only", async () => {
        render(<Harness />);
        expect(screen.getByRole("group", { name: "globalSearch.scope.label" })).toBeInTheDocument();
        expect(chip("globalSearch.scope.all")).toHaveAttribute("aria-pressed", "true");
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() => expect(searches()).toHaveLength(1));
        expect(searches()[0]?.[1]).toMatchObject({ filters: {} });
        fireEvent.click(chip("globalSearch.scope.project"));
        expect(chip("globalSearch.scope.project")).toHaveAttribute("aria-pressed", "true");
        await waitFor(() => expect(searches()).toHaveLength(2));
        expect(searches()[1]?.[1]).toMatchObject({ filters: { projects: ["alpha"] } });
    });

    it("scopes the Sessions group: library sessions of other projects only under 'All projects'", () => {
        storeState.recentSessions = [
            {
                ref: { provider: "claude", filePath: "/store/beta-login/r1.jsonl", sessionId: "r1", projectPath: BETA.path },
                title: "Login page redesign",
                openedAt: 1,
            },
        ];
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "login" } });
        expect(within(group("globalSearch.group.sessions")).getAllByRole("option").map((o) => o.textContent)).toEqual([
            expect.stringContaining("Login page redesign"),
            expect.stringContaining("Fix login bug"),
        ]);
        fireEvent.click(chip("globalSearch.scope.project"));
        expect(within(group("globalSearch.group.sessions")).getAllByRole("option")).toHaveLength(1);
    });

    it("without an open project, 'This project' is unavailable and says why", () => {
        storeState.selectedProject = null;
        storeState.sessions = [];
        render(<Harness />);
        expect(chip("globalSearch.scope.project")).toBeDisabled();
        expect(chip("globalSearch.scope.project")).toHaveAttribute("title", "globalSearch.scope.projectUnavailable");
    });

    it("Enter on the chip changes the scope, never picks the highlighted row", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "beta" } });
        const projectChip = chip("globalSearch.scope.project");
        projectChip.focus();
        expect(fireEvent.keyDown(projectChip, { key: "Enter" })).toBe(true);
        fireEvent.click(projectChip);
        await sleep(20);
        expect(openers.openProject).not.toHaveBeenCalled();
        expect(projectChip).toHaveAttribute("aria-pressed", "true");
    });
});

describe("⌘K palette: provider parity", () => {
    it("scoped to a project the search cannot reach, the group says so and nothing is sent", async () => {
        const wsl = project("wsl-codex", { provider: "codex", custom_directory_label: "WSL: Ubuntu" });
        storeState.projects = [wsl];
        storeState.selectedProject = wsl;
        storeState.activeProviders = ["claude", "codex"];
        render(<Harness />);
        fireEvent.click(screen.getByRole("button", { name: "globalSearch.scope.project" }));
        fireEvent.change(input(), { target: { value: "hello" } });
        await sleep(300);
        expect(within(group("globalSearch.group.messages")).getByText(/globalSearch\.messages\.unsearchable/)).toBeInTheDocument();
        expect(searches()).toHaveLength(0);
    });

    it("searching everything, the group names listed providers it did not search", async () => {
        storeState.projects = [ALPHA, project("wsl-codex", { provider: "codex", custom_directory_label: "WSL: Ubuntu" })];
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() =>
            expect(within(group("globalSearch.group.messages")).getByText("globalSearch.messages.none")).toBeInTheDocument(),
        );
        expect(within(group("globalSearch.group.messages")).getByText(/globalSearch\.messages\.notSearched:/)).toBeInTheDocument();
    });
});

describe("⌘K palette: live region", () => {
    it("announces the message search's progress and outcome", async () => {
        const pending = held();
        mockApi.mockReturnValueOnce(pending.promise);
        render(<Harness />);
        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("aria-live", "polite");
        fireEvent.change(input(), { target: { value: "hello" } });
        expect(status).toHaveTextContent("globalSearch.messages.searching");
        await sleep(300);
        await act(async () => pending.resolve([hit("m1", "hello"), hit("m2", "hello 2")]));
        expect(status).toHaveTextContent("globalSearch.live.found:2");
    });
});
