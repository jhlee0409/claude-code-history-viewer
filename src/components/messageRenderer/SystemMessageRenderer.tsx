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
import {
  ClaudeContentArrayRenderer,
  CommandRenderer,
} from "../contentRenderer";
import { HighlightedText } from "../common";
import { Renderer } from "@/shared/RendererHeader";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import type { CompactMetadata } from "@/types";

// Hook info structure
interface HookInfo {
  command: string;
  output?: string;
  error?: string;
}

type SystemSubtype =
  | "stop_hook_summary"
  | "turn_duration"
  | "compact_boundary"
  | "microcompact_boundary"
  | "local_command"
  | "system_prompt";

type Props = {
  content?: string | unknown[];
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
  expandKey?: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
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
    color: "text-foreground",
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

const SUBTYPE_CONFIG: Record<
  SystemSubtype,
  { icon: typeof Info; color: string; bgColor: string; borderColor: string }
> = {
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
  system_prompt: {
    icon: FileText,
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
    borderColor: "border-border",
  },
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const countTextMatches = (text: string | undefined, query: string): number => {
  if (!text || !query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
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
  expandKey,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation();
  const textContent = typeof content === "string" ? content : undefined;
  const structuredContent = Array.isArray(content) ? content : undefined;
  const hasRenderableContent =
    (textContent?.length ?? 0) > 0 || (structuredContent?.length ?? 0) > 0;
  const renderedContent =
    structuredContent && structuredContent.length > 0 ? (
      <ClaudeContentArrayRenderer
        content={structuredContent}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    ) : textContent ? (
      <div className="text-foreground whitespace-pre-wrap break-words">
        {textContent}
      </div>
    ) : null;

  const subtypeKey = subtype as SystemSubtype;
  const config =
    SUBTYPE_CONFIG[subtypeKey] || LEVEL_CONFIG[level] || LEVEL_CONFIG.info;
  const Icon = config.icon;

  const getSubtypeLabel = (sub?: string): string => {
    if (!sub)
      return t("systemMessageRenderer.title", { defaultValue: "System" });
    const labels: Record<string, string> = {
      stop_hook_summary: t("systemMessageRenderer.subtypes.stopHook", {
        defaultValue: "Stop Hook",
      }),
      turn_duration: t("systemMessageRenderer.subtypes.turnDuration", {
        defaultValue: "Turn Duration",
      }),
      compact_boundary: t("systemMessageRenderer.subtypes.compactBoundary", {
        defaultValue: "Conversation Compacted",
      }),
      microcompact_boundary: t(
        "systemMessageRenderer.subtypes.microcompactBoundary",
        { defaultValue: "Context Microcompacted" },
      ),
      local_command: t("systemMessageRenderer.subtypes.localCommand", {
        defaultValue: "Local Command",
      }),
      system_prompt: t("systemMessageRenderer.subtypes.systemPrompt", {
        defaultValue: "System Prompt",
      }),
    };
    return labels[sub] || sub;
  };

  // Handle stop_hook_summary
  if (subtype === "stop_hook_summary") {
    return (
      <div
        className={cn(
          `${config.bgColor} border-2 ${config.borderColor} ${layout.smallText}`,
          layout.rounded,
          layout.containerPadding,
        )}
      >
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <Icon className={cn(layout.iconSize, config.color)} />
            <span className={`font-bold ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
            {preventedContinuation && (
              <span
                className={`px-1.5 py-0.5 rounded ${layout.smallText} bg-destructive/20 text-destructive font-medium`}
              >
                {t("systemMessageRenderer.prevented", {
                  defaultValue: "Prevented",
                })}
              </span>
            )}
          </div>
          {hookCount !== undefined && hookCount > 0 && (
            <span className="text-muted-foreground font-medium">
              {hookCount}{" "}
              {t("systemMessageRenderer.hooks", { defaultValue: "hook(s)" })}
            </span>
          )}
        </div>
        {stopReason && (
          <div
            className={cn(
              "mt-2 text-foreground font-medium flex items-center",
              layout.iconSpacing,
            )}
          >
            <FileText
              className={cn(
                layout.iconSizeSmall,
                "text-muted-foreground flex-shrink-0",
              )}
            />
            <span>{stopReason}</span>
          </div>
        )}
        {hookInfos && hookInfos.length > 0 && (
          <div className="mt-2 space-y-1">
            {hookInfos.map((hook, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-center bg-card/50 rounded px-2 py-1",
                  layout.iconSpacing,
                )}
              >
                <Webhook
                  className={cn(
                    layout.iconSizeSmall,
                    "text-muted-foreground flex-shrink-0",
                  )}
                />
                <code
                  className={`${layout.smallText} font-mono text-muted-foreground truncate`}
                >
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
      <div
        className={cn(
          `${config.bgColor} border-2 ${config.borderColor} ${layout.smallText}`,
          layout.rounded,
          layout.containerPadding,
        )}
      >
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

  // Compaction summaries can be very large, so keep the boundary compact until
  // the user asks to inspect the retained context.
  if (subtype === "compact_boundary") {
    const warning = compactMetadata?.warning;
    const normalizedQuery = searchQuery.trim();
    const summaryMatchCount = countTextMatches(textContent, normalizedQuery);
    const warningMatchCount = countTextMatches(warning, normalizedQuery);
    const summaryMatchesSearch = summaryMatchCount > 0;
    const warningMatchesSearch = warningMatchCount > 0;
    const warningMatchIndex = currentMatchIndex - summaryMatchCount;
    const warningConfig =
      warning || level === "warning" ? LEVEL_CONFIG.warning : config;
    const tokenLabel =
      compactMetadata?.preTokens !== undefined
        ? `${compactMetadata.preTokens.toLocaleString()}${
            compactMetadata.postTokens !== undefined
              ? ` → ${compactMetadata.postTokens.toLocaleString()}`
              : ""
          } tokens`
        : undefined;
    return (
      <Renderer
        className={cn(warningConfig.bgColor, warningConfig.borderColor)}
        expandKey={expandKey ? `compaction-${expandKey}` : "compaction"}
        autoExpand={summaryMatchesSearch}
        defaultExpanded={false}
      >
        <Renderer.Header
          title={getSubtypeLabel(subtype)}
          icon={<Icon className={cn(layout.iconSize, config.color)} />}
          titleClassName={config.color}
          rightContent={
            tokenLabel ? (
              <span className="text-muted-foreground font-mono">
                {tokenLabel}
              </span>
            ) : undefined
          }
          summary={textContent?.split("\n", 1)[0]}
        />
        {warning && (
          <div className="flex items-start gap-2 border-t border-warning/30 bg-warning/10 px-3 py-2 text-foreground">
            <AlertTriangle
              aria-hidden="true"
              className={cn(
                layout.iconSizeSmall,
                "mt-0.5 shrink-0 text-warning",
              )}
            />
            <span className="min-w-0 break-words">
              {warningMatchesSearch ? (
                <HighlightedText
                  text={warning}
                  searchQuery={normalizedQuery}
                  isCurrentMatch={isCurrentMatch && warningMatchIndex >= 0}
                  currentMatchIndex={Math.max(0, warningMatchIndex)}
                />
              ) : (
                warning
              )}
            </span>
          </div>
        )}
        <Renderer.Content>
          {compactMetadata?.trigger && (
            <div className="mb-1.5 text-muted-foreground">
              {t("systemMessageRenderer.trigger", { defaultValue: "Trigger" })}:{" "}
              {compactMetadata.trigger}
            </div>
          )}
          {textContent && (
            <div className="whitespace-pre-wrap break-words text-foreground">
              {summaryMatchesSearch ? (
                <HighlightedText
                  text={textContent}
                  searchQuery={normalizedQuery}
                  isCurrentMatch={
                    isCurrentMatch && currentMatchIndex < summaryMatchCount
                  }
                  currentMatchIndex={currentMatchIndex}
                />
              ) : (
                textContent
              )}
            </div>
          )}
        </Renderer.Content>
      </Renderer>
    );
  }

  // Handle microcompact_boundary
  if (subtype === "microcompact_boundary") {
    return (
      <div
        className={cn(
          `${config.bgColor} border ${config.borderColor} ${layout.smallText}`,
          layout.rounded,
          layout.containerPadding,
        )}
      >
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
            {t("systemMessageRenderer.trigger", { defaultValue: "Trigger" })}:{" "}
            {microcompactMetadata.trigger}
          </div>
        )}
        {textContent && (
          <div className="mt-1.5 text-foreground">{textContent}</div>
        )}
      </div>
    );
  }

  // Handle local_command — delegate directly to CommandRenderer (no extra wrapper)
  const hasCommandTags =
    textContent &&
    (textContent.includes("<command-") ||
      textContent.includes("<local-command-") ||
      textContent.includes("-command-") ||
      textContent.includes("-stdout>") ||
      textContent.includes("-stderr>"));

  if (hasCommandTags) {
    return <CommandRenderer text={textContent} variant="system" />;
  }

  if (subtype === "system_prompt") {
    return (
      <Renderer
        className={cn(config.bgColor, config.borderColor)}
        expandKey={expandKey ? `system-prompt-${expandKey}` : "system-prompt"}
      >
        <Renderer.Header
          title={getSubtypeLabel(subtype)}
          icon={<Icon className={cn(layout.iconSize, config.color)} />}
          titleClassName={config.color}
        />
        <Renderer.Content>
          {renderedContent ?? (
            <div className="text-foreground whitespace-pre-wrap break-words">
              {t("systemMessageRenderer.empty", {
                defaultValue: "No content",
              })}
            </div>
          )}
        </Renderer.Content>
      </Renderer>
    );
  }

  // Handle regular content or empty
  if (!hasRenderableContent && !subtype) {
    // In dev mode, show a placeholder to indicate missing data
    if (import.meta.env.DEV) {
      return (
        <div
          className={`bg-warning/10 border border-warning/30 rounded-lg p-2 ${layout.smallText}`}
        >
          <span className="text-foreground">
            [DEBUG] System message with no content or subtype
          </span>
        </div>
      );
    }
    return null; // Don't render anything if completely empty
  }

  return (
    <div
      className={cn(
        `${config.bgColor} border ${config.borderColor} ${layout.smallText}`,
        layout.rounded,
        layout.containerPadding,
      )}
    >
      <div className={cn("flex items-center", layout.iconSpacing)}>
        <Icon className={cn(layout.iconSize, config.color)} />
        <span className={`font-medium ${config.color}`}>
          {getSubtypeLabel(subtype)}
        </span>
      </div>
      {renderedContent && <div className="mt-1.5">{renderedContent}</div>}
    </div>
  );
});
