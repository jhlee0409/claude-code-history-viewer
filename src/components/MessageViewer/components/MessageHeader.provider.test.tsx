import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ClaudeMessage } from "@/types";
import { MessageHeader } from "./MessageHeader";

/**
 * The assistant's name in a message header is the provider's label. Provider
 * ids with a hyphen (`claude-ai` #674, `cursor-agent`) have camelCase
 * translation keys, so the key must come from the provider table, not from
 * the id: `common.provider.claude-ai` does not exist and showed the raw id.
 */

const assistant = (provider?: string): ClaudeMessage =>
  ({
    type: "assistant",
    role: "assistant",
    uuid: "a1",
    sessionId: "s1",
    timestamp: "2026-11-18T10:00:00Z",
    content: [],
    provider,
  }) as ClaudeMessage;

const renderHeader = (message: ClaudeMessage) =>
  render(
    <TooltipProvider>
      <MessageHeader message={message} />
    </TooltipProvider>,
  );

describe("MessageHeader assistant name", () => {
  afterEach(cleanup);

  it.each([
    ["claude-ai", "common.provider.claudeAi"],
    ["cursor-agent", "common.provider.cursorAgent"],
    ["codex", "common.provider.codex"],
    [undefined, "messageViewer.claude"],
    ["claude", "messageViewer.claude"],
  ])("names provider %s by %s", (provider, label) => {
    renderHeader(assistant(provider));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows an unknown provider id as it is", () => {
    renderHeader(assistant("some-new-tool"));
    expect(screen.getByText("some-new-tool")).toBeInTheDocument();
  });
});
