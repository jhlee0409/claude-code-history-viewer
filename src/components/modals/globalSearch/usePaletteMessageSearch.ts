/**
 * The ⌘K palette's message search (plan T10): the backend search
 * (`search_messages`, or `search_all_providers` when another provider,
 * custom folder or WSL is in play) as an asynchronous source of the palette.
 *
 * Ownership: a request belongs to the exact query, scope, type filter and
 * search settings it was asked for (its key). Changing any of them, closing
 * the palette or unmounting abandons the debounce and the request in flight:
 * the backend has no cancel, so "cancelled" means its answer - success or
 * failure - is dropped (`ownsData`). The view only shows an answer under the
 * key it belongs to; until the current key's answer lands it shows loading,
 * never the previous query's rows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage, ClaudeProject } from "@/types";
import {
  hasNonDefaultProvider,
  getWslSearchableProviderIds,
} from "@/utils/providers";
import { getPathLeaf } from "@/utils/pathUtils";
import { isMessageSearchable, MIN_MESSAGE_QUERY, type PaletteScope } from "@/commands/paletteSources";
import type { ProviderId } from "@/types";

export type MessageTypeFilter = "all" | "user" | "assistant";

/** Typing pauses this long before the search is sent. */
export const MESSAGE_SEARCH_DEBOUNCE_MS = 250;

/**
 * Backend has no offset paging; results are truncated at this count and the
 * palette says so, so the user knows to narrow the query.
 */
export const MAX_MESSAGE_RESULTS = 250;

export interface MessageSearchInput {
  /** The query as committed - never mid IME composition. */
  query: string;
  scope: PaletteScope;
  messageType: MessageTypeFilter;
  /** The open project (scope "project" searches it). */
  project: ClaudeProject | null;
  /** The palette is open; false cancels everything. */
  enabled: boolean;
}

export interface MessageSearchConfig {
  claudePath: string;
  activeProviders: readonly string[];
  customClaudePaths?: unknown[];
  wslEnabled: boolean;
  wslExcludedDistros: readonly string[];
}

export interface MessageSearchRequest {
  command: "search_messages" | "search_all_providers";
  args: Record<string, unknown>;
}

/** The request for `input`, or null when there is nothing to search. */
export function buildMessageSearchRequest(
  input: Pick<MessageSearchInput, "query" | "scope" | "messageType" | "project">,
  config: MessageSearchConfig,
): MessageSearchRequest | null {
  const query = input.query.trim();
  const customClaudePaths = config.customClaudePaths;
  const hasCustomPaths = (customClaudePaths?.length ?? 0) > 0;
  const hasAlternativeSource =
    hasNonDefaultProvider(config.activeProviders as ProviderId[]) || hasCustomPaths || config.wslEnabled;
  if (query.length < MIN_MESSAGE_QUERY || (!config.claudePath && !hasAlternativeSource)) return null;

  const scoped = input.scope === "project" ? input.project : null;
  const filters: Record<string, unknown> = {};
  // The backend matches a project by its folder name (the path's last segment).
  if (scoped) filters.projects = [getPathLeaf(scoped.path) || scoped.path];
  if (input.messageType !== "all") filters.messageType = input.messageType;

  const activeProviders = scoped
    ? [scoped.provider ?? "claude"]
    : [...config.activeProviders];
  const useAllProviders = hasNonDefaultProvider(activeProviders as ProviderId[]) || hasCustomPaths || config.wslEnabled;
  const claudePath = config.claudePath || undefined;
  if (!useAllProviders) {
    return {
      command: "search_messages",
      args: { claudePath, query, filters, limit: MAX_MESSAGE_RESULTS },
    };
  }
  return {
    command: "search_all_providers",
    args: {
      claudePath,
      query,
      activeProviders,
      filters,
      limit: MAX_MESSAGE_RESULTS,
      customClaudePaths: hasCustomPaths ? customClaudePaths : undefined,
      wslEnabled: config.wslEnabled,
      wslProviders: config.wslEnabled ? getWslSearchableProviderIds(activeProviders as ProviderId[]) : undefined,
      wslExcludedDistros: [...config.wslExcludedDistros],
    },
  };
}

export type MessageSearchView =
  /** Nothing to search (query too short, palette closed). */
  | { status: "idle" }
  /** Scope "project" on a project whose provider the search cannot reach. */
  | { status: "unsearchable" }
  | { status: "loading" }
  | { status: "done"; query: string; results: ClaudeMessage[] }
  | { status: "error"; query: string };

type Settled =
  | { key: string; query: string; results: ClaudeMessage[] }
  | { key: string; query: string; failed: true };

export function usePaletteMessageSearch(input: MessageSearchInput): {
  view: MessageSearchView;
  /** Ask again for the current query (after a failure). */
  retry: () => void;
} {
  const { claudePath, activeProviders, userMetadata } = useAppStore();
  const settings = userMetadata?.settings;
  // One string per distinct request: equal settings in new objects (a
  // metadata save) neither re-send the search nor drop its answer.
  const config: MessageSearchConfig = {
    claudePath: claudePath ?? "",
    activeProviders: activeProviders ?? [],
    customClaudePaths: settings?.customClaudePaths,
    wslEnabled: settings?.wsl?.enabled ?? false,
    wslExcludedDistros: settings?.wsl?.excludedDistros ?? [],
  };
  const unsearchable =
    input.enabled && input.scope === "project" && input.project != null && !isMessageSearchable(input.project);
  const request = input.enabled && !unsearchable ? buildMessageSearchRequest(input, config) : null;
  const [attempt, setAttempt] = useState(0);
  const requestKey = request ? JSON.stringify([request.command, request.args, attempt]) : null;

  const [settled, setSettled] = useState<Settled | null>(null);
  // Request identity: bumped by every new key and by cleanup (close, unmount).
  const generation = useRef(0);

  // Keyed on the request's text alone: `request` is rebuilt every render, and
  // the one this effect closes over is the one `requestKey` was made from.
  useEffect(() => {
    if (!requestKey || !request) return;
    const { command, args } = request;
    const query = String(args.query ?? "");
    const mine = ++generation.current;
    const ownsData = () => generation.current === mine;
    const timer = setTimeout(() => {
      api<ClaudeMessage[]>(command, args).then(
        (results) => {
          if (ownsData()) setSettled({ key: requestKey, query, results });
        },
        (error: unknown) => {
          if (!ownsData()) return;
          console.error("Palette message search failed:", error);
          setSettled({ key: requestKey, query, failed: true });
        },
      );
    }, MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let view: MessageSearchView;
  if (unsearchable) view = { status: "unsearchable" };
  else if (!requestKey) view = { status: "idle" };
  else if (settled?.key !== requestKey) view = { status: "loading" };
  else if ("failed" in settled) view = { status: "error", query: settled.query };
  else view = { status: "done", query: settled.query, results: settled.results };
  return { view, retry };
}
