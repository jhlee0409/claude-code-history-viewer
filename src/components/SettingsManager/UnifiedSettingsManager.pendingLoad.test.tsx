/**
 * The Settings Manager keeps its settings fetch in local state; it must
 * register that load so the app root's `data-ready` marker (used by the UI
 * capture harness) cannot read "true" while the settings loader is shown.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPendingLoadCount } from "@/hooks/usePendingLoad";
import { UnifiedSettingsManager } from "./UnifiedSettingsManager";

const { apiMock, deferred } = vi.hoisted(() => {
  const deferred: { resolve: (value: unknown) => void } = { resolve: () => {} };
  const apiMock = vi.fn((command: string) => {
    if (command === "get_all_settings") {
      return new Promise((resolve) => {
        deferred.resolve = resolve;
      });
    }
    return Promise.resolve(/preset/i.test(command) ? [] : {});
  });
  return { apiMock, deferred };
});

vi.mock("@/services/api", () => ({ api: apiMock }));

describe("UnifiedSettingsManager pending load", () => {
  beforeEach(() => {
    apiMock.mockClear();
  });

  it("is registered while settings load and released once they arrive", async () => {
    render(<UnifiedSettingsManager />);
    await act(async () => {});

    expect(apiMock).toHaveBeenCalledWith("get_all_settings", expect.anything());
    expect(getPendingLoadCount()).toBeGreaterThan(0);

    await act(async () => {
      deferred.resolve({ user: null, project: null, local: null, managed: null });
    });

    expect(getPendingLoadCount()).toBe(0);
    expect(screen.queryByText(/settingsManager\.loading|Loading settings/i)).toBeNull();
  });
});
