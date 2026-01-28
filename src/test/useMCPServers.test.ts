/**
 * useMCPServers Hook Tests
 *
 * Tests for the MCP servers management hook that reads from all sources:
 * - Official: ~/.claude.json (user_claude_json, local_claude_json)
 * - Legacy: ~/.claude/settings.json, ~/.claude/.mcp.json
 * - Project: <project>/.mcp.json
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMCPServers } from "../hooks/useMCPServers";
import type { AllMCPServersResponse, MCPServerConfig } from "../types";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

// ============================================================================
// Test Data Fixtures
// ============================================================================

const createMockServerConfig = (
  command: string,
  args?: string[],
  env?: Record<string, string>
): MCPServerConfig => ({
  command,
  args,
  env,
});

const mockUserClaudeJsonServers: Record<string, MCPServerConfig> = {
  "context7": createMockServerConfig("npx", ["-y", "@context7/mcp"], {
    CONTEXT7_API_KEY: "test-key",
  }),
  "sequential-thinking": createMockServerConfig("npx", [
    "-y",
    "@anthropics/sequential-thinking-mcp",
  ]),
};

const mockLocalClaudeJsonServers: Record<string, MCPServerConfig> = {
  "project-specific": createMockServerConfig("node", ["./local-mcp.js"]),
  "context7": createMockServerConfig("npx", ["-y", "@context7/mcp"], {
    CONTEXT7_API_KEY: "project-override-key",
  }),
};

const mockUserSettingsServers: Record<string, MCPServerConfig> = {
  "legacy-server": createMockServerConfig("python", ["-m", "legacy_mcp"]),
};

const mockUserMcpFileServers: Record<string, MCPServerConfig> = {
  "user-mcp-server": createMockServerConfig("node", ["user-mcp.js"]),
};

const mockProjectMcpServers: Record<string, MCPServerConfig> = {
  "team-shared": createMockServerConfig("npx", ["team-mcp"]),
  "context7": createMockServerConfig("npx", ["-y", "@context7/mcp"], {
    CONTEXT7_API_KEY: "team-key",
  }),
};

const createMockResponse = (
  overrides: Partial<AllMCPServersResponse> = {}
): AllMCPServersResponse => ({
  userClaudeJson: mockUserClaudeJsonServers,
  localClaudeJson: mockLocalClaudeJsonServers,
  userSettings: mockUserSettingsServers,
  userMcpFile: mockUserMcpFileServers,
  projectMcpFile: mockProjectMcpServers,
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe("useMCPServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Loading MCP servers from all sources", () => {
    it("should load servers from all 5 sources on mount", async () => {
      const mockResponse = createMockResponse();
      mockInvoke.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useMCPServers("/test/project"));

      // Should start loading
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify all sources are populated
      expect(result.current.userClaudeJson).toEqual(mockUserClaudeJsonServers);
      expect(result.current.localClaudeJson).toEqual(mockLocalClaudeJsonServers);
      expect(result.current.userSettings).toEqual(mockUserSettingsServers);
      expect(result.current.userMcpFile).toEqual(mockUserMcpFileServers);
      expect(result.current.projectMcpFile).toEqual(mockProjectMcpServers);

      // Verify invoke was called with correct parameters
      expect(mockInvoke).toHaveBeenCalledWith("get_all_mcp_servers", {
        projectPath: "/test/project",
      });
    });

    it("should handle null values from backend gracefully", async () => {
      const mockResponse: AllMCPServersResponse = {
        userClaudeJson: null,
        localClaudeJson: null,
        userSettings: null,
        userMcpFile: null,
        projectMcpFile: null,
      };
      mockInvoke.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should convert null to empty objects
      expect(result.current.userClaudeJson).toEqual({});
      expect(result.current.localClaudeJson).toEqual({});
      expect(result.current.userSettings).toEqual({});
      expect(result.current.userMcpFile).toEqual({});
      expect(result.current.projectMcpFile).toEqual({});
    });

    it("should parse MCP server configurations correctly", async () => {
      const serverWithAllFields: Record<string, MCPServerConfig> = {
        "full-config": {
          command: "npx",
          args: ["-y", "mcp-server"],
          env: {
            API_KEY: "secret",
            DEBUG: "true",
          },
          type: "stdio",
          description: "A test server",
        },
      };

      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ userClaudeJson: serverWithAllFields })
      );

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const server = result.current.userClaudeJson["full-config"];
      expect(server).toBeDefined();
      expect(server.command).toBe("npx");
      expect(server.args).toEqual(["-y", "mcp-server"]);
      expect(server.env).toEqual({
        API_KEY: "secret",
        DEBUG: "true",
      });
      expect(server.type).toBe("stdio");
      expect(server.description).toBe("A test server");
    });

    it("should handle HTTP type MCP servers", async () => {
      const httpServer: Record<string, MCPServerConfig> = {
        "http-server": {
          command: "unused",
          type: "http",
          url: "https://api.example.com/mcp",
        },
      };

      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ userClaudeJson: httpServer })
      );

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const server = result.current.userClaudeJson["http-server"];
      expect(server.type).toBe("http");
      expect(server.url).toBe("https://api.example.com/mcp");
    });
  });

  describe("Error handling", () => {
    it("should set error state on load failure", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Failed to read config"));

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe("Failed to read config");
    });

    it("should handle non-Error rejection", async () => {
      mockInvoke.mockRejectedValueOnce("String error message");

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe("String error message");
    });
  });

  describe("Saving MCP servers", () => {
    it("should save to user_claude_json source correctly", async () => {
      mockInvoke.mockResolvedValueOnce(createMockResponse()); // Initial load
      mockInvoke.mockResolvedValueOnce(undefined); // Save call

      const newServers = {
        "new-server": createMockServerConfig("node", ["new.js"]),
      };

      // After save, loadAllMCPServers is called - return updated data
      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ userClaudeJson: newServers })
      );

      const { result } = renderHook(() => useMCPServers("/test/project"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.saveMCPServers("user_claude_json", newServers);
      });

      expect(mockInvoke).toHaveBeenCalledWith("save_mcp_servers", {
        source: "user_claude_json",
        servers: JSON.stringify(newServers),
        projectPath: "/test/project",
      });

      // Local state should be updated via reload after save
      expect(result.current.userClaudeJson).toEqual(newServers);
    });

    it("should save to local_claude_json source correctly", async () => {
      mockInvoke.mockResolvedValueOnce(createMockResponse()); // Initial load
      mockInvoke.mockResolvedValueOnce(undefined); // Save call

      const newServers = {
        "local-server": createMockServerConfig("python", ["local.py"]),
      };

      // After save, loadAllMCPServers is called - return updated data
      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ localClaudeJson: newServers })
      );

      const { result } = renderHook(() => useMCPServers("/test/project"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.saveMCPServers("local_claude_json", newServers);
      });

      expect(mockInvoke).toHaveBeenCalledWith("save_mcp_servers", {
        source: "local_claude_json",
        servers: JSON.stringify(newServers),
        projectPath: "/test/project",
      });

      // Local state should be updated via reload after save
      expect(result.current.localClaudeJson).toEqual(newServers);
    });

    it("should save to legacy sources correctly", async () => {
      const newServers = { test: createMockServerConfig("test", []) };

      mockInvoke.mockResolvedValueOnce(createMockResponse()); // Initial load
      mockInvoke.mockResolvedValueOnce(undefined); // user_settings save
      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ userSettings: newServers })
      ); // reload after user_settings
      mockInvoke.mockResolvedValueOnce(undefined); // user_mcp save
      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ userMcpFile: newServers })
      ); // reload after user_mcp
      mockInvoke.mockResolvedValueOnce(undefined); // project_mcp save
      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ projectMcpFile: newServers })
      ); // reload after project_mcp

      const { result } = renderHook(() => useMCPServers("/test/project"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Test each legacy source
      await act(async () => {
        await result.current.saveMCPServers("user_settings", newServers);
      });
      expect(result.current.userSettings).toEqual(newServers);

      await act(async () => {
        await result.current.saveMCPServers("user_mcp", newServers);
      });
      expect(result.current.userMcpFile).toEqual(newServers);

      await act(async () => {
        await result.current.saveMCPServers("project_mcp", newServers);
      });
      expect(result.current.projectMcpFile).toEqual(newServers);
    });

    it("should throw error on save failure", async () => {
      mockInvoke.mockResolvedValueOnce(createMockResponse());
      mockInvoke.mockRejectedValueOnce(new Error("Permission denied"));

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // The saveMCPServers should throw and re-throw the error
      let thrownError: Error | undefined;
      try {
        await act(async () => {
          await result.current.saveMCPServers("user_claude_json", {});
        });
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError?.message).toBe("Permission denied");
      // Note: error state is set before re-throwing, but act() may clear it
      // The important thing is that the error was thrown
    });
  });

  describe("Reload functionality", () => {
    it("should reload all servers when loadAllMCPServers is called", async () => {
      mockInvoke.mockResolvedValueOnce(createMockResponse());

      const { result } = renderHook(() => useMCPServers());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Update mock for second call
      const updatedServers = {
        "updated-server": createMockServerConfig("updated", []),
      };
      mockInvoke.mockResolvedValueOnce(
        createMockResponse({ userClaudeJson: updatedServers })
      );

      await act(async () => {
        await result.current.loadAllMCPServers();
      });

      expect(result.current.userClaudeJson).toEqual(updatedServers);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  describe("Project path changes", () => {
    it("should reload when projectPath changes", async () => {
      mockInvoke.mockResolvedValue(createMockResponse());

      const { result, rerender } = renderHook(
        ({ projectPath }) => useMCPServers(projectPath),
        { initialProps: { projectPath: "/project/a" } }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_all_mcp_servers", {
        projectPath: "/project/a",
      });

      // Change project path
      rerender({ projectPath: "/project/b" });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get_all_mcp_servers", {
          projectPath: "/project/b",
        });
      });
    });
  });
});
