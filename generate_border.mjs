/**
 * Generate a QR code border SVG from a plain QR code SVG.
 * ES module — usable from Node CLI or browser import.
 */

// --- Fixed constants ---
const FINDER_ZONE = 8; // 7x7 finder pattern + 1 separator
const DEFAULT_GAP = 1;
const DEFAULT_FLANK_GAP = 1;

// --- Circle / layout ---
const CIRCLE_RATIO = 27 / 33; // default 0.81818
const CIRCLE_MARGIN = 3;
const CIRCLE_STROKE_WIDTH = 2;

const DEBUG_PALETTE = {
  top: ["#888888", "#cc4444", "#4444cc", "#cc8844", "#4488cc"],
  bottom: ["#aaaaaa", "#ee8888", "#8888ee", "#eeaa88", "#88aaee"],
  left: ["#888888", "#cc4444", "#4444cc", "#cc8844", "#4488cc"],
  right: ["#aaaaaa", "#ee8888", "#8888ee", "#eeaa88", "#88aaee"],
};

// --- Coordinate helpers (Set<string> since JS Sets lack tuple equality) ---
const key = (c, r) => `${c},${r}`;
const unkey = (k) => { const i = k.indexOf(","); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };

// --- Core functions ---

export function parseQr(svgText) {
  const matches = svgText.matchAll(/M(\d+),(\d+)/g);
  const squares = new Set();
  let origin = null;
  for (const m of matches) {
    const x = parseInt(m[1]), y = parseInt(m[2]);
    if (origin === null) origin = [x, y];
    squares.add(key(x - origin[0], y - origin[1]));
  }
  let maxC = 0;
  for (const k of squares) { const [c] = unkey(k); if (c > maxC) maxC = c; }
  const qrSize = maxC + 1;
  return { squares, qrSize };
}

// --- Alignment pattern helpers ---

function getAlignmentPositions(version) {
  if (version <= 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  if (numAlign === 2) return [6, size - 7];
  const last = size - 7;
  const step = Math.ceil((last - 6) / (numAlign - 1) / 2) * 2;
  const result = [6];
  for (let pos = last; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function randomizeAlignmentPatterns(squares, qrSize) {
  const version = (qrSize - 17) / 4;
  const positions = getAlignmentPositions(version);
  if (positions.length === 0) return squares;
  const last = qrSize - 7;
  const result = new Set(squares);
  for (const row of positions) {
    for (const col of positions) {
      // Skip positions that overlap with finder patterns
      if (row === 6 && col === 6) continue;
      if (row === 6 && col === last) continue;
      if (row === last && col === 6) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const k = key(col + dx, row + dy);
          result.delete(k);
          if (Math.random() < 0.5) result.add(k);
        }
      }
    }
  }
  return result;
}

export function computeLayout(qrSize, circleRatio = CIRCLE_RATIO, strokeWidth = CIRCLE_STROKE_WIDTH, borderShape = "circle", cornerRadius = 0, snapRadius = false) {
  let circleR = qrSize * circleRatio;
  if (snapRadius) circleR = Math.round(circleR);
  const svgSize = 2 * circleR + 2 * CIRCLE_MARGIN;
  const qrOrigin = (svgSize - qrSize) / 2;
  return {
    qrSize, svgSize, qrOrigin,
    circleCx: svgSize / 2,
    circleCy: svgSize / 2,
    circleR, strokeWidth, borderShape, cornerRadius,
  };
}

function trimEdges(squares, qrSize, { left = false, right = false, top = false, bottom = false }) {
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

function squaresToPath(squares) {
  const sorted = [...squares].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return sorted.map(([x, y]) => {
    const xf = x === Math.trunc(x) ? Math.trunc(x) : x.toFixed(1);
    const yf = y === Math.trunc(y) ? Math.trunc(y) : y.toFixed(1);
    return `M${xf},${yf}h1v1h-1z`;
  }).join(" ");
}

function flipVertical(squares, qrSize) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(c, qrSize - 1 - r)); }
  return result;
}

function flipHorizontal(squares, qrSize) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(qrSize - 1 - c, r)); }
  return result;
}

function shift(squares, dc, dr) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(c + dc, r + dr)); }
  return result;
}

function offsetToSvg(squares, xOff, yOff) {
  const result = new Set();
  for (const k of squares) { const [c, r] = unkey(k); result.add(key(xOff + c, yOff + r)); }
  return result;
}

function trimCornersDiagonal(squares, layout, trimDxGeDy) {
  const qo = layout.qrOrigin;
  const qe = qo + layout.qrSize;
  const result = new Set();
  for (const k of squares) {
    const [x, y] = unkey(k);
    let dx = null, dy = null;
    if (x < qo && y < qo) { dx = qo - x; dy = qo - y; }
    else if (x >= qe && y < qo) { dx = x - qe + 1; dy = qo - y; }
    else if (x < qo && y >= qe) { dx = qo - x; dy = y - qe + 1; }
    else if (x >= qe && y >= qe) { dx = x - qe + 1; dy = y - qe + 1; }
    if (dx !== null) {
      if (trimDxGeDy && dx >= dy) continue;
      if (!trimDxGeDy && dy >= dx) continue;
    }
    result.add(k);
  }
  return result;
}

// --- Flanking helpers ---

function makeFlankingH(center, qrSize, rightInset, leftInset, reps = 1) {
  const mirrored = flipHorizontal(center, qrSize);
  const rightStep = qrSize - rightInset;
  const leftStep = qrSize - leftInset;
  const results = [];
  for (let i = 1; i <= reps; i++) {
    const copy = i % 2 === 1 ? mirrored : center;
    results.push(["left", shift(copy, -leftStep * i, 0)]);
    results.push(["right", shift(copy, rightStep * i, 0)]);
  }
  return results;
}

function makeFlankingV(center, qrSize, lowerInset, upperInset, reps = 1) {
  const mirrored = flipVertical(center, qrSize);
  const upperStep = qrSize - upperInset;
  const lowerStep = qrSize - lowerInset;
  const results = [];
  for (let i = 1; i <= reps; i++) {
    const copy = i % 2 === 1 ? mirrored : center;
    results.push(["upper", shift(copy, 0, -upperStep * i)]);
    results.push(["lower", shift(copy, 0, lowerStep * i)]);
  }
  return results;
}

// --- Group builders ---

function makeTopGroup(qr, layout, reps = 2) {
  const { qrSize, qrOrigin, gap, flankInset } = layout;
  const yOff = qrOrigin - gap - qrSize;
  const trimmed = trimEdges(qr, qrSize, { left: true, right: true });
  const center = flipVertical(trimmed, qrSize);
  const flanks = makeFlankingH(center, qrSize, flankInset, flankInset, reps);
  const result = [["top center", offsetToSvg(center, qrOrigin, yOff)]];
  for (const [side, sq] of flanks) result.push([`top ${side}`, offsetToSvg(sq, qrOrigin, yOff)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, true)]);
}

function makeBottomGroup(qr, layout) {
  const { qrSize, qrOrigin, gap, flankInset, flankInsetNoFinder } = layout;
  const yOff = qrOrigin + qrSize + gap;
  const trimmed = trimEdges(qr, qrSize, { left: true });
  const center = flipVertical(trimmed, qrSize);
  const flanks = makeFlankingH(center, qrSize, flankInsetNoFinder, flankInset);
  const result = [["bottom center", offsetToSvg(center, qrOrigin, yOff)]];
  for (const [side, sq] of flanks) result.push([`bottom ${side}`, offsetToSvg(sq, qrOrigin, yOff)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, true)]);
}

function makeLeftGroup(qr, layout, reps = 2) {
  const { qrSize, qrOrigin, gap, flankInset } = layout;
  const xOff = qrOrigin - gap - qrSize;
  const trimmed = trimEdges(qr, qrSize, { top: true, bottom: true });
  const center = flipHorizontal(trimmed, qrSize);
  const flanks = makeFlankingV(center, qrSize, flankInset, flankInset, reps);
  const result = [["left center", offsetToSvg(center, xOff, qrOrigin)]];
  for (const [side, sq] of flanks) result.push([`left ${side}`, offsetToSvg(sq, xOff, qrOrigin)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, false)]);
}

function makeRightGroup(qr, layout) {
  const { qrSize, qrOrigin, gap, flankInset, flankInsetNoFinder } = layout;
  const xOff = qrOrigin + qrSize + gap;
  const trimmed = trimEdges(qr, qrSize, { top: true });
  const center = flipHorizontal(trimmed, qrSize);
  const flanks = makeFlankingV(center, qrSize, flankInsetNoFinder, flankInset);
  const result = [["right center", offsetToSvg(center, xOff, qrOrigin)]];
  for (const [side, sq] of flanks) result.push([`right ${side}`, offsetToSvg(sq, xOff, qrOrigin)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, false)]);
}

// --- Border shape SDF (signed distance function) ---

function shapeSDF(px, py, layout, radiusOffset) {
  const cx = layout.circleCx, cy = layout.circleCy;
  const r = layout.circleR + radiusOffset;
  if (layout.borderShape === "square") {
    const cr = layout.cornerRadius * r;
    const qx = Math.abs(px - cx) - r + cr;
    const qy = Math.abs(py - cy) - r + cr;
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) - cr;
  }
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r;
}

function pixelOverlapsStroke(x, y, layout, radiusOffset, strokeWidth) {
  const hw = strokeWidth / 2;
  const corners = [
    shapeSDF(x, y, layout, radiusOffset),
    shapeSDF(x + 1, y, layout, radiusOffset),
    shapeSDF(x, y + 1, layout, radiusOffset),
    shapeSDF(x + 1, y + 1, layout, radiusOffset),
  ];
  const minSDF = Math.min(...corners);
  const maxSDF = Math.max(...corners);
  // Pixel overlaps stroke if some part is inside outer edge AND some part is outside inner edge
  return minSDF < hw && maxSDF > -hw;
}

// --- SVG output ---

function fmt(v) {
  if (v === Math.trunc(v)) return String(Math.trunc(v));
  // Match Python's %g: 6 significant digits, no trailing zeros
  const s = v.toPrecision(6);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function borderShapeElement(layout, attrs, radiusOffset = 0) {
  const r = layout.circleR + radiusOffset;
  const cx = fmt(layout.circleCx), cy = fmt(layout.circleCy);
  const attrStr = attrs ? " " + attrs : "";
  if (layout.borderShape === "square") {
    const x = fmt(layout.circleCx - r);
    const y = fmt(layout.circleCy - r);
    const side = fmt(2 * r);
    const rx = fmt(layout.cornerRadius * r);
    return `<rect x="${x}" y="${y}" width="${side}" height="${side}" rx="${rx}" ry="${rx}"${attrStr}/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${fmt(r)}"${attrStr}/>`;
}

function generateSvg(qrPath, decorationPaths, layout, {
  bgColor = "#ffffff", bgShape = "circle", fgColor = "#000000", borderColor = "#000000",
  border2Color = null, border2Width = 4, border2Offset = 0,
} = {}) {
  const s = fmt(layout.svgSize);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">`,
  ];
  if (bgShape === "circle") {
    lines.push(`  ${borderShapeElement(layout, `fill="${bgColor}"`)}`);
  } else {
    lines.push(`  <rect width="100%" height="100%" fill="${bgColor}"/>`);
  }
  lines.push(
    `  <defs>`,
    `    <clipPath id="border-clip">`,
    `      ${borderShapeElement(layout, "")}`,
    `    </clipPath>`,
    `  </defs>`,
    `  <g clip-path="url(#border-clip)">`,
    `    <path d="${qrPath}" fill="${fgColor}"/>`,
  );
  for (const [label, pathD, color] of decorationPaths) {
    lines.push(`    <!-- ${label} -->`);
    lines.push(`    <path d="${pathD}" fill="${color}"/>`);
  }
  lines.push(`  </g>`);
  if (border2Color !== null) {
    lines.push(
      `  ${borderShapeElement(layout, `fill="none" stroke="${border2Color}" stroke-width="${fmt(border2Width)}"`, border2Offset)}`
    );
  }
  lines.push(
    `  ${borderShapeElement(layout, `fill="none" stroke="${borderColor}" stroke-width="${fmt(layout.strokeWidth)}"`)}`
  );
  lines.push(`</svg>`);
  return lines.join("\n");
}

// --- Main entry point ---

export function generate(svgText, {
  colorful = false,
  circleRatio = CIRCLE_RATIO,
  strokeWidth = CIRCLE_STROKE_WIDTH,
  bgColor = "#ffffff",
  bgShape = "circle",
  fgColor = "#000000",
  borderColor = "#000000",
  borderShape = "circle",
  cornerRadius = 0,
  border2Color = null,
  border2Width = 4,
  border2Offset = 0,
  border2Trim = false,
  snapRadius = false,
  shuffle = false,
  gap = DEFAULT_GAP,
  flankGap = DEFAULT_FLANK_GAP,
  randAlign = false,
} = {}) {
  const { squares: qr, qrSize } = parseQr(svgText);
  const layout = computeLayout(qrSize, circleRatio, strokeWidth, borderShape, cornerRadius, snapRadius);
  layout.gap = gap;
  layout.flankInset = 2 * FINDER_ZONE - flankGap;
  layout.flankInsetNoFinder = -flankGap;

  const qrSvg = offsetToSvg(qr, layout.qrOrigin, layout.qrOrigin);
  const qrPath = squaresToPath(qrSvg);

  const fluffQr = randAlign ? randomizeAlignmentPatterns(qr, qrSize) : qr;

  const allGroups = [
    ["top", makeTopGroup(fluffQr, layout)],
    ["bottom", makeBottomGroup(fluffQr, layout)],
    ["left", makeLeftGroup(fluffQr, layout)],
    ["right", makeRightGroup(fluffQr, layout)],
  ];

  // Shuffle: swap center pieces across the diagonal (top↔left, bottom↔right)
  // and flip one flanking piece per side to break repetition
  if (shuffle) {
    const transpose = (squares) => {
      const result = new Set();
      for (const k of squares) { const [x, y] = unkey(k); result.add(key(y, x)); }
      return result;
    };
    const flipLocalV = (squares) => {
      let minY = Infinity, maxY = -Infinity;
      for (const k of squares) { const [, y] = unkey(k); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const result = new Set();
      for (const k of squares) { const [x, y] = unkey(k); result.add(key(x, minY + maxY - y)); }
      return result;
    };
    const flipLocalH = (squares) => {
      let minX = Infinity, maxX = -Infinity;
      for (const k of squares) { const [x] = unkey(k); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      const result = new Set();
      for (const k of squares) { const [x, y] = unkey(k); result.add(key(minX + maxX - x, y)); }
      return result;
    };

    // Swap center pieces
    const refs = {};
    for (const [, group] of allGroups) {
      for (let i = 0; i < group.length; i++) {
        refs[group[i][0]] = [group, i];
      }
    }
    if (refs["top center"] && refs["left center"]) {
      const ts = refs["top center"][0][refs["top center"][1]][1];
      const ls = refs["left center"][0][refs["left center"][1]][1];
      refs["top center"][0][refs["top center"][1]] = ["top center", transpose(ls)];
      refs["left center"][0][refs["left center"][1]] = ["left center", transpose(ts)];
    }
    if (refs["bottom center"] && refs["right center"]) {
      const bs = refs["bottom center"][0][refs["bottom center"][1]][1];
      const rs = refs["right center"][0][refs["right center"][1]][1];
      refs["bottom center"][0][refs["bottom center"][1]] = ["bottom center", transpose(rs)];
      refs["right center"][0][refs["right center"][1]] = ["right center", transpose(bs)];
    }

    // Flip one flanking piece in top and left groups to break symmetry
    for (const [name, group] of allGroups) {
      if ((name === "top" || name === "left") && group.length > 1) {
        const [label, squares] = group[1];
        group[1] = [label, name === "top" ? flipLocalV(squares) : flipLocalH(squares)];
      }
    }
  }

  // Remove fluff pixels that overlap with the second border's stroke area
  if (border2Color !== null && border2Trim) {
    for (const [, group] of allGroups) {
      for (let i = 0; i < group.length; i++) {
        const [label, svgSquares] = group[i];
        const filtered = new Set();
        for (const k of svgSquares) {
          const [x, y] = unkey(k);
          if (!pixelOverlapsStroke(x, y, layout, border2Offset, border2Width)) {
            filtered.add(k);
          }
        }
        group[i] = [label, filtered];
      }
    }
  }

  const decorationPaths = [];
  for (const [groupName, group] of allGroups) {
    const palette = colorful ? DEBUG_PALETTE[groupName] : null;
    for (let i = 0; i < group.length; i++) {
      const [label, svgSquares] = group[i];
      const color = palette ? palette[i % palette.length] : fgColor;
      decorationPaths.push([label, squaresToPath(svgSquares), color]);
    }
  }

  return generateSvg(qrPath, decorationPaths, layout, { bgColor, bgShape, fgColor, borderColor, border2Color, border2Width, border2Offset });
}

// --- Node CLI ---

async function cli() {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { parseArgs } = await import("node:util");

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o", default: "qr-code-generated.svg" },
      colorful: { type: "boolean", default: false },
      "circle-ratio": { type: "string", default: String(CIRCLE_RATIO) },
      "stroke-width": { type: "string", default: String(CIRCLE_STROKE_WIDTH) },
      "bg-color": { type: "string", default: "#ffffff" },
      "bg-shape": { type: "string", default: "circle" },
      "fg-color": { type: "string", default: "#000000" },
      "border-color": { type: "string", default: "#000000" },
      "border-shape": { type: "string", default: "circle" },
      "corner-radius": { type: "string", default: "0" },
      "border2-color": { type: "string" },
      "border2-width": { type: "string", default: "4" },
      "border2-offset": { type: "string", default: "0" },
      "border2-trim": { type: "boolean", default: false },
      "snap-radius": { type: "boolean", default: false },
      "shuffle": { type: "boolean", default: false },
      "gap": { type: "string", default: String(DEFAULT_GAP) },
      "flank-gap": { type: "string", default: String(DEFAULT_FLANK_GAP) },
      "rand-align": { type: "boolean", default: false },
    },
  });

  const input = positionals[0] || "qr-code-original.svg";
  const svgText = readFileSync(input, "utf-8");

  const { qrSize } = parseQr(svgText);
  const version = (qrSize - 17) / 4;
  console.log(`Detected QR version ${version}: ${qrSize}x${qrSize} grid`);

  const result = generate(svgText, {
    colorful: values.colorful,
    circleRatio: parseFloat(values["circle-ratio"]),
    strokeWidth: parseFloat(values["stroke-width"]),
    bgColor: values["bg-color"],
    bgShape: values["bg-shape"],
    fgColor: values["fg-color"],
    borderColor: values["border-color"],
    borderShape: values["border-shape"],
    cornerRadius: parseFloat(values["corner-radius"]),
    border2Color: values["border2-color"] || null,
    border2Width: parseFloat(values["border2-width"]),
    border2Offset: parseFloat(values["border2-offset"]),
    border2Trim: values["border2-trim"],
    snapRadius: values["snap-radius"],
    shuffle: values["shuffle"],
    gap: parseInt(values["gap"]),
    flankGap: parseInt(values["flank-gap"]),
    randAlign: values["rand-align"],
  });

  writeFileSync(values.output, result);
  console.log(`Wrote ${values.output}`);
}

// Run CLI if invoked directly via Node
const isNode = typeof process !== "undefined" && process.argv?.[1];
if (isNode && import.meta.url === `file://${process.argv[1]}`) {
  cli().catch(e => { console.error(e); process.exit(1); });
}
