import { createContext } from "react";

/**
 * Ambient default for nested collapsibles that carry no explicit
 * `defaultExpanded` (e.g. tool results rendered inside an already-open card).
 */
export const RendererDefaultsContext = createContext<{ defaultExpanded: boolean }>({
  defaultExpanded: false,
});
