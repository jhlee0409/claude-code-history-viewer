import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";

/** One Tab stop; arrows wrap over available items in DOM order. */
export function useRovingFocus(ref: RefObject<HTMLDivElement | null>, selector: string, selectOnFocus: boolean) {
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(selector) ?? [])
    .filter((item) => !item.disabled && item.getAttribute("aria-disabled") !== "true" && !item.hidden);
  useLayoutEffect(() => {
    const available = items();
    const current = available.find((item) => selectOnFocus
      ? item.getAttribute("aria-checked") === "true"
      : item === document.activeElement || item.tabIndex === 0) ?? available[0];
    ref.current?.querySelectorAll<HTMLButtonElement>(selector).forEach((item) => { item.tabIndex = item === current ? 0 : -1; });
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
    const rtl = ref.current?.closest('[dir="rtl"]') != null;
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
