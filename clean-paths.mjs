/**
 * Clean-path SVG rendering: non-overlapping boundary paths driven by
 * per-pixel classification.
 *
 * Uses the shared pixel classifier (pixel-classify.mjs) as the source
 * of truth for corner radii, then assembles clean boundary loops using
 * standard contour topology (findComponents, traceBoundary, findHoles).
 */

import { key, unkey, snap, fmt } from './pixel-paths.mjs';
import { classifyPixels } from './pixel-classify.mjs';

export function squaresToCleanPath(squares, allPixels, rOuter, rInner, connectDiagonals = 0, fullLCorners = false, skipCheckerLCorners = false) {
  if (squares.size === 0) return { path: "", fillets: "" };

  // --- Pixel classification (authoritative source of truth) ---
  const pixelMap = classifyPixels(squares, allPixels, {
    ro: rOuter, ri: rInner, connectDiagonals, fullLCorners, skipCheckerLCorners,
  });

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
        // Flood-fill this hole
        const hole = new Set();
        const hStack = [k];
        while (hStack.length) {
          const cur = hStack.pop();
          if (holeVisited.has(cur) || comp.has(cur)) continue;
          holeVisited.add(cur);
          hole.add(cur);
          const [hx, hy] = unkey(cur);
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

  // At grid vertex (vx, vy), determine the rendering plan based on the pixel map.
  // The four pixels touching this vertex are:
  //   NW = (vx-1, vy-1)  → its BR corner
  //   NE = (vx, vy-1)    → its BL corner
  //   SE = (vx, vy)      → its TL corner
  //   SW = (vx-1, vy)    → its TR corner
  function vertexPlan(vx, vy, turn, flags = {}) {
    // Bridge vertices (inserted by diagonal splicing) are synthetic left-turn
    // vertices at checkerboard positions. They must bypass the normal 2-filled
    // "sharp checkerboard" branch and instead produce an inner fillet.
    if (flags.bridge) {
      return rInner > 0
        ? { radius: rInner, mode: "innerFillet" }
        : { radius: 0, mode: "sharp" };
    }
    const nwKey = key(vx - 1, vy - 1), neKey = key(vx, vy - 1);
    const seKey = key(vx, vy), swKey = key(vx - 1, vy);
    const nw = pixelMap.get(nwKey), ne = pixelMap.get(neKey);
    const se = pixelMap.get(seKey), sw = pixelMap.get(swKey);
    const filled = (nw ? 1 : 0) + (ne ? 1 : 0) + (se ? 1 : 0) + (sw ? 1 : 0);

    if (turn === "right") {
      // Convex corner: exactly 1 filled pixel touches this vertex.
      // Look up that pixel's corner radius at this vertex.
      if (filled === 1) {
        let r = 0;
        if (nw) r = nw.corners.br.rounded ? nw.corners.br.radius : 0;
        else if (ne) r = ne.corners.bl.rounded ? ne.corners.bl.radius : 0;
        else if (se) r = se.corners.tl.rounded ? se.corners.tl.radius : 0;
        else if (sw) r = sw.corners.tr.rounded ? sw.corners.tr.radius : 0;

        if (r === 1) {
          // Full-radius L-corner: determine direction
          let lcDir = null;
          if (se) lcDir = "TL";
          else if (sw) lcDir = "TR";
          else if (nw) lcDir = "BR";
          else if (ne) lcDir = "BL";
          return { radius: 1, mode: "fullLCornerArc", lcDir };
        }
        return r > 0 ? { radius: r, mode: "outerArc" } : { radius: 0, mode: "sharp" };
      }
      // 2 filled diagonal (checkerboard) at a right turn — treat as sharp
      if (filled === 2) {
        const isDiag = (nw && se && !ne && !sw) || (ne && sw && !nw && !se);
        if (isDiag) return { radius: 0, mode: "sharp" };
      }
      // Shouldn't normally hit this for right turns
      return { radius: 0, mode: "sharp" };
    }

    if (turn === "left") {
      // Concave corner: 3 filled pixels. The empty pixel's opposite corner
      // determines the fillet. Or 2 filled diagonal (checkerboard) at a left turn.
      if (filled === 3 && rInner > 0) {
        // Check which pixel is absent — the fillet fills that gap
        const absentCorner = !nw ? "TL" : !ne ? "TR" : !se ? "BR" : "BL";
        // Check if the pixel map says there's an inner fillet here.
        // The fillet flag is on the pixel opposite the empty corner.
        let hasFillet = false;
        if (absentCorner === "TL") hasFillet = se?.innerFillets?.tl ?? false;
        else if (absentCorner === "TR") hasFillet = sw?.innerFillets?.tr ?? false;
        else if (absentCorner === "BR") hasFillet = nw?.innerFillets?.br ?? false;
        else if (absentCorner === "BL") hasFillet = ne?.innerFillets?.bl ?? false;
        if (hasFillet) return { radius: rInner, mode: "innerFillet" };
      }
      // Checkerboard left turn: 2 diagonally filled
      if (filled === 2) {
        return { radius: 0, mode: "sharp" };
      }
      return { radius: 0, mode: "sharp" };
    }

    return { radius: 0, mode: "sharp" };
  }

  function buildLoopPlans(vertices, edges) {
    const n = vertices.length;
    const plans = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = vertices[i];
      let plan = vertexPlan(v.x, v.y, v.turn, { bridge: v.bridge });

      // At checkerboard right-turn vertices, vertexPlan returns "sharp" because
      // it sees filled=2 from the global pixelMap. Use edge directions to
      // determine which pixel the boundary is rounding, and look up that
      // pixel's actual corner radius from the classifier.
      if (plan.mode === "sharp" && v.turn === "right" && v.checkerboard) {
        const inEdge = edges[(i - 1 + n) % n];
        const inDx = Math.sign(inEdge.dx), inDy = Math.sign(inEdge.dy);
        // For CCW boundary at a right turn, the pixel is to the left of travel.
        let pxKey, cornerName, lcDir;
        if (inDx === 1) {        // incoming right → pixel at SW
          pxKey = key(v.x - 1, v.y); cornerName = "tr"; lcDir = "TR";
        } else if (inDy === 1) { // incoming down → pixel at NW
          pxKey = key(v.x - 1, v.y - 1); cornerName = "br"; lcDir = "BR";
        } else if (inDx === -1) { // incoming left → pixel at NE
          pxKey = key(v.x, v.y - 1); cornerName = "bl"; lcDir = "BL";
        } else {                  // incoming up → pixel at SE
          pxKey = key(v.x, v.y); cornerName = "tl"; lcDir = "TL";
        }
        const pxInfo = pixelMap.get(pxKey);
        if (pxInfo) {
          const r = pxInfo.corners[cornerName].radius;
          if (r === 1 && fullLCorners) {
            plan = { radius: 1, mode: "fullLCornerArc", lcDir };
          } else if (r > 0) {
            plan = { radius: r, mode: "outerArc" };
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
    }
    return plans;
  }

  // ================================================================
  // Serialization layer
  // ================================================================

  // At a checkerboard vertex, find which diagonal pixel has an L-corner arc
  // with an endpoint in the given direction. Returns the lcDir or null.
  // Used by inner fillet code to adjust endpoints to match L-corner notch arcs.
  function checkerNotchLcDir(vx, vy, dx, dy) {
    const hasNE = allPixels.has(key(vx, vy - 1));
    const hasSW = allPixels.has(key(vx - 1, vy));
    let pxKey, cornerName, lcDir;
    if (hasNE && hasSW) {
      // NE-SW diagonal: UP/RIGHT → NE pixel, DOWN/LEFT → SW pixel
      if (dy < 0 || dx > 0) { pxKey = key(vx, vy - 1); cornerName = "bl"; lcDir = "BL"; }
      else { pxKey = key(vx - 1, vy); cornerName = "tr"; lcDir = "TR"; }
    } else {
      // NW-SE diagonal: UP/LEFT → NW pixel, DOWN/RIGHT → SE pixel
      if (dy < 0 || dx < 0) { pxKey = key(vx - 1, vy - 1); cornerName = "br"; lcDir = "BR"; }
      else { pxKey = key(vx, vy); cornerName = "tl"; lcDir = "TL"; }
    }
    const info = pixelMap.get(pxKey);
    return (info && info.corners[cornerName].radius === 1) ? lcDir : null;
  }

  // Arc-line intersection for L-corner fillet shortening
  // isVerticalLine: true if the line is vertical (x=lineCoord), false if horizontal (y=lineCoord)
  function arcLineIntersect(cx, cy, isVerticalLine, lineCoord, sign) {
    if (isVerticalLine) {
      const dx = lineCoord - cx;
      const dy = sign * Math.sqrt(Math.max(0, 1 - dx * dx));
      const len = Math.hypot(dx, dy);
      return { px: lineCoord, py: cy + dy, tx: dy / len, ty: -dx / len };
    } else {
      const dy = lineCoord - cy;
      const dx = sign * Math.sqrt(Math.max(0, 1 - dy * dy));
      const len = Math.hypot(dx, dy);
      return { px: cx + dx, py: lineCoord, tx: dy / len, ty: -dx / len };
    }
  }

  function filletControlPoint(eA, eB) {
    const det = eA.tx * (-eB.ty) - (-eB.tx) * eA.ty;
    if (Math.abs(det) < 1e-10) return { cpx: (eA.px + eB.px) / 2, cpy: (eA.py + eB.py) / 2 };
    const alpha = ((eB.px - eA.px) * (-eB.ty) - (-eB.tx) * (eB.py - eA.py)) / det;
    return { cpx: eA.px + alpha * eA.tx, cpy: eA.py + alpha * eA.ty };
  }

  const LC_DIRS = {
    TL: { pdx: 0, pdy: -1, odx: 1, ody: 0 },
    TR: { pdx: 1, pdy: 0, odx: 0, ody: 1 },
    BL: { pdx: -1, pdy: 0, odx: 0, ody: -1 },
    BR: { pdx: 0, pdy: 1, odx: -1, ody: 0 },
  };

  function lcArcFilletPoint(lcVert, vx, vy, edgeDx, edgeDy, ri) {
    const lcDir = LC_DIRS[lcVert.lcDir || lcVert.fullRadius];
    const arcCx = lcVert.x + lcDir.odx - lcDir.pdx;
    const arcCy = lcVert.y + lcDir.ody - lcDir.pdy;
    const edgeVertical = edgeDy !== 0;
    const lineCoord = edgeVertical ? (vy - edgeDy * ri) : (vx - edgeDx * ri);
    const sign = edgeVertical ? Math.sign(vx - arcCx) : Math.sign(vy - arcCy);
    const pt = arcLineIntersect(arcCx, arcCy, !edgeVertical, lineCoord, sign);
    const dx = pt.px - arcCx, dy = pt.py - arcCy;
    const len = Math.hypot(dx, dy);
    return { px: pt.px, py: pt.py, tx: dy / len, ty: -dx / len };
  }

  function serializeLoopPath(vertices, edges, plans, ro, ri, isHole) {
    if (vertices.length === 0) return "";
    const p = [];
    const n = vertices.length;

    const r0 = plans[0].radius;
    const lastEdge = edges[n - 1];
    let prevDx = Math.sign(lastEdge.dx);
    let prevDy = Math.sign(lastEdge.dy);
    const startX = vertices[0].x - prevDx * r0;
    const startY = vertices[0].y - prevDy * r0;

    p.push(`M${fmt(startX)},${fmt(startY)}`);
    const sweep = 1;

    for (let i = 0; i < n; i++) {
      const r = plans[i].radius;
      const edge = edges[i];
      const rNext = plans[(i + 1) % n].radius;
      const odx = Math.sign(edge.dx);
      const ody = Math.sign(edge.dy);

      if (vertices[i].turn === "right" && r > 0) {
        if (plans[i].mode === "fullLCornerArc") {
          const lcDir = plans[i].lcDir;
          const { pdx, pdy, odx: lodx, ody: lody } = LC_DIRS[lcDir];
          const arcCx = vertices[i].x + lodx - pdx;
          const arcCy = vertices[i].y + lody - pdy;
          const { shortenStart, shortenEnd } = plans[i];
          const nextI = (i + 1) % n;
          const prevI = (i - 1 + n) % n;

          if (shortenEnd) {
            const nv = vertices[nextI];
            const edgeV = ody !== 0;
            const line = edgeV ? (nv.y - ody * ri) : (nv.x - odx * ri);
            const sign = edgeV ? Math.sign(nv.x - arcCx) : Math.sign(nv.y - arcCy);
            const pt = arcLineIntersect(arcCx, arcCy, !edgeV, line, sign);
            p.push(`A1,1,0,0,${sweep},${fmt(pt.px)},${fmt(pt.py)}`);
          } else {
            const tgtX = vertices[i].x + lodx * r;
            const tgtY = vertices[i].y + lody * r;
            p.push(`A1,1,0,0,${sweep},${fmt(tgtX)},${fmt(tgtY)}`);
          }
        } else {
          const adx = fmt(odx * r + prevDx * r);
          const ady = fmt(ody * r + prevDy * r);
          p.push(`a${fmt(r)},${fmt(r)},0,0,${sweep},${adx},${ady}`);
        }
      } else if (vertices[i].turn === "left" && r > 0) {
        const prevI = (i - 1 + n) % n;
        const nextI = (i + 1) % n;
        const prevFR = plans[prevI].mode === "fullLCornerArc" && plans[prevI].shortenEnd;
        const nextFR = plans[nextI].mode === "fullLCornerArc" && plans[nextI].shortenStart;
        if (prevFR && nextFR && ri > 0) {
          const vx = vertices[i].x, vy = vertices[i].y;
          const pv = { ...vertices[prevI], fullRadius: plans[prevI].lcDir };
          const nv = { ...vertices[nextI], fullRadius: plans[nextI].lcDir };
          const eA = lcArcFilletPoint(pv, vx, vy, prevDx, prevDy, ri);
          const eB = lcArcFilletPoint(nv, vx, vy, -odx, -ody, ri);
          const { cpx, cpy } = filletControlPoint(eA, eB);
          p.push(`Q${fmt(cpx)},${fmt(cpy)},${fmt(eB.px)},${fmt(eB.py)}`);
        } else if (prevFR && ri > 0) {
          const vx = vertices[i].x, vy = vertices[i].y;
          const pv = { ...vertices[prevI], fullRadius: plans[prevI].lcDir };
          const eA = lcArcFilletPoint(pv, vx, vy, prevDx, prevDy, ri);
          const eB = { px: vx + odx * ri, py: vy + ody * ri, tx: -odx, ty: -ody };
          const { cpx, cpy } = filletControlPoint(eA, eB);
          p.push(`Q${fmt(cpx)},${fmt(cpy)},${fmt(eB.px)},${fmt(eB.py)}`);
        } else if (nextFR && ri > 0) {
          const vx = vertices[i].x, vy = vertices[i].y;
          const eA = { px: vx - prevDx * ri, py: vy - prevDy * ri, tx: prevDx, ty: prevDy };
          const nv = { ...vertices[nextI], fullRadius: plans[nextI].lcDir };
          const eB = lcArcFilletPoint(nv, vx, vy, -odx, -ody, ri);
          const { cpx, cpy } = filletControlPoint(eA, eB);
          p.push(`Q${fmt(cpx)},${fmt(cpy)},${fmt(eB.px)},${fmt(eB.py)}`);
        } else {
          const cpx = prevDx * r;
          const cpy = prevDy * r;
          const endx = prevDx * r + odx * r;
          const endy = prevDy * r + ody * r;
          p.push(`q${fmt(cpx)},${fmt(cpy)},${fmt(endx)},${fmt(endy)}`);
        }
      }

      const edgeLen = edge.len - r - rNext;
      if (edgeLen > 0.001) {
        if (ody === 0) p.push(`h${fmt(odx * edgeLen)}`);
        else p.push(`v${fmt(ody * edgeLen)}`);
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
      if (!v.checkerboard) continue;
      const vk = key(v.x, v.y);
      if (emittedSet.has(vk)) continue;
      if (diagConnections.has(vk)) continue; // bridge handles geometry
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
  // Annotate checkerboard flag on vertices
  // (Minimal annotation — just the flag, not full contour annotation)
  // ================================================================
  function markCheckerboard(vertices) {
    for (const v of vertices) {
      const hasNW = allPixels.has(key(v.x - 1, v.y - 1));
      const hasNE = allPixels.has(key(v.x, v.y - 1));
      const hasSE = allPixels.has(key(v.x, v.y));
      const hasSW = allPixels.has(key(v.x - 1, v.y));
      const filled = (hasNW ? 1 : 0) + (hasNE ? 1 : 0) + (hasSE ? 1 : 0) + (hasSW ? 1 : 0);
      if (filled === 2 && hasNW === hasSE) v.checkerboard = true;
    }
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
    markCheckerboard(verts);
    const edges = buildLoopEdges(verts);
    const plans = buildLoopPlans(verts, edges);
    // Record which checkerboard vertices have arcs in this boundary
    for (let i = 0; i < verts.length; i++) {
      if (verts[i].checkerboard && plans[i].radius > 0 && verts[i].turn === "right") {
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

  // Helper: prepare a component with its holes (no diagonal splicing)
  function prepareComponent(comp) {
    const outerVerts = traceBoundary(comp);
    prepareLoop(outerVerts, false);
    const holes = findHoles(comp);
    for (const hole of holes) {
      const [hx, hy] = unkey([...hole][0]);
      if (windingFromVertices(outerVerts, hx + 0.5, hy + 0.5) !== 0) {
        prepareLoop(traceHoleBoundary(hole), true);
      }
    }
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
        for (const hole of neededHoles) {
          prepareLoop(traceHoleBoundary(hole), true);
        }
      }
    }
    emitDeferredNotches();
  }

  return { path: pathParts.join(" "), fillets: "" };
}
