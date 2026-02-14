import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../store/useAppStore";
import { SessionLane } from "./SessionLane";
import { BoardControls } from "./BoardControls";
import { SessionActivityTimeline } from "./SessionActivityTimeline";
import { LoadingSpinner } from "../ui/loading";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { clsx } from "clsx";
import type { ActiveBrush } from "../../types/board.types";

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
        clearDateFilter,
        isTimelineExpanded,
        toggleTimeline,
        selectedSession,
        selectedProject,
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
        const tools = new Set<string>();
        const files = new Set<string>();
        const mcpServers = new Set<string>();
        const commandFrecency = new Map<string, { count: number; lastTimestamp: number }>();
        
        const now = Date.now();

        sessionIds.forEach(id => {
            const data = boardSessions[id];
            if (!data) return;

            data.messages.forEach(msg => {
                const msgTimestamp = new Date(msg.timestamp).getTime();
                
                // Check for hooks in system messages
                if (msg.type === 'system' && msg.hookCount && msg.hookCount > 0) {
                    // Track individual commands from hookInfos with frecency
                    if (msg.hookInfos && msg.hookInfos.length > 0) {
                        msg.hookInfos.forEach(info => {
                            if (info.command) {
                                const existing = commandFrecency.get(info.command) || { count: 0, lastTimestamp: 0 };
                                commandFrecency.set(info.command, {
                                    count: existing.count + 1,
                                    lastTimestamp: Math.max(existing.lastTimestamp, msgTimestamp)
                                });
                            }
                        });
                    }
                }

                const toolBlock = getToolUseBlock(msg);
                if (toolBlock) {
                    const variant = getToolVariant(toolBlock.name);
                    
                    // Track MCP server names for tools that are MCP
                    if (variant === 'mcp' && msg.type === 'user') {
                        // Find the mcp_tool_use content
                        const content = msg.content;
                        if (Array.isArray(content)) {
                            content.forEach(c => {
                                if (c.type === 'mcp_tool_use' && (c as { server_name?: string }).server_name) {
                                    mcpServers.add((c as { server_name: string }).server_name);
                                }
                            });
                        }
                    }
                    
                    if (variant === 'terminal') {
                        // Check for git in shell commands
                        const cmd = toolBlock.input?.CommandLine || toolBlock.input?.command;
                        if (typeof cmd === 'string') {
                            // Track terminal commands with frecency
                            const existing = commandFrecency.get(cmd) || { count: 0, lastTimestamp: 0 };
                            commandFrecency.set(cmd, {
                                count: existing.count + 1,
                                lastTimestamp: Math.max(existing.lastTimestamp, msgTimestamp)
                            });
                            
                            if (cmd.trim().startsWith('git')) {
                                tools.add('git');
                            }
                        }
                    }
                    // Only add meaningful tool variants (exclude neutral/generic fallback)
                    if (variant !== 'neutral' && variant !== 'info') {
                        tools.add(variant);
                    }
                    const path = toolBlock.input?.path || toolBlock.input?.file_path || toolBlock.input?.TargetFile;
                    if (path && typeof path === 'string') {
                        files.add(path);
                    }
                }
            });
        });

        // Calculate frecency scores and get top 10 commands
        const commandsWithFrecency = Array.from(commandFrecency.entries()).map(([cmd, data]) => {
            const ageInDays = (now - data.lastTimestamp) / (1000 * 60 * 60 * 24);
            const recencyWeight = 1 / (1 + ageInDays); // Decay function
            const frecencyScore = data.count * recencyWeight;
            return { cmd, score: frecencyScore };
        });
        
        const topCommands = commandsWithFrecency
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(item => item.cmd);

        return {
            tools: Array.from(tools).sort(),
            files: Array.from(files).sort(),
            mcpServers: Array.from(mcpServers).sort(),
            shellCommands: topCommands
        };
    }, [boardSessions]);

    const visibleBrushOptions = useMemo(() => getBrushOptions(visibleSessionIds), [getBrushOptions, visibleSessionIds]);
    const allBrushOptions = useMemo(() => getBrushOptions(allSortedSessionIds), [getBrushOptions, allSortedSessionIds]);

    const { t } = useTranslation();
    const parentRef = useRef<HTMLDivElement>(null);
    // Removed scrollSyncRef as we now use a shared scroll container

    // Ref for visibleSessionIds to avoid useEffect dependency issues
    const visibleSessionIdsRef = useRef(visibleSessionIds);
    useEffect(() => {
        visibleSessionIdsRef.current = visibleSessionIds;
    }, [visibleSessionIds]);

    // Panning State
    const [isMetaPressed, setIsMetaPressed] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

    // Cache for lane elements


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

        // Vertical Pan (Sync across all lanes) - use live HTMLCollection
        const lanes = parentRef.current.getElementsByClassName('session-lane-scroll');
        for (let i = 0; i < lanes.length; i++) {
            const lane = lanes[i] as HTMLElement;
            lane.scrollTop = lane.scrollTop - (e.movementY * 1.5);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Track heights of visible lanes to determine container height
    const [laneHeights, setLaneHeights] = useState<Record<string, number>>({});

    const handleLaneHeightChange = useCallback((sessionId: string, height: number) => {
        setLaneHeights(prev => {
            if (prev[sessionId] === height) return prev;
            return { ...prev, [sessionId]: height };
        });
    }, []);

    const maxContentHeight = useMemo(() => {
        const h = Math.max(0, ...Object.values(laneHeights));
        // Add some padding for the bottom
        return h + 40;
    }, [laneHeights]);

    const handleBoardHover = useCallback((type: ActiveBrush["type"], value: string) => {
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

    const selectedMessageIdRef = useRef(selectedMessageId);
    selectedMessageIdRef.current = selectedMessageId;

    const handleInteractionClick = useCallback((id: string) => {
        setSelectedMessageId(selectedMessageIdRef.current === id ? null : id);
    }, [setSelectedMessageId]);

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

    // Force re-measure when zoom level changes or list changes
    useEffect(() => {
        if (visibleSessionIds.length > 0) {
            columnVirtualizer.measure();
        }
    }, [zoomLevel, visibleSessionIds, columnVirtualizer]);



    // Scroll active session into view when transitioning from Detail view
    useEffect(() => {
        if (selectedSession && visibleSessionIdsRef.current.length > 0) {
            const index = visibleSessionIdsRef.current.indexOf(selectedSession.session_id);
            if (index !== -1) {
                // Small timeout to ensure virtualizer is ready and layout is stable
                requestAnimationFrame(() => {
                    columnVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
                });
            }
        }
    }, [selectedSession?.session_id, columnVirtualizer]); // Only run when the ID changes (or on mount if set)

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
                    toolOptions={[]}
                    fileOptions={[]}
                    mcpServerOptions={[]}
                    shellCommandOptions={[]}
                    availableTools={[]}
                    availableFiles={[]}
                    availableMcpServers={[]}
                    availableShellCommands={[]}
                    dateFilter={dateFilter}
                    setDateFilter={setDateFilter}
                />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center max-w-sm mx-auto">
                        <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-6">
                            <MessageSquare className="w-10 h-10 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-lg font-medium text-foreground mb-2">
                            {t("session.board.empty.title")}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {t("session.board.empty.description")}
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
                toolOptions={allBrushOptions.tools}
                fileOptions={allBrushOptions.files}
                mcpServerOptions={allBrushOptions.mcpServers}
                shellCommandOptions={allBrushOptions.shellCommands}
                availableTools={visibleBrushOptions.tools}
                availableFiles={visibleBrushOptions.files}
                availableMcpServers={visibleBrushOptions.mcpServers}
                availableShellCommands={visibleBrushOptions.shellCommands}
                dateFilter={dateFilter}
                setDateFilter={setDateFilter}
            />

            {/* Activity Timeline Heatmap */}
            <SessionActivityTimeline
                boardSessions={boardSessions}
                allSortedSessionIds={allSortedSessionIds}
                dateFilter={dateFilter}
                setDateFilter={setDateFilter}
                clearDateFilter={clearDateFilter}
                isExpanded={isTimelineExpanded}
                onToggle={toggleTimeline}
                projectName={selectedProject?.name}
            />

            {/* Virtualized Lanes Container */}
            <div
                ref={parentRef}
                className={clsx(
                    "flex-1 overflow-auto scrollbar-thin select-none",
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
                        height: `${Math.max(maxContentHeight, parentRef.current?.clientHeight || 0)}px`,
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
                                    onInteractionClick={handleInteractionClick}
                                    onNavigate={(messageId) => {
                                        // Set session and messages from board cache when session
                                        // differs or messages are empty (e.g., after board view switch)
                                        const currentMessages = useAppStore.getState().messages;
                                        if (selectedSession?.session_id !== sessionId || currentMessages.length === 0) {
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

                                            clearSearchIndex();
                                            buildSearchIndex(data.messages);
                                        }
                                        // Navigate to message and switch view
                                        useAppStore.getState().navigateToMessage(messageId);
                                        useAppStore.getState().setAnalyticsCurrentView("messages");
                                    }}
                                    scrollContainerRef={parentRef as React.RefObject<HTMLDivElement>}
                                    onHeightChange={(h) => handleLaneHeightChange(sessionId, h)}
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
            {
                isMetaPressed && !isDragging && (
                    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 bg-accent text-white rounded-full text-xs font-bold shadow-2xl animate-bounce z-[100]">
                        {t("session.board.dragToPan")}
                    </div>
                )
            }
        </div >
    );
};
