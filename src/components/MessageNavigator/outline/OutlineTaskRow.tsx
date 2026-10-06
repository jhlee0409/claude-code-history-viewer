import React, { useCallback } from "react";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isFailedTaskStatus } from "../../MessageViewer/helpers/messageKinds";
import { OUTLINE_CHILD_INDENT_CLASS } from "./childRowStyles";
import type { OutlineTaskChild } from "./types";

/**
 * i18n keys that already label a task-notification status elsewhere in the
 * app (`TaskNotificationRenderer`'s own status pills). Reused here rather
 * than duplicated (Build: "reuse it"). A status with no mapped key, such as
 * "killed" or "stopped", falls back to its own raw value, the same way an
 * unmapped summary already shows as data straight from the transcript.
 */
const STATUS_LABEL_KEYS: Partial<Record<string, string>> = {
  completed: "taskNotification.status.completed",
  failed: "taskNotification.status.failed",
  running: "taskNotification.status.running",
};

interface OutlineTaskRowProps {
  task: OutlineTaskChild;
  /** True when the navigation target is one of the rows holding this task's updates. */
  isActive: boolean;
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
  isActive,
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
  const statusKey = task.status ? STATUS_LABEL_KEYS[task.status] : undefined;
  const statusLabel = task.status ? (statusKey ? t(statusKey) : task.status) : undefined;
  const subtitle = statusLabel ? `${updatesText} · ${statusLabel}` : updatesText;
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
      aria-selected={isActive}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "w-full text-left py-2 cursor-pointer border-l-2 transition-colors outline-none",
        OUTLINE_CHILD_INDENT_CLASS,
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        "hover:bg-accent/10",
        isActive ? "border-l-accent bg-accent/5" : "border-l-transparent",
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
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </button>
  );
});

OutlineTaskRow.displayName = "OutlineTaskRow";
