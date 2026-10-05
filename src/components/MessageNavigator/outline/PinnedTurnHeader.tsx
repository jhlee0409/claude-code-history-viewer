import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getTurnHeaderLabel } from "./turnHeaderLabel";
import type { TurnGroup } from "./types";

interface PinnedTurnHeaderProps {
  turn: TurnGroup;
  hasMore: boolean;
  totalTurns: number;
  onClick: () => void;
}

/**
 * The open turn's header, pinned to the top of the outline's scroll
 * container while scrolling through its children. A sibling of the
 * `role="tree"` element (Accessibility), never a row inside it.
 * Clicking navigates the main transcript to the turn's prompt; it never
 * toggles the turn and never scrolls the outline (Design, "Pinned turn
 * header").
 */
export const PinnedTurnHeader = React.memo<PinnedTurnHeaderProps>(({
  turn,
  hasMore,
  totalTurns,
  onClick,
}) => {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onClick(), [onClick]);
  const labelText = getTurnHeaderLabel(turn, hasMore, totalTurns, t);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t("navigator.outline.jumpToTurn")}
      className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-sidebar border-b border-border/50 text-left hover:bg-accent/10 transition-colors"
    >
      <span className="text-2xs font-medium text-foreground shrink-0">{labelText}</span>
      {turn.header?.preview && (
        <span className="text-2xs text-muted-foreground truncate flex-1">
          {turn.header.preview}
        </span>
      )}
    </button>
  );
});

PinnedTurnHeader.displayName = "PinnedTurnHeader";
