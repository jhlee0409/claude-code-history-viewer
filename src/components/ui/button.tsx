import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

/**
 * Button state contract (inner-UI plan F2a, G-ST1 · ST4 · ST5 · ST6).
 *
 * - Focus: the base layer's one ring (`:focus-visible`, --focus-ring);
 *   no variant switches it off.
 * - Hover is one step, pressed one more, and nothing moves or scales. A
 *   filled variant steps its fill towards the surface behind it (`/85`,
 *   `/70`; destructive `/88`, `/76` so its label keeps 4.5:1); the light
 *   and transparent ones lay the text colour over the surface (ghost and
 *   outline 14% then 28%, secondary 20% then 34%) and show their label in
 *   full --fg. Every step is big enough to see and keeps the label
 *   readable in all four themes (src/test/primitiveStates.contrast.test.tsx).
 * - Disabled is one look per variant from the disabled tokens (--fg-disabled
 *   on --muted), not 50% opacity. Button marks it `data-disabled` for
 *   `disabled` and for `aria-disabled="true"`, so both look the same; an
 *   aria-disabled button stays in the tab order and ignores click, Enter
 *   and Space (and does not open a menu it triggers). With `asChild` the
 *   child's own activation handlers are held back too, in both phases:
 *   click/double/aux click, mouse/pointer down/up, touch start/end and submit.
 *   Enter and Space are filtered from key handlers without stopping key
 *   propagation; menu triggers cancel arrow-opening defaults but still call
 *   the caller's arrow handlers. Focus, blur, hover, movement, context menus
 *   and other keys are kept.
 * - `loading`: `aria-busy` + `aria-disabled`, clicks ignored, focus kept
 *   (a natively disabled button would drop it). The label stays in the
 *   layout, invisible and still the accessible name, under the shared
 *   Spinner; it lays its parts out with the button's own direction, gap
 *   and alignment, so the size does not change whatever the caller sets.
 *   The variant's look stays.
 *
 * `accent`, `success` and `warning` have no call sites; they keep their
 * names (F2b renames and removes variants) and render `default`.
 */
const FILLED = "bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/70";
const FILLED_DISABLED = "data-disabled:bg-muted data-disabled:text-fg-disabled";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-body font-medium transition-colors",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "data-disabled:cursor-not-allowed forced-colors:data-disabled:text-[color:GrayText] data-loading:cursor-progress",
  ].join(" "),
  {
    variants: {
      variant: {
        default: `${FILLED} ${FILLED_DISABLED}`,
        destructive: `bg-destructive text-destructive-foreground hover:bg-destructive/88 active:bg-destructive/76 ${FILLED_DISABLED}`,
        outline:
          "border border-input bg-background hover:bg-foreground/14 hover:text-foreground active:bg-foreground/28 data-disabled:bg-background data-disabled:text-fg-disabled",
        secondary: `bg-secondary text-secondary-foreground hover:bg-foreground/20 hover:text-foreground active:bg-foreground/34 ${FILLED_DISABLED}`,
        ghost:
          "hover:bg-foreground/14 hover:text-foreground active:bg-foreground/28 data-disabled:bg-transparent data-disabled:text-fg-disabled",
        link: "text-primary underline-offset-4 hover:underline active:decoration-2 data-disabled:text-fg-disabled data-disabled:no-underline",
        /** @deprecated No call sites; renders `default` until F2b removes it. */
        accent: `${FILLED} ${FILLED_DISABLED}`,
        /** @deprecated No call sites; renders `default` until F2b removes it. */
        success: `${FILLED} ${FILLED_DISABLED}`,
        /** @deprecated No call sites; renders `default` until F2b removes it. */
        warning: `${FILLED} ${FILLED_DISABLED}`,
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-list",
        lg: "h-12 rounded-lg px-6 text-title",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Busy: `aria-busy` and `aria-disabled`, clicks ignored, focus kept; the
   * label keeps its width under the shared Spinner. With `asChild`, marks
   * the child busy and unavailable but leaves its content intact.
   */
  loading?: boolean;
}

/**
 * Activation callbacks, not every event: keep focus/blur, hover, movement,
 * context menus and unrelated keys. Apply the same policy before Slot can
 * compose a child's callback ahead of Button's.
 */
const ACTIVATION_HANDLERS = [
  "onClick", "onClickCapture", "onDoubleClick", "onDoubleClickCapture", "onAuxClick", "onAuxClickCapture",
  "onMouseDown", "onMouseDownCapture", "onMouseUp", "onMouseUpCapture",
  "onPointerDown", "onPointerDownCapture", "onPointerUp", "onPointerUpCapture",
  "onTouchStart", "onTouchStartCapture", "onTouchEnd", "onTouchEndCapture",
  "onSubmit", "onSubmitCapture",
] as const satisfies readonly (keyof React.DOMAttributes<Element>)[];
const KEY_HANDLERS = ["onKeyDown", "onKeyDownCapture", "onKeyUp", "onKeyUpCapture", "onKeyPress", "onKeyPressCapture"] as const;

/** Cancel activation defaults, never key propagation (window shortcuts need it). */
function inactiveHandlers<T extends Element>(props: React.DOMAttributes<T>, menuTrigger: boolean): React.DOMAttributes<T> {
  const filtered = { ...props };
  for (const name of ACTIVATION_HANDLERS) filtered[name] = undefined;
  for (const name of KEY_HANDLERS) {
    filtered[name] = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        return;
      }
      // Radix's composed opening handler respects defaultPrevented. The
      // caller still receives arrows, and the key still reaches the window.
      if (menuTrigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) event.preventDefault();
      props[name]?.(event);
    };
  }
  return filtered;
}

/** Stop navigation/submission and ancestor clicks, without cancelling pointer focus. */
const ignoreActivation = (event: React.SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const ariaDisabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
    // Loading also makes a Slot child unavailable, but never replaces its content.
    const inert = ariaDisabled || loading;
    const child = asChild && React.isValidElement<React.HTMLAttributes<Element>>(children) ? children : null;
    const popup = props["aria-haspopup"] ?? child?.props["aria-haspopup"];
    const menuTrigger = popup === "menu" || popup === true || popup === "true";
    const handlers = inert ? inactiveHandlers(props, menuTrigger) : props;
    const content = inert && child ? React.cloneElement(child, inactiveHandlers(child.props, menuTrigger)) : children;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), loading && !asChild && "relative", className)}
        disabled={disabled}
        {...handlers}
        aria-disabled={inert ? true : props["aria-disabled"]}
        aria-busy={loading ? true : props["aria-busy"]}
        data-disabled={(disabled || ariaDisabled) && !loading ? "" : undefined}
        data-loading={loading ? "" : undefined}
        onClickCapture={inert ? ignoreActivation : props.onClickCapture}
        onDoubleClickCapture={inert ? ignoreActivation : props.onDoubleClickCapture}
        onAuxClickCapture={inert ? ignoreActivation : props.onAuxClickCapture}
        onSubmitCapture={inert ? ignoreActivation : props.onSubmitCapture}
      >
        {loading && !asChild ? (
          <>
            {/* Inherits the button's flex direction, wrap, gap and alignment: as wide and tall as the parts without it. */}
            <span
              data-slot="button-label"
              className="inline-flex opacity-0 [flex-flow:inherit] [gap:inherit] [place-content:inherit] [place-items:inherit]"
            >
              {children}
            </span>
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner decorative />
            </span>
          </>
        ) : (
          content
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
