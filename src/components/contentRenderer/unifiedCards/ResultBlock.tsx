import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../../renderers";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { ToolExecutionResultRouter } from "../../messageRenderer/ToolExecutionResultRouter";
import type { ToolResultLike } from "./shared";

export function ResultBlock({
  results,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: {
  results: ToolResultLike[];
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}) {
  const { t } = useTranslation();
  if (results.length === 0) return (
    <div className={cn(layout.smallText, "text-muted-foreground italic mt-2")}>{t("common.pending")}</div>
  );
  // The card itself is the collapsible; once it is open, the nested result
  // renderers should not demand a second click.
  return (
    <RendererDefaultsContext.Provider value={NESTED_OPEN}>
      <div className="mt-2 space-y-2">
        {results.map((result, idx) => {
          const content = result.content ?? result;
          return (
            <ToolExecutionResultRouter
              key={idx}
              toolResult={content as Record<string, unknown> | string | unknown[]}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          );
        })}
      </div>
    </RendererDefaultsContext.Provider>
  );
}

const NESTED_OPEN = { defaultExpanded: true };
