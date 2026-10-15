import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPendingLoadCount } from "@/hooks/usePendingLoad";
import { WslSection } from "./WslSection";

const { state, requests, apiMock } = vi.hoisted(() => {
  const state = {
    userMetadata: { settings: { wsl: { enabled: true, excludedDistros: [] as string[] } } },
    setWslEnabled: () => {},
    toggleWslDistro: () => {},
  };
  const requests: {
    command: string;
    resolve: (data: unknown) => void;
    reject: (err: Error) => void;
  }[] = [];
  const apiMock = vi.fn((command: string) => {
    if (command === "is_wsl_available") return Promise.resolve(true);
    return new Promise((resolve, reject) => requests.push({ command, resolve, reject }));
  });
  return { state, requests, apiMock };
});

vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("@/utils/platform", () => ({ isWindows: () => true, isTauri: () => true }));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state }
  ),
}));

const detectRequest = () => {
  const request = requests.find((r) => r.command === "detect_wsl_distros");
  if (!request) throw new Error("detect_wsl_distros was not requested");
  return request;
};

describe("WslSection pending-load registration", () => {
  beforeEach(() => {
    requests.length = 0;
    apiMock.mockClear();
    state.userMetadata.settings.wsl.enabled = true;
  });

  afterEach(() => {
    cleanup();
    expect(getPendingLoadCount()).toBe(0);
  });

  it("registers while detection is pending and releases on failure", async () => {
    render(<WslSection isExpanded onToggle={() => {}} />);
    await act(async () => {});
    expect(getPendingLoadCount()).toBe(1);
    await act(async () => {
      detectRequest().reject(new Error("injected"));
    });
    expect(getPendingLoadCount()).toBe(0);
  });

  it.each(["success", "error"] as const)(
    "releases when scanning is disabled mid-detection (late %s)",
    async (outcome) => {
      const view = render(<WslSection isExpanded onToggle={() => {}} />);
      await act(async () => {});
      expect(getPendingLoadCount()).toBe(1);

      state.userMetadata.settings.wsl.enabled = false;
      view.rerender(<WslSection isExpanded onToggle={() => {}} />);
      await act(async () => {});
      expect(getPendingLoadCount()).toBe(0);

      await act(async () => {
        const request = detectRequest();
        if (outcome === "success") request.resolve([]);
        else request.reject(new Error("late failure"));
      });
      expect(getPendingLoadCount()).toBe(0);
    }
  );
});
