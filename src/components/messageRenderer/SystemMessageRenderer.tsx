import { memo } from "react";
import {
  Info,
  AlertTriangle,
  AlertCircle,
  Terminal,
  StopCircle,
  Clock,
  Minimize2,
  Webhook,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandRenderer } from "../contentRenderer";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

// Hook info structure
interface HookInfo {
  command: string;
  output?: string;
  error?: string;
}

// Compact metadata structure
interface CompactMetadata {
  trigger?: string;
  preTokens?: number;
}

type SystemSubtype = "stop_hook_summary" | "turn_duration" | "compact_boundary" | "microcompact_boundary" | "local_command";

type Props = {
  content?: string;
  subtype?: string;
  level?: "info" | "warning" | "error" | "suggestion";
  // stop_hook_summary fields
  hookCount?: number;
  hookInfos?: HookInfo[];
  stopReason?: string;
  preventedContinuation?: boolean;
  // turn_duration fields
  durationMs?: number;
  // compact_boundary fields
  compactMetadata?: CompactMetadata;
  // microcompact_boundary fields
  microcompactMetadata?: CompactMetadata;
};

const LEVEL_CONFIG = {
  info: {
    icon: Info,
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
    borderColor: "border-border",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-warning-foreground",
    bgColor: "bg-warning/10",
    borderColor: "border-warning/30",
  },
  error: {
    icon: AlertCircle,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/30",
  },
  suggestion: {
    icon: Info,
    color: "text-info",
    bgColor: "bg-info/10",
    borderColor: "border-info/30",
  },
};

const SUBTYPE_CONFIG: Record<SystemSubtype, { icon: typeof Info; color: string; bgColor: string; borderColor: string }> = {
  stop_hook_summary: {
    icon: StopCircle,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/30",
  },
  turn_duration: {
    icon: Clock,
    color: "text-info",
    bgColor: "bg-info/10",
    borderColor: "border-info/30",
  },
  compact_boundary: {
    icon: Minimize2,
    color: "text-tool-system",
    bgColor: "bg-tool-system/10",
    borderColor: "border-tool-system/30",
  },
  microcompact_boundary: {
    icon: Minimize2,
    color: "text-tool-system",
    bgColor: "bg-tool-system/10",
    borderColor: "border-tool-system/30",
  },
  local_command: {
    icon: Terminal,
    color: "text-tool-terminal",
    bgColor: "bg-tool-terminal/10",
    borderColor: "border-tool-terminal/30",
  },
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

export const SystemMessageRenderer = memo(function SystemMessageRenderer({
  content,
  subtype,
  level = "info",
  hookCount,
  hookInfos,
  stopReason,
  preventedContinuation,
  durationMs,
  compactMetadata,
  microcompactMetadata,
}: Props) {
  const { t } = useTranslation("components");

  const subtypeKey = subtype as SystemSubtype;
  const config = SUBTYPE_CONFIG[subtypeKey] || LEVEL_CONFIG[level] || LEVEL_CONFIG.info;
  const Icon = config.icon;

  const getSubtypeLabel = (sub?: string): string => {
    if (!sub) return t("systemMessageRenderer.title", { defaultValue: "System" });
    const labels: Record<string, string> = {
      stop_hook_summary: t("systemMessageRenderer.subtypes.stopHook", { defaultValue: "Stop Hook" }),
      turn_duration: t("systemMessageRenderer.subtypes.turnDuration", { defaultValue: "Turn Duration" }),
      compact_boundary: t("systemMessageRenderer.subtypes.compactBoundary", { defaultValue: "Conversation Compacted" }),
      microcompact_boundary: t("systemMessageRenderer.subtypes.microcompactBoundary", { defaultValue: "Context Microcompacted" }),
      local_command: t("systemMessageRenderer.subtypes.localCommand", { defaultValue: "Local Command" }),
    };
    return labels[sub] || sub;
  };

  // Handle stop_hook_summary
  if (subtype === "stop_hook_summary") {
    return (
      <div className={cn(`${config.bgColor} border-2 ${config.borderColor} ${layout.smallText}`, layout.rounded, layout.containerPadding)}>
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <Icon className={cn(layout.iconSize, config.color)} />
            <span className={`font-bold ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
            {preventedContinuation && (
              <span className={`px-1.5 py-0.5 rounded ${layout.smallText} bg-destructive/20 text-destructive font-medium`}>
                {t("systemMessageRenderer.prevented", { defaultValue: "Prevented" })}
              </span>
            )}
          </div>
          {hookCount !== undefined && hookCount > 0 && (
            <span className="text-muted-foreground font-medium">
              {hookCount} {t("systemMessageRenderer.hooks", { defaultValue: "hook(s)" })}
            </span>
          )}
        </div>
        {stopReason && (
          <div className={cn("mt-2 text-foreground font-medium flex items-center", layout.iconSpacing)}>
            <FileText className={cn(layout.iconSizeSmall, "text-muted-foreground flex-shrink-0")} />
            <span>{stopReason}</span>
          </div>
        )}
        {hookInfos && hookInfos.length > 0 && (
          <div className="mt-2 space-y-1">
            {hookInfos.map((hook, idx) => (
              <div key={idx} className={cn("flex items-center bg-card/50 rounded px-2 py-1", layout.iconSpacing)}>
                <Webhook className={cn(layout.iconSizeSmall, "text-muted-foreground flex-shrink-0")} />
                <code className={`${layout.smallText} font-mono text-muted-foreground truncate`}>
                  {hook.command}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Handle turn_duration
  if (subtype === "turn_duration") {
    return (
      <div className={cn(`${config.bgColor} border-2 ${config.borderColor} ${layout.smallText}`, layout.rounded, layout.containerPadding)}>
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <Icon className={cn(layout.iconSize, config.color)} />
            <span className={`font-bold ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
          </div>
          {durationMs !== undefined && (
            <span className={`font-mono font-bold ${config.color}`}>
              {formatDuration(durationMs)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Handle compact_boundary
  if (subtype === "compact_boundary") {
    return (
      <div className={cn(`${config.bgColor} border ${config.borderColor} ${layout.smallText}`, layout.rounded, layout.containerPadding)}>
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <Icon className={cn(layout.iconSize, config.color)} />
            <span className={`font-medium ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
          </div>
          {compactMetadata?.preTokens && (
            <span className="text-muted-foreground font-mono">
              {compactMetadata.preTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {compactMetadata?.trigger && (
          <div className="mt-1 text-muted-foreground">
            {t("systemMessageRenderer.trigger", { defaultValue: "Trigger" })}: {compactMetadata.trigger}
          </div>
        )}
      </div>
    );
  }

  // Handle microcompact_boundary
  if (subtype === "microcompact_boundary") {
    return (
      <div className={cn(`${config.bgColor} border ${config.borderColor} ${layout.smallText}`, layout.rounded, layout.containerPadding)}>
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <Icon className={cn(layout.iconSize, config.color)} />
            <span className={`font-medium ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
          </div>
          {microcompactMetadata?.preTokens && (
            <span className="text-muted-foreground font-mono">
              {microcompactMetadata.preTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {microcompactMetadata?.trigger && (
          <div className="mt-1 text-muted-foreground">
            {t("systemMessageRenderer.trigger", { defaultValue: "Trigger" })}: {microcompactMetadata.trigger}
          </div>
        )}
        {content && (
          <div className="mt-1.5 text-foreground">
            {content}
          </div>
        )}
      </div>
    );
  }

  // Handle local_command with command tags
  const hasCommandTags =
    content &&
    (content.includes("<command-") ||
      content.includes("<local-command-") ||
      content.includes("-command-") ||
      content.includes("-stdout>") ||
      content.includes("-stderr>"));

  if (hasCommandTags && content) {
    return (
      <div className={cn(`${config.bgColor} border ${config.borderColor}`, layout.rounded, layout.containerPadding)}>
        <div className={cn(`flex items-center mb-2 ${layout.smallText}`, layout.iconSpacing)}>
          <Icon className={cn(layout.iconSize, config.color)} />
          <span className={`font-medium ${config.color}`}>
            {getSubtypeLabel(subtype)}
          </span>
        </div>
        <CommandRenderer text={content} />
      </div>
    );
  }

  // Handle regular content or empty
  if (!content && !subtype) {
    // In dev mode, show a placeholder to indicate missing data
    if (import.meta.env.DEV) {
      return (
        <div className={`bg-warning/10 border border-warning/30 rounded-lg p-2 ${layout.smallText}`}>
          <span className="text-warning-foreground">
            [DEBUG] System message with no content or subtype
          </span>
        </div>
      );
    }
    return null; // Don't render anything if completely empty
  }

  return (
    <div className={cn(`${config.bgColor} border ${config.borderColor} ${layout.smallText}`, layout.rounded, layout.containerPadding)}>
      <div className={cn("flex items-center", layout.iconSpacing)}>
        <Icon className={cn(layout.iconSize, config.color)} />
        <span className={`font-medium ${config.color}`}>
          {getSubtypeLabel(subtype)}
        </span>
      </div>
      {content && (
        <div className="mt-1.5 text-foreground whitespace-pre-wrap break-words">
          {content}
        </div>
      )}
    </div>
  );
});
