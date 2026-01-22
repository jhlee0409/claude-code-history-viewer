/**
 * Queue Operation Renderer
 *
 * Displays queue operation information with appropriate visual styling based on operation type.
 * Uses design tokens for consistent theming across light/dark modes.
 *
 * @example
 * ```tsx
 * <QueueOperationRenderer operation="enqueue" content="Task item" />
 * ```
 */

import { memo } from "react";
import {
  ListPlus,
  ListMinus,
  ListX,
  Trash2,
  List,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVariantStyles, layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import type { QueueOperationType } from "../../types";

type Props = {
  operation: QueueOperationType;
  content?: string;
};

const OPERATION_CONFIG: Record<
  QueueOperationType,
  { icon: typeof List; variant: "info" | "success" | "warning" | "error" }
> = {
  enqueue: {
    icon: ListPlus,
    variant: "info",
  },
  dequeue: {
    icon: ListMinus,
    variant: "success",
  },
  remove: {
    icon: ListX,
    variant: "warning",
  },
  popAll: {
    icon: Trash2,
    variant: "error",
  },
};

export const QueueOperationRenderer = memo(function QueueOperationRenderer({
  operation,
  content,
}: Props) {
  const { t } = useTranslation("components");

  const config = OPERATION_CONFIG[operation] || OPERATION_CONFIG.enqueue;
  const Icon = config.icon;
  const styles = getVariantStyles(config.variant);

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
      className={cn("border", layout.rounded, layout.containerPadding, layout.smallText, styles.container)}
    >
      {/* Header */}
      <div className={cn("flex items-center", layout.iconSpacing)}>
        <Icon className={cn(layout.iconSize, styles.icon)} />
        <span className={cn("font-medium", styles.title)}>
          {t("queueOperationRenderer.title", { defaultValue: "Queue Operation" })}
        </span>
        <span className={cn("px-1.5 py-0.5 rounded font-medium", layout.smallText, styles.badge, styles.badgeText)}>
          {getOperationLabel(operation)}
        </span>
      </div>

      {/* Description */}
      <div className="mt-1 text-muted-foreground">
        {getOperationDescription(operation)}
      </div>

      {/* Content Preview */}
      {content && (
        <div className="mt-1.5 bg-secondary/50 rounded p-1.5 font-mono text-foreground truncate">
          {content.length > 100 ? `${content.slice(0, 100)}...` : content}
        </div>
      )}
    </div>
  );
});
