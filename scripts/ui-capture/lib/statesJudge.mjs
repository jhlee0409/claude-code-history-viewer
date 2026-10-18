// Visible-change judgement shared by `ui:states` and the focusVisible probe:
// two crops of the same control (e.g. focused vs. blurred, hover vs. rest)
// differ visibly when more than VISIBLE_FRACTION of their pixels change by
// more than CHANNEL_DELTA in some RGB channel. Ported from the gap audit's
// statesLib (scratch/visual-audit/gaps/scripts/statesLib.mjs), where 24
// levels separated a real ring/hover from anti-aliasing noise.

import { PNG } from "pngjs";

export const CHANNEL_DELTA = 24;
export const VISIBLE_FRACTION = 0.002;

const decode = (buffer) => (buffer instanceof PNG ? buffer : PNG.sync.read(buffer));

/** Pixel difference of two PNGs (Buffers or decoded PNGs), compared over the common area. */
export function pixelChange(a, b) {
  const A = decode(a);
  const B = decode(b);
  const width = Math.min(A.width, B.width);
  const height = Math.min(A.height, B.height);
  let changed = 0;
  let maxDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (A.width * y + x) * 4;
      const j = (B.width * y + x) * 4;
      const d = Math.max(Math.abs(A.data[i] - B.data[j]), Math.abs(A.data[i + 1] - B.data[j + 1]), Math.abs(A.data[i + 2] - B.data[j + 2]));
      if (d > CHANNEL_DELTA) changed += 1;
      if (d > maxDelta) maxDelta = d;
    }
  }
  const area = width * height;
  return {
    changedPx: changed,
    fraction: area > 0 ? changed / area : 0,
    maxDelta,
    sizeMismatch: A.width !== B.width || A.height !== B.height,
  };
}

/** `{ ...pixelChange, visible }`: did the state change show? 0% change → not visible. */
export function focusChange(a, b) {
  const change = pixelChange(a, b);
  return { ...change, visible: change.fraction > VISIBLE_FRACTION };
}
