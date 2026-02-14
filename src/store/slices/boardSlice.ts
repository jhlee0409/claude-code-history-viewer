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
import type { ActiveBrush } from "@/utils/brushMatchers";
import type { ClaudeMessage, ClaudeSession } from "../../types";
import { analyzeSessionMessages } from "../../utils/sessionAnalytics";
import { isAbsolutePath } from "../../utils/pathUtils";

const TIMELINE_STORAGE_KEY = "timeline-expanded";

export interface BoardSliceState {
    boardSessions: Record<string, BoardSessionData>;
    visibleSessionIds: string[]; // This is now the FILTERED list
    allSortedSessionIds: string[]; // This is the full sorted list
    isLoadingBoard: boolean;
    zoomLevel: ZoomLevel;
    activeBrush: ActiveBrush | null;
    stickyBrush: boolean;
    selectedMessageId: string | null;
    isMarkdownPretty: boolean;
    boardLoadError: string | null;
    isTimelineExpanded: boolean;
}

export interface BoardSliceActions {
    loadBoardSessions: (sessions: ClaudeSession[]) => Promise<void>;
    setZoomLevel: (level: ZoomLevel) => void;
    setActiveBrush: (brush: BoardSliceState["activeBrush"]) => void;
    setStickyBrush: (sticky: boolean) => void;
    setSelectedMessageId: (id: string | null) => void;
    setMarkdownPretty: (pretty: boolean) => void;
    clearBoard: () => void;
    toggleTimeline: () => void;
}

export type BoardSlice = BoardSliceState & BoardSliceActions;

const initialBoardState: BoardSliceState = {
    boardSessions: {},
    visibleSessionIds: [],
    allSortedSessionIds: [],
    isLoadingBoard: false,
    zoomLevel: 1, // Default to SKIM
    activeBrush: null,
    stickyBrush: false,
    selectedMessageId: null,
    isMarkdownPretty: true, // Default to pretty printing
    boardLoadError: null,
    isTimelineExpanded: (() => {
        try {
            const stored = localStorage.getItem(TIMELINE_STORAGE_KEY);
            return stored === "true";
        } catch {
            return false;
        }
    })(),
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
        if (m.type !== 'assistant' || !m.toolUse) return false;
        const input = m.toolUse.input as Record<string, unknown>;
        const path = input?.path || input?.file_path || "";
        return typeof path === 'string' && path.toLowerCase().endsWith('.md');
    });
    if (hasDocWork) score += 0.2;

    // Commits significantly increase relevance
    if (stats.commitCount > 0) score += 0.3;

    return Math.min(score, 1.0);
};

const getSessionDepth = (messages: ClaudeMessage[], stats: BoardSessionStats): SessionDepth => {
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
> = (set, get) => ({
    ...initialBoardState,

    loadBoardSessions: async (sessions: ClaudeSession[]) => {
        set({ isLoadingBoard: true, boardLoadError: null });

        try {
            const selectedProject = get().selectedProject;
            let projectCommits: import("../../types").GitCommit[] = [];

            if (selectedProject?.actual_path) {
                if (!isAbsolutePath(selectedProject.actual_path)) {
                    const msg = "Invalid project path";
                    set({ isLoadingBoard: false, boardLoadError: msg });
                    return;
                }
                try {
                    projectCommits = await invoke<import("../../types").GitCommit[]>(
                        "get_git_log",
                        { actualPath: selectedProject.actual_path, limit: 1000 }
                    );
                } catch (e) {
                    console.error("Failed to fetch git log:", e);
                    const msg = "Failed to fetch git log";
                    set({ isLoadingBoard: false, boardLoadError: msg });
                    return; // Abort
                }
            }

            const loadPromises = sessions.map(async (session) => {
                try {
                    if (!isAbsolutePath(session.file_path)) {
                        set({ boardLoadError: "Invalid session path" });
                        return null;
                    }
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
                        shellCount: derivedStats.shellCount,
                        commitCount: derivedStats.commitCount,
                        filesTouchedCount: derivedStats.filesTouched.size,
                        hasMarkdownEdits: derivedStats.hasMarkdownEdits, // New Flag
                        markdownEditCount: derivedStats.markdownEditCount,
                        toolBreakdown: derivedStats.toolBreakdown,
                        searchCount: derivedStats.searchCount,
                        webCount: derivedStats.webCount,
                        mcpCount: derivedStats.mcpCount,
                        fileToolCount: derivedStats.fileToolCount,
                        codeReadCount: derivedStats.codeReadCount,
                        gitToolCount: derivedStats.gitToolCount
                    };

                    const fileEdits: SessionFileEdit[] = [];

                    messages.forEach((msg) => {
                        if (msg.type === 'assistant' && msg.usage) {
                            const usage = msg.usage;
                            stats.inputTokens += usage.input_tokens || 0;
                            stats.outputTokens += usage.output_tokens || 0;
                            stats.totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
                        }

                        if (msg.type === 'assistant' && msg.durationMs) stats.durationMs += msg.durationMs;

                        if (msg.type === 'assistant' && msg.toolUse) {
                            stats.toolCount++;
                            const toolUse = msg.toolUse;
                            const name = toolUse.name as string;
                            const input = toolUse.input as Record<string, unknown>;

                            // Hoist explicit file edit events for the timeline visualization
                            if (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file', 'Edit', 'Replace'].includes(name) || /write|edit|replace|patch/i.test(name)) {
                                const path = (input?.path || input?.file_path || input?.TargetFile || "") as string;
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

                    // 3. Correlate with real Git Commits
                    // Sessions have first_message_time and last_message_time
                    const startTime = new Date(session.first_message_time).getTime();
                    const endTime = new Date(session.last_modified).getTime();
                    // Add a small buffer (5 mins) to catch commits that happened just after the session closed
                    const buffer = 5 * 60 * 1000;

                    const gitCommits = projectCommits.filter(c => {
                        const commitTime = c.timestamp * 1000;
                        return commitTime >= (startTime - buffer) && commitTime <= (endTime + buffer);
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
                            gitCommits,
                            depth,
                        },
                    };
                } catch (err) {
                    console.error(`Failed to load session ${session.session_id}:`, err);
                    const msg = "Failed to load session";
                    set({ boardLoadError: msg });
                    return null;
                }
            });

            const results = await Promise.all(loadPromises);

            const boardSessions: Record<string, BoardSessionData> = {};
            const allSortedSessionIds: string[] = [];

            // Sort by relevance then recency
            const sortedResults = results
                .filter((r): r is NonNullable<typeof r> => r !== null)
                .sort((a, b) => {
                    const relA = a.data.session.relevance || 0;
                    const relB = b.data.session.relevance || 0;
                    if (relA !== relB) return relB - relA;
                    return new Date(b.data.session.last_message_time).getTime() - new Date(a.data.session.last_message_time).getTime();
                });

            sortedResults.forEach((res) => {
                boardSessions[res.sessionId] = res.data;
                allSortedSessionIds.push(res.sessionId);
            });

            set({
                boardSessions,
                allSortedSessionIds,
                visibleSessionIds: allSortedSessionIds, // Initially show all
                isLoadingBoard: false,
            });

        } catch (error) {
            console.error("Failed to load board sessions:", error);
            const msg = "Failed to load board sessions";
            set({ isLoadingBoard: false, boardLoadError: msg });
        }
    },

    setZoomLevel: (zoomLevel: ZoomLevel) => set({ zoomLevel }),
    setActiveBrush: (activeBrush) => set({ activeBrush }),
    setStickyBrush: (stickyBrush) => set({ stickyBrush }),
    setSelectedMessageId: (id) => set({ selectedMessageId: id }),
    setMarkdownPretty: (isMarkdownPretty) => set({ isMarkdownPretty }),

    toggleTimeline: () => set((state) => {
        const next = !state.isTimelineExpanded;
        try { localStorage.setItem(TIMELINE_STORAGE_KEY, String(next)); } catch { /* ignore */ }
        return { isTimelineExpanded: next };
    }),

    clearBoard: () => set(initialBoardState),
});
