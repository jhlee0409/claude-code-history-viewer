import { useEffect } from "react";
import { toast } from "sonner";
import {
  EXTERNAL_OPEN_HELPER_ATTRIBUTE,
  openExternalUrl,
} from "@/utils/platform";

/**
 * Returns true when the URL points outside the current app.
 *
 * Matches `http://`, `https://`, and `mailto:` schemes.
 * Relative paths and fragment-only links are considered internal.
 */
function isExternalUrl(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

/**
 * Returns true when following the link keeps the app loaded: in-page
 * fragments, and blob/data URLs used for programmatic downloads.
 *
 * A blob/data URL without `download` would replace the app page (e.g. a
 * `data:text/html` document), so both conditions are required.
 */
function isSafeInAppLink(anchor: HTMLAnchorElement, href: string): boolean {
  return (
    href.startsWith("#") ||
    (anchor.hasAttribute("download") && /^(?:blob|data):/i.test(href))
  );
}

/**
 * Global click handler that intercepts external `<a>` links and opens
 * them in the system default browser instead of the Tauri WebView.
 *
 * Any other link (relative paths like `src/App.tsx#L42` from transcript
 * markdown, `file:` URLs, …) would navigate the WebView away from the app
 * and discard all state, so those clicks are cancelled.
 *
 * Mount once at the app root (e.g. in App.tsx or main.tsx).
 */
export function useExternalLinks(): void {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (anchor.hasAttribute(EXTERNAL_OPEN_HELPER_ATTRIBUTE)) return;

      const href = anchor.getAttribute("href");
      if (!href || isSafeInAppLink(anchor, href)) return;

      e.preventDefault();
      if (!isExternalUrl(href)) return;

      openExternalUrl(href).catch((err) => {
        console.error("[useExternalLinks] Failed to open URL:", err);
        toast.error("Failed to open link.");
      });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);
}
