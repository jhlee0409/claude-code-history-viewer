import { memo } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

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
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.webSearch", { defaultValue: "WebSearch" })}
        icon={<Search className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          toolId && (
            <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
              ID: {toolId}
            </code>
          )
        }
      />
      <Renderer.Content>
        <div className={cn("p-2 border bg-card border-border", layout.rounded, "space-y-1.5")}>
          <div className="flex items-start gap-2">
            <span className={cn(layout.smallText, "text-muted-foreground shrink-0 pt-0.5")}>query:</span>
            <span className={cn(layout.bodyText, "text-foreground font-medium")}>{input.query ?? ""}</span>
          </div>
          {input.allowed_domains && input.allowed_domains.length > 0 && (
            <div className="flex items-start gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0 pt-0.5")}>allow:</span>
              <div className="flex gap-1 flex-wrap">
                {input.allowed_domains.map((d) => (
                  <span key={d} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-success/20 text-success")}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
          {input.blocked_domains && input.blocked_domains.length > 0 && (
            <div className="flex items-start gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0 pt-0.5")}>block:</span>
              <div className="flex gap-1 flex-wrap">
                {input.blocked_domains.map((d) => (
                  <span key={d} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-destructive/20 text-destructive")}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
});
