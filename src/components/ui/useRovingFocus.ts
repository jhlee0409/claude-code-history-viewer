import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";

/** One Tab stop; arrows wrap over available items in DOM order. */
export function useRovingFocus(ref: RefObject<HTMLDivElement | null>, selector: string, selectOnFocus: boolean) {
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(selector) ?? [])
    .filter((item) => {
      if (item.disabled || item.getAttribute("aria-disabled") === "true" || item.hidden) return false;
      // Visibility is inherited but descendants can override it: inspect the
      // item's computed value, not each ancestor's visibility.
      const visibility = getComputedStyle(item).visibility;
      if (visibility === "hidden" || visibility === "collapse") return false;
      // Check the real CSS cascade, including display:none on a wrapper. Unlike
      // client rects this also works in non-layout DOMs used by component tests.
      for (let node: HTMLElement | null = item; node; node = node.parentElement) {
        if (getComputedStyle(node).display === "none") return false;
      }
      return true;
    });
  useLayoutEffect(() => {
    const syncTabStop = () => {
      const available = items();
      const current = available.find((item) => selectOnFocus
        ? item.getAttribute("aria-checked") === "true"
        : item === document.activeElement || item.tabIndex === 0) ?? available[0];
      ref.current?.querySelectorAll<HTMLButtonElement>(selector).forEach((item) => { item.tabIndex = item === current ? 0 : -1; });
    };
    syncTabStop();
    // Media queries / CSS-only hide and reveal need no React commit. Observe
    // each item, not just the group: a fixed-size group need not resize with it.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncTabStop);
    const group = ref.current;
    group?.querySelectorAll<HTMLButtonElement>(selector).forEach((item) => observer?.observe(item));
    // Visibility changes preserve size. Observe only availability attributes in
    // this group and on its ancestor chain, never the document-wide subtree.
    // tabIndex is deliberately absent: our own writes cannot feed back.
    const mutations = new MutationObserver(syncTabStop);
    const attributes = { attributes: true, attributeFilter: ["class", "style", "hidden", "disabled", "aria-disabled"] };
    if (group) mutations.observe(group, { ...attributes, subtree: true });
    for (let node = group?.parentElement; node; node = node.parentElement) mutations.observe(node, attributes);
    // Viewport media queries may change visibility without resizing any item.
    window.addEventListener("resize", syncTabStop);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", syncTabStop);
    };
  });
  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    // Radio entry follows committed selection, not a request the parent may reject
    // or defer. Only toolbars move their Tab stop with focus alone.
    if (selectOnFocus) return;
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(selector);
    if (!item || !items().includes(item)) return;
    items().forEach((candidate) => { candidate.tabIndex = candidate === item ? 0 : -1; });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const available = items();
    const index = available.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const rtl = ref.current != null && getComputedStyle(ref.current).direction === "rtl";
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = index + (rtl ? -1 : 1); break;
      case "ArrowLeft": next = index + (rtl ? 1 : -1); break;
      case "ArrowDown": next = index + 1; break;
      case "ArrowUp": next = index - 1; break;
      case "Home": next = 0; break;
      case "End": next = available.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const target = available[(next + available.length) % available.length];
    target?.focus();
    if (selectOnFocus) target?.click();
  };
  return { onKeyDown, onFocus };
}
