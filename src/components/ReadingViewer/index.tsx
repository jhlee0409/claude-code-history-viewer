import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert, ArrowLeft, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/theme";
import { useAppStore } from "@/store/useAppStore";
import { useEffectiveHighContrast } from "@/hooks/useHighContrast";
import { saveFileDialog } from "@/utils/fileDialog";
import {
  exportReadingDocument, prepareReadingDocument, readingDocumentUrl,
  type ReadingDocument,
} from "@/services/reading";
import type { ClaudeSession } from "@/types";

type PreparedDocument = ReadingDocument & { url: string; sessionPath: string };

export function ReadingViewer({ session }: { session: ClaudeSession }) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const fontScale = useAppStore((s) => s.fontScale);
  const highContrast = useEffectiveHighContrast();
  const targetUuid = useAppStore((s) => s.targetMessageUuid);
  const clearTarget = useAppStore((s) => s.clearTargetMessage);
  const parentSessionStack = useAppStore((s) => s.parentSessionStack);
  const navigateBackToParent = useAppStore((s) => s.navigateBackToParent);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const request = useRef(0);
  const anchor = useRef<string | null>(null);
  const restoreAnchor = useRef<string | null>(null);
  const [document, setDocument] = useState<PreparedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  // Never expose the previous session while the next effect is being scheduled.
  const current = document?.sessionPath === session.file_path ? document : null;

  const prepare = useCallback(async (forceRefresh: boolean) => {
    const generation = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await prepareReadingDocument(session.file_path, forceRefresh);
      const url = await readingDocumentUrl(result);
      if (request.current !== generation) return;
      restoreAnchor.current = anchor.current;
      setReady(false);
      setDocument({ ...result, url, sessionPath: session.file_path });
    } catch (cause) {
      if (request.current === generation) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (request.current === generation) setLoading(false);
    }
  }, [session.file_path]);

  useEffect(() => {
    anchor.current = null;
    restoreAnchor.current = null;
    setReady(false);
    setTargetMissing(false);
    void prepare(false);
    return () => { request.current += 1; };
  }, [prepare]);

  const send = useCallback((payload: Record<string, unknown>) => {
    if (!current) return;
    frameRef.current?.contentWindow?.postMessage({
      channel: "cchv-reading", version: 1, nonce: current.bridge_nonce, ...payload,
    }, "*");
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data == null || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data.channel !== "cchv-reading" || data.version !== 1 || data.nonce !== current.bridge_nonce) return;
      if (data.type === "ready") setReady(true);
      if (data.type === "anchor" && typeof data.uuid === "string" && data.uuid.length <= 200) {
        anchor.current = data.uuid;
      }
      if (data.type === "navigated" && data.uuid === targetUuid && typeof data.found === "boolean") {
        setTargetMissing(!data.found);
        if (data.found) {
          anchor.current = data.uuid as string;
          clearTarget();
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [current, targetUuid, clearTarget]);

  useEffect(() => {
    if (!current || ready) return;
    const timer = window.setTimeout(() => setError(t("reading.frameFailed")), 15000);
    return () => window.clearTimeout(timer);
  }, [current, ready, t]);

  useEffect(() => {
    if (!ready) return;
    send({
      type: "appearance", isDark: isDarkMode, fontScale, highContrast,
      labels: {
        prompts: t("reading.prompts"), steps: t("reading.steps"), all: t("reading.all"),
        main: t("reading.main"), interleaved: t("reading.interleaved"), columns: t("reading.columns"),
        search: t("reading.search"),
      },
    });
  }, [ready, send, isDarkMode, fontScale, highContrast, t]);

  useEffect(() => {
    if (!ready) return;
    const uuid = targetUuid || restoreAnchor.current;
    restoreAnchor.current = null;
    if (uuid) send({ type: "navigate", uuid });
  }, [ready, send, targetUuid]);

  const save = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const content = await exportReadingDocument(current);
      const filename = (session.actual_session_id || session.file_path.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, "") || session.session_id)
        .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
      if (await saveFileDialog(content, {
        defaultPath: `${filename}-reading.html`, mimeType: "text/html",
        filters: [{ name: "HTML", extensions: ["html"] }],
      })) toast.success(t("reading.exported"));
    } catch {
      toast.error(t("reading.exportFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("reading.frameTitle")}>
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-4 py-2">
        {parentSessionStack?.length > 0 && <Button variant="outline" size="sm" className="mr-auto" onClick={() => {
          void navigateBackToParent().catch(() => toast.error(t("reading.loadFailed")));
        }}><Icon icon={ArrowLeft} size={16} />{t("renderers.agentTool.backToParent")}</Button>}
        {loading && <span role="status" className="mr-auto flex items-center gap-2 text-list text-muted-foreground"><Icon icon={LoaderCircle} size={16} className="animate-spin" />{t("reading.loading")}</span>}
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void prepare(true)} aria-label={t("reading.refresh")}>
          <Icon icon={RefreshCw} size={16} />{t("messageViewer.refresh")}
        </Button>
        <Button variant="outline" size="sm" disabled={!current || saving} onClick={() => void save()}>
          {saving ? <Icon icon={LoaderCircle} size={16} className="animate-spin" /> : <Icon icon={Download} size={16} />}{t("reading.export")}
        </Button>
      </div>
      {error && <div role="alert" className="m-4 rounded-lg border border-destructive bg-destructive/5 p-4 text-body">
        <p className="flex items-center gap-2 font-medium"><Icon icon={TriangleAlert} size={16} />{t("reading.loadFailed")}</p>
        <p className="mt-2 break-words text-muted-foreground">{error}</p>
        {/renderer|executable|version/i.test(error) && <p className="mt-2 text-muted-foreground">{t("reading.runtimeHelp")}</p>}
        <Button variant="outline" size="sm" className="mt-3" disabled={loading} onClick={() => void prepare(true)}>{t("reading.retry")}</Button>
      </div>}
      {targetMissing && <p role="status" className="px-4 py-2 text-body text-muted-foreground">{t("reading.targetMissing")}</p>}
      {current && <iframe key={current.document_id} ref={frameRef} title={t("reading.frameTitle")} src={current.url}
        sandbox="allow-scripts" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-background" />}
    </section>
  );
}
