import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../../renderers";
import { ToolExecutionResultRouter } from "../../messageRenderer/ToolExecutionResultRouter";
import type { ToolResultLike } from "./shared";

export function ResultBlock({ results }: { results: ToolResultLike[] }) {
  const { t } = useTranslation();
  if (results.length === 0) return (
    <div className={cn(layout.smallText, "text-muted-foreground italic mt-2")}>{t("common.pending")}</div>
  );
  return (
    <div className="mt-2 space-y-2">
      {results.map((result, idx) => {
        const content = result.content ?? result;
        return (
          <ToolExecutionResultRouter
            key={idx}
            toolResult={content as Record<string, unknown> | string | unknown[]}
          />
        );
      })}
    </div>
  );
}
