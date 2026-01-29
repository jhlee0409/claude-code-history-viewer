import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../store/useAppStore";
import { SessionLane } from "./SessionLane";
import { BoardControls } from "./BoardControls";
import { LoadingSpinner } from "../ui/loading";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { clsx } from "clsx";

import { getToolUseBlock } from "../../utils/messageUtils";
import { getToolVariant } from "@/utils/toolIconUtils";
import { buildSearchIndex, clearSearchIndex } from "../../utils/searchIndex";

export const SessionBoard = () => {
    const {
        boardSessions,
        allSortedSessionIds,
        isLoadingBoard,
        zoomLevel,
        activeBrush,
        setActiveBrush,
        stickyBrush,
        setStickyBrush,
        setZoomLevel,
        setSelectedMessageId,
        selectedMessageId,
        dateFilter,
        setDateFilter,
        selectedSession
    } = useAppStore();

    // Clear brush on Escape (Step 9)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setActiveBrush(null);
                setStickyBrush(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setActiveBrush, setStickyBrush]);

    // Compute visible session IDs reactively based on date filter
    // Compute visible session IDs reactively based on date filter
    const visibleSessionIds = useMemo(() => {
        if (!dateFilter?.start && !dateFilter?.end) {
            return allSortedSessionIds;
        }

        const startMs = dateFilter.start ? dateFilter.start.getTime() : 0;
        const endMs = dateFilter.end ? dateFilter.end.getTime() + (24 * 60 * 60 * 1000) : Infinity; // Add 24h to include end date fully


        const filtered = allSortedSessionIds.filter(id => {
            const session = boardSessions[id];
            if (!session) return false;
            // Use last_message_time if available, otherwise fallback to last_modified
            const timeStr = session.session.last_message_time || session.session.last_modified;
            const sessionDate = new Date(timeStr).getTime();
            return sessionDate >= startMs && sessionDate < endMs;
        });

        // Deduplicate IDs to prevent React key collisions and visual glitches
        const uniqueFiltered = Array.from(new Set(filtered));

        return uniqueFiltered;
    }, [allSortedSessionIds, boardSessions, dateFilter]);

    // Compute brushing options for visible sessions (Step 8)
    // Helper to extract brush options from a list of session IDs
    const getBrushOptions = useCallback((sessionIds: string[]) => {
        const models = new Set<string>();
        const tools = new Set<string>();
        const files = new Set<string>();
        const statuses = new Set<string>(['error', 'cancelled']);

        sessionIds.forEach(id => {
            const data = boardSessions[id];
            if (!data) return;

            data.messages.forEach(msg => {
                if (msg.type === 'assistant' && msg.model) {
                    models.add(msg.model);
                }

                const toolBlock = getToolUseBlock(msg);
                if (toolBlock) {
                    const variant = getToolVariant(toolBlock.name);
                    if (variant === 'terminal') {
                        // Check for git in shell commands
                        const cmd = toolBlock.input?.CommandLine || toolBlock.input?.command;
                        if (typeof cmd === 'string' && cmd.trim().startsWith('git')) {
                            tools.add('git');
                        }
                    }
                    tools.add(variant);
                    const path = toolBlock.input?.path || toolBlock.input?.file_path || toolBlock.input?.TargetFile;
                    if (path && typeof path === 'string') {
                        files.add(path);
                    }
                }
            });
        });

        return {
            models: Array.from(models).sort(),
            tools: Array.from(tools).sort(),
            files: Array.from(files).sort(),
            statuses: Array.from(statuses).sort()
        };
    }, [boardSessions]);

    const visibleBrushOptions = useMemo(() => getBrushOptions(visibleSessionIds), [getBrushOptions, visibleSessionIds]);
    const allBrushOptions = useMemo(() => getBrushOptions(allSortedSessionIds), [getBrushOptions, allSortedSessionIds]);

    const { t } = useTranslation();
    const parentRef = useRef<HTMLDivElement>(null);
    const scrollSyncRef = useRef<{ isSyncing: boolean; lastTop: number }>({ isSyncing: false, lastTop: 0 });

    // Panning State
    const [isMetaPressed, setIsMetaPressed] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

    // Track Meta/Command key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Meta' || e.key === 'Control') setIsMetaPressed(true);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Meta' || e.key === 'Control') {
                setIsMetaPressed(false);
                setIsDragging(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!isMetaPressed || !parentRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - parentRef.current.offsetLeft);
        setScrollLeft(parentRef.current.scrollLeft);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !parentRef.current) return;
        e.preventDefault();

        // Horizontal Pan
        const x = e.pageX - parentRef.current.offsetLeft;
        const walkX = (x - startX) * 2;
        parentRef.current.scrollLeft = scrollLeft - walkX;

        // Vertical Pan (Sync across all lanes)
        const lanes = document.querySelectorAll('.session-lane-scroll');
        lanes.forEach(lane => {
            lane.scrollTop = lane.scrollTop - (e.movementY * 1.5);
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Scroll Synchronization Logic
    const handleLaneScroll = useCallback((scrollTop: number) => {
        if (scrollSyncRef.current.isSyncing) return;

        scrollSyncRef.current.isSyncing = true;
        scrollSyncRef.current.lastTop = scrollTop;

        const lanes = document.querySelectorAll('.session-lane-scroll');
        lanes.forEach(lane => {
            if (lane.scrollTop !== scrollTop) {
                lane.scrollTop = scrollTop;
            }
        });

        // Reset sync flag after a short delay or in next tick
        requestAnimationFrame(() => {
            scrollSyncRef.current.isSyncing = false;
        });
    }, []);

    const handleBoardHover = useCallback((type: "model" | "status" | "tool" | "file", value: string) => {
        setActiveBrush({ type, value });
    }, [setActiveBrush]);

    const handleBoardLeave = useCallback(() => {
        if (!stickyBrush) {
            setActiveBrush(null);
        }
    }, [stickyBrush, setActiveBrush]);

    const handleToggleSticky = useCallback(() => {
        setStickyBrush(!stickyBrush);
    }, [stickyBrush, setStickyBrush]);

    // Force re-measure when zoom level changes or list changes
    useEffect(() => {
        if (visibleSessionIds.length > 0) {
            columnVirtualizer.measure();
        }
    }, [zoomLevel, visibleSessionIds]);

    const columnVirtualizer = useVirtualizer({
        count: visibleSessionIds.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => {
            // Pixel View (0) -> Ultra condensed columns
            if (zoomLevel === 0) return 80;

            const sessionId = visibleSessionIds[index];
            if (!sessionId) return 320;
            const data = boardSessions[sessionId];

            // "Deep" sessions get wider columns
            if (data?.depth === 'deep') return 380;
            return 320;
        },
        horizontal: true,
        overscan: 5, // Increased overscan for smooth scrolling in dense view
    });

    // Scroll active session into view when transitioning from Detail view
    useEffect(() => {
        if (selectedSession && visibleSessionIds.length > 0) {
            const index = visibleSessionIds.indexOf(selectedSession.session_id);
            if (index !== -1) {
                // Small timeout to ensure virtualizer is ready and layout is stable
                requestAnimationFrame(() => {
                    columnVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
                });
            }
        }
    }, [selectedSession?.session_id]); // Only run when the ID changes (or on mount if set)

    if (isLoadingBoard) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-sm text-muted-foreground animate-pulse">
                    {t("common.loading")}
                </p>
            </div>
        );
    }

    if (visibleSessionIds.length === 0) {
        return (
            <div className="h-full flex flex-col overflow-hidden bg-background">
                <BoardControls
                    zoomLevel={zoomLevel}
                    onZoomChange={setZoomLevel}
                    activeBrush={activeBrush}
                    onBrushChange={setActiveBrush}
                    dateFilter={dateFilter}
                    setDateFilter={setDateFilter}
                />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center max-w-sm mx-auto">
                        <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-6">
                            <MessageSquare className="w-10 h-10 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-lg font-medium text-foreground mb-2">
                            No sessions found
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Try adjusting your date filters or select more sessions.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* Board Toolbar */}
            <BoardControls
                zoomLevel={zoomLevel}
                onZoomChange={setZoomLevel}
                activeBrush={activeBrush}
                stickyBrush={stickyBrush}
                onBrushChange={setActiveBrush}
                modelOptions={allBrushOptions.models}
                statusOptions={allBrushOptions.statuses}
                toolOptions={allBrushOptions.tools}
                fileOptions={allBrushOptions.files}
                availableModels={visibleBrushOptions.models}
                availableTools={visibleBrushOptions.tools}
                availableFiles={visibleBrushOptions.files}
                availableStatuses={visibleBrushOptions.statuses}
                dateFilter={dateFilter}
                setDateFilter={setDateFilter}
            />

            {/* Virtualized Lanes Container */}
            <div
                ref={parentRef}
                className={clsx(
                    "flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin select-none",
                    isMetaPressed ? "cursor-grab" : "cursor-default",
                    isDragging && "cursor-grabbing"
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <div
                    style={{
                        width: `${columnVirtualizer.getTotalSize()}px`,
                        height: '100%',
                        position: 'relative',
                    }}
                >
                    {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
                        const sessionId = visibleSessionIds[virtualColumn.index];
                        if (!sessionId) return null;

                        const data = boardSessions[sessionId];
                        if (!data) return null;

                        return (
                            <div
                                key={sessionId}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    height: '100%',
                                    width: `${virtualColumn.size}px`,
                                    transform: `translateX(${virtualColumn.start}px)`,
                                }}
                            >
                                <SessionLane
                                    data={data}
                                    zoomLevel={zoomLevel}
                                    activeBrush={activeBrush}
                                    onHover={handleBoardHover}
                                    onLeave={handleBoardLeave}
                                    onToggleSticky={handleToggleSticky}
                                    isSelected={selectedSession?.session_id === sessionId}
                                    onInteractionClick={(id) => {
                                        if (selectedMessageId === id) {
                                            setSelectedMessageId(null);
                                        } else {
                                            setSelectedMessageId(id);
                                        }
                                    }}
                                    onNavigate={(messageId) => {
                                        // 1. Ensure this session is selected
                                        if (selectedSession?.session_id !== sessionId) {
                                            // Optimistic update using cached board data to prevent loading state
                                            useAppStore.setState({
                                                selectedSession: data.session,
                                                messages: data.messages,
                                                isLoadingMessages: false,
                                                pagination: {
                                                    currentOffset: data.messages.length,
                                                    pageSize: data.messages.length,
                                                    totalCount: data.messages.length,
                                                    hasMore: false,
                                                    isLoadingMore: false,
                                                }
                                            });

                                            // Rebuild search index for the new session
                                            clearSearchIndex();
                                            buildSearchIndex(data.messages);
                                        }
                                        // 2. Navigate
                                        useAppStore.getState().navigateToMessage(messageId);
                                        useAppStore.getState().setAnalyticsCurrentView("messages");
                                    }}
                                    onScroll={handleLaneScroll}
                                    onFileClick={(file) => {
                                        // Deep link to recent edits
                                        useAppStore.getState().setAnalyticsRecentEditsSearchQuery(file);
                                        useAppStore.getState().setAnalyticsCurrentView("recentEdits");
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Hint for panning */}
            {isMetaPressed && !isDragging && (
                <div className="fixed bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 bg-accent text-white rounded-full text-xs font-bold shadow-2xl animate-bounce z-[100]">
                    Drag to pan horizontally and vertically
                </div>
            )}
        </div>
    );
};
