# smv internals — module contracts (M0/M1)

Read `docs/PLAN.md` first (decisions D1–D11). This file pins the internal interfaces so
modules developed in parallel compose. **Do not change a contract here without updating
every consumer.** Plain-JS ESM, no TypeScript, no framework. Browser-only APIs must be
guarded so every module *imports* cleanly in Node (tests run under `node --test`).

Naming: npm `sparkle-motion-vizualizer` · global `SparkleMotion` · prefix `smv`
(`.smv-*` classes, `--smv-*` custom properties, `dist/smv.esm.js`, `dist/smv.iife.min.js`).

## Data flow (one way)

spec mutation → view (M1: expand/collapse/meta-edges) → measure → `layout()` → keyed diff
→ `scene.commit()` (animated) → renderer writes DOM per frame. Token engine is orthogonal:
decorates from `stateAt(t)` inside the same rAF loop, never mutates the graph.

## Existing modules (done — read them)

- `src/events.js` — `emitter()` → `{on(type,fn)→off, off, emit}`; `"*"` listens to all.
- `src/store.js` — `Store` (validated spec, mutations, `condense`, `snapshot/restore`),
  `GraphError(code, msg)`, `isConvex`.
- `src/cycles.js` — `breakCycles(nodes, edges, pinned:Set)→Set<edgeId>`, `isAcyclic`.
- `src/measure.js` — `textWidth`, `truncate`, `sizeNode(node)→{w,h}` (deterministic
  estimator under Node), constants `NODE_H`, etc.
- `src/layout.js` — **frozen seam (D2)**:
  `layout(view, opts) → { nodes:{id:{x,y,w,h}}, edges:{id:{points,reversed?}}, bounds:{x,y,w,h}, reversedEdgeIds:Set }`.
  `view = {nodes:[{id,w,h,parent?}], edges:[{id,source,target,loop?,maxIterations?}]}`.
  `opts = {dir:'LR'|'TB'|…, nodesep, ranksep, marginx, marginy, pinnedReversals:Set}`.
  x,y are **centers**. Edge `points` always run source→target in true direction; back
  edges/self-loops carry `reversed: true` and are routed as consistent-side arcs
  (below for LR). Callers persist `reversedEdgeIds` and pass it back as
  `pinnedReversals` next layout (FAS pinning, D3).

## Contracts to implement

### `src/path.js` (pure, no DOM)

- `sampleCubic(p0, c1, c2, p3, n)` → `n` points `{x,y}` on a cubic Bézier, endpoints included. (Already imported by layout.js.)
- `catmullRom(points, per = 8)` → dense polyline through the given points (centripetal
  or uniform CR; straight pass-through when `points.length < 3`).
- `resample(points, n = 24)` → exactly `n` points uniformly spaced by arc length
  (endpoints preserved; handles zero-length input by repeating the point).
- `lerpPoints(a, b, t)` → pointwise lerp of two equal-length arrays.
- `arcLength(points)` → number.
- `pointAt(points, t)` → `{x, y, angle}` at normalized arc-length position `t∈[0,1]`
  (`angle` in radians of the local direction; used for token pulses + arrowheads).
- `pathString(points)` → `"M x y L …"` (numbers rounded to 2 decimals).
- `clipEnds(points, srcRect, tgtRect)` → `{points, arrow:{x,y,angle}}` where rects are
  `{x, y, w, h, r}` (x,y = **center**, `r` = corner radius). Trim the polyline so it
  starts on the source border and ends on the target border (segment/rect intersection;
  corner-radius approximation is fine), plus the arrowhead pose at the target end.
  Must be cheap: it runs **per frame** during transitions (G7). If the two rects overlap
  or the polyline is fully inside, return a degenerate short segment rather than NaN.

### `src/diff.js` (pure)

`diffKeys(oldIterable, newIterable)` → `{enter: [], update: [], exit: []}` (arrays of keys;
`update` = present in both). Accepts any iterables of keys.

### `src/anim.js`

- `EASE = { linear, cubicOut, cubicInOut, overshoot }` — `fn(t)→t'` (overshoot = back-out,
  slight >1 excursion, used by condense reveal).
- `createTicker()` → `{ now(), add(fn), remove(fn), destroy() }`. ONE rAF loop (D1);
  callbacks get `now()` ms each frame. Clock source: a WAAPI `Animation` on a detached
  element when `document`+`Element.animate` exist (read `currentTime`), else
  `performance.now()`. The loop starts when the first callback is added, stops when the
  last is removed. Under Node (no rAF) `add` still works and `now()` uses
  `performance.now()`; a manual `tick(ms)` method advances time for tests
  (`createTicker({manual: true})`).
- `prefersReducedMotion()` → bool (false under Node). When true, callers shrink
  durations to ≤ 1ms but preserve sequencing (G9).

### `src/scene.js` (DOM-free diff-and-animate core, D9 interruption)

```js
createScene(ticker) → scene
scene.visual = { nodes: Map<id,{x,y,w,h,opacity}>, edges: Map<id,{points, opacity, reversed}> }
scene.onFrame(cb)          // cb(visual) after each interpolation step; also once per commit
scene.commit(target, opts) → Transition
```

- `target = { nodes:{id:{x,y,w,h}}, edges:{id:{points, reversed?}} }` (a layout result).
- `opts = { duration=350, easing=EASE.cubicOut, enterFrom?:{id:{x,y}}, holdOpacity?:Set<id> }`.
- Semantics: keyed diff of `scene.visual` vs `target`.
  - update: tween x/y/w/h; edges: target points → `resample(catmullRom(pts), 24)`, then
    lerp from current 24-pt geometry.
  - enter: nodes start at `enterFrom[id]` (e.g. container centroid) or target position,
    opacity 0→1, size from 60%→100%.
  - exit: opacity →0, then delete from `visual`.
- **Interruption = cancel-and-retarget (D9):** `commit()` while a transition is live
  samples the *current interpolated* `visual` as the new "from", cancels the old
  transition (its promise resolves with `{canceled: true}`), and starts one new
  transition. Two transitions never write the same element.
- `Transition = { promise, cancel(), done }` — promise resolves `{canceled: boolean}`.
- Zero/short durations complete on the next tick (never synchronously re-entrant).

### `src/styles.js` (theme + injected CSS, D7)

- `injectStyles(doc)` — one deduped global `<style data-smv-styles>` (G8).
- CSS uses only `.smv-*` classes, `[data-*]` selectors, `--smv-*` custom properties.
  Back edges: `.smv-edge[data-reversed] path.smv-edge-line { stroke-dasharray: 4 3; opacity:.7 }`.
  Hover/focus affordances may use CSS transitions; **choreographed motion may not** (D1).
- Light/dark via `:where()` defaults + `data-smv-theme="dark"` overrides on the mount root.

### `src/render.js` (DOM; only `mount()` touches it)

```js
createRenderer(rootEl, doc) → r
r.svg, r.viewportG
r.styleCommit(storeLike)   // at commit time only: data-* attrs + --smv-* props per element (D7)
r.frame(visual)            // per frame: geometry only
```

- DOM shape: `svg.smv > g.smv-viewport > (g.smv-edges > g.smv-edge*, g.smv-nodes > g.smv-node*)`.
- Node: `<g class="smv-node" data-id><rect rx=8/><text/></g>`; per frame set
  `transform=translate(x−w/2, y−h/2)`, rect `width/height` (**never** group scale, D1),
  text centered at `(w/2, h/2)`, `opacity`.
- Edge: `<g class="smv-edge" data-id><path class="smv-edge-line"/><path class="smv-edge-arrow"/></g>`;
  per frame: `clipEnds(points, srcRect, tgtRect)` using the *current-frame* node rects
  from `visual`, then set `d` and position/rotate the arrow path (a small filled
  triangle, G6 — no `<marker>`).
- Elements enter/exit the DOM keyed by id; renderer owns element lifecycle from the ids
  present in `visual`.
- Labels: `truncate(label, w − 2·NODE_PAD_X)` re-applied on styleCommit (not per frame).

### `src/viewport.js` (DOM)

```js
createViewport(svgEl, viewportG, ticker) → vp
vp.fit(bounds, pad=24, animate=false)     // explicit only (D10)
vp.transform                              // {x, y, k}
vp.screenToWorld(pt), vp.worldToScreen(pt)
vp.anchor(worldPtBefore, worldPtAfter, duration)  // translate-only correction, same clock
vp.contains(bounds) → bool                // for the auto-refit-only-if-outside rule
vp.destroy()
```

Pan: pointer drag. Zoom: wheel **only with ctrl/cmd** (never hijack page scroll) + pinch.
`userMoved` flag once the user pans/zooms manually.

### `src/index.js` — public API

```js
export function mount(el, spec, opts) → g
export const version
```

- `opts = { theme:'auto'|'light'|'dark', layout:{dir:'LR',…}, animation:{duration:350, easing:'cubic-out'}, controls:false (M1) }`.
- Instance `g`: `addNode(n, {after}?)`, `addEdge(e)`, `removeNode(id)`, `removeEdge(id)`,
  `update(id, patch)`, `batch(fn)` (one relayout for many ops), `on/off`,
  `fitView()`, `layout()` (re-run), `node(id)`, `spec()`, `destroy()`.
  M1 adds: `expand/collapse/condense/run/storyboard`.
- Every mutation returns the commit's `Transition.promise`-like awaitable (thenable
  `{then, catch, finally, cancel}`) — awaitable, cancelable (§5.3).
- `addNode(n, {after: 'x'})` sugar: also adds edge `{id: 'e:x->'+n.id, source:'x', target:n.id}`.
- Relayout pipeline: view from store (M0: all nodes flat; skip nodes with `parent` whose
  container logic lands in M1 — for M0 pass `parent` through to dagre as-is) →
  `sizeNode` each → `layout(view, {…, pinnedReversals: this._rev})` → persist
  `this._rev = result.reversedEdgeIds` → `renderer.styleCommit` → `scene.commit` →
  anchored-viewport correction (D10): keep the mutation's focal node (added/updated node,
  else layout-bounds center) stationary in screen space; if user never moved and content
  lands outside viewport, refit.
- IIFE global: `SparkleMotion = { mount, version }`.

## Style commit (D7)

At commit time only, per element: `data-status`, `data-reversed`, `data-mode`,
`data-weight` (meta-edges), plus user style-function output written as `--smv-*`
properties. Nothing style-related is written per frame.

## Tests & tooling

- `node --test test/` — files `test/*.test.js`.
- Golden layout files under `test/golden/*.json`: `{nodes:{id:{x,y,w,h}}, edges:{id:points}}`
  per fixture with **explicit node w/h** (determinism). Regenerate via
  `node test/golden/update.js` only when a layout change is intended.
- Crossing-count assertion: count pairwise forward-edge segment crossings in a fixture's
  layout; assert `≤` the golden count.
- `scripts/build.js` — esbuild: `dist/smv.esm.js` (external: `@dagrejs/dagre`? NO —
  bundle dagre into both; ESM stays importable standalone), `dist/smv.iife.min.js`
  (global `SparkleMotion`, minified). Also `dist/smv.core.esm.js` with dagre marked
  external — used only for the core-size metric.
- `scripts/size-budget.js` — builds, then gzip -9 sizes. HARD FAIL (exit 1) if:
  core (dagre-external, minified+gzip) ≥ 40KB, or IIFE min+gzip ≥ 56KB (dagre era,
  §8; tightens to 50KB at M3). Prints a table.
- CI: `.github/workflows/ci.yml` — npm ci, test, size (which builds).

---

# M1 contracts (expand/collapse · condense · tokens · storyboard · preset)

M0 is DONE and green (71 tests, e2e). Do not regress it. New rules of engagement:
scene.js/render.js/index.js/styles.js are edited ONLY by the agent explicitly assigned
to them in its prompt; everything else is new files.

## Scene extensions (owned by the compound/condense agent)

- `opts.exitTo: {id:{x,y}}` — exiting nodes tween toward this point (w/h shrink to 60%)
  while fading, instead of fading in place. Used by collapse (children → container
  centroid) and condense converge.
- Per-op easing: node ops accept `opts.easeOverride: {id: fn}` so the condensed target
  node can enter with `EASE.overshoot` while everything else runs the commit easing.
- Both are additive; existing tests must stay green.

## `src/viewstate.js` — expand/collapse + meta-edges (D5)

```js
createViewState(store) → vs
vs.collapsed            // Set<id> (initialized from node.collapsed === true for nodes that have children)
vs.isContainer(id), vs.isVisible(id)
vs.expand(id), vs.collapse(id)     // mutate the set only; relayout happens in index.js
vs.view() → { nodes, edges, sizes, meta }
```

- `view()` output plugs into the existing `layout()` seam:
  - visible node = every ancestor expanded. Expanded containers appear WITH `parent`
    links on their children (dagre compound reserves the space — that is the dagre-era
    implementation of D5's four-step; containers get `containerPad` {top:28 for the
    header strip, side:12, bottom:12} passed via node w/h handling in dagre's cluster
    result).
  - collapsed container = plain node sized by `sizeNode` + room for a ×N badge.
  - meta-edges: an edge whose endpoint is hidden re-attaches to the nearest visible
    ancestor; parallel meta-edges (same src→tgt) dedupe into id
    `meta:<src>-><tgt>` carrying `weight` = count; self-referential results
    (both endpoints map to the same container) drop; a loop wholly inside a collapsed
    container becomes `meta.loopBadge = {containerId, max}` instead of an edge (D3).
  - `meta` = { metaEdges: Map<metaId, {sources:[edgeId], weight}>, loopBadges: [{id, max}] }.
- index.js gains `g.expand(id)` / `g.collapse(id)` returning the commit awaitable;
  expand passes `enterFrom` = container's previous center for entering children;
  collapse passes `exitTo` = container's new center. Events "expand"/"collapse".
- Renderer: containers render as `.smv-node[data-container]` (label in the header strip
  top-left, not centered; children drawn after parents — sort by containment depth);
  meta-edges get `data-weight` when weight>1 (badge via preset/CSS).

## `src/condense-anim.js` — condense choreography (D6), owned by the same agent

`runCondense(g, internals, ids, newNodeSpec)` sequencing on the shared ticker
(total ≤900ms; reduced-motion: each phase ≥1ms, sequencing preserved):
1. highlight ~150ms: sources get `data-condense="src"` (CSS glow) — no geometry change.
2. converge ~450ms: `store.condense()` then relayout commit with `exitTo` = the merged
   node's new center for the removed sources, `enterFrom` = centroid of the sources'
   previous rects for the merged node, `easeOverride` = overshoot for the merged node.
3. reveal ~300ms: merged node `data-condense="reveal"` pulse class, removed after.
Emits `condense` {sources, target, sourceData, targetData} on phase 2 start (C12 — core
never reads durations). `g.condense(ids, spec)` returns an awaitable resolving after
phase 3 (canceled:true if interrupted).

## `src/run.js` — token engine Mode A (D4), PURE (no DOM, no imports from render/index)

```js
parseDuration("2h"|"45m"|"8s"|"300ms"|number(sec)) → seconds | null
compileRun(spec, opts) → sim
```

- `spec` = a `store.spec()` snapshot. `opts = { iterations?: {[edgeId]: n} (≤ maxIterations),
  rates?: [{t, scope: nodeId|'*', factor}], hopMs=300, dwell?: (sec|null, ctx) => ms }`.
- Default pacing: `dwellMs = 300 + 1200 * (sec / maxSecInGraph)`, 600 when the node has
  no `data.duration`. Rates: a token entering node X multiplies its inherited rate by
  every applicable rate event; rate divides dwell AND hop times for that token's branch
  (children inherit). `scope:'*'` is global speed. Rate factor 0 freezes (used by
  step({token})).
- Semantics: source nodes (no in-edges, loop edges excluded) start with one token at t=0.
  A node completes → spawns one child token per non-loop out-edge (implicit fan-out).
  `join: "all"|"any"|{count:k}` on a node: dwell starts when the policy fires
  (expected = # non-loop in-edges); later arrivals emit `drop` (ghost-fade). Loop edge
  `loop:true` A→B: token finishing A with iterations remaining traverses the arc ONCE
  visually (iteration 1), then per further iteration a compressed in-place tick
  (250ms/iter, no re-fly — D4) emitting `loop` {edgeId, iteration, max}; after the final
  iteration the token proceeds through A's normal out-edges. Iterations =
  `opts.iterations[edgeId] ?? maxIterations`.
- `sim = { duration, events, boundaries, stateAt(t), nextBoundary(t, tokenId?) }`
  - `events`: time-sorted `[{t, type: 'enter'|'start'|'finish'|'spawn'|'join'|'drop'|'loop'|'done', …}]`.
  - `stateAt(t)` → `{ tokens: [{id, rate, at: {kind:'node'|'edge', id, progress}}],
      nodes: {id: {status:'pending'|'active'|'done', progress, occupancy}},
      edges: {id: {traversed: 0..1}},
      joins: {nodeId: {arrived, needed, fired}},
      loops: {edgeId: {iteration, max}}, done }`
    Pure O(events) worst case is fine at our scale; make it deterministic.
- `speed()`/`step({token})` are implemented by the TRANSPORT (below) as rate events +
  recompile (cheap at tens of nodes); `nextBoundary(t, tokenId?)` supports `step()`.

## `src/run-transport.js` + `src/run-render.js` — wiring (integration agent)

- `g.run(opts)` → `run = { play, pause, playing, seek(ms), time(), speed(f, {branch}?),
  step(opts?), on/off, state() (=stateAt(now)), duration, destroy, promise }`.
  Driven by the shared ticker; `play({until: nodeId})` pauses when that node's status
  becomes done (storyboard uses it). Recompiles via compileRun on speed/step; preserves
  current virtual time. Emits 'join'/'loop'/'drop'/'done'/'tick'.
- `run-render`: subscribes to ticker + scene.visual; draws into `g.smv-tokens` layer
  (created after nodes): one pulse circle per token via `pointAt` on the CURRENT edge
  geometry (follows mid-transition edges), per-node progress fill (a rect inset behind
  the label, width = progress), occupancy `×n` badge, join slot pips `k/n`, loop badge
  `iter i/n` near the loop arc / on the container (viewstate loopBadges), traversed-edge
  `data-traversed` + `--smv-traversed` custom property. All from `stateAt(t)` inside the
  single rAF (never per-token WAAPI). Token↔morph rule (D4): on `condense` involving
  token-holding nodes the engine recompiles against the new spec; tokens remap to the
  merged node carrying max(progress); tokens on removed nodes ghost-fade.

## `src/storyboard.js` (pure sequencer) + `src/transport.js` (DOM bar)

- `createStoryboard(host, steps)` where `host = { apply(step) → {promise?|run?},
  snapshot() → any, restore(snap) → promise, }`; steps = the JSON op array (§5.5), ops:
  `addNode|addEdge|removeNode|removeEdge|update|expand|collapse|condense|batch|
   run.play (args or {until})|run.step|run.seek|wait {ms}`; `label` entries are
  zero-duration markers.
- Snapshot BEFORE each step (G2); `sb.seek(indexOrLabel)`: restore that snapshot →
  host.restore animates the diff from current visual state; then optionally replay to an
  intra-step run time. `sb.play/pause/next/prev/seek/labels/position/on`.
- index.js: `opts.storyboard` array + `opts.autoplay`; host implementation lives in
  index.js (snapshot = {spec: store.snapshot(), collapsed: [...vs.collapsed],
  runTime, runOpts}).
- `src/transport.js`: `createTransport(rootEl, controller)` — play/pause, step back/fwd,
  scrubber (input range over the storyboard's cumulative timeline; within a run.play
  step maps to run.seek), speed select (0.5/1/2/4), current label readout.
  `.smv-transport` fixed at the bottom of the mount root; `opts.controls: true` enables.

## `src/preset-pipeline.js` (own file; integration agent adds the single import)

`applyPipelinePreset(g)` — subscribes via public `g.on` + DOM adornments only:
- duration chip (top-right in-node `<text class="smv-chip">`) from `data.duration`;
  `durationAgg: 'sum'|'max'` rollup for containers/collapsed groups (G5).
- status glyphs via `data-status` CSS (clock/pulse/check), manual hand vs auto bolt badge
  from `data.mode`.
- on `condense`: odometer-roll the target's chip from aggregated source duration to the
  target duration (e.g. `2h → 8s`), pop a transient `−99.9% · N× faster` delta badge,
  update the total-duration bar (a slim bar under the graph, `.smv-totalbar`).
- Enabled via `opts.preset: 'pipeline'` or `SparkleMotion.presetPipeline(g)`.

## M1 exit (verify agent)

`demo/pipeline.html` — ONE script tag (`../dist/smv.iife.min.js`), a storyboard playing
§6 end to end: steps appear → token run with 3-way fan-out at visibly different rates +
`join:"all"` firing converge-burst → retry loop ticking to 3/5 → expand "clean" into 3
substeps → condense them into 1 automated step with the 2h→8s odometer → scrub backward
and forward cleanly. `?auto=1` exposes `window.__smvM1 = {done, errors, checks:{...}}`.
`test/e2e-m1.mjs` (playwright-core, chromium at /opt/pw-browsers/chromium) asserts:
zero errors; 3 concurrent tokens observed with distinct branch progress; join fires after
all 3; loop badge reaches 3/5; expand adds 3 substeps; condense leaves 1 node + odometer
text lands on "8s"; scrub to "before automation" restores the 3 substeps then scrub to
end re-condenses; no NaN anywhere.
