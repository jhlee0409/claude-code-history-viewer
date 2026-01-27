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
    toolBreakdown: Record<string, number>;
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

export interface BoardState {
    sessions: Record<string, BoardSessionData>;
    visibleSessionIds: string[];
    isLoadingBoard: boolean;
    zoomLevel: ZoomLevel;
    activeBrush: {
        type: "role" | "status" | "tool" | "file";
        value: string;
    } | null;
    dateFilter: DateFilter;
}
