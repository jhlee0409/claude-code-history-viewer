import React, { useCallback } from "react";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isFailedTaskStatus } from "../../MessageViewer/helpers/messageKinds";
import type { OutlineTaskChild } from "./types";

interface OutlineTaskRowProps {
  task: OutlineTaskChild;
  isFocused: boolean;
  onActivate: () => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  registerRef: (element: HTMLButtonElement | null) => void;
  style?: React.CSSProperties;
  dataIndex: number;
  ariaPosInSet: number;
  ariaSetSize: number;
}

export const OutlineTaskRow = React.memo<OutlineTaskRowProps>(({
  task,
  isFocused,
  onActivate,
  onFocus,
  onKeyDown,
  registerRef,
  style,
  dataIndex,
  ariaPosInSet,
  ariaSetSize,
}) => {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onActivate(), [onActivate]);

  const isFailed = isFailedTaskStatus(task.status);
  const label =
    task.label ?? t("navigator.outline.taskUnnamed", { id: (task.taskId ?? "").slice(0, 8) });
  const updatesText = t("navigator.outline.taskUpdates", { count: task.updateCount });
  const formattedTime = task.timestamp
    ? new Date(task.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <button
      type="button"
      ref={registerRef}
      data-index={dataIndex}
      tabIndex={isFocused ? 0 : -1}
      role="treeitem"
      aria-level={2}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      className={cn(
        "w-full text-left pl-7 pr-3 py-2 cursor-pointer border-l-2 border-l-transparent transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        "hover:bg-accent/10",
      )}
      style={style}
      onClick={handleClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <Zap
          className={cn("w-3 h-3 shrink-0", isFailed ? "text-destructive" : "text-tool-task")}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-foreground/80 truncate flex-1">{label}</span>
        {formattedTime && (
          <span className="shrink-0 text-2xs text-muted-foreground/60">{formattedTime}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{updatesText}</p>
    </button>
  );
});

OutlineTaskRow.displayName = "OutlineTaskRow";
