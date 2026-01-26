import { memo, useMemo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClaudeMessage } from "../../types";
import type { ZoomLevel } from "../../types/board.types";
import { ToolIcon } from "../ToolIcon";
import { extractClaudeMessageContent } from "../../utils/messageUtils";
import { clsx } from "clsx";
import { FileText, X, FileCode, AlignLeft, Bot, User, Ban, ChevronUp, ChevronDown, GitCommit, PencilLine, GripVertical } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "../../store/useAppStore";

interface InteractionCardProps {
    message: ClaudeMessage;
    zoomLevel: ZoomLevel;
    isActive: boolean; // For brushing
    isExpanded: boolean; // For click expansion
    onHover?: (type: "role" | "status" | "tool" | "file", value: string) => void;
    onLeave?: () => void;
    onClick?: () => void;
    onNext?: () => void;
    onPrev?: () => void;
}

const ExpandedCard = ({
    message,
    content,
    toolInput,
    editedMdFile,
    role,
    isError,
    triggerRect,
    isMarkdownPretty,
    onClose,
    onNext,
    onPrev
}: {
    message: ClaudeMessage;
    content: string;
    toolInput: string;
    editedMdFile: string | null;
    role: string;
    isError: boolean;
    triggerRect: DOMRect | null;
    isMarkdownPretty: boolean;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
}) => {
    const { setMarkdownPretty } = useAppStore();
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);

    // Initial positioning logic
    useEffect(() => {
        if (!triggerRect || position !== null) return;

        // Calculate position: default to right, sticky to screen
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const cardWidth = 480; // Reasonable reading width
        const gap = 12;

        let left = triggerRect.right + gap;
        let top = triggerRect.top;

        // Flip to left if not enough space on right
        if (left + cardWidth > windowWidth - 20) {
            left = triggerRect.left - cardWidth - gap;
        }

        // Adjust top if bottom overflow
        const maxHeight = Math.min(600, windowHeight - 40);
        if (top + maxHeight > windowHeight - 20) {
            top = Math.max(20, windowHeight - maxHeight - 20);
        }

        // If top is initially offscreen (e.g. card is scrolled partially out), clamp it
        if (top < 20) top = 20;

        setPosition({ x: left, y: top });
    }, [triggerRect, position]);

    // Dragging Logic
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !dragStartRef.current || !position) return;

            const deltaX = e.clientX - dragStartRef.current.x;
            const deltaY = e.clientY - dragStartRef.current.y;

            // Update drag start for next frame (delta is per-frameish) 
            // OR better: calculate absolute new pos relative to initial drag
            // Simplified: just add delta to current pos state would lag
            // Correct way for rAF or direct updates:

            // We will just update state directly for now
            setPosition(prev => {
                if (!prev) return null;
                return { x: prev.x + deltaX, y: prev.y + deltaY };
            });

            dragStartRef.current = { x: e.clientX, y: e.clientY };
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            dragStartRef.current = null;
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault(); // Prevent text selection
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
    };

    if (!triggerRect || !position) return null;

    const windowHeight = window.innerHeight;
    const maxHeight = Math.min(600, windowHeight - 40);

    const displayContent = content || (message.toolUse ? JSON.stringify((message.toolUse as any).input, null, 2) : "No content");

    return createPortal(
        <div className="fixed inset-0 z-50 pointer-events-none">
            {/* Click backdrop to close - keep pointer events strictly on the bg */}
            <div className="absolute inset-0 pointer-events-auto" onClick={(e) => { e.stopPropagation(); onClose(); }} />

            <div
                className={clsx(
                    "absolute w-[480px] bg-popover/95 text-popover-foreground border border-border rounded-lg shadow-2xl flex flex-col backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 pointer-events-auto ring-1 ring-border/50",
                    isDragging ? "cursor-grabbing shadow-xl scale-[1.01]" : "shadow-2xl"
                )}
                style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    maxHeight: `${maxHeight}px`,
                    // transformOrigin: ... handled by initial placement logic mostly
                }}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <div
                    className="flex items-center justify-between p-3 border-b border-border/50 bg-muted/30 rounded-t-lg shrink-0 select-none cursor-grab active:cursor-grabbing group/header"
                    onMouseDown={handleDragStart}
                >
                    <div className="flex items-center gap-2.5">
                        <GripVertical className="w-4 h-4 text-muted-foreground/30 group-hover/header:text-muted-foreground/60 transition-colors" />
                        <div className="p-1.5 bg-background rounded-md shadow-sm border border-border/50">
                            {message.toolUse ? (
                                <ToolIcon toolName={(message.toolUse as any).name} className="w-4 h-4 text-accent" />
                            ) : (
                                role === 'user' ? (
                                    <User className="w-3 h-3 text-primary" />
                                ) : (
                                    <Bot className="w-3 h-3 text-muted-foreground" />
                                )
                            )}
                        </div>

                        <div className="flex flex-col gap-0.5">
                            <span className={clsx("font-bold uppercase text-[11px] tracking-wide",
                                message.toolUse ? "text-accent" : (role === 'user' ? 'text-primary' : 'text-foreground')
                            )}>
                                {message.toolUse ? (message.toolUse as any).name : role}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono leading-none">
                                {new Date(message.timestamp).toLocaleTimeString()}
                            </span>
                        </div>
                    </div>

                    {/* Prevent drag inside buttons */}
                    <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
                        {/* Navigation Controls */}
                        <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 rounded-md border border-border/50 mr-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
                                disabled={!onPrev}
                                className="p-1 rounded hover:bg-background hover:shadow-sm disabled:opacity-30 transition-all"
                                title="Previous Message (Up)"
                            >
                                <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onNext?.(); }}
                                disabled={!onNext}
                                className="p-1 rounded hover:bg-background hover:shadow-sm disabled:opacity-30 transition-all"
                                title="Next Message (Down)"
                            >
                                <ChevronDown className="w-3 h-3" />
                            </button>
                        </div>

                        {/* Markdown Toggle inside Tooltip */}
                        <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 rounded-md border border-border/50">
                            <button
                                onClick={() => setMarkdownPretty(false)}
                                className={clsx(
                                    "p-1 rounded transition-all",
                                    !isMarkdownPretty ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                title="Raw Text"
                            >
                                <AlignLeft className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => setMarkdownPretty(true)}
                                className={clsx(
                                    "p-1 rounded transition-all",
                                    isMarkdownPretty ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                title="Pretty Markdown"
                            >
                                <FileCode className="w-3 h-3" />
                            </button>
                        </div>

                        <button onClick={onClose} className="p-1 hover:bg-muted rounded-full transition-colors opacity-70 hover:opacity-100">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
                    {isMarkdownPretty && !message.toolUse ? (
                        <div className="prose prose-xs dark:prose-invert max-w-none break-words">
                            <ReactMarkdown>{displayContent}</ReactMarkdown>
                        </div>
                    ) : (
                        displayContent
                    )}
                </div>

                {isError && (
                    <div className="px-4 py-2 border-t border-destructive/20 bg-destructive/5 text-destructive text-xs font-medium">
                        Error detected in this interaction
                    </div>
                )}

                <div className="p-2 border-t border-border/50 bg-muted/10 rounded-b-lg flex justify-end gap-3 text-[10px] text-muted-foreground shrink-0 font-mono">
                    {(message.usage) && (
                        <>
                            <span>In: {message.usage.input_tokens.toLocaleString()}</span>
                            <span>Out: {message.usage.output_tokens.toLocaleString()}</span>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export const InteractionCard = memo(({
    message,
    zoomLevel,
    isActive, // Keep prop for now to avoid breaking interface, but we'll ignore it visually or just default true
    isExpanded,
    onHover,
    onLeave,
    onClick,
    onNext,
    onPrev
}: InteractionCardProps) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
    const isMarkdownPretty = useAppStore(state => state.isMarkdownPretty);

    // Update rect when expanded changes
    useEffect(() => {
        if (isExpanded && cardRef.current) {
            setTriggerRect(cardRef.current.getBoundingClientRect());
            // Scroll card into view if expanded
            cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [isExpanded]);

    const content = extractClaudeMessageContent(message) || "";
    const isTool = !!message.toolUse;
    const toolInput = isTool ? JSON.stringify((message.toolUse as any).input) : "";

    // Skip "No content" entries if they are not tools and empty
    if (!content.trim() && !isTool) {
        return null;
    }

    const isError = (message.stopReasonSystem?.toLowerCase().includes("error")) ||
        (message.toolUseResult as any)?.is_error ||
        (message.toolUseResult as any)?.stderr?.length > 0;

    const isCancelled = message.stopReason === "customer_cancelled" ||
        message.stopReasonSystem === "customer_cancelled" ||
        message.stopReason === "consumer_cancelled" || // Some legacy
        content.includes("request canceled by user");

    const role = message.role || message.type;

    // New Heuristics for Pixel View Coloring
    const isCommit = useMemo(() => {
        if (!isTool) return false;
        const tool = message.toolUse as any;
        if (['run_command', 'bash', 'execute_command'].includes(tool.name)) {
            const cmd = tool.input?.CommandLine || tool.input?.command;
            return typeof cmd === 'string' && cmd.trim().startsWith('git commit');
        }
        return false;
    }, [message, isTool]);

    const isFileEdit = useMemo(() => {
        if (!isTool) return false;
        const tool = message.toolUse as any;
        return ['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file', 'Edit', 'Replace'].includes(tool.name) || /write|edit|replace|patch/i.test(tool.name);
    }, [message, isTool]);

    const editedMdFile = useMemo(() => {
        if (message.toolUse) {
            const toolUse = message.toolUse as any;
            const name = toolUse.name;
            const input = toolUse.input;

            if (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file'].includes(name) || /write|edit|replace|patch/i.test(name)) {
                const path = input?.path || input?.file_path || input?.TargetFile || "";
                if (typeof path === 'string' && path.toLowerCase().endsWith('.md')) {
                    return path;
                }
            }
        }

        // Also naive regex check for mentions in assistant text
        if (role === 'assistant' && content) {
            const mdMention = content.match(/(create|update|edit|writing|wrote).+?([a-zA-Z0-9_\-\.]+\.md)/i);
            if (mdMention && mdMention[2]) {
                // return mdMention[2]; 
            }
        }

        return null;
    }, [message.toolUse, content, role]);

    // Base classes for the card - REMOVED isActive checks
    const baseClasses = clsx(
        "relative rounded transition-all duration-200 cursor-pointer overflow-hidden border border-transparent shadow-sm select-none",
        "hover:border-accent hover:shadow-lg hover:z-50 hover:scale-[1.02]", // Always hoverable
        isError && "bg-destructive/10 border-destructive/20",
        isCancelled && "bg-orange-500/10 border-orange-500/20"
    );

    // Minimal Role Indicator (Icon only)
    const RoleIcon = useMemo(() => {
        if (isCommit) return <GitCommit className="w-3.5 h-3.5 text-indigo-500" />;
        // If markdown edit is detected locally for this card
        if (editedMdFile) return <FileText className="w-3.5 h-3.5 text-amber-500" />;
        if (isFileEdit) return <PencilLine className="w-3.5 h-3.5 text-emerald-500" />;

        if (message.toolUse) return <ToolIcon toolName={(message.toolUse as any).name} className="w-4 h-4 text-accent" />;
        if (role === 'user') return <User className="w-3.5 h-3.5 text-primary" />;
        return <Bot className="w-3.5 h-3.5 text-muted-foreground" />;
    }, [role, message.toolUse, isCommit, isFileEdit, editedMdFile]);

    // Level 0: Pixel/Heatmap
    if (zoomLevel === 0) {
        const totalTokens = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);
        const height = Math.min(Math.max(totalTokens / 50, 4), 20);

        let bgColor = "bg-muted";
        if (role === "user") bgColor = "bg-primary/60";
        else if (role === "assistant") bgColor = "bg-foreground/40";

        // Override with Event Types for the "Session Understanding" view
        if (message.toolUse) {
            bgColor = "bg-accent/60";
            if (editedMdFile) bgColor = "bg-amber-500/90"; // High salience for Markdown
            else if (isFileEdit) bgColor = "bg-emerald-500/90"; // High salience for code
            if (isCommit) bgColor = "bg-indigo-500/90"; // High salience for commits
        }

        if (isError) bgColor = "bg-destructive/90";
        if (isCancelled) bgColor = "bg-orange-500/70";

        return (
            <div
                ref={cardRef}
                className={clsx(baseClasses, bgColor, "w-full ring-0 border-0")} // No border in pixel view for seamless look
                style={{ height: `${height}px` }}
                onMouseEnter={() => onHover?.('role', role)}
                onMouseLeave={onLeave}
                onClick={onClick}
                title={isCommit ? "Commit" : editedMdFile ? "Docs Edit" : isFileEdit ? "File Edit" : role}
            />
        );
    }

    // Level 1: Skim/Kanban
    if (zoomLevel === 1) {
        return (
            <>
                <div
                    ref={cardRef}
                    // Reduce mb to 0.5 for tighter packing
                    className={clsx(baseClasses, "mb-0.5 p-1.5 bg-card flex gap-2 items-start")}
                    onMouseEnter={() => onHover?.('role', role)}
                    onMouseLeave={onLeave}
                    onClick={onClick}
                >
                    <div className="mt-0.5 relative shrink-0">
                        {/* Smaller circle indicator for compact view */}
                        <div className="w-5 h-5 rounded-full bg-muted/30 flex items-center justify-center">
                            {RoleIcon}
                        </div>

                        {editedMdFile && (
                            <div
                                className="absolute -top-1 -right-1 p-0.5 bg-amber-500 rounded-full shadow-sm text-white border border-background"
                                title="Markdown Modified"
                            >
                                <FileText className="w-2 h-2" />
                            </div>
                        )}

                        {isCancelled && (
                            <div className="absolute -bottom-1 -right-1 p-0.5 bg-orange-500 rounded-full shadow-sm text-white border border-background" title="Cancelled by User">
                                <Ban className="w-2 h-2" />
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        {message.toolUse && (
                            <div className="text-[9px] font-medium uppercase tracking-tight text-accent opacity-90 mb-0.5 flex items-center gap-1.5">
                                {(message.toolUse as any).name}
                                {isCommit && <span className="ml-1 text-indigo-500 font-bold bg-indigo-500/10 px-1 rounded-[2px] border border-indigo-500/20">COMMIT</span>}
                                {editedMdFile && <span className="text-amber-500 font-bold bg-amber-500/10 px-1 rounded-[2px] border border-amber-500/20">DOCS</span>}
                            </div>
                        )}
                        <p className={clsx("text-xs line-clamp-2 leading-tight",
                            role === 'user' ? 'text-foreground font-medium' : 'text-foreground/80'
                        )}>
                            {message.toolUse ? toolInput : content}
                        </p>
                    </div>
                    {isError && (
                        <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                    )}
                </div>
                {isExpanded && <ExpandedCard
                    message={message}
                    content={content}
                    toolInput={toolInput}
                    editedMdFile={editedMdFile}
                    role={role}
                    isError={isError as any}
                    triggerRect={triggerRect}
                    isMarkdownPretty={isMarkdownPretty}
                    onClose={() => onClick?.()}
                    onNext={onNext}
                    onPrev={onPrev}
                />}
            </>
        );
    }

    // Level 2: Read/Detail
    return (
        <>
            <div
                ref={cardRef}
                // Reduced vertical spacing to 1 or 0.5
                className={clsx(baseClasses, "mb-1 p-2 bg-card flex flex-col gap-1.5 ring-1 ring-border/5 shadow-md")}
                style={{ transformOrigin: 'top center' }}
                onMouseEnter={() => onHover?.('role', role)}
                onMouseLeave={onLeave}
                onClick={onClick}
            >
                {editedMdFile ? (
                    <div
                        className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-600 font-medium mb-1 cursor-help group/md"
                        title="Markdown File Edit"
                    >
                        <FileText className="w-3 h-3" />
                        <span className="truncate">Docs: {editedMdFile}</span>
                    </div>
                ) : editedMdFile === null && isFileEdit ? (
                    // Generic file edit fallback if needed, but the hook above handles it via null. 
                    // We can check if we want to show generic file path too? 
                    // Let's rely on Tool Input display for generic unless specifically MD.
                    // Actually, existing code showed generic edits in green. Let's restore that logic for non-MD.
                    // But wait, 'editedMdFile' is null if not .md.
                    // We need to check if it's ANY file edit to show the green banner.
                    // Let's parse 'anyFile' here briefly.
                    (() => {
                        const tool = message.toolUse as any;
                        const path = tool?.input?.path || tool?.input?.file_path || tool?.input?.TargetFile;
                        if (path && typeof path === 'string') {
                            return (
                                <div
                                    className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] text-emerald-600 font-medium mb-1"
                                >
                                    <PencilLine className="w-3 h-3" />
                                    <span className="truncate">Edit: {path}</span>
                                </div>
                            );
                        }
                        return null;
                    })()
                ) : null}

                {/* Header (Role + Time + Cancelled) */}
                <div className="flex justify-between items-center border-b border-border/10 pb-1 mb-0.5">
                    <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-muted/30 flex items-center justify-center shrink-0">
                            {RoleIcon}
                        </div>

                        {isCommit && <span className="text-[9px] bg-indigo-500/10 text-indigo-600 px-1 rounded border border-indigo-200 uppercase tracking-wider font-bold">GIT</span>}
                        {editedMdFile && <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1 rounded border border-amber-200 uppercase tracking-wider font-bold">DOCS</span>}

                        {isCancelled && (
                            <span className="text-[9px] uppercase font-bold text-orange-500 tracking-wide border border-orange-500/30 px-1 rounded">Cancelled</span>
                        )}
                    </div>
                    <span className="text-[9px] text-muted-foreground font-mono">
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                </div>

                {/* Content Area */}
                <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-tight max-h-[300px] overflow-hidden relative">
                    {content || (message.toolUse ? JSON.stringify((message.toolUse as any).input, null, 2) : "No content")}
                    {/* Gradient to fade out long content */}
                    <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                </div>

                {(message.usage) && (
                    <div className="mt-auto pt-1 flex gap-2 text-[9px] text-muted-foreground opacity-60 font-mono">
                        <span>In: {message.usage.input_tokens}</span>
                        <span>Out: {message.usage.output_tokens}</span>
                    </div>
                )}

                {isError && (
                    <div className="mt-1 p-1 bg-destructive/10 rounded text-[9px] text-destructive border border-destructive/20 font-mono italic">
                        Error detected
                    </div>
                )}
            </div>
            {isExpanded && <ExpandedCard
                message={message}
                content={content}
                toolInput={toolInput}
                editedMdFile={editedMdFile}
                role={role}
                isError={isError as any}
                triggerRect={triggerRect}
                isMarkdownPretty={isMarkdownPretty}
                onClose={() => onClick?.()}
                onNext={onNext}
                onPrev={onPrev}
            />}
        </>
    );
});
