import { memo } from "react";
import { Globe, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface WebFetchToolInput {
  url?: string;
  prompt?: string;
}

interface Props {
  toolId: string;
  input: WebFetchToolInput;
}

export const WebFetchToolRenderer = memo(function WebFetchToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("web");

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.webFetch", { defaultValue: "WebFetch" })}
        icon={<Globe className={cn(layout.iconSize, styles.icon)} />}
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
        {input.url && (
          <div className={cn("p-2 border bg-card border-border", layout.rounded, "mb-2")}>
            <div className={cn("flex items-center gap-1.5", layout.smallText, "text-muted-foreground mb-1")}>
              <ExternalLink className={layout.iconSizeSmall} />
              <span>URL</span>
            </div>
            <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{input.url}</code>
          </div>
        )}
        {input.prompt && (
          <div className={cn("p-2 border bg-card border-border", layout.rounded)}>
            <div className={cn(layout.smallText, "text-muted-foreground mb-1")}>{t("taskOperation.prompt")}</div>
            <div className={cn(layout.bodyText, "text-foreground whitespace-pre-wrap")}>{input.prompt}</div>
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
