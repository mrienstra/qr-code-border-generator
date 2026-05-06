/**
 * Layout computation, border shape SDF, and SVG assembly.
 */

import { fmt } from "./pixel-paths.mjs";

// --- Circle / layout constants ---
export const CIRCLE_RATIO = 27 / 33; // default 0.81818
export const CIRCLE_MARGIN = 3;
export const CIRCLE_STROKE_WIDTH = 2;

// --- Layout ---

export function computeLayout(qrSize, circleRatio = CIRCLE_RATIO, strokeWidth = CIRCLE_STROKE_WIDTH, borderShape = "circle", cornerRadius = 0, snapRadius = false) {
  let circleR = qrSize * circleRatio;
  if (snapRadius) circleR = Math.round(circleR);
  const svgSize = 2 * circleR + 2 * CIRCLE_MARGIN;
  const qrOrigin = (svgSize - qrSize) / 2;
  return {
    qrSize, svgSize, qrOrigin,
    circleCx: svgSize / 2,
    circleCy: svgSize / 2,
    circleR, strokeWidth, borderShape, cornerRadius,
  };
}

// --- Border shape SDF (signed distance function) ---

export function shapeSDF(px, py, layout, radiusOffset) {
  const cx = layout.circleCx, cy = layout.circleCy;
  const r = layout.circleR + radiusOffset;
  if (layout.borderShape === "square") {
    const cr = layout.cornerRadius * r;
    const qx = Math.abs(px - cx) - r + cr;
    const qy = Math.abs(py - cy) - r + cr;
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) - cr;
  }
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r;
}

export function pixelOverlapsStroke(x, y, layout, radiusOffset, strokeWidth) {
  const hw = strokeWidth / 2;
  const corners = [
    shapeSDF(x, y, layout, radiusOffset),
    shapeSDF(x + 1, y, layout, radiusOffset),
    shapeSDF(x, y + 1, layout, radiusOffset),
    shapeSDF(x + 1, y + 1, layout, radiusOffset),
  ];
  const minSDF = Math.min(...corners);
  const maxSDF = Math.max(...corners);
  // Pixel overlaps stroke if some part is inside outer edge AND some part is outside inner edge
  return minSDF < hw && maxSDF > -hw;
}

// --- SVG element helpers ---

function borderShapeElement(layout, attrs, radiusOffset = 0) {
  const r = layout.circleR + radiusOffset;
  const cx = fmt(layout.circleCx), cy = fmt(layout.circleCy);
  const attrStr = attrs ? " " + attrs : "";
  if (layout.borderShape === "square") {
    const x = fmt(layout.circleCx - r);
    const y = fmt(layout.circleCy - r);
    const side = fmt(2 * r);
    const rx = fmt(layout.cornerRadius * r);
    return `<rect x="${x}" y="${y}" width="${side}" height="${side}" rx="${rx}" ry="${rx}"${attrStr}/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${fmt(r)}"${attrStr}/>`;
}

// --- SVG output ---

export function generateSvg(qrPath, decorationPaths, layout, {
  bgColor = "#ffffff", bgShape = "circle", fgColor = "#000000", borderColor = "#000000",
  border2Color = null, border2Width = 4, border2Offset = 0,
  wobbleFreq = 0, wobbleOctaves = 3, wobbleScale = 0,
} = {}) {
  const s = fmt(layout.svgSize);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">`,
  ];
  if (bgShape === "circle") {
    lines.push(`  ${borderShapeElement(layout, `fill="${bgColor}"`)}`);
  } else {
    lines.push(`  <rect width="100%" height="100%" fill="${bgColor}"/>`);
  }
  const wobbleFilter = wobbleScale > 0 && wobbleFreq > 0;
  lines.push(
    `  <defs>`,
    `    <clipPath id="border-clip">`,
    `      ${borderShapeElement(layout, "")}`,
    `    </clipPath>`,
  );
  if (wobbleFilter) {
    lines.push(
      `    <filter id="wobble" filterUnits="userSpaceOnUse" x="0" y="0" width="${s}" height="${s}">`,
      `      <feTurbulence type="turbulence" baseFrequency="${fmt(wobbleFreq)}" numOctaves="${wobbleOctaves}" seed="42" result="turb"/>`,
      `      <feDisplacementMap in="SourceGraphic" in2="turb" scale="${fmt(wobbleScale)}" xChannelSelector="R" yChannelSelector="G"/>`,
      `    </filter>`,
    );
  }
  lines.push(
    `  </defs>`,
    `  <g clip-path="url(#border-clip)"${wobbleFilter ? ' filter="url(#wobble)"' : ''}>`,
    `    <path data-step="0" d="${qrPath}" fill="${fgColor}"/>`,
  );
  for (const [label, pathD, color, step] of decorationPaths) {
    lines.push(`    <!-- ${label} -->`);
    lines.push(`    <path data-step="${step}" d="${pathD}" fill="${color}"/>`);
  }
  lines.push(`  </g>`);
  if (border2Color !== null) {
    lines.push(
      `  ${borderShapeElement(layout, `fill="none" stroke="${border2Color}" stroke-width="${fmt(border2Width)}"`, border2Offset)}`
    );
  }
  lines.push(
    `  ${borderShapeElement(layout, `fill="none" stroke="${borderColor}" stroke-width="${fmt(layout.strokeWidth)}"`)}`
  );
  lines.push(`</svg>`);
  return lines.join("\n");
}
