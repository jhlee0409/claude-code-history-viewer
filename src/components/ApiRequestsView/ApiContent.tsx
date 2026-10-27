import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const PRE = "whitespace-pre-wrap break-words text-caption max-h-[60vh] overflow-auto rounded-row px-2 py-1";

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

interface BlockProps {
  block: unknown;
  cached: boolean;
}

/** One content block, close to how it is sent: its type, then its payload. */
function ContentBlock({ block, cached }: BlockProps) {
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
  return (
    <div className="border-l-2 border-border pl-2 my-1">
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span data-mono="code" className="font-mono">{header}</span>
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
}

/** A message `content`: a plain string or an array of blocks. */
export function ApiContent({ content, cachedBlocks }: ApiContentProps) {
  if (!Array.isArray(content)) {
    return <pre className={cn(PRE, "font-mono", "bg-muted/50")}>{asText(content)}</pre>;
  }
  return (
    <>
      {content.map((block, i) => (
        <ContentBlock key={i} block={block} cached={cachedBlocks?.has(i) ?? false} />
      ))}
    </>
  );
}
