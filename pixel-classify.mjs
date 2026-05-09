/**
 * Shared pixel appearance classification.
 *
 * Extracted from per-pixel-paths.mjs so both per-pixel and clean-path
 * renderers use the same authoritative source of truth for corner radii,
 * L-corner detection, inner fillets, and diagonal bridge decisions.
 */

import { key } from './pixel-paths.mjs';

/**
 * Classify the visual appearance of every filled pixel.
 *
 * @param {Set<string>} squares  - pixels to classify (subset of allPixels)
 * @param {Set<string>} allPixels - all filled pixels (for neighbor lookups)
 * @param {object} opts
 * @param {number} opts.ro - outer corner radius (0-0.5)
 * @param {number} opts.ri - inner fillet radius (0-0.5)
 * @param {number} opts.connectDiagonals - 0-5, diagonal bridging aggressiveness
 * @param {boolean} opts.fullLCorners - enable full-radius (r=1.0) L-corners
 * @param {boolean} opts.skipCheckerLCorners - suppress L-corners at checkerboard vertices
 * @returns {Map<string, PixelAppearance>}
 */
export function classifyPixels(squares, allPixels, opts) {
  const { ro, ri, connectDiagonals = 0, fullLCorners = false, skipCheckerLCorners = false } = opts;
  const map = new Map();

  for (const k of squares) {
    const i = k.indexOf(",");
    const x = Number(k.slice(0, i)), y = Number(k.slice(i + 1));

    // Cardinal neighbors
    const hasL = allPixels.has(key(x - 1, y));
    const hasR = allPixels.has(key(x + 1, y));
    const hasU = allPixels.has(key(x, y - 1));
    const hasD = allPixels.has(key(x, y + 1));

    // Diagonal neighbors
    const hasTL = allPixels.has(key(x - 1, y - 1));
    const hasTR = allPixels.has(key(x + 1, y - 1));
    const hasBR = allPixels.has(key(x + 1, y + 1));
    const hasBL = allPixels.has(key(x - 1, y + 1));

    // Diagonal bridge decisions
    const remCurrent = (hasL ? 1 : 0) + (hasR ? 1 : 0) + (hasU ? 1 : 0) + (hasD ? 1 : 0);
    let diagTL = false, diagTR = false, diagBR = false, diagBL = false;
    if (connectDiagonals > 0) {
      const threshold = connectDiagonals - 1;
      const tFloor = Math.floor(threshold);
      const frac = threshold - tFloor;
      function shouldConnect(remOther, vx, vy) {
        const sum = remCurrent + remOther;
        if (sum <= tFloor) return true;
        if (frac > 0 && sum === tFloor + 1) {
          return ((vx * 3 + vy * 7) % 4) < (frac * 4);
        }
        return false;
      }
      if (!hasL && !hasU && hasTL) {
        const rem = (allPixels.has(key(x - 2, y - 1)) ? 1 : 0) + (allPixels.has(key(x - 1, y - 2)) ? 1 : 0);
        diagTL = shouldConnect(rem, x, y);
      }
      if (!hasR && !hasU && hasTR) {
        const rem = (allPixels.has(key(x + 2, y - 1)) ? 1 : 0) + (allPixels.has(key(x + 1, y - 2)) ? 1 : 0);
        diagTR = shouldConnect(rem, x + 1, y);
      }
      if (!hasR && !hasD && hasBR) {
        const rem = (allPixels.has(key(x + 2, y + 1)) ? 1 : 0) + (allPixels.has(key(x + 1, y + 2)) ? 1 : 0);
        diagBR = shouldConnect(rem, x + 1, y + 1);
      }
      if (!hasL && !hasD && hasBL) {
        const rem = (allPixels.has(key(x - 2, y + 1)) ? 1 : 0) + (allPixels.has(key(x - 1, y + 2)) ? 1 : 0);
        diagBL = shouldConnect(rem, x, y + 1);
      }
    }

    // Corner rounding: rounded when both adjacent cardinals absent
    // and no diagonal bridge suppresses it.
    const tlRounded = ro > 0 && !hasL && !hasU && !diagTL;
    const trRounded = ro > 0 && !hasR && !hasU && !diagTR;
    const brRounded = ro > 0 && !hasR && !hasD && !diagBR;
    const blRounded = ro > 0 && !hasL && !hasD && !diagBL;

    // Corner radii (default to ro, upgrade to 1.0 for L-corners)
    let tlR = ro, trR = ro, brR = ro, blR = ro;
    if (fullLCorners && ro > 0) {
      if (tlRounded && hasR && hasD && !(skipCheckerLCorners && hasTL)) tlR = 1;
      if (trRounded && hasL && hasD && !(skipCheckerLCorners && hasTR)) trR = 1;
      if (brRounded && hasL && hasU && !(skipCheckerLCorners && hasBR)) brR = 1;
      if (blRounded && hasR && hasU && !(skipCheckerLCorners && hasBL)) blR = 1;
    }

    // Inner fillets: concave vertex where diagonal is absent but
    // both adjacent cardinals are present.
    const filletTL = hasL && hasU && !hasTL;
    const filletTR = hasR && hasU && !hasTR;
    const filletBR = hasR && hasD && !hasBR;
    const filletBL = hasL && hasD && !hasBL;

    map.set(k, {
      x, y,
      corners: {
        tl: { rounded: tlRounded, radius: tlR },
        tr: { rounded: trRounded, radius: trR },
        br: { rounded: brRounded, radius: brR },
        bl: { rounded: blRounded, radius: blR },
      },
      innerFillets: { tl: filletTL, tr: filletTR, br: filletBR, bl: filletBL },
      diagBridges: { tl: diagTL, tr: diagTR, br: diagBR, bl: diagBL },
    });
  }

  return map;
}
