import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../ToolIcon";
import { CodeTarget, Marked, ToolRow, type TextHighlight } from "../transcript/ToolRow";
import { DetailZone } from "../transcript/DetailZone";
import { ResultRowContext } from "../transcript/resultRowContext";
import { toolFamily, toolOutcome, type ToolFamily } from "../transcript/toolOutcome";
import { useToolPathContext } from "../transcript/pathContext";
import { routedBody } from "./unifiedCards/toolBodies";
import { searchHits } from "./unifiedCards/shared";
import { ServerResult } from "./ServerResult";
import { serverResultTexts } from "./serverResultText";

interface Props {
  /** The recorded `server_tool_use` / `mcp_tool_use` block. */
  toolUse: Record<string, unknown>;
  /** Its result blocks from the same message (`contentEntries` pairs them). */
  results?: Record<string, unknown>[];
  /** The recorded tool name (default: the block's `name`; MCP: its `tool_name`). */
  verb?: string;
  /** The MCP server the tool belongs to (`server_name`), shown as caption meta. */
  serverName?: string;
  family?: ToolFamily;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

const NO_RESULTS: Record<string, unknown>[] = [];
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A server-side tool call (`server_tool_use`: web_search, web_fetch,
 * code_execution, bash_code_execution, text_editor_code_execution,
 * tool_search, advisor) or an MCP connector call (`mcp_tool_use`, through
 * `MCPToolUseRenderer`) as one ToolRow (TR1b), like a paired `tool_use`:
 *
 * - Head: the recorded tool name (D-R5) · the input's summary as the target
 *   (a path relative, D1) · the MCP server as caption meta · the outcome from
 *   `toolOutcome` over its result blocks — none: "No result recorded"; an
 *   `error_code` in the result: "Failed · <code>"; `is_error`: "Failed"; a
 *   recorded return code decides a code-execution result.
 * - Opened: the Input zone (the D-R1 body for the name, honest JSON with
 *   "Show all" otherwise), then the Result zone with each result block's
 *   existing body (`ServerResult`, drawn without a head of its own), then the
 *   meta line ending in "Copy tool ID".
 *
 * Before TR1b the call was a `ToolUseCard` ("Web search", a "Show input"
 * fold without aria) and each result a separate `ToolResultCard` after it.
 *
 * Search: a hit in the input, the names or the results opens the row once
 * per query (an effect keyed on the query) and is marked where it is shown;
 * a hit in the names (the verb is plain) is repeated, marked, in the detail
 * meta line.
 */
export const ServerToolUseRenderer = memo(function ServerToolUseRenderer({
  toolUse,
  results = NO_RESULTS,
  verb,
  serverName,
  family,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const name = verb ?? (typeof toolUse.name === "string" ? toolUse.name : "");
  const toolId = typeof toolUse.id === "string" ? toolUse.id : "";
  const input = isRecord(toolUse.input) ? toolUse.input : {};
  const rowFamily = family ?? toolFamily(name);
  const outcome = toolOutcome(toolUse, results, rowFamily);
  const expandKey = `unified-${toolId}`;

  const inputHit = searchHits(searchQuery, JSON.stringify(input, null, 2));
  const nameHit = searchHits(searchQuery, name, serverName);
  const resultHit = searchHits(searchQuery, ...serverResultTexts(results));
  const hit = inputHit || nameHit || resultHit;
  const highlight: TextHighlight | undefined = hit ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined;
  const routed = routedBody(name, { input, expandKey, pathCtx, t, searchQuery, highlight: inputHit ? highlight : undefined });
  // Server code execution records its program as `code`: its first line is the target.
  const code = typeof input.code === "string" ? input.code.trimStart().split("\n")[0] ?? "" : "";
  const target = routed.target ?? (code ? <CodeTarget text={code} full={input.code as string} highlight={inputHit ? highlight : undefined} /> : undefined);

  return (
    <ToolRow
      icon={<ToolIcon toolName={name} title={null} className="w-4 h-4" />}
      verb={name || t("common.unknown")}
      target={target}
      meta={
        serverName || routed.meta ? (
          <>
            {serverName && (
              <span data-mono="code" className="font-mono">
                <Marked text={serverName} highlight={highlight} />
              </span>
            )}
            {routed.meta}
          </>
        ) : undefined
      }
      outcome={outcome}
      family={rowFamily}
      toolId={toolId}
      expandKey={expandKey}
      revealFor={hit ? searchQuery : undefined}
      detailMeta={
        nameHit && name ? (
          <code data-mono="code" className="font-mono">
            <Marked text={serverName ? `${serverName} / ${name}` : name} highlight={highlight} />
          </code>
        ) : undefined
      }
    >
      <DetailZone kind="input" meta={routed.inputMeta}>
        {routed.body}
      </DetailZone>
      <DetailZone kind="result" show={results.length > 0}>
        <ResultRowContext.Provider value={{ paired: true, highlight: resultHit ? highlight : undefined }}>
          {results.map((block, index) => (
            <ServerResult key={index} block={block} />
          ))}
        </ResultRowContext.Provider>
      </DetailZone>
    </ToolRow>
  );
});
