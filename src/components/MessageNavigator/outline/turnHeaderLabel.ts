import type { TurnGroup } from "./types";

/**
 * The leading-group or real-turn header text (line 1), per the spec's "not
 * loaded" notice rules (Design, "Leading group and the 'not loaded'
 * notice"). Shared by `OutlineTurnHeader` and `PinnedTurnHeader` - its own
 * module, not alongside a component, so Fast Refresh does not warn about a
 * non-component export.
 */
export function getTurnHeaderLabel(
  turn: TurnGroup,
  hasMore: boolean,
  totalTurns: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (turn.turnStartUuid === null) {
    return hasMore
      ? t("navigator.outline.earlierNotLoaded")
      : t("navigator.outline.beforeFirstPrompt");
  }
  const key = hasMore ? "navigator.outline.turnLabelLoaded" : "navigator.outline.turnLabel";
  return t(key, { n: turn.turnNumber, total: totalTurns });
}
