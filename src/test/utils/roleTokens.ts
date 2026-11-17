/**
 * The F1a role tokens of src/index.css (inner-UI plan §4.1) — the one list
 * the parity and contrast tests read. Names without the leading `--`.
 */

const each = <T extends string>(parts: readonly T[], f: (p: T) => string[]) => parts.flatMap(f);

/** Colour roles: every one resolves to an opaque oklch() in all four themes and has a Tailwind colour. */
export const COLOR_ROLES = [
  // text
  "fg",
  "fg-2",
  "fg-3",
  "fg-disabled",
  // surfaces
  "surface-canvas",
  "surface-pane",
  "surface-raised",
  "surface-well",
  "surface-hover",
  "surface-selected",
  "surface-turn-user",
  // lines
  "line",
  "line-faint",
  "line-input",
  "line-selected",
  // status
  ...each(["danger", "warning", "info", "success"] as const, (s) => [`status-${s}-fg`, `status-${s}-surface`, `status-${s}-line`]),
  // search highlight
  "highlight-search-bg",
  "highlight-search-fg",
  "highlight-search-current",
  // diff (Q1)
  ...each(["add", "del"] as const, (s) => [`diff-${s}-bg`, `diff-${s}-fg`, `diff-${s}-gutter`, `diff-word-${s}-bg`, `diff-word-${s}-mark`]),
  "diff-hunk-fg",
  "diff-context-fg",
  // code (syntax)
  ...each(["keyword", "string", "number", "comment", "function", "type", "punct"] as const, (s) => [`code-${s}`]),
  // focus
  "focus-ring",
] as const;

/** Non-colour roles and the Tailwind theme key that turns each into a utility. */
export const VALUE_ROLES: ReadonlyArray<readonly [role: string, themeKey: string | null]> = [
  ["focus-ring-width", null],
  ["focus-ring-offset", null],
  ["focus-ring-inset", null],
  ["radius-row", "radius-row"],
  ["radius-control", "radius-control"],
  ["radius-overlay", "radius-overlay"],
  ["radius-pill", "radius-pill"],
  ["radius-dot", "radius-dot"],
  ["page-inset", "spacing-page-inset"],
  ["row-tool", "min-height-row-tool"],
  ["row-list", "min-height-row-list"],
  ["row-file", "min-height-row-file"],
  ["row-touch", "min-height-row-touch"],
  ["rail-width", "width-rail"],
  ["measure-prose", "max-width-measure-prose"],
  ["measure-work", "max-width-measure-work"],
  ["duration-fast", "transition-duration-fast"],
  ["duration-normal", "transition-duration-normal"],
  ["duration-slow", "transition-duration-slow"],
  ["ease-standard", "ease-standard"],
  ["ease-emphasized", "ease-emphasized"],
  ["elevation-popover", "shadow-popover"],
  ["elevation-overlay", "shadow-overlay"],
];
