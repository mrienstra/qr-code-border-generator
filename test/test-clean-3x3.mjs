/**
 * Exhaustive 3x3 test: clean-path vs per-pixel (rendered comparison).
 * Renders both at full opacity with separate fillet path on top for per-pixel.
 * Uses rsvg-convert + ImageMagick for rasterization and diff.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { squaresToCleanPath } from '../clean-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';

const size = 3;
const pxW = (size + 1) * 40, pxH = (size + 1) * 40;

function makeSvg(result, w, h) {
  // Per-pixel: separate fillets on top to avoid anti-aliasing seams
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}">
  <rect width="${w}" height="${h}" fill="white"/>
  <path d="${result.path}" fill="black"/>
  ${result.fillets ? `<path d="${result.fillets}" fill="black"/>` : ''}
  </svg>`;
}

function render(svg) {
  const png = execSync(`rsvg-convert -w ${pxW} -h ${pxH}`, { input: Buffer.from(svg) });
  writeFileSync('/tmp/clean-3x3-tmp.png', png);
  return execSync(`magick /tmp/clean-3x3-tmp.png -depth 8 rgba:-`, { maxBuffer: 50*1024*1024 });
}

function diffPx(rawA, rawB) {
  let d = 0;
  for (let i = 0; i < rawA.length; i += 4) {
    if (Math.abs(rawA[i] - rawB[i]) > 10) d++;
  }
  return d;
}

const combos = [
  { ro: 0.5, ri: 0.45, cd: 0, flc: false, scl: false },
  { ro: 0.5, ri: 0.45, cd: 0, flc: true, scl: false },
  { ro: 0.5, ri: 0, cd: 0, flc: false, scl: false },
  { ro: 0.5, ri: 0.45, cd: 5, flc: true, scl: false },
];

for (const { ro, ri, cd, flc, scl } of combos) {
  let pass = 0, lowDiff = 0, fail = 0;
  const failures = [];
  const total = (1 << (size * size)) - 1;
  const w = size + 1, h = size + 1;

  for (let mask = 1; mask <= total; mask++) {
    const keys = [];
    const allPixels = new Set();
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (mask & (1 << (r * size + c))) {
          const k = `${c},${r}`;
          keys.push(k);
          allPixels.add(k);
        }

    const cp = squaresToCleanPath(allPixels, allPixels, ro, ri, cd, flc, scl);
    const pp = squaresToRoundedPath(keys, allPixels, ro, ri, cd, false, 0, flc, scl);
    const cpRaw = render(makeSvg(cp, w, h));
    const ppRaw = render(makeSvg(pp, w, h));
    const diff = diffPx(cpRaw, ppRaw);
    const pct = diff / (pxW * pxH) * 100;

    if (pct === 0) pass++;
    else if (pct < 0.5) lowDiff++;
    else {
      fail++;
      if (failures.length < 5) failures.push({ mask, diff, pct: pct.toFixed(2) });
    }
  }

  const label = `ro=${ro} ri=${ri} cd=${cd} flc=${flc} scl=${scl}`;
  console.log(`${label}: pass=${pass} low=${lowDiff} fail=${fail}`);
  for (const f of failures) {
    const bits = f.mask.toString(2).padStart(9, '0');
    const grid = [bits.slice(0,3), bits.slice(3,6), bits.slice(6,9)].join('/');
    console.log(`  mask=${f.mask} (${grid}): ${f.diff}px (${f.pct}%)`);
  }
}
