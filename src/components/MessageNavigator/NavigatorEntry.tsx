import React, { useCallback } from "react";
import {
  BookOpen,
  Bot,
  Info,
  ScrollText,
  SquareSlash,
  User,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MessageKind } from "../MessageViewer/helpers/messageKinds";
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

interface KindStyle {
  icon: LucideIcon;
  /** Icon color */
  iconClass: string;
  /** Preview text weight; typed prompts read strongest, injected rows weakest */
  textClass: string;
  labelKey:
    | "navigator.kind.prompt"
    | "navigator.kind.command"
    | "navigator.kind.agentUpdate"
    | "navigator.kind.context"
    | "navigator.kind.reply"
    | "navigator.kind.tool"
    | "navigator.kind.system"
    | "navigator.kind.summary";
}

const KIND_STYLES: Record<MessageKind, KindStyle> = {
  prompt: { icon: User, iconClass: "text-info", textClass: "text-foreground font-medium", labelKey: "navigator.kind.prompt" },
  command: { icon: SquareSlash, iconClass: "text-info", textClass: "text-foreground/80 font-mono", labelKey: "navigator.kind.command" },
  "agent-update": { icon: Zap, iconClass: "text-tool-task", textClass: "text-foreground/80", labelKey: "navigator.kind.agentUpdate" },
  context: { icon: BookOpen, iconClass: "text-muted-foreground", textClass: "text-muted-foreground italic", labelKey: "navigator.kind.context" },
  reply: { icon: Bot, iconClass: "text-warning", textClass: "text-foreground/80", labelKey: "navigator.kind.reply" },
  tool: { icon: Wrench, iconClass: "text-muted-foreground", textClass: "text-muted-foreground", labelKey: "navigator.kind.tool" },
  system: { icon: Info, iconClass: "text-muted-foreground", textClass: "text-muted-foreground", labelKey: "navigator.kind.system" },
  summary: { icon: ScrollText, iconClass: "text-tool-mcp", textClass: "text-foreground/80", labelKey: "navigator.kind.summary" },
};

const FAILED_STATUSES = new Set(["failed", "error", "killed"]);

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

  const kindStyle = KIND_STYLES[entry.kind] ?? KIND_STYLES.system;
  const KindIcon = kindStyle.icon;
  const kindLabel = t(kindStyle.labelKey);
  const isFailed = entry.status != null && FAILED_STATUSES.has(entry.status);

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
