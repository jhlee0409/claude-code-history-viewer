/**
 * Button state contract (inner-UI plan F2a, G-ST1 · ST4 · ST5 · ST6).
 *
 * - F2b renames the filled default to primary and removes unused aliases.
 * - Keyboard focus is the base ring: no variant opts out (`outline-none`).
 * - Hover is one step, pressed one more, and nothing changes size (no
 *   `scale-*`). How far each step moves and that labels stay readable on it
 *   is computed per theme in `src/test/primitiveStates.contrast.test.ts`;
 *   that the steps show on screen is `pnpm ui:states`.
 * - `aria-disabled="true"` looks exactly like `disabled` but stays in the
 *   tab order, and no press does anything (with `asChild` too: the child's
 *   own handlers do not run). The table below holds every press handler and
 *   the activation keys' key handlers, the Button's and an `asChild` link's
 *   or submit button's, aria-disabled and loading, against an enabled
 *   control; focus, hover and the other keys still run.
 * - `loading` is busy (`aria-busy`) and unavailable (`aria-disabled`), keeps
 *   its name and its size (the label stays in the layout, invisible, under
 *   the shared Spinner) and keeps focus. jsdom cannot measure, so the size
 *   (also with the caller's own gap, padding or direction, and a wrapping
 *   label) is measured in real WebKit and Chromium by
 *   scripts/ui-capture/test/primitives.states.test.mjs, which also presses
 *   the probes with a real mouse, touch and keyboard.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, buttonVariants, type ButtonProps } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

afterEach(cleanup);

const VARIANTS = ["primary", "destructive", "outline", "secondary", "ghost", "link"] as const;
const SIZES = ["default", "sm", "lg", "icon", "icon-sm", "icon-lg"] as const;

const classesOf = (variant: (typeof VARIANTS)[number], size: (typeof SIZES)[number] = "default") =>
  buttonVariants({ variant, size }).split(/\s+/).filter(Boolean);

describe("Button variants and sizes", () => {
  it("supports the six F2b variants and every existing size", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) expect(classesOf(variant, size).length, `${variant}/${size}`).toBeGreaterThan(0);
    }
  });

  it("never switches the focus ring off and never scales", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const classes = classesOf(variant, size);
        expect(classes.filter((c) => /(^|:)outline-(none|hidden)$/.test(c)), `${variant}/${size}`).toEqual([]);
        expect(classes.filter((c) => /(^|:)-?scale-/.test(c)), `${variant}/${size}`).toEqual([]);
      }
    }
  });

  it("gives every variant a hover step and a pressed step", () => {
    for (const variant of VARIANTS) {
      const classes = classesOf(variant);
      expect(classes.some((c) => c.startsWith("hover:")), `${variant} hover`).toBe(true);
      expect(classes.some((c) => c.startsWith("active:")), `${variant} pressed`).toBe(true);
    }
  });

  it("casts no shadow (a button sits in the flow)", () => {
    for (const variant of VARIANTS) expect(classesOf(variant).filter((c) => /(^|:)shadow(-|$)/.test(c)), variant).toEqual([]);
  });
});

describe("aria-disabled", () => {
  it("looks exactly like disabled", () => {
    render(
      <>
        {VARIANTS.map((variant) => (
          <div key={variant}>
            <Button variant={variant} disabled>
              {`${variant} native`}
            </Button>
            <Button variant={variant} aria-disabled="true">
              {`${variant} aria`}
            </Button>
          </div>
        ))}
      </>,
    );
    for (const variant of VARIANTS) {
      const native = screen.getByRole("button", { name: `${variant} native` });
      const aria = screen.getByRole("button", { name: `${variant} aria` });
      expect(native).toHaveAttribute("data-disabled");
      expect(aria).toHaveAttribute("data-disabled");
      expect(aria.className, variant).toBe(native.className);
    }
  });

  it("stays in the tab order and keeps focus", () => {
    render(<Button aria-disabled="true">Restore</Button>);
    const button = screen.getByRole("button", { name: "Restore" });
    expect(button).not.toBeDisabled();
    expect(button.tabIndex).toBe(0);
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
  });

  it("ignores click, pointer down (also in the capture phase), Enter and Space, and does not submit its form", () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onKeyDown = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" aria-disabled onClick={onClick} onPointerDown={onPointerDown} onPointerDownCapture={onPointerDown} onKeyDown={onKeyDown}>
          Send
        </Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Send" });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    expect(onClick).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["Enter", " ", "ArrowDown"])("does not open a menu it triggers with %j (the same trigger without it does)", (key) => {
    const menu = (ariaDisabled: boolean) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-disabled={ariaDisabled || undefined}>More</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Open</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const { unmount } = render(menu(true));
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key });
    fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.queryByRole("menu")).toBeNull();
    unmount();

    render(menu(false));
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("an enabled button still handles everything", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).not.toHaveAttribute("data-disabled");
    expect(button).not.toHaveAttribute("aria-disabled");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("aria-disabled with asChild", () => {
  // Slot runs the child's own handlers before Button's: the child's click,
  // pointer-down and activation keys must not run either.
  it("runs none of the child's click, pointer down (also in the capture phase), Enter or Space handlers and does not submit its form", () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onKeyDown = vi.fn();
    const onAncestorClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <div onClick={onAncestorClick}>
        <form onSubmit={onSubmit}>
          <Button asChild aria-disabled>
            <a href="#restore" onClick={onClick} onPointerDown={onPointerDown} onPointerDownCapture={onPointerDown} onKeyDown={onKeyDown}>
              Restore
            </a>
          </Button>
          <Button asChild aria-disabled="true">
            <button type="submit" onClick={onClick} onPointerDown={onPointerDown} onPointerDownCapture={onPointerDown} onKeyDown={onKeyDown}>
              Send
            </button>
          </Button>
        </form>
      </div>,
    );
    for (const control of [screen.getByRole("link", { name: "Restore" }), screen.getByRole("button", { name: "Send" })]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      fireEvent.pointerDown(control);
      fireEvent.click(control);
      fireEvent.keyDown(control, { key: "Enter" });
      fireEvent.keyDown(control, { key: " " });
    }
    expect(onClick).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onAncestorClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still passes the child other keys (as without asChild)", () => {
    const onKeyDown = vi.fn();
    render(
      <Button asChild aria-disabled>
        <a href="#restore" onKeyDown={onKeyDown}>
          Restore
        </a>
      </Button>,
    );
    fireEvent.keyDown(screen.getByRole("link", { name: "Restore" }), { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("an enabled asChild child still handles click and keys", () => {
    const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const onKeyDown = vi.fn();
    render(
      <Button asChild>
        <a href="#open" onClick={onClick} onKeyDown={onKeyDown}>
          Open
        </a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).not.toHaveAttribute("aria-disabled");
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

/*
 * The inactive guard, table-driven: aria-disabled or loading, a Button and
 * an `asChild` link or submit button run none of the handlers of a press,
 * their own or the child's, and none of their key handlers for the
 * activation keys (Enter, Space). Focus, hover and the other keys (arrows
 * too, on a button that opens no popup) still run. Each row renders the
 * control with that one handler as a spy on the Button and on the child,
 * and fires the event behind it; an enabled control runs every row once.
 */
type Fire = (el: HTMLElement) => void;
type Row = [name: string, handler: string, fire: Fire];

const auxClick: Fire = (el) => fireEvent(el, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
const KEY_EVENTS = { onKeyDown: "keyDown", onKeyDownCapture: "keyDown", onKeyUp: "keyUp", onKeyUpCapture: "keyUp", onKeyPress: "keyPress", onKeyPressCapture: "keyPress" } as const;
const CHAR_CODES: Record<string, number> = { Enter: 13, " ": 32, a: 97 };
const keyRow = (handler: keyof typeof KEY_EVENTS, key: string): Row => [
  `${handler} ${key === " " ? "Space" : key}`,
  handler,
  (el) => fireEvent[KEY_EVENTS[handler]](el, { key, charCode: CHAR_CODES[key] ?? 0, keyCode: CHAR_CODES[key] ?? 0 }),
];
const KEY_HANDLERS = Object.keys(KEY_EVENTS) as (keyof typeof KEY_EVENTS)[];

/** What an inactive Button holds back. */
const HELD_BACK: Row[] = [
  ...(
    [
      ["onClick", (el) => fireEvent.click(el)],
      ["onClickCapture", (el) => fireEvent.click(el)],
      ["onDoubleClick", (el) => fireEvent.doubleClick(el)],
      ["onDoubleClickCapture", (el) => fireEvent.doubleClick(el)],
      ["onAuxClick", auxClick],
      ["onAuxClickCapture", auxClick],
      ["onMouseDown", (el) => fireEvent.mouseDown(el)],
      ["onMouseDownCapture", (el) => fireEvent.mouseDown(el)],
      ["onMouseUp", (el) => fireEvent.mouseUp(el)],
      ["onMouseUpCapture", (el) => fireEvent.mouseUp(el)],
      ["onPointerDown", (el) => fireEvent.pointerDown(el)],
      ["onPointerDownCapture", (el) => fireEvent.pointerDown(el)],
      ["onPointerUp", (el) => fireEvent.pointerUp(el)],
      ["onPointerUpCapture", (el) => fireEvent.pointerUp(el)],
      ["onTouchStart", (el) => fireEvent.touchStart(el)],
      ["onTouchStartCapture", (el) => fireEvent.touchStart(el)],
      ["onTouchEnd", (el) => fireEvent.touchEnd(el)],
      ["onTouchEndCapture", (el) => fireEvent.touchEnd(el)],
      ["onSubmit", (el) => fireEvent.submit(el)],
      ["onSubmitCapture", (el) => fireEvent.submit(el)],
    ] as [string, Fire][]
  ).map(([handler, fire]): Row => [handler, handler, fire]),
  ...KEY_HANDLERS.flatMap((handler) => [keyRow(handler, "Enter"), keyRow(handler, " ")]),
];

/** What an inactive Button still runs. */
const KEPT: Row[] = [
  ...(
    [
      ["onFocus", (el) => fireEvent.focus(el)],
      ["onBlur", (el) => fireEvent.blur(el)],
      ["onMouseEnter", (el) => fireEvent.mouseEnter(el)],
      ["onMouseLeave", (el) => fireEvent.mouseLeave(el)],
      ["onMouseMove", (el) => fireEvent.mouseMove(el)],
      ["onPointerEnter", (el) => fireEvent.pointerEnter(el)],
      ["onPointerLeave", (el) => fireEvent.pointerLeave(el)],
      ["onPointerMove", (el) => fireEvent.pointerMove(el)],
      ["onContextMenu", (el) => fireEvent.contextMenu(el)],
    ] as [string, Fire][]
  ).map(([handler, fire]): Row => [handler, handler, fire]),
  ...KEY_HANDLERS.map((handler) => keyRow(handler, "a")),
  keyRow("onKeyDown", "ArrowDown"),
  keyRow("onKeyDown", "ArrowUp"),
  keyRow("onKeyDown", "Escape"),
];

const MODES = ["Button", "asChild link", "asChild submit"] as const;
type Mode = (typeof MODES)[number];
const INERT: Record<string, ButtonProps> = { "aria-disabled": { "aria-disabled": true }, loading: { loading: true } };

/** Calls of `handler` on the Button (and the child) after `fire` at the rendered control. */
function callsOf(mode: Mode, state: ButtonProps, [, handler, fire]: Row) {
  const own = vi.fn();
  const child = vi.fn();
  const { container, unmount } = render(
    <form onSubmit={(event) => event.preventDefault()}>
      {mode === "Button" ? (
        <Button type="submit" {...state} {...{ [handler]: own }}>
          Go
        </Button>
      ) : (
        <Button asChild {...state} {...{ [handler]: own }}>
          {mode === "asChild link" ? (
            <a href="#go" {...{ [handler]: child }}>
              Go
            </a>
          ) : (
            <button type="submit" {...{ [handler]: child }}>
              Go
            </button>
          )}
        </Button>
      )}
    </form>,
  );
  fire(container.querySelector<HTMLElement>("a, button")!);
  unmount();
  return mode === "Button" ? { button: own.mock.calls.length } : { button: own.mock.calls.length, child: child.mock.calls.length };
}

/** The rows whose calls are not `expected` (each handler called that many times), by row name. */
function deviations(mode: Mode, state: ButtonProps, rows: Row[], expected: number) {
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const calls = callsOf(mode, state, row);
    if (Object.values(calls).some((n) => n !== expected)) out[row[0]] = calls;
  }
  return out;
}

describe.each(MODES)("an inactive %s (table)", (mode) => {
  it.each(Object.keys(INERT))("%s: runs no press handler and no Enter or Space key handler, its own or its child's", (state) => {
    expect(deviations(mode, INERT[state]!, HELD_BACK, 0)).toEqual({});
  });

  it.each(Object.keys(INERT))("%s: still runs focus, hover, context menu and the other keys", (state) => {
    expect(deviations(mode, INERT[state]!, KEPT, 1)).toEqual({});
  });

  it.each(Object.keys(INERT))("%s: menu-trigger arrows still reach callbacks (opening defaults are cancelled, not key propagation)", (state) => {
    expect(deviations(mode, { ...INERT[state], "aria-haspopup": "menu" }, [keyRow("onKeyDown", "ArrowDown"), keyRow("onKeyDownCapture", "ArrowUp"), keyRow("onKeyUp", "ArrowDown")], 1)).toEqual({});
  });

  it("enabled (the control): runs every one of them once", () => {
    expect(deviations(mode, {}, [...HELD_BACK, ...KEPT], 1)).toEqual({});
  });
});

describe("loading", () => {
  it("is busy and unavailable, keeps its accessible name and stays enabled", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("data-loading");
    // Busy is not the disabled look: the variant stays.
    expect(button).not.toHaveAttribute("data-disabled");
  });

  it("keeps the label in the layout, invisible, under the shared spinner", () => {
    render(
      <Button loading>
        <svg data-testid="glyph" />
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    const label = button.querySelector<HTMLElement>('[data-slot="button-label"]');
    expect(label, "label wrapper").not.toBeNull();
    expect(label!.textContent).toBe("Save");
    expect(label!.contains(screen.getByTestId("glyph"))).toBe(true);
    expect(label!.className.split(/\s+/)).toContain("opacity-0");
    // One spinner, the shared one, hidden from assistive tech (aria-busy says it).
    const spinners = button.querySelectorAll('[data-slot="spinner"]');
    expect(spinners).toHaveLength(1);
    expect(spinners[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(button.querySelector('[role="status"]')).toBeNull();
  });

  it("renders no wrapper or spinner when idle", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.querySelector('[data-slot="button-label"]')).toBeNull();
    expect(button.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("ignores clicks while busy and keeps keyboard focus when it starts", () => {
    const save = vi.fn();
    function Saving() {
      const [busy, setBusy] = useState(false);
      return (
        <Button
          loading={busy}
          onClick={() => {
            save();
            setBusy(true);
          }}
        >
          Save
        </Button>
      );
    }
    render(<Saving />);
    const button = screen.getByRole("button", { name: "Save" });
    act(() => button.focus());
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    // Still the same, enabled element with focus: a natively disabled
    // button would drop focus to <body> in the browser.
    expect(document.activeElement).toBe(button);
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
