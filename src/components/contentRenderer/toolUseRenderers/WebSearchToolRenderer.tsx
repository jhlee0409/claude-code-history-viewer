import { memo } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { ToolUseCard, ToolUsePropertyRow } from "./ToolUseCard";

interface WebSearchToolInput {
  query?: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

interface Props {
  toolId: string;
  input: WebSearchToolInput;
}

export const WebSearchToolRenderer = memo(function WebSearchToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("web");

  return (
    <ToolUseCard
      title={t("tools.webSearch")}
      icon={<Search className={cn(layout.iconSize, styles.icon)} />}
      variant="web"
      toolId={toolId}
    >
        <div className={cn("p-2 border bg-card border-border", layout.rounded, "space-y-1.5")}>
          <ToolUsePropertyRow label={t("renderers.webSearchToolRenderer.query")}>
            <span className={cn(layout.bodyText, "text-foreground font-medium")}>{input.query ?? ""}</span>
          </ToolUsePropertyRow>
          {input.allowed_domains && input.allowed_domains.length > 0 && (
            <ToolUsePropertyRow label={t("renderers.webSearchToolRenderer.allow")}>
              <div className="flex gap-1 flex-wrap">
                {input.allowed_domains.map((d) => (
                  <span key={d} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-success/20 text-success")}>
                    {d}
                  </span>
                ))}
              </div>
            </ToolUsePropertyRow>
          )}
          {input.blocked_domains && input.blocked_domains.length > 0 && (
            <ToolUsePropertyRow label={t("renderers.webSearchToolRenderer.block")}>
              <div className="flex gap-1 flex-wrap">
                {input.blocked_domains.map((d) => (
                  <span key={d} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-destructive/20 text-destructive")}>
                    {d}
                  </span>
                ))}
              </div>
            </ToolUsePropertyRow>
          )}
        </div>
    </ToolUseCard>
  );
});
