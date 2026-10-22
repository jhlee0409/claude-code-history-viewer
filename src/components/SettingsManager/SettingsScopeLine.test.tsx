import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedSettingsManager, useSettingsManager } from "./UnifiedSettingsManager";
import type { AllSettingsResponse, SettingsScope } from "@/types";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("react-i18next", async importOriginal => ({ ...await importOriginal<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string, args?: Record<string, unknown>) => args ? `${key} ${Object.values(args).join(" ")}` : key }) }));
vi.mock("@/hooks/useMCPServers", () => ({ useMCPServers: () => ({ saveMCPServers: vi.fn() }) }));
vi.mock("./sidebar/SettingsSidebar", () => ({ SettingsSidebar: () => {
  const manager = useSettingsManager();
  return <nav>{(["user", "project", "local", "managed"] as SettingsScope[]).map(scope => <button key={scope} onClick={() => manager.setActiveScope(scope)}>{scope}</button>)}</nav>;
} }));
vi.mock("./sections/CustomDirectoriesSection", () => ({ CustomDirectoriesSection: () => null }));
vi.mock("./sections/SessionResumeSection", () => ({ SessionResumeSection: () => null }));
vi.mock("./sections/WslSection", () => ({ WslSection: () => null }));
vi.mock("./sections/MCPServersSection", () => ({ MCPServersSection: () => null }));

const fixture = (): AllSettingsResponse => ({
  user: '{"model":"sonnet"}', project: '{}', local: '{}', managed: '{}',
  metadata: { serverHome: "/srv/remote", scopes: {
    user: { path: "/srv/remote/.claude/settings.json", state: "present", readOnly: false },
    project: { path: "/work/team/.claude/settings.json", state: "present", readOnly: false },
    local: { path: "/work/team/.claude/settings.local.json", state: "missing", readOnly: false },
    managed: { path: "/policy/managed-settings.json", state: "present", readOnly: true },
  } },
});
const line = () => screen.getByTestId("settings-scope-line");

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((command: string) => Promise.resolve(command === "get_all_settings" ? fixture() : {}));
});

describe("settings write-scope line through the actual editor", () => {
  it.each(["user", "project", "local", "managed"] as const)("shows the exact %s resolver file and scope, not a browser-derived path", async scope => {
    render(<UnifiedSettingsManager projectPath="/work/team" />);
    await screen.findByRole("button", { name: scope });
    fireEvent.click(screen.getByRole("button", { name: scope }));
    expect(line()).toHaveTextContent(`settingsManager.scope.${scope}`);
    expect(line().querySelector("[data-path]")).toHaveAttribute("data-path", fixture().metadata!.scopes[scope].path);
    expect(line().querySelector("[data-path]")).toHaveAttribute("title", fixture().metadata!.scopes[scope].path);
    if (scope === "user") expect(line().querySelector("[data-path]")).toHaveAttribute("data-path-kind", "home");
    expect(line()).toHaveTextContent(scope === "managed" ? "settingsManager.writeScope.readOnly" : "settingsManager.writeScope.saveTarget");
  });

  it("shares the footer's dirty predicate including unapplied and invalid JSON text, undo and reset", async () => {
    render(<UnifiedSettingsManager />);
    const jsonButton = await screen.findByRole("button", { name: "settingsManager.mode.json" });
    fireEvent.click(jsonButton);
    const editor = screen.getByRole("textbox", { name: "settingsManager.mode.json" });
    expect(line()).toHaveTextContent("settingsManager.writeScope.clean");
    fireEvent.change(editor, { target: { value: '{"model":' } });
    expect(line()).toHaveTextContent("settingsManager.writeScope.dirty");
    expect(screen.getByRole("button", { name: "settingsManager.unified.footer.save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "settingsManager.json.undo" }));
    expect(line()).toHaveTextContent("settingsManager.writeScope.clean");
    fireEvent.change(editor, { target: { value: '{"model":"opus"}' } });
    expect(line()).toHaveTextContent("settingsManager.writeScope.dirty");
    expect(screen.getByRole("button", { name: "settingsManager.unified.footer.save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "settingsManager.unified.footer.reset" }));
    expect(line()).toHaveTextContent("settingsManager.writeScope.clean");
  });

  it("keeps the line visible but hides all unconfirmed paths while loading and on request failure", async () => {
    let reject!: (error: Error) => void;
    apiMock.mockImplementation((command: string) => command === "get_all_settings" ? new Promise((_, r) => { reject = r; }) : Promise.resolve({}));
    render(<UnifiedSettingsManager />);
    expect(line()).toHaveTextContent("settingsManager.writeScope.loading");
    expect(line().querySelector("[data-path]")).toBeNull();
    await act(async () => reject(new Error("offline")));
    expect(line()).toHaveTextContent("settingsManager.writeScope.loadError");
    expect(within(line()).queryByText("settingsManager.writeScope.clean")).toBeNull();
  });
});
