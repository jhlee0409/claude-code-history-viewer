import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NO_VALUE } from "@/lib/format/locale";
import type { ClaudeAssistantMessage, ClaudeMessage, ClaudeUserMessage } from "@/types";
import { MessageHeader } from "./MessageHeader";

/**
 * Inline per-message token usage (#570): an opt-in view setting that puts an
 * assistant message's input/output (and cache) counters in its header,
 * without the ⓘ tooltip. Unrecorded counters stay unrecorded (#716/#718).
 */

const assistant = (usage: ClaudeAssistantMessage["usage"], extra: Partial<ClaudeAssistantMessage> = {}): ClaudeMessage => ({
  type: "assistant",
  role: "assistant",
  uuid: "a1",
  sessionId: "s1",
  timestamp: "2026-11-18T10:00:00Z",
  model: "claude-sonnet-4-5",
  content: [],
  usage,
  ...extra,
});

const renderHeader = (message: ClaudeMessage) =>
  render(
    <TooltipProvider>
      <MessageHeader message={message} />
    </TooltipProvider>,
  );

const usageGroup = () => screen.queryByRole("group", { name: "messageViewer.inlineTokens.label" });
const tokenSegment = (key: string) => usageGroup()?.querySelector(`[data-token="${key}"]`) as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ showInlineTokenUsage: false });
});

afterEach(cleanup);

describe("inline token usage setting", () => {
  it("is off by default", async () => {
    await useAppStore.getState().loadUpdateSettings();
    expect(useAppStore.getState().showInlineTokenUsage).toBe(false);
  });

  it("the toggle flips it and persists it to settings.json", async () => {
    await act(async () => useAppStore.getState().toggleInlineTokenUsage());
    expect(useAppStore.getState().showInlineTokenUsage).toBe(true);
    await vi.waitFor(() => expect(localStorage.getItem("webui:settings.json:showInlineTokenUsage")).toBe("true"));

    useAppStore.setState({ showInlineTokenUsage: false });
    await useAppStore.getState().loadUpdateSettings();
    expect(useAppStore.getState().showInlineTokenUsage).toBe(true);

    await act(async () => useAppStore.getState().toggleInlineTokenUsage());
    await vi.waitFor(() => expect(localStorage.getItem("webui:settings.json:showInlineTokenUsage")).toBe("false"));
    await useAppStore.getState().loadUpdateSettings();
    expect(useAppStore.getState().showInlineTokenUsage).toBe(false);
  });
});

describe("MessageHeader inline token usage", () => {
  it("shows nothing inline while the setting is off", () => {
    renderHeader(assistant({ input_tokens: 1200, output_tokens: 340 }));
    expect(usageGroup()).toBeNull();
  });

  it("shows input and output inline once the setting is on, beside the model", () => {
    useAppStore.setState({ showInlineTokenUsage: true });
    renderHeader(assistant({ input_tokens: 1200, output_tokens: 34_500 }));
    const group = usageGroup();
    expect(group).not.toBeNull();
    expect(tokenSegment("input")).toHaveTextContent("messageViewer.inlineTokens.input 1,200");
    expect(tokenSegment("input")).toHaveAttribute("title", "assistantMessageDetails.input: 1,200");
    // Large counts are compact inline; the exact count stays in the title.
    expect(tokenSegment("output")).toHaveTextContent("34.5K");
    expect(tokenSegment("output")).toHaveAttribute("title", "assistantMessageDetails.output: 34,500");
    // The model and its ⓘ details stay where they were.
    expect(screen.getByRole("button", { name: "assistantMessageDetails.model" })).toBeInTheDocument();
  });

  it("an unrecorded counter is not shown as zero, and a recorded zero is", () => {
    useAppStore.setState({ showInlineTokenUsage: true });
    renderHeader(assistant({ output_tokens: 0 }));
    expect(tokenSegment("input")).toHaveTextContent(NO_VALUE);
    expect(tokenSegment("input")).not.toHaveTextContent("0");
    expect(tokenSegment("input")).toHaveAttribute(
      "title",
      "assistantMessageDetails.input: common.missingValue.notRecorded",
    );
    expect(tokenSegment("output")).toHaveTextContent("0");
    expect(tokenSegment("output")).toHaveAttribute("title", "assistantMessageDetails.output: 0");
  });

  it("adds cache read and write only when the message used the cache", () => {
    useAppStore.setState({ showInlineTokenUsage: true });
    renderHeader(
      assistant({ input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 41_057, cache_creation_input_tokens: 0 }),
    );
    expect(tokenSegment("cacheRead")).toHaveTextContent("41.1K");
    expect(tokenSegment("cacheWrite")).toBeNull();
    cleanup();

    renderHeader(assistant({ input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 900 }));
    expect(tokenSegment("cacheRead")).toBeNull();
    expect(tokenSegment("cacheWrite")).toHaveTextContent("900");
  });

  it("shows usage on an assistant message without a model, and never on messages without usage", () => {
    useAppStore.setState({ showInlineTokenUsage: true });
    renderHeader(assistant({ input_tokens: 7, output_tokens: 8 }, { model: undefined }));
    expect(tokenSegment("output")).toHaveTextContent("8");
    cleanup();

    renderHeader(assistant(undefined));
    expect(usageGroup()).toBeNull();
    cleanup();

    const user: ClaudeUserMessage = {
      type: "user",
      role: "user",
      uuid: "u1",
      sessionId: "s1",
      timestamp: "2026-11-18T10:00:00Z",
      content: "hi",
    };
    renderHeader(user);
    expect(usageGroup()).toBeNull();
  });
});
