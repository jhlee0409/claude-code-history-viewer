import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils";

/** A scoped initial-load placeholder, not a live announcement or empty result. */
export function LoadingRows({ label, compact = false, className }: {
  label: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} aria-busy="true" className={cn("p-4", className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={compact ? "space-y-2" : "space-y-6"}>
        {[0, 1, 2].map((row) => (
          <div key={row} className={compact ? "flex items-center gap-2 h-7" : "space-y-3"}>
            <Skeleton className={compact ? "h-4 w-4 shrink-0" : "h-4 w-1/4"} />
            <Skeleton className={compact ? "h-3 w-3/5" : "h-4 w-4/5"} />
            {!compact && <Skeleton className="h-4 w-3/5" />}
          </div>
        ))}
      </div>
    </div>
  );
}
