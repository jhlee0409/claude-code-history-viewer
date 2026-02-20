import { memo } from "react";
import { CheckCircle2, Clock3, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../ToolIcon";
import { getToolVariant } from "@/utils/toolIconUtils";
import { getVariantStyles, layout } from "../renderers";

const PREVIEW_MAX_LEN = 6000;

type ToolResultLike = Record<string, unknown>;

interface Props {
  toolUse: Record<string, unknown>;
  toolResults: ToolResultLike[];
}

const truncateText = (text: string) => {
  if (text.length <= PREVIEW_MAX_LEN) return text;
  return `${text.slice(0, PREVIEW_MAX_LEN)}\n...`;
};

const stringifyPreview = (value: unknown) => {
  if (typeof value === "string") return truncateText(value);
  try {
    return truncateText(JSON.stringify(value, null, 2));
  } catch {
    return String(value);
  }
};

const isResultError = (result: ToolResultLike) => {
  if (result.is_error === true) return true;
  const content = result.content;
  if (content && typeof content === "object") {
    return "error_code" in content;
  }
  return typeof result.type === "string" && result.type.includes("error");
};

const getToolDisplayName = (
  toolName: string,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  if (toolName === "Bash") {
    return t("tools.terminal");
  }
  return toolName || t("common.unknown");
};

export const UnifiedToolExecutionRenderer = memo(function UnifiedToolExecutionRenderer({
  toolUse,
  toolResults,
}: Props) {
  const { t } = useTranslation();

  const toolName = (toolUse.name as string) || "";
  const toolId = (toolUse.id as string) || "";
  const toolInput = (toolUse.input as Record<string, unknown>) ?? {};
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);

  const hasResult = toolResults.length > 0;
  const hasError = hasResult && toolResults.some(isResultError);
  const isPending = !hasResult;

  const statusBadge = hasError ? (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-destructive/20 text-destructive")}>
      <AlertTriangle className={layout.iconSizeSmall} />
      {t("common.error")}
    </span>
  ) : isPending ? (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-warning/20 text-warning")}>
      <Clock3 className={layout.iconSizeSmall} />
      {t("common.pending")}
    </span>
  ) : (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-success/20 text-success")}>
      <CheckCircle2 className={layout.iconSizeSmall} />
      {t("common.completed")}
    </span>
  );

  const primaryPreview =
    typeof toolInput.command === "string"
      ? toolInput.command
      : typeof toolInput.file_path === "string"
        ? toolInput.file_path
        : typeof toolInput.path === "string"
          ? toolInput.path
          : null;

  return (
    <Renderer className={styles.container} hasError={hasError}>
      <Renderer.Header
        title={getToolDisplayName(toolName, t)}
        icon={<ToolIcon toolName={toolName} className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center", layout.iconGap)}>
            {statusBadge}
              {toolId && (
                <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                  {t("common.id")}: {toolId}
                </code>
              )}
            </div>
          }
        />
      <Renderer.Content>
        {primaryPreview && (
          <pre className={cn(layout.monoText, "mb-2 p-2 bg-secondary text-foreground rounded overflow-x-auto whitespace-pre-wrap")}>
            {primaryPreview}
          </pre>
        )}

        <details className="mb-2">
          <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground")}>
            {t("common.input")}
          </summary>
          <pre className={cn(layout.monoText, "mt-2 p-2 bg-secondary text-foreground rounded overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
            {stringifyPreview(toolInput)}
          </pre>
        </details>

        {toolResults.length > 0 ? (
          <div className="space-y-2">
            {toolResults.map((result, idx) => (
              <details key={idx}>
                <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground")}>
                  {t("toolResult.toolExecutionResult")} #{idx + 1}
                </summary>
                <pre className={cn(layout.monoText, "mt-2 p-2 bg-secondary text-foreground rounded overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
                  {stringifyPreview(result.content)}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          <div className={cn(layout.smallText, "text-muted-foreground italic")}>
            {t("common.pending")}
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
