import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listenForWebUIDeepLinks,
  readWebUIDeepLink,
  writeWebUIDeepLink,
} from "./webuiDeepLink";

describe("WebUI deep links", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, "", "/viewer/?foo=kept");
  });

  it("reads session and message identifiers from the current URL", () => {
    window.history.replaceState(
      {},
      "",
      "/viewer/?session=session-123&msg=message-456&foo=kept",
    );

    expect(readWebUIDeepLink()).toEqual({
      sessionId: "session-123",
      messageId: "message-456",
    });
  });

  it("ignores a message identifier when no session is present", () => {
    window.history.replaceState({}, "", "/viewer/?msg=message-456");

    expect(readWebUIDeepLink()).toEqual({
      sessionId: null,
      messageId: null,
    });
  });

  it("pushes a session link while preserving unrelated query parameters", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    writeWebUIDeepLink(
      { sessionId: "session-123", messageId: "message-456" },
      "push",
    );

    expect(pushState).toHaveBeenCalledTimes(1);
    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/viewer/");
    expect(url.searchParams.get("foo")).toBe("kept");
    expect(url.searchParams.get("session")).toBe("session-123");
    expect(url.searchParams.get("msg")).toBe("message-456");
  });

  it("replaces the current entry and removes a stale message identifier", () => {
    window.history.replaceState(
      {},
      "",
      "/viewer/?session=old-session&msg=old-message&foo=kept",
    );
    const replaceState = vi.spyOn(window.history, "replaceState");

    writeWebUIDeepLink(
      { sessionId: "new-session", messageId: null },
      "replace",
    );

    expect(replaceState).toHaveBeenCalledTimes(1);
    const url = new URL(window.location.href);
    expect(url.searchParams.get("session")).toBe("new-session");
    expect(url.searchParams.get("msg")).toBeNull();
    expect(url.searchParams.get("foo")).toBe("kept");
  });

  it("does not add a duplicate browser-history entry", () => {
    window.history.replaceState({}, "", "/viewer/?session=session-123");
    const pushState = vi.spyOn(window.history, "pushState");

    writeWebUIDeepLink(
      { sessionId: "session-123", messageId: null },
      "push",
    );

    expect(pushState).not.toHaveBeenCalled();
  });

  it("does not mutate browser history inside the Tauri desktop app", () => {
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const pushState = vi.spyOn(window.history, "pushState");

    writeWebUIDeepLink(
      { sessionId: "session-123", messageId: null },
      "push",
    );

    expect(pushState).not.toHaveBeenCalled();
  });

  it("reports browser back and forward navigation", () => {
    const listener = vi.fn();
    const stopListening = listenForWebUIDeepLinks(listener);
    window.history.replaceState(
      {},
      "",
      "/viewer/?session=session-123&msg=message-456",
    );

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-123",
      messageId: "message-456",
    });
    stopListening();
  });
});
