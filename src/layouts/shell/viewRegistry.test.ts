/**
 * The view registry is complete and is the only place that renders a view
 * (plan T3, D15).
 *
 * - Every `View` of the place model has an entry, and every header-tab view a
 *   tab; each title / label key exists in the English locale.
 * - The analytics hook's flags for each view resolve back to that view, so
 *   the registry renders what the place says.
 * - Statically, in `src/layouts`: no nested ternary (`a ? b : c ? d : e`), no
 *   ternary choosing markup on a view condition, and the view bodies are
 *   imported by the registry's screens only.
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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

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
  rel: path.relative(SRC, file).split(path.sep).join("/"),
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

  it("imports the view bodies from the registry's screens only", () => {
    const BODIES = [
      "@/components/MessageViewer",
      "@/components/TokenStatsViewer",
      "@/components/AnalyticsDashboard",
      "@/components/RecentEditsViewer",
      "@/components/SettingsManager",
      "@/components/SessionBoard/SessionBoard",
      "@/components/ArchiveManager",
    ];
    const importers = LAYOUT_FILES.flatMap(({ rel, source }) =>
      source.statements
        .filter(ts.isImportDeclaration)
        .map((decl) => (decl.moduleSpecifier as ts.StringLiteral).text)
        .filter((specifier) => BODIES.includes(specifier))
        .map((specifier) => `${rel} → ${specifier}`)
    );
    expect(importers.length).toBe(BODIES.length);
    expect(importers.filter((line) => !line.startsWith("layouts/shell/screens.tsx"))).toEqual([]);
  });
});
