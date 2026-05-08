/**
 * Coordinate helpers, pixel-set operations, and SVG path rendering.
 */

// --- Fixed constants ---
export const FINDER_ZONE = 8; // 7x7 finder pattern + 1 separator

// --- Coordinate helpers (Set<string> since JS Sets lack tuple equality) ---
// Snap to 6 decimal places to avoid IEEE 754 precision mismatches at
// exponent boundaries (e.g. 31.279999999999998 vs 31.28 when crossing 32).
export const snap = (v) => Math.round(v * 1e6) / 1e6;
export const key = (c, r) => `${snap(c)},${snap(r)}`;
export const unkey = (k) => { const i = k.indexOf(","); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };

// --- Number formatting ---

export function fmt(v) {
  if (v === Math.trunc(v)) return String(Math.trunc(v));
  // Match Python's %g: 6 significant digits, no trailing zeros
  const s = v.toPrecision(6);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

// --- Pixel-set operations ---

export function trimEdges(squares, qrSize, { left = false, right = false, top = false, bottom = false }) {
  const result = new Set();
  for (const k of squares) {
    const [c, r] = unkey(k);
    if (left && c < FINDER_ZONE) continue;
    if (right && c >= qrSize - FINDER_ZONE) continue;
    if (top && r < FINDER_ZONE) continue;
    if (bottom && r >= qrSize - FINDER_ZONE) continue;
    result.add(k);
  }
  return result;
}

export function flipVertical(squares, qrSize) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(c, qrSize - 1 - r)); }
  return result;
}

export function flipHorizontal(squares, qrSize) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(qrSize - 1 - c, r)); }
  return result;
}

export function shift(squares, dc, dr) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(c + dc, r + dr)); }
  return result;
}

export function offsetToSvg(squares, xOff, yOff) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(xOff + c, yOff + r)); }
  return result;
}

export function trimCornersDiagonal(squares, layout, trimDxGeDy) {
  const qo = layout.qrOrigin;
  const qe = qo + layout.qrSize;
  const fill = layout.fillDiagonal;
  const result = new Set();
  for (const k of squares) {
    const [x, y] = unkey(k);
    let dx = null, dy = null;
    if (x < qo && y < qo) { dx = qo - x; dy = qo - y; }
    else if (x >= qe && y < qo) { dx = x - qe + 1; dy = qo - y; }
    else if (x < qo && y >= qe) { dx = qo - x; dy = y - qe + 1; }
    else if (x >= qe && y >= qe) { dx = x - qe + 1; dy = y - qe + 1; }
    if (dx !== null) {
      if (dx === dy) {
        if (!fill) continue;
        // Alternate along diagonal: even -> horizontal, odd -> vertical
        const horizKeeps = (Math.round(dx) % 2 === 0);
        if (trimDxGeDy && !horizKeeps) continue;
        if (!trimDxGeDy && horizKeeps) continue;
      } else {
        if (trimDxGeDy && dx > dy) continue;
        if (!trimDxGeDy && dy > dx) continue;
      }
    }
    result.add(k);
  }
  return result;
}

// --- SVG path rendering (split into per-pixel-paths.mjs and contour-paths.mjs) ---

export { squaresToPath, squaresToRoundedPath } from './per-pixel-paths.mjs';
export { squaresToContourPath } from './contour-paths.mjs';
