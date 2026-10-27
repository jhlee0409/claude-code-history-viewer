import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { errorDetail } from "@/utils/errorDetail";
import { LoadingRows } from "@/components/ui/loading-rows";
import type { ApiShape, ApiView, SourceLine } from "@/types/apiView.types";
import { ApiRequestCard } from "./ApiRequestCard";
import { SourceLineList } from "./SourceLineList";
import { buildTimeline, inferredNotice } from "./timeline";

function LooseLines({ lines, onOpen }: { lines: SourceLine[]; onOpen: (uuid: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const kinds = [...new Set(lines.map((l) => l.kind))].join(", ");
  return (
    <div className="my-1 px-3 text-caption text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 hover:text-foreground min-w-0"
        aria-expanded={open}
      >
        <Chevron className="w-3.5 h-3.5 shrink-0" />
        <span className="shrink-0">{t("messageViewer.apiView.unattributed", { n: lines.length })}</span>
        <span data-mono="code" className="font-mono truncate">{kinds}</span>
      </button>
      {open && (
        <div className="pl-4">
          <SourceLineList lines={lines} onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}

interface ApiRequestsViewProps {
  sessionPath: string;
  /** Changes whenever the session is reloaded (live updates). */
  reloadKey: unknown;
}

/** The open session as the API requests Claude Code sent. */
export function ApiRequestsView({ sessionPath, reloadKey }: ApiRequestsViewProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<ApiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleApiView = useAppStore((s) => s.toggleApiView);
  const navigateToMessage = useAppStore((s) => s.navigateToMessage);

  useEffect(() => {
    let cancelled = false;
    api<ApiView>("load_session_api_view", { sessionPath })
      .then((result) => {
        if (cancelled) return;
        setView(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorDetail(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionPath, reloadKey]);

  useEffect(() => {
    setView(null);
    setExpanded(new Set());
  }, [sessionPath]);

  const timeline = useMemo(() => (view ? buildTimeline(view) : []), [view]);
  const shapes = useMemo(
    () => new Map<string, ApiShape>((view?.shapes ?? []).map((s) => [s.hash, s])),
    [view]
  );

  const openInTranscript = useCallback(
    (uuid: string) => {
      toggleApiView();
      navigateToMessage(uuid);
    },
    [toggleApiView, navigateToMessage]
  );

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (error) {
    return <p className="p-4 text-body text-destructive">{t("messageViewer.apiView.error", { detail: error })}</p>;
  }
  if (!view) {
    return <LoadingRows label={t("messageViewer.apiView.loading")} className="flex-1 h-full p-6" />;
  }

  const allExpanded = expanded.size === view.requests.length && view.requests.length > 0;
  const notice = inferredNotice(view);
  return (
    <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-caption text-muted-foreground px-1">
        <span>
          {t("messageViewer.apiView.summary", {
            requests: view.requests.length,
            lines: view.line_count,
            unattributed: view.unattributed.length,
          })}
        </span>
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(view.requests.map((r) => r.id)))}
        >
          {allExpanded ? t("messageViewer.apiView.collapseAll") : t("messageViewer.apiView.expandAll")}
        </button>
      </div>
      {notice && (
        <p className="flex items-start gap-2 mt-2 px-1 text-caption text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-1 shrink-0" />
          {t(notice)}
        </p>
      )}
      {timeline.map((item) =>
        item.kind === "loose" ? (
          <LooseLines key={`loose-${item.lines[0]!.line}`} lines={item.lines} onOpen={openInTranscript} />
        ) : (
          <ApiRequestCard
            key={item.request.id}
            request={item.request}
            number={item.number}
            shape={item.shapeChanged && item.request.shape_hash ? shapes.get(item.request.shape_hash) ?? null : null}
            expanded={expanded.has(item.request.id)}
            onToggle={() => toggle(item.request.id)}
            onOpen={openInTranscript}
          />
        )
      )}
    </div>
  );
}
