/**
 * AdvisorToolResultRenderer - Renders the server-side "advisor" tool result.
 *
 * The advisor tool returns guidance text; the matching request is a `server_tool_use`
 * named "advisor". This renders the advisor text as Markdown, with an error fallback,
 * so the block no longer falls through to the generic "unknown content type" warning.
 */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../renderers";
import { Markdown } from "../common";
import { ResultRow } from "../transcript/ResultRow";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";
import type { AdvisorResult, AdvisorError } from "@/types";

type Props = {
  toolUseId: string;
  content: AdvisorResult | AdvisorError;
};

const isAdvisorError = (
  content: AdvisorResult | AdvisorError
): content is AdvisorError => content.type === "advisor_tool_result_error";

export const AdvisorToolResultRenderer = memo(function AdvisorToolResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation();
  const result = { type: "advisor_tool_result", tool_use_id: toolUseId, content };

  if (isAdvisorError(content)) {
    const errorMessages = getCommonToolErrorMessages(t);
    return (
      <ResultRow verb="advisor" result={result} toolUseId={toolUseId}>
        {errorMessages[content.error_code] && <div className={cn(layout.bodyText, "text-fg-2")}>{errorMessages[content.error_code]}</div>}
      </ResultRow>
    );
  }

  const text = typeof content.text === "string" ? content.text : "";

  return (
    <ResultRow verb="advisor" result={result} toolUseId={toolUseId}>
      {text ? (
        <Markdown className={cn("overflow-x-auto text-foreground", layout.bodyText)}>
          {text}
        </Markdown>
      ) : (
        <div className={cn(layout.smallText, "text-muted-foreground italic")}>
          {t("advisorToolResultRenderer.empty")}
        </div>
      )}
    </ResultRow>
  );
});

AdvisorToolResultRenderer.displayName = "AdvisorToolResultRenderer";
