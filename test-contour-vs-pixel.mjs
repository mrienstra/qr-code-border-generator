#!/usr/bin/env node
// Exhaustive comparison of contour vs per-pixel rendering for NxN grids.
// Usage: node test-contour-vs-pixel.mjs [--size N] [--flc] [--ri VALUE] [--verbose]

import { squaresToContourPath, squaresToRoundedPath } from './pixel-paths.mjs';
import { execSync } from 'child_process';
import fs from 'fs';

function key(x, y) { return x + ',' + y; }

const args = process.argv.slice(2);
const size = parseInt(args[args.indexOf('--size') + 1]) || 3;
const flc = args.includes('--flc');
const ri = parseFloat(args[args.indexOf('--ri') + 1]) || 0;
const ro = 0.5;
const verbose = args.includes('--verbose');
const renderSize = 300;
const lowThreshold = 50;

const totalPatterns = (1 << (size * size)) - 1;
let pass = 0, low = 0, fail = 0;
const failures = [];

for (let mask = 1; mask <= totalPatterns; mask++) {
  const pixelSet = new Set();
  for (let b = 0; b < size * size; b++) {
    if (mask & (1 << b)) pixelSet.add(key(b % size, Math.floor(b / size)));
  }
  const allPixels = new Set(pixelSet);
  const c = squaresToContourPath(pixelSet, allPixels, ro, ri, 0, flc, false);
  const p = squaresToRoundedPath(pixelSet, allPixels, ro, ri, 0, false, 0, flc, false);
  const cPath = c.path;
  const pPath = p.path + (p.fillets ? ' ' + p.fillets : '');

  if (cPath === pPath) { pass++; continue; }

  // Render both and compare via rsvg-convert + magick
  const svgC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}"><rect x="0" y="0" width="${size}" height="${size}" fill="white"/><path d="${cPath}" fill="black"/></svg>`;
  const svgP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}"><rect x="0" y="0" width="${size}" height="${size}" fill="white"/><path d="${pPath}" fill="black"/></svg>`;
  try {
    const pngC = execSync(`rsvg-convert -w ${renderSize} -h ${renderSize}`, { input: svgC });
    const pngP = execSync(`rsvg-convert -w ${renderSize} -h ${renderSize}`, { input: svgP });
    fs.writeFileSync('/tmp/_tc.png', pngC);
    fs.writeFileSync('/tmp/_tp.png', pngP);
    let diffOut;
    try {
      diffOut = execSync('magick compare -metric AE /tmp/_tc.png /tmp/_tp.png /tmp/_td.png 2>&1').toString().trim();
    } catch (e) {
      diffOut = e.stdout ? e.stdout.toString().trim() : e.stderr ? e.stderr.toString().trim() : '';
    }
    const diffPx = parseInt(diffOut) || 0;
    if (diffPx === 0) pass++;
    else if (diffPx <= lowThreshold) low++;
    else {
      fail++;
      failures.push({ mask, diffPx });
    }
  } catch (e) { fail++; failures.push({ mask, error: e.message }); }

  if (verbose && (pass + low + fail) % 1000 === 0) {
    process.stderr.write(`Progress: ${pass + low + fail}/${totalPatterns}\r`);
  }
}

console.log(`size=${size} flc=${flc} ri=${ri} ro=${ro}: pass=${pass} low=${low} fail=${fail}`);
if (failures.length > 0 && verbose) {
  console.log('Top failures:');
  failures.sort((a, b) => (b.diffPx || 0) - (a.diffPx || 0));
  for (const f of failures.slice(0, 10)) {
    console.log(`  m${f.mask}: ${f.diffPx || f.error} diffPx`);
  }
}
