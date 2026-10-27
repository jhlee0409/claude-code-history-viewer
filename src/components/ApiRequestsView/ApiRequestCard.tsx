import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiMessage, ApiRequest, ApiShape, MessageSource } from "@/types/apiView.types";
import { ApiContent } from "./ApiContent";
import { SourceLineList } from "./SourceLineList";
import { JumpLink } from "./JumpLink";
import { anchors, useApiNav } from "./navigation";
import { cacheBreakpoints, sameAsMessages, usageSummary } from "./timeline";
import { clockStamp } from "./format";
import { Num } from "@/lib/format/Num";
import { useFormat } from "@/lib/format/useFormat";

function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <Chevron className="w-3.5 h-3.5" />
        {title}
      </button>
      {open && <div className="mt-1 pl-4">{children}</div>}
    </section>
  );
}

function useSourceLabel() {
  const { t } = useTranslation();
  return (source: MessageSource) => {
    switch (source.kind) {
      case "blob":
        return t("messageViewer.apiView.source.blob", { line: source.line });
      case "lines":
        return t("messageViewer.apiView.source.lines", { lines: source.lines.join(", ") });
      default:
        return t("messageViewer.apiView.source.unresolved", { hash: source.hash.slice(0, 12) });
    }
  };
}

interface MessageViewProps {
  message: ApiMessage;
  requestId: string;
  cached: Set<string>;
}

function MessageView({ message, requestId, cached }: MessageViewProps) {
  const { t } = useTranslation();
  const sourceLabel = useSourceLabel();
  const nav = useApiNav();
  // An assistant turn sent back as context is a previous request's response,
  // already shown there in full.
  const firstLine = message.source.kind === "lines" ? message.source.lines[0] : undefined;
  const answered = firstLine != null ? nav?.links.responses.get(firstLine) : undefined;
  const repeat = answered != null && answered.requestId !== requestId;
  const [open, setOpen] = useState(!repeat);
  const cachedBlocks = useMemo(() => {
    const blocks = new Set<number>();
    for (const key of cached) {
      const [m, b] = key.split(":");
      if (Number(m) === message.index) blocks.add(Number(b));
    }
    return blocks;
  }, [cached, message.index]);
  return (
    <div
      id={anchors.message(requestId, message.index)}
      className={cn("rounded-row border px-2 py-1 my-1", message.source.kind === "unresolved" ? "border-destructive" : "border-border")}
    >
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <span data-mono="id" className="font-mono text-muted-foreground">messages[{message.index}]</span>
        <span data-mono="code" className="font-mono font-medium">{message.role || "?"}</span>
        <span className="text-muted-foreground">{sourceLabel(message.source)}</span>
        {repeat && answered && (
          <>
            <JumpLink requestId={answered.requestId} anchor={anchors.request(answered.requestId)}>
              {t("messageViewer.apiView.responseOf", { n: answered.number })}
            </JumpLink>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground underline"
              aria-expanded={open}
            >
              {open ? t("messageViewer.apiView.hide") : t("messageViewer.apiView.show")}
            </button>
          </>
        )}
      </div>
      {open && <ApiContent content={message.content} cachedBlocks={cachedBlocks} />}
    </div>
  );
}

function RequestHeader({ request, number }: { request: ApiRequest; number: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const usage = usageSummary(request.response?.usage);
  const missing = request.inputs.filter((s) => s.in_request === false).length;
  const unresolved = request.new_messages.filter((m) => m.source.kind === "unresolved").length;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption min-w-0">
      <span className="font-medium text-foreground">{t("messageViewer.apiView.request", { n: number })}</span>
      {request.timestamp && <span className="tabular-nums"><Num>{clockStamp(request.timestamp)}</Num></span>}
      {request.query_source && <span data-mono="code" className="font-mono text-muted-foreground">{request.query_source}</span>}
      {request.line != null ? (
        <>
          <span data-mono="id" className="font-mono text-muted-foreground">L{request.line}</span>
          <span className="text-muted-foreground">
            {t("messageViewer.apiView.messageCount", { total: request.total_messages, added: request.new_messages.length })}
          </span>
        </>
      ) : (
        // An inferred request has no recorded body, so no message count either.
        <span className="italic text-muted-foreground">{t("messageViewer.apiView.inferredTag")}</span>
      )}
      {usage && (
        <span className="tabular-nums text-muted-foreground">
          <Num>
            {t("messageViewer.apiView.usage", {
              input: fmt.tokens(usage.input),
              read: fmt.tokens(usage.cacheRead),
              write: fmt.tokens(usage.cacheWrite),
              output: fmt.tokens(usage.output),
            })}
          </Num>
        </span>
      )}
      {(missing > 0 || unresolved > 0) && (
        <span className="flex items-center gap-1 text-destructive">
          <TriangleAlert className="w-3.5 h-3.5" />
          {t("messageViewer.apiView.problems", { missing, unresolved })}
        </span>
      )}
    </span>
  );
}

interface ApiRequestCardProps {
  request: ApiRequest;
  number: number;
  shape: ApiShape | null;
  expanded: boolean;
  onToggle: () => void;
}

export function ApiRequestCard({ request, number, shape, expanded, onToggle }: ApiRequestCardProps) {
  const { t } = useTranslation();
  const cached = useMemo(() => cacheBreakpoints(request.cache_control), [request.cache_control]);
  const sameAs = useMemo(() => sameAsMessages(request), [request]);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <article id={anchors.request(request.id)} className="rounded-md border border-border bg-card my-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={t("messageViewer.apiView.request", { n: number })}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/30"
        aria-expanded={expanded}
      >
        <Chevron className="w-4 h-4 mt-1 shrink-0" />
        <RequestHeader request={request} number={number} />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {shape && (
            <Section title={t("messageViewer.apiView.shape", { hash: shape.hash.slice(0, 12), line: shape.line })} defaultOpen={false}>
              <ApiContent content={(shape.shape as { system?: unknown })?.system ?? shape.shape} />
              <Section title={t("messageViewer.apiView.tools")} defaultOpen={false}>
                <ApiContent content={JSON.stringify((shape.shape as { tools?: unknown })?.tools ?? null, null, 2)} />
              </Section>
            </Section>
          )}
          {request.inputs.length > 0 && (
            <Section title={t("messageViewer.apiView.inputs", { n: request.inputs.length })}>
              <SourceLineList lines={request.inputs} requestId={request.id} sameAs={sameAs} />
            </Section>
          )}
          {request.keep > 0 && (
            <p className="mt-2 text-caption text-muted-foreground">
              {t("messageViewer.apiView.kept", { keep: request.keep })}
            </p>
          )}
          {request.new_messages.length > 0 && (
            <Section title={t("messageViewer.apiView.newMessages", { n: request.new_messages.length })}>
              {request.new_messages.map((m) => (
                <MessageView key={m.index} message={m} requestId={request.id} cached={cached} />
              ))}
            </Section>
          )}
          <Section title={t("messageViewer.apiView.response")}>
            {request.response ? (
              <>
                <p data-mono="id" className="text-caption text-muted-foreground font-mono">
                  {[request.response.model, request.response.stop_reason, request.response.request_id, `L${request.response.lines.join(", ")}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ApiContent content={request.response.content} anchorTools />
              </>
            ) : (
              <p className="text-caption text-muted-foreground">{t("messageViewer.apiView.noResponse")}</p>
            )}
          </Section>
          {request.params != null && (
            <Section title={t("messageViewer.apiView.params")} defaultOpen={false}>
              <ApiContent content={JSON.stringify({ params: request.params, cacheControl: request.cache_control, id: request.id, base: request.base }, null, 2)} />
            </Section>
          )}
        </div>
      )}
    </article>
  );
}
