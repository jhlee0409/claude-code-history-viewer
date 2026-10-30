import { useContext, useMemo, type ReactNode } from "react";
import { resultSearchText } from "./resultSearchText";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { DetailZone } from "./DetailZone";
import { ToolRow } from "./ToolRow";
import { toolOutcome, type ToolFamily } from "./toolOutcome";
import { useResultProvider, useResultSearch } from "./resultProvider";

interface RecordedResultProps {
  /** A result category when the source has no recorded tool name; never a synthetic call. */
  title: string;
  icon: ReactNode;
  record: unknown;
  meta?: ReactNode;
  target?: ReactNode;
  family?: ToolFamily;
  expandKey: string;
  searchQuery?: string;
  children: ReactNode;
}

/** Adapter for legacy result-only bodies. ToolRow remains the sole tool head.
 * Nested bodies already have a result owner; do not repeat its outcome/facts.
 * Category labels describe the record, not a made-up invocation or tool ID.
 */
export function RecordedResult({ title, icon, record, meta, target, family = "other", expandKey, searchQuery, children }: RecordedResultProps) {
  const ambient = useContext(RendererDefaultsContext);
  const provider = useResultProvider();
  const inherited = useResultSearch();
  const outcome = toolOutcome(null, [{ content: record }], family, provider);
  const query = searchQuery ?? inherited.revealFor;
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const hit = useMemo(() => normalizedQuery !== "" && resultSearchText(record).toLowerCase().includes(normalizedQuery), [record, normalizedQuery]);
  if (ambient.defaultExpanded) {
    return <div data-result-body="" className="space-y-2">{meta}{children}</div>;
  }
  return (
    <ToolRow icon={icon} verb={title} target={target} outcome={outcome} family={family} expandKey={expandKey} revealFor={hit ? query : undefined}>
      <DetailZone kind="result" meta={meta}>{children}</DetailZone>
    </ToolRow>
  );
}
