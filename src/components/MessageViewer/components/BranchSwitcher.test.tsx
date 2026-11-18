/**
 * The switcher at a conversation fork (#782): named for screen readers,
 * keyboard reachable, and its buttons pick the neighbouring alternative.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import i18n from "@/i18n";
import type { BranchSwitch } from "@/utils/conversationBranches";
import { BranchSwitcher } from "./BranchSwitcher";

const fork = (position: number): BranchSwitch => ({
  parentUuid: "a1",
  headUuids: ["old", "mid", "new"],
  position,
  placement: "after",
});

describe("BranchSwitcher", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the group with the shown alternative and offers its neighbours", () => {
    const onSelect = vi.fn();
    render(<BranchSwitcher branch={fork(1)} onSelect={onSelect} />);

    const group = screen.getByRole("group", { name: "Conversation branch 2 of 3" });
    expect(group).toHaveTextContent("2 / 3");

    fireEvent.click(screen.getByRole("button", { name: "Previous branch" }));
    expect(onSelect).toHaveBeenLastCalledWith("a1", "old");
    fireEvent.click(screen.getByRole("button", { name: "Next branch" }));
    expect(onSelect).toHaveBeenLastCalledWith("a1", "new");
  });

  it("disables the button past either end", () => {
    const { rerender } = render(<BranchSwitcher branch={fork(0)} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous branch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next branch" })).toBeEnabled();

    rerender(<BranchSwitcher branch={fork(2)} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next branch" })).toBeDisabled();
  });

  it("keeps keyboard focus on the switcher when the last alternative disables the pressed button", () => {
    function Harness() {
      const [position, setPosition] = useState(1);
      return (
        <BranchSwitcher
          branch={fork(position)}
          onSelect={(_, head) => setPosition(["old", "mid", "new"].indexOf(head))}
        />
      );
    }
    render(<Harness />);
    const next = screen.getByRole("button", { name: "Next branch" });
    next.focus();
    fireEvent.click(next);

    expect(screen.getByRole("group", { name: "Conversation branch 3 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous branch" })).toHaveFocus();
  });

  it("speaks Korean", async () => {
    await i18n.changeLanguage("ko");
    render(<BranchSwitcher branch={fork(0)} onSelect={vi.fn()} />);
    expect(screen.getByRole("group", { name: "대화 분기 3개 중 1번째" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 분기" })).toBeInTheDocument();
    await i18n.changeLanguage("en");
  });
});
