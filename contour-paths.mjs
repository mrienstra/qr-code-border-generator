/**
 * Contour tracing SVG path rendering: one closed path per connected component.
 */

import { key, unkey, snap, fmt } from './pixel-paths.mjs';

// --- Contour tracing: one closed SVG path per connected component ---

export function squaresToContourPath(squares, allPixels, rOuter, rInner, connectDiagonals = 0, fullLCorners = false, skipCheckerLCorners = false) {
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

  // --- Step 4a: Build edge vectors between consecutive vertices ---
  function buildLoopEdges(vertices) {
    const n = vertices.length;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const v0 = vertices[i];
      const v1 = vertices[(i + 1) % n];
      const dx = v1.x - v0.x;
      const dy = v1.y - v0.y;
      const len = Math.abs(dx) + Math.abs(dy); // Manhattan (always axis-aligned)
      edges.push({ dx, dy, len });
    }
    return edges;
  }

  // --- Step 4b: Annotate vertices with checkerboard and L-corner flags ---
  // Sets: v.checkerboard, v.fullRadius
  // Dependencies are passed explicitly via ctx to avoid hidden closure coupling.
  function annotateLoopVertices(vertices, edges, ctx) {
    const { compPixels, allPixels: allPx, fullLCorners: flc, ro, skipCheckerLCorners: skipCLC } = ctx;
    const n = vertices.length;

    // Checkerboard: vertex touches 2 diagonally-opposite filled cells
    for (const v of vertices) {
      const hasNW = allPx.has(key(v.x - 1, v.y - 1));
      const hasNE = allPx.has(key(v.x, v.y - 1));
      const hasSE = allPx.has(key(v.x, v.y));
      const hasSW = allPx.has(key(v.x - 1, v.y));
      const filled = (hasNW ? 1 : 0) + (hasNE ? 1 : 0) + (hasSE ? 1 : 0) + (hasSW ? 1 : 0);
      if (filled === 2 && hasNW === hasSE) {
        v.checkerboard = true;
      }
    }

    // L-corner detection: at each "right" turn vertex, check if a quadrant
    // pixel has an L-corner (exposed corner + both opposite cardinals present).
    // Uses traversal directions to disambiguate pinch-point vertices visited
    // multiple times at the same coordinate.
    if (flc && ro > 0) {
      for (let i = 0; i < n; i++) {
        if (vertices[i].turn !== "right") continue;
        const vx = vertices[i].x, vy = vertices[i].y;
        const prevEdge = edges[(i - 1 + n) % n];
        const outEdge = edges[i];
        const inDx = Math.sign(prevEdge.dx), inDy = Math.sign(prevEdge.dy);
        const outDx = Math.sign(outEdge.dx), outDy = Math.sign(outEdge.dy);
        // TL corner of pixel (vx,vy): adj=left,up absent; opp=right,down present
        // Direction: incoming (0,-1), outgoing (1,0)
        // skipCheckerLCorners: suppress if diagonal pixel (vx-1,vy-1) is filled
        if (inDx === 0 && inDy === -1 && outDx === 1 && outDy === 0
            && compPixels.has(key(vx, vy)) && !allPx.has(key(vx - 1, vy)) && !allPx.has(key(vx, vy - 1))
            && allPx.has(key(vx + 1, vy)) && allPx.has(key(vx, vy + 1))
            && !(skipCLC && allPx.has(key(vx - 1, vy - 1)))) {
          vertices[i].fullRadius = "TL"; continue;
        }
        // TR corner of pixel (vx-1,vy): adj=right,up absent; opp=left,down present
        // Direction: incoming (1,0), outgoing (0,1)
        // skipCheckerLCorners: suppress if diagonal pixel (vx,vy-1) is filled
        if (inDx === 1 && inDy === 0 && outDx === 0 && outDy === 1
            && compPixels.has(key(vx - 1, vy)) && !allPx.has(key(vx, vy)) && !allPx.has(key(vx - 1, vy - 1))
            && allPx.has(key(vx - 2, vy)) && allPx.has(key(vx - 1, vy + 1))
            && !(skipCLC && allPx.has(key(vx, vy - 1)))) {
          vertices[i].fullRadius = "TR"; continue;
        }
        // BL corner of pixel (vx,vy-1): adj=left,down absent; opp=right,up present
        // Direction: incoming (-1,0), outgoing (0,-1)
        // skipCheckerLCorners: suppress if diagonal pixel (vx-1,vy) is filled
        if (inDx === -1 && inDy === 0 && outDx === 0 && outDy === -1
            && compPixels.has(key(vx, vy - 1)) && !allPx.has(key(vx - 1, vy - 1)) && !allPx.has(key(vx, vy))
            && allPx.has(key(vx + 1, vy - 1)) && allPx.has(key(vx, vy - 2))
            && !(skipCLC && allPx.has(key(vx - 1, vy)))) {
          vertices[i].fullRadius = "BL"; continue;
        }
        // BR corner of pixel (vx-1,vy-1): adj=right,down absent; opp=left,up present
        // Direction: incoming (0,1), outgoing (-1,0)
        // skipCheckerLCorners: suppress if diagonal pixel (vx,vy) is filled
        if (inDx === 0 && inDy === 1 && outDx === -1 && outDy === 0
            && compPixels.has(key(vx - 1, vy - 1)) && !allPx.has(key(vx, vy - 1)) && !allPx.has(key(vx - 1, vy))
            && allPx.has(key(vx - 2, vy - 1)) && allPx.has(key(vx - 1, vy - 2))
            && !(skipCLC && allPx.has(key(vx, vy)))) {
          vertices[i].fullRadius = "BR"; continue;
        }
      }
    }
  }

  // --- Step 4c: Resolve per-vertex corner plans ---
  // Precomputes the rendering policy for each vertex: radius, mode name,
  // and (for full-radius L-corners) shorten flags for adjacent fillets.
  // This replaces the former `radiusAt()` closure that was called lazily
  // during serialization, mixing policy decisions into the emit loop.
  function resolveCornerPlans(vertices, edges, ctx, isHole) {
    const { compPixels, allPixels: allPx, fullLCorners: flc, ro, ri, skipCheckerLCorners: skipCLC, diagConnections: diagConns } = ctx;
    const n = vertices.length;
    const plans = new Array(n);

    for (let i = 0; i < n; i++) {
      const v = vertices[i];
      const hasFR = flc && v.fullRadius;

      // --- Checkerboard suppression ---
      // Bridge vertices (diagonal splice points) skip this — they're always
      // at checkerboard positions but need their ri fillet preserved.
      if ((v.x===9&&v.y===3)||(v.x===4&&v.y===7)) console.log(`[LC-DEBUG] v=(${v.x},${v.y}) turn=${v.turn} checker=${v.checkerboard} hasFR=${hasFR} fullRadius=${v.fullRadius} bridge=${v.bridge||false} compHas92=${compPixels.has(key(9,2))} compHas83=${compPixels.has(key(8,3))} compHas82=${compPixels.has(key(8,2))} compHas93=${compPixels.has(key(9,3))}`);
      if (v.checkerboard && !hasFR && !v.bridge) {
        if (flc) {
          const vx = v.x, vy = v.y;
          const hasNE = allPx.has(key(vx, vy - 1));
          const hasSW = allPx.has(key(vx - 1, vy));
          if (hasNE && hasSW) {
            const neInComp = compPixels.has(key(vx, vy - 1));
            const swInComp = compPixels.has(key(vx - 1, vy));
            if (neInComp && swInComp) {
              if (isLCornerPixel(vx, vy - 1, "BL", allPx) || isLCornerPixel(vx - 1, vy, "TR", allPx)) {
                // On hole loops without a diagonal connection, suppress left-turn
                // ri: the fillet would bridge across the gap per-pixel keeps open.
                // When a diagonal IS connected (diagConns), preserve ri for the bridge.
                const suppressHoleRi = isHole && !(diagConns && diagConns.has(key(vx, vy)));
                const r = v.turn === "right" ? ro : (v.turn === "left" && !suppressHoleRi) ? ri : 0;
                if (r > 0) { plans[i] = { radius: r, mode: "checkerboardBypass" }; continue; }
              }
            }
            if (v.turn === "right") {
              if (neInComp && !swInComp && (isLCornerPixel(vx - 1, vy, "TR", allPx) || isLCornerPixel(vx, vy - 1, "BL", allPx))) { plans[i] = { radius: ro, mode: "checkerboardBypass" }; continue; }
              if (swInComp && !neInComp && (isLCornerPixel(vx, vy - 1, "BL", allPx) || isLCornerPixel(vx - 1, vy, "TR", allPx))) { plans[i] = { radius: ro, mode: "checkerboardBypass" }; continue; }
            }
          } else {
            const hasNW = allPx.has(key(vx - 1, vy - 1));
            const hasSE = allPx.has(key(vx, vy));
            if (hasNW && hasSE) {
              const nwInComp = compPixels.has(key(vx - 1, vy - 1));
              const seInComp = compPixels.has(key(vx, vy));
              if (nwInComp && seInComp) {
                if (isLCornerPixel(vx - 1, vy - 1, "BR", allPx) || isLCornerPixel(vx, vy, "TL", allPx)) {
                  const suppressHoleRi = isHole && !(diagConns && diagConns.has(key(vx, vy)));
                  const r = v.turn === "right" ? ro : (v.turn === "left" && !suppressHoleRi) ? ri : 0;
                  if (r > 0) { plans[i] = { radius: r, mode: "checkerboardBypass" }; continue; }
                }
              }
              if (v.turn === "right") {
                if (nwInComp && !seInComp && (isLCornerPixel(vx, vy, "TL", allPx) || isLCornerPixel(vx - 1, vy - 1, "BR", allPx))) { plans[i] = { radius: ro, mode: "checkerboardBypass" }; continue; }
                if (seInComp && !nwInComp && (isLCornerPixel(vx - 1, vy - 1, "BR", allPx) || isLCornerPixel(vx, vy, "TL", allPx))) { plans[i] = { radius: ro, mode: "checkerboardBypass" }; continue; }
              }
            }
          }
        }
        plans[i] = { radius: 0, mode: "sharp" };
        continue;
      }

      // --- Normal corners ---
      if (v.turn === "right") {
        if (flc && v.fullRadius) {
          // Full-radius L-corner: r=1, precompute shorten flags
          const nextI = (i + 1) % n;
          const prevI = (i - 1 + n) % n;
          const shortenEnd = vertices[nextI].turn === "left" && edges[i].len <= 1;
          const shortenStart = vertices[prevI].turn === "left" && edges[(i - 1 + n) % n].len <= 1;
          plans[i] = { radius: 1, mode: "fullLCornerArc", shortenStart, shortenEnd };
          if ((v.x===9&&v.y===3)||(v.x===4&&v.y===7)) console.log(`[LC-DEBUG] v=(${v.x},${v.y}) fullRadius=${v.fullRadius} checker=${v.checkerboard} plan=fullLCornerArc shortenStart=${shortenStart} shortenEnd=${shortenEnd}`);
        } else {
          plans[i] = { radius: ro, mode: "outerArc" };
          if ((v.x===9&&v.y===3)||(v.x===4&&v.y===7)) console.log(`[LC-DEBUG] v=(${v.x},${v.y}) fullRadius=${v.fullRadius} checker=${v.checkerboard} plan=outerArc r=${ro}`);
        }
        continue;
      }

      if (v.turn === "left") {
        plans[i] = { radius: ri, mode: "innerFillet" };
        continue;
      }

      plans[i] = { radius: 0, mode: "sharp" };
    }

    return plans;
  }

  // --- Step 4d: Geometry helpers for tangent-continuous fillets ---

  // Find where an axis-aligned line intersects a unit circle centered at (cx, cy).
  // isVerticalLine=true: line is x=lineCoord; false: line is y=lineCoord.
  // sign picks which of the two intersection points to return.
  // Returns { px, py, tx, ty } — point and tangent direction on the arc.
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

  // Compute the Q bezier control point from two tangent endpoints (eA, eB).
  // Each has { px, py, tx, ty }. Returns { cpx, cpy }.
  function filletControlPoint(eA, eB) {
    const det = eA.tx * (-eB.ty) - (-eB.tx) * eA.ty;
    if (Math.abs(det) < 1e-10) {
      return { cpx: (eA.px + eB.px) / 2, cpy: (eA.py + eB.py) / 2 };
    }
    const alpha = ((eB.px - eA.px) * (-eB.ty) - (-eB.tx) * (eB.py - eA.py)) / det;
    return { cpx: eA.px + alpha * eA.tx, cpy: eA.py + alpha * eA.ty };
  }

  // Compute where a fillet line from a concave vertex meets an L-corner's r=1 arc.
  // lcVertex: the L-corner vertex; vx,vy: concave vertex position;
  // edgeDx,edgeDy: direction of the edge between concave and LC vertices;
  // ri: inner fillet radius. Returns { px, py, tx, ty }.
  function lcArcFilletPoint(lcVertex, vx, vy, edgeDx, edgeDy, ri) {
    const { pdx, pdy, odx: lodx, ody: lody } = LC_DIRS[lcVertex.fullRadius];
    const arcCx = lcVertex.x + lodx - pdx, arcCy = lcVertex.y + lody - pdy;
    const edgeVertical = edgeDy !== 0;
    const lineCoord = edgeVertical ? (vy - edgeDy * ri) : (vx - edgeDx * ri);
    const sign = edgeVertical ? Math.sign(vx - arcCx) : Math.sign(vy - arcCy);
    return arcLineIntersect(arcCx, arcCy, !edgeVertical, lineCoord, sign);
  }

  // --- Step 4e: Serialize SVG path from pre-annotated vertices + resolved plans ---
  function serializeLoopPath(vertices, edges, plans, ro, ri, isHole) {
    if (vertices.length === 0) return "";
    const p = [];

    const n = vertices.length;

    // Find the starting position: offset from vertex 0 by the radius
    // The edge from vertex (n-1) to vertex 0 is the "incoming" edge to vertex 0.
    // We start the path at the point on that edge, radius distance before vertex 0.
    const r0 = plans[0].radius;
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
      const r = plans[i].radius;
      const edge = edges[i]; // outgoing edge from vertex i
      const rNext = plans[(i + 1) % n].radius;

      // Direction of outgoing edge
      const odx = Math.sign(edge.dx);
      const ody = Math.sign(edge.dy);

      if (vertices[i].turn === "right" && r > 0) {
        if (plans[i].mode === "fullLCornerArc") {
          // Full-radius L-corner: arc may be shortened on either/both sides
          const { pdx, pdy, odx: lodx, ody: lody } = LC_DIRS[vertices[i].fullRadius];
          const arcCx = vertices[i].x + lodx - pdx, arcCy = vertices[i].y + lody - pdy;

          const { shortenStart, shortenEnd } = plans[i];
          const nextI = (i + 1) % n;
          const prevI_lc = (i - 1 + n) % n;

          // Compute start point (may be shortened by adjacent concave fillet)
          let startX, startY;
          if (shortenStart) {
            const pv = vertices[prevI_lc];
            const edgeH = prevDx !== 0;
            const line = edgeH ? (pv.x + prevDx * ri) : (pv.y + prevDy * ri);
            const sign = edgeH ? Math.sign(pv.y - arcCy) : Math.sign(pv.x - arcCx);
            const pt = arcLineIntersect(arcCx, arcCy, edgeH, line, sign);
            startX = pt.px; startY = pt.py;
          }

          // Compute end point (may be shortened by adjacent concave fillet)
          let tgtX, tgtY;
          if (shortenEnd) {
            const nv = vertices[nextI];
            const edgeV = ody !== 0;
            const line = edgeV ? (nv.y - ody * ri) : (nv.x - odx * ri);
            const sign = edgeV ? Math.sign(nv.x - arcCx) : Math.sign(nv.y - arcCy);
            const pt = arcLineIntersect(arcCx, arcCy, !edgeV, line, sign);
            tgtX = pt.px; tgtY = pt.py;
          } else {
            tgtX = vertices[i].x + lodx * r;
            tgtY = vertices[i].y + lody * r;
          }
          p.push(`A1,1,0,0,${sweep},${fmt(tgtX)},${fmt(tgtY)}`);
        } else {
          // Standard convex corner arc
          // Current pos: vertex - prevDir * r. Target: vertex + outDir * r.
          // Displacement = outDir*r + prevDir*r
          const adx = fmt(odx * r + prevDx * r);
          const ady = fmt(ody * r + prevDy * r);
          p.push(`a${fmt(r)},${fmt(r)},0,0,${sweep},${adx},${ady}`);
        }
      } else if (vertices[i].turn === "left" && r > 0) {
        // Concave corner: quadratic Bézier fillet
        const prevI = (i - 1 + n) % n;
        const prevFR = plans[prevI].mode === "fullLCornerArc" && plans[prevI].shortenEnd;
        const nextI = (i + 1) % n;
        const nextFR = plans[nextI].mode === "fullLCornerArc" && plans[nextI].shortenStart;
        if (prevFR && nextFR && ri > 0) {
          // Both adjacent vertices have L-corners: fillet connects two r=1 arcs
          const vx = vertices[i].x, vy = vertices[i].y;
          const eA = lcArcFilletPoint(vertices[prevI], vx, vy, prevDx, prevDy, ri);
          const eB = lcArcFilletPoint(vertices[nextI], vx, vy, -odx, -ody, ri);
          const { cpx, cpy } = filletControlPoint(eA, eB);
          p.push(`Q${fmt(cpx)},${fmt(cpy)},${fmt(eB.px)},${fmt(eB.py)}`);
        } else if (prevFR && ri > 0) {
          // Previous vertex has L-corner: fillet starts on the r=1 arc
          const vx = vertices[i].x, vy = vertices[i].y;
          const eA = lcArcFilletPoint(vertices[prevI], vx, vy, prevDx, prevDy, ri);
          const eB = { px: vx + odx * ri, py: vy + ody * ri, tx: -odx, ty: -ody };
          const { cpx, cpy } = filletControlPoint(eA, eB);
          p.push(`Q${fmt(cpx)},${fmt(cpy)},${fmt(eB.px)},${fmt(eB.py)}`);
        } else if (nextFR && ri > 0) {
          // Next vertex has L-corner: fillet ends on the r=1 arc
          const vx = vertices[i].x, vy = vertices[i].y;
          const eA = { px: vx - prevDx * ri, py: vy - prevDy * ri, tx: prevDx, ty: prevDy };
          const eB = lcArcFilletPoint(vertices[nextI], vx, vy, -odx, -ody, ri);
          const { cpx, cpy } = filletControlPoint(eA, eB);
          p.push(`Q${fmt(cpx)},${fmt(cpy)},${fmt(eB.px)},${fmt(eB.py)}`);
        } else {
          // Standard fillet
          const cpx = prevDx * r;
          const cpy = prevDy * r;
          const endx = prevDx * r + odx * r;
          const endy = prevDy * r + ody * r;
          p.push(`q${fmt(cpx)},${fmt(cpy)},${fmt(endx)},${fmt(endy)}`);
        }
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

  // L-corner direction mappings: per corner type, the "incoming" and
  // "outgoing" directions (from the pixel's own CW boundary perspective).
  //   TL: in=(0,-1) out=(1,0)   TR: in=(1,0) out=(0,1)
  //   BL: in=(-1,0) out=(0,-1)  BR: in=(0,1) out=(-1,0)
  // Used by annotateLoopVertices, lcArcFilletPoint, and serializeLoopPath.
  const LC_DIRS = {
    TL: { pdx: 0, pdy: -1, odx: 1, ody: 0 },
    TR: { pdx: 1, pdy: 0, odx: 0, ody: 1 },
    BL: { pdx: -1, pdy: 0, odx: 0, ody: -1 },
    BR: { pdx: 0, pdy: 1, odx: -1, ody: 0 },
  };


  // --- Step 5: Check if outer boundary already handles a hole via winding ---
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

  // --- Step 6: Checkerboard notch subpaths ---
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

  // Check if a pixel has an L-corner at a specific corner type
  function isLCornerPixel(px, py, corner, allPx) {
    if (!allPx.has(key(px, py))) return false;
    const hasL = allPx.has(key(px - 1, py)), hasR = allPx.has(key(px + 1, py));
    const hasU = allPx.has(key(px, py - 1)), hasD = allPx.has(key(px, py + 1));
    if (corner === "TL") return !hasL && !hasU && hasR && hasD;
    if (corner === "TR") return !hasR && !hasU && hasL && hasD;
    if (corner === "BL") return !hasL && !hasD && hasR && hasU;
    if (corner === "BR") return !hasR && !hasD && hasL && hasU;
    return false;
  }

  function emitCheckerboardNotches(holeVerts, ro, emittedSet, ctx, isHole) {
    const { allPixels: allPx, diagConnections: diagConns, fullLCorners: flc, skipCheckerLCorners: skipCLC } = ctx;
    if (ro <= 0) return "";
    const parts = [];
    for (const v of holeVerts) {
      if (!v.checkerboard) continue;
      const vk = key(v.x, v.y);
      if (emittedSet.has(vk)) continue;
      // Skip checkerboard notches at diagonal connection vertices —
      // diagonal fillets handle the fill there instead.
      if (diagConns.has(vk)) continue;

      emittedSet.add(vk);

      const vxf = fmt(v.x), vyf = fmt(v.y);
      const hasNW = allPx.has(key(v.x - 1, v.y - 1));
      const hasSE = allPx.has(key(v.x, v.y));

      // On hole loops: if we reach this vertex, the outer loop didn't visit it
      // (emittedSet would've blocked). Emit notches even at L-corner pixels —
      // the outer path has no arc coverage here, so notches create the gap.
      // On outer loops: suppress when L-corner pixels present (original logic) —
      // the main path's arc already provides the needed rounding.

      if (hasNW && hasSE) {
        // NW-SE diagonal filled: CCW notches carving into NW and SE pixels
        const nwLC = flc && isLCornerPixel(v.x - 1, v.y - 1, "BR", allPx);
        const seLC = flc && isLCornerPixel(v.x, v.y, "TL", allPx);
        const r1 = nwLC ? 1 : ro;
        const r2 = seLC ? 1 : ro;
        if (isHole || (!nwLC && !seLC)) {
          parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y - r1)}a${fmt(r1)},${fmt(r1)},0,0,1,${fmt(-r1)},${fmt(r1)}Z`);
          parts.push(`M${vxf},${vyf}L${vxf},${fmt(v.y + r2)}a${fmt(r2)},${fmt(r2)},0,0,1,${fmt(r2)},${fmt(-r2)}Z`);
        }
      } else {
        // NE-SW diagonal filled: CCW notches carving into NE and SW pixels
        const hasNE = allPx.has(key(v.x, v.y - 1));
        const neLC = flc && isLCornerPixel(v.x, v.y - 1, "BL", allPx);
        const swLC = flc && isLCornerPixel(v.x - 1, v.y, "TR", allPx);
        const r1 = neLC ? 1 : ro;
        const r2 = swLC ? 1 : ro;
        if (isHole || (!neLC && !swLC)) {
          parts.push(`M${vxf},${vyf}L${fmt(v.x + r1)},${vyf}a${fmt(r1)},${fmt(r1)},0,0,1,${fmt(-r1)},${fmt(-r1)}Z`);
          parts.push(`M${vxf},${vyf}L${fmt(v.x - r2)},${vyf}a${fmt(r2)},${fmt(r2)},0,0,1,${fmt(r2)},${fmt(r2)}Z`);
        }
      }
    }
    return parts.join(" ");
  }

  // --- Step 7: Pre-compute diagonal connections (rendering-only bridges) ---
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

  // --- Step 8: Splice diagonal connections into contour loops ---
  // Instead of bolting on fillet subpaths after tracing, we splice the
  // contour loops at diagonal vertices. A bridge vertex at a diagonal
  // is geometrically identical to a left-turn concave fillet (r=ri),
  // so the existing serializer handles it with no changes.

  const components = findComponents(squares);

  // 8a. Build pixel → component index lookup
  const pixelToComp = new Map();
  for (let ci = 0; ci < components.length; ci++) {
    for (const pk of components[ci]) pixelToComp.set(pk, ci);
  }

  // 8b. Classify diagonals and build super-components via union-find
  const parent = components.map((_, i) => i);
  function ufFind(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function ufUnion(a, b) { const ra = ufFind(a), rb = ufFind(b); if (ra !== rb) parent[ra] = rb; }

  // Store enriched diagonal info: vertex key → { dir, pixelA, pixelB, sameComp }
  const diagInfo = new Map();
  for (const [vk, dir] of diagConnections) {
    const [vx, vy] = unkey(vk);
    let pkA, pkB;
    if (dir === "br") {
      pkA = key(vx - 1, vy - 1); // upper-left pixel
      pkB = key(vx, vy);         // lower-right pixel
    } else {
      pkA = key(vx, vy - 1);     // upper-right pixel
      pkB = key(vx - 1, vy);     // lower-left pixel
    }
    const ciA = pixelToComp.get(pkA), ciB = pixelToComp.get(pkB);
    // sameComp: truly the same original 4-connected component (pinch point)
    const sameComp = ciA !== undefined && ciB !== undefined && ciA === ciB;
    diagInfo.set(vk, { dir, pkA, pkB, ciA, ciB, sameComp });
    console.log(`[diag-classify] v=(${vx},${vy}) dir=${dir} pixA=${pkA}(ci=${ciA}) pixB=${pkB}(ci=${ciB}) sameComp=${sameComp}`);
    if (ciA !== undefined && ciB !== undefined && ufFind(ciA) !== ufFind(ciB)) {
      ufUnion(ciA, ciB);
    }
  }

  // 8c. Group components into super-components
  const superCompMap = new Map(); // root → [component indices]
  for (let ci = 0; ci < components.length; ci++) {
    const root = ufFind(ci);
    if (!superCompMap.has(root)) superCompMap.set(root, []);
    superCompMap.get(root).push(ci);
  }

  // 8d. Splice loops at diagonal vertices
  // For each super-component, trace all constituent boundaries, then splice.
  function spliceLoopsAtVertex(loop1, loop2, vx, vy) {
    // Find vertex V in each loop
    const i1 = loop1.findIndex(v => v.x === vx && v.y === vy && v.turn === "right");
    const i2 = loop2.findIndex(v => v.x === vx && v.y === vy && v.turn === "right");
    if (i1 < 0 || i2 < 0) return null; // vertex not found — can't splice

    // Rotate both loops so V is excluded, vertices after V come first
    const n1 = loop1.length, n2 = loop2.length;
    const rot1 = [];
    for (let j = 1; j < n1; j++) rot1.push(loop1[(i1 + j) % n1]);
    const rot2 = [];
    for (let j = 1; j < n2; j++) rot2.push(loop2[(i2 + j) % n2]);

    // Insert bridge vertices (left-turn concave fillets).
    // bridge: true skips checkerboard suppression in resolveCornerPlans.
    const bridge1 = { x: vx, y: vy, turn: "left", bridge: true };
    const bridge2 = { x: vx, y: vy, turn: "left", bridge: true };

    return [...rot1, bridge1, ...rot2, bridge2];
  }

  // Split a loop at a cycle-closing diagonal into outer boundary + inner hole.
  // Returns { outer, hole } where both are vertex arrays with bridge vertices.
  function splitLoopAtCycleClosing(loop, vx, vy) {
    const indices = [];
    for (let i = 0; i < loop.length; i++) {
      if (loop[i].x === vx && loop[i].y === vy && loop[i].turn === "right") {
        indices.push(i);
      }
    }
    if (indices.length < 2) {
      console.log(`[cycle-split FAIL] v=(${vx},${vy}) found ${indices.length} right-turn matches in loop of ${loop.length}`);
      for (let i = 0; i < loop.length; i++) {
        if (loop[i].x === vx && loop[i].y === vy) {
          console.log(`  loop[${i}]: turn=${loop[i].turn} bridge=${loop[i].bridge||false}`);
        }
      }
      return null;
    }

    const [i1, i2] = indices;
    const n = loop.length;

    // Extract two segments (same as selfSplice)
    const seg1 = [];
    for (let j = i1 + 1; j !== i2; j = (j + 1) % n) seg1.push(loop[j]);
    const seg2 = [];
    for (let j = i2 + 1; j !== i1; j = (j + 1) % n) seg2.push(loop[j]);

    const bridge = { x: vx, y: vy, turn: "left", bridge: true };

    // The larger segment is the outer boundary, the smaller is the hole.
    // Each gets one bridge vertex at the split point.
    let outerSeg, holeSeg;
    if (seg1.length >= seg2.length) {
      outerSeg = seg1;
      holeSeg = seg2;
    } else {
      outerSeg = seg2;
      holeSeg = seg1;
    }

    const outer = [...outerSeg, { ...bridge }];
    // holeSeg follows the CW loop's forward direction, which traces CCW
    // around the inner gap (verified by shoelace). Keep left-turn bridges
    // so the serializer emits q-curve fillets (matching per-pixel geometry).
    const hole = holeSeg.map(v => ({ ...v }));
    hole.push({ x: vx, y: vy, turn: "left", bridge: true });

    return { outer, hole };
  }

  function selfSpliceAtVertex(loop, vx, vy) {
    // Find two visits to vertex V (both must be right-turns)
    const indices = [];
    for (let i = 0; i < loop.length; i++) {
      if (loop[i].x === vx && loop[i].y === vy && loop[i].turn === "right") {
        indices.push(i);
      }
    }
    if (indices.length < 2) return loop; // pinch point not found — no self-splice

    const [i1, i2] = indices;
    // Split into two segments: [i1+1..i2-1] and [i2+1..i1-1] (wrapping)
    const n = loop.length;
    const seg1 = [];
    for (let j = i1 + 1; j !== i2; j = (j + 1) % n) seg1.push(loop[j]);
    const seg2 = [];
    for (let j = i2 + 1; j !== i1; j = (j + 1) % n) seg2.push(loop[j]);

    const bridge1 = { x: vx, y: vy, turn: "left", bridge: true };
    const bridge2 = { x: vx, y: vy, turn: "left", bridge: true };

    return [...seg1, bridge1, ...seg2, bridge2];
  }

  // --- Main: assemble all super-components + holes ---
  const pathParts = [];
  const emittedNotches = new Set();
  const annotCtx = { compPixels: null, allPixels, diagConnections, fullLCorners, ro: rOuter, skipCheckerLCorners };
  const planCtx = { compPixels: null, allPixels, fullLCorners, ro: rOuter, ri: rInner, skipCheckerLCorners, diagConnections };

  // Process per-loop: annotate -> resolve plans -> serialize
  let loopId = 0;
  function emitLoop(verts, superPixels, isHole) {
    const lid = loopId++;
    annotCtx.compPixels = superPixels;
    planCtx.compPixels = superPixels;
    const edges = buildLoopEdges(verts);
    annotateLoopVertices(verts, edges, annotCtx);
    const plans = resolveCornerPlans(verts, edges, planCtx, isHole);
    for (let i = 0; i < verts.length; i++) {
      if ((verts[i].x===9&&verts[i].y===3)||(verts[i].x===4&&verts[i].y===7)) {
        console.log(`[LOOP-DIAG] loopId=${lid} isHole=${isHole} v=(${verts[i].x},${verts[i].y}) turn=${verts[i].turn} plan=${JSON.stringify(plans[i])}`);
      }
    }
    pathParts.push(serializeLoopPath(verts, edges, plans, rOuter, rInner, isHole));
    const notches = emitCheckerboardNotches(verts, rOuter, emittedNotches, annotCtx, isHole);
    if (notches) pathParts.push(notches);
  }

  for (const [, compIndices] of superCompMap) {
    // Merge pixel sets for the super-component
    const superPixels = new Set();
    for (const ci of compIndices) {
      for (const pk of components[ci]) superPixels.add(pk);
    }

    // Collect diagonals within this super-component
    const scDiags = []; // { vk, vx, vy, sameComp }
    for (const [vk, info] of diagInfo) {
      if (info.ciA === undefined || info.ciB === undefined) continue;
      if (!compIndices.includes(info.ciA) && !compIndices.includes(info.ciB)) continue;
      const [vx, vy] = unkey(vk);
      scDiags.push({ vk, vx, vy, ...info });
    }

    if (scDiags.length === 0) {
      // No diagonals — process each component independently (original path)
      for (const ci of compIndices) {
        const comp = components[ci];
        const outerVerts = traceBoundary(comp);
        emitLoop(outerVerts, comp, false);

        const holes = findHoles(comp);
        const neededHoles = holes.filter(hole => {
          const testCell = hole.values().next().value;
          const [tx, ty] = unkey(testCell);
          return windingFromVertices(outerVerts, tx + 0.5, ty + 0.5) !== 0;
        });
        for (const hole of neededHoles) {
          emitLoop(traceHoleBoundary(hole), comp, true);
        }
      }
    } else {
      // Trace outer boundaries for all constituent components
      const loopMap = new Map(); // compIndex → outer vertex loop
      for (const ci of compIndices) {
        loopMap.set(ci, traceBoundary(components[ci]));
      }

      const cycleHoles = []; // hole loops from cycle-closing and same-comp diagonals

      // Phase 1: Same-component diagonals (pinch points → split into outer + hole)
      // Must run FIRST on pristine component loops, before any merges that could
      // redistribute vertex visits across loops.
      // Pre-check: verify all same-comp diag vertices exist in their loops
      for (const diag of scDiags) {
        if (!diag.sameComp) continue;
        const origLoop = loopMap.get(diag.ciA);
        const rtCount = origLoop.filter(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right").length;
        if (rtCount < 2) {
          const anyCount = origLoop.filter(v => v.x === diag.vx && v.y === diag.vy).length;
          console.log(`[PRE-CHECK] v=(${diag.vx},${diag.vy}) ci=${diag.ciA}: ${rtCount} right-turns, ${anyCount} total in original loop of ${origLoop.length}`);
          if (anyCount > 0) {
            for (let i = 0; i < origLoop.length; i++) {
              if (origLoop[i].x === diag.vx && origLoop[i].y === diag.vy) {
                console.log(`  [${i}]: turn=${origLoop[i].turn} bridge=${origLoop[i].bridge||false}`);
              }
            }
          }
        }
      }
      for (const diag of scDiags) {
        if (!diag.sameComp) continue;
        const loop = loopMap.get(diag.ciA);
        console.log(`[same-comp-split] v=(${diag.vx},${diag.vy}) dir=${diag.dir} ci=${diag.ciA} loopLen=${loop.length}`);
        const split = splitLoopAtCycleClosing(loop, diag.vx, diag.vy);
        if (split) {
          console.log(`  split ok: outer=${split.outer.length} hole=${split.hole.length}`);
          loopMap.set(diag.ciA, split.outer);
          cycleHoles.push(split.hole);
        } else {
          // Prior split may have sent one visit to a hole loop.
          // Search holes for 2 right-turn visits and split there.
          let splitInHole = false;
          for (let hi = 0; hi < cycleHoles.length; hi++) {
            const hSplit = splitLoopAtCycleClosing(cycleHoles[hi], diag.vx, diag.vy);
            if (hSplit) {
              console.log(`  split in hole[${hi}]: outer=${hSplit.outer.length} hole=${hSplit.hole.length}`);
              cycleHoles[hi] = hSplit.outer;  // larger piece stays as hole
              cycleHoles.push(hSplit.hole);    // smaller piece is also a hole
              splitInHole = true;
              break;
            }
          }
          if (!splitInHole) {
            // Vertex visits may be spread across two different holes.
            // Find all holes with a right-turn at V and merge them.
            const holeIndices = [];
            for (let hi = 0; hi < cycleHoles.length; hi++) {
              if (cycleHoles[hi].some(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right")) {
                holeIndices.push(hi);
              }
            }
            if (holeIndices.length >= 2) {
              // Merge first two holes at V — bridge curves fill the gap
              const [ha, hb] = holeIndices;
              const merged = spliceLoopsAtVertex(cycleHoles[ha], cycleHoles[hb], diag.vx, diag.vy);
              if (merged) {
                console.log(`  merged holes[${ha}]+[${hb}] at v: ${merged.length} vertices`);
                cycleHoles[ha] = merged;
                cycleHoles.splice(hb, 1); // remove the second hole
              } else {
                console.log(`  HOLE MERGE FAILED`);
              }
            } else {
              // Search ALL loops for any vertex at these coordinates (debug)
              const searchAll = (vx, vy) => {
                const outer = loopMap.get(diag.ciA);
                for (let i = 0; i < outer.length; i++) {
                  if (outer[i].x === vx && outer[i].y === vy) {
                    console.log(`    found in outer[${i}]: turn=${outer[i].turn} bridge=${outer[i].bridge||false}`);
                  }
                }
                for (let hi = 0; hi < cycleHoles.length; hi++) {
                  for (let i = 0; i < cycleHoles[hi].length; i++) {
                    if (cycleHoles[hi][i].x === vx && cycleHoles[hi][i].y === vy) {
                      console.log(`    found in hole[${hi}][${i}]: turn=${cycleHoles[hi][i].turn} bridge=${cycleHoles[hi][i].bridge||false}`);
                    }
                  }
                }
              };
              console.log(`  SPLIT FAILED — searching all loops for v=(${diag.vx},${diag.vy}):`);
              searchAll(diag.vx, diag.vy);
            }
          }
        }
      }

      // Phase 2: Splice different-component diagonals (merges + cycle-closing)
      // Group components by their current loop (as loops merge, track which
      // component indices share each loop)
      const compToLoop = new Map(); // compIndex → loop reference key
      const loops = new Map(); // loop key → vertex array
      let loopCounter = 0;
      for (const ci of compIndices) {
        const lk = loopCounter++;
        compToLoop.set(ci, lk);
        loops.set(lk, loopMap.get(ci));
      }

      for (const diag of scDiags) {
        if (diag.sameComp) continue; // already handled in phase 1
        const lk1 = compToLoop.get(diag.ciA);
        const lk2 = compToLoop.get(diag.ciB);
        if (lk1 === lk2) {
          // Cycle-closing diagonal: both components already in same loop.
          // Split into outer boundary + inner hole instead of self-splicing.
          const loop = loops.get(lk1);
          console.log(`[cycle-closing] v=(${diag.vx},${diag.vy}) dir=${diag.dir} loopLen=${loop.length}`);
          const split = splitLoopAtCycleClosing(loop, diag.vx, diag.vy);
          if (split) {
            console.log(`  split ok: outer=${split.outer.length} hole=${split.hole.length}`);
            loops.set(lk1, split.outer);
            cycleHoles.push(split.hole);
          } else {
            // Prior split may have sent one visit to a hole loop.
            let splitInHole = false;
            for (let hi = 0; hi < cycleHoles.length; hi++) {
              const hSplit = splitLoopAtCycleClosing(cycleHoles[hi], diag.vx, diag.vy);
              if (hSplit) {
                console.log(`  split in hole[${hi}]: outer=${hSplit.outer.length} hole=${hSplit.hole.length}`);
                cycleHoles[hi] = hSplit.outer;
                cycleHoles.push(hSplit.hole);
                splitInHole = true;
                break;
              }
            }
            if (!splitInHole) {
              // Vertex visits spread across two different holes — merge them
              const holeIndices = [];
              for (let hi = 0; hi < cycleHoles.length; hi++) {
                if (cycleHoles[hi].some(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right")) {
                  holeIndices.push(hi);
                }
              }
              if (holeIndices.length >= 2) {
                const [ha, hb] = holeIndices;
                const merged = spliceLoopsAtVertex(cycleHoles[ha], cycleHoles[hb], diag.vx, diag.vy);
                if (merged) {
                  console.log(`  merged holes[${ha}]+[${hb}]: ${merged.length} vertices`);
                  cycleHoles[ha] = merged;
                  cycleHoles.splice(hb, 1);
                } else {
                  console.log(`  HOLE MERGE FAILED`);
                }
              } else {
                console.log(`  SPLIT FAILED (${holeIndices.length} holes have vertex)`);
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
            // Update all components that pointed to lk2
            for (const [ci, lk] of compToLoop) {
              if (lk === lk2) compToLoop.set(ci, lk1);
            }
          } else {
            // Merge failed — a Phase 1 same-comp split may have sent the vertex
            // to a hole loop.  Splice the orphan component into that hole so that
            // it appears as a filled island inside the hole.  Then mark both
            // components as sharing the same super-component so later diagonals
            // between them become cycle-closing (which already searches holes).
            const in1 = loop1.some(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right");
            const in2 = loop2.some(v => v.x === diag.vx && v.y === diag.vy && v.turn === "right");
            let merged2 = false;
            // Determine which loop is the "orphan" (has the vertex) and which
            // loop's vertex ended up in a hole.
            const orphanLoop = in2 ? loop2 : in1 ? loop1 : null;
            const orphanLk   = in2 ? lk2   : in1 ? lk1   : null;
            const keepLk     = in2 ? lk1   : in1 ? lk2   : null;
            if (orphanLoop) {
              for (let hi = 0; hi < cycleHoles.length; hi++) {
                const result = spliceLoopsAtVertex(cycleHoles[hi], orphanLoop, diag.vx, diag.vy);
                if (result) {
                  cycleHoles[hi] = result;
                  loops.delete(orphanLk);
                  // Point orphan components to the keep loop's super-component
                  for (const [ci, lk] of compToLoop) {
                    if (lk === orphanLk) compToLoop.set(ci, keepLk);
                  }
                  merged2 = true;
                  break;
                }
              }
            }
            if (!merged2) {
              console.log(`[merge FAIL] v=(${diag.vx},${diag.vy}) dir=${diag.dir} loop1=${loop1.length} loop2=${loop2.length}`);
            }
          }
        }
      }

      // Emit all outer loops
      for (const [, loop] of loops) {
        emitLoop(loop, superPixels, false);
      }

      // Emit cycle-closing hole loops
      for (const hole of cycleHoles) {
        emitLoop(hole, superPixels, true);
      }

      // Hole detection on the merged super-component pixel set.
      // Account for cycle holes already emitted — their winding cancels the
      // outer loop's enclosure, so we don't need a redundant hole path.
      const holes = findHoles(superPixels);
      const outerLoops = [...loops.values()];
      const neededHoles = holes.filter(hole => {
        const testCell = hole.values().next().value;
        const [tx, ty] = unkey(testCell);
        const px = tx + 0.5, py = ty + 0.5;
        let winding = 0;
        for (const loop of outerLoops) winding += windingFromVertices(loop, px, py);
        for (const ch of cycleHoles) winding += windingFromVertices(ch, px, py);
        return winding !== 0;
      });
      for (const hole of neededHoles) {
        emitLoop(traceHoleBoundary(hole), superPixels, true);
      }
    }
  }

  return { path: pathParts.join(" "), fillets: "" };
}
