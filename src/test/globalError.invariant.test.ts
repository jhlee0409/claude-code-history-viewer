/**
 * The app's error screen (`error` in the store) replaces the whole window -
 * the tab strip, the sidebar, every other tab - with "An error occurred"
 * and a reload button. Only a failure that leaves the app with nothing to
 * show may raise it (T8 re-review #1):
 *
 * | Source                         | Why it is app-wide                              |
 * |--------------------------------|-------------------------------------------------|
 * | `projectSlice.initializeApp`   | startup: no history folder, no permission, no   |
 * |                                | backend - nothing can be listed at all          |
 * | `projectSlice.scanProjects`    | the project list itself failed (every provider) |
 *
 * Everything else belongs to one document - a tab's place - and reports
 * there: a session list or a session that cannot be read is the tab's
 * in-tab notice (`markProjectUnavailable` / `markSessionUnavailable`), a
 * screen's data its screen error or a toast. `navigation.tabs.test.ts`
 * ("a per-document load failing never raises the app error") plays every
 * such loader against a failing backend; this test holds the rule
 * statically, so a new `setError({...})` anywhere else fails here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globalErrorWrites } from "./utils/asyncWrites";

const SRC = path.resolve(__dirname, "..");

/** `file → functions` allowed to raise the app's error screen. */
const APP_WIDE: Readonly<Record<string, readonly string[]>> = {
  // `setError` is the store's setter itself: every call of it is checked.
  "store/slices/projectSlice.ts": ["initializeApp", "scanProjects", "setError"],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "test" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

/** Writes of the app's error screen outside the allow-list, as `file:line fn: callee`. */
function violations(files: Array<{ rel: string; text: string }>): string[] {
  return files.flatMap(({ rel, text }) =>
    globalErrorWrites(rel, text)
      .filter((write) => !(APP_WIDE[rel] ?? []).includes(write.fn))
      .map((write) => `${rel}:${write.line} ${write.fn}: ${write.callee}`),
  );
}

describe("the app's error screen is raised only by app-wide failures", () => {
  it("no per-document loader sets the global error", () => {
    expect(violations(FILES)).toEqual([]);
  });

  it("every allow-listed source still raises it (the list is not stale)", () => {
    for (const [rel, fns] of Object.entries(APP_WIDE)) {
      const file = FILES.find((f) => f.rel === rel);
      expect(file, rel).toBeDefined();
      const raising = new Set(globalErrorWrites(rel, file!.text).map((w) => w.fn));
      expect(fns.filter((fn) => !raising.has(fn)), rel).toEqual([]);
    }
  });

  describe("self-check", () => {
    const slice = (body: string) => `
      export const createSlice = (set, get) => ({
        loadThing: async () => {
          try {
            await api();
          } catch (error) {
            ${body}
          }
        },
      });`;
    const component = (body: string) => `
      export function Thing() {
        const load = async () => {
          ${body}
        };
        return null;
      }`;

    it.each([
      ["get().setError", slice(`get().setError({ type: "UNKNOWN", message: String(error) });`)],
      ["set({ error })", slice(`set({ error: { type: "UNKNOWN", message: String(error) } });`)],
      ["an updater", slice(`set((s) => ({ ...s, error: { type: "UNKNOWN", message: "x" } }));`)],
      ["a local patch", slice(`const patch = { error: { type: "UNKNOWN", message: "x" } }; set(patch);`)],
      ["a shorthand", slice(`const error2 = error; set({ error: error2 });`)],
      ["setState on the store", component(`useAppStore.setState({ error: { type: "UNKNOWN", message: "x" } });`)],
      ["getState().setError", component(`useAppStore.getState().setError({ type: "UNKNOWN", message: "x" });`)],
      ["a destructured setError", component(`const { setError } = useAppStore.getState(); setError({ message: "x" });`)],
      ["a renamed setError", component(`const { setError: fail } = useAppStore(); fail({ message: "x" });`)],
      ["a selected setError", component(`const fail = useAppStore((s) => s.setError); fail({ message: "x" });`)],
      ["an assigned setError", slice(`const fail = get().setError; fail({ message: "x" });`)],
    ])("catches %s", (_name, text) => {
      expect(violations([{ rel: "store/slices/thingSlice.ts", text }])).toHaveLength(1);
    });

    it.each([
      ["clearing it", slice(`get().setError(null); set({ error: null });`)],
      ["a screen's own nested error", slice(`set((s) => ({ archive: { ...s.archive, error: String(error) } }));`)],
      ["a screen error action", slice(`get().setAnalyticsProjectSummaryError(String(error));`)],
      ["a component's own React state", `
        export function Form() {
          const [error, setError] = useState(null);
          const save = async () => { try { await api(); } catch (e) { setError(String(e)); } };
          return error;
        }`],
      ["a class component's own state", `
        export class Boundary extends Component {
          static getDerivedStateFromError() { return null; }
          componentDidCatch(error) { this.setState({ error }); }
        }`],
    ])("allows %s", (_name, text) => {
      expect(violations([{ rel: "store/slices/thingSlice.ts", text }])).toEqual([]);
    });

    it("allows the app-wide sources, and only them", () => {
      const text = `
        export const createProjectSlice = (set, get) => ({
          initializeApp: async () => { set({ error: { type: "UNKNOWN", message: "startup" } }); },
          scanProjects: async () => { set({ error: { type: "UNKNOWN", message: "scan" } }); },
          reloadProjectSessions: async () => { set({ error: { type: "UNKNOWN", message: "list" } }); },
        });`;
      expect(violations([{ rel: "store/slices/projectSlice.ts", text }])).toEqual([
        expect.stringMatching(/^store\/slices\/projectSlice\.ts:\d+ reloadProjectSessions: set$/),
      ]);
    });
  });
});
