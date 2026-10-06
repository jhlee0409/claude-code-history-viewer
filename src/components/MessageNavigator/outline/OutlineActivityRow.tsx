import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getKindLabelKey } from "../kindLabels";
import { KIND_STYLES } from "../kindStyles";
import { OUTLINE_CHILD_INDENT_CLASS } from "./childRowStyles";
import type { OutlineActivityChild } from "./types";

interface OutlineActivityRowProps {
  activity: OutlineActivityChild;
  /** True when the navigation target is one of the rows this row collapses. */
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

/**
 * The single row an open turn shows for every collapsed reply, tool call,
 * injected context, system row, and local command output (Design, "Activity
 * summary row"). Mirrors `OutlineTaskRow`'s shape: a one-line preview, a
 * subtitle, and the same roving-focus / activation contract.
 */
export const OutlineActivityRow = React.memo<OutlineActivityRowProps>(({
  activity,
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

  // The same icon list mode uses for a reply row (Build: "a bot icon, the
  // same icon list mode uses for replies").
  const ReplyIcon = KIND_STYLES.reply.icon;

  const subtitleParts = [t("messageViewer.claude")];
  if (activity.replies > 0) {
    subtitleParts.push(t("navigator.outline.replies", { count: activity.replies }));
  }
  if (activity.toolCalls > 0) {
    subtitleParts.push(t("navigator.outline.toolCalls", { count: activity.toolCalls }));
  }
  const subtitle = subtitleParts.join(" · ");

  const formattedTime = activity.timestamp
    ? new Date(activity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
        <ReplyIcon className={cn("w-3 h-3 shrink-0", KIND_STYLES.reply.iconClass)} aria-hidden="true" />
        <span className="text-xs font-medium text-foreground/80 truncate flex-1">
          {activity.preview || t(getKindLabelKey(activity.previewKind))}
        </span>
        {formattedTime && (
          <span className="shrink-0 text-2xs text-muted-foreground/60">{formattedTime}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
    </button>
  );
});

OutlineActivityRow.displayName = "OutlineActivityRow";
