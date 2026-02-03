/**
 * Renderer Hooks
 *
 * Provides reusable hooks for renderer components:
 * - useRendererStyles: Memoized variant styles
 * - useExpandableContent: Toggle and auto-expand logic
 */

import { useMemo, useState, useEffect } from "react";
import { getVariantStyles, type VariantStyles } from "./styles";
import type { RendererVariant } from "./types";

/**
 * Get memoized variant styles
 *
 * @example
 * const styles = useRendererStyles("success");
 * <div className={styles.container}>...</div>
 */
export function useRendererStyles(variant: RendererVariant): VariantStyles {
  return useMemo(() => getVariantStyles(variant), [variant]);
}

/**
 * State for expandable content with auto-expand on search
 *
 * @example
 * const { isExpanded, toggle } = useExpandableContent({
 *   defaultExpanded: false,
 *   searchQuery: "error",
 *   content: "This has an error"
 * });
 */
export function useExpandableContent({
  defaultExpanded = false,
  searchQuery,
  content,
}: {
  defaultExpanded?: boolean;
  searchQuery?: string;
  content?: string;
}): {
  isExpanded: boolean;
  toggle: () => void;
  setIsExpanded: (value: boolean) => void;
} {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Auto-expand when search query matches content
  useEffect(() => {
    if (
      searchQuery &&
      content &&
      content.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      setIsExpanded(true);
    }
  }, [searchQuery, content]);

  const toggle = () => setIsExpanded((prev) => !prev);

  return { isExpanded, toggle, setIsExpanded };
}
