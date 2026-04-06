import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getToolVariant } from "@/utils/toolIconUtils";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { truncate, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const DefaultCard = memo(function DefaultCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const toolName = (toolUse.name as string) || "";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title={toolName || t("common.unknown")}
        icon={<ToolIcon toolName={toolName} className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            <StatusBadge results={toolResults} />
            {toolId && (
              <code className={cn(layout.monoText, "hidden md:inline px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                {t("common.id")}: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <details className="mb-2">
          <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground")}>
            {t("common.input")} ({Object.keys(input).join(", ")})
          </summary>
          <pre className={cn(layout.monoText, "mt-2 p-2 bg-secondary text-foreground rounded overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
            {truncate(JSON.stringify(input, null, 2))}
          </pre>
        </details>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
