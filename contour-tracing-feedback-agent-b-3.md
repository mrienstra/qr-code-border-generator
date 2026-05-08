Yes — this first-stage plan looks **reasonably solid**, and more importantly it is scoped correctly as a structural extraction rather than a behavior rewrite.
It targets the right seam first: move edge derivation and vertex annotation out of `emitPath`, while keeping the geometry serializer behavior intact.

## What looks good

The plan’s invariant is exactly the right one for stage 1: `emitPath` should stop computing edges and stop mutating vertices, and instead consume precomputed edge data plus pre-annotated vertices.
That is a clean step because the current `emitPath` really does mix edge construction, L-corner detection, and path serialization in one place.

I also like that you are consolidating `markCheckerboardVertices`, `markDiagConnectedVertices`, and the in-function L-corner detection into one `annotateVertices` pass.
That matches the eventual “trace -> annotate -> resolve policy -> emit” framing without forcing the policy split yet.

## One change I’d make

I would make `annotateVertices` take an explicit context object instead of silently closing over outer variables.
In practice, that means something like `annotateVertices(vertices, edges, { compPixels, allPixels, diagConnections, fullLCorners, ro, skipCheckerLCorners })`, because the existing annotation logic depends on global occupancy, diagonal-connection state, and the `fullLCorners` / `skipCheckerLCorners` options.

Even if stage 1 only moves code around verbatim, making those dependencies explicit now will prevent the new annotation pass from becoming another hidden-coupling zone.
That is the main architectural improvement I’d push before implementation.

## Watchouts

The biggest correctness risk is that L-corner detection currently lives inside `emitPath` and depends on both `edges` and `compPixels`, while checkerboard and diagonal-connected flags are currently applied in main assembly before `emitPath` is called.
When you merge those into `annotateVertices`, be careful about preserving the exact ordering assumptions, especially for vertices that may be visited more than once at the same coordinate in pinch-point situations.

A smaller watchout is naming: `annotateVertices` is fine for stage 1, but the function is really loop-specific, not generic to any vertex list.
If you want the structure to age well, `annotateLoopVertices` and `buildLoopEdges` would communicate intent more clearly.

## Suggested tweaks

I would add one explicit non-goal to stage 1: “no new derived policy fields beyond current booleans / tags.”
That keeps stage 1 from drifting into stage 2, where `radiusAt` gets replaced by precomputed plans.

I would also add a tiny assertion-level test target beyond image diffs: verify that the annotated vertex sequence is byte-for-byte equivalent on key fields like `turn`, `checkerboard`, `diagConnected`, and `fullRadius` for a few known tricky shapes.
That gives you confidence the refactor preserved the preconditions that `emitPath` relies on, not just the final SVG output.

## Verdict

So yes: the plan is good, incremental, and aimed at the highest-value first cut.
My only real recommendation is to make the annotation pass’s dependencies explicit via a context parameter and to treat the annotated vertex record as the stage-1 contract.

A concise version of the stage-1 contract I’d use is: `buildEdges(vertices) -> edges`, then `annotateLoopVertices(vertices, edges, context)`, then `emitPath(vertices, edges, ro, ri, isHole, compPixels)`.
That keeps stage 2 very obvious: replace implicit radius policy with `plans`.
