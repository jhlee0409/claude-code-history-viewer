import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnifiedMCPDialog } from "../components/SettingsManager/dialogs/UnifiedMCPDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "source" in options ? `${key}(${String(options.source)})` : key,
  }),
}));

const server = { command: "npx", args: ["srv"] };

vi.mock("../components/SettingsManager/UnifiedSettingsManager", () => ({
  useSettingsManager: () => ({
    mcpServers: {
      userClaudeJson: { shared: server },
      localClaudeJson: {},
      userSettings: {},
      userMcpFile: {},
      projectMcpFile: { shared: server },
    },
    setActiveScope: vi.fn(),
  }),
}));

describe("UnifiedMCPDialog accessibility", () => {
  it("names each conflict item's go-to-source button after its source", () => {
    render(<UnifiedMCPDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByRole("button", { name: "settingsManager.unified.mcp.goToSourceOf(User (~/.claude.json))" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settingsManager.unified.mcp.goToSourceOf(Project .mcp.json)" })
    ).toBeInTheDocument();
  });
});
