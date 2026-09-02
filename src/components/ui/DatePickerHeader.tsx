import { useEffect, useState } from "react";
import { Calendar, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface DateFilter {
    start: Date | null;
    end: Date | null;
}

interface DatePickerProps {
    dateFilter: DateFilter;
    setDateFilter: (filter: DateFilter) => void;
    className?: string;
}

const formatDateForInput = (date: Date | null) => {
    if (!date) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const INPUT_CLASS =
    "bg-transparent text-px10 font-mono text-foreground outline-none border-b border-transparent focus:border-accent w-24 min-h-[36px] dark:[color-scheme:dark]";

/**
 * Date range filter for analytics views.
 *
 * With no bounds set the data is unfiltered, so the control says "All time"
 * instead of showing empty native date inputs — WebKit paints today's date as
 * the placeholder of an empty `<input type=date>`, which read as "today only"
 * while the cards showed all-time totals.
 */
export const DatePickerHeader = ({
    dateFilter,
    setDateFilter,
    className
}: DatePickerProps) => {
    const { t } = useTranslation();
    const hasFilter = !!(dateFilter.start || dateFilter.end);
    const [isEditing, setIsEditing] = useState(hasFilter);
    // A filter set elsewhere (e.g. calendar click) opens the inputs; a filter
    // cleared elsewhere (project switch, timeline reset) returns to "All time".
    useEffect(() => {
        setIsEditing(hasFilter);
    }, [hasFilter]);

    const handleDateChange = (type: 'start' | 'end', value: string) => {
        if (!value) {
            setDateFilter({ ...dateFilter, [type]: null });
            return;
        }

        const [y, m, d] = value.split('-').map(Number);
        if (!y || !m || !d) return;

        const localDate = new Date(y, m - 1, d);
        const nextFilter: DateFilter = {
            start: type === 'start' ? localDate : dateFilter.start,
            end: type === 'end' ? localDate : dateFilter.end,
        };

        // Prevent invalid ranges: keep start <= end at all times.
        if (type === 'start' && nextFilter.end && localDate > nextFilter.end) {
            nextFilter.end = new Date(localDate);
        }
        if (type === 'end' && nextFilter.start && localDate < nextFilter.start) {
            nextFilter.start = new Date(localDate);
        }

        setDateFilter(nextFilter);
    };

    const clearDateFilter = () => {
        setDateFilter({ start: null, end: null });
        setIsEditing(false);
    };

    return (
        <div className={cn("flex items-center gap-1.5 bg-muted/30 p-0.5 rounded-lg border border-border/50", className)} >
            <div className="flex items-center gap-1.5 px-1.5 border-r border-border/50 pr-2">
                <Calendar className="w-3 h-3 text-muted-foreground" />
                <span className="text-px10 font-bold text-muted-foreground uppercase tracking-wide">
                    {t("common.dateFilter.label")}
                </span>
            </div>

            {isEditing ? (
                <div className="flex items-center gap-1.5">
                    <input
                        type="date"
                        aria-label={t("common.dateFilter.start")}
                        className={INPUT_CLASS}
                        value={formatDateForInput(dateFilter.start)}
                        max={formatDateForInput(dateFilter.end)}
                        onChange={(e) => handleDateChange('start', e.target.value)}
                    />
                    <span className="text-muted-foreground text-px10">-</span>
                    <input
                        type="date"
                        aria-label={t("common.dateFilter.end")}
                        className={INPUT_CLASS}
                        value={formatDateForInput(dateFilter.end)}
                        min={formatDateForInput(dateFilter.start)}
                        onChange={(e) => handleDateChange('end', e.target.value)}
                    />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    title={t("common.dateFilter.pickRange")}
                    className="px-2 min-h-[36px] text-px10 font-mono text-foreground hover:text-accent transition-colors"
                >
                    {t("common.dateFilter.allTime")}
                </button>
            )}

            {(hasFilter || isEditing) && (
                <button
                    type="button"
                    onClick={clearDateFilter}
                    aria-label={t("common.dateFilter.clear")}
                    title={t("common.dateFilter.clear")}
                    className="ml-1 p-1 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-full transition-colors"
                >
                    <XCircle className="w-3.5 h-3.5" />
                </button>
            )}
        </div >
    );
};
