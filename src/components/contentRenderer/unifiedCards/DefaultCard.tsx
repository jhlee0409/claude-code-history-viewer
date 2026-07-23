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
import { HighlightedText } from "../../common/HighlightedText";

export const DefaultCard = memo(function DefaultCard({
  toolUse,
  toolResults,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation();
  const toolName = (toolUse.name as string) || "";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);

  const inputJson = truncate(JSON.stringify(input, null, 2));
  // Reveal + highlight the input when the in-session search term is inside it,
  // so a match in a collapsed tool card (e.g. AskUserQuestion) is actually
  // visible instead of only flagging the message card (#429).
  const inputMatchesSearch =
    !!searchQuery && inputJson.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <Renderer
      className={styles.container}
      hasError={toolResults.length > 0 && toolResults.some(isError)}
      expandKey={`unified-${(toolUse.id as string) || ""}`}
      autoExpand={inputMatchesSearch}
    >
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
        <details className="mb-2" open={inputMatchesSearch}>
          <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground")}>
            {t("common.input")} ({Object.keys(input).join(", ")})
          </summary>
          <pre className={cn(layout.monoText, "mt-2 p-2 bg-secondary text-foreground rounded overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
            {inputMatchesSearch ? (
              <HighlightedText
                text={inputJson}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              inputJson
            )}
          </pre>
        </details>
        <ResultBlock
          results={toolResults}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      </Renderer.Content>
    </Renderer>
  );
});
