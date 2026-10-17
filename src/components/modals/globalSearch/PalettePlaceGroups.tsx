/**
 * The ⌘K palette's Projects and Sessions groups (plan T10), and the pieces
 * every palette group shares: the heading style, the matched-text
 * highlight and the "Show N more" item. Each row is a cmdk item; picking it
 * opens the place (`onOpen`), ⌘/Ctrl held: in a new tab (the palette notes
 * the modifier).
 */
import { Command as CommandPrimitive } from "cmdk";
import { ChevronDown, Folder, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClaudeProject } from "@/types";
import { getProviderBadgeStyle, getProviderLabel } from "@/utils/providers";
import {
  GROUP_LIMIT,
  matchRanges,
  MORE_PROJECTS_VALUE,
  MORE_SESSIONS_VALUE,
  projectItemValue,
  sessionItemValue,
  type ProjectHit,
  type SessionCandidate,
} from "@/commands/paletteSources";

/** A palette group: its heading row and spacing (shared with Commands). */
export const PALETTE_GROUP_CLASS =
  "py-2 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-list [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

/** A one-line palette row. */
export const PALETTE_ROW_CLASS =
  "flex items-center gap-3 px-4 py-2 text-body text-foreground cursor-pointer data-[selected=true]:bg-muted";

/** `text` with the query's words marked. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-highlight text-highlight-foreground rounded-sm">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The provider's badge, for any provider but the default one. */
export function ProviderBadge({ provider }: { provider?: string }) {
  const { t } = useTranslation();
  if (!provider || provider === "claude") return null;
  return (
    <Badge size="sm" className={cn("rounded px-1 py-0 text-caption shrink-0", getProviderBadgeStyle(provider))}>
      {getProviderLabel((key, fallback) => t(key, fallback), provider)}
    </Badge>
  );
}

/** "Show N more": lists the rest of its group. */
export function ShowMoreItem({ value, label, onSelect }: { value: string; label: string; onSelect: () => void }) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className={cn(PALETTE_ROW_CLASS, "text-list text-muted-foreground")}
    >
      <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </CommandPrimitive.Item>
  );
}

interface GroupProps<T> {
  hits: readonly T[];
  query: string;
  /** Every hit is listed, not only the first `GROUP_LIMIT`. */
  expanded: boolean;
  onExpand: () => void;
  onOpen: (hit: T) => void;
}

export function PaletteProjectGroup({ hits, query, expanded, onExpand, onOpen }: GroupProps<ProjectHit>) {
  const { t } = useTranslation();
  if (hits.length === 0) return null;
  const shown = expanded ? hits : hits.slice(0, GROUP_LIMIT);
  return (
    <CommandPrimitive.Group heading={t("globalSearch.group.projects")} className={PALETTE_GROUP_CLASS}>
      {shown.map(({ project, label }) => (
        <CommandPrimitive.Item
          key={projectItemValue(project)}
          value={projectItemValue(project)}
          onSelect={() => onOpen({ project, label })}
          className={PALETTE_ROW_CLASS}
        >
          <Folder className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate">
            <Highlighted text={label} query={query} />
          </span>
          <ProviderBadge provider={project.provider} />
          <ProjectPath project={project} />
        </CommandPrimitive.Item>
      ))}
      {!expanded && hits.length > GROUP_LIMIT && (
        <ShowMoreItem
          value={MORE_PROJECTS_VALUE}
          label={t("globalSearch.showMore", { count: hits.length - GROUP_LIMIT })}
          onSelect={onExpand}
        />
      )}
    </CommandPrimitive.Group>
  );
}

function ProjectPath({ project }: { project: ClaudeProject }) {
  const path = project.actual_path || project.path;
  return (
    <span className="ml-auto min-w-0 max-w-[50%] truncate text-list text-muted-foreground" title={path}>
      {path}
    </span>
  );
}

export function PaletteSessionGroup({ hits, query, expanded, onExpand, onOpen }: GroupProps<SessionCandidate>) {
  const { t } = useTranslation();
  if (hits.length === 0) return null;
  const shown = expanded ? hits : hits.slice(0, GROUP_LIMIT);
  return (
    <CommandPrimitive.Group heading={t("globalSearch.group.sessions")} className={PALETTE_GROUP_CLASS}>
      {shown.map((hit) => (
        <CommandPrimitive.Item
          key={hit.key}
          value={sessionItemValue(hit)}
          onSelect={() => onOpen(hit)}
          className={PALETTE_ROW_CLASS}
        >
          <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate">
            <Highlighted text={hit.title} query={query} />
          </span>
          <ProviderBadge provider={hit.provider} />
          {hit.projectLabel && (
            <span className="ml-auto min-w-0 max-w-[40%] truncate text-list text-muted-foreground">
              {hit.projectLabel}
            </span>
          )}
        </CommandPrimitive.Item>
      ))}
      {!expanded && hits.length > GROUP_LIMIT && (
        <ShowMoreItem
          value={MORE_SESSIONS_VALUE}
          label={t("globalSearch.showMore", { count: hits.length - GROUP_LIMIT })}
          onSelect={onExpand}
        />
      )}
    </CommandPrimitive.Group>
  );
}
