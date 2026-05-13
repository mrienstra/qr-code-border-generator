/**
 * Island profile definitions and radial path builder for isolated single pixels.
 */

import { fmt } from './pixel-paths.mjs';

export const ISLAND_PROFILES = {
  star4: {
    points: 4,
    innerRadius: 0.18,
    outerRadius: 0.5,
    phase: 0.0,
    peakPull: 0.08,
    peakOpen: 0.0,
    peakRotate: 0.0,
    valleyPull: 0.04,
    valleyOpen: 0.0,
    valleyRotate: 0.0,
  },

  diamond4: {
    points: 4,
    innerRadius: 0.18,
    outerRadius: 0.5,
    phase: 0.5,
    peakPull: 0.08,
    peakOpen: 0.0,
    peakRotate: 0.0,
    valleyPull: 0.04,
    valleyOpen: 0.0,
    valleyRotate: 0.0,
  },

  flower5: {
    points: 5,
    innerRadius: 0.24,
    outerRadius: 0.48,
    phase: 0.0,
    peakPull: 0.09,
    peakOpen: 0.35,
    peakRotate: 0.0,
    valleyPull: 0.05,
    valleyOpen: -0.35,
    valleyRotate: 0.0,
  },
};

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalize(x, y) {
  const m = Math.hypot(x, y) || 1;
  return [x / m, y / m];
}

function rotateVec(x, y, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [x * c - y * s, x * s + y * c];
}

function buildRadialHandlePair(vertex, centerX, centerY, pull = 0, open = 0, rotate = 0) {
  if (!pull) {
    return {
      in: [vertex.x, vertex.y],
      out: [vertex.x, vertex.y],
    };
  }

  open = clamp(open ?? 0, -1, 1);
  rotate = clamp(rotate ?? 0, -1, 1);

  const t = Math.abs(open);
  const axialSign = open < 0 ? -1 : 1;

  let [rx, ry] = normalize(vertex.x - centerX, vertex.y - centerY);
  let tx = -ry;
  let ty = rx;

  const rot = rotate * (Math.PI / 2);
  [rx, ry] = rotateVec(rx, ry, rot);
  [tx, ty] = rotateVec(tx, ty, rot);

  let inX  = -tx * (1 - t) + rx * axialSign * t;
  let inY  = -ty * (1 - t) + ry * axialSign * t;
  let outX =  tx * (1 - t) + rx * axialSign * t;
  let outY =  ty * (1 - t) + ry * axialSign * t;

  [inX, inY] = normalize(inX, inY);
  [outX, outY] = normalize(outX, outY);

  return {
    in: [vertex.x + inX * pull, vertex.y + inY * pull],
    out: [vertex.x + outX * pull, vertex.y + outY * pull],
  };
}

export function buildRadialIslandPath(centerX, centerY, profile) {
  const {
    points,
    innerRadius,
    outerRadius,
    phase = 0,
  } = profile;

  const stepDeg = 360 / (points * 2);
  const phaseDeg = phase * (360 / points);

  const nodes = [];

  for (let i = 0; i < points * 2; i++) {
    const isPeak = i % 2 === 0;
    const idx = Math.floor(i / 2) + 1;
    const prefix = isPeak ? "peak" : "valley";

    const radius = isPeak ? outerRadius : innerRadius;
    const angle = phaseDeg + i * stepDeg;
    const pt = polarToCartesian(centerX, centerY, radius, angle);

    const pull =
      profile[`${prefix}${idx}Pull`] ??
      profile[`${prefix}Pull`] ??
      0;

    const open =
      profile[`${prefix}${idx}Open`] ??
      profile[`${prefix}Open`] ??
      0;

    const rotate =
      profile[`${prefix}${idx}Rotate`] ??
      profile[`${prefix}Rotate`] ??
      0;

    nodes.push({
      x: pt.x,
      y: pt.y,
      pull,
      open,
      rotate,
      ...buildRadialHandlePair(pt, centerX, centerY, pull, open, rotate),
    });
  }

  if (!nodes.length) return "";

  const segs = [`M${fmt(nodes[0].x)},${fmt(nodes[0].y)}`];

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    segs.push(
      `C${fmt(a.out[0])},${fmt(a.out[1])},${fmt(b.in[0])},${fmt(b.in[1])},${fmt(b.x)},${fmt(b.y)}`
    );
  }

  segs.push("Z");
  return segs.join("");
}
