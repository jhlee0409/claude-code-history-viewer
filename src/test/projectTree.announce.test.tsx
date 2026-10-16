/**
 * The tree's "Selected: …" announcement runs once per selection change.
 *
 * `announceTree` alternates its text so a repeat is re-read; an effect that
 * re-ran on every new `t` identity therefore set state on every render and
 * never settled (a passive-effect loop: no React error, the test worker ran
 * out of memory). Rendering with a `t` that changes on every render must
 * settle and announce exactly once.
 */
import { expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  // A fresh `t` on every call, as a non-memoised mock or wrapper would give.
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", on: vi.fn(), off: vi.fn() } }),
}));

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectTree } from "@/components/ProjectTree";

const PROJECT = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "2026-01-01T00:00:00.000Z",
  provider: "claude",
} as const;

it("announces the selected project once, with an unstable t", async () => {
  useAppStore.setState({ projects: [PROJECT], selectedProject: PROJECT } as never);
  let renders = 0;
  const { container } = render(
    <TooltipProvider>
      <ProjectTree
        projects={[PROJECT]}
        sessions={[]}
        selectedProject={PROJECT}
        selectedSession={null}
        onProjectSelect={() => {
          renders += 1;
        }}
        onSessionSelect={vi.fn()}
        onGlobalStatsClick={vi.fn()}
        isLoading={false}
      />
    </TooltipProvider>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const live = container.querySelector('[aria-live]');
  expect(live?.textContent?.trim()).toContain("project.currentSelection");
  expect(renders).toBe(0);
});
