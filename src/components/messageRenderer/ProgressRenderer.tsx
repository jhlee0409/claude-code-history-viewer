/**
 * ProgressRenderer - Renders progress indicators for various operations
 *
 * Displays status for agent, MCP, bash, hook, search, and query operations
 * with appropriate icons and color coding based on status.
 */

import { memo } from "react";
import {
  Activity,
  Server,
  Terminal,
  Webhook,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Bot,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ProgressData, ProgressDataType } from "../../types";
import { getVariantStyles, type RendererVariant, layout } from "../renderers";

interface ProgressRendererProps {
  data: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
}

// Map progress types to semantic variants and icons
const PROGRESS_CONFIG: Record<
  ProgressDataType,
  { icon: typeof Activity; variant: RendererVariant }
> = {
  agent_progress: { icon: Bot, variant: "info" },
  mcp_progress: { icon: Server, variant: "mcp" },
  bash_progress: { icon: Terminal, variant: "terminal" },
  hook_progress: { icon: Webhook, variant: "warning" },
  search_results_received: { icon: Search, variant: "web" },
  query_update: { icon: RefreshCw, variant: "info" },
  waiting_for_task: { icon: Clock, variant: "neutral" },
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  started: Loader2,
  running: Loader2,
  error: AlertCircle,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "text-success",
  started: "text-info",
  running: "text-info",
  error: "text-destructive",
};

const STATUS_ICON_ANIMATE: Record<string, string> = {
  started: "animate-spin origin-center",
  running: "animate-spin origin-center",
};

export const ProgressRenderer = memo(function ProgressRenderer({
  data,
  toolUseID,
}: ProgressRendererProps) {
  const { t } = useTranslation("components");

  const config = PROGRESS_CONFIG[data.type] || PROGRESS_CONFIG.agent_progress;
  const styles = getVariantStyles(config.variant);
  const Icon = config.icon;
  const StatusIcon = data.status ? STATUS_ICON[data.status] || Activity : Activity;
  const statusColor = data.status ? STATUS_COLORS[data.status] || styles.icon : styles.icon;
  const statusIconAnimate = data.status ? STATUS_ICON_ANIMATE[data.status] || "" : "";

  const formatDuration = (ms?: number) => {
    if (!ms) return null;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getProgressLabel = (type: ProgressDataType) => {
    const labels: Record<ProgressDataType, string> = {
      agent_progress: t("progressRenderer.types.agent", { defaultValue: "Agent" }),
      mcp_progress: t("progressRenderer.types.mcp", { defaultValue: "MCP Tool" }),
      bash_progress: t("progressRenderer.types.bash", { defaultValue: "Bash" }),
      hook_progress: t("progressRenderer.types.hook", { defaultValue: "Hook" }),
      search_results_received: t("progressRenderer.types.search", { defaultValue: "Search" }),
      query_update: t("progressRenderer.types.query", { defaultValue: "Query" }),
      waiting_for_task: t("progressRenderer.types.waiting", { defaultValue: "Waiting" }),
    };
    return labels[type] || type;
  };

  const getStatusLabel = (status?: string) => {
    if (!status) return null;
    const labels: Record<string, string> = {
      completed: t("progressRenderer.status.completed", { defaultValue: "Completed" }),
      started: t("progressRenderer.status.started", { defaultValue: "Started" }),
      running: t("progressRenderer.status.running", { defaultValue: "Running" }),
      error: t("progressRenderer.status.error", { defaultValue: "Error" }),
    };
    return labels[status] || status;
  };

  return (
    <div className={cn(layout.rounded, "p-2 border", layout.smallText, styles.container)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className={cn("flex items-center", layout.iconSpacing)}>
          <Icon className={cn(layout.iconSize, styles.icon)} />
          <span className={cn("font-medium", styles.title)}>
            {getProgressLabel(data.type)}
          </span>
          {data.status && (
            <div className="flex items-center space-x-1">
              <StatusIcon className={cn(layout.iconSizeSmall, "shrink-0", statusColor, statusIconAnimate)} />
              <span className={statusColor}>{getStatusLabel(data.status)}</span>
            </div>
          )}
        </div>
        {data.elapsedTimeMs !== undefined && (
          <span className="text-muted-foreground font-mono">
            {formatDuration(data.elapsedTimeMs)}
          </span>
        )}
      </div>

      {/* Details */}
      <div className={cn("mt-1.5 flex flex-wrap items-center text-muted-foreground", layout.iconGap)}>
        {data.serverName && (
          <span className={cn("bg-secondary/50 px-1.5 py-0.5 font-mono", layout.rounded)}>
            {data.serverName}
          </span>
        )}
        {data.toolName && (
          <span className={cn("bg-secondary/50 px-1.5 py-0.5 font-mono", layout.rounded)}>
            {data.toolName}
          </span>
        )}
        {data.agentId && (
          <span className={cn("bg-secondary/50 px-1.5 py-0.5 font-mono truncate max-w-[120px]", layout.rounded)}>
            {data.agentId}
          </span>
        )}
        {toolUseID && (
          <span className="text-muted-foreground/70 font-mono truncate max-w-[100px]">
            {toolUseID.slice(0, 12)}...
          </span>
        )}
      </div>

      {/* Message */}
      {data.message && (
        <div className="mt-1.5 text-foreground/80 truncate">
          {typeof data.message === "string"
            ? data.message
            : JSON.stringify(data.message)}
        </div>
      )}
    </div>
  );
});
