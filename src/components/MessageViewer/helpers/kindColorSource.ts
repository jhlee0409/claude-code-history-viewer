import type { MessageKind } from "./messageKinds";
import { priorityForKind, type MinimapColorSource } from "./minimapLayout";

/**
 * Kind -> CSS custom property. Values taken from the Messages panel's
 * current icon colors, `NavigatorEntry.tsx`'s `KIND_STYLES.iconClass` (not
 * imported here: another open PR moves that file). `prompt` and `command`
 * both resolve to `text-info`, `context`/`tool`/`system` to
 * `text-muted-foreground`; `agent-update`, `reply`, and `summary` each keep
 * their own token (Design §5).
 */
export const MINIMAP_KIND_CSS_VAR: Record<MessageKind, string> = {
  prompt: "--info",
  command: "--info",
  "agent-update": "--tool-task",
  context: "--muted-foreground",
  reply: "--warning",
  tool: "--muted-foreground",
  system: "--muted-foreground",
  summary: "--tool-mcp",
};

/** The token a failed `agent-update` row overrides its base color with (Design §4, draw-loop override). */
export const MINIMAP_FAILED_CSS_VAR = "--destructive";

/**
 * Read a CSS custom property off `document.documentElement` at call time.
 * Never cached (Decision 4): the theme-color fix in `1bd82f8b` exists so a
 * surface like this one repaints correctly on a theme switch with no reload.
 */
function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The color a failed `agent-update` row paints with, regardless of its base kind color. */
export function minimapFailedColor(): string {
  return readCssVar(MINIMAP_FAILED_CSS_VAR);
}

/**
 * `MinimapColorSource` built from the Messages panel's kind colors (Design
 * §5). PR 1's only implementation; a token-cost mode (issue #570) is a
 * plausible second one that reorders priority without touching this shape.
 */
export const kindColorSource: MinimapColorSource = {
  colorForKind(kind: MessageKind): string | null {
    const color = readCssVar(MINIMAP_KIND_CSS_VAR[kind]);
    return color.length > 0 ? color : null;
  },
  priorityForKind,
};
