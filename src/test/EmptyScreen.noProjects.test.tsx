/**
 * With no projects at all, the main area must not ask the user to "select a
 * session" from a sidebar that says there are none. It explains what was
 * searched and where, instead. While projects are still loading (or
 * providers are being detected), or once there is at least one project, it
 * keeps the usual "select a session" prompt.
 *
 * Startup scans Claude Code only: other assistants (Codex CLI, OpenCode, …)
 * are searched only after the user asks ("Find other providers"). Until then
 * the empty state must say "no Claude Code projects", not "no history", and
 * offer that same action.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { useAppStore } from "@/store/useAppStore";
import { EmptyScreen } from "@/layouts/shell/screens";
import type { ClaudeProject, ProviderInfo } from "@/types";

const project = { name: "p", path: "/tmp/p", actual_path: "/tmp/p", provider: "claude" } as unknown as ClaudeProject;
const initial = useAppStore.getState();

/** Settings as after (or before) an explicit provider discovery. */
function withDiscovered(discoveredProviderIds: string[] | undefined) {
  const metadata = useAppStore.getState().userMetadata;
  useAppStore.setState({
    userMetadata: {
      ...metadata,
      settings: { ...metadata.settings, discoveredProviderIds } as typeof metadata.settings,
    },
  });
}

const reset = {
  projects: [],
  isLoadingProjects: false,
  isLoading: false,
  isDetectingProviders: false,
  providers: [],
  userMetadata: initial.userMetadata,
  discoverProviders: initial.discoverProviders,
};

describe("EmptyScreen", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(() => {
    useAppStore.setState({ ...reset, claudePath: "" });
  });
  beforeEach(() => {
    useAppStore.setState({ ...reset, claudePath: "/home/u/.claude" });
    withDiscovered(undefined);
  });

  it("before any provider discovery: says no Claude Code projects (not 'no history') and names the folder", () => {
    render(<EmptyScreen />);
    expect(screen.getByRole("heading", { name: i18n.t("session.noProjects.claudeTitle") })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: i18n.t("session.noProjects.title") })).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("session.noProjects.claudeDescription"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.select"))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.selectDescription"))).not.toBeInTheDocument();
    expect(screen.getByText("/home/u/.claude")).toBeInTheDocument();
  });

  it("before any provider discovery: offers 'Find other providers', which runs the explicit discovery", () => {
    const discoverProviders = vi.fn(() => Promise.resolve());
    useAppStore.setState({ discoverProviders });
    render(<EmptyScreen />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("project.discoverProviders") }));
    expect(discoverProviders).toHaveBeenCalledTimes(1);
  });

  it("after a discovery that found nothing: says no projects in the searched providers, can search again", () => {
    withDiscovered(["claude", "codex"]);
    const discoverProviders = vi.fn(() => Promise.resolve());
    useAppStore.setState({ discoverProviders });
    render(<EmptyScreen />);
    expect(screen.getByRole("heading", { name: i18n.t("session.noProjects.title") })).toBeInTheDocument();
    expect(screen.getByText(i18n.t("session.noProjects.description"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("project.discoverProviders") }));
    expect(discoverProviders).toHaveBeenCalledTimes(1);
  });

  it("after a discovery whose result was not saved: detected providers count as searched", () => {
    useAppStore.setState({
      providers: [{ id: "codex", display_name: "Codex CLI", base_path: "/h/.codex", is_available: true } as ProviderInfo],
    });
    render(<EmptyScreen />);
    expect(screen.getByRole("heading", { name: i18n.t("session.noProjects.title") })).toBeInTheDocument();
  });

  it("with no projects and no resolved folder: names the default folder", () => {
    useAppStore.setState({ claudePath: "" });
    render(<EmptyScreen />);
    expect(screen.getByText("~/.claude")).toBeInTheDocument();
  });

  it("while projects load: keeps the 'select a session' prompt", () => {
    useAppStore.setState({ isLoadingProjects: true });
    render(<EmptyScreen />);
    expect(screen.getByText(i18n.t("session.select"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.noProjects.claudeTitle"))).not.toBeInTheDocument();
  });

  it("while providers are being detected: keeps the 'select a session' prompt", () => {
    useAppStore.setState({ isDetectingProviders: true });
    render(<EmptyScreen />);
    expect(screen.getByText(i18n.t("session.select"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.noProjects.claudeTitle"))).not.toBeInTheDocument();
  });

  it("while the app initializes: keeps the 'select a session' prompt", () => {
    useAppStore.setState({ isLoading: true });
    render(<EmptyScreen />);
    expect(screen.getByText(i18n.t("session.select"))).toBeInTheDocument();
  });

  it("with projects: asks to select a session", () => {
    useAppStore.setState({ projects: [project] });
    render(<EmptyScreen />);
    expect(screen.getByText(i18n.t("session.select"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.noProjects.claudeTitle"))).not.toBeInTheDocument();
  });
});
