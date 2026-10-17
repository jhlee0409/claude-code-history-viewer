/**
 * The ⌘K palette's Messages group (plan T10): the backend message search
 * (`usePaletteMessageSearch`) as one cmdk group with its own states -
 * searching, failed (with a retry item), no match, a scope the search cannot
 * reach - so a slow or failed search never holds up the other groups.
 * Results are listed under their project, the first `MESSAGE_PREVIEW_LIMIT`
 * until "Show all N messages". Providers whose messages the search cannot
 * reach are named in the group (provider parity).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslation } from "react-i18next";
import { Bot, LoaderCircle, MessageSquare, RotateCw, TriangleAlert, User } from "lucide-react";
import { api } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage, ClaudeProject, ClaudeSession, ContentItem } from "@/types";
import { getProviderLabel } from "@/utils/providers";
import { getPathLeaf, getProjectDisplayName } from "@/utils/pathUtils";
import { getLocale } from "@/utils/time";
import { MESSAGE_PREVIEW_LIMIT, MORE_MESSAGES_VALUE, RETRY_MESSAGES_VALUE } from "@/commands/paletteSources";
import { messageItemValue } from "./paletteMessageValues";
import { PALETTE_GROUP_CLASS, PALETTE_ROW_CLASS, ProviderBadge, ShowMoreItem } from "./PalettePlaceGroups";
import type { MessageSearchView } from "./usePaletteMessageSearch";

// Conversation titles per project, shared across palette opens. Keyed by
// path + last_modified so a rescan that touched the project refetches.
const sessionTitleCache = new Map<string, Record<string, string>>();
const titleCacheKey = (project: ClaudeProject) => `${project.path}@${project.last_modified}`;
const TITLE_FETCH_CONCURRENCY = 3;

/**
 * Every string a result can be matched on, in display order. Mirrors the
 * backend scope (`search_in_value` walks message content, toolUse and
 * toolUseResult), so a hit inside a tool payload still gets a snippet
 * instead of "No preview available".
 */
const collectSearchableText = (message: ClaudeMessage): string => {
  const parts: string[] = [];
  const pushStrings = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (value.trim()) parts.push(value);
    } else if (Array.isArray(value)) {
      for (const v of value) pushStrings(v, depth + 1);
    } else if (typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) pushStrings(v, depth + 1);
    }
  };

  const content = message.content;
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content as ContentItem[]) {
      switch (item.type) {
        case "text":
          if ("text" in item) parts.push(item.text as string);
          break;
        case "thinking":
          if ("thinking" in item) parts.push((item as { thinking: string }).thinking);
          break;
        case "tool_use": {
          const tool = item as { name?: string; input?: unknown };
          if (tool.name) parts.push(tool.name);
          pushStrings(tool.input);
          break;
        }
        case "tool_result":
          pushStrings((item as { content?: unknown }).content);
          break;
        default:
          pushStrings(item);
      }
    }
  }
  const extra = message as { toolUse?: unknown; toolUseResult?: unknown };
  pushStrings(extra.toolUse);
  pushStrings(extra.toolUseResult);
  return parts.join(" ").replace(/\s+/g, " ");
};

const NO_RESULTS: ClaudeMessage[] = [];

interface ResultGroup {
  label: string;
  provider?: string;
  pathUnavailable: boolean;
  project?: ClaudeProject;
  items: Array<{ result: ClaudeMessage; index: number }>;
}

interface PaletteMessageGroupProps {
  view: MessageSearchView;
  expanded: boolean;
  onExpand: () => void;
  onOpen: (result: ClaudeMessage) => void;
  onRetry: () => void;
  /** Providers the search cannot reach that have listed projects. */
  notSearched: readonly string[];
  /** Scope "project": the open project's provider (named when unsearchable). */
  scopeProvider?: string;
}

export function PaletteMessageGroup({
  view,
  expanded,
  onExpand,
  onOpen,
  onRetry,
  notSearched,
  scopeProvider,
}: PaletteMessageGroupProps) {
  const { t, i18n } = useTranslation();
  const { projects, getSessionDisplayName } = useAppStore();
  const providerName = useCallback(
    (provider: string) => getProviderLabel((key, fallback) => t(key, fallback), provider),
    [t],
  );
  // The answer's own array: stable while the answer is (the view object is not).
  const results = view.status === "done" ? view.results : NO_RESULTS;
  const query = view.status === "done" ? view.query : "";

  const groups = useMemo(() => {
    const out = new Map<string, ResultGroup>();
    const shown = expanded ? results : results.slice(0, MESSAGE_PREVIEW_LIMIT);
    shown.forEach((result, index) => {
      const projectName = result.projectName || t("globalSearch.unknownProject");
      const provider = result.provider ?? "claude";
      // The backend labels results with the store directory name; the
      // project list may carry a decoded display name instead.
      const project = projects.find(
        (p) =>
          (p.provider ?? "claude") === provider && (p.name === projectName || getPathLeaf(p.path) === projectName),
      );
      const key = `${provider}::${projectName}`;
      if (!out.has(key)) {
        out.set(key, {
          label: project ? getProjectDisplayName(project) : projectName,
          provider: result.provider,
          pathUnavailable: project?.path_status === "unavailable",
          project,
          items: [],
        });
      }
      out.get(key)!.items.push({ result, index });
    });
    return out;
  }, [projects, results, expanded, t]);

  // Conversation titles of the listed projects, fetched at most once per
  // project version, a few at a time; abandoned when the rows change.
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  // Adds titles; keeps the same object when nothing is new, so a re-run
  // of the sweep over cached titles does not render again.
  const mergeTitles = useCallback((titles: Record<string, string>) => {
    setSessionTitles((prev) =>
      Object.entries(titles).some(([id, title]) => prev[id] !== title) ? { ...prev, ...titles } : prev,
    );
  }, []);
  useEffect(() => {
    let current = true;
    const { excludeSidechain } = useAppStore.getState();
    const pending: ClaudeProject[] = [];
    const cached: Record<string, string> = {};
    for (const group of groups.values()) {
      const project = group.project;
      if (!project) continue;
      const hit = sessionTitleCache.get(titleCacheKey(project));
      if (hit) Object.assign(cached, hit);
      else if (!pending.some((p) => p.path === project.path)) pending.push(project);
    }
    mergeTitles(cached);
    if (pending.length === 0) return;

    const loadOne = async (project: ClaudeProject) => {
      const provider = project.provider ?? "claude";
      const sessions = await api<ClaudeSession[]>(
        provider !== "claude" ? "load_provider_sessions" : "load_project_sessions",
        provider !== "claude"
          ? { provider, projectPath: project.path, excludeSidechain }
          : { projectPath: project.path, excludeSidechain },
      );
      const titles: Record<string, string> = {};
      for (const s of sessions) {
        const title = s.summary?.trim();
        if (!title) continue;
        titles[s.session_id] = title;
        if (s.actual_session_id) titles[s.actual_session_id] = title;
      }
      sessionTitleCache.set(titleCacheKey(project), titles);
      return titles;
    };

    void (async () => {
      for (let i = 0; i < pending.length; i += TITLE_FETCH_CONCURRENCY) {
        if (!current) return;
        const batch = pending.slice(i, i + TITLE_FETCH_CONCURRENCY);
        const settled = await Promise.allSettled(batch.map(loadOne));
        if (!current) return;
        const merged: Record<string, string> = {};
        settled.forEach((outcome, idx) => {
          if (outcome.status === "fulfilled") Object.assign(merged, outcome.value);
          else console.error(`Failed to load session titles for ${batch[idx]!.name}:`, outcome.reason);
        });
        mergeTitles(merged);
      }
    })();
    return () => {
      current = false;
    };
  }, [groups, mergeTitles]);

  const sessionName = (result: ClaudeMessage): string | undefined => {
    if (!result.sessionId || result.sessionId === "unknown-session") return undefined;
    const name = getSessionDisplayName(result.sessionId) ?? sessionTitles[result.sessionId];
    if (name) return name;
    // No custom/known name: a short, stable handle, so results from
    // different conversations are still distinguishable (#420).
    return t("globalSearch.conversationId", { id: result.sessionId.slice(0, 8) });
  };

  // Searchable text per result, once per result set (deep tool payload walks).
  const textByResult = useMemo(() => {
    const map = new WeakMap<ClaudeMessage, string>();
    for (const r of results) map.set(r, collectSearchableText(r));
    return map;
  }, [results]);

  const preview = (message: ClaudeMessage): string => {
    const full = textByResult.get(message) ?? collectSearchableText(message);
    if (!full) return t("globalSearch.noPreview");
    const needle = query.trim().toLowerCase();
    if (needle.length >= 2) {
      const at = full.toLowerCase().indexOf(needle);
      if (at !== -1) {
        const radius = 60;
        const start = Math.max(0, at - radius);
        const end = Math.min(full.length, at + needle.length + radius);
        return (start > 0 ? "..." : "") + full.slice(start, end) + (end < full.length ? "..." : "");
      }
    }
    return full.slice(0, 150) + (full.length > 150 ? "..." : "");
  };

  const highlightRegex = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    return new RegExp(`(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
  }, [query]);
  const highlight = (text: string) => {
    if (!highlightRegex) return text;
    return text.split(highlightRegex).map((part, i) =>
      highlightRegex.test(part) ? (
        <mark key={i} className="bg-highlight text-highlight-foreground rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(getLocale(i18n.language || "en"), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (view.status === "idle") return null;

  const note = (children: React.ReactNode, tone: "muted" | "error" = "muted") => (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-list",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );

  return (
    <CommandPrimitive.Group heading={t("globalSearch.group.messages")} className={PALETTE_GROUP_CLASS}>
      {view.status === "loading" &&
        note(
          <>
            <LoaderCircle className="w-4 h-4 shrink-0 animate-spin" aria-hidden="true" />
            <span>{t("globalSearch.messages.searching")}</span>
          </>,
        )}
      {view.status === "unsearchable" &&
        note(
          <span>
            {t("globalSearch.messages.unsearchable", { providers: providerName(scopeProvider ?? "claude") })}
          </span>,
        )}
      {view.status === "error" && (
        <>
          {note(
            <>
              <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t("globalSearch.messages.failed")}</span>
            </>,
            "error",
          )}
          <CommandPrimitive.Item value={RETRY_MESSAGES_VALUE} onSelect={onRetry} className={PALETTE_ROW_CLASS}>
            <RotateCw className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t("globalSearch.messages.retry")}</span>
          </CommandPrimitive.Item>
        </>
      )}
      {view.status === "done" && view.results.length === 0 && note(<span>{t("globalSearch.messages.none")}</span>)}
      {Array.from(groups.entries()).map(([key, group]) => (
        <div key={key}>
          <div className="px-4 py-1 text-list text-muted-foreground truncate flex items-center gap-2">
            <ProviderBadge provider={group.provider} />
            {group.pathUnavailable && (
              <Badge
                size="sm"
                className="rounded px-1 py-0 text-caption bg-warning/15 text-warning"
                title={t("project.pathUnavailableDescription", {
                  defaultValue: "Last-known location is unavailable",
                })}
              >
                {t("project.pathUnavailable", "Location unavailable")}
              </Badge>
            )}
            <span className="truncate">{group.label}</span>
          </div>
          {group.items.map(({ result, index }) => {
            const name = sessionName(result);
            return (
              <CommandPrimitive.Item
                key={`${index}:${result.uuid}`}
                value={messageItemValue(index, result)}
                onSelect={() => onOpen(result)}
                className="w-full text-left px-4 py-2.5 cursor-pointer transition-colors data-[selected=true]:bg-muted"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-list px-1.5 py-0.5 rounded font-medium",
                        result.type === "user"
                          ? "bg-info/10 text-info"
                          : result.type === "assistant"
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {result.type === "user" && <User className="w-3.5 h-3.5" />}
                      {result.type === "assistant" && <Bot className="w-3.5 h-3.5" />}
                      {result.type}
                    </span>
                    <span className="text-list text-muted-foreground">{formatTimestamp(result.timestamp)}</span>
                  </div>
                  {name && (
                    <p className="flex items-center gap-1 text-list text-muted-foreground/70 mb-0.5">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{name}</span>
                    </p>
                  )}
                  <p className="text-body text-foreground line-clamp-2">{highlight(preview(result))}</p>
                </div>
              </CommandPrimitive.Item>
            );
          })}
        </div>
      ))}
      {view.status === "done" && !expanded && view.results.length > MESSAGE_PREVIEW_LIMIT && (
        <ShowMoreItem
          value={MORE_MESSAGES_VALUE}
          label={t("globalSearch.showAllMessages", { count: view.results.length })}
          onSelect={onExpand}
        />
      )}
      {notSearched.length > 0 &&
        view.status !== "unsearchable" &&
        note(<span>{t("globalSearch.messages.notSearched", { providers: notSearched.map(providerName).join(", ") })}</span>)}
    </CommandPrimitive.Group>
  );
}
