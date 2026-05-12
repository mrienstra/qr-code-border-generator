/**
 * Exhaustive 3x3 quadrant-level diff analysis.
 * Groups pixel diffs by cell and quadrant to distinguish
 * "thin patina all over" from "cluster in one or two quadrants".
 *
 * Usage: node test/test-quadrant-diff.mjs
 * Requires: rsvg-convert, ImageMagick (magick)
 */
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { squaresToCleanPath } from '../clean-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';
import { key } from '../pixel-paths.mjs';

const RES = 200; // pixels per 4-unit viewBox -> 50px per cell
const CELL = RES / 4;

function makeSvg(result, separateFillets) {
  let paths;
  if (separateFillets) {
    paths = `<path d="${result.path}" fill="black"/>`;
    if (result.fillets) paths += `<path d="${result.fillets}" fill="black"/>`;
  } else {
    paths = `<path d="${result.path}${result.fillets ? ' ' + result.fillets : ''}" fill="black"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" width="4"><rect width="4" height="4" fill="white"/>${paths}</svg>`;
}

const ro = 0.5, ri = 0.45, cd = 5;
let allPass = 0, allPatina = 0, allConcentrated = 0;

for (let mask = 1; mask < 512; mask++) {
  const keys = [], allPixels = new Set();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (mask & (1 << (r * 3 + c))) { const k = key(c, r); keys.push(k); allPixels.add(k); }
  if (keys.length === 0) continue;

  const pp = squaresToRoundedPath(keys, allPixels, ro, ri, cd, false, 0, true, false);
  const cp = squaresToCleanPath(allPixels, allPixels, ro, ri, cd, true, false);

  writeFileSync('/tmp/qa-pp.svg', makeSvg(pp, true));
  writeFileSync('/tmp/qa-cp.svg', makeSvg(cp, false));
  execSync(`rsvg-convert -w ${RES} -h ${RES} /tmp/qa-pp.svg -o /tmp/qa-pp.png`);
  execSync(`rsvg-convert -w ${RES} -h ${RES} /tmp/qa-cp.svg -o /tmp/qa-cp.png`);

  const ppRaw = execSync(`magick /tmp/qa-pp.png -depth 8 gray:-`);
  const cpRaw = execSync(`magick /tmp/qa-cp.png -depth 8 gray:-`);

  const cells = {};
  let totalDiff = 0;

  for (let py = 0; py < RES; py++) {
    for (let px = 0; px < RES; px++) {
      const idx = py * RES + px;
      if (ppRaw[idx] !== cpRaw[idx]) {
        totalDiff++;
        const cx = Math.floor(px / CELL);
        const cy = Math.floor(py / CELL);
        const qx = (px % CELL) < CELL/2 ? 'l' : 'r';
        const qy = (py % CELL) < CELL/2 ? 't' : 'b';
        const quad = qy + qx;
        const ck = cx+','+cy;
        if (!cells[ck]) cells[ck] = { tl:0, tr:0, bl:0, br:0, total:0 };
        cells[ck][quad]++;
        cells[ck].total++;
      }
    }
  }

  if (totalDiff === 0) { allPass++; continue; }

  let concentrated = false;
  let maxQuadPct = 0;
  for (const [, cell] of Object.entries(cells)) {
    if (cell.total < 5) continue;
    const maxQ = Math.max(cell.tl, cell.tr, cell.bl, cell.br);
    const pct = maxQ / cell.total;
    if (pct > maxQuadPct) maxQuadPct = pct;
    if (pct > 0.85 && cell.total > 10) concentrated = true;
  }

  if (concentrated) {
    allConcentrated++;
    const bits = mask.toString(2).padStart(9, '0');
    console.log(`CONCENTRATED mask=${mask} (${bits}) diff=${totalDiff}px maxQuadPct=${Math.round(maxQuadPct*100)}%`);
    for (const [ck, cell] of Object.entries(cells)) {
      if (cell.total > 5) {
        console.log(`  cell ${ck}: tl=${cell.tl} tr=${cell.tr} bl=${cell.bl} br=${cell.br} total=${cell.total}`);
      }
    }
  } else {
    allPatina++;
  }
}

console.log(`\n=== Summary ===`);
console.log(`pass (0 diff): ${allPass}`);
console.log(`patina (spread): ${allPatina}`);
console.log(`concentrated: ${allConcentrated}`);
