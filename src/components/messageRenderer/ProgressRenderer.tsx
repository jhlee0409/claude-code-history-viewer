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
import type { ProgressData, ProgressDataType } from "../../types";

type Props = {
  data: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
};

const PROGRESS_CONFIG: Record<
  ProgressDataType,
  { icon: typeof Activity; color: string; bgColor: string; borderColor: string }
> = {
  agent_progress: {
    icon: Bot,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
  mcp_progress: {
    icon: Server,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-800",
  },
  bash_progress: {
    icon: Terminal,
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-50 dark:bg-slate-900/50",
    borderColor: "border-slate-200 dark:border-slate-700",
  },
  hook_progress: {
    icon: Webhook,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    borderColor: "border-orange-200 dark:border-orange-800",
  },
  search_results_received: {
    icon: Search,
    color: "text-teal-600 dark:text-teal-400",
    bgColor: "bg-teal-50 dark:bg-teal-950/30",
    borderColor: "border-teal-200 dark:border-teal-800",
  },
  query_update: {
    icon: RefreshCw,
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-50 dark:bg-cyan-950/30",
    borderColor: "border-cyan-200 dark:border-cyan-800",
  },
  waiting_for_task: {
    icon: Clock,
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-900/50",
    borderColor: "border-gray-200 dark:border-gray-700",
  },
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  started: Loader2,
  running: Loader2,
  error: AlertCircle,
};

const STATUS_COLOR: Record<string, string> = {
  completed: "text-green-500",
  started: "text-blue-500 animate-spin",
  running: "text-blue-500 animate-spin",
  error: "text-red-500",
};

export const ProgressRenderer = memo(function ProgressRenderer({
  data,
  toolUseID,
}: Props) {
  const { t } = useTranslation("components");

  const config = PROGRESS_CONFIG[data.type] || PROGRESS_CONFIG.agent_progress;
  const Icon = config.icon;
  const StatusIcon = data.status ? STATUS_ICON[data.status] || Activity : Activity;
  const statusColor = data.status ? STATUS_COLOR[data.status] || config.color : config.color;

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
    <div
      className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
          <span className={`font-medium ${config.color}`}>
            {getProgressLabel(data.type)}
          </span>
          {data.status && (
            <div className="flex items-center space-x-1">
              <StatusIcon className={`w-3 h-3 ${statusColor}`} />
              <span className={statusColor}>{getStatusLabel(data.status)}</span>
            </div>
          )}
        </div>
        {data.elapsedTimeMs !== undefined && (
          <span className="text-gray-500 dark:text-gray-400 font-mono">
            {formatDuration(data.elapsedTimeMs)}
          </span>
        )}
      </div>

      {/* Details */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-gray-600 dark:text-gray-400">
        {data.serverName && (
          <span className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded font-mono">
            {data.serverName}
          </span>
        )}
        {data.toolName && (
          <span className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded font-mono">
            {data.toolName}
          </span>
        )}
        {data.agentId && (
          <span className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded font-mono truncate max-w-[120px]">
            {data.agentId}
          </span>
        )}
        {toolUseID && (
          <span className="text-gray-400 dark:text-gray-500 font-mono truncate max-w-[100px]">
            {toolUseID.slice(0, 12)}...
          </span>
        )}
      </div>

      {/* Message */}
      {data.message && (
        <div className="mt-1.5 text-gray-700 dark:text-gray-300 truncate">
          {data.message}
        </div>
      )}
    </div>
  );
});
