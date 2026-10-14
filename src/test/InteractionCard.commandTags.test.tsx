import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InteractionCard } from "../components/SessionBoard/InteractionCard";
import type { ClaudeMessage } from "../types";
import type { ZoomLevel } from "../types/board.types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

const RAW_TAG = /<\/?(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>/;

function userMessage(content: string): ClaudeMessage {
  return {
    uuid: "u-1",
    sessionId: "s-1",
    timestamp: "2026-06-01T00:00:00Z",
    type: "user",
    role: "user",
    content,
  } as unknown as ClaudeMessage;
}

function renderCard(content: string, zoomLevel: ZoomLevel) {
  return render(
    <InteractionCard
      message={userMessage(content)}
      zoomLevel={zoomLevel}
      isExpanded={false}
      onClick={() => {}}
    />,
  );
}

describe("InteractionCard command messages", () => {
  const cases: [string, string, string][] = [
    [
      "slash command",
      "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>PR 42</command-args>",
      "/review PR 42",
    ],
    [
      "local command stdout",
      "<local-command-stdout>Total cost: $0.42</local-command-stdout>",
      "Total cost: $0.42",
    ],
  ];

  for (const zoomLevel of [1, 2] as const) {
    it.each(cases)(`zoom ${zoomLevel}: shows %s without raw tags`, (_label, raw, expected) => {
      const { container } = renderCard(raw, zoomLevel);
      expect(container.textContent).toContain(expected);
      expect(container.textContent).not.toMatch(RAW_TAG);
    });
  }
});
