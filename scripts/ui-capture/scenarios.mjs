// Declarative scenario matrix for the UI capture harness.
//
// A scenario = one screen × one viewport × one theme. Screens describe *what*
// to show as data (steps + optional request injection); run.mjs knows *how* to
// perform each step. The scenario id is `<screen>--<viewport>--<theme>` and is
// the key every gate compares on, so renaming a screen or viewport is a
// deliberate baseline change.
//
// Step vocabulary (implemented in lib/actions.mjs):
//   { do: "openProject", project: "featured" | "<name>" }
//   { do: "openSession", session: "large" | "subagent" }   (opens its project first)
//   { do: "view", view: "messages" | "analytics" | "tokenStats" | "recentEdits" | "board" }
//   { do: "appMenu", item: "settingsManager" | "archive" }
//   { do: "globalStats" }
//   { do: "openSidebar" }                                   (mobile drawer)
//   { do: "collapseProjects" }      every project row collapsed, none selected
//   { do: "fontScale", percent: 90 | 100 | 110 | 120 | 130 }   (gear menu → font size)
//   { do: "expandProject", project: "featured" | "<name>" }
//                                   exactly one project open: its sessions
//                                   inline (aria-expanded) or in the sessions
//                                   pane, whichever the layout uses
//   { do: "libraryList", list: "recent" | "favorites" }  (T7 sidebar library)
//   { do: "favorite", session: "large" | "subagent", off? }  star (or unstar) via the row menu (T7)
//
// `cleanup` steps run after the capture and the probes: they undo what the
// steps wrote to the shared fixture.
//   { do: "selectSessions", project: "featured", count }  "Select" + check rows
//
// Injection (lib/browser.mjs), keyed by backend command (POST /api/<command>):
//   { command, respond: <json> }             fulfil with 200 + JSON
//   { command, fail: { status, error } }     fulfil with an error JSON body
//   { command, hold: true }                  never answer (loading state)
//
// `settle: "loading"` photographs once every held request is pending and the
// DOM is quiet, instead of waiting for `data-ready="true"`.

export const DEFAULT_LOCALE = "ko";

/**
 * Measurement state (plan §9b C4) every scenario starts from: sidebar 260px,
 * scale 100%, inspector closed, one tab. Seeded into localStorage before the
 * app's first script; the app defaults are not changed. The right-hand
 * message navigator is today's inspector (the future inspector absorbs its
 * outline); scale 100% is the app default (no stored settings in a fresh
 * context); the app has no tab UI yet, so "one tab" holds by construction.
 * probes.mjs records the measured state and run.mjs fails a scenario whose
 * measured state differs.
 */
export const MEASUREMENT_STATE = {
  sidebarWidthPx: 260,
  fontScalePercent: 100,
  inspectorOpen: false,
  tabs: 1,
};

/** localStorage seed that establishes MEASUREMENT_STATE (app storage keys). */
export const STORAGE_SEED = {
  "sidebar-width": String(MEASUREMENT_STATE.sidebarWidthPx),
  "navigator-open": String(MEASUREMENT_STATE.inspectorOpen),
};

export const DESKTOP_VIEWPORTS = [
  { id: "1180x760", width: 1180, height: 760 },
  { id: "1440x900", width: 1440, height: 900 },
  { id: "1920x1080", width: 1920, height: 1080 },
];

export const MOBILE_VIEWPORTS = [{ id: "390x844", width: 390, height: 844 }];

export const THEMES = ["dark", "light"];

const PROJECT_SCAN_COMMANDS = ["scan_projects", "scan_all_projects"];

/** Screens shared by desktop and mobile. Order is capture order. */
const COMMON_SCREENS = [
  { id: "home", title: "Startup, nothing selected", steps: [] },
  {
    id: "transcript",
    title: "Messages view of the 1,369-message session",
    steps: [{ do: "openSession", session: "large" }],
  },
  {
    id: "analytics",
    title: "Project analytics dashboard",
    steps: [{ do: "openSession", session: "large" }, { do: "view", view: "analytics" }],
  },
  {
    id: "token-stats",
    title: "Token stats (legacy view)",
    steps: [{ do: "openSession", session: "large" }, { do: "view", view: "tokenStats" }],
  },
  {
    id: "recent-edits",
    title: "Recent edits page",
    steps: [{ do: "openSession", session: "large" }, { do: "view", view: "recentEdits" }],
  },
  {
    id: "board",
    title: "Session board",
    steps: [{ do: "openProject", project: "featured" }, { do: "view", view: "board" }],
  },
  {
    id: "global-stats",
    title: "Global stats overview",
    steps: [{ do: "globalStats" }],
  },
  {
    id: "archive",
    title: "Archive manager",
    steps: [{ do: "openProject", project: "featured" }, { do: "appMenu", item: "archive" }],
  },
  {
    id: "settings",
    title: "Settings manager",
    steps: [{ do: "openProject", project: "featured" }, { do: "appMenu", item: "settingsManager" }],
  },
  // Highlight regressions from the 2026-10-14 UX audit (captures 10 and 12):
  // the header/tree highlight must follow the screen actually shown.
  {
    id: "global-stats-after-analytics",
    title: "Global stats opened from a project's analytics",
    steps: [{ do: "openSession", session: "large" }, { do: "view", view: "analytics" }, { do: "globalStats" }],
  },
  {
    id: "archive-after-global-stats",
    title: "Archive opened from global stats",
    steps: [{ do: "globalStats" }, { do: "appMenu", item: "archive" }],
  },
  {
    id: "empty",
    title: "Empty state: no projects found",
    inject: PROJECT_SCAN_COMMANDS.map((command) => ({ command, respond: [] })),
    steps: [],
  },
  {
    // First launch: no provider discovery saved yet, so startup scans Claude
    // Code only and the screen must not claim other assistants are empty.
    id: "empty-first-launch",
    title: "Empty state before any provider discovery (Claude Code only)",
    inject: [
      ...PROJECT_SCAN_COMMANDS.map((command) => ({ command, respond: [] })),
      { command: "load_user_metadata", respond: { version: 1, sessions: {}, projects: {}, settings: {} } },
    ],
    steps: [],
  },
  {
    id: "loading",
    title: "Loading state: project scan pending",
    inject: PROJECT_SCAN_COMMANDS.map((command) => ({ command, hold: true })),
    settle: "loading",
    steps: [],
  },
  {
    id: "error",
    title: "Error state: Claude folder unreadable",
    inject: [
      {
        command: "get_claude_folder_path",
        fail: { status: 500, error: "PERMISSION_DENIED:Cannot access Claude folder. Please check permissions." },
      },
    ],
    steps: [],
  },
  {
    id: "analytics-error",
    title: "Project analytics with a failing summary: the dashboard's own error state",
    inject: [{ command: "get_project_stats_summary", fail: { status: 500, error: "boom" } }],
    steps: [{ do: "openSession", session: "large" }, { do: "view", view: "analytics" }],
  },
];

/** Mobile-only screens. */
const MOBILE_SCREENS = [
  { id: "sidebar", title: "Project drawer open", steps: [{ do: "openSidebar" }] },
];

/**
 * Project-row measurement pair (C4 D3: collapsed / one project expanded) on
 * the desktop sizes. Theme does not change geometry, so dark only.
 */
const MEASUREMENT_SCREENS = [
  { id: "projects-collapsed", title: "Project tree, every project collapsed", steps: [{ do: "collapseProjects" }] },
  {
    id: "projects-expanded",
    title: "Project tree, one project expanded",
    steps: [{ do: "collapseProjects" }, { do: "expandProject", project: "featured" }],
  },
];

/**
 * Font-scale pair (T4 / D9): every type step must render at base × scale
 * (±0.5px) at 90% and 110%. The scale is set through the app's own menu as
 * the first step (the WebUI does not restore a stored scale at startup);
 * `fontScalePercent` overrides the measurement state's 100% for these
 * scenarios only.
 */
const SCALE_SCREENS = [90, 110].flatMap((fontScalePercent) =>
  ["transcript", "analytics"].map((base) => {
    const screen = COMMON_SCREENS.find((s) => s.id === base);
    return {
      ...screen,
      id: `${base}-scale${fontScalePercent}`,
      title: `${screen.title} at font scale ${fontScalePercent}%`,
      fontScalePercent,
      steps: [{ do: "fontScale", percent: fontScalePercent }, ...screen.steps],
    };
  }),
);

/**
 * The T7 sidebar (plan T7 VERIFY): sessions inside the sidebar, the library's
 * recent and favourite lists, and multi-select mode. Builds before T7 have no
 * library lists or favourites, so those two fail on such a base (new
 * screens); `sidebar-sessions` and `select-mode` run on both.
 */
const LIBRARY_SCREENS = [
  {
    id: "sidebar-sessions",
    title: "The open project's sessions, listed in the sidebar",
    steps: [{ do: "openSession", session: "large" }],
  },
  {
    id: "select-mode",
    title: "Multi-select mode with two sessions checked",
    steps: [{ do: "openProject", project: "featured" }, { do: "selectSessions", project: "featured", count: 2 }],
  },
  {
    id: "recent",
    title: "Library: recently opened sessions",
    steps: [
      { do: "openSession", session: "subagent" },
      { do: "openSession", session: "large" },
      { do: "libraryList", list: "recent" },
    ],
  },
  {
    id: "favorites",
    title: "Library: a starred session",
    steps: [
      { do: "openSession", session: "large" },
      { do: "favorite", session: "subagent" },
      { do: "libraryList", list: "favorites" },
    ],
    // Runs after the capture: the star lives in the shared fixture.
    cleanup: [{ do: "favorite", session: "subagent", off: true }],
  },
];

/** The matrix: every group expands to screens × viewports × themes. */
export const MATRIX = [
  { viewports: DESKTOP_VIEWPORTS, themes: THEMES, screens: COMMON_SCREENS },
  { viewports: MOBILE_VIEWPORTS, themes: THEMES, screens: [...COMMON_SCREENS, ...MOBILE_SCREENS] },
  { viewports: DESKTOP_VIEWPORTS, themes: ["dark"], screens: MEASUREMENT_SCREENS },
  { viewports: DESKTOP_VIEWPORTS.filter((v) => v.id === "1440x900"), themes: ["light"], screens: SCALE_SCREENS },
  {
    viewports: [...DESKTOP_VIEWPORTS.filter((v) => v.id === "1440x900"), ...MOBILE_VIEWPORTS],
    themes: THEMES,
    screens: LIBRARY_SCREENS,
  },
];

/** Expanded, ordered scenario list. Ids are unique; run.mjs asserts it. */
export function expandScenarios(matrix = MATRIX) {
  const scenarios = [];
  for (const group of matrix) {
    for (const viewport of group.viewports) {
      for (const theme of group.themes) {
        for (const screen of group.screens) {
          scenarios.push({
            id: `${screen.id}--${viewport.id}--${theme}`,
            screen,
            viewport,
            theme,
            mobile: viewport.width < 768,
          });
        }
      }
    }
  }
  return scenarios;
}
