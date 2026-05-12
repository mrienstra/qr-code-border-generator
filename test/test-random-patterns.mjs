/**
 * Deterministic random pattern testing with spatial diff analysis.
 * Compares clean-path vs per-pixel rendering on random NxN grids,
 * flagging patterns with high or spatially concentrated diffs.
 *
 * Usage: node test/test-random-patterns.mjs [options]
 *   --seed N        PRNG seed (default: 0)
 *   --count N       Patterns per batch (default: 100)
 *   --size N        Grid size (default: 5)
 *   --cd 0,3,5      Comma-separated cd values (default: 0)
 *   --offset N      Skip first N patterns (default: 0, for continuing a batch)
 *   --threshold N   Flag patterns with diff >= N px (default: 200)
 *   --cell-threshold N  Only log flagged patterns whose worst cell >= N px (default: 30)
 *   --verbose       Show all patterns, not just flagged
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { squaresToCleanPath } from '../clean-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';
import { classifyPixels } from '../pixel-classify.mjs';

// --- CLI ---
const rawArgs = process.argv.slice(2);
function argVal(name, def) {
  const i = rawArgs.indexOf(name);
  return i !== -1 && rawArgs[i + 1] ? rawArgs[i + 1] : def;
}
const seed = Number(argVal('--seed', '0'));
const count = Number(argVal('--count', '100'));
const size = Number(argVal('--size', '5'));
const threshold = Number(argVal('--threshold', '200'));
const cellThreshold = Number(argVal('--cell-threshold', '30'));
const offset = Number(argVal('--offset', '0'));
const cdValues = argVal('--cd', '0').split(',').map(Number);
const verbose = rawArgs.includes('--verbose');

// --- PRNG (Mulberry32) ---
function mulberry32(s) {
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// --- Constants ---
const pxPerUnit = 80;
const w = size + 1, h = size + 1;
const pxW = w * pxPerUnit, pxH = h * pxPerUnit;
const ro = 0.5, ri = 0.45;

// --- Pattern generation ---
const rand = mulberry32(seed);

function randomPattern() {
  const rows = [];
  for (let r = 0; r < size; r++) {
    let row = '';
    for (let c = 0; c < size; c++) row += rand() < 0.5 ? 'X' : '.';
    rows.push(row);
  }
  return rows.join('/');
}

function parsePattern(pat) {
  const rows = pat.split('/');
  const pixels = [];
  const allPixels = new Set();
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++)
      if (rows[r][c] === 'X') {
        const k = `${c},${r}`;
        pixels.push(k);
        allPixels.add(k);
      }
  return { pixels, allPixels };
}

// --- SVG / diff ---
function makeSvg(result) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w + 0.2}">
  <rect width="${w}" height="${h}" fill="white"/>
  <path d="${result.path}" fill="black"/>
  ${result.fillets ? `<path d="${result.fillets}" fill="black"/>` : ''}
  </svg>`;
}

function computeDiff(cpSvg, ppSvg) {
  // Write PNGs to temp files to avoid pipe deadlock: magick with both
  // stdin input (~50KB PNG) and stdout output (~900KB RGBA) can deadlock
  // when the pipe buffer (64KB on macOS) fills before stdin is consumed.
  const cpPng = execSync(`rsvg-convert -w ${pxW} -h ${pxH}`, { input: Buffer.from(cpSvg) });
  const ppPng = execSync(`rsvg-convert -w ${pxW} -h ${pxH}`, { input: Buffer.from(ppSvg) });
  writeFileSync('/tmp/_rp_cp.png', cpPng);
  writeFileSync('/tmp/_rp_pp.png', ppPng);
  const cpRaw = execSync('magick /tmp/_rp_cp.png -depth 8 rgba:-', { maxBuffer: 50 * 1024 * 1024 });
  const ppRaw = execSync('magick /tmp/_rp_pp.png -depth 8 rgba:-', { maxBuffer: 50 * 1024 * 1024 });

  let totalDiff = 0;
  const cellDiffs = new Array(w * h).fill(0);

  for (let i = 0; i < cpRaw.length; i += 4) {
    if (Math.abs(cpRaw[i] - ppRaw[i]) > 10) {
      totalDiff++;
      const pixIdx = i / 4;
      const px = pixIdx % pxW;
      const py = Math.floor(pixIdx / pxW);
      const cx = Math.min(Math.floor(px / pxPerUnit), w - 1);
      const cy = Math.min(Math.floor(py / pxPerUnit), h - 1);
      cellDiffs[cy * w + cx]++;
    }
  }

  const maxCell = Math.max(...cellDiffs);
  const concentration = totalDiff > 0 ? maxCell / totalDiff : 0;

  // Find max cell position
  const maxIdx = cellDiffs.indexOf(maxCell);
  const maxCx = maxIdx % w, maxCy = Math.floor(maxIdx / w);

  return { totalDiff, cellDiffs, maxCell, concentration, maxCx, maxCy };
}

function formatCellGrid(cellDiffs) {
  const lines = [];
  for (let r = 0; r < h; r++) {
    const cells = [];
    for (let c = 0; c < w; c++) cells.push(String(cellDiffs[r * w + c]).padStart(5));
    lines.push(`    ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

// --- Suppress debug logging from clean-paths.mjs ---
const origLog = console.log;
function silenced(fn) {
  console.log = () => {};
  try { return fn(); }
  finally { console.log = origLog; }
}

// --- Main ---
origLog(`Seed: ${seed}  Count: ${count}  Size: ${size}  cd: ${cdValues.join(',')}  Threshold: ${threshold}px  Offset: ${offset}\n`);

let totalRuns = 0, passed = 0, flagged = 0, clustered = 0, errors = 0, skipped = 0;
let maxDiffSeen = 0, maxDiffPattern = '', maxDiffCd = 0;
const seen = new Set();

// Fast-forward past `offset` valid patterns (consumes PRNG deterministically)
for (let skip = 0; skip < offset; ) {
  const pat = randomPattern();
  if (seen.has(pat)) continue;
  seen.add(pat);
  const { allPixels } = parsePattern(pat);
  const n = size * size;
  if (allPixels.size < 3 || allPixels.size > n - 3) continue;
  skip++;
}

for (let pi = 0; pi < count; ) {
  const pat = randomPattern();

  // Skip duplicates and trivial patterns
  if (seen.has(pat)) continue;
  seen.add(pat);
  const { pixels, allPixels } = parsePattern(pat);
  const n = size * size;
  if (allPixels.size < 3 || allPixels.size > n - 3) continue;
  pi++;

  // Count diagonal bridges at each cd to skip redundant values.
  // Classification is pure JS (fast), rendering is subprocess (slow).
  const bridgeCounts = new Map();
  const effectiveCds = [];
  for (const cd of cdValues) {
    const pixelMap = silenced(() => classifyPixels(allPixels, allPixels, {
      ro, ri, connectDiagonals: cd, fullLCorners: true, skipCheckerLCorners: false,
    }));
    let nBridges = 0;
    for (const [, info] of pixelMap) {
      if (info.diagBridges.br) nBridges++;
      if (info.diagBridges.bl) nBridges++;
    }
    const prev = bridgeCounts.get(nBridges);
    if (prev !== undefined) {
      skipped++;
      if (verbose) origLog(`#${pi}: ${pat}  cd=${cd}  skipped (same bridges=${nBridges} as cd=${prev})`);
      continue;
    }
    bridgeCounts.set(nBridges, cd);
    effectiveCds.push(cd);
  }

  for (const cd of effectiveCds) {
    totalRuns++;
    let cp, pp;
    try {
      cp = silenced(() => squaresToCleanPath(allPixels, allPixels, ro, ri, cd, true, false));
      pp = squaresToRoundedPath(pixels, allPixels, ro, ri, cd, false, 0, true, false);
    } catch (e) {
      errors++;
      origLog(`#${pi}: ${pat}  cd=${cd}  ERROR: ${e.message}`);
      continue;
    }

    const cpSvg = makeSvg(cp);
    const ppSvg = makeSvg(pp);
    const { totalDiff, cellDiffs, maxCell, concentration, maxCx, maxCy } = computeDiff(cpSvg, ppSvg);

    if (totalDiff > maxDiffSeen) {
      maxDiffSeen = totalDiff;
      maxDiffPattern = pat;
      maxDiffCd = cd;
    }

    if (totalDiff >= threshold && maxCell >= cellThreshold) {
      flagged++;
      const isClustered = concentration > 0.3;
      if (isClustered) clustered++;
      const pct = (totalDiff / (pxW * pxH) * 100).toFixed(3);
      const tag = isClustered ? '  CLUSTERED' : '';
      origLog(`#${pi}: ${pat}  cd=${cd}  Diff: ${totalDiff}px (${pct}%)${tag}`);
      origLog(`  Max cell: ${maxCell}px (${(concentration * 100).toFixed(0)}% of total) at (${maxCx},${maxCy})`);
      // origLog(formatCellGrid(cellDiffs));
      origLog();
    } else {
      passed++;
      if (verbose) origLog(`#${pi}: ${pat}  cd=${cd}  Diff: ${totalDiff}px`);
    }
  }
}

origLog(`--- Summary ---`);
origLog(`Tested: ${totalRuns} runs (patterns ${offset}–${offset + count - 1}, ${skipped} cd-skipped)`);
origLog(`Passed (<${threshold}px): ${passed}`);
origLog(`Flagged (>=${threshold}px): ${flagged}  (clustered: ${clustered})`);
if (errors > 0) origLog(`Errors: ${errors}`);
if (maxDiffSeen > 0) origLog(`Max diff: ${maxDiffSeen}px at "${maxDiffPattern}" cd=${maxDiffCd}`);
