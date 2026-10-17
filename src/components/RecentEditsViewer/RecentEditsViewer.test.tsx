/**
 * The Edits screen (T9b): the one recent-edits surface. It took over the
 * removed dock's scope, grouping, density, missing-only filter, request-keyed
 * pages, restore scope and jump-to-message; these pin each of them on the
 * screen, plus the page's own search, counts and "show more".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    }),
  };
});

vi.mock("@/contexts/theme", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

type MockState = Record<string, unknown>;
let state: MockState;

vi.mock("@/store/useAppStore", () => ({
  useAppStore: <T,>(selector?: (s: MockState) => T) =>
    selector ? selector(state) : (state as unknown as T),
}));

/** Every row the screen renders, with the props it got. */
const rows: { kind: "card" | "compact"; props: Record<string, unknown> }[] = [];
vi.mock("./FileEditItem", () => ({
  FileEditItem: (props: Record<string, unknown>) => {
    rows.push({ kind: "card", props });
    return <div data-row="card">{(props.edit as { file_path: string }).file_path}</div>;
  },
}));
vi.mock("./FileEditRowCompact", () => ({
  FileEditRowCompact: (props: Record<string, unknown>) => {
    rows.push({ kind: "compact", props });
    return <div data-row="compact">{(props.edit as { file_path: string }).file_path}</div>;
  },
}));

import { RecentEditsViewer } from "./RecentEditsViewer";
import { recentEditsRequestKey, type RecentEditsRequest } from "@/store/slices/recentEditsSlice";
import type { RecentFileEdit } from "@/types";

const PROJECT = { path: "/storage/project", actual_path: "/project", provider: "claude", name: "project" };
const SESSION = {
  session_id: "s1",
  actual_session_id: "s1-actual",
  file_path: "/storage/project/s1.jsonl",
  summary: "first",
};
const OTHER_SESSION = { session_id: "s2", actual_session_id: "s2", file_path: "/storage/project/s2.jsonl" };

const edit = (file_path: string, extra: Partial<RecentFileEdit> = {}): RecentFileEdit => ({
  file_path,
  timestamp: "2026-08-21T10:00:00Z",
  session_id: "s1-actual",
  operation_type: "edit",
  content_after_change: `content of ${file_path}`,
  lines_added: 1,
  lines_removed: 0,
  ...extra,
});

const listFor = (request: RecentEditsRequest, files: RecentFileEdit[], hasMore = false) => ({
  files,
  totalEditsCount: 9,
  uniqueFilesCount: 5,
  projectCwd: "/project",
  offset: 0,
  limit: 20,
  hasMore,
  requestKey: recentEditsRequestKey(request),
  request,
});

const projectRequest: RecentEditsRequest = {
  projectPath: PROJECT.path,
  scope: "project",
  grouping: "file",
  sessionFilePath: SESSION.file_path,
};
const sessionRequest: RecentEditsRequest = {
  projectPath: PROJECT.path,
  scope: "session",
  grouping: "edit",
  sessionFilePath: SESSION.file_path,
};

const actions = () => ({
  loadRecentEditsList: vi.fn(async () => undefined),
  loadMoreRecentEditsList: vi.fn(async () => undefined),
  markRecentEditRestored: vi.fn(),
  setRecentEditsScope: vi.fn(),
  setRecentEditsDensity: vi.fn(),
  setRecentEditsGrouping: vi.fn(),
  setRecentEditsMissingOnly: vi.fn(),
  navigate: vi.fn(async () => true),
});

function baseState(overrides: MockState = {}): MockState {
  return {
    selectedProject: PROJECT,
    selectedSession: SESSION,
    sessions: [SESSION, OTHER_SESSION],
    recentEditsScope: "project",
    recentEditsGroupingProject: "file",
    recentEditsGroupingSession: "edit",
    recentEditsDensity: "standard",
    recentEditsMissingOnly: false,
    recentEditsList: null,
    recentEditsRequestedKey: null,
    recentEditsError: null,
    isLoadingRecentEdits: false,
    isLoadingMoreRecentEdits: false,
    ...actions(),
    ...overrides,
  };
}

const fn = (name: string) => state[name] as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rows.length = 0;
});

describe("the Edits screen asks for its scope and grouping", () => {
  it("loads the project-wide request with the project grouping by default", () => {
    state = baseState();
    render(<RecentEditsViewer />);
    expect(fn("loadRecentEditsList")).toHaveBeenCalledWith(projectRequest);
  });

  it("session scope asks for the open session's edits with the session grouping", () => {
    state = baseState({ recentEditsScope: "session" });
    render(<RecentEditsViewer />);
    expect(fn("loadRecentEditsList")).toHaveBeenCalledWith(sessionRequest);
  });

  it("without an open session, session scope falls back to the project, and its button is off", () => {
    state = baseState({ selectedSession: null, recentEditsScope: "session" });
    render(<RecentEditsViewer />);
    expect(fn("loadRecentEditsList")).toHaveBeenCalledWith({
      projectPath: PROJECT.path,
      scope: "project",
      // The project scope's own grouping, not the stored session scope's.
      grouping: "file",
      sessionFilePath: undefined,
    });
    expect(screen.getByRole("button", { name: "Session" }).hasAttribute("disabled")).toBe(true);
  });

  it("without an open session, the rows are grouped as the project scope groups them", () => {
    const fallback: RecentEditsRequest = { ...projectRequest, sessionFilePath: undefined };
    state = baseState({
      selectedSession: null,
      recentEditsScope: "session",
      recentEditsDensity: "compact",
      recentEditsList: listFor(fallback, [edit("/project/a.ts")]),
    });
    render(<RecentEditsViewer />);
    // The stored session scope groups by edit; the scope shown is the
    // project's, which groups by file (rows and the file-grouping footer).
    expect(rows[0]?.props.grouping).toBe("file");
    expect(screen.getByText("recentEdits.footerInfo")).toBeTruthy();
  });

  it("the scope and density toggles write their preferences", () => {
    state = baseState({ recentEditsScope: "session", recentEditsList: listFor(sessionRequest, [edit("/project/a.ts")]) });
    render(<RecentEditsViewer />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(fn("setRecentEditsScope")).toHaveBeenCalledWith("project");
    fireEvent.click(screen.getByRole("button", { name: "Compact rows" }));
    expect(fn("setRecentEditsDensity")).toHaveBeenCalledWith("compact");
  });
});

describe("the Edits screen shows only the rows answering its request", () => {
  it("another request's rows (another scope, project or tab) are never shown: it loads", () => {
    state = baseState({
      recentEditsList: listFor(sessionRequest, [edit("/project/other-scope.ts")]),
      isLoadingRecentEdits: true,
    });
    render(<RecentEditsViewer />);
    expect(screen.queryByText("/project/other-scope.ts")).toBeNull();
    expect(screen.getByText("recentEdits.loading")).toBeTruthy();
  });

  it("its own request's failure shows with a retry that reads again", () => {
    state = baseState({
      recentEditsRequestedKey: recentEditsRequestKey(projectRequest),
      recentEditsError: "backend exploded",
    });
    render(<RecentEditsViewer />);
    expect(screen.getByText("backend exploded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(fn("loadRecentEditsList")).toHaveBeenLastCalledWith(projectRequest, { force: true });
  });

  it("an empty answer says there are no edits, and the controls stay to widen the scope", () => {
    state = baseState({ recentEditsList: listFor(projectRequest, []) });
    render(<RecentEditsViewer />);
    expect(screen.getByText("recentEdits.noEdits")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
  });
});

describe("restore, the missing filter and the jump to the message", () => {
  it("authorises restore against the request the rows answer, with its session (#525)", () => {
    state = baseState({
      recentEditsScope: "session",
      recentEditsList: listFor(sessionRequest, [edit("/project/a.ts")]),
    });
    render(<RecentEditsViewer />);
    expect(rows[0]?.props.restoreScope).toEqual({
      projectPath: PROJECT.path,
      sessionFilePath: SESSION.file_path,
    });
    (rows[0]?.props.onRestored as (path: string) => void)("/project/a.ts");
    expect(fn("markRecentEditRestored")).toHaveBeenCalledWith("/project/a.ts");
  });

  it("project-scope rows authorise against the whole project", () => {
    state = baseState({ recentEditsList: listFor(projectRequest, [edit("/project/a.ts")]) });
    render(<RecentEditsViewer />);
    expect(rows[0]?.props.restoreScope).toEqual({ projectPath: PROJECT.path, sessionFilePath: undefined });
  });

  it("missing-only shows the files gone from disk, or says none are", () => {
    const files = [edit("/project/here.ts", { exists_on_disk: true }), edit("/project/gone.ts", { exists_on_disk: false })];
    state = baseState({ recentEditsMissingOnly: true, recentEditsList: listFor(projectRequest, files) });
    const { unmount } = render(<RecentEditsViewer />);
    expect(screen.getByText("/project/gone.ts")).toBeTruthy();
    expect(screen.queryByText("/project/here.ts")).toBeNull();
    unmount();

    state = baseState({ recentEditsMissingOnly: true, recentEditsList: listFor(projectRequest, [files[0]!]) });
    render(<RecentEditsViewer />);
    expect(screen.getByText("recentEdits.noMissingFiles")).toBeTruthy();
  });

  it("compact rows jump to the edit's message in its conversation, when the session is listed", () => {
    const files = [edit("/project/a.ts"), edit("/project/b.ts", { session_id: "unlisted" })];
    state = baseState({
      recentEditsDensity: "compact",
      recentEditsList: listFor(projectRequest, files),
    });
    render(<RecentEditsViewer />);
    expect(rows.map((r) => r.kind)).toEqual(["compact", "compact"]);
    expect(rows[0]?.props.grouping).toBe("file");
    expect(rows[0]?.props.projectCwd).toBe("/project");
    // A session the sidebar does not list offers no jump.
    expect(rows[1]?.props.onJumpToMessage).toBeUndefined();
    (rows[0]?.props.onJumpToMessage as (uuid: string) => void)("m-42");
    expect(fn("navigate")).toHaveBeenCalledWith({ view: "conversation", session: SESSION, messageId: "m-42" });
  });
});

describe("the page's search, counts and show more", () => {
  it("counts the rows held against the total, and shows more of the same request", () => {
    state = baseState({ recentEditsList: listFor(projectRequest, [edit("/project/a.ts")], true) });
    render(<RecentEditsViewer />);
    expect(screen.getByText("1 / 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "recentEdits.showMore" }));
    expect(fn("loadMoreRecentEditsList")).toHaveBeenCalledWith(projectRequest);
  });

  it("searches the loaded rows by path or content and hides show more meanwhile; the Board prefills it", () => {
    const files = [edit("/project/alpha.ts"), edit("/project/beta.ts")];
    state = baseState({ recentEditsList: listFor(projectRequest, files, true) });
    render(<RecentEditsViewer initialSearchQuery="beta" />);
    expect(screen.queryByText("/project/alpha.ts")).toBeNull();
    expect(screen.getByText("/project/beta.ts")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "recentEdits.showMore" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("recentEdits.searchPlaceholder"), { target: { value: "nothing" } });
    expect(screen.getByText("recentEdits.noSearchResults")).toBeTruthy();
  });
});

describe("the Edits screen for a provider without recent edits (#643)", () => {
  it("does not request edits and says they are unavailable instead of showing another project's rows", () => {
    state = baseState({
      selectedProject: {
        path: "/Users/x/.omp/agent/sessions/-Users-x-proj",
        actual_path: "/Users/x/proj",
        provider: "ompi",
      },
      // Rows left over from the previously selected (Claude) project.
      recentEditsList: listFor(projectRequest, [edit("/claude-project/src/stale.ts")]),
    });
    render(<RecentEditsViewer />);
    expect(fn("loadRecentEditsList")).not.toHaveBeenCalled();
    expect(screen.getByText("recentEdits.unavailableForProvider")).toBeTruthy();
    expect(screen.queryByText(/stale\.ts/)).toBeNull();
  });
});
