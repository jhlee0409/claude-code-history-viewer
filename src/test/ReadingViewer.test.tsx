import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRAST_MORE_QUERY } from "@/hooks/useHighContrast";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReadingViewer } from "@/components/ReadingViewer";
import type { ClaudeSession } from "@/types";

const { api, save, toast, state } = vi.hoisted(() => ({
  api: vi.fn(), save: vi.fn(), toast: { success: vi.fn(), error: vi.fn() },
  state: { fontScale: 110, highContrast: false as boolean | null, targetMessageUuid: null as string | null,
    clearTargetMessage: vi.fn(), parentSessionStack: [] as ClaudeSession[], navigateBackToParent: vi.fn() },
}));
vi.mock("@/services/api", () => ({ api }));
vi.mock("@/utils/fileDialog", () => ({ saveFileDialog: save }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/contexts/theme", () => ({ useTheme: () => ({ isDarkMode: true }) }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));

const session = { session_id: "s1", file_path: "/history/s1.jsonl", provider: "claude" } as ClaudeSession;
const doc = { document_id: "doc-1", capability: "cap-1", bridge_nonce: "nonce-1", renderer_version: "1.7.0" };
const ready = () => {
  const frame = screen.getByTitle("reading.frameTitle") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    data: { channel: "cchv-reading", version: 1, nonce: doc.bridge_nonce, type: "ready" },
  })));
  return frame;
};
beforeEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); api.mockResolvedValue(doc); save.mockResolvedValue(true); state.highContrast = false; state.targetMessageUuid = null; state.parentSessionStack = []; state.navigateBackToParent.mockResolvedValue(undefined); });

describe("ReadingViewer", () => {
  it("prepares from raw session identity and isolates the document", async () => {
    render(<ReadingViewer session={session} />);
    await screen.findByTitle("reading.frameTitle");
    expect(api).toHaveBeenCalledWith("prepare_reading_document", { sessionPath: session.file_path, forceRefresh: false });
    const frame = ready();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toContain("/api/reading_documents/doc-1?capability=cap-1");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
  });
  it("shows preparation errors with a retry", async () => {
    api.mockRejectedValueOnce(new Error("renderer_missing"));
    render(<ReadingViewer session={session} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "reading.retry" }));
    await screen.findByTitle("reading.frameTitle");
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("does not display a previous session's late response", async () => {
    let resolve!: (value: typeof doc) => void;
    api.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const view = render(<ReadingViewer session={session} />);
    view.rerender(<ReadingViewer session={{ ...session, session_id: "s2", file_path: "/history/s2.jsonl" }} />);
    await screen.findByTitle("reading.frameTitle");
    await act(async () => resolve({ ...doc, document_id: "stale-doc" }));
    expect(screen.getByTitle("reading.frameTitle").getAttribute("src")).not.toContain("stale-doc");
  });
  it("ignores messages with the wrong source or nonce and sends appearance after ready", async () => {
    render(<ReadingViewer session={session} />);
    const frame = await screen.findByTitle("reading.frameTitle") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { channel: "cchv-reading", version: 1, nonce: doc.bridge_nonce, type: "ready" },
    })));
    expect(post).not.toHaveBeenCalled();
    ready();
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "appearance", isDark: true, fontScale: 110, nonce: doc.bridge_nonce,
    }), "*"));
  });
  it("sends the upstream effective system contrast to the document", async () => {
    state.highContrast = null;
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === CONTRAST_MORE_QUERY,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    render(<ReadingViewer session={session} />);
    const frame = await screen.findByTitle("reading.frameTitle") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    ready();
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "appearance", highContrast: true,
    }), "*"));
  });
  it("keeps the current document while a refresh runs", async () => {
    render(<ReadingViewer session={session} />);
    await screen.findByTitle("reading.frameTitle");
    ready();
    let resolve!: (value: typeof doc) => void;
    api.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    fireEvent.click(screen.getByRole("button", { name: "reading.refresh" }));
    expect(screen.getByTitle("reading.frameTitle")).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith("prepare_reading_document", { sessionPath: session.file_path, forceRefresh: true });
    await act(async () => resolve({ ...doc, document_id: "refreshed" }));
    expect(screen.getByTitle("reading.frameTitle").getAttribute("src")).toContain("refreshed");
  });
  it("reports export failures without claiming success", async () => {
    render(<ReadingViewer session={session} />);
    await screen.findByTitle("reading.frameTitle");
    api.mockRejectedValueOnce(new Error("expired document"));
    fireEvent.click(screen.getByRole("button", { name: "reading.export" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("reading.exportFailed"));
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("navigates UUID targets only through the ready document bridge", async () => {
    state.targetMessageUuid = "target-uuid";
    render(<ReadingViewer session={session} />);
    const frame = await screen.findByTitle("reading.frameTitle") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    ready();
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "navigate", uuid: "target-uuid" }), "*"));
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      data: { channel: "cchv-reading", version: 1, nonce: doc.bridge_nonce, type: "navigated", uuid: "target-uuid", found: true },
    })));
    expect(state.clearTargetMessage).toHaveBeenCalledOnce();
  });
  it("does not restore the old anchor after a successful target is cleared", async () => {
    const view = render(<ReadingViewer session={session} />);
    const frame = await screen.findByTitle("reading.frameTitle") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    ready();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      data: { channel: "cchv-reading", version: 1, nonce: doc.bridge_nonce, type: "anchor", uuid: "old-anchor" },
    })));
    state.targetMessageUuid = "new-target";
    view.rerender(<ReadingViewer session={session} />);
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "navigate", uuid: "new-target" }), "*"));
    post.mockClear();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      data: { channel: "cchv-reading", version: 1, nonce: doc.bridge_nonce, type: "navigated", uuid: "new-target", found: true },
    })));
    state.targetMessageUuid = null;
    view.rerender(<ReadingViewer session={session} />);
    expect(post.mock.calls.filter(([payload]) => payload.type === "navigate")).toEqual([]);
  });
  it("keeps parent-session navigation reachable in reading mode", async () => {
    state.parentSessionStack = [session];
    render(<ReadingViewer session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "renderers.agentTool.backToParent" }));
    await waitFor(() => expect(state.navigateBackToParent).toHaveBeenCalledOnce());
  });
  it("exports the complete document and respects save cancellation", async () => {
    render(<ReadingViewer session={session} />);
    await screen.findByTitle("reading.frameTitle");
    ready();
    api.mockResolvedValueOnce("<!doctype html><html>complete</html>");
    save.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "reading.export" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("<!doctype html><html>complete</html>", expect.objectContaining({ mimeType: "text/html" })));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
