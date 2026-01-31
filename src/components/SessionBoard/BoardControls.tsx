import type { ZoomLevel, DateFilter } from "../../types/board.types";
import type { ActiveBrush } from "@/utils/brushMatchers";
import {
    Layout,
    Layers,
    Eye,
    Filter,
    Lock
} from "lucide-react";
import { clsx } from "clsx";
import { DatePickerHeader } from "../ui/DatePickerHeader";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

interface BoardControlsProps {
    zoomLevel: ZoomLevel;
    onZoomChange: (level: ZoomLevel) => void;
    activeBrush: ActiveBrush | null;
    stickyBrush?: boolean;
    onBrushChange: (brush: ActiveBrush | null) => void;
    toolOptions?: string[];
    fileOptions?: string[];
    mcpServerOptions?: string[];
    shellCommandOptions?: string[];
    availableTools?: string[];
    availableFiles?: string[];
    availableMcpServers?: string[];
    availableShellCommands?: string[];
    dateFilter?: DateFilter;
    setDateFilter?: (filter: DateFilter) => void;
}

export const BoardControls = ({
    zoomLevel,
    onZoomChange,
    activeBrush,
    stickyBrush = false,
    onBrushChange,
    toolOptions = [],
    fileOptions = [],
    mcpServerOptions = [],
    shellCommandOptions = [],
    availableTools = [],
    availableFiles = [],
    availableMcpServers = [],
    availableShellCommands = []
}: BoardControlsProps) => {
    const { t } = useTranslation();


    return (
        <div
            className="h-10 px-4 border-b border-border/50 bg-card/30 flex items-center justify-between shrink-0 backdrop-blur-md select-none"
        >
            {/* Zoom Controls */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 p-0.5 bg-muted/30 rounded-lg border border-border/50">
                    <button
                        onClick={() => onZoomChange(0)}
                        className={clsx(
                            "p-1 rounded-md transition-all",
                            zoomLevel === 0 ? "bg-background shadow-sm text-accent" : "text-muted-foreground hover:text-foreground"
                        )}
                        title={t("session.board.controls.pixelView")}
                        aria-label={t("session.board.controls.pixelView")}
                    >
                        <Layout className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onZoomChange(1)}
                        className={clsx(
                            "p-1 rounded-md transition-all",
                            zoomLevel === 1 ? "bg-background shadow-sm text-accent" : "text-muted-foreground hover:text-foreground"
                        )}
                        title={t("session.board.controls.skimView")}
                        aria-label={t("session.board.controls.skimView")}
                    >
                        <Layers className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onZoomChange(2)}
                        className={clsx(
                            "p-1 rounded-md transition-all",
                            zoomLevel === 2 ? "bg-background shadow-sm text-accent" : "text-muted-foreground hover:text-foreground"
                        )}
                        title={t("session.board.controls.readView")}
                        aria-label={t("session.board.controls.readView")}
                    >
                        <Eye className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-4">
                {/* Brushing Dropdowns */}
                <div className="hidden lg:flex items-center gap-1.5">
                    <Filter className="w-3 h-3 text-muted-foreground mr-0.5" />
                    
                    <Select
                        value={activeBrush?.type === 'tool' ? activeBrush.value : ""}
                        onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'tool', value: v })}
                    >
                        <SelectTrigger className="h-7 w-32 text-[10px] bg-muted/20 border-border/30 px-2">
                            <SelectValue placeholder={t("session.board.controls.tool")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">{t("session.board.controls.all")}</SelectItem>
                            {toolOptions.map(toolOption => (
                                <SelectItem
                                    key={toolOption}
                                    value={toolOption}
                                    className="text-[10px]"
                                    disabled={availableTools ? !availableTools.includes(toolOption) : false}
                                >
                                    {t(toolOption.toUpperCase())}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* MCP with hierarchical flyout */}
                    {mcpServerOptions.length > 0 && (
                        <Select
                            value={activeBrush?.type === 'mcp' ? activeBrush.value : ""}
                            onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'mcp', value: v })}
                        >
                            <SelectTrigger className="h-7 w-32 text-[10px] bg-muted/20 border-border/30 px-2">
                                <SelectValue placeholder={t("session.board.controls.mcp")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">{t("session.board.controls.all")}</SelectItem>
                                <SelectItem value="all" className="text-[10px]" disabled={availableMcpServers.length === 0}>{t("session.board.controls.allMcp")}</SelectItem>
                                {mcpServerOptions.map(server => (
                                    <SelectItem
                                        key={server}
                                        value={server}
                                        className="text-[10px] pl-6"
                                        disabled={availableMcpServers ? !availableMcpServers.includes(server) : false}
                                    >
                                        {server}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {/* Commands with hierarchical flyout */}
                    {shellCommandOptions.length > 0 && (
                        <Select
                            value={activeBrush?.type === 'command' ? activeBrush.value : ""}
                            onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'command', value: v })}
                        >
                            <SelectTrigger className="h-7 w-32 text-[10px] bg-muted/20 border-border/30 px-2">
                                <SelectValue placeholder={t("session.board.controls.command")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">{t("session.board.controls.all")}</SelectItem>
                                <SelectItem value="all" className="text-[10px]" disabled={availableShellCommands.length === 0}>{t("session.board.controls.allCommands")}</SelectItem>
                                {shellCommandOptions.slice(0, 20).map(cmd => (
                                    <SelectItem
                                        key={cmd}
                                        value={cmd}
                                        className="text-[10px] pl-6 font-mono"
                                        disabled={availableShellCommands ? !availableShellCommands.includes(cmd) : false}
                                    >
                                        {cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {/* Hooks toggle */}
                    {shellCommandOptions.length > 0 && (
                        <button
                            onClick={() => onBrushChange(activeBrush?.type === 'hook' ? null : { type: 'hook', value: 'true' })}
                            className={clsx(
                                "h-7 px-2 text-[10px] rounded-md border transition-all",
                                activeBrush?.type === 'hook' 
                                    ? "bg-accent text-accent-foreground border-accent" 
                                    : "bg-muted/20 border-border/30 hover:bg-muted/40"
                            )}
                            disabled={availableShellCommands.length === 0}
                        >
                            {t("session.board.controls.hooks")}
                        </button>
                    )}

                    <Select
                        value={activeBrush?.type === 'file' ? activeBrush.value : ""}
                        onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'file', value: v })}
                    >
                        <SelectTrigger className="h-7 w-40 text-[10px] bg-muted/20 border-border/30 px-2">
                            <SelectValue placeholder={t("session.board.controls.file")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">{t("session.board.controls.all")}</SelectItem>
                            {fileOptions.map(f => (
                                <SelectItem
                                    key={f}
                                    value={f}
                                    className="text-[10px]"
                                    disabled={availableFiles ? !availableFiles.includes(f) : false}
                                >
                                    {t(f.split(/[\\/]/).pop() || "")}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Date Filter */}
                {dateFilter && setDateFilter && (
                    <DatePickerHeader
                        dateFilter={dateFilter}
                        setDateFilter={setDateFilter}
                    />
                )}

                <div className="flex items-center gap-2">
                    {activeBrush && stickyBrush && (
                        <div className="bg-accent/10 p-1 rounded">
                            <Lock className="w-3 h-3 fill-accent text-accent" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
