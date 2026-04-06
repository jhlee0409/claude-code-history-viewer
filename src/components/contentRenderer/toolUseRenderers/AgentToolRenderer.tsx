import { memo, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  PlayCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { Renderer } from "@/shared/RendererHeader";
import { Markdown } from "@/components/common/Markdown";
import { getSubagentStyle } from "@/utils/agentStyles";

interface AgentToolInput {
  description?: string;
  prompt?: string;
  subagent_type?: string;
  run_in_background?: boolean;
  model?: string;
  isolation?: string;
}

interface Props {
  toolId: string;
  input: AgentToolInput;
}

export const AgentToolRenderer = memo(function AgentToolRenderer({
  toolId,
  input,
}: Props) {
  const { t } = useTranslation();
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  const style = getSubagentStyle(input.subagent_type);
  const SubagentIcon = style.icon;

  // Header tint matching subagent type
  const headerTint = input.subagent_type ? style.bg : "bg-muted/30";

  return (
    <Renderer
      className={cn("border", style.border, style.bg)}
      expandKey={toolId ? `tooluse-${toolId}` : undefined}
    >
      <Renderer.Header
        title={t("renderers.agentTool.title", { defaultValue: "Agent" })}
        icon={<Bot className={cn(layout.iconSize, style.text)} />}
        titleClassName={cn("font-semibold", style.text)}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {input.subagent_type && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide",
                  layout.rounded,
                  style.bg,
                  style.text,
                  "border",
                  style.border
                )}
              >
                <SubagentIcon className="w-3 h-3" />
                {input.subagent_type}
              </span>
            )}
            {input.run_in_background && (
              <span
                className={cn(
                  "px-1.5 py-0.5",
                  layout.rounded,
                  "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                )}
              >
                {t("renderers.agentTool.background", {
                  defaultValue: "background",
                })}
              </span>
            )}
            {input.model && (
              <code className={cn(layout.monoText, "text-muted-foreground")}>
                {input.model}
              </code>
            )}
            {toolId && (
              <code
                className={cn(
                  layout.monoText,
                  "hidden md:inline px-2 py-0.5",
                  layout.rounded,
                  "bg-muted/50 text-muted-foreground"
                )}
              >
                {t("common.id")}: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        {toolId && (
          <code
            className={cn(
              layout.monoText,
              "block md:hidden mb-2 text-muted-foreground"
            )}
          >
            {t("common.id")}: {toolId}
          </code>
        )}

        {/* Description — prominent summary */}
        {input.description && (
          <div
            className={cn(
              "flex items-start gap-2 p-2.5 mb-3 border",
              layout.rounded,
              headerTint,
              style.border
            )}
          >
            <SubagentIcon
              className={cn("w-4 h-4 shrink-0 mt-0.5", style.text)}
            />
            <span className={cn(layout.bodyText, "text-foreground font-medium")}>
              {input.description}
            </span>
          </div>
        )}

        {/* Isolation badge */}
        {input.isolation && (
          <div className={cn("mb-3 flex items-center gap-1.5", layout.smallText)}>
            <span className="text-muted-foreground">
              {t("renderers.agentTool.isolation", {
                defaultValue: "Isolation",
              })}
              :
            </span>
            <code
              className={cn(
                "px-1.5 py-0.5",
                layout.rounded,
                "bg-muted/50 text-foreground/80 border border-border"
              )}
            >
              {input.isolation}
            </code>
          </div>
        )}

        {/* Prompt — collapsible markdown */}
        {input.prompt && (
          <div className={cn("border", layout.rounded, "border-border overflow-hidden")}>
            <button
              type="button"
              onClick={() => setIsPromptOpen((prev) => !prev)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left",
                "hover:bg-muted/50 transition-colors",
                "bg-muted/20"
              )}
              aria-label={t("renderers.agentTool.togglePrompt", {
                defaultValue: "Toggle prompt",
              })}
            >
              {isPromptOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <PlayCircle
                className={cn("w-3.5 h-3.5", style.text)}
              />
              <span className={cn(layout.smallText, "font-medium text-foreground/80")}>
                {t("renderers.agentTool.prompt", { defaultValue: "Prompt" })}
              </span>
              {!isPromptOpen && (
                <span className={cn(layout.smallText, "text-muted-foreground truncate flex-1")}>
                  — {input.prompt.split("\n")[0]?.slice(0, 80)}
                  {(input.prompt.split("\n")[0]?.length ?? 0) > 80 ? "…" : ""}
                </span>
              )}
            </button>
            {isPromptOpen && (
              <div className={cn("px-3 py-2 border-t border-border max-h-96 overflow-y-auto")}>
                <Markdown className="text-foreground/90">
                  {input.prompt}
                </Markdown>
              </div>
            )}
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
