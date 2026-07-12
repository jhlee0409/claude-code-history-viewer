import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionDeleteDialog } from "@/components/SessionItem/components/SessionDeleteDialog";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? "",
    }),
  };
});

describe("SessionDeleteDialog", () => {
  it("renders an in-app confirmation dialog with cancel and delete actions", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <SessionDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete Session"
        description="This will move the session file to your system Trash."
        filePath="/tmp/session.jsonl"
        isDeleting={false}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Delete Session" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("This will move the session file to your system Trash.")
    ).toBeInTheDocument();
    expect(screen.getByText("/tmp/session.jsonl")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete Session" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
