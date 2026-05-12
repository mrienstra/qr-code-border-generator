/**
 * Shared pixel appearance classification.
 *
 * Extracted from per-pixel-paths.mjs so both per-pixel and clean-path
 * renderers use the same authoritative source of truth for corner radii,
 * L-corner detection, inner fillets, and diagonal bridge decisions.
 *
 * Also computes a vertex map: per-grid-vertex geometry facts including
 * occupancy pattern, convex/concave classification, and resolved fillet
 * geometry (endpoints + control points) for concave vertices.
 */

import { key, fmt } from './pixel-paths.mjs';

/**
 * Classify the visual appearance of every filled pixel.
 *
 * @param {Set<string>} squares  - pixels to classify (subset of allPixels)
 * @param {Set<string>} allPixels - all filled pixels (for neighbor lookups)
 * @param {object} opts
 * @param {number} opts.ro - outer corner radius (0-0.5)
 * @param {number} opts.ri - inner fillet radius (0-0.5)
 * @param {number} opts.connectDiagonals - 0-5, diagonal bridging aggressiveness
 * @param {boolean} opts.fullLCorners - enable full-radius (r=1.0) L-corners
 * @param {boolean} opts.skipCheckerLCorners - suppress L-corners at checkerboard vertices
 * @returns {Map<string, PixelAppearance>}
 */
export function classifyPixels(squares, allPixels, opts) {
  const { ro, ri, connectDiagonals = 0, fullLCorners = false, skipCheckerLCorners = false } = opts;
  const map = new Map();

  for (const k of squares) {
    const i = k.indexOf(",");
    const x = Number(k.slice(0, i)), y = Number(k.slice(i + 1));

    // Cardinal neighbors
    const hasL = allPixels.has(key(x - 1, y));
    const hasR = allPixels.has(key(x + 1, y));
    const hasU = allPixels.has(key(x, y - 1));
    const hasD = allPixels.has(key(x, y + 1));

    // Diagonal neighbors
    const hasTL = allPixels.has(key(x - 1, y - 1));
    const hasTR = allPixels.has(key(x + 1, y - 1));
    const hasBR = allPixels.has(key(x + 1, y + 1));
    const hasBL = allPixels.has(key(x - 1, y + 1));

    // Diagonal bridge decisions
    const remCurrent = (hasL ? 1 : 0) + (hasR ? 1 : 0) + (hasU ? 1 : 0) + (hasD ? 1 : 0);
    let diagTL = false, diagTR = false, diagBR = false, diagBL = false;
    if (connectDiagonals > 0) {
      const threshold = connectDiagonals - 1;
      const tFloor = Math.floor(threshold);
      const frac = threshold - tFloor;
      function shouldConnect(remOther, vx, vy) {
        const sum = remCurrent + remOther;
        if (sum <= tFloor) return true;
        if (frac > 0 && sum === tFloor + 1) {
          return ((vx * 3 + vy * 7) % 4) < (frac * 4);
        }
        return false;
      }
      if (!hasL && !hasU && hasTL) {
        const rem = (allPixels.has(key(x - 2, y - 1)) ? 1 : 0) + (allPixels.has(key(x - 1, y - 2)) ? 1 : 0);
        diagTL = shouldConnect(rem, x, y);
      }
      if (!hasR && !hasU && hasTR) {
        const rem = (allPixels.has(key(x + 2, y - 1)) ? 1 : 0) + (allPixels.has(key(x + 1, y - 2)) ? 1 : 0);
        diagTR = shouldConnect(rem, x + 1, y);
      }
      if (!hasR && !hasD && hasBR) {
        const rem = (allPixels.has(key(x + 2, y + 1)) ? 1 : 0) + (allPixels.has(key(x + 1, y + 2)) ? 1 : 0);
        diagBR = shouldConnect(rem, x + 1, y + 1);
      }
      if (!hasL && !hasD && hasBL) {
        const rem = (allPixels.has(key(x - 2, y + 1)) ? 1 : 0) + (allPixels.has(key(x - 1, y + 2)) ? 1 : 0);
        diagBL = shouldConnect(rem, x, y + 1);
      }
    }

    // Corner rounding: rounded when both adjacent cardinals absent
    // and no diagonal bridge suppresses it.
    const tlRounded = ro > 0 && !hasL && !hasU && !diagTL;
    const trRounded = ro > 0 && !hasR && !hasU && !diagTR;
    const brRounded = ro > 0 && !hasR && !hasD && !diagBR;
    const blRounded = ro > 0 && !hasL && !hasD && !diagBL;

    // Corner radii (default to ro, upgrade to 1.0 for L-corners)
    let tlR = ro, trR = ro, brR = ro, blR = ro;
    if (fullLCorners && ro > 0) {
      if (tlRounded && hasR && hasD && !(skipCheckerLCorners && hasTL)) tlR = 1;
      if (trRounded && hasL && hasD && !(skipCheckerLCorners && hasTR)) trR = 1;
      if (brRounded && hasL && hasU && !(skipCheckerLCorners && hasBR)) brR = 1;
      if (blRounded && hasR && hasU && !(skipCheckerLCorners && hasBL)) blR = 1;
    }

    // Inner fillets: concave vertex where diagonal is absent but
    // both adjacent cardinals are present.
    const filletTL = hasL && hasU && !hasTL;
    const filletTR = hasR && hasU && !hasTR;
    const filletBR = hasR && hasD && !hasBR;
    const filletBL = hasL && hasD && !hasBL;

    map.set(k, {
      x, y,
      corners: {
        tl: { rounded: tlRounded, radius: tlR },
        tr: { rounded: trRounded, radius: trR },
        br: { rounded: brRounded, radius: brR },
        bl: { rounded: blRounded, radius: blR },
      },
      innerFillets: { tl: filletTL, tr: filletTR, br: filletBR, bl: filletBL },
      diagBridges: { tl: diagTL, tr: diagTR, br: diagBR, bl: diagBL },
    });
  }

  return map;
}

// Arc-line intersection: find where a unit circle at (cx, cy) intersects
// a horizontal line (isHoriz=true, y=lineCoord) or vertical line (isHoriz=false, x=lineCoord).
// sign picks which of the two intersection points to return.
// Returns { px, py, tx, ty } — position and tangent at intersection.
function arcLineIntersect(cx, cy, R, lineCoord, isHoriz, sign) {
  if (isHoriz) {
    const dy = lineCoord - cy;
    const dx = sign * Math.sqrt(Math.max(0, R * R - dy * dy));
    const len = Math.hypot(dx, dy);
    return { px: cx + dx, py: lineCoord, tx: dy / len, ty: -dx / len };
  } else {
    const dx = lineCoord - cx;
    const dy = sign * Math.sqrt(Math.max(0, R * R - dx * dx));
    const len = Math.hypot(dx, dy);
    return { px: lineCoord, py: cy + dy, tx: dy / len, ty: -dx / len };
  }
}

// Solve for quadratic Bezier control point given two endpoints with tangents.
// eA tangent points toward cp; eB tangent points away from cp.
function filletControlPoint(eA, eB) {
  const det = eA.tx * (-eB.ty) - (-eB.tx) * eA.ty;
  if (Math.abs(det) < 1e-10) {
    return { x: (eA.px + eB.px) / 2, y: (eA.py + eB.py) / 2 };
  }
  const alpha = ((eB.px - eA.px) * (-eB.ty) - (-eB.tx) * (eB.py - eA.py)) / det;
  return { x: eA.px + alpha * eA.tx, y: eA.py + alpha * eA.ty };
}

/**
 * Compute vertex-level geometry facts for every grid vertex adjacent to
 * filled pixels.
 *
 * @param {Map<string, PixelAppearance>} pixelMap - from classifyPixels
 * @param {Set<string>} allPixels - all filled pixels
 * @param {object} opts - { ro, ri }
 * @returns {Map<string, VertexInfo>}
 */
export function computeVertexMap(pixelMap, allPixels, opts) {
  const { ro, ri } = opts;
  const vmap = new Map();

  // Collect all vertices touched by filled pixels.
  // Each pixel (x,y) touches four vertices: (x,y), (x+1,y), (x+1,y+1), (x,y+1).
  const vertexSet = new Set();
  for (const [, info] of pixelMap) {
    const { x, y } = info;
    vertexSet.add(key(x, y));
    vertexSet.add(key(x + 1, y));
    vertexSet.add(key(x + 1, y + 1));
    vertexSet.add(key(x, y + 1));
  }

  for (const vk of vertexSet) {
    const ci = vk.indexOf(",");
    const vx = Number(vk.slice(0, ci)), vy = Number(vk.slice(ci + 1));

    // Four quadrant pixels
    const nwKey = key(vx - 1, vy - 1), neKey = key(vx, vy - 1);
    const seKey = key(vx, vy), swKey = key(vx - 1, vy);
    const nw = pixelMap.get(nwKey), ne = pixelMap.get(neKey);
    const se = pixelMap.get(seKey), sw = pixelMap.get(swKey);
    const filledCount = (nw ? 1 : 0) + (ne ? 1 : 0) + (se ? 1 : 0) + (sw ? 1 : 0);

    const isDiag = filledCount === 2 &&
      ((nw && se && !ne && !sw) || (ne && sw && !nw && !se));

    let pattern;
    if (filledCount === 0) pattern = "empty";
    else if (filledCount === 4) pattern = "full";
    else if (filledCount === 1) pattern = "convex";
    else if (filledCount === 3) pattern = "concave";
    else if (isDiag) pattern = "checkerboard";
    else pattern = "edge";

    const entry = {
      vx, vy, filledCount, pattern,
      occupancy: { nw: !!nw, ne: !!ne, se: !!se, sw: !!sw },
      convex: null,
      concave: null,
      checkerboard: null,
    };

    // --- Convex vertex (filled=1): record which pixel corner ---
    if (pattern === "convex") {
      let px, corner, radius, rounded;
      if (nw) { px = nw; corner = "br"; }
      else if (ne) { px = ne; corner = "bl"; }
      else if (se) { px = se; corner = "tl"; }
      else { px = sw; corner = "tr"; }
      rounded = px.corners[corner].rounded;
      radius = rounded ? px.corners[corner].radius : 0;
      const isLCorner = rounded && radius === 1;
      entry.convex = {
        pixelKey: key(px.x, px.y), corner, radius, rounded,
        isLCorner,
        lcDir: isLCorner ? corner.toUpperCase() : null,
      };
    }

    // --- Checkerboard vertex (filled=2, diagonal) ---
    if (pattern === "checkerboard") {
      const diagType = (ne && sw) ? "NE-SW" : "NW-SE";
      const owners = [];
      // Each diagonal pixel has a corner at this vertex
      if (diagType === "NE-SW") {
        const neCorner = ne.corners.bl;
        owners.push({
          pixelKey: neKey, corner: "bl",
          radius: neCorner.rounded ? neCorner.radius : 0,
          isLCorner: neCorner.rounded && neCorner.radius === 1,
        });
        const swCorner = sw.corners.tr;
        owners.push({
          pixelKey: swKey, corner: "tr",
          radius: swCorner.rounded ? swCorner.radius : 0,
          isLCorner: swCorner.rounded && swCorner.radius === 1,
        });
      } else {
        const nwCorner = nw.corners.br;
        owners.push({
          pixelKey: nwKey, corner: "br",
          radius: nwCorner.rounded ? nwCorner.radius : 0,
          isLCorner: nwCorner.rounded && nwCorner.radius === 1,
        });
        const seCorner = se.corners.tl;
        owners.push({
          pixelKey: seKey, corner: "tl",
          radius: seCorner.rounded ? seCorner.radius : 0,
          isLCorner: seCorner.rounded && seCorner.radius === 1,
        });
      }

      // Check if a diagonal bridge is active at this vertex.
      // A bridge exists when either filled pixel has a diagBridge pointing here.
      let bridged = false;
      if (diagType === "NE-SW") {
        bridged = (ne?.diagBridges?.bl || false) || (sw?.diagBridges?.tr || false);
      } else {
        bridged = (nw?.diagBridges?.br || false) || (se?.diagBridges?.tl || false);
      }

      // Bridge fillets: when bridged, the two empty quadrants get inner fillets.
      let bridgeFillets = null;
      if (bridged && ri > 0) {
        if (diagType === "NE-SW") {
          // Empty quadrants: NW and SE
          bridgeFillets = [
            { quadrant: "nw",
              eA: { px: vx, py: vy - ri, tx: 0, ty: 1 },
              eB: { px: vx - ri, py: vy, tx: -1, ty: 0 },
              cp: { x: vx, y: vy } },
            { quadrant: "se",
              eA: { px: vx, py: vy + ri, tx: 0, ty: -1 },
              eB: { px: vx + ri, py: vy, tx: 1, ty: 0 },
              cp: { x: vx, y: vy } },
          ];
        } else {
          // Empty quadrants: NE and SW
          bridgeFillets = [
            { quadrant: "ne",
              eA: { px: vx, py: vy - ri, tx: 0, ty: 1 },
              eB: { px: vx + ri, py: vy, tx: -1, ty: 0 },
              cp: { x: vx, y: vy } },
            { quadrant: "sw",
              eA: { px: vx, py: vy + ri, tx: 0, ty: -1 },
              eB: { px: vx - ri, py: vy, tx: 1, ty: 0 },
              cp: { x: vx, y: vy } },
          ];
        }
      }

      // Flag: both owners are L-corners → hole boundaries need arc transitions here
      const lcTransition = !bridged && owners.every(o => o.isLCorner);

      // Pre-compute arc centers for lcTransition owners.
      // The arc center for an L-corner is at the diagonally opposite corner of the pixel.
      if (lcTransition) {
        for (const owner of owners) {
          const ci = owner.pixelKey.indexOf(",");
          const px = Number(owner.pixelKey.slice(0, ci));
          const py = Number(owner.pixelKey.slice(ci + 1));
          if (owner.corner === "tl") owner.arcCenter = { x: px + 1, y: py + 1 };
          else if (owner.corner === "tr") owner.arcCenter = { x: px, y: py + 1 };
          else if (owner.corner === "br") owner.arcCenter = { x: px, y: py };
          else if (owner.corner === "bl") owner.arcCenter = { x: px + 1, y: py };
        }
      }

      entry.checkerboard = { diagType, owners, bridged, bridgeFillets, lcTransition };
    }

    // --- Concave vertex (filled=3): resolved fillet geometry ---
    if (pattern === "concave" && ri > 0) {
      const absent = !nw ? "nw" : !ne ? "ne" : !se ? "se" : "sw";

      // For each absent quadrant, determine which two adjacent pixels
      // might have L-corner arcs that pass through this vertex.
      // The corner name matches the absent quadrant (nw→tl, ne→tr, se→br, sw→bl).
      // "pixA" is adjacent to absent along a horizontal boundary,
      // "pixB" is adjacent to absent along a vertical boundary.
      let pixA, pixB, cornerName;
      let findEdgeAParams, findEdgeBParams;
      let stdA, stdB;

      if (absent === "nw") {
        cornerName = "tl";
        pixA = ne; pixB = sw;
        const Ra = pixA ? (pixA.corners[cornerName].rounded ? pixA.corners[cornerName].radius : 0) : 0;
        const Rb = pixB ? (pixB.corners[cornerName].rounded ? pixB.corners[cornerName].radius : 0) : 0;
        stdA = { px: vx, py: vy - ri, tx: 0, ty: 1 };
        stdB = { px: vx - ri, py: vy, tx: -1, ty: 0 };
        const eA = Ra > ro
          ? arcLineIntersect(vx + Ra, vy - 1 + Ra, Ra, vy - ri, true, -1)
          : stdA;
        const eB = Rb > ro
          ? arcLineIntersect(vx - 1 + Rb, vy + Rb, Rb, vx - ri, false, -1)
          : stdB;
        const cp = filletControlPoint(eA, eB);
        entry.concave = { absent, eA, eB, cp, aOnArc: Ra > ro, bOnArc: Rb > ro };
      } else if (absent === "ne") {
        cornerName = "tr";
        pixA = nw; pixB = se;
        const Ra = pixA ? (pixA.corners[cornerName].rounded ? pixA.corners[cornerName].radius : 0) : 0;
        const Rb = pixB ? (pixB.corners[cornerName].rounded ? pixB.corners[cornerName].radius : 0) : 0;
        stdA = { px: vx, py: vy - ri, tx: 0, ty: 1 };
        stdB = { px: vx + ri, py: vy, tx: -1, ty: 0 };
        const eA = Ra > ro
          ? arcLineIntersect(vx - Ra, vy - 1 + Ra, Ra, vy - ri, true, +1)
          : stdA;
        const eB = Rb > ro
          ? arcLineIntersect(vx + 1 - Rb, vy + Rb, Rb, vx + ri, false, -1)
          : stdB;
        const cp = filletControlPoint(eA, eB);
        entry.concave = { absent, eA, eB, cp, aOnArc: Ra > ro, bOnArc: Rb > ro };
      } else if (absent === "se") {
        cornerName = "br";
        pixA = sw; pixB = ne;
        const Ra = pixA ? (pixA.corners[cornerName].rounded ? pixA.corners[cornerName].radius : 0) : 0;
        const Rb = pixB ? (pixB.corners[cornerName].rounded ? pixB.corners[cornerName].radius : 0) : 0;
        stdA = { px: vx, py: vy + ri, tx: 0, ty: -1 };
        stdB = { px: vx + ri, py: vy, tx: 1, ty: 0 };
        const eA = Ra > ro
          ? arcLineIntersect(vx - Ra, vy + 1 - Ra, Ra, vy + ri, true, +1)
          : stdA;
        const eB = Rb > ro
          ? arcLineIntersect(vx + 1 - Rb, vy - Rb, Rb, vx + ri, false, +1)
          : stdB;
        const cp = filletControlPoint(eA, eB);
        entry.concave = { absent, eA, eB, cp, aOnArc: Ra > ro, bOnArc: Rb > ro };
      } else { // absent === "sw"
        cornerName = "bl";
        pixA = se; pixB = nw;
        const Ra = pixA ? (pixA.corners[cornerName].rounded ? pixA.corners[cornerName].radius : 0) : 0;
        const Rb = pixB ? (pixB.corners[cornerName].rounded ? pixB.corners[cornerName].radius : 0) : 0;
        stdA = { px: vx, py: vy + ri, tx: 0, ty: -1 };
        stdB = { px: vx - ri, py: vy, tx: 1, ty: 0 };
        const eA = Ra > ro
          ? arcLineIntersect(vx + Ra, vy + 1 - Ra, Ra, vy + ri, true, -1)
          : stdA;
        const eB = Rb > ro
          ? arcLineIntersect(vx - 1 + Rb, vy - Rb, Rb, vx - ri, false, +1)
          : stdB;
        const cp = filletControlPoint(eA, eB);
        entry.concave = { absent, eA, eB, cp, aOnArc: Ra > ro, bOnArc: Rb > ro };
      }
    } else if (pattern === "concave") {
      // ri=0: no fillet, just record which quadrant is absent
      const absent = !nw ? "nw" : !ne ? "ne" : !se ? "se" : "sw";
      entry.concave = { absent, eA: null, eB: null, cp: null, aOnArc: false, bOnArc: false };
    }

    vmap.set(vk, entry);
  }

  return vmap;
}
