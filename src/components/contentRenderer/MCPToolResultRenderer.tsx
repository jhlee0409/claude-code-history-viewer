import { memo } from "react";
import { Server, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";
import type { MCPToolResultData } from "../../types";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

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
  const { t } = useTranslation("components");

  if (isError) {
    const getErrorMessage = (): string => {
      if (typeof content === "string") return content;
      if (content.type === "text") return content.text;
      return safeStringify(content);
    };

    return (
      <div className={cn(layout.rounded, "border border-destructive/30 bg-destructive/10")}>
        <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
          <div className={cn("flex items-center", layout.iconGap)}>
            <AlertCircle className={cn(layout.iconSize, "text-destructive")} />
            <span className={cn(layout.titleText, "text-destructive")}>
              {t("mcpToolResultRenderer.error", { defaultValue: "MCP Error" })}
            </span>
          </div>
          <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
            <span className={cn(layout.monoText, "text-destructive/70")}>{toolUseId}</span>
          </div>
        </div>
        <div className={layout.contentPadding}>
          <div className={cn(layout.bodyText, "text-destructive whitespace-pre-wrap")}>
            {getErrorMessage()}
          </div>
        </div>
      </div>
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
            alt="MCP result"
            className={cn("max-w-full", layout.rounded)}
          />
        );
      }

      if (content.type === "resource" && content.uri) {
        return (
          <div className={cn(layout.bodyText, "text-foreground")}>
            <span className="font-medium">
              {t("mcpToolResultRenderer.resource", { defaultValue: "Resource" })}
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
    <div className={cn(layout.rounded, "border border-tool-mcp/30 bg-tool-mcp/10")}>
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          <Server className={cn(layout.iconSize, "text-tool-mcp")} />
          <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
          <span className={cn(layout.titleText, "text-foreground")}>
            {t("mcpToolResultRenderer.title", { defaultValue: "MCP Result" })}
          </span>
        </div>
        <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
          <span className={cn(layout.monoText, "text-tool-mcp")}>{toolUseId}</span>
        </div>
      </div>

      <div className={layout.contentPadding}>{renderContent()}</div>
    </div>
  );
});
