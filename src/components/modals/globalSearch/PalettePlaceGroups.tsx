/**
 * The ⌘K palette's Projects and Sessions groups (plan T10), and the pieces
 * every palette group shares: the heading style, the matched-text
 * highlight, the "Show N more" item and the failed-load row with its
 * "Try again" item. Each row is a cmdk item; picking it
 * opens the place (`onOpen`), ⌘/Ctrl held: in a new tab (the palette notes
 * the modifier).
 */
import { Command as CommandPrimitive } from "cmdk";
import { ChevronDown, Folder, FolderSearch, MessageSquare, RotateCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClaudeProject } from "@/types";
import { getCompactParentPath } from "@/utils/pathUtils";
import { getProviderBadgeStyle, getProviderLabel } from "@/utils/providers";
import {
  GROUP_LIMIT,
  matchRanges,
  MORE_PROJECTS_VALUE,
  MORE_SESSIONS_VALUE,
  projectItemValue,
  RETRY_SESSIONS_VALUE,
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

/**
 * A group's load failed: what failed (`message`, in the destructive tone)
 * and a "Try again" item that asks again.
 */
export function FailedLoad({ message, retryValue, onRetry }: { message: string; retryValue: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 text-list text-destructive">
        <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <CommandPrimitive.Item value={retryValue} onSelect={onRetry} className={PALETTE_ROW_CLASS}>
        <RotateCw className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{t("globalSearch.messages.retry")}</span>
      </CommandPrimitive.Item>
    </>
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

interface ProjectGroupProps extends GroupProps<ProjectHit> {
  /**
   * Scope Sessions and Messages to the project, without opening it: what
   * Tab does on a highlighted row, as a row button for phones (no Tab key).
   */
  onScope: (hit: ProjectHit) => void;
}

export function PaletteProjectGroup({ hits, query, expanded, onExpand, onOpen, onScope }: ProjectGroupProps) {
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
          <ScopeRowButton onScope={() => onScope({ project, label })} />
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

/**
 * Where the project lives: its parent folders, short (the sidebar's
 * secondary text). Without them an empty spacer keeps what follows (the
 * phone's row button) at the row's end.
 */
function ProjectPath({ project }: { project: ClaudeProject }) {
  const path = project.actual_path || project.path;
  const parent = getCompactParentPath(path);
  if (!parent) return <span className="ml-auto" aria-hidden="true" />;
  return (
    <span className="ml-auto min-w-0 max-w-[50%] truncate text-list text-muted-foreground" title={path}>
      {parent}
    </span>
  );
}

/**
 * "Search in this project", the phone's Tab: phones only (`sm:hidden`, as
 * the keyboard hints are desktop only). Its click and keys stay its own,
 * so the row it sits in never opens the project.
 */
function ScopeRowButton({ onScope }: { onScope: () => void }) {
  const { t } = useTranslation();
  const label = t("globalSearch.scope.pinAction");
  return (
    <button
      type="button"
      className="sm:hidden shrink-0 -my-1 -mr-2 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 focus-ring-inset"
      aria-label={label}
      title={label}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onScope();
      }}
    >
      <FolderSearch className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

interface SessionGroupProps extends GroupProps<SessionCandidate> {
  /**
   * The scoped project's session list failed (`project`: its name): the
   * group says it is incomplete - the hits are only the sessions the app
   * already knew of - and offers to ask again. Shown with no hits too.
   */
  failed?: { project: string; onRetry: () => void };
}

export function PaletteSessionGroup({ hits, query, expanded, onExpand, onOpen, failed }: SessionGroupProps) {
  const { t } = useTranslation();
  if (hits.length === 0 && !failed) return null;
  const shown = expanded ? hits : hits.slice(0, GROUP_LIMIT);
  return (
    <CommandPrimitive.Group heading={t("globalSearch.group.sessions")} className={PALETTE_GROUP_CLASS}>
      {failed && (
        <FailedLoad
          message={t("globalSearch.sessions.failed", { project: failed.project })}
          retryValue={RETRY_SESSIONS_VALUE}
          onRetry={failed.onRetry}
        />
      )}
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
