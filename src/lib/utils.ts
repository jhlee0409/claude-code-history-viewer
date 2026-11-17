import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The app's font sizes are its own type tokens (`text-caption`, `text-list`,
 * `text-body`, `text-code`, `text-title`, see the TYPE SCALE block in
 * `index.css`), not Tailwind's default `xs`/`sm`/... names. tailwind-merge
 * cannot know that, and `text-<something>` that is not a recognised size
 * falls through to its text-COLOUR group: `cn("text-caption
 * text-muted-foreground")` would drop the size as a "conflicting colour" and
 * the text would render at whatever it inherits, while the same classes in a
 * plain `className` string keep it. Declaring the tokens as font sizes makes
 * both forms mean the same thing and keeps real conflict resolution:
 * `cn("text-caption", "text-list")` still yields `text-list`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "list", "body", "code", "title"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
