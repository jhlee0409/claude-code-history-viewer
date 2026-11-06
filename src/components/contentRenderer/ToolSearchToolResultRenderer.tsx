import { memo, useContext } from "react";
import { useTranslation } from "react-i18next";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";
import { OutputBlock } from "../transcript/OutputBlock";
import { safeStringify } from "@/utils/jsonUtils";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

/** SDK content is a reference container, not an array of tool definitions.
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L8010-L8057
 * Validate every member; unsupported/legacy records remain honest JSON. */
export const ToolSearchToolResultRenderer = memo(function ToolSearchToolResultRenderer({ toolUseId, content }: { toolUseId: string; content: unknown }) {
  const { t } = useTranslation();
  const { highlight } = useContext(ResultRowContext);
  const c = content != null && typeof content === "object" && !Array.isArray(content) ? content as Record<string, unknown> : {};
  const references = c.type === "tool_search_tool_search_result" && Array.isArray(c.tool_references) && c.tool_references.every(item => item != null && typeof item === "object" && item.type === "tool_reference" && typeof item.tool_name === "string") ? c.tool_references as { type: "tool_reference"; tool_name: string }[] : null;
  const error = c.type === "tool_search_tool_result_error";
  const errors = getCommonToolErrorMessages(t);
  return <ResultRow verb="tool_search" result={{ type: "tool_search_tool_result", tool_use_id: toolUseId, content }} toolUseId={toolUseId} meta={references ? `${references.length} ${t("toolSearchToolResultRenderer.found")}` : undefined}>
    {error && typeof c.error_code === "string" && errors[c.error_code] && <div className="text-body text-fg-2">{errors[c.error_code]}</div>}
    {error && typeof c.error_message === "string" && <div className="text-body text-fg-2"><Marked text={c.error_message} highlight={highlight} /></div>}
    {references?.length === 0 && <div className="text-caption text-fg-3">{t("toolSearchToolResultRenderer.noResults")}</div>}
    {references && <ul className="space-y-2">{references.map((item, index) => <li key={index} className="break-words text-body text-fg"><Marked text={item.tool_name} highlight={highlight} /></li>)}</ul>}
    <OutputBlock text={safeStringify(content, 2)} source="text" json expandKey={`tool-search-record-${toolUseId}`} searchQuery={highlight?.searchQuery} highlight={highlight} />
  </ResultRow>;
});
