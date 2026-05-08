# Contour Tracing Code Guide

## Files

1. **`pixel-paths.mjs`** — contains all contour tracing logic
2. **`generate_border.mjs`** — only the call site (~line 339) for context on parameters

## What to read in `pixel-paths.mjs`

The contour tracer walks the boundary of connected pixel regions (marching squares), classifies each vertex as convex/concave/straight, then emits SVG arc commands with configurable outer/inner radii. Special handling exists for: checkerboard diagonals (two pixels touching only at corners), full-radius L-corners (overriding r from 0.5 to 1.0 at L-shaped junctions), and tangent-continuous Bezier fillets connecting adjacent convex/concave turns.

The contour tracing lives in `squaresToContourPath` (line 452-1229). The core algorithm has these steps:

| Step | Function | Lines | Purpose |
|---|---|---|---|
| 1 | `findComponents` | 456-477 | Flood-fill to find connected pixel regions |
| 2 | `traceBoundary` | 500-543 | Marching-squares CW boundary trace |
| 3 | `findHoles` | 546-584 | Flood-fill exterior to detect interior holes |
| 4 | `traceHoleBoundary` | 588-598 | CCW hole boundary (reverses CW trace) |
| 5 | `emitPath` | 601-979 | **The big one** -- converts vertex list to SVG arcs/lines/Beziers |
| 5a | `radiusAt` | 677-738 | Per-vertex radius (ro, ri, 0, or 1 for L-corners) |
| 6 | `windingFromVertices` | 1014-1030 | Ray-cast to assign holes to components |
| 7 | `markCheckerboardVertices` | 1045-1056 | Tag diagonal-crossing vertices |
| 8 | `emitCheckerboardNotches` | 1070-1115 | Fill diagonal gaps with notch subpaths |

The main execution flow stitching it all together is at lines 1167-1206.

## Key constants

- `DX/DY` (line 491-492): direction deltas for the marching-squares trace
- `RCX/RCY`, `LCX/LCY` (line 494-498): "pixel to the right/left of this edge" lookups
- `LC_DIRS` (line 993-998): L-corner direction mappings (TL/TR/BL/BR -> incoming/outgoing directions)

## What to skip / ignore initially

- **`squaresToRoundedPath`** (line 103-448) -- the per-pixel rendering, not contour tracing
- **Diagonal connections** -- everything involving `connectDiagonals`, `diagConnections`, `markDiagConnectedVertices`, and the diagonal fillet emission at lines 1131-1165, 1209-1225. Skip any code guarded by `connectDiagonals > 0`.
- **Utility functions** at the top (lines 1-101) -- `key`, `unkey`, `fmt`, `snap`, `trimEdges`, etc. These are trivial helpers.
- **`emitLCornerNotches`** (line 1000-1006) -- currently a no-op (returns `""`)
- **`isLCornerPixel`** (line 1059-1068) -- small helper, only relevant when digging into full-radius L-corner specifics
