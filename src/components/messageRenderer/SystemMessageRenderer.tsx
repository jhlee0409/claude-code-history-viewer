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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandRenderer } from "../contentRenderer";

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
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-900/50",
    borderColor: "border-gray-200 dark:border-gray-700",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    borderColor: "border-amber-200 dark:border-amber-800",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/30",
    borderColor: "border-red-200 dark:border-red-800",
  },
  suggestion: {
    icon: Info,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
};

const SUBTYPE_CONFIG: Record<SystemSubtype, { icon: typeof Info; color: string; bgColor: string; borderColor: string }> = {
  stop_hook_summary: {
    icon: StopCircle,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    borderColor: "border-rose-200 dark:border-rose-800",
  },
  turn_duration: {
    icon: Clock,
    color: "text-sky-600 dark:text-sky-400",
    bgColor: "bg-sky-50 dark:bg-sky-950/30",
    borderColor: "border-sky-200 dark:border-sky-800",
  },
  compact_boundary: {
    icon: Minimize2,
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/30",
    borderColor: "border-violet-200 dark:border-violet-800",
  },
  microcompact_boundary: {
    icon: Minimize2,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-800",
  },
  local_command: {
    icon: Terminal,
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-50 dark:bg-slate-900/50",
    borderColor: "border-slate-200 dark:border-slate-700",
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
      <div className={`${config.bgColor} border-2 ${config.borderColor} rounded-lg p-3 text-xs`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Icon className={`w-4 h-4 ${config.color}`} />
            <span className={`font-bold ${config.color}`}>
              🛑 {getSubtypeLabel(subtype)}
            </span>
            {preventedContinuation && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 font-medium">
                {t("systemMessageRenderer.prevented", { defaultValue: "Prevented" })}
              </span>
            )}
          </div>
          {hookCount !== undefined && hookCount > 0 && (
            <span className="text-gray-600 dark:text-gray-300 font-medium">
              {hookCount} {t("systemMessageRenderer.hooks", { defaultValue: "hook(s)" })}
            </span>
          )}
        </div>
        {stopReason && (
          <div className="mt-2 text-gray-700 dark:text-gray-300 font-medium">
            📝 {stopReason}
          </div>
        )}
        {hookInfos && hookInfos.length > 0 && (
          <div className="mt-2 space-y-1">
            {hookInfos.map((hook, idx) => (
              <div key={idx} className="flex items-center space-x-2 bg-white/50 dark:bg-black/20 rounded px-2 py-1">
                <Webhook className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <code className="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">
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
      <div className={`${config.bgColor} border-2 ${config.borderColor} rounded-lg p-3 text-xs`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Icon className={`w-4 h-4 ${config.color}`} />
            <span className={`font-bold ${config.color}`}>
              ⏱️ {getSubtypeLabel(subtype)}
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
      <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Icon className={`w-3.5 h-3.5 ${config.color}`} />
            <span className={`font-medium ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
          </div>
          {compactMetadata?.preTokens && (
            <span className="text-gray-500 dark:text-gray-400 font-mono">
              {compactMetadata.preTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {compactMetadata?.trigger && (
          <div className="mt-1 text-gray-500 dark:text-gray-400">
            {t("systemMessageRenderer.trigger", { defaultValue: "Trigger" })}: {compactMetadata.trigger}
          </div>
        )}
      </div>
    );
  }

  // Handle microcompact_boundary
  if (subtype === "microcompact_boundary") {
    return (
      <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Icon className={`w-3.5 h-3.5 ${config.color}`} />
            <span className={`font-medium ${config.color}`}>
              {getSubtypeLabel(subtype)}
            </span>
          </div>
          {microcompactMetadata?.preTokens && (
            <span className="text-gray-500 dark:text-gray-400 font-mono">
              {microcompactMetadata.preTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {microcompactMetadata?.trigger && (
          <div className="mt-1 text-gray-500 dark:text-gray-400">
            {t("systemMessageRenderer.trigger", { defaultValue: "Trigger" })}: {microcompactMetadata.trigger}
          </div>
        )}
        {content && (
          <div className="mt-1.5 text-gray-700 dark:text-gray-300">
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
      <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2`}>
        <div className="flex items-center space-x-2 mb-2 text-xs">
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
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
        <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-2 text-xs">
          <span className="text-yellow-600 dark:text-yellow-400">
            [DEBUG] System message with no content or subtype
          </span>
        </div>
      );
    }
    return null; // Don't render anything if completely empty
  }

  return (
    <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}>
      <div className="flex items-center space-x-2">
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        <span className={`font-medium ${config.color}`}>
          {getSubtypeLabel(subtype)}
        </span>
      </div>
      {content && (
        <div className="mt-1.5 text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
          {content}
        </div>
      )}
    </div>
  );
});
