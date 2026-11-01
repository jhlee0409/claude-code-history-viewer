import { createContext, useContext } from "react";
import type { CodexChangeEvent } from "./codexFileChangeModel";
export interface CodexChangeIndex { matched: ReadonlyMap<string, readonly CodexChangeEvent[]>; unassigned: ReadonlyMap<string, readonly CodexChangeEvent[]> }
export const CodexChangeContext = createContext<CodexChangeIndex>({ matched: new Map(), unassigned: new Map() });
export const useCodexChanges = () => useContext(CodexChangeContext);
