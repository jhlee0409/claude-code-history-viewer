import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { memo } from "react";
import { useResultProvider } from "../../transcript/resultProvider";
import { Workflow as WorkflowIcon, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";
import { CodeTarget, Marked, TargetWell, TextTarget, ToolRow, WhenTargetCut, type TextHighlight } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { searchHits, str } from "./shared";
import { parseWorkflowName, parseWorkflowRunId } from "./workflowParsing";

/**
 * Workflow (TR1a): one ToolRow.
 *
 * Row: the recorded tool name · the workflow's name from its script (or its
 * description) · the outcome from `toolOutcome` only. Opened: the Input
 * zone (the description, the whole name when the row cuts it, the script),
 * the Result zone (the result as recorded), the run id in the meta line,
 * then the run's agent conversations, an aside outside both zones (links
 * to other transcripts). No fill, no green check (#731).
 *
 * Search: a hit in the name, the description or the run id opens the row
 * once per query; the hit is marked in the row and again in the detail, so
 * a hit the row's ellipsis hides is still seen.
 */
export const WorkflowCard = memo(function WorkflowCard({ toolUse, toolResults, searchQuery = "", isCurrentMatch = false, currentMatchIndex = 0 }: Props) {
  const provider = useResultProvider();
  const { t } = useTranslation();
  const subagentSessions = useAppStore((s) => s.subagentSessions);
  const navigateToSubagent = useAppStore((s) => s.navigateToSubagent);

  const name = (toolUse.name as string) || "Workflow";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const description = str(input, "description") ?? "";
  const script = str(input, "script");
  const workflowName = parseWorkflowName(script);
  const runId = parseWorkflowRunId(toolResults);
  const runAgents = runId ? subagentSessions.filter((s) => s.workflow_run_id === runId) : [];
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family, provider);
  const expandKey = `unified-${toolId}`;

  const hit = searchHits(searchQuery, workflowName, description, runId);
  const highlight: TextHighlight | undefined = hit ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined;

  const target = workflowName ? (
    <CodeTarget text={workflowName} highlight={highlight} />
  ) : description ? (
    <TextTarget text={description} highlight={highlight} />
  ) : undefined;
  const viewLabel = t("renderers.agentTool.viewConversation", { defaultValue: "View Conversation" });

  return (
    <ToolRow
      icon={<WorkflowIcon className="w-4 h-4" />}
      verb={name}
      target={target}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
      revealFor={hit ? searchQuery : undefined}
      detailMeta={
        runId ? (
          <code data-mono="code" className="font-mono">
            <Marked text={runId} highlight={highlight} />
          </code>
        ) : undefined
      }
    >
      <DetailZone kind="input" show={script || (workflowName && description) ? true : workflowName || description ? "whenTargetCut" : false}>
        {workflowName && description && (
          <p className="whitespace-pre-wrap text-list text-fg-2">
            <Marked text={description} highlight={highlight} />
          </p>
        )}
        {workflowName && <TargetWell text={workflowName} highlight={highlight} />}
        {!workflowName && description && (
          <WhenTargetCut>
            <p className="whitespace-pre-wrap text-list text-fg-2">
              <Marked text={description} highlight={highlight} />
            </p>
          </WhenTargetCut>
        )}
        {script && (
          <section className="space-y-1">
            <div className="text-caption text-fg-3">{t("renderers.workflowTool.script", { defaultValue: "Script" })}</div>
            <OutputBlock text={script} source="file" wrap={false} expandKey={`${expandKey}-script`} searchQuery={searchQuery} />
          </section>
        )}
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} searchQuery={searchQuery} />
      </DetailZone>
      {runAgents.length > 0 && (
        <section data-detail-aside="" className="space-y-1">
          <div className="text-caption text-fg-3">
            {t("renderers.workflowTool.agents", { defaultValue: "Workflow agents" })} ({runAgents.length})
          </div>
          <ul>
            {runAgents.map((agent) => (
              <li key={agent.file_path}>
                <Button variant="ghost" size="sm"
                  type="button"
                  onClick={() => {
                    void navigateToSubagent(agent);
                  }}
                  className={cn("h-auto whitespace-normal justify-start font-normal", "flex min-h-row-list w-full items-center gap-2 rounded-row px-1 text-left text-list hover:bg-surface-hover")}
                  aria-label={viewLabel}
                >
                  <ExternalLink aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1 truncate text-fg-2">{agent.summary || agent.agent_id}</span>
                  <span className="shrink-0 text-caption text-fg-3">
                    {t("renderers.agentTool.messages", { defaultValue: "{{count}} messages", count: agent.message_count })}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ToolRow>
  );
});
