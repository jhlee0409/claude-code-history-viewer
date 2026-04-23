export type Boundary = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Compute a context menu position that flips to the opposite side of the cursor
 * when it would overflow the boundary's right or bottom edge, then clamps the
 * result inside the boundary with the given padding.
 *
 * When `boundary` is null or undefined, falls back to the viewport
 * (`window.innerWidth` / `window.innerHeight`).
 *
 * Overflow policy: when the menu is larger than the boundary minus 2× padding
 * on either axis, the menu is pinned to the left/top edge and overflows the
 * opposite edge. This is intentional — pinning is preferred over hiding the
 * menu entirely.
 */
export function computeMenuPosition(
  cursor: { x: number; y: number },
  menu: { width: number; height: number },
  boundary?: Boundary | null,
  padding = 8,
): { x: number; y: number } {
  const b: Boundary = boundary ?? {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };

  let x = cursor.x;
  let y = cursor.y;

  if (x + menu.width > b.right - padding) {
    x = cursor.x - menu.width;
  }
  if (y + menu.height > b.bottom - padding) {
    y = cursor.y - menu.height;
  }

  x = Math.max(b.left + padding, Math.min(x, b.right - menu.width - padding));
  y = Math.max(b.top + padding, Math.min(y, b.bottom - menu.height - padding));

  return { x, y };
}
