import { useMemo } from "react";
import type { ClaudeMessage } from "../../types";
import type { NavigatorEntryData } from "./types";
import { getFilteredClassifiedMessages } from "./classifiedRows";

export function useNavigatorEntries(messages: ClaudeMessage[]): NavigatorEntryData[] {
  return useMemo(
    () => getFilteredClassifiedMessages(messages).map((row) => row.entry),
    [messages],
  );
}
