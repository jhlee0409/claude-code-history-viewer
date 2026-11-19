import { useCallback, useEffect, useState } from "react";

/**
 * A "copied" flag that resets itself after `resetMs`.
 *
 * The reset timer lives in an effect, so unmounting clears it: a copy button
 * removed within `resetMs` (row collapsed, session switched, test torn down)
 * never sets state on an unmounted component or after the DOM is gone.
 */
export function useCopiedFlag(resetMs: number): [copied: boolean, markCopied: () => void] {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), resetMs);
    return () => clearTimeout(timer);
  }, [copied, resetMs]);

  const markCopied = useCallback(() => setCopied(true), []);
  return [copied, markCopied];
}
