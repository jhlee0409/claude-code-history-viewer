import { useMemo, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../store/useAppStore";
import type { BoardSessionData, ZoomLevel } from "../../types/board.types";
import { InteractionCard } from "./InteractionCard";
import { Terminal, FilePlus, FileText, Book, TrendingUp, Zap, GitCommit, Search, Globe, Plug, Eye } from "lucide-react";
import { clsx } from "clsx";
import {
    extractClaudeMessageContent,
    isToolEvent,
    getMessageRole,
    isClaudeAssistantMessage,
    getToolUseBlock
} from "../../utils/messageUtils";
import { getCardSemantics } from "@/utils/cardSemantics";
import { formatDuration, formatNumber } from "@/utils/formatters";
import type { ActiveBrush } from "@/utils/brushMatchers";
import type { ClaudeMessage } from "../../types";
import { useTranslation } from "react-i18next";



interface SessionLaneProps {
    data: BoardSessionData;
    zoomLevel: ZoomLevel;
    activeBrush?: ActiveBrush | null;
    onHover?: (type: ActiveBrush["type"], value: string) => void;
    onLeave?: () => void;
    onToggleSticky?: () => void;
    onInteractionClick?: (messageUuid: string) => void;
    onFileClick?: (file: string) => void;
    isSelected?: boolean;
    onNavigate?: (messageId: string) => void;
    onNext?: () => void;
    onPrev?: () => void;
    siblings?: ClaudeMessage[]; // For merged cards
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    onHeightChange?: (height: number) => void;
}

export const SessionLane = ({
    data,
    zoomLevel,
    activeBrush,
    onHover,
    onToggleSticky,
    onInteractionClick,
    onFileClick,
    isSelected,
    onNavigate,
    scrollContainerRef,
    onHeightChange
}: SessionLaneProps) => {
    const { t } = useTranslation();
    const { session, messages, stats, depth } = data;
    const selectedMessageId = useAppStore(state => state.selectedMessageId);

    // Filter out "no-content" messages and Group sequential tool events
    // We do this BEFORE virtualization so the count is correct
    const visibleItems = useMemo(() => {
        const filtered = messages.filter(msg => {
            const content = extractClaudeMessageContent(msg) || "";
            // isToolEvent takes `any` so it safely checks toolUse
            const isTool = isToolEvent(msg);
            return content.trim().length > 0 || isTool;
        });

        // Grouping Logic for all Zoom Levels
        const grouped: { head: ClaudeMessage, siblings: ClaudeMessage[] }[] = [];
        let currentGroup: { head: ClaudeMessage, siblings: ClaudeMessage[] } | null = null;

        filtered.forEach((msg) => {
            // Helper to get role safely from union
            const role = getMessageRole(msg);
            const isTool = isToolEvent(msg);

            if (currentGroup) {
                const headRole = getMessageRole(currentGroup.head);
                const headIsTool = isToolEvent(currentGroup.head);

                // For Zoom Level 0, we want to group by "color band" (semantic type)
                if (zoomLevel === 0) {
                    const bothAreAssistant = role === 'assistant' && headRole === 'assistant';
                    const bothAreUser = role === 'user' && headRole === 'user';

                    // Same role, same tool status = same color
                    if ((bothAreAssistant || bothAreUser) && isTool === headIsTool) {
                        currentGroup.siblings.push(msg);
                        return;
                    }
                } else {
                    // Grouping Logic for Zoom Levels 1 & 2
                    // 1. Tool Sequence: If both are tool events, merge them (implies continuous execution loop).
                    // 2. Text -> Tool: If current is tool and head is assistant (mostly text), merge.
                    const bothAreTools = isTool && headIsTool;
                    const textToTool = isTool && headRole === 'assistant' && role === 'assistant';

                    if (bothAreTools || textToTool) {
                        currentGroup.siblings.push(msg);
                        return;
                    }
                }

                grouped.push(currentGroup);
                currentGroup = { head: msg, siblings: [] };
            } else {
                currentGroup = { head: msg, siblings: [] };
            }
        });

        if (currentGroup) {
            grouped.push(currentGroup);
        }
        return grouped;
    }, [messages, zoomLevel]);

    // Compute match ratio for lane header (Step 7)
    const matchStats = useMemo(() => {
        if (!activeBrush) return null;

        let matched = 0;
        let total = 0;

        visibleItems.forEach(item => {
            // Check all messages in this group (head + siblings)
            const allMessages = [item.head, ...item.siblings];
            
            allMessages.forEach(msg => {
                total++;
                const content = extractClaudeMessageContent(msg) || "";
                const toolBlock = getToolUseBlock(msg);
                const role = getMessageRole(msg);

                // Use shared semantic logic
                const semantics = getCardSemantics(msg, content, toolBlock, role, activeBrush);
                if (semantics.brushMatch) matched++;
            });
        });

        return { matched, total };
    }, [activeBrush, visibleItems]);

    const rowVirtualizer = useVirtualizer({
        count: visibleItems.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: (index) => {
            const item = visibleItems[index];
            if (!item) return 80;
            const msg = item.head;
            if (!msg) return 80;

            if (zoomLevel === 0) {
                // Pixel/Heatmap view
                let totalTokens = 0;
                const allMsgs = [msg, ...item.siblings];

                let hasUsageParams = false;
                for (const m of allMsgs) {
                    if (isClaudeAssistantMessage(m) && m.usage) {
                        totalTokens += (m.usage.input_tokens || 0) + (m.usage.output_tokens || 0);
                        hasUsageParams = true;
                    }
                }

                // Fallback heuristic if no usage data found
                if (!hasUsageParams) {
                    const totalLen = allMsgs.reduce((acc, m) => acc + (extractClaudeMessageContent(m)?.length || 0), 0);
                    // Approximate ~4 chars per token
                    totalTokens = Math.floor(totalLen / 4);
                }

                return Math.min(Math.max(totalTokens / 50, 4), 20);
            }

            const content = extractClaudeMessageContent(msg) || "";
            const isTool = isToolEvent(msg);
            const len = content.length;

            if (zoomLevel === 1) {
                if (isTool) {
                    // Base size 80 + siblings indicator space
                    return 80 + (item.siblings.length > 0 ? 12 : 0);
                }
                if (len < 100) return 60;
                return 90;
            }

            if (isTool) {
                // Base 140, expand a bit if many siblings?
                return 140;
            }
            if (len < 50) return 70;
            if (len < 200) return 120;
            if (len < 500) return 180;
            return 250;
        },
        overscan: 10,
    });

    const totalSize = rowVirtualizer.getTotalSize();

    useEffect(() => {
        if (onHeightChange) {
            onHeightChange(totalSize);
        }
    }, [totalSize, onHeightChange]);

    const getDepthStyles = () => {
        if (zoomLevel === 0) {
            return clsx(
                "w-[80px] min-w-[80px] border-r border-border/30",
                "bg-transparent",
                isSelected && "bg-accent/5 ring-1 ring-inset ring-accent/40"
            );
        }

        switch (depth) {
            case 'deep':
                return clsx(
                    "w-[380px] min-w-[380px] border-slate-200/50 dark:border-slate-800/50",
                    "bg-transparent",
                    isSelected && "ring-2 ring-inset ring-accent/50 bg-accent/5 shadow-xl shadow-accent/5"
                );
            default:
                return clsx(
                    "w-[320px] min-w-[320px]",
                    "bg-transparent",
                    isSelected && "ring-2 ring-inset ring-accent/50 bg-accent/5 shadow-xl shadow-accent/5"
                );
        }
    };

    const durationMinutes = stats.durationMs ? stats.durationMs / (1000 * 60) : 0;

    return (
        <div className={clsx(
            "flex flex-col h-full border-r transition-all relative group",
            getDepthStyles()
        )}>
            {zoomLevel !== 0 && (
                <div className={clsx(
                    "absolute left-6 top-0 bottom-0 w-px z-0 pointer-events-none transition-colors",
                    isSelected ? "bg-accent/40" : "bg-border/40"
                )} />
            )}

            <div className={clsx(
                "border-b border-border/50 shrink-0 z-10 backdrop-blur-sm sticky top-0 px-4 py-3 flex flex-col",
                zoomLevel === 0 ? "h-[110px] bg-background/90" : "bg-card/40"
            )}>
                {zoomLevel === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 text-center h-full justify-between">
                        <div className="flex gap-1">
                            {stats?.commitCount > 0 && <span title={t("session.board.gitCommits")}><GitCommit className="w-2.5 h-2.5 text-indigo-500" /></span>}
                        </div>
                        <div className="text-[10px] font-bold text-muted-foreground">
                            {new Date(session.last_modified).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                        </div>
                        <div className="mt-auto text-[8px] font-mono text-muted-foreground">
                            {Math.round((stats?.totalTokens || 0) / 1000)}k
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full gap-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                                <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                                    {new Date(session.last_modified).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}  •  {new Date(session.last_modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </span>
                            </div>
                            <div className="flex gap-3 items-center">
                                {/* Activity Summary Row 1: Tokens & Git & Edits */}

                                {stats.commitCount > 0 && (
                                    <div className="flex items-center gap-1 text-indigo-500" title={t("session.board.gitCommits")}>
                                        <GitCommit className="w-3 h-3" />
                                        <span className="text-[10px] font-bold">{stats.commitCount}</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-1 text-emerald-500" title={t("analytics.inputTokens")}>
                                    <TrendingUp className="w-3 h-3" />
                                    <span className="text-[10px] font-mono">{formatNumber(stats.inputTokens || 0)}</span>
                                </div>

                                <div className="flex items-center gap-1 text-purple-500" title={t("analytics.outputTokens")}>
                                    <Zap className="w-3 h-3" />
                                    <span className="text-[10px] font-mono">{formatNumber(stats.outputTokens || 0)}</span>
                                </div>


                            </div>
                        </div>

                        <div className="flex items-baseline gap-2 pb-1 border-b border-border/20">
                            <div className="text-xl font-bold font-mono text-foreground">
                                {formatNumber(stats.totalTokens)}
                                <span className="text-[10px] text-muted-foreground font-normal ml-1">{t("analytics.tokens")}</span>
                            </div>
                            <div className="ml-auto text-[10px] text-muted-foreground flex items-center gap-3">
                                {matchStats && (
                                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-accent/10 text-accent rounded-sm border border-accent/20 animate-in fade-in slide-in-from-right-1">
                                        <span className="font-bold">{matchStats.matched}/{matchStats.total}</span>
                                        <div className="flex gap-px opacity-60">
                                            {Array.from({ length: 8 }).map((_, i) => (
                                                <span key={i} className={clsx(
                                                    "w-1 h-3 rounded-[1px]",
                                                    i < (matchStats.matched / matchStats.total) * 8 ? "bg-accent" : "bg-accent/20"
                                                )} />
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <span>{messages.length} {t("messageViewer.messagesShort")}</span>
                                <span>{formatDuration(durationMinutes)}</span>
                            </div>
                        </div>

                        {/* Tool Usage breakdown and Real Git Commits */}
                        <div className="flex flex-col gap-1.5 py-1">
                            {/* Visual Activity Bar (Shorthands) */}
                            <div className="flex items-center gap-2 pt-1 border-t border-border/10">
                                {/* Auto-scanned Tool Icons */}

                                {/* 1. Shell / Terminal */}
                                {stats.shellCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-sky-500",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'terminal' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.shell")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'terminal'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'terminal');
                                            }
                                        }}
                                    >
                                        <Terminal className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.shellCount}</span>
                                    </button>
                                )}

                                {/* 2. Files Created */}
                                {/* 2. File Tools (Creates & Lists) */}
                                {(() => {
                                    const createdCount = data.fileEdits.filter(e => e.type === 'create').length;
                                    // If we have stats.fileToolCount > 0, we show something.
                                    // If we have creates, prioritize that visual.
                                    if (createdCount > 0) {
                                        return (
                                            <button
                                                className={clsx(
                                                    "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                                    "text-emerald-500",
                                                    activeBrush?.type === 'tool' && activeBrush.value === 'file' && "brush-match bg-accent/10"
                                                )}
                                                title={t("session.board.clickToFilter.filesCreated", { count: createdCount, total: stats.fileToolCount })}
                                                onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'file'); }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onHover?.('tool', 'file');
                                                    }
                                                }}
                                            >
                                                <FilePlus className="w-3 h-3" />
                                                <span className="text-[10px] font-bold font-mono">{createdCount}</span>
                                            </button>
                                        );
                                    } else if (stats.fileToolCount > 0) {
                                        return (
                                            <button
                                                className={clsx(
                                                    "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                                    "text-blue-500",
                                                    activeBrush?.type === 'tool' && activeBrush.value === 'file' && "brush-match bg-accent/10"
                                                )}
                                                title={t("session.board.clickToFilter.fileOperations")}
                                                onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'file'); }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onHover?.('tool', 'file');
                                                    }
                                                }}
                                            >
                                                <FilePlus className="w-3 h-3" />
                                                <span className="text-[10px] font-bold font-mono">{stats.fileToolCount}</span>
                                            </button>
                                        );
                                    }
                                    return null;
                                })()}

                                {/* 3. File Search (Grep/Glob) */}
                                {stats.searchCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-amber-500",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'search' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.search")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'search'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'search');
                                            }
                                        }}
                                    >
                                        <Search className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.searchCount}</span>
                                    </button>
                                )}

                                {/* Web Search/Fetch */}
                                {stats.webCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-sky-400",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'web' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.web")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'web'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'web');
                                            }
                                        }}
                                    >
                                        <Globe className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.webCount}</span>
                                    </button>
                                )}

                                {/* MCP Tools */}
                                {stats.mcpCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-purple-500",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'mcp' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.mcp")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'mcp'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'mcp');
                                            }
                                        }}
                                    >
                                        <Plug className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.mcpCount}</span>
                                    </button>
                                )}

                                {/* Git Tools (Status/Diff/Etc) */}
                                {stats.gitToolCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-orange-500",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'git' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.git")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'git'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'git');
                                            }
                                        }}
                                    >
                                        <GitCommit className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.gitToolCount}</span>
                                    </button>
                                )}

                                {/* 4. Docs (Markdown) */}
                                {stats.hasMarkdownEdits && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-amber-500",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'document' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.docs")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'document'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'document');
                                            }
                                        }}
                                    >
                                        <Book className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.markdownEditCount}</span>
                                    </button>
                                )}

                                {/* 5. Code Edits */}
                                {stats.fileEditCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-foreground/70",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'code' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.edits")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'code'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'code');
                                            }
                                        }}
                                    >
                                        <FileText className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.fileEditCount}</span>
                                    </button>
                                )}

                                {/* 6. Code Reads */}
                                {stats.codeReadCount > 0 && (
                                    <button
                                        className={clsx(
                                            "flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -ml-1 transition-colors border border-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            "text-sky-500/70",
                                            activeBrush?.type === 'tool' && activeBrush.value === 'code' && "brush-match bg-accent/10"
                                        )}
                                        title={t("session.board.clickToFilter.reads")}
                                        onClick={(e) => { e.stopPropagation(); onHover?.('tool', 'code'); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onHover?.('tool', 'code');
                                            }
                                        }}
                                    >
                                        <Eye className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.codeReadCount}</span>
                                    </button>
                                )}
                            </div>

                            {/* Actual Git History (Ground Truth) */}
                            {data.gitCommits && data.gitCommits.length > 0 && (
                                <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 pt-1 border-t border-border/10">
                                    <div className="text-[8px] uppercase font-bold text-blue-500/70 tracking-tighter w-full">{t("session.board.gitCommits")}</div>
                                    {data.gitCommits.slice(0, 2).map(commit => (
                                        <div key={commit.hash} className="flex items-center gap-1.5 text-[9px] text-blue-600/80 font-mono bg-blue-500/5 px-1.5 py-0.5 rounded border border-blue-500/10 max-w-full overflow-hidden" title={commit.message}>
                                            <GitCommit className="w-2.5 h-2.5 shrink-0" />
                                            <span className="truncate">{commit.message}</span>
                                            <code className="text-[8px] opacity-40 shrink-0">{commit.hash.substring(0, 7)}</code>
                                        </div>
                                    ))}
                                    {data.gitCommits.length > 2 && (
                                        <span className="text-[9px] text-muted-foreground/40 self-center">{t("session.board.moreItems", { count: data.gitCommits.length - 2 })}</span>
                                    )}
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </div>

            <div
                className={clsx(
                    "session-lane-scroll flex-1 relative",
                    zoomLevel === 0 ? "px-0.5 py-2" : "px-1 py-4"
                )}
            >
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const item = visibleItems[virtualRow.index];
                        if (!item) return null;
                        const message = item.head;
                        const isDynamic = zoomLevel !== 0;
                        const nextItem = visibleItems[virtualRow.index + 1];
                        const prevItem = visibleItems[virtualRow.index - 1];

                        const role = getMessageRole(message);
                        const prevRole = prevItem ? getMessageRole(prevItem.head) : null;

                        // Spacing Logic: Tighter if same role, wider if turn switch
                        const marginTop = (prevRole && prevRole !== role && zoomLevel !== 0) ? 12 : 2;

                        // Indentation Logic: Assistant cards slightly indented to right in Skim/Detail views
                        // User cards stay left
                        const isAssistant = role === 'assistant';


                        let paddingLeft = '0px';
                        let paddingRight = '0px';

                        if (zoomLevel !== 0) {
                            if (isAssistant) {
                                paddingLeft = '24px';
                                paddingRight = '4px';
                            } else {
                                paddingLeft = '4px';
                                paddingRight = '24px';
                            }
                        }

                        return (
                            <div
                                key={message.uuid}
                                data-index={virtualRow.index}
                                ref={isDynamic ? rowVirtualizer.measureElement : undefined}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    // Let height be auto for dynamic measurement BUT we need minimums
                                    // Actually virtualizer handles height via ref measurement
                                    transform: `translateY(${virtualRow.start}px)`,
                                    paddingTop: `${marginTop}px`,
                                    paddingLeft,
                                    paddingRight
                                }}
                            >
                                <InteractionCard
                                    message={message}
                                    zoomLevel={zoomLevel}
                                    isExpanded={selectedMessageId === message.uuid}
                                    activeBrush={activeBrush}
                                    gitCommits={data.gitCommits}
                                    onToggleSticky={onToggleSticky}
                                    onClick={() => onInteractionClick?.(message.uuid)}
                                    onNext={nextItem ? () => onInteractionClick?.(nextItem.head.uuid) : undefined}
                                    onPrev={prevItem ? () => onInteractionClick?.(prevItem.head.uuid) : undefined}
                                    onFileClick={onFileClick}
                                    onNavigate={() => onNavigate?.(message.uuid)}
                                    siblings={item.siblings}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div >
    );
};
