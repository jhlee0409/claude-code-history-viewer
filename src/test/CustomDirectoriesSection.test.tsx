import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomDirectoriesSection } from "../components/SettingsManager/sections/CustomDirectoriesSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const { platform, mockStore } = vi.hoisted(() => ({
  platform: { tauri: false },
  mockStore: {
    userMetadata: {
      settings: {
        customClaudePaths: [{ path: "/srv/claude-work", label: "Work" }],
      },
    },
    addCustomClaudePath: vi.fn(),
    removeCustomClaudePath: vi.fn(),
    updateCustomClaudePathLabel: vi.fn(),
    claudePath: "/home/user/.claude",
  },
}));

vi.mock("@/utils/platform", () => ({
  isTauri: () => platform.tauri,
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: Object.assign(() => mockStore, { getState: () => mockStore }),
}));

describe("CustomDirectoriesSection", () => {
  beforeEach(() => {
    platform.tauri = false;
  });

  it("shows the directories read-only in the web UI", () => {
    render(<CustomDirectoriesSection isExpanded onToggle={vi.fn()} />);

    expect(screen.getByText("/srv/claude-work")).toBeInTheDocument();
    expect(screen.getByText("settings.customDirectories.serverManaged")).toBeInTheDocument();
    expect(screen.queryByText("settings.customDirectories.addDirectory")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "settings.customDirectories.remove" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "settings.customDirectories.label" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the controls in the desktop app", () => {
    platform.tauri = true;
    render(<CustomDirectoriesSection isExpanded onToggle={vi.fn()} />);

    expect(screen.getByText("settings.customDirectories.addDirectory")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings.customDirectories.remove" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("settings.customDirectories.serverManaged")).not.toBeInTheDocument();
  });
});
