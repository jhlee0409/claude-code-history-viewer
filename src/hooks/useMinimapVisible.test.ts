import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useMinimapVisible } from "./useMinimapVisible";
import { useAppStore } from "../store/useAppStore";

/**
 * `window.matchMedia` is stubbed to always report `matches: false` in
 * `src/test/setup.ts`. Each test here overrides it directly so `useIsMdUp()`
 * (via `useIsMobile()`) reports the breakpoint the test needs.
 */
function stubMatchMedia(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

describe("useMinimapVisible", () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.getState().setMinimapOpen(false);
        useAppStore.getState().exitCaptureMode();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("is false when the minimap is closed, even at or above md", () => {
        stubMatchMedia(false); // useIsMobile's max-width query does not match -> isMdUp
        useAppStore.getState().setMinimapOpen(false);

        const { result } = renderHook(() => useMinimapVisible());

        expect(result.current).toBe(false);
    });

    it("is false in Capture Mode, even when open and at or above md", () => {
        stubMatchMedia(false);
        useAppStore.getState().setMinimapOpen(true);
        useAppStore.getState().enterCaptureMode();

        const { result } = renderHook(() => useMinimapVisible());

        expect(result.current).toBe(false);
    });

    it("is false below md, even when open and not in Capture Mode", () => {
        stubMatchMedia(true); // useIsMobile's max-width query matches -> below md
        useAppStore.getState().setMinimapOpen(true);

        const { result } = renderHook(() => useMinimapVisible());

        expect(result.current).toBe(false);
    });

    it("is true when open, not in Capture Mode, and at or above md", () => {
        stubMatchMedia(false);
        useAppStore.getState().setMinimapOpen(true);

        const { result } = renderHook(() => useMinimapVisible());

        expect(result.current).toBe(true);
    });
});
