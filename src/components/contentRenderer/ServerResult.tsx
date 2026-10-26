/**
 * One server / API result block, drawn by its existing renderer (TR1b).
 * Used inside its call's ToolRow (`ServerToolUseRenderer`, where the
 * renderer draws its body only) and for a result whose call is not in the
 * message (`ClaudeContentArrayRenderer`, where it draws its own
 * `ResultRow`). A block its renderer's guard rejects (a missing
 * `tool_use_id`, no `content`) is still shown, as the generic fallback of
 * every recorded key, never dropped.
 */
import { memo } from "react";
import {
  isWebSearchToolResultContent,
  isWebFetchToolResultContent,
  isCodeExecutionToolResultContent,
  isBashCodeExecutionToolResultContent,
  isTextEditorCodeExecutionToolResultContent,
  isToolSearchToolResultContent,
  isAdvisorToolResultContent,
  isMCPToolResultContent,
} from "@/utils/contentTypeGuards";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { FallbackRenderer } from "../toolResultRenderer/FallbackRenderer";
import { WebSearchResultRenderer } from "./WebSearchResultRenderer";
import { WebFetchToolResultRenderer } from "./WebFetchToolResultRenderer";
import { CodeExecutionToolResultRenderer } from "./CodeExecutionToolResultRenderer";
import { BashCodeExecutionToolResultRenderer } from "./BashCodeExecutionToolResultRenderer";
import { TextEditorCodeExecutionToolResultRenderer } from "./TextEditorCodeExecutionToolResultRenderer";
import { ToolSearchToolResultRenderer } from "./ToolSearchToolResultRenderer";
import { AdvisorToolResultRenderer } from "./AdvisorToolResultRenderer";
import { MCPToolResultRenderer } from "./MCPToolResultRenderer";

const NESTED_OPEN = { defaultExpanded: true };

export const ServerResult = memo(function ServerResult({ block }: { block: Record<string, unknown> }) {
  if (isWebSearchToolResultContent(block)) return <WebSearchResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isWebFetchToolResultContent(block)) return <WebFetchToolResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isCodeExecutionToolResultContent(block)) return <CodeExecutionToolResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isBashCodeExecutionToolResultContent(block)) return <BashCodeExecutionToolResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isTextEditorCodeExecutionToolResultContent(block)) return <TextEditorCodeExecutionToolResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isToolSearchToolResultContent(block)) return <ToolSearchToolResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isAdvisorToolResultContent(block)) return <AdvisorToolResultRenderer toolUseId={block.tool_use_id} content={block.content} />;
  if (isMCPToolResultContent(block)) return <MCPToolResultRenderer toolUseId={block.tool_use_id} content={block.content} isError={block.is_error === true} />;
  return (
    <RendererDefaultsContext.Provider value={NESTED_OPEN}>
      <FallbackRenderer toolResult={block} />
    </RendererDefaultsContext.Provider>
  );
});
