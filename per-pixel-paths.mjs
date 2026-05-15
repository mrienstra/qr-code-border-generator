/**
 * Per-pixel SVG path rendering: individual pixel outlines with rounded corners.
 */

import { key, unkey, fmt } from './pixel-paths.mjs';
import { mulberry32 } from './util/prng.mjs';
import { innerFilletAt } from './util/inner-fillet.mjs';
import { ISLAND_PROFILES, buildRadialIslandPath } from './island-profiles.mjs';

// Map a normalized (u,v) point in "tip-up" space to actual pixel coords
// for any tip direction. u runs across (0=left, 1=right), v runs from
// tip (0) to base (1).
function mapTipPt(x, y, dir, u, v) {
  switch (dir) {
    case "up":    return [x + u,     y + v];
    case "down":  return [x + 1 - u, y + 1 - v];
    case "left":  return [x + v,     y + 1 - u];
    default:      return [x + 1 - v, y + u]; // right
  }
}

function fmtTipPt(x, y, dir, u, v) {
  const [px, py] = mapTipPt(x, y, dir, u, v);
  return `${fmt(px)},${fmt(py)}`;
}

// Compute Bézier control-point handle pair for a lobed-tip node.
// Replicates handlePair from buildLobedTipPath.
function tipHandle(node) {
  const pull = node.pull ?? 0;
  if (!pull) return { in: [node.x, node.y], out: [node.x, node.y] };
  const open = Math.max(-1, Math.min(1, node.open ?? 0));
  const rotate = Math.max(-1, Math.min(1, node.rotate ?? 0));
  const t = Math.abs(open), axS = open < 0 ? -1 : 1;
  const ang = -Math.PI / 2 + rotate * (Math.PI / 2);
  const ax = Math.cos(ang), ay = Math.sin(ang), lx = -ay, ly = ax;
  const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return [x / m, y / m]; };
  const [ix, iy] = norm(lx * (1 - t) + ax * axS * t, ly * (1 - t) + ay * axS * t);
  const [ox, oy] = norm(-lx * (1 - t) + ax * axS * t, -ly * (1 - t) + ay * axS * t);
  return {
    in:  [node.x + ix * pull, node.y + iy * pull],
    out: [node.x + ox * pull, node.y + oy * pull],
  };
}

// Find where horizontal line y=Y intersects a tip's edge cubic Bézier.
// Works for both simple (a/b) and lobed tips.
// Returns {px, py, tx, ty} or null if Y is in the straight stem region.
function findTipEdge(Y, params, side) {
  const base = params.base || 0;
  const s = 1 - base;
  if (Y >= s) return null;

  let seg;
  if (params.lobes) {
    const { shoulder, peak1X, peak1Y } = params;
    const pull = params.peak1Pull ?? 0, open = params.peak1Open ?? 0, rot = params.peak1Rotate ?? 0;
    if (side === "left") {
      const n = { x: 1 - peak1X, y: peak1Y, pull, open, rotate: -rot };
      const h = tipHandle(n);
      seg = [[n.x, n.y * s], [h.out[0], h.out[1] * s], [0, (1 - shoulder) * s], [0, s]];
    } else {
      const n = { x: peak1X, y: peak1Y, pull, open, rotate: rot };
      const h = tipHandle(n);
      seg = [[n.x, n.y * s], [h.in[0], h.in[1] * s], [1, (1 - shoulder) * s], [1, s]];
    }
  } else {
    const { a, b } = params;
    seg = side === "left"
      ? [[0.5, 0], [1 - b, 0], [0, a * s], [0, s]]
      : [[0.5, 0], [b, 0], [1, a * s], [1, s]];
  }

  if (Y < seg[0][1]) return null;

  const y0 = seg[0][1], y1 = seg[1][1], y2 = seg[2][1], y3 = seg[3][1];
  let t = 0.5;
  for (let i = 0; i < 20; i++) {
    const u = 1 - t;
    const By = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    const f = By - Y;
    if (Math.abs(f) < 1e-10) break;
    const dBy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
    if (Math.abs(dBy) < 1e-12) break;
    t -= f / dBy;
    t = Math.max(0.001, Math.min(0.999, t));
  }

  const u = 1 - t;
  const x0 = seg[0][0], x1 = seg[1][0], x2 = seg[2][0], x3 = seg[3][0];
  const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
  const dx = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
  const dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
  const len = Math.hypot(dx, dy);

  return { px, py: Y, tx: dx / len, ty: dy / len };
}

export function squaresToPath(squares) {
  const sorted = [...squares].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return sorted.map(([x, y]) => {
    const xf = x === Math.trunc(x) ? Math.trunc(x) : x.toFixed(1);
    const yf = y === Math.trunc(y) ? Math.trunc(y) : y.toFixed(1);
    return `M${xf},${yf}h1v1h-1z`;
  }).join(" ");
}

export const TIP_PROFILES = {
  pointed: {
    base: 0.15,
    a: 0.40,
    b: 0.49,
  },

  streamlined: {
    base: 0.00,
    a: 0.40,
    b: 0.85,
  },

  paw: {
    lobes: 3, base: 0.00, shoulder: 0.40,
    peak1X: 0.84, peak1Y: 0.14, peak1Pull: 0.16, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.66, valley1Y: 0.36, valley1Pull: 0.00, valley1Open: 0, valley1Rotate: 0,
    centerY: 0.00, centerPull: 0.19, centerOpen: 0, centerRotate: 0,
  },

  "double-paw": {
    lobes: 2, base: 0, shoulder: 0.5,
    peak1X: 0.74, peak1Y: 0, peak1Pull: 0.25,  peak1Open: 0, peak1Rotate: 0,
    centerY: 0.4, centerPull: 0,  centerOpen: 0, centerRotate: 0,
  },

  "quad-paw": {
    lobes: 4, base: 0, shoulder: 0.5,
    peak1X: 0.86, peak1Y: 0.1, peak1Pull: 0.08, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.74, valley1Y: 0.34, valley1Pull: 0.01, valley1Open: 0, valley1Rotate: 0,
    peak2X: 0.62, peak2Y: 0, peak2Pull: 0.08,  peak2Open: 0, peak2Rotate: 0,
    centerY: 0.24, centerPull: 0.01, centerOpen: 0, centerRotate: 0,
  },
  "penta-paw": {
    lobes: 5, base: 0, shoulder: 0.5,
    peak1X: 0.86, peak1Y: 0.2, peak1Pull: 0.1, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.77, valley1Y: 0.35, valley1Pull: 0.01, valley1Open: 0, valley1Rotate: 0,
    peak2X: 0.68, peak2Y: 0.1, peak2Pull: 0.1, peak2Open: 0, peak2Rotate: 0,
    valley2X: 0.59, valley2Y: 0.25, valley2Pull: 0.01, valley2Open: 0, valley2Rotate: 0,
    centerY: 0, centerPull: 0.1, centerOpen: 0, centerRotate: 0,
  },
  "hex-paw": {
    lobes: 6, base: 0, shoulder: 0.5,
    peak1X: 0.91, peak1Y: 0.2, peak1Pull: 0.08, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.83, valley1Y: 0.45, valley1Pull: 0.01, peak1Open: 0, peak1Rotate: 0,
    peak2X: 0.75, peak2Y: 0.1, peak2Pull: 0.08, peak2Open: 0, peak2Rotate: 0,
    valley2X: 0.67, valley2Y: 0.35, valley2Pull: 0.01, peak2Open: 0, peak2Rotate: 0,
    peak3X: 0.58, peak3Y: 0, peak3Pull: 0.08, peak3Open: 0, peak3Rotate: 0,
    centerY: 0.25, centerPull: 0.01, centerOpen: 0, centerRotate: 0,
  },
  "seven-paw": {
    lobes: 7, base: 0, shoulder: 0.5,
    peak1X: 0.91, peak1Y: 0.3, peak1Pull: 0.08, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.84, valley1Y: 0.45, valley1Pull: 0.01, valley1Open: 0, valley1Rotate: 0,
    peak2X: 0.78, peak2Y: 0.2, peak2Pull: 0.08, peak2Open: 0, peak2Rotate: 0,
    valley2X: 0.7, valley2Y: 0.35, valley2Pull: 0.01, valley2Open: 0, valley2Rotate: 0,
    peak3X: 0.65, peak3Y: 0.1, peak3Pull: 0.09, peak3Open: 0, peak3Rotate: 0,
    valley3X: 0.57, valley3Y: 0.25, valley3Pull: 0.01, valley3Open: 0, valley3Rotate: 0,
    centerY: 0, centerPull: 0.1, centerOpen: 0, centerRotate: 0,
  },
  claw: {
    lobes: 3, base: 0, shoulder: 0.5,
    peak1X: 0.8, peak1Y: 0.09, peak1Pull: 0.01, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.66, valley1Y: 0.31, valley1Pull: 0.01, valley1Open: 0, valley1Rotate: 0,
    centerY: 0, centerPull: 0.01, centerOpen: 0, centerRotate: 0,
  },

  "stubby-paw": {
    lobes: 3, base: 0.5, shoulder: 0.31,
    peak1X: 0.80, peak1Y: 0.25, peak1Pull: 0.12, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.66, valley1Y: 0.54, valley1Pull: 0, valley1Open: 0, valley1Rotate: 0,
    centerY: 0, centerPull: 0.19, centerOpen: 0, centerRotate: 0,
  },

  "stubby-claw": {
    lobes: 3, base: 0.5, shoulder: 0.37,
    peak1X: 0.8, peak1Y: 0.18, peak1Pull: 0.01, peak1Open: 0, peak1Rotate: 0,
    valley1X: 0.66, valley1Y: 0.61, valley1Pull: 0.01, valley1Open: 0, valley1Rotate: 0,
    centerY: 0, centerPull: 0.01, centerOpen: 0, centerRotate: 0,
  },
  "weird": {
    lobes: 3, base: 0, shoulder: 0.4, peak1X: 0.75, peak1Y: 0.15, peak1Pull: 0.49, peak1Open: -0.48, peak1Rotate: -0.18, valley1X: 0.66, valley1Y: 0.7, valley1Pull: 0, valley1Open: 0, valley1Rotate: 0, centerY: 0, centerPull: 0.57, centerOpen: -0.5, centerRotate: 0
  }
};

export function buildLobedTipPath(p, ps, profile) {
  const {
    lobes,
    shoulder,
    centerY,
    centerPull = 0,
    centerOpen = 0,
    centerRotate = 0,
  } = profile;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const normalize = (x, y) => {
    const m = Math.hypot(x, y) || 1;
    return [x / m, y / m];
  };

  function handlePair(node) {
    const pull = node.pull ?? 0;
    if (!pull) {
      return {
        in: [node.x, node.y],
        out: [node.x, node.y],
      };
    }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const normalize = (x, y) => {
      const m = Math.hypot(x, y) || 1;
      return [x / m, y / m];
    };

    const open = clamp(node.open ?? 0, -1, 1);
    const rotate = clamp(node.rotate ?? 0, -1, 1);
    const t = Math.abs(open);
    const axialSign = open < 0 ? -1 : 1;

    // Always build the local frame from the same "up" axis,
    // then use axialSign to push the handles above or below.
    const axisAngle = -Math.PI / 2 + rotate * (Math.PI / 2);

    const ax = Math.cos(axisAngle);
    const ay = Math.sin(axisAngle);

    // Stable lateral axis
    const lx = -ay;
    const ly = ax;

    // Same lateral handedness for both positive and negative open.
    // Only the axial contribution changes sign.
    let inX  =  lx * (1 - t) + ax * axialSign * t;
    let inY  =  ly * (1 - t) + ay * axialSign * t;
    let outX = -lx * (1 - t) + ax * axialSign * t;
    let outY = -ly * (1 - t) + ay * axialSign * t;

    [inX, inY] = normalize(inX, inY);
    [outX, outY] = normalize(outX, outY);

    return {
      in:  [node.x + inX * pull,  node.y + inY * pull],
      out: [node.x + outX * pull, node.y + outY * pull],
    };
  }

  const outerPeaks = Math.floor(lobes / 2);
  const preCenterValleys = Math.floor((lobes - 1) / 2);

  const rightNodes = [];

  for (let i = 1; i <= outerPeaks; i++) {
    rightNodes.push({
      x: profile[`peak${i}X`],
      y: profile[`peak${i}Y`],
      pull: profile[`peak${i}Pull`] ?? 0,
      open: profile[`peak${i}Open`] ?? 0,
      rotate: profile[`peak${i}Rotate`] ?? 0,
    });

    if (i <= preCenterValleys) {
      rightNodes.push({
        x: profile[`valley${i}X`],
        y: profile[`valley${i}Y`],
        pull: profile[`valley${i}Pull`] ?? 0,
        open: profile[`valley${i}Open`] ?? 0,
        rotate: profile[`valley${i}Rotate`] ?? 0,
      });
    }
  }

  const centerNode = {
    x: 0.5,
    y: centerY,
    pull: centerPull,
    open: centerOpen,
    rotate: centerRotate,
  };

  const leftNodes = rightNodes.slice().reverse().map((n) => ({
    x: 1 - n.x,
    y: n.y,
    pull: n.pull,
    open: n.open,
    rotate: -n.rotate,
  }));

  const nodes = [...rightNodes, centerNode, ...leftNodes].map((n) => ({
    ...n,
    ...handlePair(n),
  }));

  const rShoulder = [1, 1 - shoulder];
  const lShoulder = [0, 1 - shoulder];

  const segs = [
    `M${p(0, 1)}`,
    `L${p(1, 1)}`,
    `L${ps(1, 1)}`,
  ];

  if (nodes.length) {
    segs.push(
      `C${ps(...rShoulder)},${ps(...nodes[0].in)},${ps(nodes[0].x, nodes[0].y)}`
    );

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      segs.push(
        `C${ps(...a.out)},${ps(...b.in)},${ps(b.x, b.y)}`
      );
    }

    segs.push(
      `C${ps(...nodes[nodes.length - 1].out)},${ps(...lShoulder)},${ps(0, 1)}`
    );
  }

  segs.push(`L${p(0, 1)}z`);
  return segs.join("");
}

// Deterministic per-vertex hash for jiggle variation and style mixing
function vtxHash(vx, vy, ch = 0) {
  const s = (Math.round(vx * 1e6) * 374761393 + Math.round(vy * 1e6) * 668265263 + ch * 49979693) >>> 0;
  return mulberry32(s)();
}

// Resolve a style parameter that may be a string or a weighted mix object.
// Returns a single style name chosen deterministically per pixel.
function resolveStyle(styleParam, profiles, x, y, hashChannel) {
  if (typeof styleParam === "string") return styleParam;
  const entries = Object.entries(styleParam).filter(([n, w]) => w > 0 && profiles[n]);
  if (!entries.length) return "none";
  if (entries.length === 1) return entries[0][0];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const h = vtxHash(x + 0.5, y + 0.5, hashChannel);
  let cum = 0;
  for (const [name, weight] of entries) {
    cum += weight / total;
    if (h < cum) return name;
  }
  return entries[entries.length - 1][0];
}

export function squaresToRoundedPath(squares, allPixels, rOuter, rInner, connectDiagonals = false, diagOnly = false, jiggle = 0, fullLCorners = false, skipCheckerLCorners = false, connectDiagonalsOrder = "default", tipStyle = "none", tipBase = null, islandStyle = "none") {
  const sorted = [...squares].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  // Outer corner formatting
  const ro = rOuter;
  const rof = fmt(ro);
  const nrof = fmt(-ro);
  const af = `a${rof},${rof},0,0,1,`;
  // Inner corner formatting
  const ri = rInner;
  const rif = fmt(ri);
  const nrif = fmt(-ri);
  // --- Jiggle: organic variation ---
  // What works: per-corner arc radius variation + Bezier control point
  // offsets on inner corner / diagonal fills. Arcs meet straight edges at
  // exact H/V tangents, so no kinks. Vertex-keyed hashing ensures adjacent
  // pixels sharing a corner use the same radius -- no gaps.
  //
  // What failed: bowing straight edges with quadratic Beziers. Caused
  // (a) seams at inner corners (bowed edge != straight fill boundary),
  // (b) tangent discontinuities at arc-edge junctions (visible bumps).
  // Suppressing bows near inner corners (vertex cell-count check) fixed
  // (a) but (b) is inherent -- can't bow perpendicular and keep H/V tangent
  // with a single quadratic. Would need cubic Beziers or multi-segment
  // curves, adding complexity for marginal visual gain.
  //
  // Future: contour tracing (merge pixels into single outline loops) would
  // eliminate inner corner fills entirely and make edge effects trivial --
  // one path per connected region, no shared-edge alignment issues.
  //
  // vtxHash / resolveStyle are defined above squaresToRoundedPath
  // Two-pass mode: when fullLCorners is active with inner radius, inner fillets
  // need neighbor corner info that isn't available until all outlines are built.
  const needsTwoPass = (fullLCorners || tipStyle !== "none") && ri > 0;
  const cornerInfoMap = needsTwoPass ? new Map() : null;

  // Pre-compute tip edge data for inner fillets (once per profile, not per instance).
  // findTipEdge returns {px, py, tx, ty} in normalized up-tip space [0,1]².
  // We store these and transform to grid coords at use time via mapTipPt's Jacobian.
  const tipEdgeCache = new Map();
  if (ri > 0 && tipStyle !== "none") {
    for (const [name, profile] of Object.entries(TIP_PROFILES)) {
      const params = { ...profile, base: tipBase ?? profile.base ?? 0 };
      const left = findTipEdge(1 - ri, params, "left");
      const right = findTipEdge(1 - ri, params, "right");
      if (left || right) tipEdgeCache.set(name, { left, right });
    }
  }
  const tipDirMap = new Map();

  // Transform a pre-computed tip edge from normalized up-tip space to grid coords.
  // dir: tip orientation, tx/ty: tip pixel coords, e: normalized edge {px,py,tx,ty}
  function transformTipEdge(dir, tx, ty, e) {
    const [gx, gy] = mapTipPt(tx, ty, dir, e.px, e.py);
    // Tangent transform via mapTipPt's Jacobian (partial derivatives of [u,v]→[gx,gy])
    let gtx, gty;
    switch (dir) {
      case "up":    gtx = e.tx;  gty = e.ty;  break;
      case "down":  gtx = -e.tx; gty = -e.ty; break;
      case "left":  gtx = e.ty;  gty = -e.tx; break;
      default:      gtx = -e.ty; gty = e.tx;  break; // right
    }
    return { px: gx, py: gy, tx: gtx, ty: gty };
  }

  // Look up tip edge override for a fillet corner. Returns { eAOverride } or
  // { eBOverride } or {} depending on whether an adjacent tip affects this corner.
  // Each corner can be affected by up to 2 tip orientations:
  //   tl: "up" tip above (eA) or "left" tip to left (eB)
  //   tr: "up" tip above (eA) or "right" tip to right (eB)
  //   br: "down" tip below (eA) or "right" tip to right (eB)
  //   bl: "down" tip below (eA) or "left" tip to left (eB)
  const TIP_CORNER_CHECKS = {
    tl: [{ dk: [0, -1], dir: "up",    side: "left",  arm: "eAOverride" },
         { dk: [-1, 0], dir: "left",  side: "right", arm: "eBOverride" }],
    tr: [{ dk: [0, -1], dir: "up",    side: "right", arm: "eAOverride" },
         { dk: [1,  0], dir: "right", side: "left",  arm: "eBOverride" }],
    br: [{ dk: [0,  1], dir: "down",  side: "left",  arm: "eAOverride" },
         { dk: [1,  0], dir: "right", side: "right", arm: "eBOverride" }],
    bl: [{ dk: [0,  1], dir: "down",  side: "right", arm: "eAOverride" },
         { dk: [-1, 0], dir: "left",  side: "left",  arm: "eBOverride" }],
  };
  function tipOverride(corner, x, y) {
    const overrides = {};
    for (const { dk, dir, side, arm } of TIP_CORNER_CHECKS[corner]) {
      const tk = key(x + dk[0], y + dk[1]);
      const info = tipDirMap.get(tk);
      if (info?.dir !== dir) continue;
      const edge = tipEdgeCache.get(info.tip)?.[side];
      if (!edge) continue;
      overrides[arm] = transformTipEdge(dir, x + dk[0], y + dk[1], edge);
    }
    return overrides;
  }

  const paths = sorted.map(([x, y]) => {
    const hasL = allPixels.has(key(x - 1, y));
    const hasR = allPixels.has(key(x + 1, y));
    const hasU = allPixels.has(key(x, y - 1));
    const hasD = allPixels.has(key(x, y + 1));
    // Diagonal occupancy (used to suppress outer corner rounding)
    const hasTL = allPixels.has(key(x - 1, y - 1));
    const hasTR = allPixels.has(key(x + 1, y - 1));
    const hasBR = allPixels.has(key(x + 1, y + 1));
    const hasBL = allPixels.has(key(x - 1, y + 1));
    // Diagonal connection decisions. connectDiagonals (0-5) controls how
    // aggressively to bridge diagonal pairs. Each pair is scored by the sum
    // of remaining cardinal neighbors (0-4); lower sum = more isolated.
    // The slider value minus 1 gives the max allowed sum. Fractional steps
    // (0.25 increments) include 25/50/75% of the next sum level via a
    // deterministic hash on the vertex position.
    const remCurrent = (hasL ? 1 : 0) + (hasR ? 1 : 0) + (hasU ? 1 : 0) + (hasD ? 1 : 0);
    let diagTL = false, diagTR = false, diagBR = false, diagBL = false;
    if (connectDiagonals > 0) {
      const threshold = connectDiagonals - 1;
      const tFloor = Math.floor(threshold);
      const frac = threshold - tFloor;
      function shouldConnect(remOther, vx, vy) {
        if (connectDiagonalsOrder === "random") {
          const h = ((vx * 2654435761 + vy * 2246822519) >>> 0) % 20;
          return h < connectDiagonals * 4;
        }
        const sum = remCurrent + remOther;
        if (connectDiagonalsOrder === "reverse") {
          if (sum >= (4 - tFloor)) return true;
          if (frac > 0 && sum === (4 - tFloor) - 1) {
            return ((vx * 3 + vy * 7) % 4) < (frac * 4);
          }
          return false;
        }
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
    // A corner is rounded when both adjacent cardinals are absent.
    // diagOnly mode additionally requires the diagonal to be absent
    // (the full 2x2 corner is empty). Otherwise, only diagonal bridge
    // connections suppress rounding.
    const tl = ro > 0 && !hasL && !hasU && !(diagOnly ? hasTL : diagTL);
    const tr = ro > 0 && !hasR && !hasU && !(diagOnly ? hasTR : diagTR);
    const br = ro > 0 && !hasR && !hasD && !(diagOnly ? hasBR : diagBR);
    const bl = ro > 0 && !hasL && !hasD && !(diagOnly ? hasBL : diagBL);
    // Per-corner radii: when jiggle > 0, vary each corner's radius using
    // a deterministic hash of the corner vertex position. Adjacent pixels
    // sharing a vertex get the same hash -> same radius -> no gaps.
    let tlR = ro, trR = ro, brR = ro, blR = ro;
    if (jiggle > 0 && ro > 0) {
      const clampR = (v) => Math.max(0.01, Math.min(0.5, v));
      if (tl) tlR = clampR(ro * (1 + (vtxHash(x, y) - 0.5) * jiggle));
      if (tr) trR = clampR(ro * (1 + (vtxHash(x + 1, y) - 0.5) * jiggle));
      if (br) brR = clampR(ro * (1 + (vtxHash(x + 1, y + 1) - 0.5) * jiggle));
      if (bl) blR = clampR(ro * (1 + (vtxHash(x, y + 1) - 0.5) * jiggle));
    }
    // L-shape detection: single exposed corner with both opposite cardinals
    // present gets full pixel-size radius (1.0) instead of the standard rOuter.
    // When skipCheckerLCorners is set, skip L-corners where the diagonal pixel
    // at that corner is filled (checkerboard vertex).
    if (fullLCorners && ro > 0) {
      if (tl && hasR && hasD && !(skipCheckerLCorners && hasTL)) tlR = 1;
      if (tr && hasL && hasD && !(skipCheckerLCorners && hasTR)) trR = 1;
      if (br && hasL && hasU && !(skipCheckerLCorners && hasBR)) brR = 1;
      if (bl && hasR && hasU && !(skipCheckerLCorners && hasBL)) blR = 1;
    }
    // Resolve per-pixel style (may be a single string or a weighted mix object)
    const resolvedTip = resolveStyle(tipStyle, TIP_PROFILES, x, y, 100);
    const resolvedIsland = resolveStyle(islandStyle, ISLAND_PROFILES, x, y, 101);

    // Tip detection: pixel with exactly 1 cardinal neighbor and no diagonal
    // bridges on the exposed end. tipDir points away from the neighbor.
    let tipDir = null;
    if (resolvedTip !== "none" && remCurrent === 1) {
      if (hasD && !diagTL && !diagTR)      tipDir = "up";
      else if (hasU && !diagBL && !diagBR)  tipDir = "down";
      else if (hasR && !diagTL && !diagBL)  tipDir = "left";
      else if (hasL && !diagTR && !diagBR)  tipDir = "right";
    }
    if (tipDir) {
      tipDirMap.set(key(x, y), { dir: tipDir, tip: resolvedTip });
    }

    // Outer corners: rounded pixel outline
    let path;
    if (tipDir) {
      const profile = TIP_PROFILES[resolvedTip];

      if (profile) {
        const base = tipBase ?? profile?.base ?? 0;
        const s = 1 - base;
        const p = (u, v) => fmtTipPt(x, y, tipDir, u, v);
        const ps = (u, v) => p(u, v * s);

        if ("lobes" in profile) {
          path = buildLobedTipPath(p, ps, profile);
        } else {
          const { a, b } = profile;

          path =
            `M${p(0, 1)}L${p(1, 1)}L${ps(1, 1)}`
            + `C${ps(1, a)},${ps(b, 0)},${ps(0.5, 0)}`
            + `C${ps(1 - b, 0)},${ps(0, a)},${ps(0, 1)}`
            + `L${p(0, 1)}z`;
        }
      }
    } else if (
      resolvedIsland !== "none" && ISLAND_PROFILES[resolvedIsland] &&
      !hasL && !hasR && !hasU && !hasD &&
      !(diagOnly ? hasTL : diagTL) &&
      !(diagOnly ? hasTR : diagTR) &&
      !(diagOnly ? hasBR : diagBR) &&
      !(diagOnly ? hasBL : diagBL)
    ) {
      path = buildRadialIslandPath(x + 0.5, y + 0.5, ISLAND_PROFILES[resolvedIsland]);
    } else if (!tl && !tr && !br && !bl) {
      path = `M${fmt(x)},${fmt(y)}h1v1h-1z`;
    } else if (jiggle === 0 && tlR === ro && trR === ro && brR === ro && blR === ro) {
      // Fast path: uniform radius, reuse preformatted arc string
      const p = [];
      p.push(`M${fmt(x + (tl ? ro : 0))},${fmt(y)}`);
      const topLen = 1 - (tl ? ro : 0) - (tr ? ro : 0);
      if (topLen > 0) p.push(`h${fmt(topLen)}`);
      if (tr) p.push(`${af}${rof},${rof}`);
      const rightLen = 1 - (tr ? ro : 0) - (br ? ro : 0);
      if (rightLen > 0) p.push(`v${fmt(rightLen)}`);
      if (br) p.push(`${af}${nrof},${rof}`);
      const bottomLen = 1 - (br ? ro : 0) - (bl ? ro : 0);
      if (bottomLen > 0) p.push(`h${fmt(-bottomLen)}`);
      if (bl) p.push(`${af}${nrof},${nrof}`);
      const leftLen = 1 - (bl ? ro : 0) - (tl ? ro : 0);
      if (leftLen > 0) p.push(`v${fmt(-leftLen)}`);
      if (tl) p.push(`${af}${rof},${nrof}`);
      p.push('z');
      path = p.join('');
    } else {
      // Jiggled path: per-corner radii, straight edges
      const p = [];
      p.push(`M${fmt(x + (tl ? tlR : 0))},${fmt(y)}`);
      const topLen = 1 - (tl ? tlR : 0) - (tr ? trR : 0);
      if (topLen > 0) p.push(`h${fmt(topLen)}`);
      if (tr) p.push(`a${fmt(trR)},${fmt(trR)},0,0,1,${fmt(trR)},${fmt(trR)}`);
      const rightLen = 1 - (tr ? trR : 0) - (br ? brR : 0);
      if (rightLen > 0) p.push(`v${fmt(rightLen)}`);
      if (br) p.push(`a${fmt(brR)},${fmt(brR)},0,0,1,${fmt(-brR)},${fmt(brR)}`);
      const bottomLen = 1 - (br ? brR : 0) - (bl ? blR : 0);
      if (bottomLen > 0) p.push(`h${fmt(-bottomLen)}`);
      if (bl) p.push(`a${fmt(blR)},${fmt(blR)},0,0,1,${fmt(-blR)},${fmt(-blR)}`);
      const leftLen = 1 - (bl ? blR : 0) - (tl ? tlR : 0);
      if (leftLen > 0) p.push(`v${fmt(-leftLen)}`);
      if (tl) p.push(`a${fmt(tlR)},${fmt(tlR)},0,0,1,${fmt(tlR)},${fmt(-tlR)}`);
      p.push('z');
      path = p.join('');
    }
    // Store corner info for second-pass fillet computation
    if (cornerInfoMap) {
      cornerInfoMap.set(key(x, y), {
        tl: tl ? tlR : 0, tr: tr ? trR : 0,
        br: br ? brR : 0, bl: bl ? blR : 0,
      });
    }
    // Inner corners: fill smooth Bezier transitions at concave vertices
    // where diagonal is absent but both adjacent cardinals are present
    // (L-shape junction). Quadratic Bezier smoothly transitions between
    // the two edge directions, filling the curved triangle at the corner.
    // In two-pass mode, defer to pass 2 for tangent-continuous fillets.
    if (ri > 0 && !needsTwoPass) {
      // Jiggle only the Bezier control point, NOT the endpoint.
      // Endpoints stay on pixel edges so the fill connects flush.
      // Edge bowing is suppressed at inner corner vertices (above), so
      // the adjacent pixel edges remain straight where fills attach.
      if (hasL && hasU && !allPixels.has(key(x - 1, y - 1))) {
        const jcx = jiggle > 0 ? (vtxHash(x, y, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x, y, 2) - 0.5) * jiggle * ri : 0;
        path += " " + innerFilletAt(x, y, "tl", ri, { jcx, jcy, ...tipOverride("tl", x, y) });
      }
      if (hasR && hasU && !allPixels.has(key(x + 1, y - 1))) {
        const jcx = jiggle > 0 ? (vtxHash(x + 1, y, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x + 1, y, 2) - 0.5) * jiggle * ri : 0;
        path += " " + innerFilletAt(x + 1, y, "tr", ri, { jcx, jcy, ...tipOverride("tr", x, y) });
      }
      if (hasR && hasD && !allPixels.has(key(x + 1, y + 1))) {
        const jcx = jiggle > 0 ? (vtxHash(x + 1, y + 1, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x + 1, y + 1, 2) - 0.5) * jiggle * ri : 0;
        path += " " + innerFilletAt(x + 1, y + 1, "br", ri, { jcx, jcy, ...tipOverride("br", x, y) });
      }
      if (hasL && hasD && !allPixels.has(key(x - 1, y + 1))) {
        const jcx = jiggle > 0 ? (vtxHash(x, y + 1, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x, y + 1, 2) - 0.5) * jiggle * ri : 0;
        path += " " + innerFilletAt(x, y + 1, "bl", ri, { jcx, jcy, ...tipOverride("bl", x, y) });
      }
    }
    // Diagonal connections: bridge two diagonally adjacent pixels with two
    // Bezier fillets at the shared vertex. Only emit downward (BR, BL)
    // fillets to avoid duplication -- the other pixel handles its half.
    if (ri > 0) {
      if (diagBR) {
        const jcx = jiggle > 0 ? (vtxHash(x + 1, y + 1, 3) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x + 1, y + 1, 4) - 0.5) * jiggle * ri : 0;
        path += ` M${fmt(x + 1)},${fmt(y + 1 - ri)}q${fmt(jcx)},${fmt(ri + jcy)},${rif},${rif}h${nrif}z`;
        path += ` M${fmt(x + 1 - ri)},${fmt(y + 1)}q${fmt(ri + jcx)},${fmt(jcy)},${rif},${rif}v${nrif}z`;
      }
      if (diagBL) {
        const jcx = jiggle > 0 ? (vtxHash(x, y + 1, 3) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x, y + 1, 4) - 0.5) * jiggle * ri : 0;
        path += ` M${fmt(x)},${fmt(y + 1 - ri)}q${fmt(jcx)},${fmt(ri + jcy)},${nrif},${rif}h${rif}z`;
        path += ` M${fmt(x + ri)},${fmt(y + 1)}q${fmt(-ri + jcx)},${fmt(jcy)},${nrif},${rif}v${nrif}z`;
      }
    }
    return path;
  });

  // --- Pass 2: tangent-continuous inner fillets for full-radius L-corners ---
  // When a neighbor has a full-radius arc (R=1), the arc extends past the grid
  // line, so the fillet endpoint shifts to the arc-line intersection.
  // innerFilletAt (from util/inner-fillet.mjs) handles both the simple case
  // and the arc-intersection case with tangent-continuous Bézier control points.
  if (needsTwoPass) {
    const fillets = [];
    for (const [x, y] of sorted) {
      const hasL = allPixels.has(key(x - 1, y));
      const hasR = allPixels.has(key(x + 1, y));
      const hasU = allPixels.has(key(x, y - 1));
      const hasD = allPixels.has(key(x, y + 1));

      // Inner TL at vertex (x, y)
      if (hasL && hasU && !allPixels.has(key(x - 1, y - 1))) {
        const Ra = cornerInfoMap.get(key(x, y - 1))?.tl ?? ro;
        const Rb = cornerInfoMap.get(key(x - 1, y))?.tl ?? ro;
        const jcx = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x, y, 1) - 0.5) * jiggle * ri : 0;
        const jcy = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x, y, 2) - 0.5) * jiggle * ri : 0;
        fillets.push(innerFilletAt(x, y, "tl", ri, { Ra, Rb, ro, jcx, jcy, ...tipOverride("tl", x, y) }));
      }
      // Inner TR at vertex (x+1, y)
      if (hasR && hasU && !allPixels.has(key(x + 1, y - 1))) {
        const Ra = cornerInfoMap.get(key(x, y - 1))?.tr ?? ro;
        const Rb = cornerInfoMap.get(key(x + 1, y))?.tr ?? ro;
        const jcx = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x + 1, y, 1) - 0.5) * jiggle * ri : 0;
        const jcy = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x + 1, y, 2) - 0.5) * jiggle * ri : 0;
        fillets.push(innerFilletAt(x + 1, y, "tr", ri, { Ra, Rb, ro, jcx, jcy, ...tipOverride("tr", x, y) }));
      }
      // Inner BR at vertex (x+1, y+1)
      if (hasR && hasD && !allPixels.has(key(x + 1, y + 1))) {
        const Ra = cornerInfoMap.get(key(x, y + 1))?.br ?? ro;
        const Rb = cornerInfoMap.get(key(x + 1, y))?.br ?? ro;
        const jcx = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x + 1, y + 1, 1) - 0.5) * jiggle * ri : 0;
        const jcy = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x + 1, y + 1, 2) - 0.5) * jiggle * ri : 0;
        fillets.push(innerFilletAt(x + 1, y + 1, "br", ri, { Ra, Rb, ro, jcx, jcy, ...tipOverride("br", x, y) }));
      }
      // Inner BL at vertex (x, y+1)
      if (hasL && hasD && !allPixels.has(key(x - 1, y + 1))) {
        const Ra = cornerInfoMap.get(key(x, y + 1))?.bl ?? ro;
        const Rb = cornerInfoMap.get(key(x - 1, y))?.bl ?? ro;
        const jcx = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x, y + 1, 1) - 0.5) * jiggle * ri : 0;
        const jcy = Ra <= ro && Rb <= ro && jiggle > 0 ? (vtxHash(x, y + 1, 2) - 0.5) * jiggle * ri : 0;
        fillets.push(innerFilletAt(x, y + 1, "bl", ri, { Ra, Rb, ro, jcx, jcy, ...tipOverride("bl", x, y) }));
      }
    }
    return { path: paths.join(" "), fillets: fillets.join(" ") };
  }

  return { path: paths.join(" "), fillets: "" };
}
