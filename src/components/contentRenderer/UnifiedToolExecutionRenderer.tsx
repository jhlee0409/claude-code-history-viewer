/**
 * UnifiedToolExecutionRenderer — tool_use + tool_result를 하나의 카드로 통합 렌더링
 *
 * 각 도구가 "동사 + 대상 + 결과"라는 스토리를 가지므로,
 * 도구별로 이 스토리를 가장 잘 전달하는 레이아웃을 사용한다.
 *
 * - Bash: command + description → stdout/stderr
 * - Read: file_path (range) → file content
 * - Edit: file_path + diff(old→new) → 성공/실패 메시지
 * - Write: file_path → 성공/실패 메시지
 * - Grep: pattern + path → search results
 * - Glob: pattern + path → file list
 * - Agent: subagent_type + description + prompt(md) → result(md)
 * - Default: primary field → result text
 */

import { memo, useState } from "react";
import {
  CheckCircle2, Clock3, AlertTriangle,
  Bot, Search,
  ChevronDown, ChevronRight, PlayCircle, Timer, Cpu, Hammer,
  FileText, FolderSearch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../ToolIcon";
import { getToolVariant } from "@/utils/toolIconUtils";
import { getVariantStyles, layout } from "../renderers";
import { Markdown } from "../common/Markdown";
import { AnsiText } from "../common/AnsiText";
import { ToolExecutionResultRouter } from "../messageRenderer/ToolExecutionResultRouter";
import { FileEditRenderer } from "../toolResultRenderer/FileEditRenderer";
import { getSubagentStyle } from "@/utils/agentStyles";

const PREVIEW_MAX_LEN = 6000;

type ToolResultLike = Record<string, unknown>;

interface Props {
  toolUse: Record<string, unknown>;
  toolResults: ToolResultLike[];
}

// ── Shared helpers ──

const truncate = (text: string, max = PREVIEW_MAX_LEN) =>
  text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;

const str = (obj: Record<string, unknown>, key: string): string | null =>
  typeof obj[key] === "string" ? (obj[key] as string) : null;

const num = (obj: Record<string, unknown>, key: string): number | null =>
  typeof obj[key] === "number" ? (obj[key] as number) : null;

const isError = (result: ToolResultLike) => {
  if (result.is_error === true) return true;
  const c = result.content;
  if (typeof c === "string" && /^error\b/i.test(c)) return true;
  if (c && typeof c === "object" && "error_code" in c) return true;
  return false;
};

function StatusBadge({ results }: { results: ToolResultLike[] }) {
  const { t } = useTranslation();
  const hasResult = results.length > 0;
  const hasError = hasResult && results.some(isError);
  if (hasError) return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-destructive/20 text-destructive")}>
      <AlertTriangle className={layout.iconSizeSmall} />{t("common.error")}
    </span>
  );
  if (!hasResult) return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-warning/20 text-warning")}>
      <Clock3 className={layout.iconSizeSmall} />{t("common.pending")}
    </span>
  );
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-success/20 text-success")}>
      <CheckCircle2 className={layout.iconSizeSmall} />{t("common.completed")}
    </span>
  );
}

/** Render tool results using existing specialized renderers */
function ResultBlock({ results }: { results: ToolResultLike[] }) {
  const { t } = useTranslation();
  if (results.length === 0) return (
    <div className={cn(layout.smallText, "text-muted-foreground italic mt-2")}>{t("common.pending")}</div>
  );
  return (
    <div className="mt-2 space-y-2">
      {results.map((result, idx) => {
        const content = result.content ?? result;
        return (
          <ToolExecutionResultRouter
            key={idx}
            toolResult={content as Record<string, unknown> | string | unknown[]}
          />
        );
      })}
    </div>
  );
}

// ── Bash: "무슨 명령을 왜 실행했나" ──

const BashCard = memo(function BashCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const command = str(input, "command") ?? "";
  const description = str(input, "description");
  const timeout = num(input, "timeout");
  const styles = getVariantStyles("terminal");


  // Extract stdout/stderr separately for better display
  const resultContent = toolResults[0]?.content;
  const resultObj = typeof resultContent === "object" && resultContent != null
    ? resultContent as Record<string, unknown> : null;
  const stdout = resultObj ? str(resultObj, "stdout") : null;
  const stderr = resultObj ? str(resultObj, "stderr") : null;
  const hasStructuredResult = stdout != null || stderr != null;

  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title={t("tools.terminal")}
        icon={<ToolIcon toolName="Bash" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {timeout != null && (
              <span className="text-muted-foreground">{(timeout / 1000).toFixed(0)}s</span>
            )}
            <StatusBadge results={toolResults} />
          </div>
        }
      />
      <Renderer.Content>
        {description && (
          <div className={cn(layout.smallText, "text-muted-foreground mb-2")}>{description}</div>
        )}
        <pre className={cn(layout.monoText, "p-2 bg-zinc-800 dark:bg-zinc-900 text-zinc-100 rounded overflow-x-auto whitespace-pre-wrap")}>
          {command}
        </pre>
        {hasStructuredResult ? (
          <div className="mt-2 space-y-1">
            {stdout && (
              <pre className={cn(layout.monoText, "p-2 rounded border whitespace-pre-wrap overflow-auto", layout.codeMaxHeight, "bg-secondary border-border text-foreground/80")}>
                <AnsiText text={truncate(stdout)} />
              </pre>
            )}
            {stderr && (
              <pre className={cn(layout.monoText, "p-2 rounded border whitespace-pre-wrap overflow-auto", layout.codeMaxHeight, "bg-secondary border-border text-destructive")}>
                <AnsiText text={truncate(stderr)} />
              </pre>
            )}
          </div>
        ) : (
          <ResultBlock results={toolResults} />
        )}
      </Renderer.Content>
    </Renderer>
  );
});

// ── Read: "어떤 파일의 어디를 읽었나" ──

const ReadCard = memo(function ReadCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = str(input, "file_path") ?? "";
  const offset = num(input, "offset");
  const limit = num(input, "limit");
  const styles = getVariantStyles("code");


  const rangeLabel = offset != null || limit != null
    ? ` (${offset != null ? `L${offset}` : ""}${offset != null && limit != null ? "–" : ""}${limit != null ? `${(offset ?? 0) + (limit ?? 0)}` : ""})`
    : "";

  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Read"
        icon={<ToolIcon toolName="Read" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <FileText className={cn(layout.iconSizeSmall, "text-info shrink-0")} />
          <code className={cn(layout.monoText, "text-info break-all")}>{filePath}{rangeLabel}</code>
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── Edit: 기존 FileEditRenderer에 위임 + 결과 메시지 표시 ──

const EditCard = memo(function EditCard({ toolUse }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};

  return (
    <FileEditRenderer
      toolResult={{
        filePath: str(input, "file_path") ?? "",
        oldString: str(input, "old_string") ?? "",
        newString: str(input, "new_string") ?? "",
        replaceAll: input.replace_all === true,
        originalFile: "",
        userModified: false,
      }}
    />
  );
});

// ── Write: "어떤 파일을 만들었나" ──

const WriteCard = memo(function WriteCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = str(input, "file_path") ?? "";
  const content = str(input, "content");
  const styles = getVariantStyles("success");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Write"
        icon={<ToolIcon toolName="Write" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <FileText className={cn(layout.iconSizeSmall, "text-info shrink-0")} />
          <code className={cn(layout.monoText, "text-info break-all")}>{filePath}</code>
        </div>
        {content && (
          <details>
            <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground mb-1")}>
              {content.split("\n").length} lines
            </summary>
            <pre className={cn(layout.monoText, "p-2 bg-secondary text-foreground/80 rounded overflow-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
              {truncate(content)}
            </pre>
          </details>
        )}
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── Grep: "무엇을 어디서 찾았나" ──

const GrepCard = memo(function GrepCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const pattern = str(input, "pattern") ?? "";
  const path = str(input, "path");
  const glob = str(input, "glob");
  const outputMode = str(input, "output_mode");
  const styles = getVariantStyles("search");


  const scope = path ?? glob ?? "";

  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Grep"
        icon={<ToolIcon toolName="Grep" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {outputMode && (
              <code className={cn(layout.monoText, "text-muted-foreground")}>{outputMode}</code>
            )}
            <StatusBadge results={toolResults} />
          </div>
        }
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <Search className={cn(layout.iconSizeSmall, "text-tool-search shrink-0")} />
          <code className={cn(layout.monoText, "text-tool-search font-semibold")}>{pattern}</code>
          {scope && (
            <span className={cn(layout.smallText, "text-muted-foreground ml-1 truncate")}>in {scope}</span>
          )}
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── Glob: "어떤 패턴으로 파일을 찾았나" ──

const GlobCard = memo(function GlobCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const pattern = str(input, "pattern") ?? "";
  const path = str(input, "path");
  const styles = getVariantStyles("file");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Glob"
        icon={<ToolIcon toolName="Glob" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <FolderSearch className={cn(layout.iconSizeSmall, "text-tool-file shrink-0")} />
          <code className={cn(layout.monoText, "text-tool-file font-semibold")}>{pattern}</code>
          {path && (
            <span className={cn(layout.smallText, "text-muted-foreground ml-1 truncate")}>in {path}</span>
          )}
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── WebSearch: "뭘 검색했나" ──

const WebSearchCard = memo(function WebSearchCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const query = str(input, "query") ?? "";
  const styles = getVariantStyles("web");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="WebSearch"
        icon={<ToolIcon toolName="WebSearch" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <Search className={cn(layout.iconSizeSmall, "text-tool-web shrink-0")} />
          <span className={cn(layout.bodyText, "text-tool-web font-medium")}>{query}</span>
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── WebFetch: "어떤 URL을 왜 가져왔나" ──

const WebFetchCard = memo(function WebFetchCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const url = str(input, "url") ?? "";
  const prompt = str(input, "prompt");
  const styles = getVariantStyles("web");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="WebFetch"
        icon={<ToolIcon toolName="WebFetch" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <code className={cn(layout.monoText, "block mb-2 p-2 rounded border bg-card border-border text-tool-web break-all")}>
          {url}
        </code>
        {prompt && (
          <div className={cn(layout.smallText, "text-muted-foreground mb-2")}>{prompt}</div>
        )}
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── Agent ──

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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 > 0 ? `${m}m ${s % 60}s` : `${m}m`;
}
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const AgentCard = memo(function AgentCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
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

  const hasResult = toolResults.length > 0;
  const resultText = hasResult ? extractAgentResultText(toolResults) : null;
  const first = toolResults[0];
  const totalDurationMs = first?.totalDurationMs as number | undefined;
  const totalTokens = first?.totalTokens as number | undefined;
  const totalToolUseCount = first?.totalToolUseCount as number | undefined;

  return (
    <Renderer className={taskStyles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title={t("renderers.agentTool.title", { defaultValue: "Agent" })}
        icon={<Bot className={cn(layout.iconSize, taskStyles.icon)} />}
        titleClassName={taskStyles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {subagentType && (
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide", layout.rounded, badge.bg, badge.text, "border", badge.border)}>
                <SubIcon className="w-3 h-3" />{subagentType}
              </span>
            )}
            {runInBackground && (
              <span className={cn("px-1.5 py-0.5", layout.rounded, "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30")}>
                {t("renderers.agentTool.background", { defaultValue: "background" })}
              </span>
            )}
            <StatusBadge results={toolResults} />
            {toolId && (
              <code className={cn(layout.monoText, "hidden md:inline px-2 py-0.5", layout.rounded, taskStyles.badge, taskStyles.badgeText)}>
                {t("common.id")}: {toolId}
              </code>
            )}
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
            {model && <span className="flex items-center gap-1 text-muted-foreground"><Cpu className="w-3 h-3" /><code className={layout.monoText}>{model}</code></span>}
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
              <PlayCircle className={cn("w-3.5 h-3.5", taskStyles.icon)} />
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
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className={cn(layout.smallText, "font-medium text-foreground/80")}>{t("renderers.agentTool.result", { defaultValue: "Result" })}</span>
              <div className={cn("flex items-center gap-2 ml-auto", layout.smallText)}>
                {totalDurationMs != null && <span className="inline-flex items-center gap-1 text-muted-foreground"><Timer className="w-3 h-3" />{formatDuration(totalDurationMs)}</span>}
                {totalTokens != null && <span className="inline-flex items-center gap-1 text-muted-foreground"><Cpu className="w-3 h-3" />{formatTokens(totalTokens)}</span>}
                {totalToolUseCount != null && <span className="inline-flex items-center gap-1 text-muted-foreground"><Hammer className="w-3 h-3" />{totalToolUseCount}</span>}
              </div>
            </button>
            {isResultOpen && <div className="px-3 py-2 border-t border-border max-h-[32rem] overflow-y-auto"><Markdown className="text-foreground/90">{resultText}</Markdown></div>}
          </div>
        ) : (
          <ResultBlock results={toolResults} />
        )}
      </Renderer.Content>
    </Renderer>
  );
});

// ── Default: 알려지지 않은 도구용 fallback ──

const DefaultCard = memo(function DefaultCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const toolName = (toolUse.name as string) || "";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title={toolName || t("common.unknown")}
        icon={<ToolIcon toolName={toolName} className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            <StatusBadge results={toolResults} />
            {toolId && (
              <code className={cn(layout.monoText, "hidden md:inline px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                {t("common.id")}: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <details className="mb-2">
          <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground")}>
            {t("common.input")} ({Object.keys(input).join(", ")})
          </summary>
          <pre className={cn(layout.monoText, "mt-2 p-2 bg-secondary text-foreground rounded overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
            {truncate(JSON.stringify(input, null, 2))}
          </pre>
        </details>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});

// ── Router ──

export const UnifiedToolExecutionRenderer = memo(function UnifiedToolExecutionRenderer({
  toolUse,
  toolResults,
}: Props) {
  const toolName = (toolUse.name as string) || "";

  switch (toolName) {
    case "Bash":      return <BashCard toolUse={toolUse} toolResults={toolResults} />;
    case "Read":      return <ReadCard toolUse={toolUse} toolResults={toolResults} />;
    case "Edit":
    case "MultiEdit": return <EditCard toolUse={toolUse} toolResults={toolResults} />;
    case "Write":     return <WriteCard toolUse={toolUse} toolResults={toolResults} />;
    case "Grep":      return <GrepCard toolUse={toolUse} toolResults={toolResults} />;
    case "Glob":      return <GlobCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebSearch":
    case "web_search":return <WebSearchCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebFetch":  return <WebFetchCard toolUse={toolUse} toolResults={toolResults} />;
    case "Agent":
    case "Task":      return <AgentCard toolUse={toolUse} toolResults={toolResults} />;
    default:          return <DefaultCard toolUse={toolUse} toolResults={toolResults} />;
  }
});
