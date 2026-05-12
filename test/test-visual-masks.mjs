/**
 * Three-way visual comparison: per-pixel vs clean-path vs contour.
 * Generates side-by-side SVG panels with grid overlay.
 * Uses full opacity + separate fillets for per-pixel (no seam artifacts).
 *
 * Usage: node test/test-visual-masks.mjs [mask1] [mask2] ...
 * Default: top 5 worst-diff masks from cd=5+flc testing
 */
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { squaresToCleanPath } from '../clean-paths.mjs';
import { squaresToRoundedPath } from '../per-pixel-paths.mjs';
import { squaresToContourPath } from '../contour-paths.mjs';
import { key } from '../pixel-paths.mjs';

function generateVisual(mask) {
  const keys = [], allPixels = new Set();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (mask & (1 << (r * 3 + c))) { const k = key(c, r); keys.push(k); allPixels.add(k); }

  const w = 4, h = 4, ro = 0.5, ri = 0.45, cd = 5;
  const pp = squaresToRoundedPath(keys, allPixels, ro, ri, cd, false, 0, true, false);
  const cp = squaresToCleanPath(allPixels, allPixels, ro, ri, cd, true, false);
  const ct = squaresToContourPath(allPixels, allPixels, ro, ri, cd, true, false);

  const bits = mask.toString(2).padStart(9, '0');
  const grid = bits[0]+bits[1]+bits[2]+'/'+bits[3]+bits[4]+bits[5]+'/'+bits[6]+bits[7]+bits[8];

  function makePanel(result, color, label, xOff, separateFillets) {
    const cellBg = keys.map(k => { const [x,y] = k.split(',').map(Number); return `<rect x="${x}" y="${y}" width="1" height="1" fill="#f0f0f0" stroke="none"/>`; }).join('\n      ');
    const hLines = Array.from({length: h+1}, (_,i) => `<line x1="0" y1="${i}" x2="${w}" y2="${i}" stroke="white" stroke-opacity="0.4" stroke-width="0.02"/>`).join('\n      ');
    const vLines = Array.from({length: w+1}, (_,i) => `<line x1="${i}" y1="0" x2="${i}" y2="${h}" stroke="white" stroke-opacity="0.4" stroke-width="0.02"/>`).join('\n      ');
    let paths;
    if (separateFillets) {
      paths = `<path d="${result.path}" fill="${color}"/>`;
      if (result.fillets) paths += `\n      <path d="${result.fillets}" fill="${color}"/>`;
    } else {
      paths = `<path d="${result.path}${result.fillets ? ' ' + result.fillets : ''}" fill="${color}"/>`;
    }
    return `    <g transform="translate(${xOff},0)">
      ${cellBg}
      ${paths}
      ${hLines}
      ${vLines}
      <text x="${w/2}" y="${h+0.4}" text-anchor="middle" font-size="0.35" fill="#666">${label}</text>
    </g>`;
  }

  const totalW = (w+0.7)*3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.2 -0.2 ${totalW} ${h+1.2}" width="${totalW}">
    <rect x="-0.2" y="-0.2" width="${totalW}" height="${h+1.2}" fill="white"/>
    <text x="${totalW/2}" y="${h+1}" text-anchor="middle" font-size="0.3" fill="#999">mask=${mask} (${grid}) cd=5 flc=true</text>
${makePanel(pp, '#cc3300', 'per-pixel', 0, true)}
${makePanel(cp, '#0066cc', 'clean-path', w+0.7, false)}
${makePanel(ct, '#339933', 'contour', (w+0.7)*2, false)}
  </svg>`;

  const svgFile = `/tmp/visual-mask${mask}.svg`;
  const pngFile = `/tmp/visual-mask${mask}.png`;
  writeFileSync(svgFile, svg);
  try {
    execSync(`rsvg-convert -w 900 ${svgFile} -o ${pngFile}`);
  } catch {}
  console.log(`Written: ${svgFile}`);
}

// Default masks or from command line
const masks = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : [254, 244, 94, 126, 30];

for (const mask of masks) {
  generateVisual(mask);
}
