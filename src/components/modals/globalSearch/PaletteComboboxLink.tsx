/**
 * The ⌘K palette's search field as a combobox (WAI-ARIA 1.2 combobox with a
 * listbox popup): focus stays in the field while the arrow keys move cmdk's
 * highlight, so the field must say which list it controls and which option
 * is highlighted, or a screen reader announces nothing as the highlight moves.
 *
 * cmdk generates the listbox's and the options' ids, and its own input
 * (`Command.Input`) loses the active option whenever cmdk picks the first
 * item itself (a scheduled update inside its flush is dropped, cmdk 1.1.1),
 * so the highlight is read from the rendered list instead: the option whose
 * `data-value` is the palette's controlled `selectedValue`. The field itself
 * carries the static part (`role="combobox"`, `aria-expanded`,
 * `aria-autocomplete="list"`).
 */
import { useLayoutEffect, type RefObject } from "react";
import { paletteValue } from "@/commands/paletteQuery";

/** The rendered cmdk option for `value`, if it is listed. */
function findPaletteOption(list: HTMLElement, value: string): HTMLElement | undefined {
    const wanted = paletteValue(value);
    if (!wanted) return undefined;
    return Array.from(list.querySelectorAll<HTMLElement>("[cmdk-item]")).find(
        (item) => item.getAttribute("data-value") === wanted,
    );
}

interface PaletteComboboxLinkProps {
    inputRef: RefObject<HTMLInputElement | null>;
    listRef: RefObject<HTMLElement | null>;
    /** The highlighted item's cmdk value (the palette controls it). */
    selectedValue: string;
}

/**
 * Points the field at the listbox (`aria-controls`) and at the highlighted
 * option (`aria-activedescendant`). Render it inside the cmdk root, after the
 * list: it then mounts with the dialog's content (which a portal mounts
 * after the palette itself) and its effect runs once the options' layout
 * effects have written their `data-value`s. It runs after every render: the
 * ids are cmdk's and change when options remount (a new query or result
 * set), which always re-renders the palette, so no dependency list could be
 * both complete and cheaper than the lookup itself.
 */
export function PaletteComboboxLink({ inputRef, listRef, selectedValue }: PaletteComboboxLinkProps) {
    useLayoutEffect(() => {
        const input = inputRef.current;
        const list = listRef.current;
        if (!input || !list) return;
        setOrRemove(input, "aria-controls", list.id);
        setOrRemove(input, "aria-activedescendant", findPaletteOption(list, selectedValue)?.id);
    });
    return null;
}

function setOrRemove(element: HTMLElement, name: string, value: string | undefined): void {
    if (value) element.setAttribute(name, value);
    else element.removeAttribute(name);
}
