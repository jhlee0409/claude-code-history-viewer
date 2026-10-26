/**
 * One server / API result block, drawn by its existing renderer (TR1b).
 * Used inside its call's ToolRow (`ServerToolUseRenderer`, where the
 * renderer draws its body only) and for a result whose call is not in the
 * message (`ClaudeContentArrayRenderer`, where it draws its own
 * `ResultRow`). A block its renderer's guard rejects (a missing
 * `tool_use_id`, no `content`) is still shown, as the generic fallback of
 * every recorded key, never dropped.
 */
import { memo, useMemo } from "react";
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
import { ResultRowContext, type ResultRowContextValue } from "../transcript/resultRowContext";
import { searchHits } from "./unifiedCards/shared";
import { serverResultTexts } from "./serverResultText";

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

interface StandaloneServerResultProps {
  block: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

/**
 * A server / API result whose call is not in the message (a message's own
 * content, or a result's nested content array): its own `ResultRow`, with
 * the same per-query search contract as a paired server call (review
 * round 1 of PR #746, F2; CodeRabbit 4377267887). A hit in a field the
 * conversation search counts (`serverResultTexts`, the index's fields)
 * opens the row once per query and the body marks it; otherwise the
 * context carries no highlight and the row keeps the user's state.
 */
export const StandaloneServerResult = memo(function StandaloneServerResult({
  block,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: StandaloneServerResultProps) {
  const hit = searchHits(searchQuery, ...serverResultTexts([block]));
  const value = useMemo<ResultRowContextValue>(
    () => ({ paired: false, highlight: hit ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined }),
    [hit, searchQuery, isCurrentMatch, currentMatchIndex],
  );
  return (
    <ResultRowContext.Provider value={value}>
      <ServerResult block={block} />
    </ResultRowContext.Provider>
  );
});
