import type { ClaudeMessage, ClaudeSession, GitCommit } from "./index";

export interface BoardSessionStats {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    errorCount: number;
    durationMs: number;
    toolCount: number;

    // Derived Metrics
    fileEditCount: number;
    shellCount: number;
    commitCount: number;
    filesTouchedCount: number; // Count of unique files
    hasMarkdownEdits: boolean; // New Flag for distinct visibility
    markdownEditCount: number;
    toolBreakdown: Record<string, number>;
    searchCount: number;
    webCount: number;
    mcpCount: number;
    fileToolCount: number; // ls, create, glob
    codeReadCount: number; // read_file etc
    gitToolCount: number; // git status etc
}

export interface SessionFileEdit {
    path: string;
    timestamp: string;
    messageId: string;
    type: "write" | "edit" | "create";
}

export type SessionDepth = "deep" | "shallow";

export interface BoardSessionData {
    session: ClaudeSession;
    messages: ClaudeMessage[];
    stats: BoardSessionStats;
    fileEdits: SessionFileEdit[];
    gitCommits: GitCommit[];
    depth: SessionDepth;
}

export type ZoomLevel = 0 | 1 | 2; // 0: PIXEL, 1: SKIM, 2: READ

export interface DateFilter {
    start: Date | null;
    end: Date | null;
}

// ... imports
import type { RendererVariant } from "@/components/renderers/types";

// ... existing code ...

export interface ActiveBrush {
    type: "model" | "status" | "tool" | "file" | "hook" | "command" | "mcp";
    value: string; // for mcp type, can be "all" or "server_name"
}

export interface BrushableCard {
    role: string;
    model?: string;
    variant: RendererVariant;
    isError: boolean;
    isCancelled: boolean;
    isCommit: boolean;
    isGit: boolean; // Generic git support
    isShell: boolean;
    isFileEdit: boolean;
    editedFiles: string[];
    hasHook: boolean; // Has stop_hook
    shellCommands: string[]; // Terminal/shell commands executed
    mcpServers: string[]; // MCP server names used
}

export interface BoardState {
    sessions: Record<string, BoardSessionData>;
    visibleSessionIds: string[];
    isLoadingBoard: boolean;
    zoomLevel: ZoomLevel;
    activeBrush: ActiveBrush | null;
    dateFilter: DateFilter;
}
