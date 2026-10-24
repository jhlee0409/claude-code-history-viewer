import { memo, useState } from "react";
import {
  CircleCheck,
  Bot,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Timer,
  Cpu,
  Hammer,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { getVariantStyles, layout } from "../../renderers";
import { Markdown } from "../../common/Markdown";
import { getSubagentStyle } from "@/utils/agentStyles";
import type { ToolResultLike, Props } from "./shared";
import { CARD_FRAME, str } from "./shared";
import { OutcomeStatus } from "../../transcript/OutcomeStatus";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { ResultBlock } from "./ResultBlock";
import { ToolIdBadge } from "./ToolIdBadge";
import { useFormat } from "@/lib/format/useFormat";
import { numberCopyBoundary } from "@/lib/format/copyNumbers";
import { Num } from "@/lib/format/Num";

function extractAgentResultText(results: ToolResultLike[]): string | null {
  for (const r of results) {
    const c = r.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === "object" && item != null &&
          (item as Record<string, unknown>).type === "text" &&
          "text" in item
        ) return String((item as Record<string, unknown>).text);
      }
    }
  }
  return null;
}


export const AgentCard = memo(function AgentCard({ toolUse, toolResults, onViewSubagent }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isResultOpen, setIsResultOpen] = useState(false);

  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const description = str(input, "description") ?? "";
  const prompt = str(input, "prompt") ?? "";
  const subagentType = str(input, "subagent_type") ?? undefined;
  const runInBackground = input.run_in_background === true;
  const model = str(input, "model");
  const isolation = str(input, "isolation");

  const badge = getSubagentStyle(subagentType);
  const SubIcon = badge.icon;
  const taskStyles = getVariantStyles("task");
  const outcome = toolOutcome(toolUse, toolResults, toolFamily((toolUse.name as string) || "Agent"));

  const hasResult = toolResults.length > 0;
  const resultText = hasResult ? extractAgentResultText(toolResults) : null;
  const first = toolResults[0];
  const totalDurationMs = first?.totalDurationMs as number | undefined;
  const totalTokens = first?.totalTokens as number | undefined;
  const totalToolUseCount = first?.totalToolUseCount as number | undefined;

  return (
    <Renderer className={CARD_FRAME} hasError={outcome.verdict === "failed"} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title={t("renderers.agentTool.title", { defaultValue: "Agent" })}
        icon={<Bot className={cn(layout.iconSize, taskStyles.icon)} />}
        titleClassName={taskStyles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {subagentType && (
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 font-mono text-caption uppercase tracking-wide", layout.rounded, badge.bg, badge.text, "border", badge.border)}>
                <SubIcon className="w-3.5 h-3.5" />{subagentType}
              </span>
            )}
            {runInBackground && (
              <span className={cn("px-1.5 py-0.5", layout.rounded, "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30")}>
                {t("renderers.agentTool.background", { defaultValue: "background" })}
              </span>
            )}
            <OutcomeStatus outcome={outcome} />
            <ToolIdBadge toolId={toolId} badgeClassName={taskStyles.badge} badgeTextClassName={taskStyles.badgeText} />
          </div>
        }
      />
      <Renderer.Content>
        {/* Description */}
        {description && (
          <div className={cn("flex items-start gap-2 p-2.5 mb-3 border", layout.rounded, taskStyles.badge, "border-tool-task/30")}>
            <SubIcon className={cn("w-4 h-4 shrink-0 mt-0.5", badge.text)} />
            <span className={cn(layout.bodyText, "text-foreground font-medium")}>{description}</span>
          </div>
        )}

        {/* Meta */}
        {(model || isolation) && (
          <div className={cn("mb-3 flex items-center gap-3 flex-wrap", layout.smallText)}>
            {model && <span className="flex items-center gap-1 text-muted-foreground"><Cpu className="w-3.5 h-3.5" /><code className={layout.monoText}>{model}</code></span>}
            {isolation && <span className="text-muted-foreground">{t("renderers.agentTool.isolation", { defaultValue: "Isolation" })}: <code className={cn("px-1.5 py-0.5", layout.rounded, "bg-muted/50 border border-border")}>{isolation}</code></span>}
          </div>
        )}

        {/* Prompt — collapsible markdown */}
        {prompt && (
          <div className={cn("border mb-3", layout.rounded, "border-border overflow-hidden")}>
            <button type="button" onClick={() => setIsPromptOpen(p => !p)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors bg-muted/20")}
              aria-label={t("renderers.agentTool.togglePrompt", { defaultValue: "Toggle prompt" })}>
              {isPromptOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              <CirclePlay className={cn("w-3.5 h-3.5", taskStyles.icon)} />
              <span className={cn(layout.smallText, "font-medium text-foreground/80")}>{t("renderers.agentTool.prompt", { defaultValue: "Prompt" })}</span>
              {!isPromptOpen && <span className={cn(layout.smallText, "text-muted-foreground truncate flex-1")}>— {prompt.split("\n")[0]?.slice(0, 80)}{(prompt.split("\n")[0]?.length ?? 0) > 80 ? "…" : ""}</span>}
            </button>
            {isPromptOpen && <div className="px-3 py-2 border-t border-border max-h-96 overflow-y-auto"><Markdown className="text-foreground/90">{prompt}</Markdown></div>}
          </div>
        )}

        {/* Result — collapsible markdown with stats */}
        {hasResult && resultText ? (
          <div className={cn("border", layout.rounded, "border-border overflow-hidden")}>
            <button type="button" onClick={() => setIsResultOpen(p => !p)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors bg-muted/20")}
              aria-label={t("renderers.agentTool.toggleResult", { defaultValue: "Toggle result" })}>
              {isResultOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              <CircleCheck className="w-3.5 h-3.5 text-success" />
              <span className={cn(layout.smallText, "font-medium text-foreground/80")}>{t("renderers.agentTool.result", { defaultValue: "Result" })}</span>
              <div className={cn("flex items-center gap-2 ml-auto", layout.smallText)}>
                {totalDurationMs != null && <span className="inline-flex items-center gap-1 text-muted-foreground"><Timer className="w-3.5 h-3.5" /><Num>{fmt.duration(totalDurationMs)}</Num></span>}
                {totalTokens != null && <span {...numberCopyBoundary} className="inline-flex items-center gap-1 text-muted-foreground"><Cpu className="w-3.5 h-3.5" /><Num>{fmt.tokens(totalTokens)}</Num></span>}
                {totalToolUseCount != null && <span className="inline-flex items-center gap-1 text-muted-foreground"><Hammer className="w-3.5 h-3.5" />{totalToolUseCount}</span>}
              </div>
            </button>
            {isResultOpen && <div className="px-3 py-2 border-t border-border max-h-[32rem] overflow-y-auto"><Markdown className="text-foreground/90">{resultText}</Markdown></div>}
          </div>
        ) : (
          <ResultBlock results={toolResults} />
        )}

        {/* View SubAgent conversation */}
        {onViewSubagent && (
          <button
            type="button"
            onClick={() => {
              onViewSubagent(toolId);
            }}
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-list font-medium",
              layout.rounded,
              "bg-primary/10 text-primary hover:bg-primary/20 transition-colors",
              "border border-primary/20",
            )}
            aria-label={t("renderers.agentTool.viewConversation", { defaultValue: "View Conversation" })}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t("renderers.agentTool.viewConversation", { defaultValue: "View Conversation" })}
          </button>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
