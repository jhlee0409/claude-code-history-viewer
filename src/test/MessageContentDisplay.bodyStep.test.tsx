import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MessageContentDisplay } from "../components/messageRenderer/MessageContentDisplay";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";

const wrapper = ({ children }: { children: ReactNode }) => <ExpandKeyProvider value="m-1">{children}</ExpandKeyProvider>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

/**
 * Conversation text is the body step (decision.html §4: body 15 = 대화 내용):
 * the user's own words, the assistant's markdown (`.prose`) and the
 * assistant's plain-text rendering while searching all use it, so the two
 * sides of a conversation never render at different sizes.
 */
describe("conversation text uses the body step", () => {
  it("user message text", () => {
    render(<MessageContentDisplay content="Run the test suite" messageType="user" />, { wrapper });
    expect(screen.getByText("Run the test suite").closest(".text-body")).not.toBeNull();
  });

  it("assistant text while searching (plain text path)", () => {
    render(<MessageContentDisplay content="The flake came from a timer" messageType="assistant" searchQuery="flake" />, { wrapper });
    expect(screen.getByText("flake").closest(".text-body")).not.toBeNull();
  });

  it("assistant markdown", () => {
    const { container } = render(<MessageContentDisplay content="Hello **world**" messageType="assistant" />, { wrapper });
    expect(container.querySelector(".prose")).not.toBeNull();
  });
});
