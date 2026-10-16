import { isWebUI } from "./platform";

export const WEBUI_SESSION_PARAM = "session";
export const WEBUI_MESSAGE_PARAM = "msg";
/** The conversation tab the session is open in (plan §9b F1). */
export const WEBUI_TAB_PARAM = "tab";

export type WebUIHistoryMode = "push" | "replace" | "none";

export interface WebUINavigationOptions {
  history?: WebUIHistoryMode;
}

export interface WebUIDeepLink {
  sessionId: string | null;
  messageId: string | null;
  /**
   * The tab the URL's session was open in. Read from the URL; a write takes
   * it from the active tab (`registerWebUITabSource`), never from the caller.
   */
  tabId?: string | null;
}

let tabSource: (() => string | null) | null = null;

/**
 * Where URL writes read the active tab's id from (the store registers it).
 * The id rides with the session: a URL without a session names no tab.
 */
export function registerWebUITabSource(source: (() => string | null) | null): void {
  tabSource = source;
}

const normalizedParam = (value: string | null): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export function readWebUIDeepLink(): WebUIDeepLink {
  if (!isWebUI()) {
    return { sessionId: null, messageId: null };
  }

  const url = new URL(window.location.href);
  const sessionId = normalizedParam(url.searchParams.get(WEBUI_SESSION_PARAM));
  if (!sessionId) {
    return { sessionId: null, messageId: null };
  }

  const tabId = normalizedParam(url.searchParams.get(WEBUI_TAB_PARAM));
  return {
    sessionId,
    messageId: normalizedParam(url.searchParams.get(WEBUI_MESSAGE_PARAM)),
    ...(tabId ? { tabId } : {}),
  };
}

export function writeWebUIDeepLink(
  deepLink: WebUIDeepLink,
  historyMode: WebUIHistoryMode = "push",
): void {
  if (!isWebUI() || historyMode === "none") return;

  const url = new URL(window.location.href);
  const sessionId = normalizedParam(deepLink.sessionId);
  const messageId = sessionId ? normalizedParam(deepLink.messageId) : null;
  const tabId = sessionId ? normalizedParam(tabSource?.() ?? null) : null;

  if (sessionId) {
    url.searchParams.set(WEBUI_SESSION_PARAM, sessionId);
  } else {
    url.searchParams.delete(WEBUI_SESSION_PARAM);
  }

  if (messageId) {
    url.searchParams.set(WEBUI_MESSAGE_PARAM, messageId);
  } else {
    url.searchParams.delete(WEBUI_MESSAGE_PARAM);
  }

  if (tabId) {
    url.searchParams.set(WEBUI_TAB_PARAM, tabId);
  } else {
    url.searchParams.delete(WEBUI_TAB_PARAM);
  }

  if (url.href === window.location.href) return;

  if (historyMode === "replace") {
    window.history.replaceState(window.history.state, "", url);
  } else {
    window.history.pushState(window.history.state, "", url);
  }
}

const currentHref = (): string =>
  typeof window === "undefined" ? "" : window.location.href;

/**
 * One navigation is one browser history step, however many URL writes it
 * makes (dropping the outgoing session, opening the new one, its message).
 * Returns the mode for the move's next write: the navigation's own mode until
 * the URL has actually changed since the move began, then "replace", so later
 * writes refine the entry the first one added. Whether an entry is added
 * depends only on whether the URL changes - a write that turned out to be a
 * no-op (clearing a session the URL never had) does not use up the push.
 */
export function beginHistoryStep(
  mode: WebUIHistoryMode,
): () => WebUIHistoryMode {
  const before = currentHref();
  return () =>
    mode === "push" && currentHref() !== before ? "replace" : mode;
}

export function listenForWebUIDeepLinks(
  listener: (deepLink: WebUIDeepLink) => void,
): () => void {
  if (!isWebUI()) return () => {};

  const handlePopState = () => listener(readWebUIDeepLink());
  window.addEventListener("popstate", handlePopState);
  return () => window.removeEventListener("popstate", handlePopState);
}
