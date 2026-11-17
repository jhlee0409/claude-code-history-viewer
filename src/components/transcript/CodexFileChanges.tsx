import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ClaudeMessage } from "@/types";
import { CodexChangeContext, useCodexChanges, type CodexChangeIndex } from "./codexChangeContext";
import { codexChangeEvents, type CodexChangeEvent } from "./codexFileChangeModel";
import { codexTurnId } from "./codexTurns";
import { DiffWithMenu } from "./DiffViewComparison";
import { OutputBlock } from "./OutputBlock";
import { PathText } from "@/lib/format/PathText";
import { useToolPathContext } from "./pathContext";

export function CodexFileChangeProvider({ messages, children }: { messages: readonly ClaudeMessage[]; children: ReactNode }) {
  const index = useMemo<CodexChangeIndex>(() => {
    const calls = new Map<string, ClaudeMessage[]>();
    for (const message of messages) {
      if (message.provider !== "codex" || !Array.isArray(message.content)) continue;
      for (const item of message.content) {
        if (item.type !== "tool_use" || typeof item.id !== "string") continue;
        const rows = calls.get(item.id) ?? [];
        rows.push(message); calls.set(item.id, rows);
      }
    }
    const matched = new Map<string, CodexChangeEvent[]>();
    const unassigned = new Map<string, CodexChangeEvent[]>();
    for (const event of codexChangeEvents(messages)) {
      const candidates = calls.get(event.id);
      const call = candidates?.length === 1 ? candidates[0] : undefined;
      const matches = call && (!event.turnId || codexTurnId(call) === event.turnId);
      const map = matches ? matched : unassigned;
      const key = matches ? event.id : event.carrier;
      const events = map.get(key) ?? []; events.push(event); map.set(key, events);
    }
    return { matched, unassigned };
  }, [messages]);
  return <CodexChangeContext.Provider value={index}>{children}</CodexChangeContext.Provider>;
}

/** The producer event itself; unsupported hunks retain exact raw text, not a re-diff. */
export function CodexChangeDiff({ events, expandKey }: { events: readonly CodexChangeEvent[]; expandKey: string }) {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  return <>{events.map((event, ei) => <section key={ei} data-codex-file-change={event.id} className="space-y-1">
    {(event.status === "failed" || event.status === "declined") && <div className="text-caption text-fg-2">{t(`codexFileChange.${event.status}`)}</div>}
    {event.changes.map((file, fi) => <section key={fi} className="space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-fg-2">
        {file.operation === "delete" && <span>{t("diffView.deleted")}</span>}
        <PathText path={file.path} ctx={pathCtx} className="text-code text-fg-2" />
        {file.movePath && <><span>{" → "}</span><PathText path={file.movePath} ctx={pathCtx} className="text-code text-fg-2" /></>}
      </div>
      {file.sections ? <DiffWithMenu sections={file.sections} oldText={file.sections.map(s => s.oldText).join("\n")} newText={file.sections.map(s => s.newText).join("\n")} filePath={file.path} expandKey={`${expandKey}-${ei}-${fi}`} copies={[{ label: t("diffView.copyPatch"), text: file.source }]} /> : <OutputBlock text={file.source} expandKey={`${expandKey}-raw-${ei}-${fi}`} />}
    </section>)}
  </section>)}</>;
}

export function CodexUnassignedFileChanges({ message }: { message: ClaudeMessage }) {
  const { t } = useTranslation();
  const events = useCodexChanges().unassigned.get(message.uuid);
  if (!events?.length) return null;
  return <section className="space-y-2" data-codex-unassigned="">
    <div className="text-caption text-fg-2">{t("codexFileChange.heading")}</div>
    <CodexChangeDiff events={events} expandKey={`${message.uuid}-filechange`} />
  </section>;
}
