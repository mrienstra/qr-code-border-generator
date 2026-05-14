/**
 * Generate a QR code border SVG from a plain QR code SVG.
 * ES module — usable from Node CLI or browser import.
 */

import { key, unkey, FINDER_ZONE, fmt, trimEdges, flipVertical, flipHorizontal, shift, offsetToSvg, trimCornersDiagonal, squaresToPath, squaresToRoundedPath, squaresToContourPath, squaresToCleanPath } from "./pixel-paths.mjs";
import { TIP_PROFILES } from "./per-pixel-paths.mjs";
import { parseQr, randomizeAlignmentPatterns, obfuscatePatterns, getAlignmentPositions } from "./qr-patterns.mjs";
import { CIRCLE_RATIO, CIRCLE_MARGIN, CIRCLE_STROKE_WIDTH, computeLayout, pixelOverlapsStroke, generateSvg } from "./svg-output.mjs";
import { ISLAND_PROFILES } from "./island-profiles.mjs";
import { mulberry32 } from "./util/prng.mjs";

// Re-export public API so existing consumers (index.html) keep working
export { parseQr, getAlignmentPositions, computeLayout };

// --- Constants ---
const DEFAULT_GAP = 1;
const DEFAULT_FLANK_GAP = 1;

const DEBUG_PALETTE = {
  top: ["#cc2222", "#ff6666", "#992222", "#ff4444", "#bb4444"],
  bottom: ["#2222cc", "#6666ff", "#222299", "#4444ff", "#4444bb"],
  left: ["#22aa22", "#66dd66", "#228822", "#44cc44", "#44aa44"],
  right: ["#cc8800", "#ffbb33", "#996600", "#eeaa00", "#bb9922"],
};

// --- Flanking helpers ---

function makeFlankingH(center, qrSize, rightInset, leftInset, leftReps = 1, rightReps = leftReps, flankGap = 0) {
  const mirrored = flipHorizontal(center, qrSize);
  // Re-flip mirrored within its own column bounds for even reps:
  // same extent as mirrored (consistent positioning) but different pixel data.
  let minC = Infinity, maxC = -Infinity;
  for (const k of mirrored) { const [c] = unkey(k); if (c < minC) minC = c; if (c > maxC) maxC = c; }
  const reflected = new Set();
  for (const k of mirrored) { const [c, r] = unkey(k); reflected.add(key(minC + maxC - c, r)); }
  const rightStep = qrSize - rightInset;
  const leftStep = qrSize - leftInset;
  const tileStep = maxC - minC + 1 + flankGap;
  const results = [];
  const maxReps = Math.max(leftReps, rightReps);
  for (let i = 1; i <= maxReps; i++) {
    const copy = i % 2 === 1 ? mirrored : reflected;
    const dx = i === 1 ? 0 : (i - 1) * tileStep;
    if (i <= leftReps) results.push([`left:${i}`, shift(copy, -(leftStep + dx), 0)]);
    if (i <= rightReps) results.push([`right:${i}`, shift(copy, rightStep + dx, 0)]);
  }
  return results;
}

function makeFlankingV(center, qrSize, lowerInset, upperInset, upperReps = 1, lowerReps = upperReps, flankGap = 0) {
  const mirrored = flipVertical(center, qrSize);
  // Re-flip mirrored within its own row bounds for even reps:
  // same extent as mirrored (consistent positioning) but different pixel data.
  let minR = Infinity, maxR = -Infinity;
  for (const k of mirrored) { const [, r] = unkey(k); if (r < minR) minR = r; if (r > maxR) maxR = r; }
  const reflected = new Set();
  for (const k of mirrored) { const [c, r] = unkey(k); reflected.add(key(c, minR + maxR - r)); }
  const upperStep = qrSize - upperInset;
  const lowerStep = qrSize - lowerInset;
  const tileStep = maxR - minR + 1 + flankGap;
  const results = [];
  const maxReps = Math.max(upperReps, lowerReps);
  for (let i = 1; i <= maxReps; i++) {
    const copy = i % 2 === 1 ? mirrored : reflected;
    const dy = i === 1 ? 0 : (i - 1) * tileStep;
    if (i <= upperReps) results.push([`upper:${i}`, shift(copy, 0, -(upperStep + dy))]);
    if (i <= lowerReps) results.push([`lower:${i}`, shift(copy, 0, lowerStep + dy)]);
  }
  return results;
}

// --- Group builders ---

function makeTopGroup(qr, layout, reps = 2) {
  const { qrSize, qrOrigin, gap, flankInset } = layout;
  const yOff = qrOrigin - gap - qrSize;
  const trimmed = trimEdges(qr, qrSize, { left: true, right: true });
  const center = flipVertical(trimmed, qrSize);
  const flanks = makeFlankingH(center, qrSize, flankInset, flankInset, reps, reps, layout.flankGap);
  const result = [["top center", offsetToSvg(center, qrOrigin, yOff)]];
  for (const [side, sq] of flanks) result.push([`top ${side}`, offsetToSvg(sq, qrOrigin, yOff)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, true)]);
}

function makeBottomGroup(qr, layout, leftReps = 1, rightReps = 1) {
  const { qrSize, qrOrigin, gap, flankInset, flankInsetNoFinder } = layout;
  const yOff = qrOrigin + qrSize + gap;
  const trimmed = trimEdges(qr, qrSize, { left: true });
  const center = flipVertical(trimmed, qrSize);
  const flanks = makeFlankingH(center, qrSize, flankInsetNoFinder, flankInset, leftReps, rightReps, layout.flankGap);
  const result = [["bottom center", offsetToSvg(center, qrOrigin, yOff)]];
  for (const [side, sq] of flanks) result.push([`bottom ${side}`, offsetToSvg(sq, qrOrigin, yOff)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, true)]);
}

function makeLeftGroup(qr, layout, reps = 2) {
  const { qrSize, qrOrigin, gap, flankInset } = layout;
  const xOff = qrOrigin - gap - qrSize;
  const trimmed = trimEdges(qr, qrSize, { top: true, bottom: true });
  const center = flipHorizontal(trimmed, qrSize);
  const flanks = makeFlankingV(center, qrSize, flankInset, flankInset, reps, reps, layout.flankGap);
  const result = [["left center", offsetToSvg(center, xOff, qrOrigin)]];
  for (const [side, sq] of flanks) result.push([`left ${side}`, offsetToSvg(sq, xOff, qrOrigin)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, false)]);
}

function makeRightGroup(qr, layout, upperReps = 1, lowerReps = 1) {
  const { qrSize, qrOrigin, gap, flankInset, flankInsetNoFinder } = layout;
  const xOff = qrOrigin + qrSize + gap;
  const trimmed = trimEdges(qr, qrSize, { top: true });
  const center = flipHorizontal(trimmed, qrSize);
  const flanks = makeFlankingV(center, qrSize, flankInsetNoFinder, flankInset, upperReps, lowerReps, layout.flankGap);
  const result = [["right center", offsetToSvg(center, xOff, qrOrigin)]];
  for (const [side, sq] of flanks) result.push([`right ${side}`, offsetToSvg(sq, xOff, qrOrigin)]);
  return result.map(([l, s]) => [l, trimCornersDiagonal(s, layout, false)]);
}

// --- Main entry point ---

export function generate(svgText, {
  colorful = false,
  circleRatio = CIRCLE_RATIO,
  strokeWidth = CIRCLE_STROKE_WIDTH,
  bgColor = "#ffffff",
  bgShape = "circle",
  fgColor = "#000000",
  borderColor = "#000000",
  borderShape = "circle",
  cornerRadius = 0,
  border2Color = null,
  border2Width = 4,
  border2Offset = 0,
  border2Trim = false,
  snapRadius = false,
  shuffle = false,
  gap = DEFAULT_GAP,
  flankGap = DEFAULT_FLANK_GAP,
  randAlign = true,
  randFluff = false,
  obfuscate = null,
  roundedPixels = 0,
  roundedInner = 0,
  connectDiagonals = 0,
  connectDiagonalsOrder = "default",
  diagOnly = false,
  tipStyle = "none",
  tipBase,
  islandStyle = "none",
  jiggle = 0,
  fullLCorners = false,
  skipCheckerLCorners = false,
  contourMode = false,
  cleanPathMode = false,
  wobbleFreq = 0,
  wobbleOctaves = 3,
  wobbleScale = 0,
  noFluff = false,
  finderRing = "solid",
  finderCenter = "solid",
  finderSeed = 0,
  finderRingSeed = 0,
  customTipProfiles,
  customIslandProfiles,
} = {}) {
  // Inject custom profiles into the module-level objects so resolveStyle() can find them
  if (customTipProfiles) Object.assign(TIP_PROFILES, customTipProfiles);
  if (customIslandProfiles) Object.assign(ISLAND_PROFILES, customIslandProfiles);

  const TIP_BASE_DEFAULTS = { "stubby-paw": 0.5 };
  // In mix mode, leave tipBase null so per-profile defaults are used at render time
  if (tipBase == null && typeof tipStyle === "string") tipBase = TIP_BASE_DEFAULTS[tipStyle] || 0;

  let { squares: qr, qrSize } = parseQr(svgText);
  if (obfuscate) {
    qr = obfuscatePatterns(qr, qrSize, obfuscate.amounts.slice(0, 3), obfuscate.amounts[3], obfuscate.darkOnly);
  }
  const layout = computeLayout(qrSize, circleRatio, strokeWidth, borderShape, cornerRadius, snapRadius);
  layout.gap = gap;

  const qrSvg = offsetToSvg(qr, layout.qrOrigin, layout.qrOrigin);

  const allGroups = [];
  if (!noFluff) {
  const effectiveFlankGap = randFluff ? 0 : flankGap;
  layout.flankInset = 2 * FINDER_ZONE - effectiveFlankGap;
  layout.flankInsetNoFinder = -effectiveFlankGap;
  layout.flankGap = effectiveFlankGap;
  layout.fillDiagonal = (effectiveFlankGap === 0);

  // Compute flanking reps needed to fill corners at current size ratio.
  // Top/left groups trim both edges -> narrower center (starts at col FINDER_ZONE).
  // Bottom/right groups trim one edge -> wider center (mirrored copy starts at col 0).
  const step = qrSize - layout.flankInset;
  const stepNoInset = qrSize - layout.flankInsetNoFinder;
  const margin = CIRCLE_MARGIN;
  const repsSymm = Math.max(2, Math.ceil((layout.qrOrigin + FINDER_ZONE - margin) / step));
  const repsAsymInset = Math.max(1, Math.ceil((layout.qrOrigin - margin) / step));
  const repsAsymNoInset = Math.max(1, Math.ceil((layout.qrOrigin - margin) / stepNoInset));

  // Determine fluff source
  let fluffQr;
  if (randFluff) {
    // Full grid — every position is a candidate for random fill
    fluffQr = new Set();
    for (let y = 0; y < qrSize; y++)
      for (let x = 0; x < qrSize; x++)
        fluffQr.add(key(x, y));
  } else if (randAlign) {
    fluffQr = randomizeAlignmentPatterns(qr, qrSize);
  } else {
    fluffQr = qr;
  }

  allGroups.push(
    ["top", makeTopGroup(fluffQr, layout, repsSymm)],
    ["bottom", makeBottomGroup(fluffQr, layout, repsAsymInset, repsAsymNoInset)],
    ["left", makeLeftGroup(fluffQr, layout, repsSymm)],
    ["right", makeRightGroup(fluffQr, layout, repsAsymInset, repsAsymNoInset)],
  );

  // Random fluff: randomly keep ~50% of pixels using a per-position hash.
  // Each grid position gets a deterministic random value from its coordinates
  // and QR seed, independent of layout, ratio, or which tiles/clipping exist.
  if (randFluff) {
    let baseSeed = 0;
    for (const k of qr) { const [c, r] = unkey(k); baseSeed = (baseSeed * 31 + c * 997 + r) >>> 0; }
    const ox = layout.qrOrigin;
    function positionRand(svgX, svgY) {
      const gx = Math.round(svgX - ox);
      const gy = Math.round(svgY - ox);
      const s = (baseSeed + gx * 374761393 + gy * 668265263) >>> 0;
      return mulberry32(s)();
    }
    for (const [, group] of allGroups) {
      for (let i = 0; i < group.length; i++) {
        const [label, squares] = group[i];
        const filtered = new Set();
        for (const k of squares) {
          const [x, y] = unkey(k);
          if (positionRand(x, y) < 0.5) filtered.add(k);
        }
        group[i] = [label, filtered];
      }
    }
  }

  // Shuffle: swap center pieces across the diagonal (top<->left, bottom<->right)
  // and flip one flanking piece per side to break repetition
  if (shuffle) {
    const transpose = (squares) => {
      const result = new Set();
      for (const k of squares) { const [x, y] = unkey(k); result.add(key(y, x)); }
      return result;
    };
    const flipLocalV = (squares) => {
      let minY = Infinity, maxY = -Infinity;
      for (const k of squares) { const [, y] = unkey(k); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const result = new Set();
      for (const k of squares) { const [x, y] = unkey(k); result.add(key(x, minY + maxY - y)); }
      return result;
    };
    const flipLocalH = (squares) => {
      let minX = Infinity, maxX = -Infinity;
      for (const k of squares) { const [x] = unkey(k); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      const result = new Set();
      for (const k of squares) { const [x, y] = unkey(k); result.add(key(minX + maxX - x, y)); }
      return result;
    };

    // Swap center pieces
    const refs = {};
    for (const [, group] of allGroups) {
      for (let i = 0; i < group.length; i++) {
        refs[group[i][0]] = [group, i];
      }
    }
    if (refs["top center"] && refs["left center"]) {
      const ts = refs["top center"][0][refs["top center"][1]][1];
      const ls = refs["left center"][0][refs["left center"][1]][1];
      refs["top center"][0][refs["top center"][1]] = ["top center", transpose(ls)];
      refs["left center"][0][refs["left center"][1]] = ["left center", transpose(ts)];
    }
    if (refs["bottom center"] && refs["right center"]) {
      const bs = refs["bottom center"][0][refs["bottom center"][1]][1];
      const rs = refs["right center"][0][refs["right center"][1]][1];
      refs["bottom center"][0][refs["bottom center"][1]] = ["bottom center", transpose(rs)];
      refs["right center"][0][refs["right center"][1]] = ["right center", transpose(bs)];
    }

    // Flip one flanking piece in top and left groups to break symmetry
    for (const [name, group] of allGroups) {
      if ((name === "top" || name === "left") && group.length > 1) {
        const [label, squares] = group[1];
        group[1] = [label, name === "top" ? flipLocalV(squares) : flipLocalH(squares)];
      }
    }
  }

  // Remove fluff pixels that overlap with the second border's stroke area
  if (border2Color !== null && border2Trim) {
    for (const [, group] of allGroups) {
      for (let i = 0; i < group.length; i++) {
        const [label, svgSquares] = group[i];
        const filtered = new Set();
        for (const k of svgSquares) {
          const [x, y] = unkey(k);
          if (!pixelOverlapsStroke(x, y, layout, border2Offset, border2Width)) {
            filtered.add(k);
          }
        }
        group[i] = [label, filtered];
      }
    }
  }

  // Deduplicate within each group (earlier tiles take priority)
  for (const [, group] of allGroups) {
    const seen = new Set();
    for (let i = 0; i < group.length; i++) {
      const [label, squares] = group[i];
      const deduped = new Set();
      for (const k of squares) {
        if (!seen.has(k)) { deduped.add(k); seen.add(k); }
      }
      group[i] = [label, deduped];
    }
  }

  // Grid gap: when randFluff is on with flankGap > 0, remove pixels on grid lines
  // that extend the QR gap border outward, creating a '#' pattern instead of tile-based gaps.
  if (randFluff && flankGap > 0) {
    const ox = layout.qrOrigin;
    const leftVMin = -flankGap, leftVMax = -1;
    const rightVMin = qrSize, rightVMax = qrSize + flankGap - 1;
    for (const [, group] of allGroups) {
      for (let i = 0; i < group.length; i++) {
        const [label, svgSquares] = group[i];
        const filtered = new Set();
        for (const k of svgSquares) {
          const [x, y] = unkey(k);
          const gx = Math.round(x - ox);
          const gy = Math.round(y - ox);
          if ((gx >= leftVMin && gx <= leftVMax) || (gx >= rightVMin && gx <= rightVMax)) continue;
          if ((gy >= leftVMin && gy <= leftVMax) || (gy >= rightVMin && gy <= rightVMax)) continue;
          filtered.add(k);
        }
        group[i] = [label, filtered];
      }
    }
  }
  } // end if (!noFluff)

  // Build path converter (clean-path, contour, rounded, or standard)
  const useContour = contourMode && !diagOnly && jiggle === 0;
  const useCleanPath = cleanPathMode && !diagOnly && jiggle === 0;
  let toPath = (sq) => ({ path: squaresToPath(sq), fillets: "" });
  let allPixels = null;
  if (useCleanPath || useContour || roundedPixels > 0 || roundedInner > 0 || finderRing !== "solid" || finderCenter !== "solid") {
    allPixels = new Set(qrSvg);
    for (const [, group] of allGroups)
      for (const [, squares] of group)
        for (const k of squares) allPixels.add(k);
    if (useCleanPath) {
      toPath = (sq) => squaresToCleanPath(sq, allPixels, roundedPixels, roundedInner, connectDiagonals, fullLCorners, skipCheckerLCorners, connectDiagonalsOrder);
    } else if (useContour) {
      toPath = (sq) => squaresToContourPath(sq, allPixels, roundedPixels, roundedInner, connectDiagonals, fullLCorners, skipCheckerLCorners);
    } else if (roundedPixels > 0 || roundedInner > 0) {
      toPath = (sq) => squaresToRoundedPath(sq, allPixels, roundedPixels, roundedInner, connectDiagonals, diagOnly, jiggle, fullLCorners, skipCheckerLCorners, connectDiagonalsOrder, tipStyle, tipBase, islandStyle);
    }

    // Diagnostic: check for adjacency mismatches (floating-point key issues)
    if (colorful) {
      const qrO = layout.qrOrigin;
      let issues = 0;
      for (const k of allPixels) {
        const [x, y] = unkey(k);
        // Check all 4 cardinal neighbors: if a pixel exists at (x+/-1,y) or (x,y+/-1),
        // verify the adjacency is symmetric (neighbor's reverse lookup finds us)
        for (const [dx, dy, dir] of [[1,0,'R'],[-1,0,'L'],[0,1,'D'],[0,-1,'U']]) {
          const nk = key(x + dx, y + dy);
          if (allPixels.has(nk)) {
            const [nx, ny] = unkey(nk);
            const backKey = key(nx - dx, ny - dy);
            if (backKey !== k) {
              const gx = Math.round(x - qrO), gy = Math.round(y - qrO);
              console.warn(`ADJACENCY MISMATCH at grid (${gx},${gy}) dir=${dir}: key=${k} → neighbor=${nk} → back=${backKey} (expected ${k})`);
              issues++;
            }
          }
        }
        // Also check: does re-keying our own coords match?
        const reKey = key(x, y);
        if (reKey !== k) {
          const gx = Math.round(x - qrO), gy = Math.round(y - qrO);
          console.warn(`KEY ROUND-TRIP MISMATCH at grid (${gx},${gy}): stored=${k} reKey=${reKey}`);
          issues++;
        }
      }
      // Check for near-miss adjacencies: pixels that are ~1 apart but whose
      // snapped keys don't match as neighbors. Only reports issues that snap()
      // can't fix (gaps > 1e-4 off from 1.0).
      const byRow = new Map();
      for (const k of allPixels) {
        const [x, y] = unkey(k);
        const yk = String(y);
        if (!byRow.has(yk)) byRow.set(yk, []);
        byRow.get(yk).push([x, k]);
      }
      for (const [yk, row] of byRow) {
        row.sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < row.length - 1; i++) {
          const [x1, k1] = row[i];
          const [x2, k2] = row[i + 1];
          const gap = x2 - x1;
          if (gap > 0.999 && gap < 1.001 && Math.abs(gap - 1) > 1e-4) {
            const gx1 = Math.round(x1 - qrO), gx2 = Math.round(x2 - qrO);
            const gy = Math.round(Number(yk) - qrO);
            console.warn(`NEAR-MISS at row ${gy}: grid cols ${gx1}→${gx2}, gap=${gap} (keys: ${k1} → ${k2})`);
            issues++;
          }
        }
      }
      if (issues > 0) console.warn(`Found ${issues} adjacency issues`);
      else console.log('Adjacency check: no issues found');
    }
  }

  // Separate seeded PRNGs for ring and center finder splits
  const ringRand = mulberry32(finderRingSeed);
  const centerRand = mulberry32(finderSeed);

  // Finder ring split: render outer ring of each finder as bars
  let finderBarGroups = [];
  let qrSvgForMain = qrSvg;
  if (finderRing !== "solid" && allPixels) {
    const o = layout.qrOrigin;
    const finderCorners = [[0, 0], [qrSize - 7, 0], [0, qrSize - 7]];
    const finderOuterKeys = new Set();
    for (const [fc, fr] of finderCorners) {
      const sx = fc + o, sy = fr + o;

      if (finderRing === "random") {
        // Per-pixel union-find on all 24 ring pixels in clockwise order
        // Top row L→R (7), right col top→bot excl corners (5), bottom row R→L (7), left col bot→top excl corners (5)
        const ringPixels = [
          ...Array.from({length: 7}, (_, i) => key(sx + i, sy)),           // 0-6: top row
          ...Array.from({length: 5}, (_, i) => key(sx + 6, sy + 1 + i)),   // 7-11: right col (no corners)
          ...Array.from({length: 7}, (_, i) => key(sx + 6 - i, sy + 6)),   // 12-18: bottom row R→L
          ...Array.from({length: 5}, (_, i) => key(sx, sy + 5 - i)),       // 19-23: left col (no corners)
        ];
        // 24 edges in the closed ring loop
        const parent = Array.from({length: 24}, (_, i) => i);
        const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
        for (let i = 0; i < 24; i++) {
          if (ringRand() < 0.5) parent[find(i)] = find((i + 1) % 24);
        }
        // Group pixels by connected component
        const groups = new Map();
        for (let i = 0; i < 24; i++) {
          const root = find(i);
          if (!groups.has(root)) groups.set(root, []);
          groups.get(root).push(i);
        }
        // Build bar group for each component
        for (const members of groups.values()) {
          const memberSet = new Set(members);
          const pixels = [];
          const phantomSet = new Set();
          for (const idx of members) {
            pixels.push(ringPixels[idx]);
            // Phantom = adjacent ring pixel in a different component
            const prev = (idx + 23) % 24, next = (idx + 1) % 24;
            if (!memberSet.has(prev)) phantomSet.add(ringPixels[prev]);
            if (!memberSet.has(next)) phantomSet.add(ringPixels[next]);
          }
          for (const k of pixels) finderOuterKeys.add(k);
          finderBarGroups.push({ pixels, phantoms: phantomSet });
        }
      } else {
        // 8-node union-find: 4 corners (TL=0,TR=1,BL=2,BR=3) + 4 bars (top=4,left=5,right=6,bottom=7)
        // Bar pixels (excluding corners): 5 each
        const barPixels = [
          Array.from({length: 5}, (_, i) => key(sx + 1 + i, sy)),       // 4: top bar (cols 1-5)
          Array.from({length: 5}, (_, i) => key(sx, sy + 1 + i)),       // 5: left bar (rows 1-5)
          Array.from({length: 5}, (_, i) => key(sx + 6, sy + 1 + i)),   // 6: right bar (rows 1-5)
          Array.from({length: 5}, (_, i) => key(sx + 1 + i, sy + 6)),   // 7: bottom bar (cols 1-5)
        ];
        const cornerPixels = [
          key(sx, sy),       // 0: TL
          key(sx + 6, sy),   // 1: TR
          key(sx, sy + 6),   // 2: BL
          key(sx + 6, sy + 6), // 3: BR
        ];
        // Edges: [cornerIdx, barIdx, phantomForCorner, phantomForBar]
        // Each corner has an x-edge (horizontal to bar) and y-edge (vertical to bar)
        const edges = [
          // TL corner
          [0, 4, key(sx + 1, sy),   key(sx, sy)],       // TL ↔ top (x-edge)
          [0, 5, key(sx, sy + 1),   key(sx, sy)],       // TL ↔ left (y-edge)
          // TR corner
          [1, 4, key(sx + 5, sy),   key(sx + 6, sy)],   // TR ↔ top (x-edge)
          [1, 6, key(sx + 6, sy + 1), key(sx + 6, sy)], // TR ↔ right (y-edge)
          // BL corner
          [2, 7, key(sx + 1, sy + 6), key(sx, sy + 6)], // BL ↔ bottom (x-edge)
          [2, 5, key(sx, sy + 5),   key(sx, sy + 6)],   // BL ↔ left (y-edge)
          // BR corner
          [3, 7, key(sx + 5, sy + 6), key(sx + 6, sy + 6)], // BR ↔ bottom (x-edge)
          [3, 6, key(sx + 6, sy + 5), key(sx + 6, sy + 6)], // BR ↔ right (y-edge)
        ];
        // Each corner has 2 edges: index i*2 = x-edge, i*2+1 = y-edge
        // Decide which edges to keep based on mode
        const parent = [0, 1, 2, 3, 4, 5, 6, 7];
        const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };

        for (let ci = 0; ci < 4; ci++) {
          const xEdgeIdx = ci * 2, yEdgeIdx = ci * 2 + 1;
          let keepX, keepY;
          if (finderRing === "split") {
            // Fixed split pattern: TL/TR split on y (keep x, cut y), BL/BR split on x (cut x, keep y)
            keepX = ci < 2; // TL, TR: keep x-edge
            keepY = ci >= 2; // BL, BR: keep y-edge
          } else {
            // "random-split": random choice per corner
            const choice = Math.floor(ringRand() * 4);
            // 0=splitY(keepX,cutY), 1=splitX(cutX,keepY), 2=splitBoth(cut,cut), 3=noSplit(keep,keep)
            keepX = choice === 0 || choice === 3;
            keepY = choice === 1 || choice === 3;
          }
          if (keepX) parent[find(edges[xEdgeIdx][0])] = find(edges[xEdgeIdx][1]);
          if (keepY) parent[find(edges[yEdgeIdx][0])] = find(edges[yEdgeIdx][1]);
        }
        // Group nodes by connected component
        const groups = new Map();
        // Add corner pixels
        for (let i = 0; i < 4; i++) {
          const root = find(i);
          if (!groups.has(root)) groups.set(root, { pixels: [], phantoms: new Set() });
          groups.get(root).pixels.push(cornerPixels[i]);
        }
        // Add bar pixels
        for (let i = 0; i < 4; i++) {
          const root = find(i + 4);
          if (!groups.has(root)) groups.set(root, { pixels: [], phantoms: new Set() });
          groups.get(root).pixels.push(...barPixels[i]);
        }
        // Add phantoms at cut edges
        for (const [cornerIdx, barIdx, phantomForCorner, phantomForBar] of edges) {
          if (find(cornerIdx) !== find(barIdx)) {
            groups.get(find(cornerIdx)).phantoms.add(phantomForCorner);
            groups.get(find(barIdx)).phantoms.add(phantomForBar);
          }
        }
        for (const { pixels, phantoms } of groups.values()) {
          for (const k of pixels) finderOuterKeys.add(k);
          finderBarGroups.push({ pixels, phantoms });
        }
      }
    }
    qrSvgForMain = new Set();
    for (const k of qrSvg) if (!finderOuterKeys.has(k)) qrSvgForMain.add(k);
  }

  // Finder center split: render 3x3 center as cross+corners, scatter, random, or mix
  if (finderCenter !== "solid" && allPixels) {
    const o = layout.qrOrigin;
    const finderCorners = [[0, 0], [qrSize - 7, 0], [0, qrSize - 7]];
    const centerKeys = new Set();
    // Mix mode: finderCenter is an object of { pattern: weight }
    const isMix = typeof finderCenter === "object";
    const mixEntries = isMix ? Object.entries(finderCenter).filter(([,w]) => w > 0) : null;
    const mixTotal = isMix ? mixEntries.reduce((s, [,w]) => s + w, 0) : 0;

    for (const [fc, fr] of finderCorners) {
      let pattern;
      if (isMix && mixTotal > 0) {
        let r = centerRand() * mixTotal;
        for (const [name, w] of mixEntries) { r -= w; if (r <= 0) { pattern = name; break; } }
        pattern = pattern || mixEntries[mixEntries.length - 1][0];
      } else {
        pattern = typeof finderCenter === "string" ? finderCenter : "solid";
      }
      if (pattern === "solid") continue;
      const sx = fc + 2 + o, sy = fr + 2 + o; // top-left of 3x3

      if (pattern === "cross") {
        const cross = [key(sx+1, sy), key(sx, sy+1), key(sx+1, sy+1), key(sx+2, sy+1), key(sx+1, sy+2)];
        const corners = [[sx, sy], [sx+2, sy], [sx, sy+2], [sx+2, sy+2]];
        const crossPhantoms = new Set(corners.map(([cx, cy]) => key(cx, cy)));
        finderBarGroups.push({ pixels: cross, phantoms: crossPhantoms });
        const cornerPhantomPairs = [
          [key(sx+1, sy),   key(sx, sy+1)],
          [key(sx+1, sy),   key(sx+2, sy+1)],
          [key(sx, sy+1),   key(sx+1, sy+2)],
          [key(sx+2, sy+1), key(sx+1, sy+2)],
        ];
        for (let i = 0; i < 4; i++) {
          const [cx, cy] = corners[i];
          finderBarGroups.push({ pixels: [key(cx, cy)], phantoms: new Set(cornerPhantomPairs[i]) });
        }
        for (const k of cross) centerKeys.add(k);
        for (const [cx, cy] of corners) centerKeys.add(key(cx, cy));
      } else if (pattern === "scatter") {
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const px = sx + dx, py = sy + dy;
            const phantomSet = new Set();
            for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
              if (nx >= sx && nx < sx+3 && ny >= sy && ny < sy+3)
                phantomSet.add(key(nx, ny));
            }
            finderBarGroups.push({ pixels: [key(px, py)], phantoms: phantomSet });
            centerKeys.add(key(px, py));
          }
        }
      } else if (pattern === "random") {
        // Randomly cut/keep each internal edge, then find connected components
        const parent = Array.from({length: 9}, (_, i) => i);
        const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
        const edges = [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8]];
        for (const [a, b] of edges) {
          if (centerRand() < 0.5) parent[find(a)] = find(b);
        }
        // Group pixels by connected component
        const groups = new Map();
        for (let i = 0; i < 9; i++) {
          const root = find(i);
          if (!groups.has(root)) groups.set(root, []);
          groups.get(root).push(i);
        }
        // Build bar group for each component
        for (const members of groups.values()) {
          const memberSet = new Set(members);
          const pixels = [];
          const phantomSet = new Set();
          for (const i of members) {
            const dx = i % 3, dy = Math.floor(i / 3);
            pixels.push(key(sx + dx, sy + dy));
            centerKeys.add(key(sx + dx, sy + dy));
            // Phantom = adjacent 3x3 pixel in a different component
            for (const [ndx, ndy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
              const nx = dx + ndx, ny = dy + ndy;
              if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3) {
                const ni = ny * 3 + nx;
                if (!memberSet.has(ni)) phantomSet.add(key(sx + nx, sy + ny));
              }
            }
          }
          finderBarGroups.push({ pixels, phantoms: phantomSet });
        }
      }
    }
    if (centerKeys.size > 0) {
      const prev = qrSvgForMain;
      qrSvgForMain = new Set();
      for (const k of prev) if (!centerKeys.has(k)) qrSvgForMain.add(k);
    }
  }

  const qrResult = toPath(qrSvgForMain);
  const qrPath = qrResult.path;
  let allFillets = qrResult.fillets;

  const decorationPaths = [];
  for (const [groupName, group] of allGroups) {
    const palette = colorful ? DEBUG_PALETTE[groupName] : null;
    for (let i = 0; i < group.length; i++) {
      const [label, svgSquares] = group[i];
      const color = palette ? palette[i % palette.length] : fgColor;
      // Step: 0=QR, 1=center reflections, 2+=flanking rep N
      const repMatch = label.match(/:(\d+)$/);
      const step = repMatch ? parseInt(repMatch[1]) + 1 : 1;
      const result = toPath(svgSquares);
      decorationPaths.push([label, result.path, color, step]);
      if (result.fillets) allFillets += (allFillets ? " " : "") + result.fillets;
    }
  }

  // Render finder bar groups (each bar with phantom neighbor masking for rounded caps)
  for (const { pixels, phantoms } of finderBarGroups) {
    const barSq = new Set(pixels);
    const proxyAllPixels = new Proxy(allPixels, {
      get(target, prop) {
        if (prop === "has") return (k) => !phantoms.has(k) && target.has(k);
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    let barResult;
    if (useCleanPath) {
      barResult = squaresToCleanPath(barSq, proxyAllPixels, roundedPixels, roundedInner, connectDiagonals, fullLCorners, skipCheckerLCorners, connectDiagonalsOrder);
    } else if (useContour) {
      barResult = squaresToContourPath(barSq, proxyAllPixels, roundedPixels, roundedInner, connectDiagonals, fullLCorners, skipCheckerLCorners);
    } else if (roundedPixels > 0 || roundedInner > 0) {
      barResult = squaresToRoundedPath(barSq, proxyAllPixels, roundedPixels, roundedInner, connectDiagonals, diagOnly, jiggle, fullLCorners, skipCheckerLCorners, connectDiagonalsOrder, tipStyle, tipBase, islandStyle);
    } else {
      barResult = { path: squaresToPath(barSq), fillets: "" };
    }
    decorationPaths.push(["finder-bar", barResult.path, fgColor, 1]);
    if (barResult.fillets) allFillets += (allFillets ? " " : "") + barResult.fillets;
  }

  return generateSvg(qrPath, decorationPaths, layout, { bgColor, bgShape, fgColor, borderColor, border2Color, border2Width, border2Offset, wobbleFreq, wobbleOctaves, wobbleScale, filletPath: allFillets });
}

// --- Node CLI ---

async function cli() {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { parseArgs } = await import("node:util");

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o", default: "qr-code-generated.svg" },
      replay: { type: "string" },
      colorful: { type: "boolean", default: false },
      "circle-ratio": { type: "string", default: String(CIRCLE_RATIO) },
      "stroke-width": { type: "string", default: String(CIRCLE_STROKE_WIDTH) },
      "bg-color": { type: "string", default: "#ffffff" },
      "bg-shape": { type: "string", default: "circle" },
      "fg-color": { type: "string", default: "#000000" },
      "border-color": { type: "string", default: "#000000" },
      "border-shape": { type: "string", default: "circle" },
      "corner-radius": { type: "string", default: "0" },
      "border2-color": { type: "string" },
      "border2-width": { type: "string", default: "4" },
      "border2-offset": { type: "string", default: "0" },
      "border2-trim": { type: "boolean", default: false },
      "snap-radius": { type: "boolean", default: false },
      "shuffle": { type: "boolean", default: false },
      "gap": { type: "string", default: String(DEFAULT_GAP) },
      "flank-gap": { type: "string", default: String(DEFAULT_FLANK_GAP) },
      "rand-align": { type: "boolean", default: true },
      "rand-fluff": { type: "boolean", default: false },
      "full-l-corners": { type: "boolean", default: false },
      "tip-style": { type: "string", default: "none" },
      "island-style": { type: "string", default: "none" },
      "contour-mode": { type: "boolean", default: false },
      "no-fluff": { type: "boolean", default: false },
    },
  });

  // Parse "paw:0.5,claw:1" → { paw: 0.5, claw: 1 }; plain "paw" passes through
  function parseStyleArg(val) {
    if (!val.includes(":")) return val;
    const obj = {};
    for (const part of val.split(",")) {
      const [name, w] = part.split(":");
      obj[name.trim()] = parseFloat(w);
    }
    return obj;
  }

  // Replay mode: load exact inputs from a JSON fixture captured in the browser
  if (values.replay) {
    const fixture = JSON.parse(readFileSync(values.replay, "utf-8"));
    const { svgText, options } = fixture;
    const { qrSize } = parseQr(svgText);
    const version = (qrSize - 17) / 4;
    console.log(`Replaying fixture: QR version ${version}, ${qrSize}x${qrSize} grid`);
    console.log(`Options: ${JSON.stringify(options)}`);
    const result = generate(svgText, options);
    writeFileSync(values.output, result);
    console.log(`Wrote ${values.output}`);
    return;
  }

  const input = positionals[0] || "qr-code-original.svg";
  const svgText = readFileSync(input, "utf-8");

  const { qrSize } = parseQr(svgText);
  const version = (qrSize - 17) / 4;
  console.log(`Detected QR version ${version}: ${qrSize}x${qrSize} grid`);

  const result = generate(svgText, {
    colorful: values.colorful,
    circleRatio: parseFloat(values["circle-ratio"]),
    strokeWidth: parseFloat(values["stroke-width"]),
    bgColor: values["bg-color"],
    bgShape: values["bg-shape"],
    fgColor: values["fg-color"],
    borderColor: values["border-color"],
    borderShape: values["border-shape"],
    cornerRadius: parseFloat(values["corner-radius"]),
    border2Color: values["border2-color"] || null,
    border2Width: parseFloat(values["border2-width"]),
    border2Offset: parseFloat(values["border2-offset"]),
    border2Trim: values["border2-trim"],
    snapRadius: values["snap-radius"],
    shuffle: values["shuffle"],
    gap: parseInt(values["gap"]),
    flankGap: parseInt(values["flank-gap"]),
    randAlign: values["rand-align"],
    randFluff: values["rand-fluff"],
    fullLCorners: values["full-l-corners"],
    skipCheckerLCorners: values["skip-checker-l-corners"],
    tipStyle: parseStyleArg(values["tip-style"]),
    islandStyle: parseStyleArg(values["island-style"]),
    contourMode: values["contour-mode"],
    noFluff: values["no-fluff"],
  });

  writeFileSync(values.output, result);
  console.log(`Wrote ${values.output}`);
}

// Run CLI if invoked directly via Node
const isNode = typeof process !== "undefined" && process.argv?.[1];
if (isNode && import.meta.url === `file://${process.argv[1]}`) {
  cli().catch(e => { console.error(e); process.exit(1); });
}
