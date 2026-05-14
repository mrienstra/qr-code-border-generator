// Generated helper for manual tip editing.
// Author in normalized tip-up coordinates: u = 0..1 across, v = 0..1 tip->base.
// Exported sample SVGs use the exact same numbers, so edits can be pasted back here.

export const TIP_PROFILES = {
  "paw": {
    "shoulder": 0.48,
    "sideX": 0.82,
    "sideY": 0.12,
    "valleyX": 0.64,
    "valleyY": 0.28,
    "centerY": 0.03,
    "centerPull": 0.56
  },
  "paw-claw": {
    "shoulder": 0.42,
    "sideX": 0.8,
    "sideY": 0.08,
    "valleyX": 0.66,
    "valleyY": 0.24,
    "centerY": 0,
    "centerPull": 0.54
  }
};

export function profileToSegments(cfg) {
  return [
    ['M', [0.00, 1.00]],
    ['L', [1.00, 1.00]],
    ['C', [1.00, cfg.shoulder], [0.92, cfg.sideY], [cfg.sideX, cfg.sideY]],
    ['C', [0.74, cfg.sideY], [0.72, cfg.valleyY], [cfg.valleyX, cfg.valleyY]],
    ['C', [0.60, cfg.valleyY], [cfg.centerPull, cfg.centerY], [0.50, cfg.centerY]],
    ['C', [1 - cfg.centerPull, cfg.centerY], [0.40, cfg.valleyY], [1 - cfg.valleyX, cfg.valleyY]],
    ['C', [0.28, cfg.valleyY], [0.26, cfg.sideY], [1 - cfg.sideX, cfg.sideY]],
    ['C', [0.08, cfg.sideY], [0.00, cfg.shoulder], [0.00, 1.00]],
    ['Z'],
  ];
}

export function buildTipPathFromProfile(x, y, tipDir, cfg, fmt, mapTipPt) {
  const pt = (u, v) => {
    const [px, py] = mapTipPt(x, y, tipDir, u, v);
    return `${fmt(px)},${fmt(py)}`;
  };
  const segs = profileToSegments(cfg);
  return segs.map(seg => {
    const [cmd, ...rest] = seg;
    if (cmd === 'Z') return 'z';
    return cmd + rest.map(([u, v]) => pt(u, v)).join(',');
  }).join('');
}
