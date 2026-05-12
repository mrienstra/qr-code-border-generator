/**
 * Test a specific grid pattern: clean-path vs per-pixel rendered comparison.
 * Generates overlay SVG + pixel diff.
 *
 * Usage: node test/test-clean-pattern.mjs [pattern] [--overlay] [--cd 0,3,5]
 *   pattern: grid rows separated by / (e.g. "..X/XX./XXX" or "XXX./X.XX/XX.X/.XXX")
 *   --overlay: also write overlay SVG(s)
 *   --cd: comma-separated cd values to test (default: 0)
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { squaresToCleanPath } from '../clean-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';

const rawArgs = process.argv.slice(2);
const doOverlay = rawArgs.includes("--overlay");

const cdIdx = rawArgs.indexOf("--cd");
const cdValues = cdIdx !== -1 && rawArgs[cdIdx + 1]
  ? rawArgs[cdIdx + 1].split(",").map(Number)
  : [0];

// Pattern is first positional arg (not a flag and not the value after --cd)
const flagValues = new Set();
if (cdIdx !== -1) { flagValues.add(cdIdx); flagValues.add(cdIdx + 1); }
rawArgs.forEach((a, i) => { if (a === '--overlay') flagValues.add(i); });
const patternArg = rawArgs.find((a, i) => !flagValues.has(i) && !a.startsWith('--'))
  || "XXX./X.XX/XX.X/.XXX";

const rows = patternArg.split("/");
const H = rows.length;
const W = Math.max(...rows.map(r => r.length));

const pixels = [];
const allPixels = new Set();
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    if (rows[r]?.[c] === 'X') {
      const k = `${c},${r}`;
      pixels.push(k);
      allPixels.add(k);
    }

const w = W + 1, h = H + 1;
const pxW = w * 80, pxH = h * 80;
const ro = 0.5, ri = 0.45, flc = true, scl = false;

function makeSvg(result) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w + 0.2}">
  <rect width="${w}" height="${h}" fill="white"/>
  <path d="${result.path}" fill="black"/>
  ${result.fillets ? `<path d="${result.fillets}" fill="black"/>` : ''}
  </svg>`;
}

for (const cd of cdValues) {
  const sfx = (cdValues.length > 1 || cd !== 0) ? `-cd${cd}` : '';

  const cp = squaresToCleanPath(allPixels, allPixels, ro, ri, cd, flc, scl);
  const pp = squaresToRoundedPath(pixels, allPixels, ro, ri, cd, false, 0, flc, scl);

  const cpSvg = makeSvg(cp);
  const ppSvg = makeSvg(pp);
  writeFileSync(`/tmp/test-pattern-cp${sfx}.svg`, cpSvg);
  writeFileSync(`/tmp/test-pattern-pp${sfx}.svg`, ppSvg);

  const cpPng = execSync(`rsvg-convert -w ${pxW} -h ${pxH}`, { input: Buffer.from(cpSvg) });
  const ppPng = execSync(`rsvg-convert -w ${pxW} -h ${pxH}`, { input: Buffer.from(ppSvg) });
  writeFileSync(`/tmp/test-pattern-cp${sfx}.png`, cpPng);
  writeFileSync(`/tmp/test-pattern-pp${sfx}.png`, ppPng);

  const cpRaw = execSync(`magick /tmp/test-pattern-cp${sfx}.png -depth 8 rgba:-`, { maxBuffer: 50 * 1024 * 1024 });
  const ppRaw = execSync(`magick /tmp/test-pattern-pp${sfx}.png -depth 8 rgba:-`, { maxBuffer: 50 * 1024 * 1024 });
  let diff = 0;
  for (let i = 0; i < cpRaw.length; i += 4) {
    if (Math.abs(cpRaw[i] - ppRaw[i]) > 10) diff++;
  }
  console.log(`Pattern: ${patternArg}  cd=${cd}`);
  console.log(`Diff: ${diff}px (${(diff / (pxW * pxH) * 100).toFixed(3)}%)`);

  if (doOverlay) {
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w + 0.2}">
  <rect width="${w}" height="${h}" fill="white"/>
  <path d="${pp.path}" fill="blue" opacity="0.5"/>
  ${pp.fillets ? `<path d="${pp.fillets}" fill="blue" opacity="0.5"/>` : ''}
  <path d="${cp.path}" fill="red" opacity="0.5"/>
</svg>`;
    writeFileSync(`/tmp/test-pattern-overlay${sfx}.svg`, overlay);
    console.log(`Wrote /tmp/test-pattern-overlay${sfx}.svg`);
  }

  console.log(`Clean path: ${cp.path.length} chars`);
  console.log(`Per-pixel path: ${pp.path.length} chars`);
  if (pp.fillets) console.log(`Per-pixel fillets: ${pp.fillets.length} chars`);
  if (cdValues.length > 1) console.log('');
}
