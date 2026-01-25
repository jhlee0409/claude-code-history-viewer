import type { ClaudeMessage, ClaudeSession } from "./index";

export interface BoardSessionStats {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    errorCount: number;
    durationMs: number;
    toolCount: number;
}

export interface BoardSessionData {
    session: ClaudeSession;
    messages: ClaudeMessage[];
    stats: BoardSessionStats;
}

export type ZoomLevel = 0 | 1 | 2; // 0: PIXEL, 1: SKIM, 2: READ

export interface BoardState {
    sessions: Record<string, BoardSessionData>;
    visibleSessionIds: string[];
    isLoadingBoard: boolean;
    zoomLevel: ZoomLevel;
    activeBrush: {
        type: "role" | "status" | "tool" | "file";
        value: string;
    } | null;
}
