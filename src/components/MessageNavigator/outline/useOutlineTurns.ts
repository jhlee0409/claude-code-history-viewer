import { useMemo } from "react";
import type { ClassifiedRow } from "../classifiedRows";
import { groupTurns } from "./groupTurns";
import type { TurnGroup } from "./types";

/** Memoized `groupTurns`, matching `useNavigatorEntries`'s own memoization. */
export function useOutlineTurns(rows: ClassifiedRow[]): TurnGroup[] {
  return useMemo(() => groupTurns(rows), [rows]);
}
