import { memo, useContext } from "react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";
import { TruncatedPre } from "../common/TruncatedPre";
import type { MCPToolResultData } from "../../types";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";

type Props = {
  toolUseId: string;
  content: MCPToolResultData | string;
  isError?: boolean;
};

const isObjectContent = (content: MCPToolResultData | string): content is MCPToolResultData => typeof content === "object" && content !== null;

/**
 * An `mcp_tool_result` (TR1b: its head is its `mcp_tool_use` call's ToolRow,
 * or `ResultRow` when the call is not in the message). `is_error` is the
 * row's outcome ("Failed", from `toolOutcome`); the body is the recorded
 * content — text, an image, a resource URI, or the JSON of anything else,
 * each block in recorded order — in neutral text, search hits marked. No
 * "MCP tool error" title, no success glyph.
 */
export const MCPToolResultRenderer = memo(function MCPToolResultRenderer({ toolUseId, content, isError = false }: Props) {
  const { t } = useTranslation();
  const { highlight } = useContext(ResultRowContext);
  const result = { type: "mcp_tool_result", tool_use_id: toolUseId, content, is_error: isError };

  const renderBlock = (block: unknown, key?: number) => {
    if (typeof block === "string") {
      return (
        <pre key={key} className={cn(layout.bodyText, "text-foreground bg-muted p-2 overflow-x-auto whitespace-pre-wrap", layout.rounded)}>
          <Marked text={block} highlight={highlight} />
        </pre>
      );
    }
    if (isObjectContent(block as MCPToolResultData | string)) {
      const item = block as MCPToolResultData;
      if (item.type === "text" && item.text) {
        return (
          <pre key={key} className={cn(layout.bodyText, "text-foreground bg-muted p-2 overflow-x-auto whitespace-pre-wrap", layout.rounded)}>
            <Marked text={item.text} highlight={highlight} />
          </pre>
        );
      }
      if (item.type === "image" && item.data && item.mimeType) {
        return <img key={key} src={`data:${item.mimeType};base64,${item.data}`} alt={t("mcpToolResultRenderer.imageAlt")} className={cn("max-w-full", layout.rounded)} />;
      }
      if (item.type === "resource" && item.uri) {
        return (
          <div key={key} className={cn(layout.bodyText, "text-foreground")}>
            <span className="font-medium">{t("mcpToolResultRenderer.resource")}:</span>{" "}
            <span className="font-mono">
              <Marked text={item.uri} highlight={highlight} />
            </span>
          </div>
        );
      }
    }
    return <TruncatedPre key={key} content={safeStringify(block)} className={cn(layout.bodyText, "text-foreground bg-muted p-2 overflow-x-auto", layout.rounded)} />;
  };

  return (
    <ResultRow verb="mcp" family="other" result={result} toolUseId={toolUseId}>
      {Array.isArray(content) ? <div className="space-y-2">{(content as unknown[]).map((block, index) => renderBlock(block, index))}</div> : renderBlock(content)}
    </ResultRow>
  );
});
