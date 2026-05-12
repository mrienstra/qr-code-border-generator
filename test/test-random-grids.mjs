/**
 * Test random 6x6 and 8x8 grids to find topology issues.
 * Compares contour vs per-pixel with cd=5, flc=true.
 * Saves failure SVGs for debugging.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { squaresToContourPath } from '../contour-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';

function gridToPixelKeys(grid) {
  const keys = [];
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[0].length; c++)
      if (grid[r][c]) keys.push(`${c},${r}`);
  return keys;
}

function makeSvg(result, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 40}">
  <rect width="${size}" height="${size}" fill="white"/>
  <path d="${result.path}" fill="black"/>
  ${result.fillets ? `<path d="${result.fillets}" fill="black"/>` : ''}
</svg>`;
}

function compareGrid(grid, ri, ro, flc, scl, cd) {
  const size = grid.length;
  const keys = gridToPixelKeys(grid);
  if (keys.length === 0) return null;
  const allPixels = new Set(keys);

  try {
    const ct = squaresToContourPath(keys, allPixels, ro, ri, cd, flc, scl);
    const pp = squaresToRoundedPath(keys, allPixels, ro, ri, cd, false, 0, flc, scl);

    const ctSvg = makeSvg(ct, size);
    const ppSvg = makeSvg(pp, size);

    writeFileSync('/tmp/rg-ct.svg', ctSvg);
    writeFileSync('/tmp/rg-pp.svg', ppSvg);

    const pxSize = size * 40;
    const ctPng = execSync(`rsvg-convert -w ${pxSize} -h ${pxSize}`, { input: Buffer.from(ctSvg) });
    const ppPng = execSync(`rsvg-convert -w ${pxSize} -h ${pxSize}`, { input: Buffer.from(ppSvg) });

    writeFileSync('/tmp/rg-ct.png', ctPng);
    writeFileSync('/tmp/rg-pp.png', ppPng);

    const ctRaw = execSync(`magick /tmp/rg-ct.png -depth 8 rgba:-`, { maxBuffer: 10*1024*1024 });
    const ppRaw = execSync(`magick /tmp/rg-pp.png -depth 8 rgba:-`, { maxBuffer: 10*1024*1024 });

    let diff = 0;
    for (let i = 0; i < ctRaw.length; i += 4) {
      const dr = Math.abs(ctRaw[i] - ppRaw[i]);
      const dg = Math.abs(ctRaw[i+1] - ppRaw[i+1]);
      const db = Math.abs(ctRaw[i+2] - ppRaw[i+2]);
      if (dr > 10 || dg > 10 || db > 10) diff++;
    }
    return diff;
  } catch (e) {
    return -1;
  }
}

function randomGrid(size, density) {
  return Array.from({length: size}, () =>
    Array.from({length: size}, () => Math.random() < density ? 1 : 0)
  );
}

function countDiagonals(grid) {
  const rows = grid.length, cols = grid[0].length;
  const filled = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === 1;
  let count = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!filled(r, c)) continue;
      if (filled(r+1, c+1) && !filled(r+1, c) && !filled(r, c+1)) count++;
      if (filled(r+1, c-1) && !filled(r+1, c) && !filled(r, c-1)) count++;
    }
  return count;
}

function gridToString(grid) {
  return grid.map(row => row.map(c => c ? 'X' : '.').join('')).join('\n');
}

const ri = 0.45, ro = 0.5, flc = true, scl = false, cd = 5;
const THRESHOLD = 50;

let found = 0;
const sizes = [6, 8];
const densities = [0.3, 0.4, 0.5, 0.6];

for (const size of sizes) {
  for (const density of densities) {
    console.log(`\nTesting ${size}x${size} grids, density=${density}...`);
    for (let trial = 0; trial < 50; trial++) {
      const grid = randomGrid(size, density);
      const nDiag = countDiagonals(grid);
      if (nDiag === 0) continue;

      const diff = compareGrid(grid, ri, ro, flc, scl, cd);
      if (diff === null || diff === -1) continue;

      if (diff > THRESHOLD) {
        found++;
        console.log(`\n=== FOUND #${found}: ${size}x${size} density=${density} trial=${trial} ===`);
        console.log(`Diagonals: ${nDiag}, Diff pixels: ${diff}`);
        console.log(gridToString(grid));

        writeFileSync(`/tmp/rg-fail-${found}-ct.svg`, readFileSync('/tmp/rg-ct.svg', 'utf-8'));
        writeFileSync(`/tmp/rg-fail-${found}-pp.svg`, readFileSync('/tmp/rg-pp.svg', 'utf-8'));

        if (found >= 10) {
          console.log('\nFound 10 failures, stopping.');
          process.exit(0);
        }
      }
    }
  }
}

console.log(`\nDone. Found ${found} grids with >${THRESHOLD}px diff.`);
