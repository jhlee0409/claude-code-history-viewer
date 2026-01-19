import { memo } from "react";
import { Server, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";
import type { MCPToolResultData } from "../../types";

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
      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-xs font-medium text-red-800">
            {t("mcpToolResultRenderer.error", { defaultValue: "MCP Error" })}
          </span>
          <span className="text-xs text-red-500 font-mono">{toolUseId}</span>
        </div>
        <div className="text-sm text-red-700 whitespace-pre-wrap">
          {getErrorMessage()}
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (typeof content === "string") {
      return (
        <pre className="text-sm text-violet-700 bg-violet-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {content}
        </pre>
      );
    }

    if (isObjectContent(content)) {
      if (content.type === "text" && content.text) {
        return (
          <pre className="text-sm text-violet-700 bg-violet-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {content.text}
          </pre>
        );
      }

      if (content.type === "image" && content.data && content.mimeType) {
        return (
          <img
            src={`data:${content.mimeType};base64,${content.data}`}
            alt="MCP result"
            className="max-w-full rounded"
          />
        );
      }

      if (content.type === "resource" && content.uri) {
        return (
          <div className="text-sm text-violet-700">
            <span className="font-medium">
              {t("mcpToolResultRenderer.resource", { defaultValue: "Resource" })}
              :
            </span>{" "}
            <span className="font-mono">{content.uri}</span>
          </div>
        );
      }

      return (
        <pre className="text-sm text-violet-700 bg-violet-100 rounded p-2 overflow-x-auto">
          {safeStringify(content)}
        </pre>
      );
    }

    return null;
  };

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        <Server className="w-4 h-4 text-violet-600" />
        <CheckCircle className="w-3 h-3 text-green-500" />
        <span className="text-xs font-medium text-violet-800">
          {t("mcpToolResultRenderer.title", { defaultValue: "MCP Result" })}
        </span>
        <span className="text-xs text-violet-500 font-mono">{toolUseId}</span>
      </div>

      <div className="mt-2">{renderContent()}</div>
    </div>
  );
});
