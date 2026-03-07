import { useEffect } from "react";
import { toast } from "sonner";
import { openExternalUrl } from "@/utils/platform";

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
 * Global click handler that intercepts external `<a>` links and opens
 * them in the system default browser instead of the Tauri WebView.
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

      const target = (anchor.getAttribute("target") ?? "").toLowerCase();
      if (target && target !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href || !isExternalUrl(href)) return;

      e.preventDefault();
      openExternalUrl(href).catch((err) => {
        console.error("[useExternalLinks] Failed to open URL:", err);
        toast.error("Failed to open link.");
      });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);
}
