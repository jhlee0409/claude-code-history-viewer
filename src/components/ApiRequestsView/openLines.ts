import { useCallback, useEffect, useState } from "react";
import type { SourceLine } from "@/types/apiView.types";
import { anchors, useApiNav } from "./navigation";

/** Which lines of a list are open; a line a link jumps to opens itself. */
export function useOpenLines(lines: SourceLine[], requestId: string | null) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const target = useApiNav()?.target;
  useEffect(() => {
    if (requestId == null || target == null) return;
    const hit = lines.find((l) => anchors.line(requestId, l.line) === target);
    if (hit) setOpen((current) => (current.has(hit.line) ? current : new Set(current).add(hit.line)));
  }, [target, lines, requestId]);
  const toggle = useCallback(
    (line: number) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(line)) next.delete(line);
        else next.add(line);
        return next;
      }),
    []
  );
  const allOpen = lines.length > 0 && lines.every((l) => open.has(l.line));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(lines.map((l) => l.line)));
  return { open, toggle, allOpen, toggleAll };
}

export type OpenLines = ReturnType<typeof useOpenLines>;
