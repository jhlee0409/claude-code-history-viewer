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
        projects: [],
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
    };

    const store = Object.assign(() => state, {
        getState: () => state,
    });

    return {
        mockApi: vi.fn(),
        storeState: state,
        translate: (key: string, fallback?: string) => fallback ?? key,
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
