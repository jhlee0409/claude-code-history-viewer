import React, { useCallback } from "react";
import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isFailedTaskStatus } from "../MessageViewer/helpers/messageKinds";
import { getKindLabelKey } from "./kindLabels";
import { KIND_STYLES } from "./kindStyles";
import { OUTLINE_CHILD_INDENT_CLASS } from "./outline/childRowStyles";
import type { NavigatorEntryData } from "./types";

interface NavigatorEntryProps {
  entry: NavigatorEntryData;
  isActive: boolean;
  isFocused: boolean;
  onClick: (uuid: string) => void;
  onFocus: () => void;
  onNavigate: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  registerRef: (element: HTMLButtonElement | null) => void;
  style?: React.CSSProperties;
  /** Tree semantics for the outline; list mode omits these and keeps today's "option" role. */
  itemRole?: "option" | "treeitem";
  ariaLevel?: number;
  ariaPosInSet?: number;
  ariaSetSize?: number;
  /** The outline's virtualizer reads this via `measureElement`'s `indexFromElement`; list mode omits it (no dynamic remeasurement there). */
  dataIndex?: number;
}

export const NavigatorEntry = React.memo<NavigatorEntryProps>(({
  entry,
  isActive,
  isFocused,
  onClick,
  onFocus,
  onNavigate,
  registerRef,
  style,
  itemRole = "option",
  ariaLevel,
  ariaPosInSet,
  ariaSetSize,
  dataIndex,
}) => {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onClick(entry.uuid), [onClick, entry.uuid]);

  const kindStyle = KIND_STYLES[entry.kind] ?? KIND_STYLES.system;
  const KindIcon = kindStyle.icon;
  const kindLabel = t(getKindLabelKey(entry.kind));
  const isFailed = isFailedTaskStatus(entry.status);
  // Only the outline's level-2 children get the shared rail (Design,
  // "Indent every child under a rail"); list mode's "option" rows are
  // unaffected (spec acceptance 15: the accessibility test stays unchanged).
  const isOutlineChild = itemRole === "treeitem" && ariaLevel === 2;

  const formattedTime = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <button
      type="button"
      ref={registerRef}
      data-index={dataIndex}
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        "w-full text-left py-2 cursor-pointer border-l-2 transition-colors outline-none",
        isOutlineChild ? OUTLINE_CHILD_INDENT_CLASS : "px-3",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        "hover:bg-accent/10",
        isActive
          ? "border-l-accent bg-accent/5"
          : "border-l-transparent"
      )}
      style={style}
      onClick={handleClick}
      onFocus={onFocus}
      onKeyDown={onNavigate}
      role={itemRole}
      aria-selected={isActive}
      aria-current={isActive ? "true" : undefined}
      aria-level={ariaLevel}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      aria-label={t("navigator.a11y.entryLabel", {
        role: kindLabel,
        turnIndex: entry.turnIndex,
        defaultValue: `${kindLabel} message ${entry.turnIndex}`,
      })}
    >
      {/* Header row: kind icon + turn label + tool icon + time */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span title={kindLabel} className="shrink-0 inline-flex">
          <KindIcon
            className={cn("w-3 h-3", isFailed ? "text-destructive" : kindStyle.iconClass)}
            aria-hidden="true"
          />
        </span>
        <span className="text-2xs font-medium text-muted-foreground">
          #{entry.turnIndex}
        </span>
        {entry.hasToolUse && entry.kind !== "tool" && (
          <Wrench className="w-2.5 h-2.5 text-muted-foreground/60" aria-hidden="true" />
        )}
        <span className="ml-auto text-2xs text-muted-foreground/60">
          {formattedTime}
        </span>
      </div>
      {/* Preview text; rows without text show their kind instead */}
      <p
        className={cn(
          "text-xs line-clamp-2 leading-relaxed",
          entry.preview ? kindStyle.textClass : "text-muted-foreground italic"
        )}
      >
        {entry.preview || kindLabel}
      </p>
    </button>
  );
});

NavigatorEntry.displayName = "NavigatorEntry";
