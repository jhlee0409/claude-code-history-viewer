import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ClaudeMessage } from "@/types";
import { MessageHeader } from "./MessageHeader";

// An assistant message names its provider by the registry label: ids such as
// `cursor-acp` (#576) and `cursor-agent` are not their translation keys.
const label = (provider: string) => {
  const message = {
    type: "assistant",
    role: "assistant",
    uuid: "a1",
    sessionId: "s1",
    timestamp: "2026-11-18T10:00:00Z",
    content: [],
    provider,
  } as ClaudeMessage;
  return render(
    <TooltipProvider>
      <MessageHeader message={message} />
    </TooltipProvider>,
  ).container.querySelector(".font-medium")?.textContent;
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("MessageHeader provider label", () => {
  it("uses the provider registry label", () => {
    expect(label("cursor-acp")).toBe("Cursor ACP");
    expect(label("cursor-agent")).toBe("Cursor Agent");
    expect(label("hermes")).toBe("Hermes Agent");
  });

  it("keeps an unknown provider id as recorded", () => {
    expect(label("future-provider")).toBe("future-provider");
  });
});
