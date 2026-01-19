import { memo } from "react";
import { Info, AlertTriangle, AlertCircle, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandRenderer } from "../contentRenderer";

type Props = {
  content?: string;
  subtype?: string;
  level?: "info" | "warning" | "error";
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
};

export const SystemMessageRenderer = memo(function SystemMessageRenderer({
  content,
  subtype,
  level = "info",
}: Props) {
  const { t } = useTranslation("components");

  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.info;
  const Icon = subtype === "local_command" ? Terminal : config.icon;

  // Check if content has command tags
  const hasCommandTags =
    content &&
    (content.includes("<command-") ||
      content.includes("<local-command-") ||
      content.includes("-command-") ||
      content.includes("-stdout>") ||
      content.includes("-stderr>"));

  const getSubtypeLabel = (sub?: string) => {
    if (!sub) return t("systemMessageRenderer.title", { defaultValue: "System" });
    const labels: Record<string, string> = {
      local_command: t("systemMessageRenderer.subtypes.localCommand", {
        defaultValue: "Local Command",
      }),
    };
    return labels[sub] || sub;
  };

  if (!content) {
    return (
      <div
        className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}
      >
        <div className="flex items-center space-x-2">
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
          <span className={`font-medium ${config.color}`}>
            {getSubtypeLabel(subtype)}
          </span>
        </div>
        <div className="mt-1 text-gray-400 dark:text-gray-500 italic">
          {t("systemMessageRenderer.empty", { defaultValue: "No content" })}
        </div>
      </div>
    );
  }

  // If content has command tags, use CommandRenderer
  if (hasCommandTags) {
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

  // Regular text content
  return (
    <div
      className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}
    >
      <div className="flex items-center space-x-2">
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        <span className={`font-medium ${config.color}`}>
          {getSubtypeLabel(subtype)}
        </span>
      </div>
      <div className="mt-1.5 text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
        {content}
      </div>
    </div>
  );
});
