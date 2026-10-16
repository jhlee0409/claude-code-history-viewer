import { describe, expect, it } from "vitest";
import {
  activeLibraryItem,
  activeMobileTab,
  activeToolbarView,
  placeOf,
  resolvePlace,
  samePlace,
  treeSelection,
  viewAfterLeavingProject,
  viewForProjectSwitch,
  type Place,
  type View,
} from "./place";
import type { ClaudeProject, ClaudeSession } from "@/types";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "codex",
};
const SESSION: ClaudeSession = {
  session_id: "s",
  actual_session_id: "s-actual",
  file_path: "/p/alpha/s.jsonl",
  project_name: "alpha",
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "codex",
};

const ALL_VIEWS: View[] = [
  "empty",
  "conversation",
  "analytics",
  "edits",
  "board",
  "globalStats",
  "archive",
  "settingsManager",
  "tokenStats",
];

const at = (view: View, context: "none" | "project" | "session"): Place =>
  placeOf(
    view,
    context === "none" ? null : PROJECT,
    context === "session" ? SESSION : null
  );

describe("placeOf", () => {
  it("keeps provider and identifiers, and omits missing context", () => {
    expect(at("conversation", "session")).toEqual({
      view: "conversation",
      project: { provider: "codex", path: "/p/alpha" },
      session: {
        provider: "codex",
        filePath: "/p/alpha/s.jsonl",
        sessionId: "s",
        actualSessionId: "s-actual",
      },
    });
    expect(at("globalStats", "none")).toEqual({ view: "globalStats" });
  });

  it("defaults a missing provider to claude", () => {
    const legacy: ClaudeProject = { ...PROJECT, provider: undefined };
    expect(placeOf("analytics", legacy, null).project?.provider).toBe("claude");
  });
});

describe("resolvePlace — valid and invalid places", () => {
  const cases: Array<[View, "none" | "project" | "session", View, string | null]> = [
    ["conversation", "session", "conversation", null],
    ["conversation", "project", "empty", "noSession"],
    ["conversation", "none", "empty", "noProject"],
    ["analytics", "project", "analytics", null],
    ["analytics", "none", "empty", "noProject"],
    ["edits", "project", "edits", null],
    ["edits", "none", "empty", "noProject"],
    ["board", "project", "board", null],
    ["board", "none", "empty", "noProject"],
    ["tokenStats", "project", "tokenStats", null],
    ["tokenStats", "none", "empty", "noProject"],
    ["globalStats", "none", "globalStats", null],
    ["globalStats", "session", "globalStats", null],
    ["archive", "none", "archive", null],
    ["archive", "session", "archive", null],
    ["settingsManager", "none", "settingsManager", null],
    ["settingsManager", "project", "settingsManager", null],
    ["empty", "none", "empty", null],
  ];

  it.each(cases)("%s with %s context renders %s (%s)", (view, context, expected, fallback) => {
    expect(resolvePlace(at(view, context))).toEqual({ view: expected, fallback });
  });
});

describe("context rules", () => {
  it("leaving the project keeps global stats and otherwise opens the conversation screen", () => {
    expect(viewAfterLeavingProject("globalStats")).toBe("globalStats");
    for (const view of ALL_VIEWS.filter((v) => v !== "globalStats")) {
      expect(viewAfterLeavingProject(view)).toBe("conversation");
    }
  });

  it("a project click keeps project screens and the Settings Manager", () => {
    expect(
      Object.fromEntries(ALL_VIEWS.map((view) => [view, viewForProjectSwitch(view)]))
    ).toEqual({
      empty: "conversation",
      conversation: "conversation",
      analytics: "analytics",
      edits: "edits",
      board: "board",
      globalStats: "analytics",
      archive: "conversation",
      settingsManager: "settingsManager",
      tokenStats: "tokenStats",
    });
  });

  it("samePlace compares view, project and session identity", () => {
    expect(samePlace(at("analytics", "session"), at("analytics", "session"))).toBe(true);
    expect(samePlace(at("analytics", "session"), at("analytics", "project"))).toBe(false);
    expect(samePlace(at("analytics", "project"), at("board", "project"))).toBe(false);
  });
});

/**
 * Plan §9b C3: every highlight is a projection of the current place.
 *
 * | situation                | toolbar | library      | tree                 |
 * |--------------------------|---------|--------------|----------------------|
 * | empty start              | none    | none         | none                 |
 * | global stats (kept ctx)  | none    | global stats | kept context, dimmed |
 * | archive / settings       | none    | that row     | kept context, dimmed |
 */
describe("highlight projections", () => {
  it("empty start highlights nothing", () => {
    const place = at("conversation", "none");
    expect(activeToolbarView(place)).toBeNull();
    expect(activeLibraryItem(place)).toBeNull();
    expect(treeSelection(place)).toEqual({
      projectPath: null,
      sessionFilePath: null,
      retained: false,
    });
  });

  it.each(["globalStats", "archive", "settingsManager"] as const)(
    "%s highlights its library row and keeps the context in the tree, dimmed",
    (view) => {
      const place = at(view, "session");
      expect(activeToolbarView(place)).toBeNull();
      expect(activeLibraryItem(place)).toBe(view);
      expect(treeSelection(place)).toEqual({
        projectPath: PROJECT.path,
        sessionFilePath: SESSION.file_path,
        retained: true,
      });
    }
  );

  it.each([
    ["conversation", "conversation"],
    ["analytics", "analytics"],
    // No tab of its own until T9b (plan C1): it opens from analytics.
    ["tokenStats", "analytics"],
    ["edits", "edits"],
    ["board", "board"],
  ] as const)(
    "%s selects the %s toolbar tab and no library row",
    (view, tab) => {
      const place = at(view, "session");
      expect(activeToolbarView(place)).toBe(tab);
      expect(activeLibraryItem(place)).toBeNull();
      expect(treeSelection(place).retained).toBe(false);
    }
  );

  it("a project-less place selects no header tab", () => {
    for (const view of ALL_VIEWS) {
      expect(activeToolbarView(at(view, "none"))).toBeNull();
    }
  });

  it("the conversation screen with a project but no session keeps its tab", () => {
    expect(activeToolbarView(at("conversation", "project"))).toBe("conversation");
  });

  it("exactly one of toolbar and library is highlighted with a project in context", () => {
    for (const view of ALL_VIEWS.filter((v) => v !== "empty")) {
      const place = at(view, "session");
      const count =
        Number(activeToolbarView(place) !== null) + Number(activeLibraryItem(place) !== null);
      expect(count, view).toBe(1);
    }
  });

  it("the mobile tab bar mirrors the place", () => {
    expect(
      Object.fromEntries(ALL_VIEWS.map((view) => [view, activeMobileTab(at(view, "session"))]))
    ).toEqual({
      empty: "messages",
      conversation: "messages",
      analytics: "analytics",
      edits: null,
      board: "board",
      globalStats: null,
      archive: null,
      settingsManager: "settings",
      tokenStats: null,
    });
  });
});
