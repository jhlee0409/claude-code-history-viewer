import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../store/useAppStore";
import type { BoardSessionData, ZoomLevel } from "../../types/board.types";
import { InteractionCard } from "./InteractionCard";
import { Terminal, FilePlus, FileText, Book, TrendingUp, Zap, Pencil, GitCommit, Search, Globe, Plug } from "lucide-react";
import { clsx } from "clsx";
import { extractClaudeMessageContent } from "../../utils/messageUtils";

// Helper to check if a message is a tool use or system tool event
const isToolEvent = (msg: any) => {
    if (msg.toolUse) return true;
    if (Array.isArray(msg.content) && msg.content.some((b: any) => b.type === 'tool_use')) return true;
    // Also include tool results if separated
    if (msg.toolUseResult) return true;
    return false;
};

// Helper for formatting duration
const formatDuration = (minutes: number): string => {
    if (minutes < 1) return "<1m";
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

// Helper for formatting large numbers
const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
};

interface SessionLaneProps {
    data: BoardSessionData;
    zoomLevel: ZoomLevel;
    activeBrush?: { type: string; value: string } | null;
    onInteractionClick?: (messageUuid: string) => void;
    onHoverInteraction?: (type: "role" | "status" | "tool" | "file", value: string) => void;
    onLeaveInteraction?: () => void;
    onScroll?: (scrollTop: number) => void;
    onFileClick?: (file: string) => void;
    isSelected?: boolean;
    onNavigate?: (messageId: string) => void;
}

export const SessionLane = ({
    data,
    zoomLevel,
    onInteractionClick,
    onHoverInteraction,
    onLeaveInteraction,
    onScroll,
    onFileClick,
    isSelected,
    onNavigate
}: SessionLaneProps) => {
    const parentRef = useRef<HTMLDivElement>(null);
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
        const grouped: { head: any, siblings: any[] }[] = [];
        let currentGroup: { head: any, siblings: any[] } | null = null;

        filtered.forEach((msg) => {
            // Helper to get role safely from union
            const role = (msg as any).role || msg.type;
            const isTool = isToolEvent(msg);

            if (currentGroup) {
                const headRole = (currentGroup.head as any).role || currentGroup.head.type;
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

    const rowVirtualizer = useVirtualizer({
        count: visibleItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => {
            const item = visibleItems[index];
            if (!item) return 80;
            const msg = item.head;
            if (!msg) return 80;

            if (zoomLevel === 0) {
                // Approximate total tokens for group?
                // For heatmap, we disabled grouping above, so siblings is empty
                let totalTokens = 0;
                if (msg.type === 'assistant' && msg.usage) {
                    totalTokens = (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0);
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

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (onScroll) {
            onScroll(e.currentTarget.scrollTop);
        }
    };

    const getLaneBackground = () => {
        // Detect Model from first assistant message with a model field
        const modelMsg = messages.find(m => (m as any).role === 'assistant' && (m as any).model);
        const model = (modelMsg as any)?.model || "";

        if (model.includes("opus")) {
            // Opus: Visible Blue
            return "bg-sky-100/30 dark:bg-sky-900/20";
        }
        if (model.includes("sonnet")) {
            // Sonnet: Very Faint Blue
            return "bg-sky-50/30 dark:bg-sky-900/10";
        }
        if (model.includes("haiku")) {
            // Haiku: Almost Invisible / Standard
            return "bg-slate-50/30 dark:bg-slate-900/5"; // Standard/Default
        }

        // Default (if Unknown)
        return "bg-card/20";
    };

    const getDepthStyles = () => {
        if (zoomLevel === 0) {
            return clsx(
                "w-[80px] min-w-[80px] border-r border-border/30",
                getLaneBackground(),
                isSelected && "bg-accent/5 ring-1 ring-inset ring-accent/40"
            );
        }

        const baseBg = getLaneBackground();

        switch (depth) {
            case 'deep':
                return clsx(
                    "w-[380px] min-w-[380px] border-slate-200/50 dark:border-slate-800/50",
                    baseBg,
                    isSelected && "ring-2 ring-inset ring-accent/50 bg-accent/5 shadow-xl shadow-accent/5"
                );
            default:
                return clsx(
                    "w-[320px] min-w-[320px]",
                    baseBg,
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
                zoomLevel === 0 ? "h-[110px] bg-background/90" : "min-h-[165px]",
                zoomLevel !== 0 ? "bg-card/40" : ""
            )}>
                {zoomLevel === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 text-center h-full justify-between">
                        <div className="flex gap-1">
                            {stats?.commitCount > 0 && <span title="Git Commits"><GitCommit className="w-2.5 h-2.5 text-indigo-500" /></span>}
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
                            <span className="text-[10px] font-mono text-muted-foreground/70">
                                {new Date(session.last_modified).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}  •  {new Date(session.last_modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                            <div className="flex gap-3 items-center">
                                {/* Activity Summary Row 1: Tokens & Git & Edits */}

                                {stats.commitCount > 0 && (
                                    <div className="flex items-center gap-1 text-indigo-500" title="Git Commits">
                                        <GitCommit className="w-3 h-3" />
                                        <span className="text-[10px] font-bold">{stats.commitCount}</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-1 text-emerald-500" title="Input Tokens">
                                    <TrendingUp className="w-3 h-3" />
                                    <span className="text-[10px] font-mono">{formatNumber(stats.inputTokens || 0)}</span>
                                </div>

                                <div className="flex items-center gap-1 text-purple-500" title="Output Tokens">
                                    <Zap className="w-3 h-3" />
                                    <span className="text-[10px] font-mono">{formatNumber(stats.outputTokens || 0)}</span>
                                </div>

                                {stats.shellCount > 0 && (
                                    <div className="flex items-center gap-1 text-sky-500" title="Shell Commands">
                                        <Terminal className="w-3 h-3" />
                                        <span className="text-[10px] font-mono">{stats.shellCount}</span>
                                    </div>
                                )}



                                {(() => {
                                    const createdCount = data.fileEdits.filter(e => e.type === 'create').length;
                                    if (createdCount > 0) return (
                                        <div className="flex items-center gap-1 text-emerald-500" title="Files Created">
                                            <FilePlus className="w-3 h-3" />
                                            <span className="text-[10px] font-mono">{createdCount}</span>
                                        </div>
                                    );
                                    return null;
                                })()}
                            </div>
                        </div>

                        <div className="flex items-baseline gap-2 pb-1 border-b border-border/20">
                            <div className="text-xl font-bold font-mono text-foreground">
                                {formatNumber(stats.totalTokens)}
                                <span className="text-[10px] text-muted-foreground font-normal ml-1">tokens</span>
                            </div>
                            <div className="ml-auto text-[10px] text-muted-foreground flex gap-2">
                                <span>{messages.length} msgs</span>
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
                                    <div className="flex items-center gap-1 text-sky-500" title="Shell Commands">
                                        <Terminal className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.shellCount}</span>
                                    </div>
                                )}

                                {/* 2. Files Created */}
                                {(() => {
                                    const createdCount = data.fileEdits.filter(e => e.type === 'create').length;
                                    if (createdCount > 0) return (
                                        <div className="flex items-center gap-1 text-emerald-500" title="Files Created">
                                            <FilePlus className="w-3 h-3" />
                                            <span className="text-[10px] font-bold font-mono">{createdCount}</span>
                                        </div>
                                    );
                                    return null;
                                })()}

                                {/* 3. File Search (Grep/Glob) */}
                                {stats.searchCount > 0 && (
                                    <div className="flex items-center gap-1 text-amber-500" title="Code Search">
                                        <Search className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.searchCount}</span>
                                    </div>
                                )}

                                {/* Web Search/Fetch */}
                                {stats.webCount > 0 && (
                                    <div className="flex items-center gap-1 text-sky-400" title="Web Search/Fetch">
                                        <Globe className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.webCount}</span>
                                    </div>
                                )}

                                {/* MCP Tools */}
                                {stats.mcpCount > 0 && (
                                    <div className="flex items-center gap-1 text-purple-500" title="MCP Tools">
                                        <Plug className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.mcpCount}</span>
                                    </div>
                                )}

                                {/* 4. Docs (Markdown) */}
                                {stats.hasMarkdownEdits && (
                                    <div className="flex items-center gap-1 text-amber-500" title="Documentation Updates">
                                        <Book className="w-3 h-3" />
                                    </div>
                                )}

                                {/* 5. Code Edits */}
                                {stats.fileEditCount > 0 && (
                                    <div className="flex items-center gap-1 text-foreground/70" title="Files Touched">
                                        <FileText className="w-3 h-3" />
                                        <span className="text-[10px] font-bold font-mono">{stats.fileEditCount}</span>
                                    </div>
                                )}
                            </div>

                            {/* Actual Git History (Ground Truth) */}
                            {data.gitCommits && data.gitCommits.length > 0 && (
                                <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 pt-1 border-t border-border/10">
                                    <div className="text-[8px] uppercase font-bold text-blue-500/70 tracking-tighter w-full">Git Commits</div>
                                    {data.gitCommits.slice(0, 2).map(commit => (
                                        <div key={commit.hash} className="flex items-center gap-1.5 text-[9px] text-blue-600/80 font-mono bg-blue-500/5 px-1.5 py-0.5 rounded border border-blue-500/10 max-w-full overflow-hidden" title={commit.message}>
                                            <GitCommit className="w-2.5 h-2.5 shrink-0" />
                                            <span className="truncate">{commit.message}</span>
                                            <code className="text-[8px] opacity-40 shrink-0">{commit.hash.substring(0, 7)}</code>
                                        </div>
                                    ))}
                                    {data.gitCommits.length > 2 && (
                                        <span className="text-[9px] text-muted-foreground/40 self-center">+{data.gitCommits.length - 2} more</span>
                                    )}
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </div>

            <div
                ref={parentRef}
                onScroll={handleScroll}
                className={clsx(
                    "session-lane-scroll flex-1 overflow-y-auto scrollbar-thin relative",
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

                        const role = (message as any).role || message.type;
                        const prevRole = prevItem ? ((prevItem.head as any).role || prevItem.head.type) : null;

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
                                    gitCommits={data.gitCommits}
                                    onHover={onHoverInteraction}
                                    onLeave={onLeaveInteraction}
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
