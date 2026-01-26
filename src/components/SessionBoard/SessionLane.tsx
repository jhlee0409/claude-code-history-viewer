import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../store/useAppStore";
import type { BoardSessionData, ZoomLevel } from "../../types/board.types";
import { InteractionCard } from "./InteractionCard";
import { Coins, AlertCircle, Clock, Zap, Crown, Anchor, Hash, GitCommit, Pencil } from "lucide-react";
import { clsx } from "clsx";
import { extractClaudeMessageContent } from "../../utils/messageUtils";

interface SessionLaneProps {
    data: BoardSessionData;
    zoomLevel: ZoomLevel;
    activeBrush: { type: string; value: string } | null;
    onInteractionClick?: (messageUuid: string) => void;
    onHoverInteraction?: (type: "role" | "status" | "tool" | "file", value: string) => void;
    onLeaveInteraction?: () => void;
    onScroll?: (scrollTop: number) => void;
}

export const SessionLane = ({
    data,
    zoomLevel,
    activeBrush,
    onInteractionClick,
    onHoverInteraction,
    onLeaveInteraction,
    onScroll
}: SessionLaneProps) => {
    const parentRef = useRef<HTMLDivElement>(null);
    const { session, messages, stats, depth } = data;
    const selectedMessageId = useAppStore(state => state.selectedMessageId);

    // Filter out "no-content" messages before virtualization
    const visibleMessages = messages.filter(msg => {
        const content = extractClaudeMessageContent(msg) || "";
        const isTool = !!msg.toolUse;
        return content.trim().length > 0 || isTool;
    });

    const rowVirtualizer = useVirtualizer({
        count: visibleMessages.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => {
            const msg = visibleMessages[index];
            const content = extractClaudeMessageContent(msg) || "";
            const isTool = !!msg.toolUse;
            // Rough content length heuristic
            const len = content.length;

            // 0: Pixel View (Fixed small)
            // Removed generic vertical padding, so each pixel row is tight
            if (zoomLevel === 0) return 4;

            // 1: Skim View (Compact)
            if (zoomLevel === 1) {
                if (isTool) return 80;
                if (len < 100) return 60; // Tiny content -> smaller height
                return 90;
            }

            // 2: Read View (Detail)
            // Base overhead: ~40px (header+footer)
            // Line height: ~20px
            // Characters per line: ~50 (very rough avg)
            if (isTool) return 140; // Tools have generous space
            if (len < 50) return 70; // Extremely short (e.g. "Ok.", "Request cancelled")
            if (len < 200) return 120; // Short paragraph
            if (len < 500) return 180; // Medium
            return 250; // Long (clamped max)
        },
        overscan: 10,
    });

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (onScroll) {
            onScroll(e.currentTarget.scrollTop);
        }
    };

    const isInteractionActive = (msg: any) => {
        // Highlighting disabled globally for now, always return true
        return true;
    };

    // Determine styles for different session depths
    const getDepthStyles = () => {
        // Pixel View always uses compact width
        if (zoomLevel === 0) {
            return "w-[80px] min-w-[80px] bg-background border-r border-border/30";
        }

        switch (depth) {
            case 'epic':
                return "w-[480px] min-w-[480px] bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200/50 dark:border-indigo-800/50";
            case 'deep':
                return "w-[380px] min-w-[380px] bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/50 dark:border-slate-800/50";
            default: // shallow
                return "w-[320px] min-w-[320px] bg-card/20";
        }
    };

    return (
        <div className={clsx(
            "flex flex-col h-full border-r transition-all relative group",
            getDepthStyles()
        )}>
            {/* Vertical Connector Line (Only for non-Pixel views) */}
            {zoomLevel !== 0 && (
                <div className="absolute left-6 top-0 bottom-0 w-px bg-border/40 z-0 pointer-events-none" />
            )}

            {/* Column Header */}
            <div className={clsx(
                "border-b border-border/50 shrink-0 z-10 backdrop-blur-sm sticky top-0",
                zoomLevel === 0 ? "p-2 bg-background/90" : "p-4",
                (zoomLevel !== 0 && depth === 'epic') ? "bg-indigo-50/80 dark:bg-indigo-950/40" : (zoomLevel !== 0 ? "bg-card/40" : "")
            )}
                style={{
                    height: zoomLevel === 0 ? '110px' : '150px' // Enforce consistent height
                }}
            >
                {/* Pixel View Header */}
                {zoomLevel === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 text-center h-full justify-between">
                        {/* Mini badge for depth */}
                        {depth === 'epic' && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse mb-1" title="Epic Session" />}
                        {depth === 'deep' && <div className="w-2 h-2 rounded-full bg-slate-500 mb-1" title="Deep Session" />}

                        <div className="text-[10px] font-bold text-muted-foreground rotate-0 truncate max-w-full leading-tight" title={session.summary || session.session_id}>
                            {/* Just show truncated ID or short date */}
                            {new Date(session.last_modified).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                        </div>

                        {/* Vertical Sparkline - using simple stacking bars for stats visually in a tiny column */}
                        <div className="flex flex-col gap-1 w-full items-center mt-auto">
                            {/* Commits Metric */}
                            {stats.commitCount > 0 && (
                                <div className="flex flex-col items-center gap-0.5" title={`${stats.commitCount} Commits`}>
                                    <div className="w-3 h-0.5 bg-indigo-500"></div>
                                    <span className="text-[8px] font-mono text-indigo-500 font-bold">{stats.commitCount}</span>
                                </div>
                            )}

                            {/* Edits Metric */}
                            {stats.fileEditCount > 0 && (
                                <div className="flex flex-col items-center gap-0.5" title={`${stats.fileEditCount} File Edits`}>
                                    <div className="w-3 h-0.5 bg-emerald-500"></div>
                                    <span className="text-[8px] font-mono text-emerald-500">{stats.fileEditCount}</span>
                                </div>
                            )}

                            <div className="flex flex-col items-center gap-0.5" title={`${Math.round(stats.totalTokens / 1000)}k Tokens`}>
                                <div className="w-full h-px bg-foreground/10" />
                                <span className="text-[8px] font-mono text-muted-foreground">{Math.round(stats.totalTokens / 1000)}k</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Normal Header */
                    <div className="flex flex-col h-full">
                        <h3 className="text-sm font-bold truncate mb-2 text-foreground" title={session.summary || session.session_id}>
                            {session.summary || "Untitled Session"}
                        </h3>

                        <div className="flex items-center gap-2 mb-3">
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground opacity-70">
                                <Clock className="w-3 h-3" />
                                <span>{new Date(session.last_modified).toLocaleDateString()}</span>
                            </div>

                            {/* Moved badges to be inline with metadata row to save space */}
                            {depth === 'epic' && <span className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 ml-auto shrink-0"><Crown className="w-3 h-3" /> EPIC</span>}
                            {depth === 'deep' && <span className="bg-slate-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 ml-auto shrink-0"><Anchor className="w-3 h-3" /> DEEP</span>}
                        </div>

                        <div className="mt-auto grid grid-cols-2 gap-2">
                            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-accent/5 rounded border border-accent/10">
                                <Coins className="w-3.5 h-3.5 text-accent" />
                                <span className="text-[11px] font-mono font-bold leading-none">{stats.totalTokens.toLocaleString()}</span>
                            </div>
                            <div className={clsx(
                                "flex items-center gap-1.5 px-2 py-1.5 rounded border",
                                stats.errorCount > 0 ? "bg-destructive/5 border-destructive/20 text-destructive" : "bg-muted/5 border-border/50 text-muted-foreground"
                            )}>
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span className="text-[11px] font-mono font-bold leading-none">{stats.errorCount}</span>
                            </div>
                        </div>

                        {/* Derived Metrics Row for Zoom 1/2 */}
                        {(stats.commitCount > 0 || stats.fileEditCount > 0) && (
                            <div className="flex items-center gap-3 mt-2 text-[10px] opacity-80 pl-1">
                                {stats.commitCount > 0 && (
                                    <div className="flex items-center gap-1 text-indigo-500 font-medium">
                                        <GitCommit className="w-3 h-3" />
                                        <span>{stats.commitCount}</span>
                                    </div>
                                )}
                                {stats.fileEditCount > 0 && (
                                    <div className="flex items-center gap-1 text-emerald-600 font-medium">
                                        <Pencil className="w-3 h-3" />
                                        <span>{stats.fileEditCount} ({stats.filesTouchedCount} files)</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Interactions Virtual List */}
            <div
                ref={parentRef}
                onScroll={handleScroll}
                className={clsx(
                    "session-lane-scroll flex-1 overflow-y-auto scrollbar-thin overflow-x-hidden relative",
                    zoomLevel === 0 ? "px-0.5 py-2" : "px-1 py-4"
                )}
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const message = visibleMessages[virtualRow.index];
                        const nextMessage = visibleMessages[virtualRow.index + 1];
                        const prevMessage = visibleMessages[virtualRow.index - 1];

                        if (!message) return null;

                        return (
                            <div
                                key={message.uuid}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                    // Padding adjusted to account for the connector line on the left
                                    paddingLeft: zoomLevel === 0 ? '0' : '32px',
                                    paddingRight: zoomLevel === 0 ? '0' : '8px',
                                }}
                            >
                                <InteractionCard
                                    message={message}
                                    zoomLevel={zoomLevel}
                                    isActive={true}
                                    isExpanded={selectedMessageId === message.uuid}
                                    onHover={onHoverInteraction}
                                    onLeave={onLeaveInteraction}
                                    onClick={() => onInteractionClick?.(message.uuid)}
                                    onNext={nextMessage ? () => onInteractionClick?.(nextMessage.uuid) : undefined}
                                    onPrev={prevMessage ? () => onInteractionClick?.(prevMessage.uuid) : undefined}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
