/**
 * Summary Message Renderer
 *
 * Displays conversation summary information with a visual indicator.
 * Uses design tokens for consistent theming across light/dark modes.
 *
 * @example
 * ```tsx
 * <SummaryMessageRenderer summary="Project discussion summary" leafUuid="abc123..." />
 * ```
 */

import { memo } from "react";
import { FileText, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVariantStyles, layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

type Props = {
  summary?: string;
  leafUuid?: string;
};

export const SummaryMessageRenderer = memo(function SummaryMessageRenderer({
  summary,
  leafUuid,
}: Props) {
  const { t } = useTranslation("components");

  if (!summary) {
    return null;
  }

  const styles = getVariantStyles("success");

  return (
    <div className={cn(`border ${layout.bodyText}`, layout.rounded, layout.containerPadding, styles.container)}>
      <div className={cn("flex items-start", layout.iconSpacing)}>
        <FileText className={cn(layout.iconSize, "flex-shrink-0 mt-0.5", styles.icon)} />
        <div className="flex-1 min-w-0">
          <div className={cn("font-medium mb-1", styles.title)}>
            {t("summaryMessageRenderer.title", { defaultValue: "Conversation Summary" })}
          </div>
          <div className="text-foreground/80 whitespace-pre-wrap break-words">
            {summary}
          </div>
          {leafUuid && (
            <div className={cn(`mt-2 flex items-center ${layout.smallText} text-muted-foreground`, layout.iconSpacing)}>
              <Link2 className={layout.iconSizeSmall} />
              <span className="font-mono truncate" title={leafUuid}>
                {leafUuid.slice(0, 8)}...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
