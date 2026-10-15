/**
 * The async ownership rule (`src/navigation/ownership.ts`), held statically.
 *
 * Feedback written after an `await` - a toast, an alert, the global error,
 * the URL, the message target, the place - must be dominated by a
 * place-ownership check (`ownsFeedback()`, `ownsPlace()`, `owns()`, an
 * `isStale…()` early return; see `./utils/asyncWrites` for the accepted
 * shapes), or belong to a function in the exemption table below, with the
 * reason. A new `await` followed by an ungated feedback write fails this test.
 *
 * - The store, the navigation helpers and the navigation/analytics hooks are
 *   held to it for every feedback write.
 * - Every other component / hook / layout (`src/layouts`: the header, the
 *   shell's screens and dock) that awaits is held to it for direct store
 *   writes (`useAppStore.setState(...)`, `useAppStore.getState().setError(...)`,
 *   …). Its own toasts and React state report the outcome of what the user
 *   did there and are not scanned.
 *
 * What it does not prove: data identity and spinner ownership (behavioural
 * tests in `navigation.asyncOwnership.test.ts` hold those), and writes made
 * through other functions it does not follow.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  asyncWrites,
  FEEDBACK_KINDS,
  isFeedback,
  isStoreWrite,
  type AsyncWrite,
} from "./utils/asyncWrites";

const SRC = path.resolve(__dirname, "..");
const SCOPES = ["store", "navigation", "hooks/analytics"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const read = (file: string) => ({
  rel: path.relative(SRC, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
});

const FILES = SCOPES.flatMap((scope) => sourceFiles(path.join(SRC, scope))).map(read);
const scoped = new Set(FILES.map((file) => file.rel));

type SourceText = ReturnType<typeof read>;

/** Of `files`, those outside SCOPES that do async work. */
const doAsyncWork = (files: SourceText[]) =>
  files.filter((file) => !scoped.has(file.rel) && /\bawait\b|\.then\(/.test(file.text));

/** Components, hooks and layouts outside SCOPES that do async work. */
const UI_FILES = doAsyncWork(
  [
    ...sourceFiles(path.join(SRC, "components")),
    ...sourceFiles(path.join(SRC, "hooks")),
    ...sourceFiles(path.join(SRC, "layouts")),
    path.join(SRC, "App.tsx"),
  ].map(read)
);

/**
 * `file#function:kind` -> why that function's late write of that kind is not
 * place-scoped feedback. Most report the outcome of something the user asked
 * for (a save, a discovery) or of app startup, not a load of what a screen
 * shows: hiding it because the user moved on would hide a failed action.
 */
const EXEMPT: Record<string, string> = {
  "store/slices/projectSlice.ts#initializeApp:global-error":
    "app startup: no place exists before it; its error is the whole app's state",
  "store/slices/projectSlice.ts#discoverProviders:toast":
    "user action (provider discovery): persisting its result failed",
  "store/slices/providerSlice.ts#detectProviders:toast":
    "user action (provider discovery): detection failed",
  "store/slices/settingsSlice.ts#setSessionSortOrder:toast":
    "user action: a preference failed to save",
  "store/slices/settingsSlice.ts#setSessionEntrypointFilter:toast":
    "user action: a preference failed to save",
  "store/useLanguageStore.ts#setLanguage:toast": "user action: a preference failed to save",
  "store/slices/projectSlice.ts#reloadProjectSessions:place":
    "the open session's own record refreshed in place (same file_path, list counts): data, gated by ownsData - a reload must refresh it on any screen",
};

const feedbackKeys = (rel: string, write: AsyncWrite) =>
  write.kinds
    .filter((kind) => FEEDBACK_KINDS.includes(kind))
    .map((kind) => `${rel}#${write.fn}:${kind}`);

/** Direct store feedback written late and ungated, in UI-side `files`. */
const uiViolations = (files: SourceText[]) =>
  files.flatMap(({ rel, text }) =>
    asyncWrites(rel, text)
      .filter((write) => isStoreWrite(write) && isFeedback(write) && !write.gated)
      .filter((write) => !feedbackKeys(rel, write).every((key) => EXEMPT[key]))
      .map((write) => `${rel}:${write.line} ${write.fn}: ${write.callee} [${write.kinds.join(",")}]`)
  );

describe("async ownership invariant", () => {
  const violations = FILES.flatMap(({ rel, text }) =>
    asyncWrites(rel, text)
      .filter((write) => isFeedback(write) && !write.gated)
      .filter((write) => !feedbackKeys(rel, write).every((key) => EXEMPT[key]))
      .map((write) => `${rel}:${write.line} ${write.fn}: ${write.callee} [${write.kinds.join(",")}]`)
  );

  it("every feedback write after an await is gated by place ownership", () => {
    expect(violations).toEqual([]);
  });

  it("every direct store feedback write after an await in a component or hook is gated", () => {
    expect(UI_FILES.length).toBeGreaterThan(20);
    expect(uiViolations(UI_FILES)).toEqual([]);
  });

  it("scans the layouts: the header's async callbacks are in the UI-side scan", () => {
    const layouts = UI_FILES.map((file) => file.rel).filter((rel) => rel.startsWith("layouts/"));
    expect(layouts).toEqual(
      expect.arrayContaining(["layouts/Header/Header.tsx", "layouts/Header/SessionCopyMenu.tsx"])
    );
  });

  it("catches an ungated late store write added to a shell screen", () => {
    const screens = read(path.join(SRC, "layouts/shell/screens.tsx"));
    const probe = {
      rel: screens.rel,
      text: `${screens.text}
export const LateScreen = () => {
  const reload = useCallback(async () => {
    await api();
    useAppStore.getState().setError({ message: "late" });
  }, []);
  return null;
};`,
    };
    const files = doAsyncWork([
      ...UI_FILES.filter((file) => file.rel !== probe.rel),
      probe,
    ]);
    expect(uiViolations(files)).toEqual([
      expect.stringMatching(
        /^layouts\/shell\/screens\.tsx:\d+ reload: useAppStore\.getState\(\)\.setError \[global-error\]$/
      ),
    ]);
  });

  it("every exemption still names a function with feedback after an await", () => {
    const used = new Set(
      FILES.flatMap(({ rel, text }) =>
        asyncWrites(rel, text)
          .filter(isFeedback)
          .flatMap((write) => feedbackKeys(rel, write))
      )
    );
    expect(Object.keys(EXEMPT).filter((key) => !used.has(key))).toEqual([]);
  });

  it("the scan sees writes: an ungated late toast is caught, a gated one is not", () => {
    const source = `
      const slice = {
        load: async () => {
          const owner = ownWork(get);
          try { await api(); } catch (e) {
            toast.error("ungated");
            if (owner.ownsFeedback()) toast.error("gated");
          }
          const value = await api().catch(() => { toast.warning("late"); });
          if (!owner.ownsFeedback()) return;
          get().setError({ message: "gated by early return" });
        },
        sync: () => { toast.error("before any await"); },
      };`;
    const writes = asyncWrites("probe.ts", source).filter(isFeedback);
    expect(writes.filter((w) => !w.gated).map((w) => w.line)).toEqual([6, 9]);
    expect(writes.filter((w) => w.gated)).toHaveLength(2);
  });
});

/**
 * Self-check against the bypasses the third independent review found
 * (scratch/t2-review/review-3.md R2): each body runs after an `await`, and
 * must leave exactly the expected number of ungated feedback writes.
 */
describe("async ownership scan: gate polarity and hidden writes", () => {
  const ungatedFeedback = (body: string) =>
    asyncWrites(
      "probe.ts",
      `
      const slice = {
        load: async () => {
          const owner = ownWork(get);
          await api();
          ${body}
        },
      };`
    ).filter((write) => isFeedback(write) && !write.gated);

  it.each([
    ["an inverted gate", `if (!owner.ownsFeedback()) toast.error("late");`],
    ["an early return on ownership", `if (owner.ownsFeedback()) return; toast.error("late");`],
    ["an always-true disjunction", `if (owner.ownsFeedback() || true) toast.error("late");`],
    ["the else branch of a gate", `if (owner.ownsFeedback()) { done(); } else { toast.error("late"); }`],
    ["the false arm of a gated ternary", `owner.ownsFeedback() ? done() : toast.error("late");`],
    ["a gate checked before another await", `if (!owner.ownsFeedback()) return; await api(); toast.error("late");`],
    ["a staleness check with the wrong polarity", `if (!isStale()) return; toast.error("late");`],
    ["a direct store setState error", `useAppStore.setState({ error: { message: "late" } });`],
    ["a direct store setState target", `useAppStore.setState({ targetMessageUuid: "old" });`],
    ["a getState() store error action", `useAppStore.getState().setError({ message: "late" });`],
    ["a spread of a local error payload", `const payload = { error: { message: "late" } }; set({ ...payload });`],
    ["a local error payload", `const payload = { error: { message: "late" } }; set(payload);`],
    ["a store write it cannot see", `set(buildPatch());`],
    ["an aliased toast method", `const fail = toast.error; fail("late");`],
    ["an aliased toast object", `const notify = toast; notify.error("late");`],
    ["a toast in an inline callback", `items.forEach(() => toast.error("late"));`],
    ["an await inside an async inline callback", `items.forEach(async () => { await api(); toast.error("late"); });`],
  ])("catches %s", (_name, body) => {
    expect(ungatedFeedback(body)).toHaveLength(1);
  });

  it.each([
    ["an early return on lost ownership", `if (!owner.ownsFeedback()) return; toast.error("late");`],
    ["a positive gate", `if (owner.ownsFeedback()) toast.error("late");`],
    ["a conjunction with a gate", `if (owner.ownsFeedback() && ok) toast.error("late");`],
    ["an early return on a disjunction of lost ownership", `if (!owner.ownsFeedback() || done) return; toast.error("late");`],
    ["the else branch of a staleness check", `if (isStale()) { done(); } else { toast.error("late"); }`],
    ["an early return on staleness", `if (isStaleRequest()) return; toast.error("late");`],
    ["a short-circuit gate", `owner.ownsFeedback() && toast.error("late");`],
    ["an owned navigation result", `const arrived = await go(); if (arrived) toast.error("late");`],
    ["a gated inline callback", `if (owner.ownsFeedback()) items.forEach(() => toast.error("late"));`],
    ["a gated direct setState", `if (owner.ownsFeedback()) useAppStore.setState({ error: { message: "late" } });`],
    ["a data-only setState", `useAppStore.setState({ rows: [] });`],
  ])("accepts %s", (_name, body) => {
    expect(ungatedFeedback(body)).toEqual([]);
  });

  const ungatedStoreFeedback = (body: string) =>
    asyncWrites(
      "Component.tsx",
      `
      export function Component() {
        const [error, setError] = useState(null);
        const handle = useCallback(async () => {
          await api();
          ${body}
        }, []);
        return null;
      }`
    ).filter((write) => isStoreWrite(write) && isFeedback(write) && !write.gated);

  it.each([
    ["a direct setState error", `useAppStore.setState({ error: { message: "late" } });`],
    ["a getState() error action", `useAppStore.getState().setError({ message: "late" });`],
    ["a getState() target action", `useAppStore.getState().navigateToMessage("old");`],
    ["a getState() place action", `useAppStore.getState().navigate({ view: "board" });`],
  ])("catches %s in a component callback", (_name, body) => {
    expect(ungatedStoreFeedback(body)).toHaveLength(1);
  });

  it.each([
    ["its own React error state", `setError("late");`],
    ["its own React setState", `setState({ error: "late" });`],
    ["a gated store write", `if (owner.ownsFeedback()) useAppStore.setState({ error: { message: "late" } });`],
  ])("leaves %s to the component", (_name, body) => {
    expect(ungatedStoreFeedback(body)).toEqual([]);
  });
});
