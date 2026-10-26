import { memo } from "react";
import { Bot, Cpu, ExternalLink, Hammer, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TextTarget, ToolRow, WhenTargetCut } from "../../transcript/ToolRow";
import { ProseBlock } from "../../transcript/ProseBlock";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { afterFirstResultText, firstResultText, hasShownResults, recordedAgentStats, toolFamily, toolOutcome, withoutErrorCodeEcho } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { plainPreview, str } from "./shared";
import { isNonEmptyString, shownIf, unshown } from "./recordShape";
import { OtherRecordedFields } from "./toolBodyParts";
import { useFormat } from "@/lib/format/useFormat";
import { numberCopyBoundary } from "@/lib/format/copyNumbers";
import { Num } from "@/lib/format/Num";

/**
 * Agent / Task (TR1a, renderer audit NC3): one ToolRow.
 *
 * Row: the recorded tool name · the task description (or the prompt's first
 * line as plain words: no raw `**`) · the subagent type and the background
 * flag as plain caption text (no pill, no uppercase) · the outcome from
 * `toolOutcome` only. Opened: the whole description when the row cuts it,
 * the model and isolation in the meta line, then the Input zone (the
 * prompt) and the Result zone (its duration, tokens and tool count on the
 * label's line) as prose blocks — no nested folds, no fill, no green check;
 * after the first result text, every other part the results recorded, as
 * output — and "View Conversation", an aside outside both zones (it leaves for
 * the subagent's own transcript).
 */
export const AgentCard = memo(function AgentCard({ toolUse, toolResults, onViewSubagent, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const name = (toolUse.name as string) || "Agent";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const description = str(input, "description") ?? "";
  const prompt = str(input, "prompt") ?? "";
  const subagentType = str(input, "subagent_type");
  const runInBackground = input.run_in_background === true;
  const model = str(input, "model");
  const isolation = str(input, "isolation");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;
  const rest = unshown(input, {
    description: shownIf(isNonEmptyString),
    prompt: shownIf(isNonEmptyString),
    subagent_type: shownIf(isNonEmptyString),
    run_in_background: shownIf((v) => v === true),
    model: shownIf(isNonEmptyString),
    isolation: shownIf(isNonEmptyString),
  });
  const hasRest = Object.keys(rest).length > 0;

  const shownResults = withoutErrorCodeEcho(toolResults);
  const resultText = firstResultText(shownResults);
  // Everything else the results recorded (a second text block such as Claude's
  // agentId / usage note, images, other results) follows the prose, in order
  // (review round 1 of PR #746, F1).
  const restResults = resultText !== null ? afterFirstResultText(shownResults) : [];
  const stats = recordedAgentStats(toolResults);

  const promptPreview = description ? "" : plainPreview(prompt);
  const target = description ? <TextTarget text={description} /> : promptPreview ? <TextTarget text={promptPreview} /> : undefined;
  const viewLabel = t("renderers.agentTool.viewConversation", { defaultValue: "View Conversation" });

  return (
    <ToolRow
      icon={<Bot className="w-4 h-4" />}
      verb={name}
      target={target}
      meta={
        <>
          {subagentType && <span>{subagentType}</span>}
          {runInBackground && <span>{t("renderers.agentTool.background", { defaultValue: "background" })}</span>}
        </>
      }
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
      detailMeta={
        <>
          {model && (
            <span className="inline-flex items-center gap-1">
              <Cpu aria-hidden="true" className="w-3.5 h-3.5" />
              <code data-mono="code" className="font-mono">
                {model}
              </code>
            </span>
          )}
          {isolation && (
            <span>
              {t("renderers.agentTool.isolation", { defaultValue: "Isolation" })}:{" "}
              <code data-mono="code" className="font-mono">
                {isolation}
              </code>
            </span>
          )}
        </>
      }
    >
      <DetailZone kind="input" show={prompt || hasRest ? true : description ? "whenTargetCut" : false}>
        {description && (
          <WhenTargetCut>
            <p className="whitespace-pre-wrap text-list text-fg-2">{description}</p>
          </WhenTargetCut>
        )}
        {prompt && <ProseBlock text={prompt} expandKey={`${expandKey}-prompt`} />}
        <OtherRecordedFields rest={rest} expandKey={expandKey} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />
      </DetailZone>
      <DetailZone
        kind="result"
        show={resultText ? true : hasShownResults(toolResults)}
        meta={
          <>
            {stats.totalDurationMs != null && (
              <span className="inline-flex items-center gap-1">
                <Timer aria-hidden="true" className="w-3.5 h-3.5" />
                <Num>{fmt.duration(stats.totalDurationMs)}</Num>
              </span>
            )}
            {stats.totalTokens != null && (
              <span {...numberCopyBoundary} className="inline-flex items-center gap-1">
                <Cpu aria-hidden="true" className="w-3.5 h-3.5" />
                <Num>{fmt.tokens(stats.totalTokens)}</Num>
              </span>
            )}
            {stats.totalToolUseCount != null && (
              <span className="inline-flex items-center gap-1">
                <Hammer aria-hidden="true" className="w-3.5 h-3.5" />
                {stats.totalToolUseCount}
              </span>
            )}
          </>
        }
      >
        {resultText ? (
          <>
            <ProseBlock text={resultText} expandKey={`${expandKey}-result`} />
            {restResults.length > 0 && (
              <ToolResultOutputs results={restResults} family={family} expandKey={`${expandKey}-rest`} failed={outcome.verdict === "failed"} />
            )}
          </>
        ) : (
          <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} />
        )}
      </DetailZone>
      {onViewSubagent && (
        <button
          data-detail-aside=""
          type="button"
          onClick={() => {
            onViewSubagent(toolId);
          }}
          className="inline-flex min-h-6 items-center gap-1.5 rounded-row px-1 text-list text-fg-2 hover:bg-surface-hover hover:text-fg"
          aria-label={viewLabel}
        >
          <ExternalLink aria-hidden="true" className="w-3.5 h-3.5" />
          {viewLabel}
        </button>
      )}
    </ToolRow>
  );
});
