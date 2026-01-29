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
import React from "react";
import { DatePickerHeader } from "../ui/DatePickerHeader";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface BoardControlsProps {
    zoomLevel: ZoomLevel;
    onZoomChange: (level: ZoomLevel) => void;
    activeBrush: ActiveBrush | null;
    stickyBrush?: boolean;
    onBrushChange: (brush: ActiveBrush | null) => void;
    modelOptions?: string[];
    statusOptions?: string[];
    toolOptions?: string[];
    fileOptions?: string[];
    availableModels?: string[];
    availableStatuses?: string[];
    availableTools?: string[];
    availableFiles?: string[];
    dateFilter?: DateFilter;
    setDateFilter?: (filter: DateFilter) => void;
}

export const BoardControls = ({
    zoomLevel,
    onZoomChange,
    activeBrush,
    stickyBrush = false,
    onBrushChange,
    modelOptions = [],
    statusOptions = [],
    toolOptions = [],
    fileOptions = [],
    availableModels,
    availableStatuses,
    availableTools,
    availableFiles,
    dateFilter,
    setDateFilter
}: BoardControlsProps) => {




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
                        title="Pixel View (Scroll Down in header)"
                    >
                        <Layout className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onZoomChange(1)}
                        className={clsx(
                            "p-1 rounded-md transition-all",
                            zoomLevel === 1 ? "bg-background shadow-sm text-accent" : "text-muted-foreground hover:text-foreground"
                        )}
                        title="Skim View"
                    >
                        <Layers className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onZoomChange(2)}
                        className={clsx(
                            "p-1 rounded-md transition-all",
                            zoomLevel === 2 ? "bg-background shadow-sm text-accent" : "text-muted-foreground hover:text-foreground"
                        )}
                        title="Read View (Scroll Up in header)"
                    >
                        <Eye className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-4">
                {/* Brushing Dropdowns (Step 8) */}
                <div className="hidden lg:flex items-center gap-1.5">
                    <Filter className="w-3 h-3 text-muted-foreground mr-0.5" />
                    <Select
                        value={activeBrush?.type === 'model' ? activeBrush.value : ""}
                        onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'model', value: v })}
                    >
                        <SelectTrigger className="h-7 w-32 text-[10px] bg-muted/20 border-border/30 px-2">
                            <SelectValue placeholder="MODEL" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">ALL</SelectItem>
                            {modelOptions.map(r => (
                                <SelectItem
                                    key={r}
                                    value={r}
                                    className="text-[10px]"
                                    disabled={availableModels ? !availableModels.includes(r) : false}
                                >
                                    {r.toUpperCase()}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={activeBrush?.type === 'status' ? activeBrush.value : ""}
                        onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'status', value: v })}
                    >
                        <SelectTrigger className="h-7 w-28 text-[10px] bg-muted/20 border-border/30 px-2">
                            <SelectValue placeholder="STATUS" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">ALL</SelectItem>
                            {statusOptions.map(s => (
                                <SelectItem
                                    key={s}
                                    value={s}
                                    className="text-[10px]"
                                    disabled={availableStatuses ? !availableStatuses.includes(s) : false}
                                >
                                    {s.toUpperCase()}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={activeBrush?.type === 'tool' ? activeBrush.value : ""}
                        onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'tool', value: v })}
                    >
                        <SelectTrigger className="h-7 w-32 text-[10px] bg-muted/20 border-border/30 px-2">
                            <SelectValue placeholder="TOOL" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">ALL</SelectItem>
                            {toolOptions.map(t => (
                                <SelectItem
                                    key={t}
                                    value={t}
                                    className="text-[10px]"
                                    disabled={availableTools ? !availableTools.includes(t) : false}
                                >
                                    {t.toUpperCase()}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={activeBrush?.type === 'file' ? activeBrush.value : ""}
                        onValueChange={(v) => onBrushChange(v === '_ALL_' ? null : { type: 'file', value: v })}
                    >
                        <SelectTrigger className="h-7 w-40 text-[10px] bg-muted/20 border-border/30 px-2">
                            <SelectValue placeholder="FILE" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_ALL_" className="text-[10px] font-bold text-muted-foreground">ALL</SelectItem>
                            {fileOptions.map(f => (
                                <SelectItem
                                    key={f}
                                    value={f}
                                    className="text-[10px]"
                                    disabled={availableFiles ? !availableFiles.includes(f) : false}
                                >
                                    {f.split('/').pop()}
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
