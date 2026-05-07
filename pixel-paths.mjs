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

// --- SVG path rendering ---

export function squaresToPath(squares) {
  const sorted = [...squares].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return sorted.map(([x, y]) => {
    const xf = x === Math.trunc(x) ? Math.trunc(x) : x.toFixed(1);
    const yf = y === Math.trunc(y) ? Math.trunc(y) : y.toFixed(1);
    return `M${xf},${yf}h1v1h-1z`;
  }).join(" ");
}

export function squaresToRoundedPath(squares, allPixels, rOuter, rInner, connectDiagonals = false, diagOnly = false, jiggle = 0, fullLCorners = false) {
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
    if (fullLCorners && ro > 0) {
      if (tl && hasR && hasD) tlR = 1;
      if (tr && hasL && hasD) trR = 1;
      if (br && hasL && hasU) brR = 1;
      if (bl && hasR && hasU) blR = 1;
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

// --- Contour tracing: one closed SVG path per connected component ---

export function squaresToContourPath(squares, allPixels, rOuter, rInner, connectDiagonals = 0, fullLCorners = false) {
  if (squares.size === 0) return { path: "", fillets: "" };

  // --- Step 1: Find connected components via 4-connected flood fill ---
  function findComponents(pixels) {
    const visited = new Set();
    const components = [];
    for (const k of pixels) {
      if (visited.has(k)) continue;
      const comp = new Set();
      const stack = [k];
      while (stack.length) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        comp.add(cur);
        const [x, y] = unkey(cur);
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = key(x + dx, y + dy);
          if (pixels.has(nk) && !visited.has(nk)) stack.push(nk);
        }
      }
      components.push(comp);
    }
    return components;
  }

  // --- Step 2: Trace boundary edges of a component ---
  // Directions: 0=East, 1=South, 2=West, 3=North
  // Convention: CW walk with filled cells on the right side of the edge.
  //
  // We walk along edges of the pixel grid. An edge separates two cells.
  // Position (x, y, dir) means we're at vertex (x, y) about to walk in direction dir.
  // The "right" cell (filled side) and "left" cell (empty side) depend on direction:
  //   East:  right=(x, y),   left=(x, y-1)
  //   South: right=(x-1, y), left=(x, y)
  //   West:  right=(x-1, y-1), left=(x-1, y)
  //   North: right=(x, y-1), left=(x-1, y-1)

  const DX = [1, 0, -1, 0]; // movement delta per direction
  const DY = [0, 1, 0, -1];
  // Right cell offset: the filled cell to the right of the edge
  const RCX = [0, -1, -1, 0];
  const RCY = [0, 0, -1, -1];
  // Left cell offset: the empty cell to the left of the edge
  const LCX = [0, 0, -1, -1];
  const LCY = [-1, 0, 0, -1];

  function traceBoundary(comp) {
    // Find topmost-leftmost pixel → start on its top edge, walking East
    let startX = Infinity, startY = Infinity;
    for (const k of comp) {
      const [x, y] = unkey(k);
      if (y < startY || (y === startY && x < startX)) { startX = x; startY = y; }
    }
    // Start at top-left vertex of that pixel, direction East
    let cx = startX, cy = startY, dir = 0;
    const startKey = key(startX, startY);
    const vertices = [];

    do {
      // Advance one edge in current direction, snapping to avoid float drift
      const nextX = snap(cx + DX[dir]);
      const nextY = snap(cy + DY[dir]);
      const rightDir = (dir + 1) % 4;
      const leftDir = (dir + 3) % 4;

      // Cell ahead-right: the cell that would be on the right if we continue straight
      const aheadRight = comp.has(key(nextX + RCX[dir], nextY + RCY[dir]));
      // Cell ahead-left: the cell that would be on the left if we continue straight
      const aheadLeft = comp.has(key(nextX + LCX[dir], nextY + LCY[dir]));

      if (!aheadRight) {
        // Turn right (convex corner)
        vertices.push({ x: nextX, y: nextY, turn: "right" });
        cx = nextX; cy = nextY;
        dir = rightDir;
      } else if (!aheadLeft) {
        // Go straight
        vertices.push({ x: nextX, y: nextY, turn: "straight" });
        cx = nextX; cy = nextY;
      } else {
        // Turn left (concave corner)
        vertices.push({ x: nextX, y: nextY, turn: "left" });
        cx = nextX; cy = nextY;
        dir = leftDir;
      }
    } while (key(cx, cy) !== startKey || dir !== 0);

    // Remove "straight" vertices — they carry no turn info and just fragment edges
    return vertices.filter(v => v.turn !== "straight");
  }

  // --- Step 3: Find holes via exterior flood fill ---
  function findHoles(comp) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k of comp) {
      const [x, y] = unkey(k);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // Expand bounding box by 1
    minX--; minY--; maxX++; maxY++;

    // Flood fill exterior from top-left corner
    const exterior = new Set();
    const stack = [key(minX, minY)];
    while (stack.length) {
      const cur = stack.pop();
      if (exterior.has(cur)) continue;
      const [x, y] = unkey(cur);
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (comp.has(cur)) continue;
      exterior.add(cur);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = key(x + dx, y + dy);
        if (!exterior.has(nk)) stack.push(nk);
      }
    }

    // Interior holes = cells inside bbox that are not in comp and not exterior
    const holePixels = new Set();
    for (let y = minY + 1; y < maxY; y++) {
      for (let x = minX + 1; x < maxX; x++) {
        const k = key(x, y);
        if (!comp.has(k) && !exterior.has(k)) holePixels.add(k);
      }
    }

    if (holePixels.size === 0) return [];
    // Each hole may be a separate connected region
    return findComponents(holePixels);
  }

  // Trace a hole boundary (CCW = filled on left instead of right)
  // Easiest: trace the hole's pixels as if they were a component (CW), then reverse
  function traceHoleBoundary(holeComp) {
    const verts = traceBoundary(holeComp);
    // Reverse the vertex list to get CCW winding
    verts.reverse();
    // After reversal, "right" turns become "left" and vice versa
    for (const v of verts) {
      if (v.turn === "right") v.turn = "left";
      else if (v.turn === "left") v.turn = "right";
    }
    return verts;
  }

  // --- Step 4: Emit SVG path from vertices ---
  function emitPath(vertices, ro, ri, isHole, compPixels) {
    if (vertices.length === 0) return "";
    const p = [];

    // For rounding: at each vertex, determine the radii that apply to the
    // incoming and outgoing edges based on the turn type.
    // We need to compute the edge lengths between vertices and shorten them
    // by the radii at each end.

    const n = vertices.length;

    // Compute edge vectors and lengths
    // Edge i goes from vertex i to vertex (i+1)%n
    const edges = [];
    for (let i = 0; i < n; i++) {
      const v0 = vertices[i];
      const v1 = vertices[(i + 1) % n];
      const dx = v1.x - v0.x;
      const dy = v1.y - v0.y;
      const len = Math.abs(dx) + Math.abs(dy); // Manhattan (always axis-aligned)
      edges.push({ dx, dy, len });
    }

    // L-corner detection: at each "right" turn vertex, check if a quadrant
    // pixel has an L-corner (exposed corner + both opposite cardinals present).
    // Works for both outer (CW) and hole (CCW) boundaries by checking all 4
    // quadrant pixels directly rather than relying on edge directions.
    if (fullLCorners && ro > 0) {
      for (let i = 0; i < n; i++) {
        if (vertices[i].turn !== "right") continue;
        const vx = vertices[i].x, vy = vertices[i].y;
        // TL corner of pixel (vx,vy): adj=left,up absent; opp=right,down present
        if (compPixels.has(key(vx, vy)) && !allPixels.has(key(vx - 1, vy)) && !allPixels.has(key(vx, vy - 1))
            && allPixels.has(key(vx + 1, vy)) && allPixels.has(key(vx, vy + 1))) {
          vertices[i].fullRadius = "TL"; continue;
        }
        // TR corner of pixel (vx-1,vy): adj=right,up absent; opp=left,down present
        if (compPixels.has(key(vx - 1, vy)) && !allPixels.has(key(vx, vy)) && !allPixels.has(key(vx - 1, vy - 1))
            && allPixels.has(key(vx - 2, vy)) && allPixels.has(key(vx - 1, vy + 1))) {
          vertices[i].fullRadius = "TR"; continue;
        }
        // BL corner of pixel (vx,vy-1): adj=left,down absent; opp=right,up present
        if (compPixels.has(key(vx, vy - 1)) && !allPixels.has(key(vx - 1, vy - 1)) && !allPixels.has(key(vx, vy))
            && allPixels.has(key(vx + 1, vy - 1)) && allPixels.has(key(vx, vy - 2))) {
          vertices[i].fullRadius = "BL"; continue;
        }
        // BR corner of pixel (vx-1,vy-1): adj=right,down absent; opp=left,up present
        if (compPixels.has(key(vx - 1, vy - 1)) && !allPixels.has(key(vx, vy - 1)) && !allPixels.has(key(vx - 1, vy))
            && allPixels.has(key(vx - 2, vy - 1)) && allPixels.has(key(vx - 1, vy - 2))) {
          vertices[i].fullRadius = "BR"; continue;
        }
      }
    }

    // "right" = convex → arc with rOuter; "left" = concave → Bézier with rInner.
    // For holes, traceHoleBoundary already swapped the labels, so same logic applies.
    // At checkerboard vertices, suppress rInner — per-pixel mode has no inner
    // fillet there (filled pixels have convex, not concave, corners).
    function radiusAt(i) {
      if (vertices[i].checkerboard) return 0;
      if (vertices[i].diagConnected) return 0;
      const turn = vertices[i].turn;
      if (turn === "right") return ro;
      if (turn === "left") return ri;
      return 0;
    }

    // Find the starting position: offset from vertex 0 by the radius
    // The edge from vertex (n-1) to vertex 0 is the "incoming" edge to vertex 0.
    // We start the path at the point on that edge, radius distance before vertex 0.
    const r0 = radiusAt(0);
    const lastEdge = edges[n - 1];
    // Direction of last edge (incoming to vertex 0)
    let prevDx = Math.sign(lastEdge.dx);
    let prevDy = Math.sign(lastEdge.dy);
    const startX = vertices[0].x - prevDx * r0;
    const startY = vertices[0].y - prevDy * r0;

    p.push(`M${fmt(startX)},${fmt(startY)}`);

    // Arc sweep for rOuter convex corners: always 1 (CW in screen coords).
    // For outer boundaries (CW), this curves inward toward the filled region.
    // For hole boundaries (CCW), this also curves toward the filled region
    // (which is on the outside of the hole). Using sweep=0 for holes would
    // make the arc curve toward the hole interior — the wrong direction.
    const sweep = 1;

    for (let i = 0; i < n; i++) {
      const r = radiusAt(i);
      const edge = edges[i]; // outgoing edge from vertex i
      const rNext = radiusAt((i + 1) % n);

      // Direction of outgoing edge
      const odx = Math.sign(edge.dx);
      const ody = Math.sign(edge.dy);

      if (vertices[i].turn === "right" && r > 0) {
        // Convex corner: arc
        // Current pos: vertex - prevDir * r. Target: vertex + outDir * r.
        // Displacement = outDir*r + prevDir*r
        const adx = fmt(odx * r + prevDx * r);
        const ady = fmt(ody * r + prevDy * r);
        p.push(`a${fmt(r)},${fmt(r)},0,0,${sweep},${adx},${ady}`);
      } else if (vertices[i].turn === "left" && r > 0) {
        // Concave corner: quadratic Bézier fillet
        // Control point: at the vertex itself (relative to start)
        const cpx = prevDx * r;
        const cpy = prevDy * r;
        const endx = prevDx * r + odx * r;
        const endy = prevDy * r + ody * r;
        p.push(`q${fmt(cpx)},${fmt(cpy)},${fmt(endx)},${fmt(endy)}`);
      }
      // else: straight through — no corner command needed

      // Emit the edge segment (shortened by radii at both ends)
      const edgeLen = edge.len - r - rNext;
      if (edgeLen > 0.001) {
        if (ody === 0) p.push(`h${fmt(odx * edgeLen)}`);
        else p.push(`v${fmt(ody * edgeLen)}`);
      }

      // Update incoming direction for next vertex
      prevDx = odx;
      prevDy = ody;
    }

    p.push("z");
    return p.join("");
  }

  // --- Step 4b: Emit CCW notch subpaths for L-corners ---
  // At L-corner vertices, the contour uses the normal ro arc but per-pixel
  // mode uses r=1. We emit CCW crescent subpaths to carve out the area
  // between the ro arc and the r=1 arc, matching per-pixel visually.
  // The notch directions are determined by the corner TYPE (TL/TR/BL/BR),
  // not the boundary edge directions, since the boundary may traverse
  // through this vertex from a different pixel's corner.
  //
  // Per corner type, the "incoming" and "outgoing" directions (from the
  // pixel's own CW boundary perspective) are:
  //   TL: in=(0,-1) out=(1,0)   TR: in=(1,0) out=(0,1)
  //   BL: in=(-1,0) out=(0,-1)  BR: in=(0,1) out=(-1,0)
  const LC_DIRS = {
    TL: { pdx: 0, pdy: -1, odx: 1, ody: 0 },
    TR: { pdx: 1, pdy: 0, odx: 0, ody: 1 },
    BL: { pdx: -1, pdy: 0, odx: 0, ody: -1 },
    BR: { pdx: 0, pdy: 1, odx: -1, ody: 0 },
  };

  function emitLCornerNotches(vertices, ro) {
    if (!fullLCorners || ro <= 0) return "";
    const parts = [];
    for (let i = 0; i < vertices.length; i++) {
      if (!vertices[i].fullRadius) continue;
      if (vertices[i].diagConnected || vertices[i].checkerboard) continue;
      const vx = vertices[i].x, vy = vertices[i].y;
      const { pdx, pdy, odx, ody } = LC_DIRS[vertices[i].fullRadius];
      // P1 = ro arc start (incoming edge), P2 = r=1 arc start
      // P3 = r=1 arc end (outgoing edge), P4 = ro arc end
      const p1x = vx - pdx * ro, p1y = vy - pdy * ro;
      const p2x = vx - pdx, p2y = vy - pdy;
      const p3x = vx + odx, p3y = vy + ody;
      const p4x = vx + odx * ro, p4y = vy + ody * ro;
      // CCW crescent: P1 → P2 → CW arc r=1 → P3 → P4 → CCW arc ro → P1
      parts.push(
        `M${fmt(p1x)},${fmt(p1y)}` +
        `L${fmt(p2x)},${fmt(p2y)}` +
        `A1,1,0,0,1,${fmt(p3x)},${fmt(p3y)}` +
        `L${fmt(p4x)},${fmt(p4y)}` +
        `A${fmt(ro)},${fmt(ro)},0,0,0,${fmt(p1x)},${fmt(p1y)}` +
        `Z`
      );
    }
    return parts.join(" ");
  }

  // --- Step 5: Check if outer boundary already handles a hole ---
  // The outer boundary can enter holes via "pinch points" when the trace
  // approaches from certain directions, creating local CCW sub-loops.
  // At these holes the outer boundary already produces winding=0, so adding
  // a separate hole subpath would double-subtract (winding=-1 = incorrectly filled).
  // We only emit hole subpaths for holes the outer boundary fully encloses (winding≠0).
  function windingFromVertices(verts, px, py) {
    let winding = 0;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % n];
      // Only vertical edges can cross a horizontal ray going right
      if (v0.x === v1.x && v0.x > px) {
        const minY = Math.min(v0.y, v1.y);
        const maxY = Math.max(v0.y, v1.y);
        if (py >= minY && py < maxY) {
          winding += (v1.y > v0.y) ? 1 : -1;
        }
      }
    }
    return winding;
  }

  // --- Step 6: Handle checkerboard vertices between diagonal holes ---
  // At a checkerboard vertex (2 filled cells on one diagonal, 2 empty on the
  // other), per-pixel mode creates rOuter arcs on the filled pixels' exposed
  // convex corners — no rInner fillets apply since the filled pixels have no
  // shared cardinal neighbors at that vertex.
  //
  // Contour mode keeps holes as separate subpaths (no stitching). At checker-
  // board vertices on hole boundaries:
  //  (a) Suppress rInner — the vertex should be a sharp corner, matching
  //      per-pixel mode where no inner fillet exists.
  //  (b) Emit separate CCW arc-notch subpaths that carve out the rOuter gap
  //      matching the per-pixel convex arcs of the two filled pixels.

  function markCheckerboardVertices(holeVerts) {
    for (const v of holeVerts) {
      const hasNW = allPixels.has(key(v.x - 1, v.y - 1));
      const hasNE = allPixels.has(key(v.x, v.y - 1));
      const hasSE = allPixels.has(key(v.x, v.y));
      const hasSW = allPixels.has(key(v.x - 1, v.y));
      const filled = (hasNW ? 1 : 0) + (hasNE ? 1 : 0) + (hasSE ? 1 : 0) + (hasSW ? 1 : 0);
      if (filled === 2 && hasNW === hasSE) {
        v.checkerboard = true;
      }
    }
  }

  function emitCheckerboardNotches(holeVerts, ro, emittedSet) {
    if (ro <= 0) return "";
    const r = ro;
    const rf = fmt(r);
    const nrf = fmt(-r);
    const parts = [];
    for (const v of holeVerts) {
      if (!v.checkerboard) continue;
      const vk = key(v.x, v.y);
      if (emittedSet.has(vk)) continue;
      // Skip checkerboard notches at diagonal connection vertices —
      // diagonal fillets handle the fill there instead.
      if (diagConnections.has(vk)) continue;
      emittedSet.add(vk);

      const vxf = fmt(v.x), vyf = fmt(v.y);
      const hasNW = allPixels.has(key(v.x - 1, v.y - 1));
      const hasSE = allPixels.has(key(v.x, v.y));

      if (hasNW && hasSE) {
        // NW-SE diagonal filled: CCW notches carving into NW and SE pixels
        // All CCW (screen) to subtract from fill — verified via shoelace test.
        // Notch 1 (upper-left, carves BR of NW pixel):
        //   vertex → up → arc left-down (sweep=1) → close right
        parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y - r)}a${rf},${rf},0,0,1,${nrf},${rf}Z`);
        // Notch 2 (lower-right, carves TL of SE pixel):
        //   vertex → down → arc right-up (sweep=1) → close left
        parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y + r)}a${rf},${rf},0,0,1,${rf},${nrf}Z`);
      } else {
        // NE-SW diagonal filled: CCW notches carving into NE and SW pixels
        // Notch 1 (upper-right, carves BL of NE pixel):
        //   vertex → right → arc up-left (sweep=1) → close down
        parts.push(`M${vxf},${vyf}L${fmt(v.x + r)},${vyf}a${rf},${rf},0,0,1,${nrf},${nrf}Z`);
        // Notch 2 (lower-left, carves TR of SW pixel):
        //   vertex → left → arc down-right (sweep=1) → close up
        parts.push(`M${vxf},${vyf}L${fmt(v.x - r)},${vyf}a${rf},${rf},0,0,1,${rf},${rf}Z`);
      }
    }
    return parts.join(" ");
  }

  // --- Step 7: Mark diagonal-connected vertices on traced boundaries ---
  function markDiagConnectedVertices(verts, diagConns) {
    for (const v of verts) {
      if (v.turn === "right" && diagConns.has(key(v.x, v.y))) {
        v.diagConnected = true;
      }
    }
  }

  // --- Step 8: Pre-compute diagonal connections ---
  // Reuse the same scoring logic as per-pixel mode. For each pixel, check
  // BR and BL diagonals (to avoid duplication). Store the set of connected
  // vertices keyed by "vx,vy" along with the direction ("br" or "bl").
  const diagConnections = new Map(); // vertexKey -> "br" | "bl"
  if (connectDiagonals > 0) {
    const threshold = connectDiagonals - 1;
    const tFloor = Math.floor(threshold);
    const frac = threshold - tFloor;
    for (const k of allPixels) {
      const [x, y] = unkey(k);
      const hasL = allPixels.has(key(x - 1, y));
      const hasR = allPixels.has(key(x + 1, y));
      const hasU = allPixels.has(key(x, y - 1));
      const hasD = allPixels.has(key(x, y + 1));
      const remCurrent = (hasL ? 1 : 0) + (hasR ? 1 : 0) + (hasU ? 1 : 0) + (hasD ? 1 : 0);
      function shouldConnect(remOther, vx, vy) {
        const sum = remCurrent + remOther;
        if (sum <= tFloor) return true;
        if (frac > 0 && sum === tFloor + 1) {
          return ((vx * 3 + vy * 7) % 4) < (frac * 4);
        }
        return false;
      }
      // BR diagonal: vertex (x+1, y+1)
      if (!hasR && !hasD && allPixels.has(key(x + 1, y + 1))) {
        const rem = (allPixels.has(key(x + 2, y + 1)) ? 1 : 0) + (allPixels.has(key(x + 1, y + 2)) ? 1 : 0);
        if (shouldConnect(rem, x + 1, y + 1)) {
          diagConnections.set(key(x + 1, y + 1), "br");
        }
      }
      // BL diagonal: vertex (x, y+1)
      if (!hasL && !hasD && allPixels.has(key(x - 1, y + 1))) {
        const rem = (allPixels.has(key(x - 2, y + 1)) ? 1 : 0) + (allPixels.has(key(x - 1, y + 2)) ? 1 : 0);
        if (shouldConnect(rem, x, y + 1)) {
          diagConnections.set(key(x, y + 1), "bl");
        }
      }
    }
  }

  // --- Main: assemble all components + holes ---
  const components = findComponents(squares);
  const pathParts = [];
  const emittedNotches = new Set(); // avoid duplicate notches at shared vertices

  for (const comp of components) {
    const outerVerts = traceBoundary(comp);
    if (diagConnections.size > 0) markDiagConnectedVertices(outerVerts, diagConnections);
    pathParts.push(emitPath(outerVerts, rOuter, rInner, false, comp));
    // Emit L-corner notches for outer boundary
    const lcNotches = emitLCornerNotches(outerVerts, rOuter);
    if (lcNotches) pathParts.push(lcNotches);

    const holes = findHoles(comp);

    // Filter holes that need separate subpaths (winding check)
    const neededHoles = holes.filter(hole => {
      const testCell = hole.values().next().value;
      const [tx, ty] = unkey(testCell);
      return windingFromVertices(outerVerts, tx + 0.5, ty + 0.5) !== 0;
    });

    // Emit each hole as a separate CCW subpath
    for (const hole of neededHoles) {
      const holeVerts = traceHoleBoundary(hole);
      markCheckerboardVertices(holeVerts);
      if (diagConnections.size > 0) markDiagConnectedVertices(holeVerts, diagConnections);
      pathParts.push(emitPath(holeVerts, rOuter, rInner, true, comp));
      // Emit rOuter arc notches at checkerboard vertices
      const notches = emitCheckerboardNotches(holeVerts, rOuter, emittedNotches);
      if (notches) pathParts.push(notches);
      // Emit L-corner notches for hole boundary
      const holeLcNotches = emitLCornerNotches(holeVerts, rOuter);
      if (holeLcNotches) pathParts.push(holeLcNotches);
    }
  }

  // Emit diagonal fillet subpaths (two Bézier curves per connected vertex)
  const filletParts = [];
  if (diagConnections.size > 0 && rInner > 0) {
    const ri = rInner;
    const rif = fmt(ri);
    const nrif = fmt(-ri);
    for (const [vk, dir] of diagConnections) {
      const [vx, vy] = unkey(vk);
      if (dir === "br") {
        filletParts.push(`M${fmt(vx)},${fmt(vy - ri)}q0,${rif},${rif},${rif}h${nrif}z`);
        filletParts.push(`M${fmt(vx - ri)},${fmt(vy)}q${rif},0,${rif},${rif}v${nrif}z`);
      } else {
        // "bl"
        filletParts.push(`M${fmt(vx)},${fmt(vy - ri)}q0,${rif},${nrif},${rif}h${rif}z`);
        filletParts.push(`M${fmt(vx + ri)},${fmt(vy)}q${nrif},0,${nrif},${rif}v${nrif}z`);
      }
    }
  }

  const allParts = pathParts.concat(filletParts);
  return { path: allParts.join(" "), fillets: "" };
}
