/**
 * Inner fillet geometry — quadratic Bézier wedges at concave pixel corners.
 * Shared by per-pixel-paths.mjs (main renderer) and tip-editor.html (preview).
 */
import { fmt } from '../pixel-paths.mjs';

/**
 * Compute where a fillet endpoint meets an L-corner arc.
 * @param {number} line - grid line coordinate (y if horiz, x if vert)
 * @param {number} cx   - arc center x
 * @param {number} cy   - arc center y
 * @param {number} R    - arc radius
 * @param {number} sign - +1 or -1 to select which intersection
 * @param {boolean} isHoriz - true if line is horizontal (y=const)
 * @returns {{px: number, py: number, tx: number, ty: number}}
 */
export function findArcEdge(line, cx, cy, R, sign, isHoriz) {
  if (isHoriz) {
    const dy = line - cy;
    const dx = sign * Math.sqrt(Math.max(0, R * R - dy * dy));
    const len = Math.hypot(dx, dy);
    return { px: cx + dx, py: line, tx: dy / len, ty: -dx / len };
  } else {
    const dx = line - cx;
    const dy = sign * Math.sqrt(Math.max(0, R * R - dx * dx));
    const len = Math.hypot(dx, dy);
    return { px: line, py: cy + dy, tx: dy / len, ty: -dx / len };
  }
}

/**
 * Build the SVG path for an inner fillet given two endpoints with tangents.
 * Solves for the quadratic Bézier control point satisfying both tangent
 * constraints, with optional jiggle offset.
 * @returns {string} SVG path fragment (M...Q...L...Z)
 */
export function buildFilletPath(ax, ay, tax, tay, bx, by, tbx, tby, vx, vy, jcx = 0, jcy = 0) {
  const det = tax * (-tby) - (-tbx) * tay;
  let cpx, cpy;
  if (Math.abs(det) < 1e-10) {
    cpx = (ax + bx) / 2; cpy = (ay + by) / 2;
  } else {
    const alpha = ((bx - ax) * (-tby) - (-tbx) * (by - ay)) / det;
    cpx = ax + alpha * tax;
    cpy = ay + alpha * tay;
  }
  cpx += jcx; cpy += jcy;
  return `M${fmt(ax)},${fmt(ay)}Q${fmt(cpx)},${fmt(cpy)},${fmt(bx)},${fmt(by)}L${fmt(vx)},${fmt(vy)}Z`;
}

/**
 * Generate inner fillet SVG path at a single concave vertex.
 *
 * @param {number} vx      - vertex x coordinate
 * @param {number} vy      - vertex y coordinate
 * @param {"tl"|"tr"|"br"|"bl"} corner - which corner
 * @param {number} ri      - inner fillet radius
 * @param {object} [opts]
 * @param {number} [opts.Ra=0]  - outer arc radius of neighbor along eA edge
 * @param {number} [opts.Rb=0]  - outer arc radius of neighbor along eB edge
 * @param {number} [opts.ro=0]  - threshold; Ra/Rb > ro triggers arc intersection
 * @param {number} [opts.jcx=0] - jiggle x offset for control point
 * @param {number} [opts.jcy=0] - jiggle y offset for control point
 * @returns {string} SVG path fragment
 */
export function innerFilletAt(vx, vy, corner, ri, { Ra = 0, Rb = 0, ro = 0, jcx = 0, jcy = 0 } = {}) {
  // sx: -1 for left corners (TL, BL), +1 for right (TR, BR)
  // sy: -1 for top corners (TL, TR), +1 for bottom (BL, BR)
  const sx = (corner === "tl" || corner === "bl") ? -1 : 1;
  const sy = (corner === "tl" || corner === "tr") ? -1 : 1;

  // Edge A: on the horizontal grid line at vy ± ri
  const eA = Ra > ro
    ? findArcEdge(vy + sy * ri, vx - sx * Ra, vy + sy * (1 - Ra), Ra, sx, true)
    : { px: vx, py: vy + sy * ri, tx: 0, ty: -sy };

  // Edge B: on the vertical grid line at vx ± ri
  const eB = Rb > ro
    ? findArcEdge(vx + sx * ri, vx + sx * (1 - Rb), vy - sy * Rb, Rb, sy, false)
    : { px: vx + sx * ri, py: vy, tx: sy, ty: 0 };

  return buildFilletPath(eA.px, eA.py, eA.tx, eA.ty, eB.px, eB.py, eB.tx, eB.ty, vx, vy, jcx, jcy);
}
