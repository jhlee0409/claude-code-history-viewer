import React, { useCallback } from "react";
import { Bot, ChevronRight, GitBranch, Wrench, Zap, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getKindLabelKey } from "../kindLabels";
import { KIND_STYLES } from "../kindStyles";
import { getTurnHeaderLabel } from "./turnHeaderLabel";
import type { TurnGroup } from "./types";

interface CountChipProps {
  icon: LucideIcon;
  count: number;
  label: string;
  className?: string;
}

const CountChip: React.FC<CountChipProps> = ({ icon: Icon, count, label, className }) => {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={label}>
      <Icon className={cn("w-3 h-3", className)} aria-hidden="true" />
      <span aria-hidden="true" className="text-2xs tabular-nums">
        {count}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
};

interface OutlineTurnHeaderProps {
  turn: TurnGroup;
  isOpen: boolean;
  isActive: boolean;
  isFocused: boolean;
  hasMore: boolean;
  totalTurns: number;
  onActivate: () => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  registerRef: (element: HTMLButtonElement | null) => void;
  style?: React.CSSProperties;
  dataIndex: number;
  ariaPosInSet: number;
  ariaSetSize: number;
}

export const OutlineTurnHeader = React.memo<OutlineTurnHeaderProps>(({
  turn,
  isOpen,
  isActive,
  isFocused,
  hasMore,
  totalTurns,
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

  const labelText = getTurnHeaderLabel(turn, hasMore, totalTurns, t);
  const header = turn.header;
  const kindStyle = header ? (KIND_STYLES[header.kind] ?? KIND_STYLES.system) : null;
  const kindLabel = header ? t(getKindLabelKey(header.kind)) : "";
  const formattedTime = header?.timestamp
    ? new Date(header.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const { counts } = turn;
  const hasAnyCounts =
    counts.replies > 0 || counts.toolCalls > 0 || counts.agentsStarted > 0 || counts.agentUpdates > 0;

  return (
    <button
      type="button"
      ref={registerRef}
      data-index={dataIndex}
      tabIndex={isFocused ? 0 : -1}
      role="treeitem"
      aria-level={1}
      aria-expanded={isOpen}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      aria-selected={isActive}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "w-full text-left px-3 py-2 cursor-pointer border-l-2 transition-colors outline-none",
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
        <ChevronRight
          className={cn(
            "w-3 h-3 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-foreground truncate flex-1">{labelText}</span>
        {formattedTime && (
          <span className="shrink-0 text-2xs text-muted-foreground/60">{formattedTime}</span>
        )}
      </div>
      {header && (
        <p
          className={cn(
            "text-xs line-clamp-2 leading-relaxed mb-1",
            header.preview ? kindStyle?.textClass : "text-muted-foreground italic",
          )}
        >
          {header.preview || kindLabel}
        </p>
      )}
      {hasAnyCounts && (
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <CountChip
            icon={Bot}
            count={counts.replies}
            label={t("navigator.outline.replies", { count: counts.replies })}
            className="text-warning"
          />
          <CountChip
            icon={Wrench}
            count={counts.toolCalls}
            label={t("navigator.outline.toolCalls", { count: counts.toolCalls })}
          />
          <CountChip
            icon={GitBranch}
            count={counts.agentsStarted}
            label={t("navigator.outline.agentsStarted", { count: counts.agentsStarted })}
            className="text-tool-task"
          />
          <CountChip
            icon={Zap}
            count={counts.agentUpdates}
            label={t("navigator.outline.agentUpdates", { count: counts.agentUpdates })}
            className="text-tool-task"
          />
        </div>
      )}
    </button>
  );
});

OutlineTurnHeader.displayName = "OutlineTurnHeader";
