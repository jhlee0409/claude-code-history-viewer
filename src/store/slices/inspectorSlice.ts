/**
 * The inspector: the right-hand panel beside a transcript (plan T9a,
 * decision D5). One panel with three tabs - the outline (the message
 * navigator, moved as is), the session's token usage and its details.
 *
 * Closed until the user opens it; after that the last open state, tab and
 * width are kept. All three are window-wide preferences (`stateScope.ts`:
 * `app`), not a conversation tab's: switching tabs keeps the panel as the
 * user left it.
 *
 * Stored as one versioned record (`inspector.v1`). Each field is validated
 * on its own, so one bad value falls back to its default without dropping
 * the others. Before the record exists, the message navigator's own keys
 * (`navigator-open`, `navigator-width`) seed it, so a panel the user had
 * open stays open after the upgrade. Those keys are only read, never
 * written or removed.
 */
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

/** The inspector's tabs. */
export const INSPECTOR_TAB_IDS = ["outline", "tokens", "info"] as const;
export type InspectorTabId = (typeof INSPECTOR_TAB_IDS)[number];

export const INSPECTOR_STORAGE_KEY = "inspector.v1";
/** The message navigator's keys, read once to seed the record. */
export const LEGACY_NAVIGATOR_OPEN_KEY = "navigator-open";
export const LEGACY_NAVIGATOR_WIDTH_KEY = "navigator-width";

/** The navigator's width rules, kept so the outline renders as before. */
export const INSPECTOR_WIDTH = { default: 280, min: 200, max: 400 } as const;

export interface InspectorPrefs {
  open: boolean;
  tab: InspectorTabId;
  width: number;
}

export const DEFAULT_INSPECTOR_PREFS: InspectorPrefs = {
  open: false,
  tab: "outline",
  width: INSPECTOR_WIDTH.default,
};

const isTab = (value: unknown): value is InspectorTabId =>
  typeof value === "string" && (INSPECTOR_TAB_IDS as readonly string[]).includes(value);

const isWidth = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= INSPECTOR_WIDTH.min &&
  value <= INSPECTOR_WIDTH.max;

/** Clamps a width into the allowed range (a drag can end anywhere). */
export const clampInspectorWidth = (width: number): number =>
  Math.round(Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, width)));

/**
 * Reads a stored record field by field. `raw` is the stored string (or
 * null); anything that is not a JSON object yields the defaults.
 */
export function parseInspectorPrefs(raw: string | null): InspectorPrefs | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_INSPECTOR_PREFS };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_INSPECTOR_PREFS };
  }
  const record = value as Record<string, unknown>;
  return {
    open: typeof record.open === "boolean" ? record.open : DEFAULT_INSPECTOR_PREFS.open,
    tab: isTab(record.tab) ? record.tab : DEFAULT_INSPECTOR_PREFS.tab,
    width: isWidth(record.width) ? record.width : DEFAULT_INSPECTOR_PREFS.width,
  };
}

/** The navigator's keys as a record: its open flag and width, else defaults. */
function readLegacyPrefs(storage: Storage): InspectorPrefs {
  const width = Number.parseInt(storage.getItem(LEGACY_NAVIGATOR_WIDTH_KEY) ?? "", 10);
  return {
    open: storage.getItem(LEGACY_NAVIGATOR_OPEN_KEY) === "true",
    tab: DEFAULT_INSPECTOR_PREFS.tab,
    width: isWidth(width) ? width : DEFAULT_INSPECTOR_PREFS.width,
  };
}

export function readInspectorPrefs(): InspectorPrefs {
  try {
    return (
      parseInspectorPrefs(localStorage.getItem(INSPECTOR_STORAGE_KEY)) ??
      readLegacyPrefs(localStorage)
    );
  } catch {
    // Storage unavailable (privacy mode): the defaults, never thrown.
    return { ...DEFAULT_INSPECTOR_PREFS };
  }
}

function writeInspectorPrefs(prefs: InspectorPrefs): void {
  try {
    localStorage.setItem(INSPECTOR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the choice lasts for this window only */
  }
}

export interface InspectorSliceState {
  isInspectorOpen: boolean;
  inspectorTab: InspectorTabId;
  /** Committed width in px; a drag in progress is the resize hook's own. */
  inspectorWidth: number;
}

export interface InspectorSliceActions {
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorTab: (tab: InspectorTabId) => void;
  setInspectorWidth: (width: number) => void;
}

export type InspectorSlice = InspectorSliceState & InspectorSliceActions;

const prefsOf = (s: InspectorSliceState): InspectorPrefs => ({
  open: s.isInspectorOpen,
  tab: s.inspectorTab,
  width: s.inspectorWidth,
});

export const createInspectorSlice: StateCreator<
  FullAppStore,
  [],
  [],
  InspectorSlice
> = (set, get) => {
  const initial = readInspectorPrefs();
  // Every change writes the whole record, so storage always holds the
  // panel exactly as it is.
  const update = (patch: Partial<InspectorSliceState>) => {
    const current = get();
    writeInspectorPrefs(
      prefsOf({
        isInspectorOpen: patch.isInspectorOpen ?? current.isInspectorOpen,
        inspectorTab: patch.inspectorTab ?? current.inspectorTab,
        inspectorWidth: patch.inspectorWidth ?? current.inspectorWidth,
      }),
    );
    set(patch);
  };
  return {
    isInspectorOpen: initial.open,
    inspectorTab: initial.tab,
    inspectorWidth: initial.width,

    toggleInspector: () => update({ isInspectorOpen: !get().isInspectorOpen }),
    setInspectorOpen: (open) => update({ isInspectorOpen: open }),
    setInspectorTab: (tab) => {
      if (!isTab(tab)) return;
      update({ inspectorTab: tab });
    },
    setInspectorWidth: (width) => {
      if (!Number.isFinite(width)) return;
      update({ inspectorWidth: clampInspectorWidth(width) });
    },
  };
};
