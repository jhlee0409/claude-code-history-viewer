import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileNavigatorSheet } from "@/components/mobile/MobileNavigatorSheet";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/MessageNavigator", () => ({
  MessageNavigator: () => <button type="button">Entry</button>,
}));

describe("MobileNavigatorSheet focus lifecycle", () => {
  it("returns focus to its opening control after Escape closes the sheet", async () => {
    render(<MobileNavigatorSheet messages={[]} />);
    const trigger = screen.getByRole("button", {
      name: "common.mobile.openNavigator",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("button", { name: "Entry" })).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
