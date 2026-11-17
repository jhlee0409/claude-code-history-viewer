"use client";

import { memo } from "react";
import { useResultProvider } from "../transcript/resultProvider";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../ToolIcon";
import { Marked, TextTarget, ToolRow, type TextHighlight } from "../transcript/ToolRow";
import { ToolResultOutputs } from "../transcript/ToolResultOutputs";
import { DetailZone } from "../transcript/DetailZone";
import { hasShownResults, normalizeResult, resultContent, toolFamily, toolOutcome } from "../transcript/toolOutcome";
import { searchHits } from "../contentRenderer/unifiedCards/shared";
import { useAppStore } from "../../store/useAppStore";
import type { IndexedRendererProps } from "../renderers";

interface ClaudeToolResultItemProps extends IndexedRendererProps {
  toolResult: Record<string, unknown>;
  /**
   * The result is a block of a message's own content (the transcript's top
   * level), where the backend pairs a result with its call per page: an
   * unmatched result there may answer a call on an earlier page. `false`
   * (default) for a result nested in another result's content array.
   */
  atPageBoundary?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The recorded name of the loaded `tool_use` with this id (a content block or a message's `toolUse`), else null. */
function loadedCallName(messages: readonly unknown[], toolUseId: string): string | null {
  if (toolUseId === "") return null;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of [...blocks, message.toolUse]) {
      if (isRecord(block) && block.id === toolUseId && (block.type === "tool_use" || block.type === undefined) && typeof block.name === "string") return block.name;
    }
  }
  return null;
}

/** The result texts the conversation search counts, read through the outcome adapter: text parts and recorded streams. */
function resultTexts(result: Record<string, unknown>): string[] {
  const streams = normalizeResult(result);
  const parts = resultContent(result).parts.flatMap((part) => (part.kind === "text" ? [part.text] : []));
  return [...parts, streams.stdout ?? "", streams.stderr ?? ""].filter((text) => text !== "");
}

/**
 * A `tool_result` whose call is not in the same message (TR1b): one ToolRow,
 * its verdict from the result alone (`toolOutcome(null, [result])`: an
 * `is_error` result is "Failed", a recorded exit code is evidence, a result
 * without an error signal is quiet — no success pill, no tool-colour fill).
 *
 * The backend pairs a result with its call per page
 * (`merge_tool_execution_messages`), so at the transcript's top level a
 * result whose call sits on an earlier page arrives alone. Its head says so:
 * "Call on an earlier page" while older messages are still unloaded, or when
 * the call is in an earlier loaded message (then the call's recorded name is
 * the verb; without it, the verb is the zone's word "Result"). With every message loaded and no call anywhere — and for a
 * result nested in another result's content array, which has no page — it
 * says "Call not recorded" instead (no false page claim).
 *
 * Opened: the Result zone with the result as recorded (`ToolResultOutputs`,
 * as a paired call's: text runs as output, images and other blocks through
 * the result renderers, streams in their zones), then the meta line ending in
 * "Copy tool ID". Search: a hit in the tool id or the result text opens the
 * row once per query and is marked.
 *
 * Before TR1b: a `RendererHeader` card "Tool execution result" with a
 * success-coloured check, and two text sniffers (numbered lines → a code card
 * with a guessed language; "Found N files" → a file list card); the raw
 * output shows the same text, as a paired Read / Glob does (amendment 10:
 * deleted).
 */
export const ClaudeToolResultItem = memo(function ClaudeToolResultItem({
  toolResult,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
  atPageBoundary = false,
}: ClaudeToolResultItemProps) {
  const provider = useResultProvider();
  const { t } = useTranslation();
  const toolUseId = typeof toolResult.tool_use_id === "string" ? toolResult.tool_use_id : "";
  const callName = useAppStore((s) => (atPageBoundary ? loadedCallName(s.messages, toolUseId) : null));
  const olderUnloaded = useAppStore((s) => atPageBoundary && s.pagination.hasMore);
  const earlierPage = atPageBoundary && (olderUnloaded || callName !== null);

  const name = callName ?? "";
  const family = toolFamily(name);
  const results = [toolResult];
  const outcome = toolOutcome(null, results, family, provider);
  const expandKey = `result-${toolUseId}`;

  const idHit = searchHits(searchQuery, toolUseId);
  const contentHit = searchHits(searchQuery, ...resultTexts(toolResult));
  const highlight: TextHighlight | undefined = idHit || contentHit ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined;

  return (
    <ToolRow
      icon={<ToolIcon toolName={name} title={null} className="w-4 h-4" />}
      verb={name || t("toolRow.resultZone")}
      target={<TextTarget text={t(earlierPage ? "toolRow.callOnEarlierPage" : "toolRow.callNotRecorded")} />}
      outcome={outcome}
      family={family}
      toolId={toolUseId}
      expandKey={expandKey}
      revealFor={highlight ? searchQuery : undefined}
      detailMeta={
        idHit ? (
          <code data-mono="code" className="font-mono">
            <Marked text={toolUseId} highlight={highlight} />
          </code>
        ) : undefined
      }
    >
      <DetailZone kind="result" show={hasShownResults(results)}>
        <ToolResultOutputs
          results={results}
          family={family}
          expandKey={expandKey}
          failed={outcome.verdict === "failed"}
          searchQuery={searchQuery}
          highlight={contentHit ? { isCurrentMatch, currentMatchIndex } : undefined}
        />
      </DetailZone>
    </ToolRow>
  );
});
