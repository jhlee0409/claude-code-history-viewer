import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X, Minus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceLine } from "@/types/apiView.types";
import { clockStamp, previewHeadline } from "./format";
import { Num } from "@/lib/format/Num";

function InRequestMark({ value }: { value: boolean | null }) {
  const { t } = useTranslation();
  const [Icon, color, key] =
    value === true
      ? [Check, "text-success", "messageViewer.apiView.inRequest"]
      : value === false
        ? [X, "text-destructive", "messageViewer.apiView.notInRequest"]
        : [Minus, "text-muted-foreground", "messageViewer.apiView.unchecked"];
  const label = t(key);
  return (
    <span role="img" aria-label={label} title={label} className={cn("shrink-0", color)}>
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}

interface RowProps {
  line: SourceLine;
  onOpen: (uuid: string) => void;
}

function SourceLineRow({ line, onOpen }: RowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1">
      <div className="flex items-center gap-2 text-caption">
        <InRequestMark value={line.in_request} />
        <span data-mono="id" className="font-mono text-muted-foreground tabular-nums w-14 shrink-0">L{line.line}</span>
        <span data-mono="code" className="font-mono shrink-0">{line.kind}</span>
        {line.label && <span className="text-muted-foreground shrink-0">{line.label}</span>}
        {line.timestamp && (
          <span className="text-muted-foreground tabular-nums shrink-0"><Num>{clockStamp(line.timestamp)}</Num></span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="truncate text-left text-muted-foreground hover:text-foreground min-w-0 flex-1"
          aria-expanded={open}
        >
          {previewHeadline(line.preview)}
        </button>
        {line.uuid && (
          <button
            type="button"
            onClick={() => onOpen(line.uuid!)}
            className="p-1 rounded-row text-muted-foreground hover:text-foreground hover:bg-muted/50 shrink-0"
            aria-label={t("messageViewer.apiView.openInTranscript")}
            title={t("messageViewer.apiView.openInTranscript")}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <pre className={cn("whitespace-pre-wrap break-words font-mono text-caption bg-muted/40 rounded-row px-2 py-1 ml-8")}>
          {line.preview}
        </pre>
      )}
    </li>
  );
}

interface SourceLineListProps {
  lines: SourceLine[];
  onOpen: (uuid: string) => void;
}

/** Transcript lines by reference: line number, kind, preview. */
export function SourceLineList({ lines, onOpen }: SourceLineListProps) {
  return (
    <ul className="space-y-0">
      {lines.map((line) => (
        <SourceLineRow key={line.line} line={line} onOpen={onOpen} />
      ))}
    </ul>
  );
}
