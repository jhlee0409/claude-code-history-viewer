import type { ClaudeMessage, ClaudeSession } from "./index";

export interface BoardSessionStats {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    errorCount: number;
    durationMs: number;
    toolCount: number;

    // Derived Metrics
    fileEditCount: number;
    commitCount: number;
    filesTouchedCount: number; // Count of unique files
}

export interface SessionFileEdit {
    path: string;
    timestamp: string;
    messageId: string;
    type: "write" | "edit" | "create";
}

export type SessionDepth = "epic" | "deep" | "shallow";

export interface BoardSessionData {
    session: ClaudeSession;
    messages: ClaudeMessage[];
    stats: BoardSessionStats;
    fileEdits: SessionFileEdit[];
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
