import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import { AnsiText } from "../../common/AnsiText";
import type { Props } from "./shared";
import { str, num, truncate, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const BashCard = memo(function BashCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const command = str(input, "command") ?? "";
  const description = str(input, "description");
  const timeout = num(input, "timeout");
  const styles = getVariantStyles("terminal");


  // Extract stdout/stderr separately for better display
  const resultContent = toolResults[0]?.content;
  const resultObj = typeof resultContent === "object" && resultContent != null
    ? resultContent as Record<string, unknown> : null;
  const stdout = resultObj ? str(resultObj, "stdout") : null;
  const stderr = resultObj ? str(resultObj, "stderr") : null;
  const hasStructuredResult = stdout != null || stderr != null;

  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title={t("tools.terminal")}
        icon={<ToolIcon toolName="Bash" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {timeout != null && (
              <span className="text-muted-foreground">{(timeout / 1000).toFixed(0)}s</span>
            )}
            <StatusBadge results={toolResults} />
          </div>
        }
      />
      <Renderer.Content>
        {description && (
          <div className={cn(layout.smallText, "text-muted-foreground mb-2")}>{description}</div>
        )}
        <pre className={cn(layout.monoText, "p-2 bg-zinc-800 dark:bg-zinc-900 text-zinc-100 rounded overflow-x-auto whitespace-pre-wrap")}>
          {command}
        </pre>
        {hasStructuredResult ? (
          <div className="mt-2 space-y-1">
            {stdout && (
              <pre className={cn(layout.monoText, "p-2 rounded border whitespace-pre-wrap overflow-auto", layout.codeMaxHeight, "bg-secondary border-border text-foreground/80")}>
                <AnsiText text={truncate(stdout)} />
              </pre>
            )}
            {stderr && (
              <pre className={cn(layout.monoText, "p-2 rounded border whitespace-pre-wrap overflow-auto", layout.codeMaxHeight, "bg-secondary border-border text-destructive")}>
                <AnsiText text={truncate(stderr)} />
              </pre>
            )}
          </div>
        ) : (
          <ResultBlock results={toolResults} />
        )}
      </Renderer.Content>
    </Renderer>
  );
});
