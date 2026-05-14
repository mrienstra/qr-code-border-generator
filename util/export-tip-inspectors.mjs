import fs from 'node:fs/promises';

const PROFILES = {
  paw: {
    shoulder: 0.48,
    sideX: 0.82,
    sideY: 0.12,
    valleyX: 0.64,
    valleyY: 0.28,
    centerY: 0.03,
    centerPull: 0.56,
  },
  'paw-claw': {
    shoulder: 0.42,
    sideX: 0.80,
    sideY: 0.08,
    valleyX: 0.66,
    valleyY: 0.24,
    centerY: 0.00,
    centerPull: 0.54,
  },
};

function buildPoints(cfg) {
  return {
    anchors: [
      ['A0', [0.00, 1.00]],
      ['A1', [1.00, 1.00]],
      ['A2', [cfg.sideX, cfg.sideY]],
      ['A3', [cfg.valleyX, cfg.valleyY]],
      ['A4', [0.50, cfg.centerY]],
      ['A5', [1 - cfg.valleyX, cfg.valleyY]],
      ['A6', [1 - cfg.sideX, cfg.sideY]],
      ['A7', [0.00, 1.00]],
    ],
    controls: [
      ['C1a', [1.00, cfg.shoulder]], ['C1b', [0.92, cfg.sideY]],
      ['C2a', [0.74, cfg.sideY]], ['C2b', [0.72, cfg.valleyY]],
      ['C3a', [0.60, cfg.valleyY]], ['C3b', [cfg.centerPull, cfg.centerY]],
      ['C4a', [1 - cfg.centerPull, cfg.centerY]], ['C4b', [0.40, cfg.valleyY]],
      ['C5a', [0.28, cfg.valleyY]], ['C5b', [0.26, cfg.sideY]],
      ['C6a', [0.08, cfg.sideY]], ['C6b', [0.00, cfg.shoulder]],
    ],
    segments: [
      ['C', [1.00, cfg.shoulder], [0.92, cfg.sideY], [cfg.sideX, cfg.sideY]],
      ['C', [0.74, cfg.sideY], [0.72, cfg.valleyY], [cfg.valleyX, cfg.valleyY]],
      ['C', [0.60, cfg.valleyY], [cfg.centerPull, cfg.centerY], [0.50, cfg.centerY]],
      ['C', [1 - cfg.centerPull, cfg.centerY], [0.40, cfg.valleyY], [1 - cfg.valleyX, cfg.valleyY]],
      ['C', [0.28, cfg.valleyY], [0.26, cfg.sideY], [1 - cfg.sideX, cfg.sideY]],
      ['C', [0.08, cfg.sideY], [0.00, cfg.shoulder], [0.00, 1.00]],
    ],
  };
}

function pathData(cfg) {
  const p = buildPoints(cfg);
  return [
    'M0,1',
    'L1,1',
    ...p.segments.map(([_, c1, c2, a]) => `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${a[0]},${a[1]}`),
    'Z'
  ].join(' ');
}

function gridLines() {
  const lines = [];
  for (let i = -1; i <= 11; i++) {
    const v = (i / 10).toFixed(1).replace(/\.0$/, '');
    lines.push(`<line x1="${v}" y1="-0.1" x2="${v}" y2="1.1" class="grid"/>`);
    lines.push(`<line x1="-0.1" y1="${v}" x2="1.1" y2="${v}" class="grid"/>`);
  }
  return lines.join('\n  ');
}

function pointCircles(items, klass) {
  return items.map(([label, [x, y]]) => `
  <circle class="${klass}" cx="${x}" cy="${y}" r="0.012"/>
  <text x="${(+x + 0.016).toFixed(3)}" y="${(+y - 0.016).toFixed(3)}">${label} (${x.toFixed(2)}, ${y.toFixed(2)})</text>`).join('');
}

function guideLines(points) {
  const a = Object.fromEntries(points.anchors);
  const c = Object.fromEntries(points.controls);
  const guides = [
    ['A1','C1a'], ['C1b','A2'],
    ['A2','C2a'], ['C2b','A3'],
    ['A3','C3a'], ['C3b','A4'],
    ['A4','C4a'], ['C4b','A5'],
    ['A5','C5a'], ['C5b','A6'],
    ['A6','C6a'], ['C6b','A7'],
  ];
  const pts = { ...a, ...c };
  return guides.map(([p1, p2]) => {
    const [x1, y1] = pts[p1];
    const [x2, y2] = pts[p2];
    return `<line class="guide" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('\n  ');
}

function svgFor(name, cfg) {
  const pts = buildPoints(cfg);
  const escapedJson = JSON.stringify(cfg, null, 2).replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
  const jsonLines = escapedJson.split('\n').map((line, i) =>
    i === 0
      ? `<text x="0.58" y="0.84">${line}</text>`
      : `<text x="0.58" y="${(0.84 + i * 0.055).toFixed(3)}">${line}</text>`
  ).join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.15 -0.15 1.3 1.3" width="900" height="900">
  <style>
    .grid { stroke: #e5e7eb; stroke-width: 0.003; }
    .axis { stroke: #9ca3af; stroke-width: 0.006; }
    .box { stroke: #111827; stroke-width: 0.01; fill: none; }
    .base { stroke: #6b7280; stroke-width: 0.008; stroke-dasharray: 0.025 0.02; }
    .shape { fill: rgba(15, 23, 42, 0.08); stroke: #0f172a; stroke-width: 0.01; }
    .guide { stroke: #94a3b8; stroke-width: 0.004; stroke-dasharray: 0.02 0.02; }
    .anchor { fill: #e11d48; }
    .control { fill: #2563eb; }
    text { font: 0.04px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #334155; }
    .title { font-size: 0.055px; fill: #0f172a; font-weight: 700; }
    .panel { fill: #ffffff; stroke: #cbd5e1; stroke-width: 0.004; }
  </style>

  ${gridLines()}
  <rect x="0" y="0" width="1" height="1" class="box"/>
  <line x1="0" y1="0" x2="1" y2="0" class="axis"/>
  <line x1="0" y1="0" x2="0" y2="1" class="axis"/>
  <line x1="0" y1="1" x2="1" y2="1" class="base"/>
  <path class="shape" d="${pathData(cfg)}"/>
  ${guideLines(pts)}
  ${pointCircles(pts.anchors, 'anchor')}
  ${pointCircles(pts.controls, 'control')}
  <rect class="panel" x="0.56" y="0.72" width="0.5" height="0.36" rx="0.02"/>
  <text class="title" x="-0.12" y="-0.08">${name} — normalized tip-up coords</text>
  <text x="0.58" y="0.78">Paste-back constants:</text>
  ${jsonLines}
</svg>`;
}

const helperLines = [
  `// Generated helper for manual tip editing.`,
  `// Author in normalized tip-up coordinates: u = 0..1 across, v = 0..1 tip->base.`,
  `// Exported sample SVGs use the exact same numbers, so edits can be pasted back here.`,
  ``,
  `export const TIP_PROFILES = ${JSON.stringify(PROFILES, null, 2)};`,
  ``,
  `export function profileToSegments(cfg) {`,
  `  return [`,
  `    ['M', [0.00, 1.00]],`,
  `    ['L', [1.00, 1.00]],`,
  `    ['C', [1.00, cfg.shoulder], [0.92, cfg.sideY], [cfg.sideX, cfg.sideY]],`,
  `    ['C', [0.74, cfg.sideY], [0.72, cfg.valleyY], [cfg.valleyX, cfg.valleyY]],`,
  `    ['C', [0.60, cfg.valleyY], [cfg.centerPull, cfg.centerY], [0.50, cfg.centerY]],`,
  `    ['C', [1 - cfg.centerPull, cfg.centerY], [0.40, cfg.valleyY], [1 - cfg.valleyX, cfg.valleyY]],`,
  `    ['C', [0.28, cfg.valleyY], [0.26, cfg.sideY], [1 - cfg.sideX, cfg.sideY]],`,
  `    ['C', [0.08, cfg.sideY], [0.00, cfg.shoulder], [0.00, 1.00]],`,
  `    ['Z'],`,
  `  ];`,
  `}`,
  ``,
  `export function buildTipPathFromProfile(x, y, tipDir, cfg, fmt, mapTipPt) {`,
  `  const pt = (u, v) => {`,
  `    const [px, py] = mapTipPt(x, y, tipDir, u, v);`,
  "    return `${fmt(px)},${fmt(py)}`;",
  `  };`,
  `  const segs = profileToSegments(cfg);`,
  `  return segs.map(seg => {`,
  `    const [cmd, ...rest] = seg;`,
  `    if (cmd === 'Z') return 'z';`,
  `    return cmd + rest.map(([u, v]) => pt(u, v)).join(',');`,
  `  }).join('');`,
  `}`,
  ``
].join('\n');

await fs.writeFile('output/paw.svg', svgFor('paw', PROFILES.paw));
await fs.writeFile('output/paw-claw.svg', svgFor('paw-claw', PROFILES['paw-claw']));
await fs.writeFile('output/tip-profile-helper.mjs', helperLines);
console.log('Wrote paw.svg, paw-claw.svg, tip-profile-helper.mjs');
