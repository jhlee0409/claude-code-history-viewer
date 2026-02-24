import { Calendar, XCircle } from "lucide-react";
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

export const DatePickerHeader = ({
    dateFilter,
    setDateFilter,
    className
}: DatePickerProps) => {

    const formatDateForInput = (date: Date | null) => {
        if (!date) return "";
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const handleDateChange = (type: 'start' | 'end', value: string) => {
        if (!value) {
            setDateFilter({
                ...dateFilter,
                [type]: null
            });
            return;
        }

        const [y, m, d] = value.split('-').map(Number);
        if (!y || !m || !d) return;

        const localDate = new Date(y, m - 1, d);
        const nextFilter: DateFilter = {
            ...dateFilter,
            [type]: localDate
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
    };

    const hasFilter = dateFilter.start || dateFilter.end;

    return (
        <div className={cn("flex items-center gap-1.5 bg-muted/30 p-0.5 rounded-lg border border-border/50", className)} >
            <div className="flex items-center gap-1.5 px-1.5 border-r border-border/50 pr-2">
                <Calendar className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Filter</span>
            </div>

            <div className="flex items-center gap-1.5">
                <input
                    type="date"
                    className="bg-transparent text-[10px] font-mono text-foreground outline-none border-b border-transparent focus:border-accent w-24 dark:[color-scheme:dark]"
                    value={formatDateForInput(dateFilter.start)}
                    max={formatDateForInput(dateFilter.end)}
                    onChange={(e) => handleDateChange('start', e.target.value)}
                />
                <span className="text-muted-foreground text-[10px]">-</span>
                <input
                    type="date"
                    className="bg-transparent text-[10px] font-mono text-foreground outline-none border-b border-transparent focus:border-accent w-24 dark:[color-scheme:dark]"
                    value={formatDateForInput(dateFilter.end)}
                    min={formatDateForInput(dateFilter.start)}
                    onChange={(e) => handleDateChange('end', e.target.value)}
                />
            </div>

            {hasFilter && (
                <button
                    onClick={clearDateFilter}
                    className="ml-1 p-1 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-full transition-colors"
                >
                    <XCircle className="w-3.5 h-3.5" />
                </button>
            )}
        </div >
    );
};
