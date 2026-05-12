/**
 * Visualize what the pixel classifier and vertex map expose to renderers.
 * Generates an annotated SVG + structured text dump.
 *
 * Usage: node test/viz-classifier.mjs [pattern] [name]
 *   pattern: grid rows separated by / (e.g. "..X/XX./XXX" or "XXX./X.XX/XX.X/.XXX")
 *   name: optional label for output file (e.g. "pattern-a" → /tmp/viz-classifier-pattern-a.svg)
 */
import { writeFileSync } from 'node:fs';
import { classifyPixels, computeVertexMap } from '../pixel-classify.mjs';
import { key, fmt } from '../pixel-paths.mjs';

const patternArg = process.argv[2] || "XXX./X.XX/XX.X/.XXX";
const nameArg = process.argv[3] || "";
const rows = patternArg.split("/");
const H = rows.length;
const W = Math.max(...rows.map(r => r.length));

// Build pixel set
const pixels = [];
const allPixels = new Set();
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    if (rows[r]?.[c] === 'X') {
      pixels.push(key(c, r));
      allPixels.add(key(c, r));
    }

const ro = 0.5, ri = 0.45, cd = 0, flc = true, scl = false;
const pixelMap = classifyPixels(allPixels, allPixels, { ro, ri, connectDiagonals: cd, fullLCorners: flc, skipCheckerLCorners: scl });
const vertexMap = computeVertexMap(pixelMap, allPixels, { ro, ri });

// SVG parameters
const cellPx = 80;
const margin = cellPx;
const svgW = (W + 2) * cellPx;
const svgH = (H + 2) * cellPx;
const ox = margin;
const oy = margin;

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}">`);
parts.push(`<rect width="${svgW}" height="${svgH}" fill="#f8f8f8"/>`);

// Draw grid lines
parts.push(`<g stroke="#ddd" stroke-width="0.5">`);
for (let x = 0; x <= W; x++)
  parts.push(`<line x1="${ox + x * cellPx}" y1="${oy}" x2="${ox + x * cellPx}" y2="${oy + H * cellPx}"/>`);
for (let y = 0; y <= H; y++)
  parts.push(`<line x1="${ox}" y1="${oy + y * cellPx}" x2="${ox + W * cellPx}" y2="${oy + y * cellPx}"/>`);
parts.push(`</g>`);

// Draw filled pixels
for (const k of allPixels) {
  const [x, y] = k.split(",").map(Number);
  parts.push(`<rect x="${ox + x * cellPx + 1}" y="${oy + y * cellPx + 1}" width="${cellPx - 2}" height="${cellPx - 2}" fill="#e0e0e0" rx="2"/>`);
  parts.push(`<text x="${ox + (x + 0.5) * cellPx}" y="${oy + (y + 0.5) * cellPx}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="#999">${x},${y}</text>`);
}

// Draw classifier annotations per pixel
for (const [, info] of pixelMap) {
  const px = ox + info.x * cellPx;
  const py = oy + info.y * cellPx;

  const corners = [
    { name: "tl", cx: px, cy: py },
    { name: "tr", cx: px + cellPx, cy: py },
    { name: "br", cx: px + cellPx, cy: py + cellPx },
    { name: "bl", cx: px, cy: py + cellPx },
  ];

  for (const c of corners) {
    const ci = info.corners[c.name];
    if (!ci.rounded) continue;
    const dx = (c.name.includes("l") ? 1 : -1) * 6;
    const dy = (c.name.includes("t") ? 1 : -1) * 6;
    const dotR = ci.radius === 1 ? 7 : 4;
    const color = ci.radius === 1 ? "#e22" : "#22e";
    parts.push(`<circle cx="${c.cx + dx}" cy="${c.cy + dy}" r="${dotR}" fill="${color}" opacity="0.7"/>`);
    parts.push(`<text x="${c.cx + dx}" y="${c.cy + dy + 3}" text-anchor="middle" font-size="8" fill="white" font-weight="bold">${ci.radius}</text>`);
  }
}

// Draw tip annotations
for (const [, info] of pixelMap) {
  if (!info.tip) continue;
  const cx = ox + (info.x + 0.5) * cellPx;
  const cy = oy + (info.y + 0.5) * cellPx;
  // Arrow pointing in tip direction
  const arrowLen = cellPx * 0.3;
  const dx = info.tip === "right" ? 1 : info.tip === "left" ? -1 : 0;
  const dy = info.tip === "down" ? 1 : info.tip === "up" ? -1 : 0;
  const ax = cx + dx * arrowLen, ay = cy + dy * arrowLen;
  // Perpendicular for arrowhead
  const px = -dy * 5, py = dx * 5;
  const tailX = cx - dx * arrowLen * 0.5, tailY = cy - dy * arrowLen * 0.5;
  parts.push(`<line x1="${tailX}" y1="${tailY}" x2="${ax}" y2="${ay}" stroke="#d4a" stroke-width="2.5" opacity="0.8"/>`);
  parts.push(`<polygon points="${ax},${ay} ${ax - dx * 8 + px},${ay - dy * 8 + py} ${ax - dx * 8 - px},${ay - dy * 8 - py}" fill="#d4a" opacity="0.8"/>`);
}

// Draw vertex map annotations
for (const [, v] of vertexMap) {
  const sx = ox + v.vx * cellPx;
  const sy = oy + v.vy * cellPx;

  // Vertex dot: color by pattern
  const dotColor = v.pattern === "checkerboard" ? "#f90"
    : v.pattern === "convex" ? "#aaa"
    : v.pattern === "concave" ? "#6a6"
    : "#888";
  parts.push(`<circle cx="${sx}" cy="${sy}" r="3" fill="${dotColor}"/>`);

  // Label
  let label = v.pattern === "checkerboard" ? "C"
    : v.pattern === "concave" ? `3`
    : v.pattern === "convex" ? "1"
    : String(v.filledCount);
  parts.push(`<text x="${sx}" y="${sy - 6}" text-anchor="middle" font-size="9" fill="${dotColor}" font-weight="bold">${label}</text>`);

  // Concave fillet geometry: draw endpoints and control point
  if (v.concave && v.concave.eA) {
    const eA = v.concave.eA, eB = v.concave.eB, cp = v.concave.cp;
    const ax = ox + eA.px * cellPx, ay = oy + eA.py * cellPx;
    const bx = ox + eB.px * cellPx, by = oy + eB.py * cellPx;
    const cpx = ox + cp.x * cellPx, cpy = oy + cp.y * cellPx;

    // Draw fillet curve
    parts.push(`<path d="M${ax},${ay} Q${cpx},${cpy} ${bx},${by}" fill="none" stroke="#2a2" stroke-width="1.5" opacity="0.8"/>`);
    // Endpoint dots
    const aColor = v.concave.aOnArc ? "#e22" : "#2a2";
    const bColor = v.concave.bOnArc ? "#e22" : "#2a2";
    parts.push(`<circle cx="${ax}" cy="${ay}" r="3" fill="${aColor}"/>`);
    parts.push(`<circle cx="${bx}" cy="${by}" r="3" fill="${bColor}"/>`);
    // Control point
    parts.push(`<circle cx="${cpx}" cy="${cpy}" r="2" fill="none" stroke="#2a2" stroke-width="0.5"/>`);
  }

  // Checkerboard: mark L-corner owners
  if (v.checkerboard) {
    for (const o of v.checkerboard.owners) {
      if (o.isLCorner) {
        parts.push(`<circle cx="${sx}" cy="${sy}" r="10" fill="none" stroke="#f90" stroke-width="1" opacity="0.6"/>`);
        break;
      }
    }
  }
}

// Legend
const lx = 10, ly = svgH - 115;
parts.push(`<g font-size="10">`);
parts.push(`<text x="${lx}" y="${ly}" fill="#333" font-weight="bold">Legend:</text>`);
parts.push(`<circle cx="${lx + 8}" cy="${ly + 15}" r="4" fill="#22e" opacity="0.7"/><text x="${lx + 18}" y="${ly + 19}" fill="#333">outer arc (r=${ro})</text>`);
parts.push(`<circle cx="${lx + 8}" cy="${ly + 30}" r="7" fill="#e22" opacity="0.7"/><text x="${lx + 18}" y="${ly + 34}" fill="#333">L-corner (r=1)</text>`);
parts.push(`<path d="M${lx},${ly + 48} Q${lx + 10},${ly + 42} ${lx + 16},${ly + 48}" fill="none" stroke="#2a2" stroke-width="1.5"/><text x="${lx + 22}" y="${ly + 52}" fill="#333">fillet curve (green=grid, red=on arc)</text>`);
parts.push(`<circle cx="${lx + 8}" cy="${ly + 65}" r="3" fill="#f90"/><text x="${lx + 18}" y="${ly + 69}" fill="#333">checkerboard vertex</text>`);
parts.push(`<line x1="${lx + 3}" y1="${ly + 82}" x2="${lx + 13}" y2="${ly + 78}" stroke="#d4a" stroke-width="2.5"/><polygon points="${lx + 13},${ly + 78} ${lx + 7},${ly + 75} ${lx + 9},${ly + 82}" fill="#d4a"/><text x="${lx + 22}" y="${ly + 84}" fill="#333">tip (arrow = direction)</text>`);
parts.push(`</g>`);
parts.push(`</svg>`);

const svgOut = `/tmp/viz-classifier${nameArg ? '-' + nameArg : ''}.svg`;
writeFileSync(svgOut, parts.join("\n"));
console.log(`Wrote ${svgOut}`);

// === Structured text dump ===
console.log(`\n=== Classifier output for pattern: ${patternArg} ===`);
console.log(`Grid: ${W}x${H}, ${allPixels.size} pixels, ro=${ro} ri=${ri} flc=${flc}\n`);

console.log(`--- pixelMap (${pixelMap.size} entries) ---`);
for (const [, info] of pixelMap) {
  const cStr = Object.entries(info.corners)
    .map(([name, c]) => `${name}:${c.rounded ? `r${c.radius}` : "-"}`)
    .join(" ");
  const fStr = Object.entries(info.innerFillets)
    .filter(([, v]) => v)
    .map(([name]) => name)
    .join(",") || "none";
  const tipStr = info.tip ? ` TIP→${info.tip}` : "";
  console.log(`  pixel(${info.x},${info.y}): corners[${cStr}] fillets[${fStr}]${tipStr}`);
}

console.log(`\n--- vertexMap (${vertexMap.size} entries) ---`);
for (const [, v] of vertexMap) {
  const occ = `${v.occupancy.nw ? "■" : "·"}${v.occupancy.ne ? "■" : "·"}/${v.occupancy.sw ? "■" : "·"}${v.occupancy.se ? "■" : "·"}`;
  let detail = "";

  if (v.convex) {
    const c = v.convex;
    detail = `CONVEX ${c.pixelKey}.${c.corner} r=${c.radius}${c.isLCorner ? " L-CORNER" : ""}`;
  } else if (v.checkerboard) {
    const ch = v.checkerboard;
    const ownStr = ch.owners.map(o => `${o.pixelKey}.${o.corner}=r${o.radius}${o.isLCorner ? "*" : ""}`).join(" ");
    detail = `CHECKER ${ch.diagType}: ${ownStr}`;
  } else if (v.concave) {
    const c = v.concave;
    detail = `CONCAVE absent=${c.absent}`;
    if (c.eA) {
      detail += `\n      eA=(${fmt(c.eA.px)},${fmt(c.eA.py)})${c.aOnArc ? " [arc]" : ""}`;
      detail += ` eB=(${fmt(c.eB.px)},${fmt(c.eB.py)})${c.bOnArc ? " [arc]" : ""}`;
      detail += ` cp=(${fmt(c.cp.x)},${fmt(c.cp.y)})`;
    }
  } else if (v.pattern === "edge") {
    detail = "EDGE";
  } else if (v.pattern === "full") {
    detail = "INTERIOR";
  }

  console.log(`  vertex(${v.vx},${v.vy}): ${occ} ${detail}`);
}
