/**
 * Left inset and rail shared by every level-2 outline row (activity, task,
 * and message children), so an open turn reads as nested under one rail, as
 * in the approved mockup (Design, "Indent every child under a rail"). Each
 * row's own `border-l-2` stays reserved for its active/focus-ring color, so
 * the rail is drawn with a `before:` pseudo-element instead of a second
 * border side. No `relative` class: every row already carries an inline
 * `position: absolute` (the virtualizer's own row style), which anchors the
 * `before:` pseudo-element on its own. Lives in its own module, not
 * alongside a component, so Fast Refresh does not warn about a
 * non-component export (matches `kindStyles.ts`).
 */
export const OUTLINE_CHILD_INDENT_CLASS =
  "pl-7 pr-3 before:absolute before:left-3 before:inset-y-0 before:w-px before:bg-border/60";
