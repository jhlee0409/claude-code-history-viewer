import type { ReactNode } from "react";
import { memo } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout, type RendererVariant } from "../renderers";
import { ToolResultCard } from "./ToolResultCard";

interface ExecutionResultLike {
  stdout?: string;
  stderr?: string;
  return_code?: number;
}

interface ExecutionErrorLike {
  error_code: string;
}

type Content = ExecutionResultLike | ExecutionErrorLike;

const isExecutionError = (content: Content): content is ExecutionErrorLike => {
  return "error_code" in content;
};

interface Props {
  toolUseId: string;
  content: Content;
  icon: ReactNode;
  title: string;
  errorTitle: string;
  noOutputLabel: string;
  errorMessages: Record<string, string>;
  successVariant?: RendererVariant;
}

export const TerminalExecutionResultRenderer = memo(function TerminalExecutionResultRenderer({
  toolUseId,
  content,
  icon,
  title,
  errorTitle,
  noOutputLabel,
  errorMessages,
  successVariant = "system",
}: Props) {
  const { t } = useTranslation();

  if (isExecutionError(content)) {
    return (
      <ToolResultCard
        title={errorTitle}
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

  const { stdout, stderr, return_code } = content;
  const isSuccess = return_code === 0;

  return (
    <ToolResultCard
      title={title}
      icon={
        <span className={cn("flex items-center", layout.iconGap)}>
          {icon}
          {isSuccess ? (
            <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
          ) : (
            <AlertCircle className={cn(layout.iconSizeSmall, "text-warning")} />
          )}
        </span>
      }
      variant={successVariant}
      toolUseId={toolUseId}
      rightContent={
        return_code !== undefined ? (
          <span
            className={cn(
              layout.monoText,
              "px-1.5 py-0.5 rounded",
              isSuccess ? "bg-success/20 text-success" : "bg-warning/20 text-warning"
            )}
          >
            {t("terminalStreamRenderer.exitCode")}: {return_code}
          </span>
        ) : null
      }
    >
      {stdout && (
        <div className="mb-2">
          <div className={cn("flex items-center space-x-1 mb-1", layout.smallText, "text-muted-foreground")}>
            <span className="font-mono">{t("terminalExecutionResultRenderer.stdout")}:</span>
          </div>
          <pre
            className={cn(
              layout.monoText,
              "bg-secondary text-success rounded p-2 overflow-x-auto whitespace-pre-wrap",
              layout.codeMaxHeight
            )}
          >
            {stdout}
          </pre>
        </div>
      )}

      {stderr && (
        <div>
          <div className={cn("flex items-center space-x-1 mb-1", layout.smallText, "text-warning")}>
            <span className="font-mono">{t("terminalExecutionResultRenderer.stderr")}:</span>
          </div>
          <pre
            className={cn(
              layout.monoText,
              "bg-secondary text-destructive rounded p-2 overflow-x-auto whitespace-pre-wrap",
              layout.codeMaxHeight
            )}
          >
            {stderr}
          </pre>
        </div>
      )}

      {!stdout && !stderr && (
        <div className={cn(layout.smallText, "text-muted-foreground italic")}>{noOutputLabel}</div>
      )}
    </ToolResultCard>
  );
});
