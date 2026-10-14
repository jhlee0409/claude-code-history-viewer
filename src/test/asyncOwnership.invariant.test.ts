/**
 * The async ownership rule (`src/navigation/ownership.ts`), held statically
 * over every file that runs place-scoped async work: the store, the
 * navigation helpers and the navigation/analytics hooks.
 *
 * Feedback written after an `await` - a toast, an alert, the global error,
 * the URL, the message target, the place - must sit behind a place-ownership
 * gate (`ownsFeedback()`, `ownsPlace()`, `owns()`, `isStale…()`), or belong
 * to a function in the exemption table below, with the reason. A new `await`
 * followed by an ungated feedback write fails this test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  asyncWrites,
  FEEDBACK_KINDS,
  isFeedback,
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

const FILES = SCOPES.flatMap((scope) => sourceFiles(path.join(SRC, scope))).map(
  (file) => ({
    rel: path.relative(SRC, file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8"),
  })
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
