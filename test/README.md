# Test scripts

Rendering comparison tests for the three path renderers (per-pixel, clean-path, contour). All require `rsvg-convert` and ImageMagick (`magick`/`compare`).

## Quick checks (< 10 seconds)

**test-classify-exhaustive.mjs** — Verifies `classifyPixels()` output (corners, radii, fillets, diag bridges) against inline reference logic for all 511 non-empty 3×3 masks × 3 option combos. Pure logic, no rasterization.

**test-splice-vs-perpixel.mjs** — 10 named diagonal patterns (2px-diag, L-shape, chain, cross, etc.) × 4 option combos. Contour vs per-pixel, rasterized comparison. Good for checking diagonal bridge / splice correctness after topology changes.

## Exhaustive checks (1–10 minutes)

**test-clean-3x3.mjs** — All 511 3×3 masks, clean-path vs per-pixel, rasterized at 160×160. Runs 4 option combos (cd=0, cd=0+flc, ri=0, cd=5+flc). Reports pass/low/fail with percentage thresholds.

**test-quadrant-diff.mjs** — All 511 3×3 masks with cd=5+flc. Groups pixel diffs by cell and quadrant (TL/TR/BL/BR) to distinguish thin anti-aliasing patina from concentrated shape errors. Reports "patina" vs "concentrated" classification.

## Regression finders (1–5 minutes)

**test-random-grids.mjs** — Generates random 6×6 and 8×8 grids at various densities, compares contour vs per-pixel with cd=5+flc. Saves failure SVGs to `/tmp/` for debugging. Good for finding topology bugs that don't appear in small 3×3 patterns.

## Visual inspection

**test-visual-masks.mjs** — Generates three-panel SVGs (per-pixel / clean-path / contour) with semi-transparent grid overlay. Accepts mask numbers as CLI args or defaults to top-5 worst-diff masks.

```
node test/test-visual-masks.mjs 254 30 126
```

Output goes to `/tmp/visual-mask{N}.svg` and `.png`.

## Notes

- Per-pixel rendering uses separate `<path>` elements for main shapes and fillets (fillets painted on top). This avoids anti-aliasing seam artifacts at internal subpath boundaries that appear when fillets are combined into a single `<path d="...">`.
- All comparisons render at full opacity. Semi-transparent rendering of per-pixel paths shows seams at overlapping subpath boundaries regardless of SVG technique (fill-opacity, group opacity, clipPath, mask).
