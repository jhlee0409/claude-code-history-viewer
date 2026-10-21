/**
 * Issue #574: "Expand long messages by default" setting.
 *
 * Long message bodies collapse to a preview behind "Show more...". With the
 * setting on they start expanded, and the toggle still collapses them.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageContentDisplay } from "../components/messageRenderer/MessageContentDisplay";
import { ExpandKeyProvider } from "../contexts/CaptureExpandContext";
import { useAppStore } from "../store/useAppStore";
import { useExpandRegistry } from "../store/expandRegistryStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

const longText = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");

function renderMessage(messageType: "user" | "assistant") {
  return render(
    <ExpandKeyProvider value={`msg-${messageType}`}>
      <MessageContentDisplay content={longText} messageType={messageType} />
    </ExpandKeyProvider>,
  );
}

describe("MessageContentDisplay expandLongMessages", () => {
  afterEach(() => {
    cleanup();
    act(() => {
      useAppStore.setState({ expandLongMessages: false });
      useExpandRegistry.setState({ states: {} });
    });
  });

  it.each(["user", "assistant"] as const)(
    "collapses a long %s message by default",
    (messageType) => {
      renderMessage(messageType);

      expect(screen.queryByText(/line 20/)).not.toBeInTheDocument();
      expect(screen.getByText("messageContentDisplay.showMore")).toBeInTheDocument();
    },
  );

  it.each(["user", "assistant"] as const)(
    "starts a long %s message expanded when the setting is on",
    (messageType) => {
      act(() => {
        useAppStore.setState({ expandLongMessages: true });
      });
      renderMessage(messageType);

      expect(screen.getByText(/line 20/)).toBeInTheDocument();
      expect(screen.getByText("messageContentDisplay.showLess")).toBeInTheDocument();

      fireEvent.click(screen.getByText("messageContentDisplay.showLess"));

      expect(screen.queryByText(/line 20/)).not.toBeInTheDocument();
      expect(screen.getByText("messageContentDisplay.showMore")).toBeInTheDocument();
    },
  );
});
