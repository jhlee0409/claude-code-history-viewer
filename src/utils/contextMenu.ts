export type Boundary = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

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
