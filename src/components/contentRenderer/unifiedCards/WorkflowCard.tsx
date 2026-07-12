import { memo, useState } from "react";
import {
  Workflow as WorkflowIcon,
  Bot,
  CheckCircle2,
  ChevronDown, ChevronRight, ScrollText,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { getVariantStyles, layout } from "../../renderers";
import { Markdown } from "../../common/Markdown";
import { useAppStore } from "../../../store/useAppStore";
import type { Props } from "./shared";
import { str, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";
import {
  extractWorkflowResultText,
  parseWorkflowName,
  parseWorkflowRunId,
} from "./workflowParsing";

export const WorkflowCard = memo(function WorkflowCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const [isScriptOpen, setIsScriptOpen] = useState(false);
  const [isResultOpen, setIsResultOpen] = useState(false);
  const subagentSessions = useAppStore((s) => s.subagentSessions);
  const navigateToSubagent = useAppStore((s) => s.navigateToSubagent);

  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const description = str(input, "description") ?? "";
  const script = str(input, "script");
  const workflowName = parseWorkflowName(script);

  const runId = parseWorkflowRunId(toolResults);
  const runAgents = runId
    ? subagentSessions.filter((s) => s.workflow_run_id === runId)
    : [];

  const taskStyles = getVariantStyles("task");
  const resultText = toolResults.length > 0 ? extractWorkflowResultText(toolResults) : null;

  return (
    <Renderer className={taskStyles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${toolId}`}>
      <Renderer.Header
        title={t("renderers.workflowTool.title", { defaultValue: "Workflow" })}
        icon={<WorkflowIcon className={cn(layout.iconSize, taskStyles.icon)} />}
        titleClassName={taskStyles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {workflowName && (
              <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, taskStyles.badge, taskStyles.badgeText)}>
                {workflowName}
              </code>
            )}
            <StatusBadge results={toolResults} />
            {runId && (
              <code className={cn(layout.monoText, "hidden md:inline px-2 py-0.5", layout.rounded, "bg-muted/50 border border-border text-muted-foreground")}>
                {runId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        {/* Description */}
        {description && (
          <div className={cn("flex items-start gap-2 p-2.5 mb-3 border", layout.rounded, taskStyles.badge, "border-tool-task/30")}>
            <WorkflowIcon className={cn("w-4 h-4 shrink-0 mt-0.5", taskStyles.icon)} />
            <span className={cn(layout.bodyText, "text-foreground font-medium")}>{description}</span>
          </div>
        )}

        {/* Script — collapsible */}
        {script && (
          <div className={cn("border mb-3", layout.rounded, "border-border overflow-hidden")}>
            <button type="button" onClick={() => setIsScriptOpen(p => !p)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors bg-muted/20")}
              aria-label={t("renderers.workflowTool.toggleScript", { defaultValue: "Toggle script" })}>
              {isScriptOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              <ScrollText className={cn("w-3.5 h-3.5", taskStyles.icon)} />
              <span className={cn(layout.smallText, "font-medium text-foreground/80")}>{t("renderers.workflowTool.script", { defaultValue: "Script" })}</span>
            </button>
            {isScriptOpen && (
              <pre className={cn("px-3 py-2 border-t border-border max-h-96 overflow-auto", layout.monoText, "text-px11 text-foreground/90 whitespace-pre-wrap")}>
                {script}
              </pre>
            )}
          </div>
        )}

        {/* Result — collapsible */}
        {resultText ? (
          <div className={cn("border mb-3", layout.rounded, "border-border overflow-hidden")}>
            <button type="button" onClick={() => setIsResultOpen(p => !p)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors bg-muted/20")}
              aria-label={t("renderers.agentTool.toggleResult", { defaultValue: "Toggle result" })}>
              {isResultOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className={cn(layout.smallText, "font-medium text-foreground/80")}>{t("renderers.agentTool.result", { defaultValue: "Result" })}</span>
            </button>
            {isResultOpen && <div className="px-3 py-2 border-t border-border max-h-[32rem] overflow-y-auto"><Markdown className="text-foreground/90">{resultText}</Markdown></div>}
          </div>
        ) : (
          <ResultBlock results={toolResults} />
        )}

        {/* Workflow agents — the run's sub-agent conversations */}
        {runAgents.length > 0 && (
          <div className={cn("border", layout.rounded, "border-border overflow-hidden")}>
            <div className={cn("flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border", layout.smallText)}>
              <Bot className={cn("w-3.5 h-3.5", taskStyles.icon)} />
              <span className="font-medium text-foreground/80">
                {t("renderers.workflowTool.agents", { defaultValue: "Workflow agents" })}
              </span>
              <span className="text-muted-foreground">({runAgents.length})</span>
            </div>
            <ul>
              {runAgents.map((agent) => (
                <li key={agent.file_path} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => { void navigateToSubagent(agent); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary/5 transition-colors",
                      layout.smallText,
                    )}
                    aria-label={t("renderers.agentTool.viewConversation", { defaultValue: "View Conversation" })}
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="truncate flex-1 text-foreground/90">
                      {agent.summary || agent.agent_id}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {t("renderers.agentTool.messages", {
                        defaultValue: "{{count}} messages",
                        count: agent.message_count,
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
