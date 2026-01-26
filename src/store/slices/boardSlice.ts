import type { StateCreator } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { FullAppStore } from "./types";
import type {
    BoardSessionData,
    BoardSessionStats,
    ZoomLevel,
    SessionFileEdit,
    SessionDepth,
} from "../../types/board.types";
import type { ClaudeMessage, ClaudeSession } from "../../types";
import { analyzeSessionMessages } from "../../utils/sessionAnalytics";

export interface BoardSliceState {
    boardSessions: Record<string, BoardSessionData>;
    visibleSessionIds: string[];
    isLoadingBoard: boolean;
    zoomLevel: ZoomLevel;
    activeBrush: {
        type: "role" | "status" | "tool" | "file";
        value: string;
    } | null;
    selectedMessageId: string | null;
    isMarkdownPretty: boolean;
}

export interface BoardSliceActions {
    loadBoardSessions: (sessions: ClaudeSession[]) => Promise<void>;
    setZoomLevel: (level: ZoomLevel) => void;
    setActiveBrush: (brush: BoardSliceState["activeBrush"]) => void;
    setSelectedMessageId: (id: string | null) => void;
    setMarkdownPretty: (pretty: boolean) => void;
    clearBoard: () => void;
}

export type BoardSlice = BoardSliceState & BoardSliceActions;

const initialBoardState: BoardSliceState = {
    boardSessions: {},
    visibleSessionIds: [],
    isLoadingBoard: false,
    zoomLevel: 1, // Default to SKIM
    activeBrush: null,
    selectedMessageId: null,
    isMarkdownPretty: true, // Default to pretty printing
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

    // Commits significantly increase relevance
    if (stats.commitCount > 0) score += 0.3;

    return Math.min(score, 1.0);
};

const getSessionDepth = (messages: ClaudeMessage[], stats: BoardSessionStats): SessionDepth => {
    // Epic: Significant work, many tools, long history
    if (messages.length > 50 || stats.toolCount > 20 || stats.totalTokens > 50000) {
        return "epic";
    }
    // Deep: Moderate work
    if (messages.length > 15 || stats.toolCount > 5) {
        return "deep";
    }
    // Shallow: Simple Q&A or short interactions
    return "shallow";
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

                    // 1. Run Derived Analytics
                    const derivedStats = analyzeSessionMessages(messages);

                    // 2. Calculate Base Stats & Extract specific FileEdit objects for the timeline
                    const stats: BoardSessionStats = {
                        totalTokens: 0,
                        inputTokens: 0,
                        outputTokens: 0,
                        errorCount: derivedStats.errorCount, // Use derived count which is more robust
                        durationMs: 0,
                        toolCount: 0,

                        // Map derived stats
                        fileEditCount: derivedStats.fileEditCount,
                        commitCount: derivedStats.commitCount,
                        filesTouchedCount: derivedStats.filesTouched.size
                    };

                    const fileEdits: SessionFileEdit[] = [];

                    messages.forEach((msg) => {
                        if (msg.usage) {
                            const usage = msg.usage;
                            stats.inputTokens += usage.input_tokens || 0;
                            stats.outputTokens += usage.output_tokens || 0;
                            stats.totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
                        }

                        if (msg.durationMs) stats.durationMs += msg.durationMs;

                        if (msg.toolUse) {
                            stats.toolCount++;
                            const toolUse = msg.toolUse as any;
                            const name = toolUse.name;
                            const input = toolUse.input;

                            // Hoist explicit file edit events for the timeline visualization
                            if (['write_to_file', 'replace_file_content', 'create_file', 'edit_file'].includes(name)) {
                                const path = input?.path || input?.file_path || input?.TargetFile || "";
                                if (path) {
                                    fileEdits.push({
                                        path,
                                        timestamp: msg.timestamp,
                                        messageId: msg.uuid,
                                        type: name === 'create_file' ? 'create' : 'edit'
                                    });
                                }
                            }
                        }
                    });

                    const relevance = getSessionRelevance(messages, stats);
                    const depth = getSessionDepth(messages, stats);

                    return {
                        sessionId: session.session_id,
                        data: {
                            session: { ...session, relevance }, // Inject heuristic relevance
                            messages,
                            stats,
                            fileEdits,
                            depth,
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
    setSelectedMessageId: (id) => set({ selectedMessageId: id }),
    setMarkdownPretty: (isMarkdownPretty) => set({ isMarkdownPretty }),
    clearBoard: () => set(initialBoardState),
});
