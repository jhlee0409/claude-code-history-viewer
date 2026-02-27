import React, { useCallback } from "react";
import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
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
}

const ROLE_STYLES = {
  user: { dot: "bg-blue-500" },
  assistant: { dot: "bg-amber-500" },
  system: { dot: "bg-gray-400" },
  summary: { dot: "bg-purple-400" },
} as const;

export const NavigatorEntry = React.memo<NavigatorEntryProps>(({
  entry,
  isActive,
  isFocused,
  onClick,
  onFocus,
  onNavigate,
  registerRef,
  style,
}) => {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onClick(entry.uuid), [onClick, entry.uuid]);

  const roleStyle = ROLE_STYLES[entry.role] || ROLE_STYLES.system;
  const roleLabel = t(`navigator.role.${entry.role}`, { defaultValue: entry.role });

  const formattedTime = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <button
      type="button"
      ref={registerRef}
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        "w-full text-left px-3 py-2 cursor-pointer border-l-2 transition-colors outline-none",
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
      role="option"
      aria-selected={isActive}
      aria-current={isActive ? "true" : undefined}
      aria-label={t("navigator.a11y.entryLabel", {
        role: roleLabel,
        turnIndex: entry.turnIndex,
        defaultValue: `${roleLabel} message ${entry.turnIndex}`,
      })}
    >
      {/* Header row: role dot + turn label + time + tool icon */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={cn("w-2 h-2 rounded-full shrink-0", roleStyle.dot)} />
        <span className="text-2xs font-medium text-muted-foreground">
          #{entry.turnIndex}
        </span>
        {entry.hasToolUse && (
          <Wrench className="w-2.5 h-2.5 text-muted-foreground/60" />
        )}
        <span className="ml-auto text-2xs text-muted-foreground/60">
          {formattedTime}
        </span>
      </div>
      {/* Preview text */}
      <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
        {entry.preview}
      </p>
    </button>
  );
});

NavigatorEntry.displayName = "NavigatorEntry";
