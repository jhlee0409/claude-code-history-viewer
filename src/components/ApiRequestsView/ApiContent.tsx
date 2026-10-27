import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { JumpLink } from "./JumpLink";
import { anchors, useApiNav } from "./navigation";

const PRE = "whitespace-pre-wrap break-words text-caption max-h-[60vh] overflow-auto rounded-row px-2 py-1";

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Where the other half of a tool call is: the call, or its result. */
function ToolCallLink({ type, id }: { type: string; id: string }) {
  const { t } = useTranslation();
  const nav = useApiNav();
  if (!nav) return null;
  if (type === "tool_use") {
    const result = nav.links.toolResults.get(id);
    if (!result) return null;
    return (
      <JumpLink requestId={result.requestId} anchor={anchors.line(result.requestId, result.line)}>
        {t("messageViewer.apiView.resultIn", { n: result.number, line: result.line })}
      </JumpLink>
    );
  }
  const call = nav.links.toolUses.get(id);
  if (!call) return null;
  return (
    <JumpLink requestId={call.requestId} anchor={anchors.toolUse(id)}>
      {t("messageViewer.apiView.answers", { tool: call.name, n: call.number })}
    </JumpLink>
  );
}

interface BlockProps {
  block: unknown;
  cached: boolean;
  /** Give tool_use blocks an anchor; only where the call was made. */
  anchorTools: boolean;
  toolLinks: boolean;
}

/** One content block, close to how it is sent: its type, then its payload. */
function ContentBlock({ block, cached, anchorTools, toolLinks }: BlockProps) {
  const { t } = useTranslation();
  const b = (block ?? {}) as Record<string, unknown>;
  const type = typeof b.type === "string" ? b.type : "?";
  let header = type;
  let body: unknown = block;
  if (type === "text") body = b.text;
  else if (type === "thinking") body = b.thinking;
  else if (type === "tool_use") {
    header = `tool_use · ${String(b.name)} · ${String(b.id)}`;
    body = b.input;
  } else if (type === "tool_result") {
    header = `tool_result · ${String(b.tool_use_id)}${b.is_error === true ? " · error" : ""}`;
    body = b.content;
  }
  const toolId = type === "tool_use" ? b.id : type === "tool_result" ? b.tool_use_id : null;
  return (
    <div
      id={anchorTools && type === "tool_use" && typeof b.id === "string" ? anchors.toolUse(b.id) : undefined}
      className="border-l-2 border-border pl-2 my-1 rounded-row"
    >
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span data-mono="code" className="font-mono">{header}</span>
        {toolLinks && typeof toolId === "string" && <ToolCallLink type={type} id={toolId} />}
        {cached && (
          <span className="rounded-row bg-accent/15 text-accent px-1">
            {t("messageViewer.apiView.cacheBreakpoint")}
          </span>
        )}
      </div>
      {Array.isArray(body) ? (
        <ApiContent content={body} />
      ) : (
        <pre className={cn(PRE, "font-mono", type === "thinking" ? "bg-muted/30 italic" : "bg-muted/50")}>
          {asText(body)}
        </pre>
      )}
    </div>
  );
}

interface ApiContentProps {
  content: unknown;
  /** Indices of blocks that carry a cache breakpoint. */
  cachedBlocks?: ReadonlySet<number>;
  /** Anchor tool_use blocks for links to the call (a response). */
  anchorTools?: boolean;
  /** Link each tool call to its other half. */
  toolLinks?: boolean;
}

/** A message `content`: a plain string or an array of blocks. */
export function ApiContent({ content, cachedBlocks, anchorTools = false, toolLinks = true }: ApiContentProps) {
  if (!Array.isArray(content)) {
    return <pre className={cn(PRE, "font-mono", "bg-muted/50")}>{asText(content)}</pre>;
  }
  return (
    <>
      {content.map((block, i) => (
        <ContentBlock key={i} block={block} cached={cachedBlocks?.has(i) ?? false} anchorTools={anchorTools} toolLinks={toolLinks} />
      ))}
    </>
  );
}
