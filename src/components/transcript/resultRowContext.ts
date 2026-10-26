/**
 * Where a server / API result body is drawn (TR1b). A result block
 * (`web_search_tool_result`, `mcp_tool_result` …) answers a `server_tool_use`
 * / `mcp_tool_use` call recorded in the same message; the call's ToolRow
 * draws the result inside its Result zone and provides `paired: true`, so
 * the result renderer draws its body only (no head of its own). Outside a
 * call (a result whose call is not in the message) `ResultRow` draws the
 * row itself.
 *
 * `highlight`: the in-session search query when it hits the call or its
 * results; result bodies mark the hits in the text they show. Outside a
 * call (`paired: false`), `StandaloneServerResult` provides it when the
 * query hits the result itself, and `ResultRow` then opens its own row.
 */
import { createContext } from "react";
import type { TextHighlight } from "./ToolRow";

export interface ResultRowContextValue {
  paired: boolean;
  highlight?: TextHighlight;
}

export const ResultRowContext = createContext<ResultRowContextValue>({ paired: false });
