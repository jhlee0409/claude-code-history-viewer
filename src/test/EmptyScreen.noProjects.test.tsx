/**
 * With no projects at all, the main area must not ask the user to "select a
 * session" from a sidebar that says there are none. It explains that no
 * history was found and where the app looks for it instead. While projects
 * are still loading, or once there is at least one, it keeps the usual
 * "select a session" prompt.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { useAppStore } from "@/store/useAppStore";
import { EmptyScreen } from "@/layouts/shell/screens";
import type { ClaudeProject } from "@/types";

const project = { name: "p", path: "/tmp/p", actual_path: "/tmp/p", provider: "claude" } as unknown as ClaudeProject;

describe("EmptyScreen", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(() => {
    useAppStore.setState({ projects: [], isLoadingProjects: false, isLoading: false, claudePath: "" });
  });
  beforeEach(() => {
    useAppStore.setState({ projects: [], isLoadingProjects: false, isLoading: false, claudePath: "/home/u/.claude" });
  });

  it("with no projects: one 'no projects' state that names the folder it read", () => {
    render(<EmptyScreen />);
    expect(screen.getByRole("heading", { name: i18n.t("session.noProjects.title") })).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.select"))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.selectDescription"))).not.toBeInTheDocument();
    expect(screen.getByText("/home/u/.claude")).toBeInTheDocument();
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
    expect(screen.queryByText(i18n.t("session.noProjects.title"))).not.toBeInTheDocument();
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
    expect(screen.queryByText(i18n.t("session.noProjects.title"))).not.toBeInTheDocument();
  });
});
