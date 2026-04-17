/**
 * Generate a QR code border SVG from a plain QR code SVG.
 * ES module — usable from Node CLI or browser import.
 */

// --- Fixed constants ---
const FINDER_ZONE = 8; // 7x7 finder pattern + 1 separator
const GAP = 1;
const FLANK_GAP = 1;
const FLANK_INSET = 2 * FINDER_ZONE - FLANK_GAP; // 15
const FLANK_INSET_NO_FINDER = -FLANK_GAP; // -1

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

export function computeLayout(qrSize, circleRatio = CIRCLE_RATIO, strokeWidth = CIRCLE_STROKE_WIDTH) {
  const circleR = qrSize * circleRatio;
  const svgSize = 2 * circleR + 2 * CIRCLE_MARGIN;
  const qrOrigin = (svgSize - qrSize) / 2;
  return {
    qrSize, svgSize, qrOrigin,
    circleCx: svgSize / 2,
    circleCy: svgSize / 2,
    circleR, strokeWidth,
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
  const { qrSize, qrOrigin } = layout;
  const yOff = qrOrigin - GAP - qrSize;
  const trimmed = trimEdges(qr, qrSize, { left: true, right: true });
  const center = flipVertical(trimmed, qrSize);
  const flanks = makeFlankingH(center, qrSize, FLANK_INSET, FLANK_INSET, reps);
  const result = [["top center", offsetToSvg(center, qrOrigin, yOff)]];
  for (const [side, sq] of flanks) result.push([`top ${side}`, offsetToSvg(sq, qrOrigin, yOff)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, true)]);
}

function makeBottomGroup(qr, layout) {
  const { qrSize, qrOrigin } = layout;
  const yOff = qrOrigin + qrSize + GAP;
  const trimmed = trimEdges(qr, qrSize, { left: true });
  const center = flipVertical(trimmed, qrSize);
  const flanks = makeFlankingH(center, qrSize, FLANK_INSET_NO_FINDER, FLANK_INSET);
  const result = [["bottom center", offsetToSvg(center, qrOrigin, yOff)]];
  for (const [side, sq] of flanks) result.push([`bottom ${side}`, offsetToSvg(sq, qrOrigin, yOff)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, true)]);
}

function makeLeftGroup(qr, layout, reps = 2) {
  const { qrSize, qrOrigin } = layout;
  const xOff = qrOrigin - GAP - qrSize;
  const trimmed = trimEdges(qr, qrSize, { top: true, bottom: true });
  const center = flipHorizontal(trimmed, qrSize);
  const flanks = makeFlankingV(center, qrSize, FLANK_INSET, FLANK_INSET, reps);
  const result = [["left center", offsetToSvg(center, xOff, qrOrigin)]];
  for (const [side, sq] of flanks) result.push([`left ${side}`, offsetToSvg(sq, xOff, qrOrigin)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, false)]);
}

function makeRightGroup(qr, layout) {
  const { qrSize, qrOrigin } = layout;
  const xOff = qrOrigin + qrSize + GAP;
  const trimmed = trimEdges(qr, qrSize, { top: true });
  const center = flipHorizontal(trimmed, qrSize);
  const flanks = makeFlankingV(center, qrSize, FLANK_INSET_NO_FINDER, FLANK_INSET);
  const result = [["right center", offsetToSvg(center, xOff, qrOrigin)]];
  for (const [side, sq] of flanks) result.push([`right ${side}`, offsetToSvg(sq, xOff, qrOrigin)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, false)]);
}

// --- SVG output ---

function fmt(v) {
  if (v === Math.trunc(v)) return String(Math.trunc(v));
  // Match Python's %g: 6 significant digits, no trailing zeros
  const s = v.toPrecision(6);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function generateSvg(qrPath, decorationPaths, layout, bgColor = "#ffffff", bgShape = "rect") {
  const s = fmt(layout.svgSize);
  const cx = fmt(layout.circleCx), cy = fmt(layout.circleCy), r = fmt(layout.circleR);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">`,
  ];
  if (bgShape === "circle") {
    lines.push(`  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${bgColor}"/>`);
  } else {
    lines.push(`  <rect width="100%" height="100%" fill="${bgColor}"/>`);
  }
  lines.push(
    `  <defs>`,
    `    <clipPath id="circle-clip">`,
    `      <circle cx="${cx}" cy="${cy}" r="${r}"/>`,
    `    </clipPath>`,
    `  </defs>`,
    `  <g clip-path="url(#circle-clip)">`,
    `    <path d="${qrPath}"/>`,
  );
  for (const [label, pathD, color] of decorationPaths) {
    lines.push(`    <!-- ${label} -->`);
    lines.push(`    <path d="${pathD}" fill="${color}"/>`);
  }
  lines.push(`  </g>`);
  lines.push(
    `  <circle cx="${cx}" cy="${cy}" r="${r}"` +
    ` fill="none" stroke="#000000" stroke-width="${fmt(layout.strokeWidth)}"/>`
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
  bgShape = "rect",
} = {}) {
  const { squares: qr, qrSize } = parseQr(svgText);
  const layout = computeLayout(qrSize, circleRatio, strokeWidth);

  const qrSvg = offsetToSvg(qr, layout.qrOrigin, layout.qrOrigin);
  const qrPath = squaresToPath(qrSvg);

  const allGroups = [
    ["top", makeTopGroup(qr, layout)],
    ["bottom", makeBottomGroup(qr, layout)],
    ["left", makeLeftGroup(qr, layout)],
    ["right", makeRightGroup(qr, layout)],
  ];

  const decorationPaths = [];
  for (const [groupName, group] of allGroups) {
    const palette = colorful ? DEBUG_PALETTE[groupName] : null;
    for (let i = 0; i < group.length; i++) {
      const [label, svgSquares] = group[i];
      const color = palette ? palette[i % palette.length] : "#000000";
      decorationPaths.push([label, squaresToPath(svgSquares), color]);
    }
  }

  return generateSvg(qrPath, decorationPaths, layout, bgColor, bgShape);
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
      "bg-shape": { type: "string", default: "rect" },
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
  });

  writeFileSync(values.output, result);
  console.log(`Wrote ${values.output}`);
}

// Run CLI if invoked directly via Node
const isNode = typeof process !== "undefined" && process.argv?.[1];
if (isNode && import.meta.url === `file://${process.argv[1]}`) {
  cli().catch(e => { console.error(e); process.exit(1); });
}
