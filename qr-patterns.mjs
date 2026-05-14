/**
 * QR code parsing, alignment patterns, PRNG, and obfuscation.
 */

import { key, unkey, FINDER_ZONE } from "./pixel-paths.mjs";
import { mulberry32 } from "./util/prng.mjs";

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

// --- Deterministic PRNG (seeded from pixel data) ---

export function makeRng(squares) {
  let seed = 0;
  for (const k of squares) { const [c, r] = unkey(k); seed = (seed * 31 + c * 997 + r) >>> 0; }
  return mulberry32(seed);
}

// --- Alignment pattern helpers ---

export function getAlignmentPositions(version) {
  if (version <= 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  if (numAlign === 2) return [6, size - 7];
  const last = size - 7;
  const step = Math.ceil((last - 6) / (numAlign - 1) / 2) * 2;
  const result = [6];
  for (let pos = last; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

export function randomizeAlignmentPatterns(squares, qrSize) {
  const version = (qrSize - 17) / 4;
  const positions = getAlignmentPositions(version);
  if (positions.length === 0) return squares;
  const rand = makeRng(squares);
  const last = qrSize - 7;
  const result = new Set(squares);
  for (const row of positions) {
    for (const col of positions) {
      // Skip positions that overlap with finder patterns
      if (row === 6 && col === 6) continue;
      if (row === 6 && col === last) continue;
      if (row === last && col === 6) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const k = key(col + dx, row + dy);
          result.delete(k);
          if (rand() < 0.5) result.add(k);
        }
      }
    }
  }
  return result;
}

// --- Obfuscation (puzzle mode) ---

function positionHash(col, row, baseSeed, regionId) {
  const s = (baseSeed + col * 374761393 + row * 668265263 + regionId * 49979693) >>> 0;
  return mulberry32(s)();
}

export function obfuscatePatterns(squares, qrSize, finderAmounts, alignAmount, darkOnly = false) {
  let baseSeed = 0;
  for (const k of squares) { const [c, r] = unkey(k); baseSeed = (baseSeed * 31 + c * 997 + r) >>> 0; }

  const result = new Set(squares);

  // Finder pattern regions (8x8: 7x7 pattern + 1px separator)
  const finderRegions = [
    { c0: 0, r0: 0, id: 1 },                       // top-left
    { c0: qrSize - FINDER_ZONE, r0: 0, id: 2 },    // top-right
    { c0: 0, r0: qrSize - FINDER_ZONE, id: 3 },    // bottom-left
  ];
  for (let f = 0; f < 3; f++) {
    const amount = finderAmounts[f];
    if (amount <= 0) continue;
    const { c0, r0, id } = finderRegions[f];
    for (let dr = 0; dr < FINDER_ZONE; dr++) {
      for (let dc = 0; dc < FINDER_ZONE; dc++) {
        const col = c0 + dc, row = r0 + dr;
        const k = key(col, row);
        if (darkOnly && !squares.has(k)) continue;
        if (positionHash(col, row, baseSeed, id) < amount) {
          result.delete(k);
          if (positionHash(col, row, baseSeed, id + 10) < 0.5) result.add(k);
        }
      }
    }
  }

  // Alignment patterns (5x5)
  if (alignAmount > 0) {
    const version = (qrSize - 17) / 4;
    const positions = getAlignmentPositions(version);
    const last = qrSize - 7;
    for (const row of positions) {
      for (const col of positions) {
        if (row === 6 && col === 6) continue;
        if (row === 6 && col === last) continue;
        if (row === last && col === 6) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const c = col + dx, r = row + dy;
            const k = key(c, r);
            if (darkOnly && !squares.has(k)) continue;
            if (positionHash(c, r, baseSeed, 4) < alignAmount) {
              result.delete(k);
              if (positionHash(c, r, baseSeed, 14) < 0.5) result.add(k);
            }
          }
        }
      }
    }
  }

  return result;
}
