import type { StateCreator } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { FullAppStore } from "./types";
import type {
    BoardSessionData,
    BoardSessionStats,
    ZoomLevel,
} from "../../types/board.types";
import type { ClaudeMessage, ClaudeSession } from "../../types";

export interface BoardSliceState {
    boardSessions: Record<string, BoardSessionData>;
    visibleSessionIds: string[];
    isLoadingBoard: boolean;
    zoomLevel: ZoomLevel;
    activeBrush: {
        type: "role" | "status" | "tool" | "file";
        value: string;
    } | null;
}

export interface BoardSliceActions {
    loadBoardSessions: (sessions: ClaudeSession[]) => Promise<void>;
    setZoomLevel: (level: ZoomLevel) => void;
    setActiveBrush: (brush: BoardSliceState["activeBrush"]) => void;
    clearBoard: () => void;
}

export type BoardSlice = BoardSliceState & BoardSliceActions;

const initialBoardState: BoardSliceState = {
    boardSessions: {},
    visibleSessionIds: [],
    isLoadingBoard: false,
    zoomLevel: 1, // Default to SKIM
    activeBrush: null,
};

/**
 * Heuristic to determine if a session is "interesting" or just boilerplate
 */
const getSessionRelevance = (messages: ClaudeMessage[], stats: BoardSessionStats) => {
    // Low interestingness: few messages, mostly system/boilerplate, or no tool use
    if (messages.length < 3) return 0.2;

    let score = 0.5;

    // High tool use often means active coding/research
    if (stats.toolCount > 5) score += 0.3;

    // Errors might be interesting to debug
    if (stats.errorCount > 0) score += 0.2;

    // Mentioning .md files or documentation might be high value for summaries
    const hasDocWork = messages.some(m => {
        const toolUse = m.toolUse as any;
        const path = toolUse?.input?.path || toolUse?.input?.file_path || "";
        return typeof path === 'string' && path.toLowerCase().endsWith('.md');
    });
    if (hasDocWork) score += 0.2;

    return Math.min(score, 1.0);
};

export const createBoardSlice: StateCreator<
    FullAppStore,
    [],
    [],
    BoardSlice
> = (set) => ({
    ...initialBoardState,

    loadBoardSessions: async (sessions: ClaudeSession[]) => {
        set({ isLoadingBoard: true });

        try {
            const loadPromises = sessions.map(async (session) => {
                try {
                    const messages = await invoke<ClaudeMessage[]>(
                        "load_session_messages",
                        { sessionPath: session.file_path }
                    );

                    // Calculate stats
                    const stats: BoardSessionStats = {
                        totalTokens: 0,
                        inputTokens: 0,
                        outputTokens: 0,
                        errorCount: 0,
                        durationMs: 0,
                        toolCount: 0,
                    };

                    messages.forEach((msg) => {
                        if (msg.usage) {
                            const usage = msg.usage;
                            stats.inputTokens += usage.input_tokens || 0;
                            stats.outputTokens += usage.output_tokens || 0;
                            stats.totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
                        }

                        if (msg.durationMs) stats.durationMs += msg.durationMs;
                        if (msg.stopReasonSystem?.toLowerCase().includes("error")) stats.errorCount++;
                        if (msg.toolUse) stats.toolCount++;

                        if (msg.toolUseResult) {
                            const result = msg.toolUseResult as any;
                            if (result.is_error || (result.stderr && result.stderr.length > 0)) {
                                stats.errorCount++;
                            }
                        }
                    });

                    const relevance = getSessionRelevance(messages, stats);

                    return {
                        sessionId: session.session_id,
                        data: {
                            session: { ...session, relevance }, // Inject heuristic relevance
                            messages,
                            stats,
                        },
                    };
                } catch (err) {
                    console.error(`Failed to load session ${session.session_id}:`, err);
                    return null;
                }
            });

            const results = await Promise.all(loadPromises);

            const boardSessions: Record<string, BoardSessionData> = {};
            const visibleSessionIds: string[] = [];

            // Sort by relevance then recency
            const sortedResults = results
                .filter((r): r is NonNullable<typeof r> => r !== null)
                .sort((a, b) => {
                    const relA = (a.data.session as any).relevance || 0;
                    const relB = (b.data.session as any).relevance || 0;
                    if (relA !== relB) return relB - relA;
                    return new Date(b.data.session.last_modified).getTime() - new Date(a.data.session.last_modified).getTime();
                });

            sortedResults.forEach((res) => {
                boardSessions[res.sessionId] = res.data;
                visibleSessionIds.push(res.sessionId);
            });

            set({
                boardSessions,
                visibleSessionIds,
                isLoadingBoard: false,
            });

        } catch (error) {
            console.error("Failed to load board sessions:", error);
            set({ isLoadingBoard: false });
        }
    },

    setZoomLevel: (zoomLevel: ZoomLevel) => set({ zoomLevel }),
    setActiveBrush: (activeBrush) => set({ activeBrush }),
    clearBoard: () => set(initialBoardState),
});
