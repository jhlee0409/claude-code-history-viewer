import { memo } from "react";
import { Server, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";
import type { MCPToolResultData } from "../../types";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { ToolResultCard } from "./ToolResultCard";

type Props = {
  toolUseId: string;
  content: MCPToolResultData | string;
  isError?: boolean;
};

const isObjectContent = (
  content: MCPToolResultData | string
): content is MCPToolResultData => {
  return typeof content === "object" && content !== null;
};

export const MCPToolResultRenderer = memo(function MCPToolResultRenderer({
  toolUseId,
  content,
  isError = false,
}: Props) {
  const { t } = useTranslation();

  if (isError) {
    const getErrorMessage = (): string => {
      if (typeof content === "string") return content;
      if (content.type === "text") return content.text;
      return safeStringify(content);
    };

    return (
      <ToolResultCard
        title={t("mcpToolResultRenderer.error")}
        icon={<AlertCircle className={cn(layout.iconSize, "text-destructive")} />}
        variant="error"
        toolUseId={toolUseId}
      >
        <div className={cn(layout.bodyText, "text-destructive whitespace-pre-wrap")}>
          {getErrorMessage()}
        </div>
      </ToolResultCard>
    );
  }

  const renderContent = () => {
    if (typeof content === "string") {
      return (
        <pre className={cn(layout.bodyText, "text-foreground bg-muted p-2 overflow-x-auto whitespace-pre-wrap", layout.rounded)}>
          {content}
        </pre>
      );
    }

    if (isObjectContent(content)) {
      if (content.type === "text" && content.text) {
        return (
          <pre className={cn(layout.bodyText, "text-foreground bg-muted p-2 overflow-x-auto whitespace-pre-wrap", layout.rounded)}>
            {content.text}
          </pre>
        );
      }

      if (content.type === "image" && content.data && content.mimeType) {
        return (
          <img
            src={`data:${content.mimeType};base64,${content.data}`}
            alt={t("mcpToolResultRenderer.imageAlt")}
            className={cn("max-w-full", layout.rounded)}
          />
        );
      }

      if (content.type === "resource" && content.uri) {
        return (
          <div className={cn(layout.bodyText, "text-foreground")}>
            <span className="font-medium">
              {t("mcpToolResultRenderer.resource")}
              :
            </span>{" "}
            <span className="font-mono">{content.uri}</span>
          </div>
        );
      }

      return (
        <pre className={cn(layout.bodyText, "text-foreground bg-muted p-2 overflow-x-auto", layout.rounded)}>
          {safeStringify(content)}
        </pre>
      );
    }

    return null;
  };

  return (
    <ToolResultCard
      title={t("mcpToolResultRenderer.title")}
      icon={
        <span className={cn("flex items-center", layout.iconGap)}>
          <Server className={cn(layout.iconSize, "text-tool-mcp")} />
          <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
        </span>
      }
      variant="mcp"
      toolUseId={toolUseId}
    >
      {renderContent()}
    </ToolResultCard>
  );
});
