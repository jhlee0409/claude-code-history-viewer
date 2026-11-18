/**
 * The unavailable-location clear (#780): the dialog shows exactly what the
 * backend resolved, sends back only those sessions once the user confirms
 * the folder is gone, and reports each session - a failed list refresh
 * apart from the clear itself.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { AppErrorType } from "@/types";
import type { ClaudeProject, ClearedSession, UnavailableCleanupPreview } from "@/types";
import { ClearUnavailableSessionsDialog } from "../ClearUnavailableSessionsDialog";

vi.mock("@/services/api", () => ({ api: vi.fn() }));

const location = "/Volumes/usb/app";
const claude: ClaudeProject = {
  name: "app", path: "/home/me/.claude/projects/-Volumes-usb-app", actual_path: location,
  // Deliberately not the number of resolved targets: the count shown must
  // come from the preview, never from here.
  session_count: 99, message_count: 1, last_modified: "2026-10-01T00:00:00Z", path_status: "unavailable",
};
const cursor: ClaudeProject = {
  ...claude, path: "/cursor/workspace/abc", provider: "cursor",
};

const store = claude.path;
const preview: UnavailableCleanupPreview[] = [
  {
    provider: "claude", project_path: claude.path, location, excluded: null, detail: null,
    targets: [
      { session_path: `${store}/a.jsonl`, trash_paths: [`${store}/a.jsonl`, `${store}/a`] },
      { session_path: `${store}/b.jsonl`, trash_paths: [`${store}/b.jsonl`] },
    ],
    skipped: [{ session_path: `${store}/old.jsonl`, reason: "This session's working folder still exists: /work" }],
  },
  {
    provider: "cursor", project_path: cursor.path, location: null, excluded: "permanent_delete",
    detail: null, targets: [], skipped: [],
  },
];

const initial = useAppStore.getState();

function mockApi(results: ClearedSession[]) {
  vi.mocked(api).mockImplementation(async (command: string) => {
    if (command === "preview_unavailable_session_cleanup") return preview;
    if (command === "clear_unavailable_sessions") return results;
    throw new Error(`unexpected ${command}`);
  });
}

const renderDialog = (onClose = vi.fn()) =>
  render(
    <ClearUnavailableSessionsDialog location={location} projects={[claude, cursor]} onClose={onClose} />
  );

const result = (session: string, error: string | null): ClearedSession => ({
  provider: "claude", project_path: claude.path, session_path: `${store}/${session}`, error,
});

describe("ClearUnavailableSessionsDialog", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });
  beforeEach(() => {
    vi.mocked(api).mockReset();
    useAppStore.setState({ ...initial, error: null, refreshAllConversations: vi.fn(async () => {}) });
  });
  afterAll(() => { useAppStore.setState(initial); });

  it("previews every resolved trash target and what is not cleared, before anything moves", async () => {
    mockApi([]);
    renderDialog();

    expect(await screen.findByText("2 sessions will be moved to the trash")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("preview_unavailable_session_cleanup", {
      projects: [
        { provider: null, path: claude.path },
        { provider: "cursor", path: cursor.path },
      ],
    });
    const targets = screen.getByTestId("clear-unavailable-target-list");
    for (const path of [`${store}/a.jsonl`, `${store}/a`, `${store}/b.jsonl`]) {
      expect(within(targets).getByText(path)).toBeInTheDocument();
    }
    const kept = screen.getByTestId("clear-unavailable-not-cleared");
    expect(within(kept).getByText(/deletes permanently, with no trash/)).toBeInTheDocument();
    expect(within(kept).getByText(`${store}/old.jsonl`)).toBeInTheDocument();
    expect(within(kept).getByText(/working folder still exists/)).toBeInTheDocument();
    expect(screen.getByText(/moved to the system trash/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("clears only after the folder is acknowledged as deleted, sending the previewed sessions", async () => {
    mockApi([result("a.jsonl", null), result("b.jsonl", null)]);
    renderDialog();

    const confirm = await screen.findByRole("button", { name: "Move 2 sessions to trash" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I deleted this folder myself/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByText("Moved 2 sessions to the system trash.")).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith("clear_unavailable_sessions", {
      projects: [
        { provider: "claude", path: claude.path, session_paths: [`${store}/a.jsonl`, `${store}/b.jsonl`] },
      ],
    });
    expect(useAppStore.getState().refreshAllConversations).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/didn't refresh/)).not.toBeInTheDocument();
  });

  it("reports each failed session next to the ones that moved", async () => {
    mockApi([
      result("a.jsonl", null),
      result("b.jsonl", "The project's location exists again; nothing was moved to the trash"),
    ]);
    renderDialog();

    fireEvent.click(await screen.findByRole("checkbox", { name: /I deleted this folder myself/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2 sessions to trash" }));

    const results = await screen.findByTestId("clear-unavailable-results");
    expect(within(results).getByText("Moved 1 session to the system trash.")).toBeInTheDocument();
    expect(within(results).getByText("1 session wasn't moved")).toBeInTheDocument();
    expect(within(results).getByText(`${store}/b.jsonl`)).toBeInTheDocument();
    expect(within(results).getByText(/location exists again/)).toBeInTheDocument();
  });

  it("reports a failed list refresh separately from a successful clear", async () => {
    mockApi([result("a.jsonl", null), result("b.jsonl", null)]);
    useAppStore.setState({
      refreshAllConversations: vi.fn(async () => {
        useAppStore.setState({ error: { type: AppErrorType.UNKNOWN, message: "scan failed" } });
      }),
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("checkbox", { name: /I deleted this folder myself/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2 sessions to trash" }));

    const results = await screen.findByTestId("clear-unavailable-results");
    expect(within(results).getByText("Moved 2 sessions to the system trash.")).toBeInTheDocument();
    expect(within(results).getByText(/project list didn't refresh/)).toBeInTheDocument();
    expect(within(results).queryByText(/wasn't moved|weren't moved/)).not.toBeInTheDocument();
  });

  it("offers nothing to confirm when no project at the location can be cleared", async () => {
    vi.mocked(api).mockResolvedValue([preview[1]]);
    const onClose = vi.fn();
    renderDialog(onClose);

    expect(await screen.findByText("Nothing at this location can be moved to the trash.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /to trash/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
