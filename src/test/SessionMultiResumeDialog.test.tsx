import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionMultiResumeDialog } from "@/components/SessionItem/components/SessionMultiResumeDialog";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallbackOrOptions?: string | { defaultValue?: string; count?: number }) => {
        if (typeof fallbackOrOptions === "string") return fallbackOrOptions;
        const defaultValue = fallbackOrOptions?.defaultValue ?? "";
        return defaultValue.replace("{{count}}", String(fallbackOrOptions?.count ?? ""));
      },
    }),
  };
});

describe("SessionMultiResumeDialog", () => {
  it("renders selected sessions, skipped count, and calls confirm", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <SessionMultiResumeDialog
        open={true}
        onOpenChange={onOpenChange}
        count={2}
        skippedCount={1}
        names={["First session", "Second session"]}
        isResuming={false}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Resume 2 sessions" })
    ).toBeInTheDocument();
    expect(screen.getByText("First session")).toBeInTheDocument();
    expect(screen.getByText("Second session")).toBeInTheDocument();
    expect(
      screen.getByText("1 selected session(s) can't be resumed and will be skipped.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Resume 2" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("displays dangerous permission warning when hasDangerousFlags is true", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <SessionMultiResumeDialog
        open={true}
        onOpenChange={onOpenChange}
        count={5}
        skippedCount={0}
        names={["Session 1", "Session 2"]}
        isResuming={false}
        onConfirm={onConfirm}
        hasDangerousFlags={true}
      />
    );

    expect(screen.getByText("Permission checks disabled")).toBeInTheDocument();
    expect(
      screen.getByText("This will start 5 agents with permission checks disabled. Continue?")
    ).toBeInTheDocument();
  });

  it("renders dangerousCount warning when dangerousCount is specified", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <SessionMultiResumeDialog
        open={true}
        onOpenChange={onOpenChange}
        count={5}
        dangerousCount={2}
        skippedCount={0}
        names={["Session 1", "Session 2"]}
        isResuming={false}
        onConfirm={onConfirm}
        hasDangerousFlags={true}
      />
    );

    expect(screen.getByText("Permission checks disabled")).toBeInTheDocument();
    expect(
      screen.getByText("This will start 2 agents with permission checks disabled. Continue?")
    ).toBeInTheDocument();
  });
});
