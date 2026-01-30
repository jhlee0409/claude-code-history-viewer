import { memo, useMemo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchesBrush, type ActiveBrush } from "@/utils/brushMatchers";
import type { ClaudeMessage, GitCommit } from "../../types";
import type { ZoomLevel } from "../../types/board.types";
import { ToolIcon } from "../ToolIcon";
import { getToolVariant } from "@/utils/toolIconUtils";
import {
    extractClaudeMessageContent,
    getMessageRole,
    getToolUseBlock,
    isClaudeAssistantMessage,
    isClaudeUserMessage,
    isClaudeSystemMessage
} from "../../utils/messageUtils";
import { clsx } from "clsx";
import { FileText, X, FileCode, AlignLeft, Bot, User, Ban, ChevronUp, ChevronDown, GitCommit as GitIcon, PencilLine, GripVertical, CheckCircle2, Link2, Layers, Timer, Scissors, AlertTriangle, Zap, Plug, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "../../store/useAppStore";
import { SmartJsonDisplay } from "../SmartJsonDisplay";
import { getNaturalLanguageSummary, getAgentName } from "../../utils/toolSummaries";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
interface InteractionCardProps {
    message: ClaudeMessage;
    zoomLevel: ZoomLevel;
    isExpanded: boolean; // For click expansion
    gitCommits?: GitCommit[];
    onClick?: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    onFileClick?: (file: string) => void;
    siblings?: ClaudeMessage[]; // For merged cards
    onNavigate?: () => void;
    activeBrush?: ActiveBrush | null;
    onToggleSticky?: () => void;
}

const ExpandedCard = ({
    message,
    content,
    editedMdFile,
    role,
    isError,
    triggerRect,
    isMarkdownPretty,
    onClose,
    onNext,
    onPrev,
    onFileClick,
    onNavigate
}: {
    message: ClaudeMessage;
    content: string;
    editedMdFile: string | null;
    role: string;
    isError: boolean;
    triggerRect: DOMRect | null;
    isMarkdownPretty: boolean;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    onFileClick?: (file: string) => void;
    onNavigate?: () => void;
}) => {
    const { setMarkdownPretty } = useAppStore();
    const [position, setPosition] = useState<{ x: number; y: number; anchorY: 'top' | 'bottom' } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);

    // Unified Tool Use Extraction
    const toolUseBlock = getToolUseBlock(message);

    // Initial positioning logic
    useEffect(() => {
        if (!triggerRect || position !== null) return;

        // Calculate position: default to right, sticky to screen
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const cardWidth = 480; // Reasonable reading width
        const gap = 12;

        let left = triggerRect.right + gap;

        // Heuristic: If trigger is in the bottom half of the screen, prefer bottom alignment (grow up or anchor bottom)
        const isBottomHalf = triggerRect.top > windowHeight / 2;
        const anchorY: 'top' | 'bottom' = isBottomHalf ? 'bottom' : 'top';

        let top: number;
        if (isBottomHalf) {
            // y will be the distance from the bottom of the viewport
            top = windowHeight - triggerRect.bottom;

            // If bottom edge is too close to bottom of screen (e.g. huge trigger?), clamp it.
            if (top < 20) top = 20;
        } else {
            top = triggerRect.top;

            // If top is offscreen?
            if (top < 20) top = 20;
            // Overflow check is handled by max-height usually.
        }

        setPosition({ x: left, y: top, anchorY });
    }, [triggerRect, position]);

    // Dragging Logic
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !dragStartRef.current || !position) return;

            const deltaX = e.clientX - dragStartRef.current.x;
            const deltaY = e.clientY - dragStartRef.current.y;

            setPosition(prev => {
                if (!prev) return null;

                if (prev.anchorY === 'bottom') {
                    return { x: prev.x + deltaX, y: prev.y - deltaY, anchorY: 'bottom' };
                }

                return { x: prev.x + deltaX, y: prev.y + deltaY, anchorY: 'top' };
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
    }, [isDragging, position]);

    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault(); // Prevent text selection
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
    };

    // const displayContent = content || (toolUseBlock ? JSON.stringify(toolUseBlock.input, null, 2) : "No content");
    // We now render JsonViewer inside the portal if needed, or string content
    const ToolContent = useMemo(() => {
        if (!toolUseBlock) return null;
        return <SmartJsonDisplay data={toolUseBlock.input} className="max-w-[440px]" />
    }, [toolUseBlock]);

    if (!triggerRect || !position) return null;

    const windowHeight = window.innerHeight;
    const maxHeight = Math.min(600, windowHeight - 40);

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
                    top: position.anchorY === 'top' ? `${position.y}px` : undefined,
                    bottom: position.anchorY === 'bottom' ? `${position.y}px` : undefined,
                    maxHeight: `${maxHeight}px`,
                    // transformOrigin: ... handled by initial placement logic mostly
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    // Generic tap on body goes to detail view if not selecting text
                    if (window.getSelection()?.toString().length === 0) {
                        onNavigate?.();
                    }
                }} // Prevent closing when clicking inside
            >
                <div
                    className="flex items-center justify-between p-3 border-b border-border/50 bg-muted/30 rounded-t-lg shrink-0 select-none cursor-grab active:cursor-grabbing group/header"
                    onMouseDown={handleDragStart}
                >
                    <div className="flex items-center gap-2.5">
                        <GripVertical className="w-4 h-4 text-muted-foreground/30 group-hover/header:text-muted-foreground/60 transition-colors" />
                        <div className="p-1.5 bg-background rounded-md shadow-sm border border-border/50">
                            {toolUseBlock ? (
                                <ToolIcon toolName={toolUseBlock.name} className="w-4 h-4 text-accent" />
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
                                toolUseBlock ? "text-accent" : (role === 'user' ? 'text-primary' : 'text-foreground')
                            )}>
                                {toolUseBlock ? toolUseBlock.name : role}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono leading-none">
                                {new Date(message.timestamp).toLocaleTimeString()}
                            </span>
                        </div>
                        {editedMdFile && (
                            <div
                                className={clsx(
                                    "flex items-center gap-1.5 ml-3 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-600 font-medium font-mono transition-colors",
                                    onFileClick && "hover:bg-amber-500/20 cursor-pointer"
                                )}
                                title="Markdown File Edit - Click to view in Recent Edits"
                                onClick={(e) => {
                                    if (onFileClick) {
                                        e.stopPropagation();
                                        onFileClick(editedMdFile);
                                    }
                                }}
                            >
                                <FileText className="w-3 h-3" />
                                <span className="truncate max-w-[120px]">{editedMdFile}</span>
                            </div>
                        )}
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

                        {/* Open in Full View inside Tooltip */}
                        <button
                            onClick={(e) => { e.stopPropagation(); onNavigate?.(); }}
                            className="p-1 hover:bg-muted rounded text-xs text-muted-foreground hover:text-foreground transition-colors mr-1"
                            title="Open in Message View"
                        >
                            <span className="sr-only">Open</span>
                            Open
                        </button>

                        <button onClick={onClose} className="p-1 hover:bg-muted rounded-full transition-colors opacity-70 hover:opacity-100" title="Close">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
                    {isMarkdownPretty && !toolUseBlock ? (
                        <div className="prose prose-xs dark:prose-invert max-w-none break-words">
                            <ReactMarkdown>{content}</ReactMarkdown>
                        </div>
                    ) : (
                        content ? content : (ToolContent || "No content")
                    )}
                </div>

                {isError && (
                    <div className="px-4 py-2 border-t border-destructive/20 bg-destructive/5 text-destructive text-xs font-medium">
                        Error detected in this interaction
                    </div>
                )}

                <div className="p-2 border-t border-border/50 bg-muted/10 rounded-b-lg flex justify-end gap-3 text-[10px] text-muted-foreground shrink-0 font-mono">
                    {isClaudeAssistantMessage(message) && message.usage && (
                        <>
                            <span>In: {message.usage.input_tokens || 0}</span>
                            <span>Out: {message.usage.output_tokens || 0}</span>
                        </>
                    )}
                </div>
            </div>
        </div >,
        document.body
    );
};

export const InteractionCard = memo(({
    message,
    zoomLevel,
    isExpanded,
    gitCommits,
    onClick,
    onFileClick,
    onNext,
    onPrev,
    siblings,
    onNavigate,
    activeBrush,
    onToggleSticky
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
    const toolUseBlock = useMemo(() => getToolUseBlock(message), [message]);
    const role = getMessageRole(message);

    // --- CardSemantics: all semantic properties computed once ---
    const semantics = useMemo(() => {
        const isTool = !!toolUseBlock;
        const variant = toolUseBlock ? getToolVariant(toolUseBlock.name) : null;

        // Error detection
        const isError = (isClaudeSystemMessage(message) && message.stopReasonSystem?.toLowerCase().includes("error")) ||
            (isClaudeAssistantMessage(message) && typeof message.toolUseResult === 'object' && message.toolUseResult !== null && (message.toolUseResult as Record<string, unknown>).is_error === true) ||
            (isClaudeAssistantMessage(message) && typeof message.toolUseResult === 'object' && message.toolUseResult !== null && typeof (message.toolUseResult as Record<string, unknown>).stderr === 'string' && ((message.toolUseResult as Record<string, unknown>).stderr as string).length > 0);

        // Cancellation detection
        const isCancelled = (isClaudeAssistantMessage(message) && (message.stop_reason === "customer_cancelled" || message.stop_reason === "consumer_cancelled")) ||
            (isClaudeSystemMessage(message) && message.stopReasonSystem === "customer_cancelled") ||
            content.includes("request canceled by user");

        // Git commit detection
        let isCommit = false;
        if (isTool && toolUseBlock) {
            if (['run_command', 'bash', 'execute_command'].includes(toolUseBlock.name)) {
                const cmd = toolUseBlock.input?.CommandLine || toolUseBlock.input?.command;
                isCommit = typeof cmd === 'string' && cmd.includes('git commit');
            }
        }

        // Generic Git command detection (includes commits AND other git ops)
        let isGit = false;
        if (isTool && toolUseBlock) {
            // 1. Explicit tool variant
            if (variant === 'git') isGit = true;
            // 2. Shell command starting with git
            if (['run_command', 'bash', 'execute_command'].includes(toolUseBlock.name)) {
                const cmd = toolUseBlock.input?.CommandLine || toolUseBlock.input?.command;
                if (typeof cmd === 'string' && cmd.trim().startsWith('git')) {
                    isGit = true;
                }
            }
        }

        // Shell detection (terminal variant, excluding git ops)
        const isShell = isTool && variant === 'terminal' && !isCommit && !isGit;

        // Shell command text (for display in zoom 1/2)
        const shellCommand = isShell && toolUseBlock
            ? (toolUseBlock.input?.CommandLine || toolUseBlock.input?.command || null) as string | null
            : null;

        // File edit detection
        const isFileEdit = isTool && toolUseBlock
            ? (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file', 'Edit', 'Replace'].includes(toolUseBlock.name) || /write|edit|replace|patch/i.test(toolUseBlock.name))
            : false;

        // Markdown file detection
        let editedMdFile: string | null = null;
        if (toolUseBlock) {
            const name = toolUseBlock.name;
            const input = toolUseBlock.input;
            if (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file'].includes(name) || /write|edit|replace|patch/i.test(name)) {
                const path = input?.path || input?.file_path || input?.TargetFile || "";
                if (typeof path === 'string' && path.toLowerCase().endsWith('.md')) {
                    editedMdFile = path;
                }
            }
        }
        if (!editedMdFile && role === 'assistant' && content) {
            const mdMention = content.match(/(create|update|edit|writing|wrote).+?([a-zA-Z0-9_\-. ]+\.md)/i);
            if (mdMention && mdMention[2]) {
                editedMdFile = mdMention[2];
            }
        }

        // URL detection
        const hasUrls = content ? /https?:\/\/[^\s]+/.test(content) : false;

        // MCP detection
        const isMcp = toolUseBlock
            ? toolUseBlock.name === 'mcp'
            : (content.includes('<command-name>/mcp') || content.includes('mcp_server'));

        // Raw error detection (in content text)
        const isRawError = content.includes('<local-command-stdout>Failed') ||
            content.includes('Error:') ||
            content.includes('[ERROR]') ||
            (content.includes('<local-command-stdout>') && content.toLowerCase().includes('failed'));

        // Model detection
        const model = isClaudeAssistantMessage(message) ? message.model : undefined;

        // Brush matching (Step 4 & 6)
        const brushMatch = matchesBrush(activeBrush || null, {
            role,
            model,
            variant: variant || "neutral",
            isError: isError || isRawError,
            isCancelled,
            isCommit,
            isGit,
            isShell,
            isFileEdit,
            editedFiles: editedMdFile ? [editedMdFile] : []
        });

        return {
            isTool, variant, isError, isCancelled, isCommit, isGit, isShell, shellCommand,
            isFileEdit, editedMdFile, hasUrls, isMcp, isRawError,
            brushMatch
        };
    }, [message, toolUseBlock, content, role, activeBrush]);

    // Destructure for backward-compatible access in render blocks
    // Destructure commonly-used semantics; access semantics.variant directly when needed (e.g. brushing)
    const {
        isTool, isError, isCancelled, isCommit, isGit, isShell, shellCommand,
        isFileEdit, editedMdFile, hasUrls, isMcp, isRawError, brushMatch
    } = semantics;

    // Verified git commit (depends on semantics.isCommit + external gitCommits)
    const verifiedCommit = useMemo(() => {
        if (!isCommit || !gitCommits || gitCommits.length === 0 || !toolUseBlock) return null;

        const cmd = toolUseBlock.input?.CommandLine || toolUseBlock.input?.command;
        if (!cmd) return null;

        const commitMsgMatch = (cmd as string).match(/-m\s+["'](.+?)["']/);
        const targetMsg = commitMsgMatch ? commitMsgMatch[1] : "";

        return gitCommits.find(c => {
            const sameMsg = targetMsg && c.message.includes(targetMsg);
            const nearbyTime = Math.abs(c.timestamp * 1000 - new Date(message.timestamp).getTime()) < 60000;
            return sameMsg || nearbyTime;
        });
    }, [isCommit, gitCommits, message, toolUseBlock]);

    // Base classes for the card
    const isHighlighted = !!activeBrush && brushMatch;
    const brushClass = isHighlighted ? "brush-match" : "";

    const baseClasses = clsx(
        "relative rounded transition-all duration-200 cursor-pointer border border-transparent shadow-sm select-none",
        (isHighlighted && zoomLevel !== 0) ? "overflow-visible z-50 !shadow-2xl !ring-4 !ring-blue-500" : "overflow-hidden",
        "hover:border-accent hover:shadow-lg hover:z-50 hover:scale-[1.02]", // Always hoverable
        (isError || isRawError) && "bg-destructive/10 border-destructive/20",
        isCancelled && "bg-orange-500/10 border-orange-500/20",
        isMcp && !isError && !isRawError && "bg-orange-500/5 border-orange-500/10",
        brushClass
    );

    // Minimal Role Indicator (Icon only)
    const RoleIcon = useMemo(() => {
        if (isCommit) return (
            <div className="relative">
                <span title="Git Commit"><GitIcon className="w-3.5 h-3.5 text-indigo-500" /></span>
                {verifiedCommit && (
                    <div className="absolute -top-1 -right-1">
                        <span title="Verified Commit"><CheckCircle2 className="w-2 h-2 text-blue-500 fill-white" /></span>
                    </div>
                )}
            </div>
        );

        // Error takes precedence
        if (isRawError) return <span title="Error Detected"><AlertTriangle className="w-3.5 h-3.5 text-destructive" /></span>;

        // Generic Git (non-commit)
        if (isGit) return <span title="Git Operation"><GitIcon className="w-3.5 h-3.5 text-orange-500" /></span>;

        // MCP Tool
        if (isMcp) return <span title="MCP Interaction"><Plug className="w-3.5 h-3.5 text-orange-500" /></span>;

        // If markdown edit is detected locally for this card
        if (editedMdFile) return <span title="Documentation Edit"><FileText className="w-3.5 h-3.5 text-amber-500" /></span>;
        if (isFileEdit) return <span title="File Edit"><PencilLine className="w-3.5 h-3.5 text-emerald-500" /></span>;

        if (toolUseBlock) return <ToolIcon toolName={toolUseBlock.name} className="w-4 h-4 text-accent" />;

        // URL/Reference detected
        if (hasUrls && role === 'assistant') return <span title="Contains Links"><Link2 className="w-3.5 h-3.5 text-sky-500" /></span>;

        if (role === 'user') return <span title="User Message"><User className="w-3.5 h-3.5 text-primary" /></span>;
        return <span title="Assistant Message"><Bot className="w-3.5 h-3.5 text-muted-foreground" /></span>;
    }, [role, isCommit, isFileEdit, editedMdFile, verifiedCommit, hasUrls, isMcp, isRawError, toolUseBlock]);

    // Memoized tool frequency summary for zoom level 2 header
    const toolFrequency = useMemo(() => {
        const allMsgs = [message, ...(siblings || [])];
        const toolCounts: Record<string, number> = {};
        let hasTools = false;

        allMsgs.forEach(m => {
            const toolBlock = getToolUseBlock(m);
            let tName = toolBlock ? toolBlock.name : '';

            if (tName) {
                // Normalize names for grouping
                if (['run_command', 'execute_command', 'bash'].includes(tName)) tName = 'bash';
                else if (['grep_search', 'glob_search'].includes(tName)) tName = 'search';
                else if (['read_resource', 'read_file'].includes(tName)) tName = 'read';
                else if (['write_to_file', 'replace_file_content', 'edit_file'].includes(tName)) tName = 'edit';

                toolCounts[tName] = (toolCounts[tName] || 0) + 1;
                hasTools = true;
            }
        });

        return hasTools ? toolCounts : null;
    }, [message, siblings]);

    // Skip "No content" entries if they are not tools and empty
    // MOVED here to be after all hooks to prevent "Rendered more hooks" errors
    if (!content.trim() && !isTool) {
        return null;
    }

    // Level 0: Pixel/Heatmap
    if (zoomLevel === 0) {
        const totalMessagesCount = (siblings?.length || 0) + 1;
        const totalTokens = [message, ...(siblings || [])].reduce((sum, m) => {
            const usage = isClaudeAssistantMessage(m) ? m.usage : null;
            return sum + (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
        }, 0);

        // Normalize height: min 4px, max 24px, typical range handled logarithmically or linearly capped
        const height = Math.min(Math.max(totalTokens / 40, 4), 24);

        let bgColor = "bg-slate-200 dark:bg-slate-800"; // Default foundation
        if (role === "user") bgColor = "bg-blue-400/80 dark:bg-blue-500/80"; // Distinct Blue for Input
        else if (role === "assistant") bgColor = "bg-slate-400/60 dark:bg-slate-600/60"; // Neutral Grey for Output

        // Override with Event Types for the "Session Understanding" view
        if (toolUseBlock) {
            const toolName = toolUseBlock.name;
            const variant = getToolVariant(toolName);

            switch (variant) {
                case 'code': bgColor = "bg-[var(--tool-code)] opacity-90"; break;
                case 'file': bgColor = "bg-[var(--tool-file)] opacity-90"; break;
                case 'search': bgColor = "bg-[var(--tool-search)] opacity-90"; break;
                case 'task': bgColor = "bg-[var(--tool-task)] opacity-90"; break;
                case 'terminal': bgColor = "bg-[var(--tool-terminal)] opacity-90"; break;
                case 'git': bgColor = "bg-[var(--tool-git)] opacity-90"; break;
                case 'web': bgColor = "bg-[var(--tool-web)] opacity-90"; break;
                case 'document': bgColor = "bg-[var(--tool-document)] opacity-90"; break;
                default: bgColor = "bg-purple-400/70 dark:bg-purple-500/70";
            }

            if (isCommit) bgColor = "bg-indigo-600 dark:bg-indigo-500";
            else if (editedMdFile) bgColor = "bg-amber-500 dark:bg-amber-500/90";
            else if (isFileEdit) bgColor = "bg-emerald-500 dark:bg-emerald-500/90";
        }

        if (isError) bgColor = "bg-red-500 dark:bg-red-500/90";
        if (isCancelled) bgColor = "bg-orange-400/80 dark:bg-orange-400/80";

        const agentName = toolUseBlock
            ? getAgentName(toolUseBlock.name, toolUseBlock.input)
            : "General Purpose";

        const tooltipContent = toolUseBlock
            ? getNaturalLanguageSummary(toolUseBlock.name, toolUseBlock.input)
            : content;

        const PixelCard = (
            <div
                ref={cardRef}
                className={clsx(
                    baseClasses,
                    bgColor,
                    "w-full rounded-[1px] mb-px",
                    // Pixel View Brushing: No border, dim unmatched
                    "ring-0 border-0 shadow-none",
                    // Dim unmatched items when a brush is active
                    (!!activeBrush && !brushMatch) && "opacity-25",
                    // Ensure matched items are fully visible (no border)
                    isHighlighted && "!opacity-100 z-50"
                )}
                style={{ height: `${height}px` }}
                onClick={onClick}
            >
                {/* Content Icon Overlay (Pixel View) */}
                {!isExpanded && (
                    <div className="absolute top-0.5 right-0.5 pointer-events-none opacity-40">
                        {isError && <AlertTriangle className="w-2.5 h-2.5 text-destructive" />}
                        {isCancelled && <Ban className="w-2.5 h-2.5 text-orange-500" />}
                    </div>
                )}
            </div>
        );

        if (isExpanded) {
            return (
                <>
                    {PixelCard}
                    <ExpandedCard
                        message={message}
                        content={content}
                        editedMdFile={editedMdFile}
                        role={role}
                        isError={Boolean(isError)}
                        triggerRect={triggerRect}
                        isMarkdownPretty={isMarkdownPretty}
                        onClose={() => onClick?.()}
                        onNext={onNext}
                        onPrev={onPrev}
                        onFileClick={onFileClick}
                        onNavigate={onNavigate}
                    />
                </>
            );
        }

        return (
            <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                    {PixelCard}
                </TooltipTrigger>
                <TooltipContent side="right" className="p-2 max-w-[300px] border border-border/50 bg-popover text-popover-foreground shadow-xl">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                                {agentName} {totalMessagesCount > 1 && `(x${totalMessagesCount})`}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                                {new Date(message.timestamp).toLocaleTimeString()}
                            </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-medium">
                            {RoleIcon}
                            <div className="flex flex-col">
                                <span className="uppercase text-[10px] font-bold tracking-wide opacity-80">
                                    {toolUseBlock ? toolUseBlock.name : role}
                                </span>
                                {totalMessagesCount > 1 && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {totalMessagesCount} messages • {totalTokens.toLocaleString()} tokens
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="text-[11px] leading-tight text-foreground/90 font-mono line-clamp-4 whitespace-pre-wrap break-words border-t border-border/20 pt-1 mt-0.5">
                            {totalMessagesCount > 1 ? (
                                <div className="flex flex-col gap-1">
                                    <div className="italic opacity-70">Block containing {totalMessagesCount} sequential entries.</div>
                                    <div className="line-clamp-3">{tooltipContent}</div>
                                </div>
                            ) : tooltipContent}
                        </div>
                    </div>
                </TooltipContent>
            </Tooltip>
        );
    }

    // Level 1: Skim/Kanban
    if (zoomLevel === 1) {
        const agentName = toolUseBlock
            ? getAgentName(toolUseBlock.name, toolUseBlock.input)
            : "General Purpose";

        return (
            <>
                <div
                    ref={cardRef}
                    // Change to flex-col to accommodate header
                    className={clsx(baseClasses, "mb-0.5 p-1.5 bg-card flex flex-col gap-1")}
                    onClick={onClick}
                >
                    {/* Agent Name Header - Only if NOT General Purpose */}
                    {agentName !== "General Purpose" && (
                        <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40 leading-none select-none">
                            {agentName}
                        </div>
                    )}

                    <div className="flex gap-2 items-start w-full">
                        <div className="mt-0.5 relative shrink-0">
                            {/* Smaller circle indicator for compact view */}
                            <div
                                className="w-5 h-5 rounded-full bg-muted/30 flex items-center justify-center hover:bg-muted/50 cursor-pointer transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleSticky?.();
                                }}
                            >
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
                            {toolUseBlock && (
                                <div
                                    className="text-[9px] font-medium uppercase tracking-tight text-accent opacity-90 mb-0.5 flex items-center gap-1.5 hover:opacity-100 cursor-pointer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleSticky?.();
                                    }}
                                >
                                    {toolUseBlock.name}
                                    {siblings && siblings.length > 0 && (
                                        <span className="flex items-center gap-0.5 text-[8px] bg-accent/10 text-accent px-1 rounded-sm border border-accent/20">
                                            <Layers className="w-2 h-2" />
                                            x{siblings.length + 1}
                                        </span>
                                    )}
                                    {isCommit && <span className="ml-1 text-indigo-500 font-bold bg-indigo-500/10 px-1 rounded-[2px] border border-indigo-500/20">COMMIT</span>}
                                    {isShell && <span className="ml-1 text-[var(--tool-terminal)] font-bold bg-[var(--tool-terminal)]/10 px-1 rounded-[2px] border border-[var(--tool-terminal)]/20">SHELL</span>}
                                    {editedMdFile && <span className="text-amber-500 font-bold bg-amber-500/10 px-1 rounded-[2px] border border-amber-500/20">DOCS</span>}
                                </div>
                            )}
                            {/* Shell command preview */}
                            {isShell && shellCommand && (
                                <p className="text-[10px] font-mono text-[var(--tool-terminal)] truncate opacity-70 mb-0.5">
                                    $ {shellCommand.length > 60 ? shellCommand.slice(0, 60) + '…' : shellCommand}
                                </p>
                            )}
                            <p className={clsx("text-xs line-clamp-2 leading-tight",
                                role === 'user' ? 'text-foreground font-medium' : 'text-foreground/80'
                            )}>
                                {toolUseBlock
                                    ? getNaturalLanguageSummary(toolUseBlock.name, toolUseBlock.input)
                                    : content}
                            </p>
                        </div>
                        {isError && (
                            <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                        )}
                    </div>
                </div>
                {isExpanded && <ExpandedCard
                    message={message}
                    content={content}
                    editedMdFile={editedMdFile}
                    role={role}
                    isError={Boolean(isError)}
                    triggerRect={triggerRect}
                    isMarkdownPretty={isMarkdownPretty}
                    onClose={() => onClick?.()}
                    onNext={onNext}
                    onPrev={onPrev}
                    onFileClick={onFileClick}
                    onNavigate={onNavigate}
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
                className={clsx(baseClasses, "mb-1 p-2 bg-card flex flex-col gap-1.5", !isHighlighted && "ring-1 ring-border/5 shadow-md")}
                style={{ transformOrigin: 'top center' }}
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
                        const path = toolUseBlock?.input?.path || toolUseBlock?.input?.file_path || toolUseBlock?.input?.TargetFile;
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
                ) : isShell && shellCommand ? (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--tool-terminal)]/10 border border-[var(--tool-terminal)]/20 rounded text-[10px] text-[var(--tool-terminal)] font-medium mb-1">
                        <Terminal className="w-3.5 h-3.5 shrink-0" />
                        <code className="font-mono truncate">$ {shellCommand}</code>
                    </div>
                ) : null}

                {/* Header (Role + Time + Cancelled) */}
                <div className="flex justify-between items-center border-b border-border/10 pb-1 mb-0.5">
                    <div className="flex items-center gap-2">
                        <div
                            className="w-5 h-5 rounded-full bg-muted/30 flex items-center justify-center shrink-0 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleSticky?.();
                            }}
                        >
                            {RoleIcon}
                        </div>

                        {isCommit && <span className="text-[9px] bg-indigo-500/10 text-indigo-600 px-1 rounded border border-indigo-200 uppercase tracking-wider font-bold cursor-pointer">GIT</span>}
                        {isShell && <span className="text-[9px] bg-[var(--tool-terminal)]/10 text-[var(--tool-terminal)] px-1 rounded border border-[var(--tool-terminal)]/20 uppercase tracking-wider font-bold cursor-pointer">SHELL</span>}
                        {editedMdFile && <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1 rounded border border-amber-200 uppercase tracking-wider font-bold cursor-pointer">DOCS</span>}

                        {/* Tool Frequency Summary (memoized) */}
                        {toolFrequency && (
                            <div className="flex items-center gap-1.5 ml-1">
                                {(Object.entries(toolFrequency) as [string, number][]).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                                    <div
                                        key={name}
                                        className="flex items-center gap-0.5 text-[9px] text-muted-foreground/80 bg-muted/30 px-1 rounded-sm border border-border/20 hover:bg-muted/50 cursor-pointer transition-colors"
                                        title={`${count}x ${name}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onToggleSticky?.();
                                        }}
                                    >
                                        <span className={clsx("w-1.5 h-1.5 rounded-full inline-block mr-0.5",
                                            name === 'bash' ? 'bg-sky-500' :
                                                name === 'search' ? 'bg-amber-500' :
                                                    name === 'edit' ? 'bg-emerald-500' :
                                                        name === 'read' ? 'bg-indigo-400' :
                                                            'bg-slate-400'
                                        )} />
                                        <span className="font-mono">{name}</span>
                                        {count > 1 && <span className="opacity-50 text-[8px] ml-px">({count})</span>}
                                    </div>
                                ))}
                            </div>
                        )}

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
                    {content ? content : (toolUseBlock ? <SmartJsonDisplay data={toolUseBlock.input} /> : "No content")}
                    {/* Gradient to fade out long content */}
                    <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                </div>

                {(message.type === 'assistant' && message.usage) && (
                    <div className="mt-auto pt-1 flex gap-2 text-[9px] text-muted-foreground opacity-60 font-mono items-center">
                        <span>In: {message.usage.input_tokens}</span>
                        <span>Out: {message.usage.output_tokens}</span>

                        {/* Cache Hit Indicator */}
                        {message.usage.cache_read_input_tokens && message.usage.cache_read_input_tokens > 0 && (
                            <div className="flex items-center gap-0.5 text-emerald-500" title={`Cache Hit: ${message.usage.cache_read_input_tokens} tokens`}>
                                <Zap className="w-3 h-3 fill-emerald-500/20" />
                                <span>{(message.usage.cache_read_input_tokens / 1000).toFixed(1)}k</span>
                            </div>
                        )}

                        {/* Duration Indicator */}
                        {message.durationMs && (
                            <div className="flex items-center gap-0.5 ml-auto" title={`Duration: ${(message.durationMs / 1000).toFixed(1)}s`}>
                                <Timer className="w-3 h-3" />
                                <span>{(message.durationMs / 1000).toFixed(1)}s</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Exit Code / Status Footer Layer */}
                <div className="flex gap-2 mt-1">
                    {/* Exit Code */}
                    {(() => {
                        // Check for tool result content item or direct toolUseResult property
                        // Safe access via discriminated union logic or loose check
                        const result = (isClaudeAssistantMessage(message) || isClaudeUserMessage(message)) ? message.toolUseResult : null;
                        if (!result || typeof result !== 'object') return null;

                        const res = result as Record<string, unknown>;
                        const code = res.exitCode ?? res.return_code;
                        if (code === undefined) return null;

                        const codeNum = Number(code);
                        return (
                            <div className={clsx("flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border self-start",
                                codeNum === 0 ? "text-emerald-600 bg-emerald-500/5 border-emerald-500/20" : "text-destructive bg-destructive/5 border-destructive/20"
                            )} title={`Exit Code: ${codeNum}`}>
                                {codeNum === 0 ? <CheckCircle2 className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                                <span className="font-bold">EXIT {codeNum}</span>
                            </div>
                        );
                    })()}

                    {/* Cutoff Indicator */}
                    {isClaudeAssistantMessage(message) && message.stop_reason === 'max_tokens' && (
                        <div className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border self-start text-orange-600 bg-orange-500/5 border-orange-500/20" title="Generation truncated due to max_tokens">
                            <Scissors className="w-2.5 h-2.5" />
                            <span className="font-bold">CUTOFF</span>
                        </div>
                    )}
                </div>

                {isError && (
                    <div className="mt-1 p-1 bg-destructive/10 rounded text-[9px] text-destructive border border-destructive/20 font-mono italic flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Error detected</span>
                    </div>
                )}
            </div>
            {isExpanded && <ExpandedCard
                message={message}
                content={content}
                editedMdFile={editedMdFile}
                role={role}
                isError={Boolean(isError)}
                triggerRect={triggerRect}
                isMarkdownPretty={isMarkdownPretty}
                onClose={() => onClick?.()}
                onNext={onNext}
                onPrev={onPrev}
                onFileClick={onFileClick}
                onNavigate={onNavigate}
            />}
        </>
    );
});
