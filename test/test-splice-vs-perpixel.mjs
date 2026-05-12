/**
 * Compare contour (splice) vs per-pixel for diagonal connection patterns.
 * Tests various 3x3 and 4x4 patterns with cd=5.
 */
import { squaresToContourPath } from '../contour-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';
import { key } from '../pixel-paths.mjs';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const ro = 0.5, ri = 0.45, cd = 5;
const renderSize = 400;
const threshold = 30;

function makePixelSet(coords) {
  return new Set(coords.map(([x, y]) => key(x, y)));
}

function testPattern(name, coords, size, flc, scl) {
  const qr = makePixelSet(coords);
  const allPixels = new Set(qr);

  const ct = squaresToContourPath(qr, allPixels, ro, ri, cd, flc, scl);
  const pp = squaresToRoundedPath(qr, allPixels, ro, ri, cd, false, 0, flc, scl);

  // Separate fillets for per-pixel (avoids anti-aliasing seams)
  const svgCt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}"><rect width="${size}" height="${size}" fill="white"/><path d="${ct.path}" fill="black"/>${ct.fillets ? `<path d="${ct.fillets}" fill="black"/>` : ''}</svg>`;
  const svgPp = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}"><rect width="${size}" height="${size}" fill="white"/><path d="${pp.path}" fill="black"/>${pp.fillets ? `<path d="${pp.fillets}" fill="black"/>` : ''}</svg>`;

  try {
    const pngCt = execSync(`rsvg-convert -w ${renderSize} -h ${renderSize}`, { input: svgCt });
    const pngPp = execSync(`rsvg-convert -w ${renderSize} -h ${renderSize}`, { input: svgPp });
    writeFileSync('/tmp/_splice_ct.png', pngCt);
    writeFileSync('/tmp/_splice_pp.png', pngPp);

    let diffOut;
    try {
      diffOut = execSync('magick compare -metric AE /tmp/_splice_ct.png /tmp/_splice_pp.png /tmp/_splice_diff.png 2>&1').toString().trim();
    } catch (e) {
      diffOut = e.stdout ? e.stdout.toString().trim() : e.stderr ? e.stderr.toString().trim() : '';
    }
    const diffPx = parseInt(diffOut) || 0;
    const status = diffPx <= threshold ? 'PASS' : 'FAIL';
    console.log(`${status} ${name} (flc=${flc} scl=${scl}): diff=${diffPx}px`);
    if (diffPx > threshold) {
      writeFileSync(`/tmp/splice-fail-ct-${name}.svg`, svgCt);
      writeFileSync(`/tmp/splice-fail-pp-${name}.svg`, svgPp);
    }
    return diffPx <= threshold;
  } catch (e) {
    console.log(`ERR  ${name}: ${e.message}`);
    return false;
  }
}

const patterns = [
  ["2px-diag-br", [[0,0],[1,1]], 3],
  ["2px-diag-bl", [[1,0],[0,1]], 3],
  ["L-shape-diag", [[0,0],[1,0],[2,1]], 4],
  ["T-shape-diag", [[0,0],[1,0],[2,0],[1,1]], 4],
  ["chain-diag", [[0,0],[1,1],[2,2]], 4],
  ["3px-L-diag", [[0,0],[0,1],[1,2]], 4],
  ["same-comp-diag", [[0,0],[1,0],[2,1],[2,0]], 4],
  ["checker-pair", [[0,0],[1,1],[2,0]], 4],
  ["square-with-diag", [[0,0],[1,0],[0,1],[2,2]], 4],
  ["cross-diag", [[1,0],[0,1],[2,1],[1,2]], 4],
];

let pass = 0, fail = 0;
for (const [name, coords, size] of patterns) {
  for (const flc of [false, true]) {
    for (const scl of [false, true]) {
      if (testPattern(name, coords, size, flc, scl)) pass++;
      else fail++;
    }
  }
}

console.log(`\n--- Summary: ${pass} passed, ${fail} failed ---`);
