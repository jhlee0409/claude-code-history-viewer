/**
 * ⌘+click (Ctrl+click elsewhere) opens a session in a new conversation tab
 * (plan T8, decision page §2). Rows that list sessions read the shell's
 * opener from here instead of threading it through every list; without a
 * provider (a list rendered on its own) the modifier click opens in place.
 */
import { createContext, useContext } from "react";
import type { ClaudeProject, ClaudeSession } from "@/types";

export type OpenSessionInNewTab = (session: ClaudeSession, owner?: ClaudeProject) => void;

export const OpenSessionInNewTabContext = createContext<OpenSessionInNewTab | null>(null);

export const useOpenSessionInNewTab = (): OpenSessionInNewTab | null => useContext(OpenSessionInNewTabContext);
