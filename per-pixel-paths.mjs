/**
 * Per-pixel SVG path rendering: individual pixel outlines with rounded corners.
 */

import { key, unkey, fmt } from './pixel-paths.mjs';

export function squaresToPath(squares) {
  const sorted = [...squares].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return sorted.map(([x, y]) => {
    const xf = x === Math.trunc(x) ? Math.trunc(x) : x.toFixed(1);
    const yf = y === Math.trunc(y) ? Math.trunc(y) : y.toFixed(1);
    return `M${xf},${yf}h1v1h-1z`;
  }).join(" ");
}

export function squaresToRoundedPath(squares, allPixels, rOuter, rInner, connectDiagonals = false, diagOnly = false, jiggle = 0, fullLCorners = false, skipCheckerLCorners = false) {
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
  // Deterministic per-vertex hash for jiggle variation
  function vtxHash(vx, vy, ch = 0) {
    let s = (Math.round(vx * 1e6) * 374761393 + Math.round(vy * 1e6) * 668265263 + ch * 49979693) >>> 0;
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  // Two-pass mode: when fullLCorners is active with inner radius, inner fillets
  // need neighbor corner info that isn't available until all outlines are built.
  const needsTwoPass = fullLCorners && ri > 0;
  const cornerInfoMap = needsTwoPass ? new Map() : null;

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
    // Outer corners: rounded pixel outline
    let path;
    if (!tl && !tr && !br && !bl) {
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
        // TL inner at vertex (x, y)
        const jcx = jiggle > 0 ? (vtxHash(x, y, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x, y, 2) - 0.5) * jiggle * ri : 0;
        path += ` M${fmt(x)},${fmt(y - ri)}q${fmt(jcx)},${fmt(ri + jcy)},${nrif},${rif}h${rif}z`;
      }
      if (hasR && hasU && !allPixels.has(key(x + 1, y - 1))) {
        // TR inner at vertex (x+1, y)
        const jcx = jiggle > 0 ? (vtxHash(x + 1, y, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x + 1, y, 2) - 0.5) * jiggle * ri : 0;
        path += ` M${fmt(x + 1 + ri)},${fmt(y)}q${fmt(-ri + jcx)},${fmt(jcy)},${nrif},${nrif}v${rif}z`;
      }
      if (hasR && hasD && !allPixels.has(key(x + 1, y + 1))) {
        // BR inner at vertex (x+1, y+1)
        const jcx = jiggle > 0 ? (vtxHash(x + 1, y + 1, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x + 1, y + 1, 2) - 0.5) * jiggle * ri : 0;
        path += ` M${fmt(x + 1)},${fmt(y + 1 + ri)}q${fmt(jcx)},${fmt(-ri + jcy)},${rif},${nrif}h${nrif}z`;
      }
      if (hasL && hasD && !allPixels.has(key(x - 1, y + 1))) {
        // BL inner at vertex (x, y+1)
        const jcx = jiggle > 0 ? (vtxHash(x, y + 1, 1) - 0.5) * jiggle * ri : 0;
        const jcy = jiggle > 0 ? (vtxHash(x, y + 1, 2) - 0.5) * jiggle * ri : 0;
        path += ` M${fmt(x - ri)},${fmt(y + 1)}q${fmt(ri + jcx)},${fmt(jcy)},${rif},${rif}v${nrif}z`;
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
  // findEdge computes that intersection + tangent; buildFillet solves for the
  // quadratic Bézier control point satisfying both tangent constraints.
  if (needsTwoPass) {
    function findEdge(line, cx, cy, R, sign, isHoriz) {
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
    function buildFilletPath(ax, ay, tax, tay, bx, by, tbx, tby, vx, vy) {
      const det = tax * (-tby) - (-tbx) * tay;
      let cpx, cpy;
      if (Math.abs(det) < 1e-10) {
        cpx = (ax + bx) / 2; cpy = (ay + by) / 2;
      } else {
        const alpha = ((bx - ax) * (-tby) - (-tbx) * (by - ay)) / det;
        cpx = ax + alpha * tax;
        cpy = ay + alpha * tay;
      }
      return `M${fmt(ax)},${fmt(ay)}Q${fmt(cpx)},${fmt(cpy)},${fmt(bx)},${fmt(by)}L${fmt(vx)},${fmt(vy)}Z`;
    }

    const fillets = [];
    for (const [x, y] of sorted) {
      const hasL = allPixels.has(key(x - 1, y));
      const hasR = allPixels.has(key(x + 1, y));
      const hasU = allPixels.has(key(x, y - 1));
      const hasD = allPixels.has(key(x, y + 1));

      // Inner TL at vertex (x, y)
      if (hasL && hasU && !allPixels.has(key(x - 1, y - 1))) {
        const upperInfo = cornerInfoMap.get(key(x, y - 1));
        const leftInfo = cornerInfoMap.get(key(x - 1, y));
        const Ra = upperInfo?.tl ?? ro;
        const Rb = leftInfo?.tl ?? ro;
        if (Ra <= ro && Rb <= ro) {
          const jcx = jiggle > 0 ? (vtxHash(x, y, 1) - 0.5) * jiggle * ri : 0;
          const jcy = jiggle > 0 ? (vtxHash(x, y, 2) - 0.5) * jiggle * ri : 0;
          fillets.push(`M${fmt(x)},${fmt(y - ri)}q${fmt(jcx)},${fmt(ri + jcy)},${nrif},${rif}h${rif}z`);
        } else {
          const eA = Ra > ro
            ? findEdge(y - ri, x + Ra, (y - 1) + Ra, Ra, -1, true)
            : { px: x, py: y - ri, tx: 0, ty: 1 };
          const eB = Rb > ro
            ? findEdge(x - ri, (x - 1) + Rb, y + Rb, Rb, -1, false)
            : { px: x - ri, py: y, tx: -1, ty: 0 };
          fillets.push(buildFilletPath(eA.px, eA.py, eA.tx, eA.ty, eB.px, eB.py, eB.tx, eB.ty, x, y));
        }
      }
      // Inner TR at vertex (x+1, y)
      if (hasR && hasU && !allPixels.has(key(x + 1, y - 1))) {
        const upperInfo = cornerInfoMap.get(key(x, y - 1));
        const rightInfo = cornerInfoMap.get(key(x + 1, y));
        const Ra = upperInfo?.tr ?? ro;
        const Rb = rightInfo?.tr ?? ro;
        if (Ra <= ro && Rb <= ro) {
          const jcx = jiggle > 0 ? (vtxHash(x + 1, y, 1) - 0.5) * jiggle * ri : 0;
          const jcy = jiggle > 0 ? (vtxHash(x + 1, y, 2) - 0.5) * jiggle * ri : 0;
          fillets.push(`M${fmt(x + 1 + ri)},${fmt(y)}q${fmt(-ri + jcx)},${fmt(jcy)},${nrif},${nrif}v${rif}z`);
        } else {
          const eA = Ra > ro
            ? findEdge(y - ri, x + 1 - Ra, (y - 1) + Ra, Ra, +1, true)
            : { px: x + 1, py: y - ri, tx: 0, ty: 1 };
          const eB = Rb > ro
            ? findEdge(x + 1 + ri, (x + 2) - Rb, y + Rb, Rb, -1, false)
            : { px: x + 1 + ri, py: y, tx: -1, ty: 0 };
          fillets.push(buildFilletPath(eA.px, eA.py, eA.tx, eA.ty, eB.px, eB.py, eB.tx, eB.ty, x + 1, y));
        }
      }
      // Inner BR at vertex (x+1, y+1)
      if (hasR && hasD && !allPixels.has(key(x + 1, y + 1))) {
        const lowerInfo = cornerInfoMap.get(key(x, y + 1));
        const rightInfo = cornerInfoMap.get(key(x + 1, y));
        const Ra = lowerInfo?.br ?? ro;
        const Rb = rightInfo?.br ?? ro;
        if (Ra <= ro && Rb <= ro) {
          const jcx = jiggle > 0 ? (vtxHash(x + 1, y + 1, 1) - 0.5) * jiggle * ri : 0;
          const jcy = jiggle > 0 ? (vtxHash(x + 1, y + 1, 2) - 0.5) * jiggle * ri : 0;
          fillets.push(`M${fmt(x + 1)},${fmt(y + 1 + ri)}q${fmt(jcx)},${fmt(-ri + jcy)},${rif},${nrif}h${nrif}z`);
        } else {
          const eA = Ra > ro
            ? findEdge(y + 1 + ri, x + 1 - Ra, (y + 2) - Ra, Ra, +1, true)
            : { px: x + 1, py: y + 1 + ri, tx: 0, ty: -1 };
          const eB = Rb > ro
            ? findEdge(x + 1 + ri, (x + 2) - Rb, y + 1 - Rb, Rb, +1, false)
            : { px: x + 1 + ri, py: y + 1, tx: 1, ty: 0 };
          fillets.push(buildFilletPath(eA.px, eA.py, eA.tx, eA.ty, eB.px, eB.py, eB.tx, eB.ty, x + 1, y + 1));
        }
      }
      // Inner BL at vertex (x, y+1)
      if (hasL && hasD && !allPixels.has(key(x - 1, y + 1))) {
        const lowerInfo = cornerInfoMap.get(key(x, y + 1));
        const leftInfo = cornerInfoMap.get(key(x - 1, y));
        const Ra = lowerInfo?.bl ?? ro;
        const Rb = leftInfo?.bl ?? ro;
        if (Ra <= ro && Rb <= ro) {
          const jcx = jiggle > 0 ? (vtxHash(x, y + 1, 1) - 0.5) * jiggle * ri : 0;
          const jcy = jiggle > 0 ? (vtxHash(x, y + 1, 2) - 0.5) * jiggle * ri : 0;
          fillets.push(`M${fmt(x - ri)},${fmt(y + 1)}q${fmt(ri + jcx)},${fmt(jcy)},${rif},${rif}v${nrif}z`);
        } else {
          const eA = Ra > ro
            ? findEdge(y + 1 + ri, x + Ra, (y + 2) - Ra, Ra, -1, true)
            : { px: x, py: y + 1 + ri, tx: 0, ty: -1 };
          const eB = Rb > ro
            ? findEdge(x - ri, (x - 1) + Rb, y + 1 - Rb, Rb, +1, false)
            : { px: x - ri, py: y + 1, tx: 1, ty: 0 };
          fillets.push(buildFilletPath(eA.px, eA.py, eA.tx, eA.ty, eB.px, eB.py, eB.tx, eB.ty, x, y + 1));
        }
      }
    }
    return { path: paths.join(" "), fillets: fillets.join(" ") };
  }

  return { path: paths.join(" "), fillets: "" };
}
