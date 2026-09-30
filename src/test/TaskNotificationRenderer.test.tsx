import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskNotificationRenderer } from "../components/contentRenderer/TaskNotificationRenderer";
import { ExpandKeyProvider } from "../contexts/CaptureExpandContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

const notification = (status: string) =>
  `<task-notification><task-id>bg-1</task-id><status>${status}</status><summary>Background command did not finish</summary></task-notification>`;

describe("TaskNotificationRenderer status", () => {
  it.each(["failed", "killed", "stopped", "error"])(
    "shows a %s task as failed, not done",
    (status) => {
      render(
        <ExpandKeyProvider value={`task-notification-${status}`}>
          <TaskNotificationRenderer text={notification(status)} />
        </ExpandKeyProvider>,
      );

      expect(screen.getByText("FAIL")).toHaveClass("text-destructive");
      expect(screen.queryByText("DONE")).not.toBeInTheDocument();
    },
  );

  it("shows a completed task as done", () => {
    render(
      <ExpandKeyProvider value="task-notification-completed">
        <TaskNotificationRenderer text={notification("completed")} />
      </ExpandKeyProvider>,
    );

    expect(screen.getByText("DONE")).toHaveClass("text-success");
  });
});
