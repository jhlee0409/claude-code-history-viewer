import { act, render, screen } from "@testing-library/react";
import { Suspense, startTransition, useContext } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { UnifiedSettingsManager, SettingsManagerContext } from "./UnifiedSettingsManager";
import type { AllSettingsResponse } from "@/types";

const { apiMock, gate } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  gate: {
    setProjectPath: null as ((path: string | undefined) => void) | null,
    suspendPath: null as string | null,
    suspended: false,
    hold: new Promise<void>(() => {}),
  },
}));
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("react-i18next", async original => ({ ...await original<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useMCPServers", () => ({ useMCPServers: () => ({ saveMCPServers: vi.fn() }) }));
vi.mock("./sidebar/SettingsSidebar", () => ({ SettingsSidebar: () => null }));
vi.mock("./sections/CustomDirectoriesSection", () => ({ CustomDirectoriesSection: () => null }));
vi.mock("./sections/SessionResumeSection", () => ({ SessionResumeSection: () => null }));
vi.mock("./sections/WslSection", () => ({ WslSection: () => null }));
vi.mock("./sections/MCPServersSection", () => ({ MCPServersSection: () => null }));
vi.mock("./SettingsScopeLine", async original => {
  const actual = await original<typeof import("./SettingsScopeLine")>();
  function SuspendedScopeLine(props: Parameters<typeof actual.SettingsScopeLine>[0]) {
    const manager = useContext(SettingsManagerContext);
    if (manager) gate.setProjectPath = manager.setProjectPath;
    if (gate.suspendPath !== null && manager?.projectPath === gate.suspendPath) {
      gate.suspended = true;
      throw gate.hold;
    }
    return <actual.SettingsScopeLine {...props} />;
  }
  return { SettingsScopeLine: SuspendedScopeLine };
});

const fixture = (): AllSettingsResponse => ({
  user: "{}", project: "{}", local: "{}", managed: null,
  metadata: { serverHome: "/committed-home", scopes: {
    user: { path: "/committed-home/.claude/settings.json", state: "present", readOnly: false },
    project: { path: "/committed/.claude/settings.json", state: "missing", readOnly: false },
    local: { path: "/committed/.claude/settings.local.json", state: "missing", readOnly: false },
    managed: { path: null, state: "unsupported", readOnly: true },
  } },
});
let finishLoad: (settings: AllSettingsResponse) => void;
beforeEach(() => {
  gate.setProjectPath = null;
  gate.suspendPath = null;
  gate.suspended = false;
  apiMock.mockReset();
  apiMock.mockImplementation((command: string) => command === "get_all_settings" ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve({}));
});
function open() {
  return render(<Suspense fallback={<div>speculative fallback</div>}><UnifiedSettingsManager projectPath="/committed" /></Suspense>);
}

it("accepts a request for the committed project normally (positive control)", async () => {
  open();
  await act(async () => finishLoad(fixture()));
  expect(screen.getByTestId("settings-scope-line").querySelector("[data-path]")).toHaveAttribute("data-path", "/committed-home/.claude/settings.json");
});

it("an uncommitted suspended selection cannot invalidate the committed project's request", async () => {
  const view = open();
  gate.suspendPath = "/speculative";
  act(() => {
    startTransition(() => gate.setProjectPath!("/speculative"));
  });
  expect(gate.suspended, "the speculative render actually ran and suspended").toBe(true);
  expect(screen.queryByText("speculative fallback")).toBeNull();
  await act(async () => finishLoad(fixture()));
  expect(screen.getByTestId("settings-scope-line")).toHaveTextContent("settingsManager.writeScope.present");
  expect(screen.getByTestId("settings-scope-line").querySelector("[data-path]")).toHaveAttribute("data-path", "/committed-home/.claude/settings.json");
  view.unmount();
});
