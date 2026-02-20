/**
 * BashCodeExecutionToolResultRenderer - Renders bash command execution results
 *
 * Displays stdout/stderr output with appropriate styling for success/error states.
 * Supports both successful results and error conditions.
 */

import { memo } from "react";
import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BashCodeExecutionResult, BashCodeExecutionError } from "../../types";
import { getVariantStyles, layout } from "@/components/renderers";
import { TerminalExecutionResultRenderer } from "./TerminalExecutionResultRenderer";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

interface BashCodeExecutionToolResultRendererProps {
  toolUseId: string;
  content: BashCodeExecutionResult | BashCodeExecutionError;
}

export const BashCodeExecutionToolResultRenderer = memo(
  function BashCodeExecutionToolResultRenderer({
    toolUseId,
    content,
  }: BashCodeExecutionToolResultRendererProps) {
    const { t } = useTranslation();
    const systemStyles = getVariantStyles("system");
    const errorMessages = getCommonToolErrorMessages(t);

    return (
      <TerminalExecutionResultRenderer
        toolUseId={toolUseId}
        content={content}
        icon={<Terminal className={cn(layout.iconSize, systemStyles.icon)} />}
        title={t("bashCodeExecutionToolResultRenderer.title")}
        errorTitle={t("bashCodeExecutionToolResultRenderer.error")}
        noOutputLabel={t("bashCodeExecutionToolResultRenderer.noOutput")}
        errorMessages={errorMessages}
        successVariant="system"
      />
    );
  }
);
