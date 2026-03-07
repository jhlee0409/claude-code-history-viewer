import { useEffect } from "react";
import { openExternalUrl } from "@/utils/platform";

/**
 * Returns true when the URL points outside the current app.
 *
 * Matches `http://`, `https://`, and `mailto:` schemes.
 * Relative paths and fragment-only links are considered internal.
 */
function isExternalUrl(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith("mailto:");
}

/**
 * Global click handler that intercepts external `<a>` links and opens
 * them in the system default browser instead of the Tauri WebView.
 *
 * Mount once at the app root (e.g. in App.tsx or main.tsx).
 */
export function useExternalLinks(): void {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || !isExternalUrl(href)) return;

      e.preventDefault();
      openExternalUrl(href);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);
}
