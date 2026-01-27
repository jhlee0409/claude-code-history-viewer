/**
 * UnifiedMCPList Component Tests
 *
 * Tests for the unified MCP server list component that displays
 * servers from all sources with conflict detection and priority resolution.
 *
 * Priority order (highest to lowest):
 * 1. local_claude_json (project-specific in ~/.claude.json)
 * 2. project_mcp (.mcp.json in project root)
 * 3. user_claude_json (user-scoped in ~/.claude.json)
 * 4. user_mcp (~/.claude/.mcp.json)
 * 5. user_settings (~/.claude/settings.json)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnifiedMCPList } from "../components/SettingsManager/components/UnifiedMCPList";
import type { MCPServerConfig } from "../types";
import React from "react";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "settingsManager.mcp.unified.title": "All MCP Servers",
        "settingsManager.mcp.unified.description": "View all MCP servers across all sources",
        "settingsManager.mcp.unified.servers": "servers",
        "settingsManager.mcp.unified.conflict": "This server is defined in multiple sources",
        "settingsManager.mcp.unified.conflictCount": `${options?.count} servers have conflicts`,
        "settingsManager.mcp.unified.alsoDefinedIn": "Also defined in:",
        "settingsManager.mcp.sourceUserClaudeJson": "User MCP",
        "settingsManager.mcp.sourceLocalClaudeJson": "Local MCP",
        "settingsManager.mcp.sourceProjectMcp": ".mcp.json",
        "settingsManager.mcp.sourceLegacySettings": "Legacy Settings",
        "settingsManager.mcp.sourceLegacyMcp": "Legacy MCP",
        "settingsManager.mcp.legacy": "legacy",
        "settingsManager.mcp.command": "Command",
        "settingsManager.mcp.url": "URL",
        "settingsManager.mcp.envVars": "Environment Variables",
        "settingsManager.mcp.empty": "No MCP servers configured",
      };
      return translations[key] || key;
    },
  }),
}));

// ============================================================================
// Test Data Fixtures
// ============================================================================

const createServer = (
  command: string,
  args?: string[],
  env?: Record<string, string>
): MCPServerConfig => ({
  command,
  args,
  env,
});

const createHttpServer = (url: string): MCPServerConfig => ({
  command: "unused",
  type: "http",
  url,
});

// ============================================================================
// Tests
// ============================================================================

describe("UnifiedMCPList", () => {
  const defaultProps = {
    userClaudeJsonServers: {} as Record<string, MCPServerConfig>,
    localClaudeJsonServers: {} as Record<string, MCPServerConfig>,
    userSettingsServers: {} as Record<string, MCPServerConfig>,
    userMcpServers: {} as Record<string, MCPServerConfig>,
    projectMcpServers: {} as Record<string, MCPServerConfig>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering servers from all sources", () => {
    it("should render servers from user_claude_json source", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            context7: createServer("npx", ["-y", "@context7/mcp"]),
            "sequential-thinking": createServer("npx", ["-y", "seq-mcp"]),
          }}
        />
      );

      expect(screen.getByText("context7")).toBeInTheDocument();
      expect(screen.getByText("sequential-thinking")).toBeInTheDocument();
      expect(screen.getByText("2 servers")).toBeInTheDocument();
    });

    it("should render servers from local_claude_json source", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          localClaudeJsonServers={{
            "local-server": createServer("node", ["local.js"]),
          }}
        />
      );

      expect(screen.getByText("local-server")).toBeInTheDocument();
    });

    it("should render servers from project_mcp source", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          projectMcpServers={{
            "team-mcp": createServer("npx", ["team-mcp"]),
          }}
        />
      );

      expect(screen.getByText("team-mcp")).toBeInTheDocument();
    });

    it("should render servers from legacy sources", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userSettingsServers={{
            "legacy-settings": createServer("python", ["legacy.py"]),
          }}
          userMcpServers={{
            "legacy-mcp": createServer("node", ["legacy-mcp.js"]),
          }}
        />
      );

      expect(screen.getByText("legacy-settings")).toBeInTheDocument();
      expect(screen.getByText("legacy-mcp")).toBeInTheDocument();
    });

    it("should render empty state when no servers configured", () => {
      render(<UnifiedMCPList {...defaultProps} />);

      expect(screen.getByText("No MCP servers configured")).toBeInTheDocument();
    });
  });

  describe("Priority resolution", () => {
    it("should show local_claude_json server when same name exists in multiple sources", () => {
      const onNavigate = vi.fn();

      render(
        <UnifiedMCPList
          {...defaultProps}
          localClaudeJsonServers={{
            "context7": createServer("npx", ["-y", "@context7/mcp"], {
              KEY: "local-key",
            }),
          }}
          userClaudeJsonServers={{
            "context7": createServer("npx", ["-y", "@context7/mcp"], {
              KEY: "user-key",
            }),
          }}
          onNavigateToSource={onNavigate}
        />
      );

      // Should only show one context7 server
      const serverElements = screen.getAllByText("context7");
      expect(serverElements).toHaveLength(1);

      // Should have Local MCP badge (highest priority)
      const localBadges = screen.getAllByText(/Local MCP/);
      expect(localBadges.length).toBeGreaterThan(0);
    });

    it("should prioritize project_mcp over user_claude_json", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          projectMcpServers={{
            "shared-server": createServer("npx", ["project-version"]),
          }}
          userClaudeJsonServers={{
            "shared-server": createServer("npx", ["user-version"]),
          }}
        />
      );

      // Should show project source badge (.mcp.json)
      const badges = screen.getAllByText(/\.mcp\.json/);
      expect(badges.length).toBeGreaterThan(0);
    });

    it("should prioritize user_claude_json over legacy sources", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "my-server": createServer("npx", ["official"]),
          }}
          userSettingsServers={{
            "my-server": createServer("npx", ["legacy"]),
          }}
        />
      );

      // Should show User MCP badge (not legacy) - there should be at least one
      const badges = screen.getAllByText(/User MCP/);
      expect(badges.length).toBeGreaterThan(0);
    });

    it("should apply full priority order: local > project > user > user_mcp > user_settings", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          localClaudeJsonServers={{
            "server-a": createServer("local", []),
          }}
          projectMcpServers={{
            "server-b": createServer("project", []),
            "server-a": createServer("project-override", []), // Should be overridden
          }}
          userClaudeJsonServers={{
            "server-c": createServer("user", []),
            "server-b": createServer("user-override", []), // Should be overridden
          }}
          userMcpServers={{
            "server-d": createServer("user-mcp", []),
            "server-c": createServer("user-mcp-override", []), // Should be overridden
          }}
          userSettingsServers={{
            "server-e": createServer("settings", []),
            "server-d": createServer("settings-override", []), // Should be overridden
          }}
        />
      );

      // Should have 5 unique servers
      expect(screen.getByText("5 servers")).toBeInTheDocument();

      // Verify each server appears once
      expect(screen.getByText("server-a")).toBeInTheDocument();
      expect(screen.getByText("server-b")).toBeInTheDocument();
      expect(screen.getByText("server-c")).toBeInTheDocument();
      expect(screen.getByText("server-d")).toBeInTheDocument();
      expect(screen.getByText("server-e")).toBeInTheDocument();
    });
  });

  describe("Conflict detection", () => {
    it("should show conflict badge when server defined in multiple sources", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "conflicting-server": createServer("npx", ["v1"]),
          }}
          userSettingsServers={{
            "conflicting-server": createServer("npx", ["v2"]),
          }}
        />
      );

      // Should show conflict count in the badge tooltip area
      // The badge shows just the number, tooltip shows full message
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("should show conflicting sources in expanded view", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          localClaudeJsonServers={{
            "multi-conflict": createServer("local", []),
          }}
          projectMcpServers={{
            "multi-conflict": createServer("project", []),
          }}
          userClaudeJsonServers={{
            "multi-conflict": createServer("user", []),
          }}
        />
      );

      // Click to expand
      const serverRow = screen.getByText("multi-conflict");
      fireEvent.click(serverRow);

      // Should show "Also defined in:" section with other sources
      expect(screen.getByText("Also defined in:")).toBeInTheDocument();
    });

    it("should not show conflict for unique servers", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "unique-a": createServer("a", []),
          }}
          projectMcpServers={{
            "unique-b": createServer("b", []),
          }}
        />
      );

      // Should not have conflict count (no AlertTriangle with number)
      expect(screen.queryByText(/servers have conflicts/)).not.toBeInTheDocument();
    });
  });

  describe("Server details display", () => {
    it("should show command and args when expanded", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "test-server": createServer("npx", ["-y", "@test/mcp", "--verbose"]),
          }}
        />
      );

      // Click to expand
      fireEvent.click(screen.getByText("test-server"));

      // Should show command with args
      expect(screen.getByText("npx -y @test/mcp --verbose")).toBeInTheDocument();
    });

    it("should show environment variables when expanded", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "env-server": createServer("node", ["server.js"], {
              API_KEY: "key123", // <= 8 chars, fully masked
              DEBUG: "true",
            }),
          }}
        />
      );

      fireEvent.click(screen.getByText("env-server"));

      expect(screen.getByText("Environment Variables")).toBeInTheDocument();
      expect(screen.getByText("API_KEY:")).toBeInTheDocument();
      // Secret values (<=8 chars) should be fully masked
      expect(screen.getByText("••••••••")).toBeInTheDocument();
      expect(screen.getByText("DEBUG:")).toBeInTheDocument();
      expect(screen.getByText("true")).toBeInTheDocument();
    });

    it("should show URL for HTTP type servers", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "http-server": createHttpServer("https://api.example.com/mcp"),
          }}
        />
      );

      fireEvent.click(screen.getByText("http-server"));

      expect(screen.getByText("URL")).toBeInTheDocument();
      expect(screen.getByText("https://api.example.com/mcp")).toBeInTheDocument();
    });

    it("should mask sensitive environment variables", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "secrets": createServer("node", [], {
              API_KEY: "secret1", // <= 8 chars, fully masked
              TOKEN: "secret2", // <= 8 chars, fully masked
              SECRET: "secret3", // <= 8 chars, fully masked
              NORMAL_VAR: "visible",
            }),
          }}
        />
      );

      fireEvent.click(screen.getByText("secrets"));

      // Keys with sensitive names should be masked
      const maskedValues = screen.getAllByText("••••••••");
      expect(maskedValues).toHaveLength(3);

      // Normal values should be visible
      expect(screen.getByText("visible")).toBeInTheDocument();
    });
  });

  describe("Source summary", () => {
    it("should show count by source in header", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "user-a": createServer("a", []),
            "user-b": createServer("b", []),
          }}
          localClaudeJsonServers={{
            "local-a": createServer("a", []),
          }}
          projectMcpServers={{
            "project-a": createServer("a", []),
            "project-b": createServer("b", []),
            "project-c": createServer("c", []),
          }}
        />
      );

      // Should show counts for each source
      expect(screen.getByText("(2)")).toBeInTheDocument(); // user_claude_json
      expect(screen.getByText("(1)")).toBeInTheDocument(); // local_claude_json
      expect(screen.getByText("(3)")).toBeInTheDocument(); // project_mcp
    });

    it("should separate legacy sources visually", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "official": createServer("a", []),
          }}
          userSettingsServers={{
            "legacy": createServer("b", []),
          }}
        />
      );

      // Legacy sources should have separator
      expect(screen.getByText("|")).toBeInTheDocument();
    });
  });

  describe("Navigation", () => {
    it("should call onNavigateToSource when clicking source badge in summary", () => {
      const onNavigate = vi.fn();

      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "test-server": createServer("test", []),
          }}
          onNavigateToSource={onNavigate}
        />
      );

      // Click the source badge - find the one in the summary (with count)
      const badges = screen.getAllByText(/User MCP/);
      // Click the first one (in summary)
      fireEvent.click(badges[0]);

      expect(onNavigate).toHaveBeenCalledWith("user_claude_json");
    });

    it("should call onNavigateToSource with server name when clicking navigate button", () => {
      const onNavigate = vi.fn();

      render(
        <UnifiedMCPList
          {...defaultProps}
          localClaudeJsonServers={{
            "specific-server": createServer("node", []),
          }}
          onNavigateToSource={onNavigate}
        />
      );

      // Find the external link button by its SVG icon class
      const buttons = screen.getAllByRole("button");
      // The last button should be the navigate button (not the collapsible trigger)
      const navigateButton = buttons[buttons.length - 1];
      fireEvent.click(navigateButton);

      expect(onNavigate).toHaveBeenCalledWith("local_claude_json", "specific-server");
    });
  });

  describe("Sorting", () => {
    it("should sort servers alphabetically by name", () => {
      render(
        <UnifiedMCPList
          {...defaultProps}
          userClaudeJsonServers={{
            "zebra": createServer("z", []),
            "apple": createServer("a", []),
            "mango": createServer("m", []),
          }}
        />
      );

      const serverNames = screen.getAllByRole("button").map((btn) => btn.textContent);
      const serverTexts = serverNames.join(" ");

      // Check order: apple should come before mango, mango before zebra
      expect(serverTexts.indexOf("apple")).toBeLessThan(serverTexts.indexOf("mango"));
      expect(serverTexts.indexOf("mango")).toBeLessThan(serverTexts.indexOf("zebra"));
    });
  });
});
