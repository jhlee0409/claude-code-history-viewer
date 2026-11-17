import type { ClaudeMessage } from "../../../types";
import type { TurnGroup } from "./types";

/**
 * Walks the raw `messages` array in order, keeping a running
 * `currentTurnStartUuid` that changes only when a message's own uuid is one
 * of `turns`' `turnStartUuid` values, and maps every message's uuid
 * (including rows the outline never renders: noise types, empty messages) to
 * whatever that running value is. A message before the first turn start maps
 * to `null`, matching the leading group (Design, "Highlighting the turn in
 * view"). This never re-runs `isTurnStart`; it only tests membership in
 * `groupTurns`'s own output, so this map and the outline can never disagree
 * about where a turn starts.
 */
export function buildTurnOfMessage(
  messages: ClaudeMessage[],
  turns: TurnGroup[],
): Map<string, string | null> {
  const turnStartUuids = new Set(
    turns
      .map((turn) => turn.turnStartUuid)
      .filter((uuid): uuid is string => uuid !== null),
  );

  const map = new Map<string, string | null>();
  let current: string | null = null;

  for (const message of messages) {
    if (turnStartUuids.has(message.uuid)) {
      current = message.uuid;
    }
    map.set(message.uuid, current);
  }

  return map;
}
