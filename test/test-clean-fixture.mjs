/**
 * Test a JSON fixture: clean-path vs per-pixel rendered comparison.
 * Reports overall diff + localized hot spots.
 *
 * Usage: node test/test-clean-fixture.mjs <fixture.json> [--pxSize=840]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { squaresToCleanPath } from '../clean-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';

const fixturePath = process.argv[2];
if (!fixturePath) { console.error("Usage: node test-clean-fixture.mjs <fixture.json>"); process.exit(1); }

const pxSize = parseInt(process.argv.find(a => a.startsWith("--pxSize="))?.split("=")[1] || "840");

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const opts = fixture.options;
const svgText = fixture.svgText;
const viewBox = svgText.match(/viewBox="0 0 (\d+) (\d+)"/);
const vw = parseInt(viewBox[1]), vh = parseInt(viewBox[2]);

const pixelKeys = [];
const pathD = svgText.match(/d="([^"]+)"/)[1];
const moves = pathD.split(/M/g).filter(Boolean);
for (const m of moves) {
  const match = m.match(/^(\d+),(\d+)/);
  if (match) pixelKeys.push(`${match[1]},${match[2]}`);
}
const allPixels = new Set(pixelKeys);

const ro = opts.roundedPixels, ri = opts.roundedInner;
const cd = opts.connectDiagonals, flc = opts.fullLCorners, scl = opts.skipCheckerLCorners;
console.log(`Fixture: ${fixturePath}`);
console.log(`Config: ro=${ro} ri=${ri} cd=${cd} flc=${flc} scl=${scl} viewBox=${vw}x${vh} pixels=${pixelKeys.length}`);

const cp = squaresToCleanPath(allPixels, allPixels, ro, ri, cd, flc, scl);
const pp = squaresToRoundedPath(pixelKeys, allPixels, ro, ri, cd, false, 0, flc, scl);

function makeSvg(result) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw + 0.2}">
  <rect width="${vw}" height="${vh}" fill="white"/>
  <path d="${result.path}" fill="black"/>
  ${result.fillets ? `<path d="${result.fillets}" fill="black"/>` : ''}
  </svg>`;
}

const cpSvg = makeSvg(cp);
const ppSvg = makeSvg(pp);
writeFileSync('/tmp/fixture-cp.png', execSync(`rsvg-convert -w ${pxSize} -h ${pxSize}`, { input: Buffer.from(cpSvg) }));
writeFileSync('/tmp/fixture-pp.png', execSync(`rsvg-convert -w ${pxSize} -h ${pxSize}`, { input: Buffer.from(ppSvg) }));

const cpRaw = execSync(`magick /tmp/fixture-cp.png -depth 8 rgba:-`, { maxBuffer: 50 * 1024 * 1024 });
const ppRaw = execSync(`magick /tmp/fixture-pp.png -depth 8 rgba:-`, { maxBuffer: 50 * 1024 * 1024 });
let diff = 0;
for (let i = 0; i < cpRaw.length; i += 4) {
  if (Math.abs(cpRaw[i] - ppRaw[i]) > 10) diff++;
}
console.log(`Diff: ${diff}px (${(diff / (pxSize * pxSize) * 100).toFixed(3)}%)`);

// Localized analysis
const cellSize = 20;
const gridW = Math.ceil(pxSize / cellSize);
const cellDiffs = new Array(gridW * gridW).fill(0);
for (let y = 0; y < pxSize; y++) {
  for (let x = 0; x < pxSize; x++) {
    const i = (y * pxSize + x) * 4;
    if (Math.abs(cpRaw[i] - ppRaw[i]) > 10) {
      cellDiffs[Math.floor(y / cellSize) * gridW + Math.floor(x / cellSize)]++;
    }
  }
}
const hotCells = [];
for (let cy = 0; cy < gridW; cy++)
  for (let cx = 0; cx < gridW; cx++) {
    const d = cellDiffs[cy * gridW + cx];
    if (d > 5) hotCells.push({ cx, cy, count: d });
  }
hotCells.sort((a, b) => b.count - a.count);
console.log(`Hot cells (>5px): ${hotCells.length}`);
const scale = pxSize / vw;
for (const h of hotCells.slice(0, 15)) {
  const gx = (h.cx * cellSize / scale).toFixed(1);
  const gy = (h.cy * cellSize / scale).toFixed(1);
  console.log(`  cell(${h.cx},${h.cy}) [${h.count}px] ~ grid (${gx}, ${gy})`);
}
