// The automatic PR capture gate's scenario set (second review N1): 32 exact
// ids out of the full matrix, one representative per surface family at the
// main desktop size in both themes, plus the phone and the narrow desktop
// where layout changes. Same screens, fixture and steps as scenarios.mjs
// (re-exported); only the selection differs.
//
//   pnpm ui:capture --scenarios scripts/ui-capture/ci-scenarios.mjs --base <ref> --gate unchanged
//
// The full matrix stays the default of `pnpm ui:capture` and of the
// workflow_dispatch `full_matrix` run. This subset does not replace the
// scenario-specific evidence a UI task owes for the surfaces it changes.
// test/ciScenarios.test.mjs pins the set and checks every id is active.

export * from "./scenarios.mjs";

const at = (viewport, theme, screens) => screens.map((screen) => `${screen}--${viewport}--${theme}`);

export const CI_SCENARIO_IDS = [
  ...at("1440x900", "dark", [
    "home",
    "transcript-mixed-turn",
    "x-transcript-edit-expanded",
    "transcript-failure",
    "transcript-unknown-outcome",
    "transcript-cjk",
    "analytics",
    "recent-edits",
    "board",
    "global-stats",
    "archive",
    "settings",
    "settings-dirty",
    "archive-error",
    "empty",
    "loading",
    "error",
    "palette-all-groups",
  ]),
  ...at("1440x900", "light", ["transcript-mixed-turn", "x-transcript-edit-expanded", "analytics", "recent-edits", "settings", "gear"]),
  ...at("390x844", "dark", ["home", "sidebar", "transcript-mixed-turn", "x-transcript-edit-expanded", "recent-edits", "settings"]),
  ...at("1180x760", "dark", ["transcript-mixed-turn", "analytics"]),
];

/** run.mjs: a scenario module exporting SELECTED_IDS runs exactly these (lib/selection.mjs). */
export const SELECTED_IDS = CI_SCENARIO_IDS;
