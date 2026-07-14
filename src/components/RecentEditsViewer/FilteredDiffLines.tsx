/**
 * FilteredDiffLines Component
 *
 * Renders only the added (or only the removed) lines of an edit as
 * git-style hunks, used by the +N / -N filtered views in FileEditItem.
 */

"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import type { DiffLineGroup } from "./diffUtils";

interface FilteredDiffLinesProps {
  groups: DiffLineGroup[];
  kind: "added" | "removed";
}

export const FilteredDiffLines = ({ groups, kind }: FilteredDiffLinesProps) => {
  const { t } = useTranslation();
  const isAdded = kind === "added";

  if (groups.length === 0) {
    return (
      <div className={`p-4 text-center text-muted-foreground ${layout.smallText}`}>
        {t("recentEdits.noLinesToShow")}
      </div>
    );
  }

  return (
    <pre
      className="font-mono"
      style={{
        fontSize: "calc(0.8125rem * var(--app-font-scale))",
        lineHeight: "1.25rem",
        padding: "0.75rem",
      }}
    >
      {groups.map((group, groupIndex) => (
        <div key={`${group.startLine}-${groupIndex}`}>
          {groupIndex > 0 && (
            <div className="text-muted-foreground select-none px-2" aria-hidden="true">
              ⋯
            </div>
          )}
          {group.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              className={cn(
                "flex",
                isAdded
                  ? "bg-green-50 dark:bg-green-950/40"
                  : "bg-red-50 dark:bg-red-950/40"
              )}
            >
              <span className="w-12 shrink-0 text-right pr-3 select-none text-muted-foreground">
                {group.startLine + lineIndex}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 select-none",
                  isAdded
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {isAdded ? "+" : "-"}
              </span>
              <span className="whitespace-pre-wrap break-all flex-1">{line}</span>
            </div>
          ))}
        </div>
      ))}
    </pre>
  );
};

FilteredDiffLines.displayName = "FilteredDiffLines";
