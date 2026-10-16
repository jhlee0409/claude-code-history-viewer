/**
 * The view registry is complete and is the only place that renders a view
 * (plan T3, D15).
 *
 * - Every `View` of the place model has an entry, and every header-tab view a
 *   tab; each title / label key exists in the English locale.
 * - The analytics hook's flags for each view resolve back to that view, so
 *   the registry renders what the place says.
 * - Statically, in `src/layouts`: no nested ternary (`a ? b : c ? d : e`) and
 *   no ternary choosing markup on a view condition.
 * - Statically, across `src/` (`screenRenderViolations`): the screens and the
 *   view bodies they wrap are referenced only through the registry, nothing
 *   picks a registry entry by a literal view, and no `if` / `switch` / `&&` /
 *   ternary / early return on a view renders one. Self-tested against the
 *   bypasses the T3 review found (scratch/t3-review/review.md, finding 1).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ClaudeProject } from "@/types";
import type { ToolbarView, View } from "@/navigation/place";
import { useAppStore } from "@/store/useAppStore";
import { useAnalyticsComputed } from "@/hooks/analytics/useAnalyticsComputed";
import {
  Archive,
  Bot,
  ChartColumn,
  ChartPie,
  Coins,
  FilePenLine,
  MessageSquareText,
  PanelRight,
  RotateCcwClock,
  Settings,
  SquareKanban,
  SquareTerminal,
  Star,
} from "lucide-react";
import { screenRenderViolations, type SourceText } from "@/test/utils/screenRegistryGuard";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import {
  MOBILE_ANALYTICS_VIEWS,
  TOOLBAR_TAB_ORDER,
  VIEW_REGISTRY,
  screenOf,
} from "@/layouts/shell/viewRegistry";

/** Compile-time exhaustive: adding a `View` without listing it here fails tsc. */
const ALL_VIEWS: Record<View, true> = {
  empty: true,
  conversation: true,
  analytics: true,
  edits: true,
  board: true,
  globalStats: true,
  archive: true,
  settingsManager: true,
  tokenStats: true,
};
const VIEWS = Object.keys(ALL_VIEWS) as View[];

const TOOLBAR: Record<ToolbarView, true> = {
  conversation: true,
  analytics: true,
  tokenStats: true,
  edits: true,
  board: true,
};

const SRC = path.resolve(__dirname, "../..");

/** Production sources under `dir`: no tests, no test utilities, no mocks. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__mocks__" || full === path.join(SRC, "test") ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const relOf = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

const EN_KEYS = new Set(
  readdirSync(path.join(SRC, "i18n/locales/en"))
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) =>
      Object.keys(
        JSON.parse(readFileSync(path.join(SRC, "i18n/locales/en", file), "utf8")) as object
      )
    )
);

const LAYOUT_FILES = sourceFiles(path.join(SRC, "layouts")).map((file) => ({
  rel: relOf(file),
  source: ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  ),
}));

function unparen(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;
}

function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return true;
  }
  return ts.forEachChild(node, containsJsx) ?? false;
}

/** `file:line  text` for every conditional expression `pick` flags. */
function findConditionals(
  pick: (node: ts.ConditionalExpression, source: ts.SourceFile) => boolean
): string[] {
  const hits: string[] = [];
  for (const { rel, source } of LAYOUT_FILES) {
    const visit = (node: ts.Node) => {
      if (ts.isConditionalExpression(node) && pick(node, source)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        hits.push(`${rel}:${line}  ${node.getText(source).split("\n")[0]}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}

describe("VIEW_REGISTRY completeness", () => {
  it("has exactly one entry per view of the place model", () => {
    expect(Object.keys(VIEW_REGISTRY).sort()).toEqual([...VIEWS].sort());
  });

  it("gives every header-tab view a tab, in the toolbar's order, and no other view one", () => {
    expect([...TOOLBAR_TAB_ORDER].sort()).toEqual(Object.keys(TOOLBAR).sort());
    for (const view of VIEWS) {
      expect(VIEW_REGISTRY[view].tab !== undefined, view).toBe(view in TOOLBAR);
    }
  });

  it("names every view and tab with a key that exists in the English locale", () => {
    const keys = VIEWS.flatMap((view) => {
      const { titleKey, tab } = VIEW_REGISTRY[view];
      return tab ? [titleKey, tab.labelKey] : [titleKey];
    });
    expect(keys.filter((key) => !EN_KEYS.has(key))).toEqual([]);
  });

  it("gives the mobile analytics chips registry entries with a content header", () => {
    for (const view of MOBILE_ANALYTICS_VIEWS) {
      expect(VIEW_REGISTRY[view].header, view).not.toBeNull();
    }
  });

  it("shows the inspector on the conversation screen only", () => {
    expect(VIEWS.filter((view) => VIEW_REGISTRY[view].inspector)).toEqual(["conversation"]);
  });
});

describe("screen icons (decision page section 7, plan T5)", () => {
  it("fixes one glyph per meaning, as the decision table lists them", () => {
    expect(SCREEN_ICONS).toEqual({
      conversation: MessageSquareText,
      analytics: ChartColumn,
      edits: FilePenLine,
      board: SquareKanban,
      // The table says `history`; lucide 1.57 names that glyph rotate-ccw-clock.
      recent: RotateCcwClock,
      favorites: Star,
      globalStats: ChartPie,
      archive: Archive,
      inspector: PanelRight,
      agent: Bot,
      terminal: SquareTerminal,
      settings: Settings,
      // Not in the table: token stats keeps the coins it already shows.
      tokenStats: Coins,
    });
  });

  it("draws each screen with its meaning's icon", () => {
    const expected: Record<View, unknown> = {
      empty: SCREEN_ICONS.conversation,
      conversation: SCREEN_ICONS.conversation,
      analytics: SCREEN_ICONS.analytics,
      tokenStats: SCREEN_ICONS.tokenStats,
      edits: SCREEN_ICONS.edits,
      board: SCREEN_ICONS.board,
      globalStats: SCREEN_ICONS.globalStats,
      archive: SCREEN_ICONS.archive,
      settingsManager: SCREEN_ICONS.settings,
    };
    for (const view of VIEWS) {
      expect(VIEW_REGISTRY[view].icon, view).toBe(expected[view]);
    }
  });

  it("gives a header tab no icon of its own, so tab and content header always match", () => {
    for (const view of TOOLBAR_TAB_ORDER) {
      expect(Object.keys(VIEW_REGISTRY[view].tab), view).toEqual(["labelKey"]);
    }
  });
});

describe("screenOf: the analytics flags resolve back to the place's view", () => {
  const PROJECT: ClaudeProject = {
    name: "alpha",
    path: "/p/alpha",
    actual_path: "/home/alpha",
    session_count: 1,
    message_count: 1,
    last_modified: "",
    provider: "claude",
  };
  const pristine = useAppStore.getState();

  beforeEach(() => {
    useAppStore.setState(pristine, true);
  });

  it.each(VIEWS)("%s", (view) => {
    useAppStore.setState({ view, selectedProject: PROJECT });
    const { result } = renderHook(() => useAnalyticsComputed());
    expect(screenOf(result.current)).toBe(view);
  });

  it("a project screen without a project resolves to the empty screen", () => {
    useAppStore.setState({ view: "analytics", selectedProject: null });
    const { result } = renderHook(() => useAnalyticsComputed());
    expect(screenOf(result.current)).toBe("empty");
  });

  it("no flag falls through to the conversation screen", () => {
    expect(screenOf({})).toBe("conversation");
  });
});

describe("no view is rendered outside the registry (static scan of src/layouts)", () => {
  it("has no nested ternary chains", () => {
    const chains = findConditionals((node) => {
      const branches = [unparen(node.whenTrue), unparen(node.whenFalse)];
      return branches.some(ts.isConditionalExpression);
    });
    expect(chains).toEqual([]);
  });

  it("has no ternary choosing markup on a view condition", () => {
    const VIEW_CONDITION = /\bis[A-Z]\w*View\b|\bview\s*[!=]==|[!=]==\s*view\b|\bscreen\s*[!=]==/;
    const picks = findConditionals(
      (node, source) =>
        VIEW_CONDITION.test(node.condition.getText(source)) &&
        (containsJsx(node.whenTrue) || containsJsx(node.whenFalse))
    );
    expect(picks).toEqual([]);
  });

  it("has the registry's screens import every view body", () => {
    const BODIES = [
      "@/components/MessageViewer",
      "@/components/TokenStatsViewer",
      "@/components/AnalyticsDashboard",
      "@/components/RecentEditsViewer",
      "@/components/SettingsManager",
      "@/components/SessionBoard/SessionBoard",
      "@/components/ArchiveManager",
    ];
    const screens = LAYOUT_FILES.find(({ rel }) => rel === "layouts/shell/screens.tsx");
    const imported = screens?.source.statements
      .filter(ts.isImportDeclaration)
      .map((decl) => (decl.moduleSpecifier as ts.StringLiteral).text);
    expect(imported).toEqual(expect.arrayContaining(BODIES));
  });
});

/** Every production source in `src/`, as the guard reads it. */
const SRC_FILES: SourceText[] = sourceFiles(SRC).map((file) => ({
  rel: relOf(file),
  text: readFileSync(file, "utf8"),
}));

const textOf = (rel: string) => {
  const file = SRC_FILES.find((candidate) => candidate.rel === rel);
  if (!file) throw new Error(`no source ${rel}`);
  return file.text;
};

/** The real sources with `rel` replaced (or added) by `text`. */
const withFile = (rel: string, text: string): SourceText[] => [
  ...SRC_FILES.filter((file) => file.rel !== rel),
  { rel, text },
];
/** The real sources with `code` appended to `rel`. */
const withAppended = (rel: string, code: string) => withFile(rel, `${textOf(rel)}\n${code}\n`);

const guard = (files: SourceText[]) => screenRenderViolations(files, VIEWS);

describe("screens render through the registry only (static scan of src/)", () => {
  it("scans the whole production source tree", () => {
    expect(SRC_FILES.length).toBeGreaterThan(300);
    expect(SRC_FILES.map((file) => file.rel)).toEqual(
      expect.arrayContaining([
        "App.tsx",
        "layouts/AppLayout.tsx",
        "layouts/shell/screens.tsx",
        "layouts/shell/viewRegistry.ts",
        "components/SessionBoard/SessionBoard.tsx",
      ])
    );
  });

  it("finds no violation in the current sources", () => {
    expect(guard(SRC_FILES)).toEqual([]);
  });

  /*
    Each case adds one way of rendering a screen without the registry, to
    the real sources, and names a violation the guard must report. The first
    is the reviewer's probe verbatim; it passed the previous guard.
  */
  it.each<[name: string, files: () => SourceText[], expected: RegExp[]]>([
    [
      "the review's probe: an aliased screen import rendered in an if-branch",
      () =>
        withAppended(
          "layouts/AppLayout.tsx",
          `import { BoardScreen as BypassScreen } from "@/layouts/shell/screens";
export const UnregisteredShellView = ({ view }) => {
  if (view === "board") return <BypassScreen />;
  return null;
};`
        ),
      [
        /^layouts\/AppLayout\.tsx:\d+ imports BoardScreen from the screens module/,
        /^layouts\/AppLayout\.tsx:\d+ renders <BypassScreen> \(BoardScreen\) outside the registry/,
        /^layouts\/AppLayout\.tsx:\d+ renders <BypassScreen> \(BoardScreen\) under a view condition/,
      ],
    ],
    [
      "a view body rendered in an if-branch on a view flag",
      () =>
        withFile(
          "layouts/shell/BoardBypass.tsx",
          `import { SessionBoard } from "@/components/SessionBoard/SessionBoard";
export const BoardBypass = ({ computed }) => {
  if (computed.isBoardView) {
    return <SessionBoard />;
  }
  return null;
};`
        ),
      [
        /^layouts\/shell\/BoardBypass\.tsx:1 imports SessionBoard outside the registry's screens/,
        /^layouts\/shell\/BoardBypass\.tsx:4 renders <SessionBoard> \(SessionBoard\) outside the registry/,
        /^layouts\/shell\/BoardBypass\.tsx:4 renders <SessionBoard> \(SessionBoard\) under a view condition/,
      ],
    ],
    [
      "a screen short-circuited in the shell's markup (namespace import)",
      () =>
        withAppended(
          "layouts/AppLayout.tsx",
          `import * as Screens from "./shell/screens";
export const ShortCircuit = ({ screen }) => <div>{screen === "archive" && <Screens.ArchiveScreen />}</div>;`
        ),
      [
        /^layouts\/AppLayout\.tsx:\d+ imports \* from the screens module/,
        /^layouts\/AppLayout\.tsx:\d+ renders <Screens\.ArchiveScreen> \(ArchiveScreen\) under a view condition/,
      ],
    ],
    [
      "a switch on the view, through a barrel import",
      () =>
        withFile(
          "components/ViewSwitch.tsx",
          `import { ArchiveManager as Archive } from "@/components/ArchiveManager";
export function ViewSwitch({ view }) {
  switch (view) {
    case "archive":
      return <Archive />;
    default:
      return null;
  }
}`
        ),
      [
        /^components\/ViewSwitch\.tsx:1 imports ArchiveManager outside the registry's screens/,
        /^components\/ViewSwitch\.tsx:5 renders <Archive> \(ArchiveManager\) under a view condition/,
      ],
    ],
    [
      "an early return on the view inside the screens module itself",
      () =>
        withAppended(
          "layouts/shell/screens.tsx",
          `export const ArchiveOnly = ({ view }: ViewScreenProps) => {
  if (view !== "archive") return null;
  return <ArchiveManager />;
};`
        ),
      [/^layouts\/shell\/screens\.tsx:\d+ renders <ArchiveManager> \(ArchiveManager\) under a view condition/],
    ],
    [
      "a switch picking screens inside the screens module itself",
      () =>
        withAppended(
          "layouts/shell/screens.tsx",
          `export const Picker = ({ view }: ViewScreenProps) => {
  switch (view) {
    case "board":
      return <BoardScreen />;
  }
  return <EmptyScreen />;
};`
        ),
      [/^layouts\/shell\/screens\.tsx:\d+ renders <BoardScreen> \(BoardScreen\) under a view condition/],
    ],
    [
      "the shell's registry component rendered under a view flag",
      () => {
        const shell = textOf("layouts/AppLayout.tsx");
        const main = /<Frame>\s*<Screen/;
        expect(shell).toMatch(main);
        return withFile(
          "layouts/AppLayout.tsx",
          shell.replace(main, "<Frame>{computed.isBoardView && <Screen />}<Screen")
        );
      },
      [/^layouts\/AppLayout\.tsx:\d+ renders <Screen> \(entry\.component\) under a view condition/],
    ],
    [
      "a screen laundered through a re-export",
      () => withFile("layouts/shell/more.ts", `export { BoardScreen as Board } from "./screens";`),
      [/^layouts\/shell\/more\.ts:1 imports BoardScreen from the screens module/],
    ],
    [
      "a lazily imported view body",
      () =>
        withFile(
          "layouts/LazyBoard.tsx",
          `import { lazy } from "react";
export const LazyBoard = lazy(() => import("@/components/SessionBoard/SessionBoard"));`
        ),
      [/^layouts\/LazyBoard\.tsx:2 imports \* from components\/SessionBoard\/SessionBoard outside the registry's screens/],
    ],
    [
      "a registry entry picked by a literal view",
      () =>
        withAppended(
          "layouts/shell/ContentHeader.tsx",
          `export const Pinned = () => {
  const Board = VIEW_REGISTRY.board.component;
  return <Board />;
};`
        ),
      [
        /^layouts\/shell\/ContentHeader\.tsx:\d+ picks VIEW_REGISTRY\.board by a literal view/,
        /^layouts\/shell\/ContentHeader\.tsx:\d+ reads a registry entry's component outside the shell/,
      ],
    ],
  ])("catches %s", (_name, files, expected) => {
    const violations = guard(files());
    expect(violations).toEqual(
      expect.arrayContaining(expected.map((pattern) => expect.stringMatching(pattern)))
    );
  });

  it.each<[name: string, files: () => SourceText[]]>([
    [
      "a type-only import from the screens module",
      () =>
        withFile(
          "layouts/shell/ScreenTypes.ts",
          `import type { ViewScreenProps } from "./screens";
import { type ViewScreenProps as Props } from "@/layouts/shell/screens";
export type Both = ViewScreenProps | Props;`
        ),
    ],
    [
      "a helper imported from inside a view body's folder",
      () =>
        withFile(
          "components/Lifecycle.tsx",
          `import { getModelLifecycle } from "@/components/AnalyticsDashboard/utils/calculations";
export const Lifecycle = ({ model }) => <span>{String(getModelLifecycle(model))}</span>;`
        ),
    ],
    [
      "a view condition choosing a prop, not a screen",
      () =>
        withAppended(
          "layouts/shell/screens.tsx",
          `export const GlobalOrProject = ({ view }: ViewScreenProps) => (
  <AnalyticsDashboard isGlobalScope={view === "globalStats"} onRetry={() => undefined} />
);`
        ),
    ],
    [
      "a screen chosen on a non-view condition inside the screens module",
      () =>
        withAppended(
          "layouts/shell/screens.tsx",
          `export const Guarded = ({ ready }: { ready: boolean }) => {
  if (!ready) return <EmptyScreen />;
  return <BoardScreen />;
};`
        ),
    ],
    [
      "non-screen markup under a view condition",
      () =>
        withFile(
          "layouts/shell/Badge.tsx",
          `export const Badge = ({ view }) => (view === "board" ? <span>board</span> : null);`
        ),
    ],
    [
      "the registry read by the resolved view",
      () =>
        withFile(
          "layouts/shell/TitleOf.ts",
          `import { VIEW_REGISTRY } from "./viewRegistry";
export const titleOf = (view) => VIEW_REGISTRY[view].titleKey;`
        ),
    ],
  ])("accepts %s", (_name, files) => {
    expect(guard(files())).toEqual([]);
  });
});
