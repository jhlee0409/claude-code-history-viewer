import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * This project defines its own font sizes as plain CSS utilities in
 * `index.css` (`.text-px6` through `.text-px14`) rather than through Tailwind's
 * `fontSize` theme. tailwind-merge cannot know that, and `text-<something>`
 * that is not a recognised size falls through to its text-COLOUR group. So it
 * treated `text-px11` as a colour, saw a real colour later in the same string,
 * and dropped the size.
 *
 * The failure is silent and depends on how the classes are written:
 * `className="text-px11 text-muted-foreground"` is fine, because tailwind-merge
 * never sees it, while `cn("text-px11 text-muted-foreground")` loses the size
 * and the text renders at whatever it inherits. Roughly a hundred places in
 * this codebase pair a px size with a colour, so the two forms cannot be
 * allowed to mean different things.
 *
 * Declaring the sizes here fixes every one of them at once, and keeps the
 * conflict resolution tailwind-merge is for: `cn("text-px11", "text-px13")`
 * still yields `text-px13`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["px6", "px8", "px9", "px10", "px11", "px12", "px13", "px14"] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
