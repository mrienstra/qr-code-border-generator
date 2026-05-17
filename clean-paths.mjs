/**
 * Clean-path SVG rendering: non-overlapping boundary paths driven by
 * per-pixel classification.
 *
 * Uses the shared pixel classifier (pixel-classify.mjs) as the source
 * of truth for corner radii, then assembles clean boundary loops using
 * standard contour topology (findComponents, traceBoundary, findHoles).
 */

import { key, unkey, snap, fmt } from './pixel-paths.mjs';
import { classifyPixels, computeVertexMap } from './pixel-classify.mjs';
import { TIP_PROFILES, resolveStyle, findTipEdge } from './per-pixel-paths.mjs';
import { filletControlPoint } from './util/inner-fillet.mjs';

// For each tip direction, which corner of the owner pixel is the tipCurve start
// (first vertex encountered in CW traversal) and which is the tipCurveEnd.
const TIP_CURVE_ROLES = {
  up:    { tipCurve: "tl", tipCurveEnd: "tr" },
  down:  { tipCurve: "br", tipCurveEnd: "bl" },
  left:  { tipCurve: "bl", tipCurveEnd: "tl" },
  right: { tipCurve: "tr", tipCurveEnd: "br" },
};

// De Casteljau split: given cubic [P0,P1,P2,P3] and parameter t,
// returns { left: [P0..S], right: [S..P3] } where S is the on-curve point at t.
function splitCubicAtT(P0, P1, P2, P3, t) {
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const Q0 = lerp(P0, P1), Q1 = lerp(P1, P2), Q2 = lerp(P2, P3);
  const R0 = lerp(Q0, Q1), R1 = lerp(Q1, Q2);
  const S = lerp(R0, R1);
  return { left: [P0, Q0, R0, S], right: [S, R1, Q2, P3] };
}

// Compute the 6 control/endpoint values for the two tip cubics in grid space.
// Uses the per-pixel mapTipPt transformation applied to normalized tip-up coords.
function tipCurveControlPoints(px, py, dir, s, a, b) {
  const as = a * s;
  switch (dir) {
    case "up": return {
      tipC1: { x: px, y: py + as }, tipC2: { x: px + 1 - b, y: py },
      tipApex: { x: px + 0.5, y: py }, tipC3: { x: px + b, y: py },
      tipC4: { x: px + 1, y: py + as }, tipEndPt: { x: px + 1, y: py + s },
    };
    case "down": return {
      tipC1: { x: px + 1, y: py + 1 - as }, tipC2: { x: px + b, y: py + 1 },
      tipApex: { x: px + 0.5, y: py + 1 }, tipC3: { x: px + 1 - b, y: py + 1 },
      tipC4: { x: px, y: py + 1 - as }, tipEndPt: { x: px, y: py + 1 - s },
    };
    case "left": return {
      tipC1: { x: px + as, y: py + 1 }, tipC2: { x: px, y: py + b },
      tipApex: { x: px, y: py + 0.5 }, tipC3: { x: px, y: py + 1 - b },
      tipC4: { x: px + as, y: py }, tipEndPt: { x: px + s, y: py },
    };
    case "right": return {
      tipC1: { x: px + 1 - as, y: py }, tipC2: { x: px + 1, y: py + 1 - b },
      tipApex: { x: px + 1, y: py + 0.5 }, tipC3: { x: px + 1, y: py + b },
      tipC4: { x: px + 1 - as, y: py + 1 }, tipEndPt: { x: px + 1 - s, y: py + 1 },
    };
  }
}

export function squaresToCleanPath(squares, allPixels, rOuter, rInner, connectDiagonals = 0, fullLCorners = false, skipCheckerLCorners = false, connectDiagonalsOrder = "default", tipStyle = "none", tipBase = null) {
  if (squares.size === 0) return { path: "", fillets: "" };

  // --- Pixel classification (authoritative source of truth) ---
  const pixelMap = classifyPixels(squares, allPixels, {
    ro: rOuter, ri: rInner, connectDiagonals, connectDiagonalsOrder, fullLCorners, skipCheckerLCorners,
  });

  // --- Vertex map (pre-computed geometry for every grid vertex) ---
  const vertexMap = computeVertexMap(pixelMap, allPixels, { ro: rOuter, ri: rInner });

  // --- Tip pixel info (derived from pixel map) ---
  const tipPixelInfo = new Map();
  if (tipStyle !== "none") {
    for (const [pk, info] of pixelMap) {
      if (!info.tip) continue;
      const resolvedTip = resolveStyle(tipStyle, TIP_PROFILES, info.x, info.y, 100);
      if (resolvedTip === "none") continue;
      const profile = TIP_PROFILES[resolvedTip];
      if (!profile) continue;
      const base = tipBase ?? profile.base ?? 0;
      tipPixelInfo.set(pk, { dir: info.tip, profile, base, s: 1 - base, name: resolvedTip });
    }
  }

  // --- Tip-aware inner fillet overrides ---
  // When ri > 0 and a concave vertex is adjacent to a tip pixel, the standard
  // grid-aligned fillet endpoint may land inside the tip curve. Override eA/eB
  // in the vertex map with the actual tip-curve intersection point.
  //
  // Per direction: which vertex gets which side override, and how to transform.
  // findTipEdge always works in normalized up-tip space; we transform results.
  const TIP_EA_OVERRIDES = {
    up: {
      left:  { vx: 0, vy: 1, absent: "nw" },
      right: { vx: 1, vy: 1, absent: "ne" },
      toGrid: (px, py, u, v) => ({ x: px + u, y: py + v }),
      tangent: (tx, ty) => ({ tx, ty }),
    },
    down: {
      left:  { vx: 1, vy: 0, absent: "se" },
      right: { vx: 0, vy: 0, absent: "sw" },
      toGrid: (px, py, u, v) => ({ x: px + 1 - u, y: py + 1 - v }),
      tangent: (tx, ty) => ({ tx: -tx, ty: -ty }),
    },
  };
  const TIP_EB_OVERRIDES = {
    right: {
      left:  { vx: 0, vy: 0, absent: "ne" },
      right: { vx: 0, vy: 1, absent: "se" },
      toGrid: (px, py, u, v) => ({ x: px + 1 - v, y: py + u }),
      tangent: (tx, ty) => ({ tx: -ty, ty: tx }),
    },
    left: {
      right: { vx: 1, vy: 0, absent: "nw" },
      left:  { vx: 1, vy: 1, absent: "sw" },
      toGrid: (px, py, u, v) => ({ x: px + v, y: py + 1 - u }),
      tangent: (tx, ty) => ({ tx: ty, ty: -tx }),
    },
  };

  if (rInner > 0 && tipPixelInfo.size > 0) {
    // Normalized cubics (apex → base) — same for all directions in normalized space
    const makeCubics = (a, b, s) => ({
      left:  [{ x: 0.5, y: 0 }, { x: 1 - b, y: 0 }, { x: 0, y: a * s }, { x: 0, y: s }],
      right: [{ x: 0.5, y: 0 }, { x: b, y: 0 }, { x: 1, y: a * s }, { x: 1, y: s }],
    });

    for (const [pk, tipInfo] of tipPixelInfo) {
      if (tipInfo.profile.lobes) continue;
      const overrideSpec = TIP_EA_OVERRIDES[tipInfo.dir];
      if (!overrideSpec) continue; // left/right tips: eB override (not yet implemented)

      const [px, py] = unkey(pk);
      const params = { ...tipInfo.profile, base: tipInfo.base };
      const { a, b } = tipInfo.profile;
      const s = tipInfo.s;
      const cubics = makeCubics(a, b, s);
      const { toGrid, tangent } = overrideSpec;

      for (const side of ["left", "right"]) {
        const edge = findTipEdge(1 - rInner, params, side);
        if (!edge) continue;
        const spec = overrideSpec[side];
        const vk = key(px + spec.vx, py + spec.vy);
        const entry = vertexMap.get(vk);
        if (entry?.concave?.absent !== spec.absent) continue;

        const gridPt = toGrid(px, py, edge.px, edge.py);
        const gridTan = tangent(edge.tx, edge.ty);
        const eA = { px: gridPt.x, py: gridPt.y, tx: gridTan.tx, ty: gridTan.ty };
        entry.concave.eA = eA;
        entry.concave.cp = filletControlPoint(eA, entry.concave.eB);

        // De Casteljau: split cubic at intersection, keep right segment (fillet pt → base)
        const cubic = cubics[side];
        const split = splitCubicAtT(cubic[0], cubic[1], cubic[2], cubic[3], edge.t);
        entry.concave.eATipConnector = split.right.map(p => toGrid(px, py, p.x, p.y));
      }
    }

    // eB overrides for left/right tips (horizontal fillet arm intersects tip curve)
    for (const [pk, tipInfo] of tipPixelInfo) {
      if (tipInfo.profile.lobes) continue;
      const overrideSpec = TIP_EB_OVERRIDES[tipInfo.dir];
      if (!overrideSpec) continue; // up/down tips use eA, not eB

      const [px, py] = unkey(pk);
      const params = { ...tipInfo.profile, base: tipInfo.base };
      const { a, b } = tipInfo.profile;
      const s = tipInfo.s;
      const cubics = makeCubics(a, b, s);
      const { toGrid, tangent } = overrideSpec;

      for (const side of ["left", "right"]) {
        const edge = findTipEdge(1 - rInner, params, side);
        if (!edge) continue;
        const spec = overrideSpec[side];
        const vk = key(px + spec.vx, py + spec.vy);
        const entry = vertexMap.get(vk);
        if (entry?.concave?.absent !== spec.absent) continue;

        const gridPt = toGrid(px, py, edge.px, edge.py);
        const gridTan = tangent(edge.tx, edge.ty);
        const eB = { px: gridPt.x, py: gridPt.y, tx: gridTan.tx, ty: gridTan.ty };
        entry.concave.eB = eB;
        entry.concave.cp = filletControlPoint(entry.concave.eA, eB);

        // De Casteljau: split cubic at intersection, keep right segment (fillet pt → base)
        const cubic = cubics[side];
        const split = splitCubicAtT(cubic[0], cubic[1], cubic[2], cubic[3], edge.t);
        entry.concave.eBTipConnector = split.right.map(p => toGrid(px, py, p.x, p.y));
      }
    }
  }

  // Vertices that are part of a tip curve (suppress checkerboard notches there)
  const tipCurveVertices = new Set();

  // --- Diagonal connections (derived from pixel map) ---
  const diagConnections = new Map(); // vertexKey → "br" | "bl"
  for (const [, info] of pixelMap) {
    if (info.diagBridges.br) diagConnections.set(key(info.x + 1, info.y + 1), "br");
    if (info.diagBridges.bl) diagConnections.set(key(info.x, info.y + 1), "bl");
  }

  // ================================================================
  // Topology layer: findComponents, traceBoundary, findHoles
  // (Same algorithms as contour-paths.mjs, no rendering policy)
  // ================================================================

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

  // Direction constants for boundary tracing
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const RCX = [0, -1, -1, 0];
  const RCY = [0, 0, -1, -1];
  const LCX = [0, 0, -1, -1];
  const LCY = [-1, 0, 0, -1];

  function traceBoundary(comp) {
    let startX = Infinity, startY = Infinity;
    for (const k of comp) {
      const [x, y] = unkey(k);
      if (y < startY || (y === startY && x < startX)) { startX = x; startY = y; }
    }
    let cx = startX, cy = startY, dir = 0;
    const startKey = key(startX, startY);
    const vertices = [];
    do {
      const nextX = snap(cx + DX[dir]);
      const nextY = snap(cy + DY[dir]);
      const aheadRight = comp.has(key(nextX + RCX[dir], nextY + RCY[dir]));
      const aheadLeft = comp.has(key(nextX + LCX[dir], nextY + LCY[dir]));
      if (!aheadRight) {
        vertices.push({ x: nextX, y: nextY, turn: "right" });
        cx = nextX; cy = nextY;
        dir = (dir + 1) % 4;
      } else if (!aheadLeft) {
        vertices.push({ x: nextX, y: nextY, turn: "straight" });
        cx = nextX; cy = nextY;
      } else {
        vertices.push({ x: nextX, y: nextY, turn: "left" });
        cx = nextX; cy = nextY;
        dir = (dir + 3) % 4;
      }
    } while (key(cx, cy) !== startKey || dir !== 0);
    return vertices.filter(v => v.turn !== "straight");
  }

  function findHoles(comp) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k of comp) {
      const [x, y] = unkey(k);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // Flood-fill the exterior (one cell margin)
    const eMinX = minX - 1, eMaxX = maxX + 1, eMinY = minY - 1, eMaxY = maxY + 1;
    const exterior = new Set();
    const stack = [key(eMinX, eMinY)];
    while (stack.length) {
      const cur = stack.pop();
      if (exterior.has(cur)) continue;
      const [x, y] = unkey(cur);
      if (x < eMinX || x > eMaxX || y < eMinY || y > eMaxY) continue;
      if (comp.has(cur)) continue;
      exterior.add(cur);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = key(x + dx, y + dy);
        if (!exterior.has(nk)) stack.push(nk);
      }
    }
    // Interior = cells inside bounding box that are neither component nor exterior
    const holes = [];
    const holeVisited = new Set();
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const k = key(x, y);
        if (comp.has(k) || exterior.has(k) || holeVisited.has(k)) continue;
        // Flood-fill this hole (bounded to component bounding box)
        const hole = new Set();
        const hStack = [k];
        while (hStack.length) {
          const cur = hStack.pop();
          if (holeVisited.has(cur) || comp.has(cur) || exterior.has(cur)) continue;
          const [hx, hy] = unkey(cur);
          if (hx < minX || hx > maxX || hy < minY || hy > maxY) continue;
          holeVisited.add(cur);
          hole.add(cur);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nk = key(hx + dx, hy + dy);
            if (!holeVisited.has(nk) && !comp.has(nk)) hStack.push(nk);
          }
        }
        holes.push(hole);
      }
    }
    return holes;
  }

  function buildLoopEdges(vertices) {
    const n = vertices.length;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const v0 = vertices[i];
      const v1 = vertices[(i + 1) % n];
      const dx = v1.x - v0.x;
      const dy = v1.y - v0.y;
      const len = Math.abs(dx) + Math.abs(dy);
      edges.push({ dx, dy, len });
    }
    return edges;
  }

  // Trace hole boundary: trace hole cells CW then reverse to get CCW winding.
  // Same approach as contour-paths.mjs traceHoleBoundary.
  function traceHoleBoundary(holeComp) {
    const verts = traceBoundary(holeComp);
    verts.reverse();
    for (const v of verts) {
      if (v.turn === "right") v.turn = "left";
      else if (v.turn === "left") v.turn = "right";
    }
    return verts;
  }

  // ================================================================
  // Diagonal splice helpers (ported from contour-paths.mjs)
  // ================================================================

  function spliceLoopsAtVertex(loop1, loop2, vx, vy) {
    const i1 = loop1.findIndex(v => v.x === vx && v.y === vy && v.turn === "right");
    const i2 = loop2.findIndex(v => v.x === vx && v.y === vy && v.turn === "right");
    if (i1 < 0 || i2 < 0) return null;

    const n1 = loop1.length, n2 = loop2.length;
    const rot1 = [];
    for (let j = 1; j < n1; j++) rot1.push(loop1[(i1 + j) % n1]);
    const rot2 = [];
    for (let j = 1; j < n2; j++) rot2.push(loop2[(i2 + j) % n2]);

    const bridge1 = { x: vx, y: vy, turn: "left", bridge: true };
    const bridge2 = { x: vx, y: vy, turn: "left", bridge: true };
    return [...rot1, bridge1, ...rot2, bridge2];
  }

  function splitLoopAtCycleClosing(loop, vx, vy) {
    const indices = [];
    for (let i = 0; i < loop.length; i++) {
      if (loop[i].x === vx && loop[i].y === vy && loop[i].turn === "right") {
        indices.push(i);
      }
    }
    if (indices.length < 2) return null;

    const [i1, i2] = indices;
    const n = loop.length;
    const seg1 = [];
    for (let j = i1 + 1; j !== i2; j = (j + 1) % n) seg1.push(loop[j]);
    const seg2 = [];
    for (let j = i2 + 1; j !== i1; j = (j + 1) % n) seg2.push(loop[j]);

    const bridge = { x: vx, y: vy, turn: "left", bridge: true };
    let outerSeg, holeSeg;
    if (seg1.length >= seg2.length) { outerSeg = seg1; holeSeg = seg2; }
    else { outerSeg = seg2; holeSeg = seg1; }

    const outer = [...outerSeg, { ...bridge }];
    const hole = holeSeg.map(v => ({ ...v }));
    hole.push({ x: vx, y: vy, turn: "left", bridge: true });
    return { outer, hole };
  }

  // ================================================================
  // Planning layer: derive vertex plans from pixel map
  // ================================================================

  // Derive the rendering plan for grid vertex (vx, vy) using vertexMap.
  function vertexPlan(vx, vy, turn, flags = {}) {
    if (flags.bridge) {
      return rInner > 0
        ? { radius: rInner, mode: "innerFillet" }
        : { radius: 0, mode: "sharp" };
    }

    const v = vertexMap.get(key(vx, vy));
    if (!v) return { radius: 0, mode: "sharp" };

    if (turn === "right") {
      if (v.convex) {
        const { radius, isLCorner, lcDir } = v.convex;
        if (isLCorner) return { radius: 1, mode: "fullLCornerArc", lcDir };
        return radius > 0 ? { radius, mode: "outerArc" } : { radius: 0, mode: "sharp" };
      }
      if (v.pattern === "checkerboard") return { radius: 0, mode: "sharp" };
      return { radius: 0, mode: "sharp" };
    }

    if (turn === "left") {
      if (v.concave && rInner > 0 && v.concave.eA)
        return { radius: rInner, mode: "innerFillet" };
      if (v.checkerboard?.lcTransition)
        return { radius: 0, mode: "lcArcTransition" };
      if (v.checkerboard?.bridged && rInner > 0)
        return { radius: rInner, mode: "innerFillet" };
      return { radius: 0, mode: "sharp" };
    }

    return { radius: 0, mode: "sharp" };
  }

  function buildLoopPlans(vertices, edges, _dbgHole) {
    const n = vertices.length;
    const plans = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = vertices[i];
      let plan = vertexPlan(v.x, v.y, v.turn, { bridge: v.bridge });
      const _dbgInitial = _dbgHole ? `${plan.mode}(r=${plan.radius})` : null;

      // At checkerboard right-turn vertices, vertexPlan returns "sharp" because
      // it sees 2-filled diagonal. Use edge direction to pick the owner whose
      // corner the boundary is rounding, then upgrade the plan using owners[].
      const vInfo = plan.mode === "sharp" && v.turn === "right"
        ? vertexMap.get(key(v.x, v.y)) : null;
      if (vInfo?.pattern === "checkerboard") {
        const inEdge = edges[(i - 1 + n) % n];
        const inDx = Math.sign(inEdge.dx), inDy = Math.sign(inEdge.dy);
        // Left-of-travel corner name for each incoming direction
        const cornerName = inDx === 1 ? "tr" : inDy === 1 ? "br" : inDx === -1 ? "bl" : "tl";
        const owner = vInfo.checkerboard.owners.find(o => o.corner === cornerName);
        if (owner) {
          if (owner.isLCorner && fullLCorners) {
            plan = { radius: 1, mode: "fullLCornerArc", lcDir: owner.corner.toUpperCase() };
          } else if (owner.radius > 0) {
            plan = { radius: owner.radius, mode: "outerArc" };
          }
        }
      }

      // Tip curve detection: for right-turn vertices that own a tip pixel's
      // tip-end corner, replace the outer arc with a tip curve plan.
      if (v.turn === "right" && tipPixelInfo.size > 0 && plan.mode !== "tipCurve" && plan.mode !== "tipCurveEnd") {
        const tipInEdge = edges[(i - 1 + n) % n];
        const tipInDx = Math.sign(tipInEdge.dx), tipInDy = Math.sign(tipInEdge.dy);
        const tipCorner = tipInDx === 1 ? "tr" : tipInDy === 1 ? "br" : tipInDx === -1 ? "bl" : "tl";
        const ownerKey = tipCorner === "tl" ? key(v.x, v.y)
                       : tipCorner === "tr" ? key(v.x - 1, v.y)
                       : tipCorner === "br" ? key(v.x - 1, v.y - 1)
                       : key(v.x, v.y - 1);
        const tipInfo = tipPixelInfo.get(ownerKey);
        if (tipInfo && !tipInfo.profile.lobes) {
          const roles = TIP_CURVE_ROLES[tipInfo.dir];
          if (roles) {
            const [px, py] = unkey(ownerKey);
            const { s, profile: { a, b } } = tipInfo;
            if (tipCorner === roles.tipCurve) {
              const pts = tipCurveControlPoints(px, py, tipInfo.dir, s, a, b);
              plan = { mode: "tipCurve", radius: s, ...pts };
              tipCurveVertices.add(key(v.x, v.y));
            } else if (tipCorner === roles.tipCurveEnd) {
              const pts = tipCurveControlPoints(px, py, tipInfo.dir, s, a, b);
              plan = { mode: "tipCurveEnd", radius: 0, tipEndPt: pts.tipEndPt };
              tipCurveVertices.add(key(v.x, v.y));
            }
          }
        }
      }

      // For fullLCornerArc, compute shorten flags (same logic as contour)
      if (plan.mode === "fullLCornerArc") {
        const prevI = (i - 1 + n) % n;
        const nextI = (i + 1) % n;
        plan.shortenStart = vertices[prevI].turn === "left" && edges[(i - 1 + n) % n].len <= 1;
        plan.shortenEnd = vertices[nextI].turn === "left" && edges[i].len <= 1;
      }


      plans[i] = plan;
      if (_dbgHole) {
        const final = `${plan.mode}(r=${plan.radius}${plan.lcDir ? ','+plan.lcDir : ''}${plan.shortenStart ? ',shStart' : ''}${plan.shortenEnd ? ',shEnd' : ''})`;
        console.log(`  [plan] i=${i} v=(${v.x},${v.y}) turn=${v.turn} initial=${_dbgInitial} → final=${final}`);
      }
    }
    return plans;
  }

  // ================================================================
  // Serialization layer
  // ================================================================

  const LC_DIRS = {
    TL: { pdx: 0, pdy: -1, odx: 1, ody: 0 },
    TR: { pdx: 1, pdy: 0, odx: 0, ody: 1 },
    BL: { pdx: -1, pdy: 0, odx: 0, ody: -1 },
    BR: { pdx: 0, pdy: 1, odx: -1, ody: 0 },
  };

  function serializeLoopPath(vertices, edges, plans, ro, ri, isHole) {
    if (vertices.length === 0) return "";
    const _dbg = isHole;
    const p = [];
    const n = vertices.length;

    const r0 = plans[0].radius;
    const lastEdge = edges[n - 1];
    let prevDx = Math.sign(lastEdge.dx);
    let prevDy = Math.sign(lastEdge.dy);
    let startX = vertices[0].x - prevDx * r0;
    let startY = vertices[0].y - prevDy * r0;

    // If the first vertex is an innerFillet with arc-displaced arrival,
    // use the actual fillet arrival point so z-close matches.
    if (plans[0].mode === "innerFillet") {
      const v0Info = vertexMap.get(key(vertices[0].x, vertices[0].y));
      if (v0Info?.concave?.eA) {
        const arrivalPt = (prevDy !== 0) ? v0Info.concave.eA : v0Info.concave.eB;
        startX = arrivalPt.px;
        startY = arrivalPt.py;
      }
    } else if (plans[0].mode === "tipCurveEnd") {
      startX = plans[0].tipEndPt.x;
      startY = plans[0].tipEndPt.y;
    }

    p.push(`M${fmt(startX)},${fmt(startY)}`);
    if (_dbg) console.log(`  [ser] M(${fmt(startX)},${fmt(startY)})`);
    const sweep = 1;

    for (let i = 0; i < n; i++) {
      const r = plans[i].radius;
      const edge = edges[i];
      const nextI = (i + 1) % n;
      const rNext = plans[nextI].radius;
      const odx = Math.sign(edge.dx);
      const ody = Math.sign(edge.dy);

      // Track absolute pen position when it deviates from grid-aligned expectation.
      // null means pen is at the expected grid position (vertex ± r along edge).
      let departurePt = null;

      if (plans[i].mode === "tipCurve") {
        // Tip curve: emit two cubics from start-base through apex to end-base
        const { tipC1, tipC2, tipApex, tipC3, tipC4, tipEndPt } = plans[i];
        p.push(`C${fmt(tipC1.x)},${fmt(tipC1.y)},${fmt(tipC2.x)},${fmt(tipC2.y)},${fmt(tipApex.x)},${fmt(tipApex.y)}`);
        p.push(`C${fmt(tipC3.x)},${fmt(tipC3.y)},${fmt(tipC4.x)},${fmt(tipC4.y)},${fmt(tipEndPt.x)},${fmt(tipEndPt.y)}`);
        departurePt = tipEndPt;
      } else if (plans[i].mode === "tipCurveEnd") {
        // Tip curve already landed here — just record pen position for next edge
        departurePt = plans[i].tipEndPt;
      } else if (vertices[i].turn === "right" && r > 0) {
        if (plans[i].mode === "fullLCornerArc") {
          const lcDir = plans[i].lcDir;
          const { pdx, pdy, odx: lodx, ody: lody } = LC_DIRS[lcDir];
          const { shortenEnd } = plans[i];

          if (shortenEnd) {
            const nvInfo = vertexMap.get(key(vertices[nextI].x, vertices[nextI].y));
            const pt = (ody !== 0) ? nvInfo.concave.eA : nvInfo.concave.eB;
            p.push(`A1,1,0,0,${sweep},${fmt(pt.px)},${fmt(pt.py)}`);
            departurePt = { x: pt.px, y: pt.py };
            if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: fullLCornerArc(shEnd) → A to (${fmt(pt.px)},${fmt(pt.py)}) departurePt=SET`);
          } else {
            const tgtX = vertices[i].x + lodx * r;
            const tgtY = vertices[i].y + lody * r;
            p.push(`A1,1,0,0,${sweep},${fmt(tgtX)},${fmt(tgtY)}`);
            if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: fullLCornerArc → A to (${fmt(tgtX)},${fmt(tgtY)})`);
          }
        } else {
          const adx = fmt(odx * r + prevDx * r);
          const ady = fmt(ody * r + prevDy * r);
          p.push(`a${fmt(r)},${fmt(r)},0,0,${sweep},${adx},${ady}`);
          if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: outerArc → a(${adx},${ady})`);
        }
      } else if (vertices[i].turn === "left" && r > 0) {
        // Inner fillet: look up pre-computed geometry from vertexMap.
        const vInfo = vertexMap.get(key(vertices[i].x, vertices[i].y));
        if (vInfo?.concave?.eA) {
          const { eA, eB, cp, aOnArc, bOnArc } = vInfo.concave;
          const endPt = (ody !== 0) ? eA : eB;
          p.push(`Q${fmt(cp.x)},${fmt(cp.y)},${fmt(endPt.px)},${fmt(endPt.py)}`);
          const departureOnArc = (ody !== 0) ? aOnArc : bOnArc;
          const hasTipConnector = (ody !== 0) ? vInfo.concave.eATipConnector : vInfo.concave.eBTipConnector;
          if (departureOnArc || hasTipConnector) departurePt = { x: endPt.px, y: endPt.py };
          if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: innerFillet → Q to (${fmt(endPt.px)},${fmt(endPt.py)}) pick=${ody!==0?'eA':'eB'} departurePt=${departureOnArc?'SET':'null'}`);
        } else {
          p.push(`q${fmt(prevDx * r)},${fmt(prevDy * r)},${fmt(prevDx * r + odx * r)},${fmt(prevDy * r + ody * r)}`);
          if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: innerFillet(fallback) → q`);
        }
      } else if (plans[i].mode === "lcArcTransition") {
        p.push(`L${fmt(vertices[i].x)},${fmt(vertices[i].y)}`);
        departurePt = { x: vertices[i].x, y: vertices[i].y };
        if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: lcArcTransition → L(${vertices[i].x},${vertices[i].y}) departurePt=SET`);
      } else {
        if (_dbg) console.log(`  [ser] i=${i} v=(${vertices[i].x},${vertices[i].y}) VERTEX: (none) mode=${plans[i].mode} r=${r} turn=${vertices[i].turn}`);
      }

      // --- Edge segment from vertex i to vertex i+1 ---
      if (departurePt) {
        // Pen is at an absolute position that may be off-grid.
        // Compute the target: where the next vertex expects the pen to arrive.
        const nextV = vertices[nextI];

        // If the next vertex is a fullLCornerArc with shortenStart, it starts
        // exactly at our current pen position — no edge needed.
        if (plans[nextI].mode === "fullLCornerArc" && plans[nextI].shortenStart) {
          // Arc picks up from current pen — skip edge.
          if (_dbg) console.log(`  [ser] i=${i} EDGE: departurePt=(${fmt(departurePt.x)},${fmt(departurePt.y)}) → skip (next shStart)`);
        // Tip-curve connecting edge: if the departurePt is on a tip curve and
        // the edge follows the curve (fillet→tipBase or tipBase→fillet), emit a
        // De Casteljau-split cubic instead of a straight line.
        } else if (plans[nextI].mode === "tipCurve") {
          // Case A: fillet → tipCurve base (current vertex is concave with connector)
          const curVInfo = vertexMap.get(key(vertices[i].x, vertices[i].y));
          const connector = (ody !== 0)
            ? curVInfo?.concave?.eATipConnector
            : curVInfo?.concave?.eBTipConnector;
          if (connector) {
            p.push(`C${fmt(connector[1].x)},${fmt(connector[1].y)},${fmt(connector[2].x)},${fmt(connector[2].y)},${fmt(connector[3].x)},${fmt(connector[3].y)}`);
          } else {
            // No connector — standard edge (straight line to tip base)
            const tgt = plans[nextI];
            const targetX = vertices[nextI].x - odx * tgt.radius;
            const targetY = vertices[nextI].y - ody * tgt.radius;
            p.push(`L${fmt(targetX)},${fmt(targetY)}`);
          }
        } else if (plans[i].mode === "tipCurveEnd" && vertices[nextI].turn === "left") {
          // Case B: tipCurveEnd base → fillet (next vertex is concave with connector)
          // Only valid when the connector's base (connector[3]) matches our departurePt,
          // meaning this tipCurveEnd and the fillet belong to the same tip pixel.
          const nextVInfo = vertexMap.get(key(vertices[nextI].x, vertices[nextI].y));
          // Check both eA and eB connectors — pick the one whose base matches departurePt
          const eAConn = nextVInfo?.concave?.eATipConnector;
          const eBConn = nextVInfo?.concave?.eBTipConnector;
          const matchesA = eAConn &&
            Math.abs(eAConn[3].x - departurePt.x) < 0.001 &&
            Math.abs(eAConn[3].y - departurePt.y) < 0.001;
          const matchesB = eBConn &&
            Math.abs(eBConn[3].x - departurePt.x) < 0.001 &&
            Math.abs(eBConn[3].y - departurePt.y) < 0.001;
          const connector = matchesA ? eAConn : matchesB ? eBConn : null;
          if (connector) {
            // Reverse the connector: base→fillet is [P3,P2,P1,P0] of the forward connector
            p.push(`C${fmt(connector[2].x)},${fmt(connector[2].y)},${fmt(connector[1].x)},${fmt(connector[1].y)},${fmt(connector[0].x)},${fmt(connector[0].y)}`);
          } else {
            // No connector — standard targeting
            const nextVInfoStd = vertexMap.get(key(vertices[nextI].x, vertices[nextI].y));
            if (nextVInfoStd?.concave?.eA) {
              const arrivalPt = (ody !== 0) ? nextVInfoStd.concave.eA : nextVInfoStd.concave.eB;
              p.push(`L${fmt(arrivalPt.px)},${fmt(arrivalPt.py)}`);
            } else {
              const rNext = plans[nextI].radius;
              p.push(`L${fmt(vertices[nextI].x - odx * rNext)},${fmt(vertices[nextI].y - ody * rNext)}`);
            }
          }
        } else {
          let targetX, targetY;
          let _dbgBranch = "";
          if (plans[nextI].mode === "tipCurveEnd") {
            targetX = plans[nextI].tipEndPt.x;
            targetY = plans[nextI].tipEndPt.y;
            _dbgBranch = "tipCurveEnd";
          } else if (plans[nextI].mode === "lcArcTransition") {
            targetX = nextV.x; targetY = nextV.y;
            _dbgBranch = "lcArcTransition";
          } else if (plans[nextI].mode === "innerFillet") {
            // Concave fillet: arrive at the on-arc (or grid-aligned) arrival endpoint
            const nextVInfo = vertexMap.get(key(nextV.x, nextV.y));
            if (nextVInfo?.concave?.eA) {
              const arrivalPt = (ody !== 0) ? nextVInfo.concave.eA : nextVInfo.concave.eB;
              targetX = arrivalPt.px; targetY = arrivalPt.py;
              _dbgBranch = `innerFillet(${ody!==0?'eA':'eB'})`;
            } else {
              targetX = nextV.x - odx * rNext;
              targetY = nextV.y - ody * rNext;
              _dbgBranch = "innerFillet(fallback)";
            }
          } else {
            targetX = nextV.x - odx * rNext;
            targetY = nextV.y - ody * rNext;
            _dbgBranch = `grid(nextMode=${plans[nextI].mode})`;
          }
          const dx = targetX - departurePt.x;
          const dy = targetY - departurePt.y;
          if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
            if (Math.abs(dy) < 0.001) p.push(`h${fmt(dx)}`);
            else if (Math.abs(dx) < 0.001) p.push(`v${fmt(dy)}`);
            else p.push(`L${fmt(targetX)},${fmt(targetY)}`);
            if (_dbg) console.log(`  [ser] i=${i} EDGE: departurePt=(${fmt(departurePt.x)},${fmt(departurePt.y)}) → target=(${fmt(targetX)},${fmt(targetY)}) branch=${_dbgBranch} cmd=${Math.abs(dy)<0.001?'h':'v/L'}`);
          } else {
            if (_dbg) console.log(`  [ser] i=${i} EDGE: departurePt=(${fmt(departurePt.x)},${fmt(departurePt.y)}) → target=(${fmt(targetX)},${fmt(targetY)}) branch=${_dbgBranch} SKIP(zero)`);
          }
        }
      } else {
        // Standard grid-aligned edge: pen is at expected position.
        const edgeLen = edge.len - r - rNext;
        if (edgeLen > 0.001) {
          if (ody === 0) p.push(`h${fmt(odx * edgeLen)}`);
          else p.push(`v${fmt(ody * edgeLen)}`);
          if (_dbg) console.log(`  [ser] i=${i} EDGE: grid edgeLen=${fmt(edgeLen)} dir=(${odx},${ody})`);
        } else {
          if (_dbg) console.log(`  [ser] i=${i} EDGE: grid SKIP(len=${fmt(edgeLen)})`);
        }
      }

      prevDx = odx;
      prevDy = ody;
    }

    p.push("z");
    return p.join("");
  }

  // ================================================================
  // Checkerboard notch emission
  // ================================================================

  function emitCheckerboardNotches(verts, ro, emittedSet) {
    if (ro <= 0) return "";
    const parts = [];
    for (const v of verts) {
      if (vertexMap.get(key(v.x, v.y))?.pattern !== "checkerboard") continue;
      const vk = key(v.x, v.y);
      if (emittedSet.has(vk)) continue;
      if (diagConnections.has(vk)) continue; // bridge handles geometry
      if (tipCurveVertices.has(vk)) continue; // tip curve covers this vertex
      emittedSet.add(vk);

      const vxf = fmt(v.x), vyf = fmt(v.y);
      const hasNW = allPixels.has(key(v.x - 1, v.y - 1));
      const hasNE = allPixels.has(key(v.x, v.y - 1));
      const hasSE = allPixels.has(key(v.x, v.y));
      const hasSW = allPixels.has(key(v.x - 1, v.y));

      if (hasNW && hasSE) {
        // NW-SE diagonal: look up each pixel's corner radius from pixel map
        const nwInfo = pixelMap.get(key(v.x - 1, v.y - 1));
        const seInfo = pixelMap.get(key(v.x, v.y));
        const r1 = nwInfo?.corners?.br?.radius ?? ro;
        const r2 = seInfo?.corners?.tl?.radius ?? ro;
        // Only suppress notch when the L-corner arc is actually in a boundary path
        if (!lcArcInBoundary.has(vk + "_BR"))
          parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y - r1)}a${fmt(r1)},${fmt(r1)},0,0,1,${fmt(-r1)},${fmt(r1)}Z`);
        if (!lcArcInBoundary.has(vk + "_TL"))
          parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y + r2)}a${fmt(r2)},${fmt(r2)},0,0,1,${fmt(r2)},${fmt(-r2)}Z`);
      } else if (hasNE && hasSW) {
        const neInfo = pixelMap.get(key(v.x, v.y - 1));
        const swInfo = pixelMap.get(key(v.x - 1, v.y));
        const r1 = neInfo?.corners?.bl?.radius ?? ro;
        const r2 = swInfo?.corners?.tr?.radius ?? ro;
        if (!lcArcInBoundary.has(vk + "_BL"))
          parts.push(`M${vxf},${vyf}L${fmt(v.x + r1)},${vyf}a${fmt(r1)},${fmt(r1)},0,0,1,${fmt(-r1)},${fmt(-r1)}Z`);
        if (!lcArcInBoundary.has(vk + "_TR"))
          parts.push(`M${vxf},${vyf}L${fmt(v.x - r2)},${vyf}a${fmt(r2)},${fmt(r2)},0,0,1,${fmt(r2)},${fmt(r2)}Z`);
      }
    }
    return parts.join("");
  }

  // ================================================================
  // Winding check for holes
  // ================================================================
  function windingFromVertices(verts, px, py) {
    let winding = 0;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % n];
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

  // ================================================================
  // Main assembly
  // ================================================================

  const components = findComponents(squares);
  const pathParts = [];
  const emittedNotches = new Set();
  const lcArcInBoundary = new Set(); // tracks "vx,vy_dir" for arcs in boundary paths at checkerboard vertices
  const deferredNotchLoops = []; // vertex arrays for deferred notch emission

  // Pass 1: trace boundary, record arcs, serialize path (no notches yet)
  function prepareLoop(verts, isHole) {
    if (isHole) console.log(`\n[HOLE LOOP] ${verts.length} vertices: ${verts.map(v => `(${v.x},${v.y})${v.turn[0]}`).join(' → ')}`);
    const edges = buildLoopEdges(verts);
    const plans = buildLoopPlans(verts, edges, isHole);
    // Record which checkerboard vertices have arcs in this boundary
    for (let i = 0; i < verts.length; i++) {
      if (vertexMap.get(key(verts[i].x, verts[i].y))?.pattern === "checkerboard" && plans[i].radius > 0 && verts[i].turn === "right") {
        const inEdge = edges[(i - 1 + verts.length) % verts.length];
        const inDx = Math.sign(inEdge.dx), inDy = Math.sign(inEdge.dy);
        let dir;
        if (inDx === 1) dir = "TR";
        else if (inDy === 1) dir = "BR";
        else if (inDx === -1) dir = "BL";
        else dir = "TL";
        lcArcInBoundary.add(key(verts[i].x, verts[i].y) + "_" + dir);
      }
    }
    pathParts.push(serializeLoopPath(verts, edges, plans, rOuter, rInner, isHole));
    deferredNotchLoops.push(verts);
  }

  // Pass 2: emit notches after all boundaries have been recorded
  function emitDeferredNotches() {
    for (const verts of deferredNotchLoops) {
      const notches = emitCheckerboardNotches(verts, rOuter, emittedNotches);
      if (notches) pathParts.push(notches);
    }
    deferredNotchLoops.length = 0;
  }

  // Splice two hole loops at a shared lcTransition vertex.
  // Each loop has the vertex as a left turn; in the merged loop it appears
  // twice as a right turn (the "waist" of the peanut-shaped hole).
  function spliceHoleLoopsAtVertex(loop1, loop2, vx, vy) {
    const i1 = loop1.findIndex(v => v.x === vx && v.y === vy);
    const i2 = loop2.findIndex(v => v.x === vx && v.y === vy);
    if (i1 < 0 || i2 < 0) return null;

    const n1 = loop1.length, n2 = loop2.length;
    // Rotate both loops so the shared vertex is excluded, then join with
    // two right-turn copies of the shared vertex as bridges.
    const rot1 = [];
    for (let j = 1; j < n1; j++) rot1.push(loop1[(i1 + j) % n1]);
    const rot2 = [];
    for (let j = 1; j < n2; j++) rot2.push(loop2[(i2 + j) % n2]);

    return [...rot1, { x: vx, y: vy, turn: "right" }, ...rot2, { x: vx, y: vy, turn: "right" }];
  }

  // Merge lcTransition holes and emit them.
  // `holes` is an array of pixel-key Sets already validated as inside the boundary.
  function mergeAndEmitHoles(holes) {
    if (holes.length < 2) {
      for (const hole of holes) prepareLoop(traceHoleBoundary(hole), true);
      return;
    }

    const holeLoops = holes.map(h => traceHoleBoundary(h));

    // Map each hole pixel to its loop index
    const pixelToLoop = new Map();
    for (let i = 0; i < holes.length; i++) {
      for (const pk of holes[i]) pixelToLoop.set(pk, i);
    }

    // Union-find: tracks which slot holds the merged loop for each hole group.
    // Roots always point to the slot containing the live loop data.
    const parent = holes.map((_, i) => i);
    function ufFind(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    // Find checkerboard vertices between holes and splice them immediately.
    // Any non-bridged checkerboard vertex where both empty quadrants are holes
    // triggers a merge (not just lcTransition — the owner lookup in buildLoopPlans
    // determines the correct arc radius for each splice direction).
    // Doing discovery+splice in one pass avoids stale-index problems.
    for (const [, v] of vertexMap) {
      if (!v.checkerboard || v.checkerboard.bridged) continue;
      const { occupancy } = v;
      let emptyA, emptyB;
      if (!occupancy.nw && !occupancy.se) {
        emptyA = key(v.vx - 1, v.vy - 1);
        emptyB = key(v.vx, v.vy);
      } else {
        emptyA = key(v.vx, v.vy - 1);
        emptyB = key(v.vx - 1, v.vy);
      }
      const lA = pixelToLoop.get(emptyA);
      const lB = pixelToLoop.get(emptyB);
      if (lA === undefined || lB === undefined) continue;
      const slotA = ufFind(lA), slotB = ufFind(lB);
      if (slotA === slotB) continue;
      const merged = spliceHoleLoopsAtVertex(holeLoops[slotA], holeLoops[slotB], v.vx, v.vy);
      if (merged) {
        holeLoops[slotA] = merged;
        holeLoops[slotB] = null;
        parent[slotB] = slotA;
      }
    }

    // Emit surviving loops
    for (let i = 0; i < holeLoops.length; i++) {
      if (holeLoops[i]) prepareLoop(holeLoops[i], true);
    }
  }

  // Helper: prepare a component with its holes (no diagonal splicing)
  function prepareComponent(comp) {
    const outerVerts = traceBoundary(comp);
    prepareLoop(outerVerts, false);
    const holes = findHoles(comp);
    const validHoles = holes.filter(hole => {
      const [hx, hy] = unkey([...hole][0]);
      return windingFromVertices(outerVerts, hx + 0.5, hy + 0.5) !== 0;
    });
    mergeAndEmitHoles(validHoles);
  }

  if (diagConnections.size === 0) {
    // No diagonals — simple per-component path (preserves existing behavior)
    for (const comp of components) {
      prepareComponent(comp);
    }
    emitDeferredNotches();
  } else {
    // --- Diagonal splicing ---

    // Build pixel → component index lookup
    const pixelToComp = new Map();
    for (let ci = 0; ci < components.length; ci++) {
      for (const pk of components[ci]) pixelToComp.set(pk, ci);
    }

    // Classify diagonals and build super-components via union-find
    const parent = components.map((_, i) => i);
    function ufFind(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function ufUnion(a, b) { const ra = ufFind(a), rb = ufFind(b); if (ra !== rb) parent[ra] = rb; }

    const diagInfo = new Map();
    for (const [vk, dir] of diagConnections) {
      const [vx, vy] = unkey(vk);
      let pkA, pkB;
      if (dir === "br") {
        pkA = key(vx - 1, vy - 1);
        pkB = key(vx, vy);
      } else {
        pkA = key(vx, vy - 1);
        pkB = key(vx - 1, vy);
      }
      const ciA = pixelToComp.get(pkA), ciB = pixelToComp.get(pkB);
      const sameComp = ciA !== undefined && ciB !== undefined && ciA === ciB;
      diagInfo.set(vk, { dir, pkA, pkB, ciA, ciB, sameComp });
      if (ciA !== undefined && ciB !== undefined && ufFind(ciA) !== ufFind(ciB)) {
        ufUnion(ciA, ciB);
      }
    }

    // Group components into super-components
    const superCompMap = new Map();
    for (let ci = 0; ci < components.length; ci++) {
      const root = ufFind(ci);
      if (!superCompMap.has(root)) superCompMap.set(root, []);
      superCompMap.get(root).push(ci);
    }

    for (const [, compIndices] of superCompMap) {
      // Collect diagonals within this super-component
      const scDiags = [];
      for (const [vk, info] of diagInfo) {
        if (info.ciA === undefined || info.ciB === undefined) continue;
        if (!compIndices.includes(info.ciA) && !compIndices.includes(info.ciB)) continue;
        const [vx, vy] = unkey(vk);
        scDiags.push({ vk, vx, vy, ...info });
      }

      if (scDiags.length === 0) {
        // No diagonals in this super-component — process independently
        for (const ci of compIndices) {
          prepareComponent(components[ci]);
        }
      } else {
        // Merge pixel sets for the super-component
        const superPixels = new Set();
        for (const ci of compIndices) {
          for (const pk of components[ci]) superPixels.add(pk);
        }

        // Trace outer boundaries for all constituent components
        const loopMap = new Map();
        for (const ci of compIndices) {
          loopMap.set(ci, traceBoundary(components[ci]));
        }

        const cycleHoles = [];

        // Phase 1: Same-component diagonals (pinch points → split into outer + hole)
        for (const diag of scDiags) {
          if (!diag.sameComp) continue;
          const loop = loopMap.get(diag.ciA);
          const split = splitLoopAtCycleClosing(loop, diag.vx, diag.vy);
          if (split) {
            loopMap.set(diag.ciA, split.outer);
            cycleHoles.push(split.hole);
          } else {
            // Prior split may have sent one visit to a hole loop
            for (let hi = 0; hi < cycleHoles.length; hi++) {
              const hSplit = splitLoopAtCycleClosing(cycleHoles[hi], diag.vx, diag.vy);
              if (hSplit) {
                cycleHoles[hi] = hSplit.outer;
                cycleHoles.push(hSplit.hole);
                break;
              }
            }
          }
        }

        // Phase 2: Different-component diagonals (merges + cycle-closing)
        const compToLoop = new Map();
        const loops = new Map();
        let loopCounter = 0;
        for (const ci of compIndices) {
          const lk = loopCounter++;
          compToLoop.set(ci, lk);
          loops.set(lk, loopMap.get(ci));
        }

        for (const diag of scDiags) {
          if (diag.sameComp) continue;
          const lk1 = compToLoop.get(diag.ciA);
          const lk2 = compToLoop.get(diag.ciB);
          if (lk1 === lk2) {
            // Cycle-closing: both components already in same loop
            const loop = loops.get(lk1);
            const split = splitLoopAtCycleClosing(loop, diag.vx, diag.vy);
            if (split) {
              loops.set(lk1, split.outer);
              cycleHoles.push(split.hole);
            } else {
              // Search hole loops
              for (let hi = 0; hi < cycleHoles.length; hi++) {
                const hSplit = splitLoopAtCycleClosing(cycleHoles[hi], diag.vx, diag.vy);
                if (hSplit) {
                  cycleHoles[hi] = hSplit.outer;
                  cycleHoles.push(hSplit.hole);
                  break;
                }
              }
            }
          } else {
            // Different loops — merge
            const loop1 = loops.get(lk1);
            const loop2 = loops.get(lk2);
            const merged = spliceLoopsAtVertex(loop1, loop2, diag.vx, diag.vy);
            if (merged) {
              loops.delete(lk2);
              loops.set(lk1, merged);
              for (const [ci, lk] of compToLoop) {
                if (lk === lk2) compToLoop.set(ci, lk1);
              }
            } else {
              // Orphan-into-hole fallback: a Phase 1 split may have sent the
              // vertex to a hole loop. Splice the orphan component into that hole.
              const in1 = loop1.some(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right");
              const in2 = loop2.some(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right");
              const orphanLoop = in2 ? loop2 : in1 ? loop1 : null;
              const orphanLk = in2 ? lk2 : in1 ? lk1 : null;
              const keepLk = in2 ? lk1 : in1 ? lk2 : null;
              if (orphanLoop) {
                for (let hi = 0; hi < cycleHoles.length; hi++) {
                  const result = spliceLoopsAtVertex(cycleHoles[hi], orphanLoop, diag.vx, diag.vy);
                  if (result) {
                    cycleHoles[hi] = result;
                    loops.delete(orphanLk);
                    for (const [ci, lk] of compToLoop) {
                      if (lk === orphanLk) compToLoop.set(ci, keepLk);
                    }
                    break;
                  }
                }
              }
            }
          }
        }

        // Emit all outer loops
        for (const [, loop] of loops) {
          prepareLoop(loop, false);
        }

        // Emit cycle-closing hole loops
        for (const hole of cycleHoles) {
          prepareLoop(hole, true);
        }

        // Re-detect holes on the merged super-component pixel set.
        // Filter out holes already covered by cycle-closing holes.
        const holes = findHoles(superPixels);
        const outerLoops = [...loops.values()];
        const neededHoles = holes.filter(hole => {
          const testCell = hole.values().next().value;
          const [tx, ty] = unkey(testCell);
          const px = tx + 0.5, py = ty + 0.5;
          let w = 0;
          for (const loop of outerLoops) w += windingFromVertices(loop, px, py);
          for (const ch of cycleHoles) w += windingFromVertices(ch, px, py);
          return w !== 0;
        });
        mergeAndEmitHoles(neededHoles);
      }
    }
    emitDeferredNotches();
  }

  return { path: pathParts.join(" "), fillets: "" };
}
