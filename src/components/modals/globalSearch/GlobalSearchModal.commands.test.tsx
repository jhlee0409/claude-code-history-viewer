/**
 * The ⌘K palette's Commands group (plan T6b): commands are listed with the
 * message search, picking one runs it once the palette has closed, and an
 * Enter that confirms an IME composition picks nothing. The search field is a
 * combobox naming the highlighted option; keys on the filter controls work
 * those controls only; and one query change sends one search request.
 *
 * Uses the real dialog (Radix) and cmdk, so closing and focus behave as in
 * the app.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandActions, CommandContext } from "@/commands/registry";
import { GlobalSearchModal } from "./GlobalSearchModal";

const { mockApi, storeState, i18nMock } = vi.hoisted(() => {
    const state = {
        claudePath: "/home/user/.claude",
        projects: [] as unknown[],
        navigate: vi.fn(),
        sessions: [] as unknown[],
        getSessionDisplayName: vi.fn(),
        activeProviders: ["claude"],
        clearTargetMessage: vi.fn(),
        userMetadata: { settings: { wsl: { enabled: false, excludedDistros: [] } } },
        // A message pick is a navigation: it claims the epoch first (T10).
        navigationEpoch: 0,
        beginNavigation: () => ++state.navigationEpoch,
        excludeSidechain: false,
    };
    return { mockApi: vi.fn(), storeState: state, i18nMock: { unstable: false } };
});

vi.mock("@/services/api", () => ({ api: mockApi }));

vi.mock("@/store/useAppStore", () => ({
    useAppStore: Object.assign(() => storeState, { getState: () => storeState }),
}));

vi.mock("react-i18next", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-i18next")>();
    const titles: Record<string, string> = {
        "common.command.back": "Back",
        "common.command.forward": "Forward",
        "common.command.find": "Find in Conversation",
        "common.command.openSettingsManager": "Open Settings Manager",
        "common.command.openArchive": "Open Archive Manager",
    };
    const translate = (key: string, fallback?: unknown) =>
        titles[key] ?? (typeof fallback === "string" ? fallback : key);
    // One translator for every render, as react-i18next's own `t` is stable
    // until the language changes. `i18nMock.unstable` hands out a new one per
    // render, to prove the palette does not depend on `t` identity.
    const stable = { t: translate, i18n: { language: "en" } };
    return {
        ...actual,
        useTranslation: () =>
            i18nMock.unstable
                ? { t: (key: string, fallback?: unknown) => translate(key, fallback), i18n: stable.i18n }
                : stable,
    };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

let actions: CommandActions;
let context: Omit<CommandContext, "actions">;

function Harness() {
    const [open, setOpen] = useState(true);
    if (!open) return <div data-testid="closed" />;
    return (
        <GlobalSearchModal
            isOpen
            onClose={() => setOpen(false)}
            getCommandContext={() => ({ ...context, actions })}
        />
    );
}

const input = () => screen.getByPlaceholderText("globalSearch.placeholder");
const selectedOption = () => screen.getAllByRole("option").find((el) => el.getAttribute("aria-selected") === "true");
const sleep = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const helloResult = {
    uuid: "m1",
    sessionId: "s1",
    projectName: "p",
    timestamp: "2026-01-01T00:00:00Z",
    type: "user",
    content: "hello world",
};
const option = (name: string) => screen.getByRole("option", { name: new RegExp(name) });

/** Fresh mocks, actions and a conversation place with Back enabled. */
function setUpPalette() {
    vi.clearAllMocks();
    i18nMock.unstable = false;
    mockApi.mockResolvedValue([]);
    actions = {
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
    };
    context = {
        place: {
            view: "conversation",
            project: { provider: "claude", path: "/p" },
            session: { provider: "claude", filePath: "/p/s.jsonl", sessionId: "s" },
        },
        runtime: "web",
        isMobile: false,
        canGoBack: true,
        canGoForward: false,
        hasFindTarget: true,
        tabs: { activeId: "t1", ids: ["t1"] },
        ownPlace: () => () => true,
    };
}

describe("⌘K palette: Commands group", () => {
    beforeEach(setUpPalette);

    it("lists the commands under their heading, without the palette itself", () => {
        render(<Harness />);
        expect(screen.getByText("common.command.groupHeading")).toBeInTheDocument();
        for (const name of ["Back", "Forward", "Find in Conversation", "Open Settings Manager", "Open Archive Manager"]) {
            expect(option(name)).toBeInTheDocument();
        }
        expect(screen.queryByRole("option", { name: /common\.command\.openPalette/ })).toBeNull();
        // The update check is desktop-only.
        expect(screen.queryByRole("option", { name: /common\.command\.checkForUpdates/ })).toBeNull();
    });

    it("shows a command that cannot run now as disabled", () => {
        render(<Harness />);
        expect(option("Forward")).toHaveAttribute("aria-disabled", "true");
        expect(option("Back")).toHaveAttribute("aria-disabled", "false");
    });

    it("filters the commands by the query", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "sett" } });
        expect(option("Open Settings Manager")).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /Back/ })).toBeNull();
    });

    it.each([
        ["sett", "Open Settings Manager", "openSettingsManager"],
        ["archive", "Open Archive Manager", "openArchive"],
        ["back", "Back", "goBack"],
        ["find", "Find in Conversation", "focusFind"],
    ] as const)("Enter on %s runs %s after the palette closes", async (query, _name, action) => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: query } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(actions[action]).not.toHaveBeenCalled();
        await waitFor(() => expect(actions[action]).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId("closed")).toBeInTheDocument();
    });

    it("runs a command picked with the pointer", async () => {
        render(<Harness />);
        fireEvent.click(option("Open Archive Manager"));
        await waitFor(() => expect(actions.openArchive).toHaveBeenCalledTimes(1));
    });

    it("moves to a command with the arrow keys", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "open" } });
        expect(option("Open Settings Manager")).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(input(), { key: "ArrowDown" });
        expect(option("Open Archive Manager")).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(input(), { key: "Enter" });
        await waitFor(() => expect(actions.openArchive).toHaveBeenCalledTimes(1));
        expect(actions.openSettingsManager).not.toHaveBeenCalled();
    });

    it("ignores Enter while an IME is composing", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "sett" } });
        fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
        fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
        // Let the debounced message search land: well past the moment a
        // picked command would have closed the palette and run.
        await waitFor(() => expect(mockApi).toHaveBeenCalled());
        expect(actions.openSettingsManager).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
    });

    it("does not run a disabled command", async () => {
        render(<Harness />);
        fireEvent.click(option("Forward"));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(actions.goForward).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
    });

    it("still opens a message result with Enter", async () => {
        const session = { session_id: "s1", actual_session_id: "s1", file_path: "/p/s1.jsonl" };
        storeState.sessions = [session];
        mockApi.mockResolvedValue([
            {
                uuid: "m1",
                sessionId: "s1",
                projectName: "p",
                timestamp: "2026-01-01T00:00:00Z",
                type: "user",
                content: "hello world",
            },
        ]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() => expect(screen.getByRole("option", { name: /hello world/ })).toBeInTheDocument());
        expect(screen.getByRole("option", { name: /hello world/ })).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(input(), { key: "Enter" });
        await waitFor(() =>
            expect(storeState.navigate).toHaveBeenCalledWith(
                { view: "conversation", session, messageId: "m1" },
                { epoch: storeState.navigationEpoch },
            ),
        );
        storeState.sessions = [];
    });
});

describe("⌘K palette: combobox semantics", () => {
    beforeEach(setUpPalette);

    it("links the search field to the list it controls", () => {
        render(<Harness />);
        expect(input()).toHaveAttribute("role", "combobox");
        const listbox = screen.getByRole("listbox");
        expect(listbox.id).not.toBe("");
        expect(input()).toHaveAttribute("aria-controls", listbox.id);
        // On open, before any key: the first enabled command is announced.
        expect(option("Back")).toHaveAttribute("aria-selected", "true");
        expect(input()).toHaveAttribute("aria-activedescendant", option("Back").id);
    });

    it("exposes the highlighted command as the field's active descendant", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "open" } });
        const first = option("Open Settings Manager");
        expect(first).toHaveAttribute("aria-selected", "true");
        expect(input()).toHaveAttribute("aria-activedescendant", first.id);
        fireEvent.keyDown(input(), { key: "ArrowDown" });
        const next = option("Open Archive Manager");
        expect(next).toHaveAttribute("aria-selected", "true");
        expect(next.id).not.toBe(first.id);
        expect(input()).toHaveAttribute("aria-activedescendant", next.id);
    });

    it("exposes a highlighted message result as the field's active descendant", async () => {
        mockApi.mockResolvedValue([helloResult, { ...helloResult, uuid: "m2", content: "hello again" }]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() => expect(screen.getByRole("option", { name: /hello again/ })).toBeInTheDocument());
        fireEvent.keyDown(input(), { key: "ArrowDown" });
        const again = screen.getByRole("option", { name: /hello again/ });
        expect(selectedOption()).toBe(again);
        expect(input()).toHaveAttribute("aria-activedescendant", again.id);
    });

    it("finds the highlighted result when its uuid ends in whitespace (cmdk trims data-value)", async () => {
        mockApi.mockResolvedValue([{ ...helloResult, uuid: "m1 " }]);
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "hello" } });
        await waitFor(() => expect(screen.getByRole("option", { name: /hello world/ })).toBeInTheDocument());
        const hello = screen.getByRole("option", { name: /hello world/ });
        expect(selectedOption()).toBe(hello);
        expect(input()).toHaveAttribute("aria-activedescendant", hello.id);
    });
});

describe("⌘K palette: keys on the filter controls", () => {
    beforeEach(setUpPalette);

    it.each(["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"])(
        "%j on a focused message-type filter leaves the command list alone",
        async (key) => {
            render(<Harness />);
            const userFilter = screen.getByRole("button", { name: "globalSearch.filterType.user" });
            userFilter.focus();
            const before = selectedOption();
            // Not prevented: the browser still activates the focused button.
            expect(fireEvent.keyDown(userFilter, { key })).toBe(true);
            expect(selectedOption()).toBe(before);
            await sleep(20);
            expect(actions.goBack).not.toHaveBeenCalled();
            expect(screen.queryByTestId("closed")).toBeNull();
        },
    );

    it("activating a filter changes the filter, not the command list", async () => {
        render(<Harness />);
        const userFilter = screen.getByRole("button", { name: "globalSearch.filterType.user" });
        expect(userFilter).toHaveAttribute("aria-pressed", "false");
        fireEvent.keyDown(userFilter, { key: "Enter" });
        fireEvent.click(userFilter); // the browser's activation of the focused button
        expect(userFilter).toHaveAttribute("aria-pressed", "true");
        await sleep(20);
        expect(actions.goBack).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
    });

    it("Enter on the clear-search button runs no command", async () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "back" } });
        const clear = screen.getByRole("button", { name: "globalSearch.clearSearch" });
        expect(fireEvent.keyDown(clear, { key: "Enter" })).toBe(true);
        await sleep(20);
        expect(actions.goBack).not.toHaveBeenCalled();
        expect(screen.queryByTestId("closed")).toBeNull();
    });

    it("Enter in the search field still runs the highlighted command", async () => {
        render(<Harness />);
        fireEvent.keyDown(input(), { key: "Enter" });
        await waitFor(() => expect(actions.goBack).toHaveBeenCalledTimes(1));
    });
});

describe("⌘K palette: message search requests", () => {
    beforeEach(() => {
        setUpPalette();
        mockApi.mockResolvedValue([helloResult]);
    });

    it.each([
        ["a stable", false],
        ["a new-per-render", true],
    ])("sends one debounced request per query change with %s translator", async (_label, unstable) => {
        i18nMock.unstable = unstable;
        const { unmount } = render(<Harness />);
        fireEvent.change(input(), { target: { value: "hel" } });
        fireEvent.change(input(), { target: { value: "hello" } });
        await sleep(100);
        expect(mockApi).not.toHaveBeenCalled(); // still debouncing
        await sleep(350);
        expect(mockApi).toHaveBeenCalledTimes(1);
        expect(mockApi.mock.calls[0]?.[1]).toMatchObject({ query: "hello" });
        // Settled: results rendered, and no further requests follow.
        expect(screen.getByRole("option", { name: /hello world/ })).toBeInTheDocument();
        await sleep(400);
        expect(mockApi).toHaveBeenCalledTimes(1);
        fireEvent.change(input(), { target: { value: "hello w" } });
        await sleep(450);
        expect(mockApi).toHaveBeenCalledTimes(2);
        unmount();
        await sleep(400);
        expect(mockApi).toHaveBeenCalledTimes(2);
    });
});
