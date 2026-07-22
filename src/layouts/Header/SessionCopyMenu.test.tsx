import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaudeProject, ClaudeSession } from "@/types";
import { SessionCopyMenu } from "./SessionCopyMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? "",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: React.PropsWithChildren<{ onSelect?: () => void }>) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

const session: ClaudeSession = {
  session_id: "session-id",
  actual_session_id: "019f0000-1111-7222-8333-444455556666",
  file_path: "/Users/test/.codex/sessions/session.jsonl",
  project_name: "project",
  message_count: 10,
  first_message_time: "2026-07-06T00:00:00Z",
  last_message_time: "2026-07-06T01:00:00Z",
  last_modified: "2026-07-06T01:00:00Z",
  has_tool_use: true,
  has_errors: false,
  provider: "codex",
};

const project: ClaudeProject = {
  name: "project",
  path: "/Users/test/.codex/sessions",
  actual_path: "/Users/test/project",
  session_count: 1,
  message_count: 10,
  last_modified: "2026-07-06T01:00:00Z",
  provider: "codex",
};

describe("SessionCopyMenu", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("offers separate copy actions for the full id and resume command", async () => {
    render(<SessionCopyMenu project={project} session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Session ID" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(session.actual_session_id);
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Resume Command" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "cd '/Users/test/project' && codex resume 019f0000-1111-7222-8333-444455556666",
      );
    });
    expect(screen.getByText("019f0000")).toBeInTheDocument();
  });

  it("only offers the id action when the provider cannot resume", async () => {
    render(
      <SessionCopyMenu
        project={{ ...project, provider: "aider" }}
        session={{ ...session, provider: "aider" }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Copy Resume Command" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy Session ID" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(session.actual_session_id);
    });
  });

  it("renders an accessible compact trigger", () => {
    render(<SessionCopyMenu compact project={project} session={session} />);

    expect(
      screen.getByRole("button", { name: "Copy Session ID / Copy Resume Command…" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("019f0000")).not.toBeInTheDocument();
  });
});
