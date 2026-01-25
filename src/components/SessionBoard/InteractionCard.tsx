import { memo, useMemo } from "react";
import type { ClaudeMessage } from "../../types";
import type { ZoomLevel } from "../../types/board.types";
import { ToolIcon } from "../ToolIcon";
import { extractClaudeMessageContent } from "../../utils/messageUtils";
import { clsx } from "clsx";
import { FileText } from "lucide-react";

interface InteractionCardProps {
    message: ClaudeMessage;
    zoomLevel: ZoomLevel;
    isActive: boolean; // For brushing
    onHover?: (type: "role" | "status" | "tool" | "file", value: string) => void;
    onLeave?: () => void;
    onClick?: () => void;
}

export const InteractionCard = memo(({
    message,
    zoomLevel,
    isActive,
    onHover,
    onLeave,
    onClick
}: InteractionCardProps) => {
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

    const role = message.role || message.type;

    const editedMdFile = useMemo(() => {
        if (!message.toolUse) return null;
        const toolUse = message.toolUse as any;
        const path = toolUse.input?.path || toolUse?.input?.file_path || "";
        if (typeof path === 'string' && path.toLowerCase().endsWith('.md')) {
            return path;
        }
        return null;
    }, [message.toolUse]);

    // Base classes for the card
    const baseClasses = clsx(
        "relative rounded transition-all duration-200 cursor-pointer overflow-hidden border border-transparent shadow-sm",
        !isActive && "opacity-20 scale-[0.98] grayscale blur-[0.5px]",
        isActive && "hover:border-accent hover:shadow-lg hover:z-50 hover:scale-[1.02]",
        isError && "bg-destructive/10 border-destructive/20"
    );

    // Level 0: Pixel/Heatmap
    if (zoomLevel === 0) {
        const totalTokens = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);
        const height = Math.min(Math.max(totalTokens / 50, 4), 20);

        let bgColor = "bg-muted";
        if (role === "user") bgColor = "bg-primary/60";
        else if (role === "assistant") bgColor = "bg-foreground/40";
        else if (message.toolUse) bgColor = "bg-accent/60";

        if (editedMdFile) bgColor = "bg-emerald-500/80"; // Call out .md edits in Pixel view
        if (isError) bgColor = "bg-destructive/80";

        return (
            <div
                className={clsx(baseClasses, bgColor, "w-full")}
                style={{ height: `${height}px` }}
                onMouseEnter={() => onHover?.('role', role)}
                onMouseLeave={onLeave}
                onClick={onClick}
            />
        );
    }

    // Level 1: Skim/Kanban
    if (zoomLevel === 1) {
        return (
            <div
                className={clsx(baseClasses, "mb-1.5 p-2 bg-card min-h-[60px] flex gap-2 items-start")}
                onMouseEnter={() => onHover?.('role', role)}
                onMouseLeave={onLeave}
                onClick={onClick}
            >
                <div className="mt-0.5 relative">
                    {message.toolUse ? (
                        <ToolIcon toolName={(message.toolUse as any).name} className="text-accent" />
                    ) : (
                        <div className={clsx("w-3.5 h-3.5 rounded-full",
                            role === "user" ? "bg-primary" : "bg-muted-foreground/40")}
                        />
                    )}
                    {editedMdFile && (
                        <div
                            className="absolute -top-1 -right-1 p-0.5 bg-emerald-500 rounded-full shadow-sm text-white border border-background"
                            onMouseEnter={(e) => {
                                e.stopPropagation();
                                onHover?.('file', editedMdFile);
                            }}
                        >
                            <FileText className="w-2 h-2" />
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-tight text-muted-foreground opacity-70 mb-0.5">
                        {message.toolUse ? (message.toolUse as any).name : role}
                    </div>
                    <p className="text-xs line-clamp-2 leading-tight text-foreground/80">
                        {message.toolUse ? toolInput : content}
                    </p>
                </div>
                {isError && (
                    <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                )}
            </div>
        );
    }

    // Level 2: Read/Detail
    return (
        <div
            className={clsx(baseClasses, "mb-2.5 p-3 bg-card flex flex-col gap-2 ring-1 ring-border/5 shadow-md")}
            style={{ transformOrigin: 'top center' }}
            onMouseEnter={() => onHover?.('role', role)}
            onMouseLeave={onLeave}
            onClick={onClick}
        >
            {editedMdFile && (
                <div
                    className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] text-emerald-600 font-medium mb-1 cursor-help group/md"
                    onMouseEnter={(e) => {
                        e.stopPropagation();
                        onHover?.('file', editedMdFile);
                    }}
                >
                    <FileText className="w-3 h-3" />
                    <span className="truncate">Modified: {editedMdFile}</span>
                </div>
            )}

            <div className="flex justify-between items-center border-b border-border/10 pb-1.5 mb-1">
                <div className="flex items-center gap-2">
                    {message.toolUse ? (
                        <div className="flex items-center gap-1.5">
                            <ToolIcon toolName={(message.toolUse as any).name} className="text-accent" />
                            <span className="text-xs font-bold text-accent uppercase">{(message.toolUse as any).name}</span>
                        </div>
                    ) : (
                        <span className={clsx("text-xs font-bold uppercase", role === 'user' ? 'text-primary' : 'text-muted-foreground')}>
                            {role}
                        </span>
                    )}
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
            </div>

            <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-normal max-h-[300px] overflow-hidden relative">
                {content || (message.toolUse ? JSON.stringify((message.toolUse as any).input, null, 2) : "No content")}
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
            </div>

            {(message.usage) && (
                <div className="mt-auto pt-2 flex gap-3 text-[10px] text-muted-foreground opacity-60 font-mono">
                    <span>In: {message.usage.input_tokens}</span>
                    <span>Out: {message.usage.output_tokens}</span>
                </div>
            )}

            {isError && (
                <div className="mt-1 p-1.5 bg-destructive/10 rounded text-[10px] text-destructive border border-destructive/20 font-mono italic">
                    Error detected in interaction
                </div>
            )}
        </div>
    );
});
