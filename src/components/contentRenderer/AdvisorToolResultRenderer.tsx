/**
 * AdvisorToolResultRenderer - Renders the server-side "advisor" tool result.
 *
 * The advisor tool returns guidance text; the matching request is a `server_tool_use`
 * named "advisor". This renders the advisor text as Markdown, with an error fallback,
 * so the block no longer falls through to the generic "unknown content type" warning.
 */

import { memo } from "react";
import { Lightbulb, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";
import { Markdown } from "../common";
import { ToolResultCard } from "./ToolResultCard";
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

  if (isAdvisorError(content)) {
    const errorMessages = getCommonToolErrorMessages(t);
    return (
      <ToolResultCard
        title={t("advisorToolResultRenderer.error")}
        icon={<AlertCircle className={cn(layout.iconSize, "text-destructive")} />}
        variant="error"
        toolUseId={toolUseId}
      >
        <div className={cn(layout.bodyText, "text-destructive")}>
          {errorMessages[content.error_code] || content.error_code}
        </div>
      </ToolResultCard>
    );
  }

  const infoStyles = getVariantStyles("info");
  const text = typeof content.text === "string" ? content.text : "";

  return (
    <ToolResultCard
      title={t("advisorToolResultRenderer.title")}
      icon={<Lightbulb className={cn(layout.iconSize, infoStyles.icon)} />}
      variant="info"
      toolUseId={toolUseId}
    >
      {text ? (
        <Markdown className={cn("overflow-x-auto text-foreground", layout.bodyText)}>
          {text}
        </Markdown>
      ) : (
        <div className={cn(layout.smallText, "text-muted-foreground italic")}>
          {t("advisorToolResultRenderer.empty")}
        </div>
      )}
    </ToolResultCard>
  );
});

AdvisorToolResultRenderer.displayName = "AdvisorToolResultRenderer";
