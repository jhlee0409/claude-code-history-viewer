import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedSettingsManager, useSettingsManager } from "./UnifiedSettingsManager";
import type { AllSettingsResponse, SettingsScope } from "@/types";
import { SettingsScopeLine } from "./SettingsScopeLine";

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
  it("does not let an old save refresh invalidate the newly selected project's pending load", async () => {
    let finishSave!: () => void;
    let finishNew!: (settings: AllSettingsResponse) => void;
    apiMock.mockImplementation((command: string, args: { projectPath?: string }) => {
      if (command === "save_settings") return new Promise<void>(resolve => { finishSave = resolve; });
      if (command === "get_all_settings") return args.projectPath === "/new" ? new Promise(resolve => { finishNew = resolve; }) : Promise.resolve(fixture());
      return Promise.resolve({});
    });
    const view = render(<UnifiedSettingsManager projectPath="/old" />);
    fireEvent.click(await screen.findByRole("button", { name: "settingsManager.mode.json" }));
    fireEvent.change(screen.getByRole("textbox", { name: "settingsManager.mode.json" }), { target: { value: '{"model":"opus"}' } });
    fireEvent.click(screen.getByRole("button", { name: "settingsManager.unified.footer.save" }));
    expect(apiMock).toHaveBeenCalledWith("save_settings", expect.anything());
    view.rerender(<UnifiedSettingsManager projectPath="/new" />);
    await act(async () => finishSave());
    const newer = fixture();
    newer.metadata!.serverHome = "/new-home";
    newer.metadata!.scopes.user.path = "/new-home/.claude/settings.json";
    await act(async () => finishNew(newer));
    expect(line()).not.toHaveTextContent("settingsManager.writeScope.loading");
    expect(line().querySelector("[data-path]")).toHaveAttribute("data-path", "/new-home/.claude/settings.json");
  });
  it("clears a prior project's pending snapshot even when it was equal and clean", async () => {
    apiMock.mockImplementation((command: string, args: { projectPath?: string }) => {
      const settings = fixture();
      if (args?.projectPath === "/new") settings.user = '{"model":"opus"}';
      return Promise.resolve(command === "get_all_settings" ? settings : {});
    });
    const view = render(<UnifiedSettingsManager projectPath="/old" />);
    fireEvent.click(await screen.findByRole("button", { name: "settingsManager.mode.json" }));
    const editor = screen.getByRole("textbox", { name: "settingsManager.mode.json" });
    fireEvent.blur(editor);
    expect(line()).toHaveTextContent("settingsManager.writeScope.clean");
    view.rerender(<UnifiedSettingsManager projectPath="/new" />);
    await screen.findByRole("button", { name: "settingsManager.mode.json" });
    expect(line()).toHaveTextContent("settingsManager.writeScope.clean");
    expect(screen.getByRole("button", { name: "settingsManager.unified.footer.save" })).toBeDisabled();
  });

  it("does not carry another scope's JSON text into the new save target", async () => {
    render(<UnifiedSettingsManager projectPath="/work/team" />);
    fireEvent.click(await screen.findByRole("button", { name: "settingsManager.mode.json" }));
    fireEvent.click(screen.getByRole("button", { name: "project" }));
    expect(line()).toHaveTextContent("settingsManager.writeScope.clean");
    expect(screen.queryByRole("textbox", { name: "settingsManager.mode.json" })).toBeNull();
    expect(screen.getByRole("button", { name: "settingsManager.unified.footer.save" })).toBeDisabled();
  });
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

  it("never associates a late project response with a newer selection", async () => {
    const requests = new Map<string, (value: AllSettingsResponse) => void>();
    apiMock.mockImplementation((command: string, args: { projectPath?: string }) => command === "get_all_settings" ? new Promise(resolve => { requests.set(args.projectPath!, resolve); }) : Promise.resolve({}));
    const view = render(<UnifiedSettingsManager projectPath="/old" />);
    view.rerender(<UnifiedSettingsManager projectPath="/new" />);
    const newer = fixture();
    newer.metadata!.serverHome = "/new/home";
    newer.metadata!.scopes.user.path = "/new/home/.claude/settings.json";
    await act(async () => requests.get("/new")!(newer));
    expect(line().querySelector("[data-path]")).toHaveAttribute("data-path", "/new/home/.claude/settings.json");
    await act(async () => requests.get("/old")!(fixture()));
    expect(line().querySelector("[data-path]")).toHaveAttribute("data-path", "/new/home/.claude/settings.json");
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

describe("settings file evidence and preview provenance", () => {
  it.each(["missing", "present", "read_error", "no_project", "unsupported", "resolve_error", "unknown"] as const)("keeps %s distinct without guessing a target", state => {
    const settings = fixture();
    const scope = state === "no_project" ? "project" : state === "unsupported" ? "managed" : "user";
    settings.metadata!.scopes[scope] = { path: ["present", "missing", "read_error"].includes(state) ? "/confirmed/settings.json" : null, state, readOnly: scope === "managed" };
    render(<SettingsScopeLine allSettings={settings} scope={scope} dirty={false} readOnly={scope === "managed"} />);
    expect(line()).toHaveTextContent(`settingsManager.writeScope.${state}`);
    expect(line().querySelectorAll("[data-path]")).toHaveLength(["present", "missing", "read_error"].includes(state) ? 1 : 0);
    if (scope !== "managed") expect(line()).toHaveTextContent(["present", "missing"].includes(state) ? "settingsManager.writeScope.saveTarget" : "settingsManager.writeScope.targetUnconfirmed");
  });

  it("uses legacy unknown metadata rather than synthesizing a home or a file", () => {
    const settings = fixture();
    delete settings.metadata;
    render(<SettingsScopeLine allSettings={settings} scope="user" dirty={false} readOnly={false} />);
    expect(line()).toHaveTextContent("settingsManager.writeScope.unknown");
    expect(line()).toHaveTextContent("settingsManager.writeScope.sourcesUnknown");
    expect(line().querySelector("[data-path]")).toBeNull();
  });

  it("reports composite sources, not every present file or only the scalar winner", () => {
    const settings = fixture();
    settings.project = '{"model":"opus","env":{"TEAM":"yes"}}';
    settings.local = '{"permissions":{"allow":["Read"]}}';
    render(<SettingsScopeLine allSettings={settings} scope="project" dirty readOnly={false} />);
    const sources = screen.getByTestId("settings-preview-sources");
    expect(sources).toHaveTextContent("settingsManager.scope.project");
    expect(sources).toHaveTextContent("settingsManager.scope.local");
    expect(sources).not.toHaveTextContent("settingsManager.scope.user");
    expect(sources).not.toHaveTextContent("settingsManager.scope.managed");
    expect(sources).toHaveTextContent("settingsManager.writeScope.mergeNote");
  });

  it("retains actual managed contributions alongside merged user permissions", () => {
    const settings = fixture();
    settings.user = '{"permissions":{"deny":["Write"]}}';
    settings.managed = '{"model":"sonnet"}';
    render(<SettingsScopeLine allSettings={settings} scope="managed" dirty={false} readOnly />);
    const sources = screen.getByTestId("settings-preview-sources");
    expect(sources).toHaveTextContent("settingsManager.scope.managed");
    expect(sources).toHaveTextContent("settingsManager.scope.user");
    expect(line()).toHaveTextContent("settingsManager.writeScope.noWrite");
    expect(line()).not.toHaveTextContent("settingsManager.writeScope.saveTarget");
  });
});
