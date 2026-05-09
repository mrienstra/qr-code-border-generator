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
  // Planning layer: derive vertex plans from pixel map
  // ================================================================

  // At grid vertex (vx, vy), determine the rendering plan based on the pixel map.
  // The four pixels touching this vertex are:
  //   NW = (vx-1, vy-1)  → its BR corner
  //   NE = (vx, vy-1)    → its BL corner
  //   SE = (vx, vy)      → its TL corner
  //   SW = (vx-1, vy)    → its TR corner
  function vertexPlan(vx, vy, turn) {
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
      const plan = vertexPlan(v.x, v.y, v.turn);

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
        parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y - r1)}a${fmt(r1)},${fmt(r1)},0,0,1,${fmt(-r1)},${fmt(r1)}Z`);
        parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y + r2)}a${fmt(r2)},${fmt(r2)},0,0,1,${fmt(r2)},${fmt(-r2)}Z`);
      } else if (hasNE && hasSW) {
        const neInfo = pixelMap.get(key(v.x, v.y - 1));
        const swInfo = pixelMap.get(key(v.x - 1, v.y));
        const r1 = neInfo?.corners?.bl?.radius ?? ro;
        const r2 = swInfo?.corners?.tr?.radius ?? ro;
        parts.push(`M${vxf},${vyf}L${fmt(v.x + r1)},${vyf}a${fmt(r1)},${fmt(r1)},0,0,1,${fmt(-r1)},${fmt(-r1)}Z`);
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

  for (const comp of components) {
    // Outer boundary
    const outerVerts = traceBoundary(comp);
    markCheckerboard(outerVerts);
    const outerEdges = buildLoopEdges(outerVerts);
    const outerPlans = buildLoopPlans(outerVerts, outerEdges);
    pathParts.push(serializeLoopPath(outerVerts, outerEdges, outerPlans, rOuter, rInner, false));
    const notches = emitCheckerboardNotches(outerVerts, rOuter, emittedNotches);
    if (notches) pathParts.push(notches);

    // Holes
    const holes = findHoles(comp);
    for (const hole of holes) {
      // Check if outer boundary already handles this hole via winding
      const [hx, hy] = unkey([...hole][0]);
      const w = windingFromVertices(outerVerts, hx + 0.5, hy + 0.5);
      if (w !== 0) {
        // Need a separate CCW subpath for this hole
        const holeVerts = traceHoleBoundary(hole);
        markCheckerboard(holeVerts);
        const holeEdges = buildLoopEdges(holeVerts);
        const holePlans = buildLoopPlans(holeVerts, holeEdges);
        pathParts.push(serializeLoopPath(holeVerts, holeEdges, holePlans, rOuter, rInner, true));
        const hNotches = emitCheckerboardNotches(holeVerts, rOuter, emittedNotches);
        if (hNotches) pathParts.push(hNotches);
      }
    }
  }

  return { path: pathParts.join(" "), fillets: "" };
}
