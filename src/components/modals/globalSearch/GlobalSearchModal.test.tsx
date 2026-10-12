import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InputHTMLAttributes, ReactNode } from "react";
import { GlobalSearchModal } from "./GlobalSearchModal";

type MockProps = {
    children?: ReactNode;
    open?: boolean;
    [key: string]: unknown;
};

vi.mock("@/components/ui", () => ({
    Dialog: ({ open, children }: MockProps) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children, ...props }: MockProps) => {
        delete props.showCloseButton;
        delete props.overlayClassName;
        return <div {...props}>{children}</div>;
    },
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Select: ({ children }: MockProps) => <div>{children}</div>,
    SelectContent: ({ children }: MockProps) => <div>{children}</div>,
    SelectItem: ({ children, ...props }: MockProps) => <div {...props}>{children}</div>,
    SelectTrigger: ({ children, ...props }: MockProps) => <button {...props}>{children}</button>,
    SelectValue: ({ children }: MockProps) => <span>{children}</span>,
    Badge: ({ children, ...props }: MockProps) => <div {...props}>{children}</div>,
}));

const { mockApi, storeState, translate, useAppStoreMock } = vi.hoisted(() => {
    const state = {
        claudePath: "",
        projects: [] as Array<{ name: string; path: string; provider?: string }>,
        selectProject: vi.fn(),
        selectSession: vi.fn(),
        sessions: [],
        getSessionDisplayName: vi.fn(),
        activeProviders: ["claude"],
        navigateToMessage: vi.fn(),
        clearTargetMessage: vi.fn(),
        setAnalyticsCurrentView: vi.fn(),
        userMetadata: {
            settings: {
                wsl: {
                    enabled: true,
                    excludedDistros: [],
                },
            },
        },
        sidebarFilterQuery: "",
        sidebarFilterResult: null as null | {
            projectPaths: string[];
            sessionMatchesByProject: Record<string, unknown[]>;
            sessionIds: string[] | null;
        },
    };

    const store = Object.assign(
        <T,>(selector?: (s: typeof state) => T) => (selector ? selector(state) : state),
        {
            getState: () => state,
        },
    );

    return {
        mockApi: vi.fn(),
        storeState: state,
        translate: (key: string, fallback?: unknown) =>
            typeof fallback === "string" ? fallback : key,
        useAppStoreMock: store,
    };
});

vi.mock("@/services/api", () => ({
    api: mockApi,
}));

vi.mock("@/store/useAppStore", () => ({
    useAppStore: useAppStoreMock,
}));

vi.mock("react-i18next", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-i18next")>();
    return {
        ...actual,
        useTranslation: () => ({
            t: translate,
        }),
    };
});

vi.mock("sonner", () => ({
    toast: {
        error: vi.fn(),
    },
}));

describe("GlobalSearchModal WSL search routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApi.mockResolvedValue([]);
        storeState.claudePath = "";
        storeState.activeProviders = ["claude"];
        storeState.userMetadata.settings.wsl.enabled = true;
        storeState.projects = [];
        storeState.sidebarFilterQuery = "";
        storeState.sidebarFilterResult = null;
    });

    it("searches WSL when no native Claude path is configured", async () => {
        storeState.activeProviders = ["claude", "codex"];
        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText("globalSearch.placeholder"), {
            target: { value: "hello" },
        });

        await waitFor(() => {
            expect(mockApi).toHaveBeenCalledWith(
                "search_all_providers",
                expect.objectContaining({
                    claudePath: undefined,
                    query: "hello",
                    activeProviders: ["claude", "codex"],
                    wslEnabled: true,
                    wslProviders: ["claude"],
                }),
            );
        });
    });

    it("searches a Codex-only installation without a native Claude path", async () => {
        storeState.activeProviders = ["codex"];
        storeState.userMetadata.settings.wsl.enabled = false;

        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText("globalSearch.placeholder"), {
            target: { value: "hello" },
        });

        await waitFor(() => {
            expect(mockApi).toHaveBeenCalledWith(
                "search_all_providers",
                expect.objectContaining({
                    claudePath: undefined,
                    query: "hello",
                    activeProviders: ["codex"],
                    wslEnabled: false,
                }),
            );
        });
    });

    it("keeps the native search path when native Claude is available", async () => {
        storeState.claudePath = "/home/user/.claude";
        storeState.userMetadata.settings.wsl.enabled = false;

        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText("globalSearch.placeholder"), {
            target: { value: "hello" },
        });

        await waitFor(() => {
            expect(mockApi).toHaveBeenCalledWith(
                "search_messages",
                expect.objectContaining({
                    claudePath: "/home/user/.claude",
                    query: "hello",
                }),
            );
        });
    });
});

describe("GlobalSearchModal sidebar filter scope", () => {
    // jsdom has no layout; the modal scrolls the selected result into view.
    Element.prototype.scrollIntoView = vi.fn();

    const web = { name: "web-app", path: "/c/projects/-home-me-web-app" };
    const api = { name: "api-server", path: "/c/projects/-home-me-api-server" };

    beforeEach(() => {
        vi.clearAllMocks();
        storeState.claudePath = "/c";
        storeState.activeProviders = ["claude"];
        storeState.userMetadata.settings.wsl.enabled = false;
        storeState.projects = [web, api];
        storeState.sidebarFilterQuery = "login";
        storeState.sidebarFilterResult = {
            projectPaths: [web.path],
            sessionMatchesByProject: {},
            sessionIds: ["s1"],
        };
    });

    const search = () =>
        fireEvent.change(screen.getByPlaceholderText("globalSearch.placeholder"), {
            target: { value: "hello" },
        });

    it("limits the search to the projects and sessions the sidebar shows", async () => {
        mockApi.mockResolvedValue([]);
        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);
        search();

        await waitFor(() => {
            expect(mockApi).toHaveBeenCalledWith(
                "search_messages",
                expect.objectContaining({
                    filters: {
                        projects: ["web-app", "-home-me-web-app"],
                        sessionIds: ["s1"],
                    },
                }),
            );
        });
    });

    it("searches everywhere once the scope chip is turned off", async () => {
        mockApi.mockResolvedValue([]);
        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { pressed: true }));
        search();

        await waitFor(() => {
            expect(mockApi).toHaveBeenCalledWith(
                "search_messages",
                expect.objectContaining({ filters: {} }),
            );
        });
    });

    it("drops results outside the scope that a provider returned unfiltered", async () => {
        mockApi.mockResolvedValue([
            { uuid: "in", sessionId: "s1", projectName: "-home-me-web-app", timestamp: "2026-01-01T00:00:00Z", type: "user", content: "hello" },
            { uuid: "out", sessionId: "s9", projectName: "-home-me-api-server", timestamp: "2026-01-01T00:00:00Z", type: "user", content: "hello" },
        ]);
        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);
        search();

        await waitFor(() => {
            expect(document.querySelectorAll("[data-index]")).toHaveLength(1);
        });
    });

    it("does not search when the sidebar filter shows nothing", async () => {
        storeState.sidebarFilterResult = { projectPaths: [], sessionMatchesByProject: {}, sessionIds: [] };
        render(<GlobalSearchModal isOpen onClose={vi.fn()} />);
        search();

        await waitFor(() => {
            expect(screen.getByText("globalSearch.sidebarScope.empty")).toBeInTheDocument();
        });
        expect(mockApi).not.toHaveBeenCalledWith("search_messages", expect.anything());
    });
});
