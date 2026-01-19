import { memo } from "react";
import {
  ListPlus,
  ListMinus,
  ListX,
  Trash2,
  List,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QueueOperationType } from "../../types";

type Props = {
  operation: QueueOperationType;
  content?: string;
  timestamp?: string;
};

const OPERATION_CONFIG: Record<
  QueueOperationType,
  { icon: typeof List; color: string; bgColor: string; borderColor: string }
> = {
  enqueue: {
    icon: ListPlus,
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-50 dark:bg-indigo-950/30",
    borderColor: "border-indigo-200 dark:border-indigo-800",
  },
  dequeue: {
    icon: ListMinus,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    borderColor: "border-emerald-200 dark:border-emerald-800",
  },
  remove: {
    icon: ListX,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    borderColor: "border-amber-200 dark:border-amber-800",
  },
  popAll: {
    icon: Trash2,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    borderColor: "border-rose-200 dark:border-rose-800",
  },
};

export const QueueOperationRenderer = memo(function QueueOperationRenderer({
  operation,
  content,
}: Props) {
  const { t } = useTranslation("components");

  const config = OPERATION_CONFIG[operation] || OPERATION_CONFIG.enqueue;
  const Icon = config.icon;

  const getOperationLabel = (op: QueueOperationType) => {
    const labels: Record<QueueOperationType, string> = {
      enqueue: t("queueOperationRenderer.operations.enqueue", { defaultValue: "Enqueue" }),
      dequeue: t("queueOperationRenderer.operations.dequeue", { defaultValue: "Dequeue" }),
      remove: t("queueOperationRenderer.operations.remove", { defaultValue: "Remove" }),
      popAll: t("queueOperationRenderer.operations.popAll", { defaultValue: "Clear All" }),
    };
    return labels[op] || op;
  };

  const getOperationDescription = (op: QueueOperationType) => {
    const descriptions: Record<QueueOperationType, string> = {
      enqueue: t("queueOperationRenderer.descriptions.enqueue", { defaultValue: "Added to queue" }),
      dequeue: t("queueOperationRenderer.descriptions.dequeue", { defaultValue: "Removed from queue" }),
      remove: t("queueOperationRenderer.descriptions.remove", { defaultValue: "Item removed" }),
      popAll: t("queueOperationRenderer.descriptions.popAll", { defaultValue: "Queue cleared" }),
    };
    return descriptions[op] || "";
  };

  return (
    <div
      className={`${config.bgColor} border ${config.borderColor} rounded-lg p-2 text-xs`}
    >
      {/* Header */}
      <div className="flex items-center space-x-2">
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        <span className={`font-medium ${config.color}`}>
          {t("queueOperationRenderer.title", { defaultValue: "Queue Operation" })}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
          {getOperationLabel(operation)}
        </span>
      </div>

      {/* Description */}
      <div className="mt-1 text-gray-500 dark:text-gray-400">
        {getOperationDescription(operation)}
      </div>

      {/* Content Preview */}
      {content && (
        <div className="mt-1.5 bg-white/50 dark:bg-black/20 rounded p-1.5 font-mono text-gray-700 dark:text-gray-300 truncate">
          {content.length > 100 ? `${content.slice(0, 100)}...` : content}
        </div>
      )}
    </div>
  );
});
