# smv internals — module contracts (M0/M1)

Read `docs/PLAN.md` first (decisions D1–D11). This file pins the internal interfaces so
modules developed in parallel compose. **Do not change a contract here without updating
every consumer.** Plain-JS ESM, no TypeScript, no framework. Browser-only APIs must be
guarded so every module *imports* cleanly in Node (tests run under `node --test`).

Naming: npm `sparkle-motion-visualizer` · global `SparkleMotion` · prefix `smv`
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
    implementation of D5's four-step; containers get `containerPad` {top:40 — the 28px
    header strip plus a 12px gap above the first child, matching the other three edges —
    side:12, bottom:12} passed via node w/h handling in dagre's cluster result).
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

---

# Post-review contract additions (M1 hardening)

- `anim.js`: `ticker.onDestroy(fn) → off` — teardown notification; any awaitable that
  suspends on the clock (condense phases, storyboard waits) must register one so
  `g.destroy()` settles it (resolving `{canceled: true}`) instead of stranding it.
- `run-transport.js`: `run.reset(opts, time)` — in-place re-seat (recompile + silent
  resync) preserving the transport's identity and listeners; used by storyboard restore.
- `storyboard.js`: generation counters (`stepGen`/`loopGen`) make play/pause/seek safe
  under interleaving; `seek()` always leaves the storyboard paused; the transport bar and
  `seekTimeline` pause before moving the head.
- `store.js`: exports `containmentClosure(store, ids)`; condense convexity + edge
  redirection judge the closure (children of condensed containers), and the synchronous
  guard in `index.js`/`condense-anim.js` asks the same question.
- Storyboard `host.snapshot()` carries `reversals: [...pinnedReversals]`; restore
  re-seats them (G2 fidelity: pins are part of the state a step moves).
- `run.js` runs `breakCycles` over its (container-remapped) edges: untagged back edges
  are zero-iteration loops — excluded from join arity and from token re-fly.

---

# M2 contracts (live mode · split · a11y · exports · labels · query · types)

M1 is DONE and green (200 tests, e2e-m0, e2e-m1, size budget). Do not regress it.

**File ownership (hard rule — a file is edited ONLY by its owner):**

| files | owner |
|---|---|
| `src/run-live.js` (new), `src/run-transport.js`, `test/run-live*.test.js` | live-mode agent |
| `src/store.js`, `src/split-anim.js` (new), `src/query.js` (new), `test/split.test.js`, `test/query.test.js` | split/query agent |
| `src/render.js`, `src/styles.js`, `src/viewstate.js`, `test/labels.test.js` | render-extras agent |
| `src/a11y.js` (new), `src/a11y-table.js` (new), `test/a11y.test.js` | a11y agent |
| `src/export.js` (new), `bin/smv-pack.mjs` (new), `docs/EMBED.md`, `test/export.test.js` | export agent |
| `src/index.js`, `package.json`, `README.md` | integration agent |
| `types/*.d.ts`, `docs/THEMING.md`, `scripts/*`, typescript devDep | types/docs agent |
| `demo/m2.html`, `test/e2e-m2.mjs` | verify agent |

All modules must import cleanly under Node (guard browser APIs); `node --test "test/*.test.js"`.

## `src/run-live.js` — Mode B engine (D4), PURE (no DOM)

```js
replayLive(spec, events, t, opts = {}) → state   // same shape as compileRun's stateAt(t)
liveBoundaries(events) → number[]                // sorted distinct event times (for step())
```

- `events`: append-only log, time-sorted (sort defensively on entry), entries:
  `{t, type: 'start'|'finish'|'spawn', id, n?}` — `t` in ms of live time.
  `start(id)`: node becomes `active`; it takes the token already waiting on the node, else
  the one still flying toward it (see below), else a fresh one is created (source/entry
  nodes). `finish(id)`: ALL tokens currently on `id` finish — node `done`,
  each token fans out one child per non-loop out-edge, traveling its edge over
  `opts.hopMs` (default 300) of live time, then WAITING at the target (target stays
  `pending` until its own `start`). `{t, type:'finish', id, n:k}` finishes only `k`
  tokens (k < occupancy leaves the node `active`). `spawn(id, n)`: place `n` additional
  waiting tokens on node `id` (runtime fan-out; occupancy badge ×n).
- **`hopMs` is a rendering travel time, never a gate on the feed.** A `start(target)`
  stamped before the inbound hop lands CONSUMES that hop (its edge fill truncates to the
  start instant, the wait collapses) instead of fabricating a second token and stranding
  the real one — a real pipeline whose steps hand off in under 300ms is the normal case,
  not an error. A landing that coincides exactly with a log event at the same `t` is
  ordered BEFORE it: the landing is caused by an earlier `finish`, so it is causally prior.
- `opts.bornAt` (Map edgeId → live ms, supplied by the transport): the log is history, so a
  `finish` stamped before an edge existed never fans out over that edge.
- Progress while `active`: `elapsed / declared-duration-estimate` clamped to 0.95 when
  `data.duration` parses (`parseDuration` from run.js); else 0 (status pulse carries it).
  Progress = 1 on finish.
- Joins (`join:` policy): arrivals counted exactly as Mode A — including saturating at
  `needed` (Mode A drops post-fire arrivals, so `arrived` never exceeds `needed`); but an explicit `start(id)`
  ALWAYS activates — the real log outranks the declared policy. `joins` map reported the
  same way. Loop edges (`loop: true`) never auto-fan-out; a repeated `start` of an
  already-done node re-activates it (that IS the live loop iteration) and increments
  `loops[edgeId].iteration` for its loop in-edge if one exists.
- Deterministic: same (spec, events, t) → same state. No wall clock inside; the caller
  owns time.

## `src/run-transport.js` — mode switch (live-mode agent owns this file)

`createRunTransport(internals, opts)` gains `opts.mode: 'simulate'(default) | 'live'`
and `opts.log` (initial event array, for re-seeding/tests). Mode A behavior unchanged
— every existing test must stay green. In live mode:

- The transport keeps a **frontier** clock: starts at 0 when the run is created (or at the
  span of a log it was seeded with, so seeded events are reachable at all), and
  advances with the shared ticker unconditionally (live time flows even while paused/
  scrubbed). `run.now() → frontier ms`.
- `run.start(id, {at}?)`, `run.finish(id, {at}?|{at,n}?)`, `run.spawn(id, n, {at}?)`
  append to the log stamped at `at ?? frontier` (clamped to ≤ frontier). Emits the same-
  named event.
- View time `t`: by default **follows** the frontier (`run.following === true`).
  `seek(ms)` clamps to `[0, frontier]` and detaches (time-travel replay); `play()`
  advances `t` at 1× (× global speed) and clamps at the frontier — you can NEVER scrub or
  play past `now`; on catching up it re-attaches (`following` true again). `follow()`
  re-attaches immediately.
- `duration` getter = frontier (grows). `state()` = `replayLive(store.spec(), log, t)`,
  memoized on `(t, store.rev, log revision)` — it is sampled every frame off the
  unconditional `tick`, and a full replay is O(events); the memo hands out a private copy,
  so callers may write into what they get.
  `step()` walks `liveBoundaries`. `speed(f,{branch})` in live mode: global `f` scales
  only replay playback (frontier is real time); per-branch is a no-op (documented).
  `run.log() → [...events]` (copy). `reset(opts, time)` re-seeds log from `opts.log`, and
  `options()` CARRIES that log — the pair is the storyboard snapshot/restore round trip
  (G2), which must not delete a live run's history.
- `play({until})` waits on the node's status in BOTH modes. In live mode the view clock is
  glued to the frontier by default, so `until` is consulted before the frontier — otherwise
  every `play({until})` from the normal following state resolves on the spot.
- Graph mutations hit the new spec lazily, as in Mode A, with two live-only rules the log
  forces (the log is history, not a re-simulation input):
  - `condense`/`split` on the host bus REWRITE the log — every entry naming a removed
    source is re-pointed at the survivor (a split's entry part) — so the merged/entry node
    inherits its sources' instants and re-fans over the redirected edges. `remap` is
    emitted afterwards, as in Mode A. Without this the `nodes.has(e.id)` filter in
    replayLive silently drops that history and `done` flips true mid-run.
  - an edge is stamped with the frontier when it is added, and a `finish` older than that
    stamp never travels it (no retroactive fan-out out of a node that finished long ago).

## `src/store.js` — `split(id, parts)` (D6 inverse; split/query agent)

`store.split(id, { nodes, edges = [] })`:
- `id` must exist and must NOT be a container with children (named `GraphError('split-container')`).
- `nodes`: ≥1 new node specs, ids unique and not colliding (`dup-id`); they inherit
  `parent` from the split node unless they specify one. `edges`: internal edges among
  the new nodes only (`split-edge` error otherwise).
- Entry nodes = new nodes with no in-edge in `edges`; exit nodes = no out-edge in `edges`.
  Every former incoming edge of `id` is redirected to EVERY entry node (first keeps its
  id, clones get `id + ':' + targetId`); outgoing likewise from every exit node. Weights:
  a redirected edge carrying `weight: N` keeps it. Self-loops on `id` are dropped.
  Internal wiring that leaves NO entry (or no exit) — e.g. a cycle spanning every new node
  — has nowhere to redirect to, so it is rejected up front with `GraphError`
  `split-no-entry` / `split-no-exit` (only when there is actually something to redirect),
  rather than deleting those edges and silently disconnecting their far ends. `g.split()`
  asks the same question synchronously, like every other split guard.
- The split node is removed. Returns `{ added: [nodeIds], addedEdges, removedEdges }`.
- Snapshot/restore must round-trip it (it composes from existing primitives).

## `src/split-anim.js` — split choreography (split/query agent)

`runSplit(g, internals, id, parts)` — mirror of runCondense, total ≤900ms, reduced-motion
≥1ms/phase with sequencing preserved:
1. highlight ~150ms: source gets `data-condense="src"` (reuse the glow).
2. diverge ~450ms: `store.split()` then relayout with `enterFrom` = the source's previous
   center for every added node (they bloom outward), `easeOverride` overshoot for them.
3. reveal ~300ms: added nodes get `data-condense="reveal"` pulse, removed after.
Emits `split` `{source, targets, sourceData}` on phase-2 start. Returns
`{promise, cancel}`; promise resolves `{canceled}`; must register `ticker.onDestroy`.

## `src/query.js` — query sugar (split/query agent), PURE

```js
makeQuery(store) → { nodes(filter?), edges(filter?), children(id), descendants(id), roots() }
```
- `filter` = predicate `(item) => bool`, or a match object: top-level keys compare `===`
  against the spec item; a `data` key matches shallowly against `item.data`.
  `nodes({ data: { status: 'done' } })`, `edges({ loop: true })`.
- Returns plain copies (same cloning discipline as `store.spec()`). `roots()` = nodes
  with no parent. `descendants` includes nested children, not the node itself.

## `src/render.js` + `src/styles.js` + `src/viewstate.js` — edge labels, collapseAll (render-extras agent)

- **Edge labels:** `edge.label` renders as `<text class="smv-edge-label">` inside the
  edge group, positioned per frame at `pointAt(clippedPoints, 0.5)` with a small
  perpendicular offset; content/truncation set at styleCommit only (D7). Labels do NOT
  affect layout (documented simplification — record in DEVIATIONS if judged material).
  Meta-edges: when a collapsed boundary edge aggregates ≥2 labeled edges the label drops
  (weight badge already carries the story). CSS: `.smv-edge-label` muted, 10px, paint-order
  stroke halo for readability, in styles.js.
- **`vs.containers()`** → array of container ids in containment-depth order (parents
  first). `vs.expandAll()` / `vs.collapseAll()` mutate the set only and return the ids
  that changed (index.js drives the single relayout).
- Existing tests + goldens must stay byte-green.

## `src/a11y.js` — ARIA + keyboard (a11y agent), core (ships in the IIFE)

```js
attachA11y(g, { root, svg }) → { destroy() }
```
- Called by index.js on mount (always on; `opts.a11y: false` opts out).
- Sets `role="application"` + `aria-roledescription="graph"` + `aria-label` on the svg;
  `role="tree"` on the nodes group; per node `<g>`: `role="treeitem"`, `aria-level`
  (containment depth+1), `aria-label` = `label · status`, `aria-expanded`
  on containers (true/false from viewstate), `tabindex` roving (-1 everywhere, 0 on the
  current item). Re-applied after every `commit` event (renderer reuses elements keyed by
  `[data-id]` — query the DOM, do not touch render.js).
- `status` in that name is the LIVE run status when a run is driving the node (the
  `data-run` attribute run-render.js owns), else the design-time `data.status` from the
  spec. Refreshed on the `runstatus` bus event, which fires per status transition (never
  per frame) — a run is not a spec mutation, so no `commit` would otherwise announce it,
  and a screen-reader user would get nothing at all while a run played.
- The roving `currentId` tracks REAL DOM focus: a `focusin` listener on the svg re-seats it
  whenever focus arrives by a route this module does not drive (a click on the `<g>`, an
  external `.focus()`, a screen reader's virtual cursor), or Enter/Space and the arrows act
  on a stale node. When a commit takes the focused node out of the visible set (its
  container collapsed, a condense merged it away), focus is re-homed onto the new roving
  stop — the browser would otherwise drop it on `<body>` once the element detaches.
- Decoration carries no accessible text of its own: the `g.smv-tokens` layer (run-render.js),
  edge labels and container chrome (stack/header/chevron/count badge) are all
  `aria-hidden="true"`; the owning treeitem's `aria-label` is the authoritative name.
- Keyboard (listener on the svg): ArrowRight/ArrowDown = next, ArrowLeft/ArrowUp = prev
  in **reading order** (layout rank order: sort visible nodes by x then y from
  `g.layoutResult()`), Home/End = first/last, Enter/Space = toggle expand/collapse on
  containers, focus follows with `.focus()` on the `<g>`. Focused node gets a CSS ring:
  a11y.js injects its OWN `<style data-smv-a11y>` (dedup-guarded) — do not edit styles.js.
- Emits `g`'s bus nothing new; calls public `g.expand/collapse` only.

## `src/a11y-table.js` — linearized fallback (ESM-only entry, a11y agent)

`attachA11yTable(g, { visible = false }) → { el, destroy() }` — appends a `<table>`
(caption, one row per visible node: label, status, duration, depth, outgoing targets)
after the svg inside the mount root; `visible: false` applies a visually-hidden clip
class (its own injected style). Updates on `commit`/`update` events. Package export
`sparkle-motion-visualizer/a11y-table`.
- The table and a11y.js's tree are two renderings of the same content, so exactly one is in
  the accessibility tree at a time: while the interactive tree is attached (the default)
  the table sets `aria-hidden="true"` and is a visual/structural fallback only; with
  `mount(..., { a11y: false })` it is the accessible surface. Re-checked on every render.

## `src/export.js` — exportSVG/exportPNG (ESM-only entry, export agent)

- `exportSVG(g, { pad = 24, theme, width }?) → string` — standalone SVG document:
  clone `g.renderer.svg`, strip transport/interaction cruft, set
  `viewBox` from `g.bounds()` + pad, inline the smv CSS (import `CSS` from styles.js and
  embed in a `<style>`) + resolved custom properties for the theme, `xmlns` correct.
  Pure string-building where possible so Node tests can cover it with a fake clone.
- `exportPNG(g, { scale = 2, background }?) → Promise<Blob>` — browser-only: SVG string
  → `Image` → canvas → `toBlob`. Rejects cleanly under Node.
- Package export `sparkle-motion-visualizer/export`. NOT in the IIFE (D11).

## `bin/smv-pack.mjs` — single-file HTML CLI (export agent)

`node bin/smv-pack.mjs spec.json [-o out.html] [--storyboard sb.json] [--title T]` —
emits ONE self-contained HTML file: inlined `dist/smv.iife.min.js` (built if missing —
just error with instructions, do not shell out), the spec JSON, a mount call with
`controls: true` + optional storyboard. `docs/EMBED.md` documents both the CLI and the
copy-paste recipe. package.json gains `"bin": {"smv-pack": "bin/smv-pack.mjs"}`
(integration agent applies the package.json edit; export agent documents it).

## `src/index.js` — integration agent

- `g.split(id, parts)` — synchronous guards (missing id, container check via store, dup
  ids) then `runSplit`; returns awaitable like condense.
- `g.expandAll() / g.collapseAll()` — drive `vs.expandAll/collapseAll` inside ONE
  relayout; enterFrom/exitTo per container center exactly like expand/collapse do;
  emit `expandAll`/`collapseAll` with `{ids}`.
- Query sugar: spread `makeQuery(store)` onto `g` (`nodes/edges/children/descendants/roots`
  — note: `g.node/g.edge` singular already exist and stay).
- a11y: `attachA11y` on mount unless `opts.a11y === false`; destroy on `g.destroy()`.
- `g.run({mode:'live'})` passes through (transport owns the branch). Storyboard op table
  unchanged (live mode is not storyboard-driven in v1 — document).
- package.json: exports `"./export"`, `"./a11y-table"`, `"bin"`, `"types"`.
- IIFE global additions: none beyond what index.js exports (export/a11y-table stay ESM).

## `types/` + docs (types/docs agent, AFTER integration)

- Hand-written `types/index.d.ts` (+ `types/export.d.ts`, `types/a11y-table.d.ts`)
  covering the public surface (mount opts, instance g, run A+B, storyboard steps,
  preset, errors). package.json `"types"` + per-export `"types"` conditions (the
  integration agent leaves placeholders; types agent fills the files).
- `npm run types` = `tsc --noEmit` over a `types/check.ts` exercising the surface
  (typescript pinned as devDependency; the check file is the test).
- `docs/THEMING.md`: every `--smv-*` property, every `data-*` attr, dark/light/auto,
  worked example. README: new API sections.

## M2 exit (verify agent)

`demo/m2.html` (one script tag → `../dist/smv.iife.min.js`, plus an ESM block for
export/a11y-table via `../src/`) + `test/e2e-m2.mjs` (playwright-core, chromium at
/opt/pw-browsers/chromium, pattern of e2e-m1) asserting, with `?auto=1` and
`window.__smvM2 = {done, errors, checks}`:
- **live**: scripted feed (start/finish×N, one `spawn(id,3)`) drives tokens; occupancy
  badge ×3 appears; `seek(pastT)` shows the earlier state (fewer done nodes);
  `seek(1e9)` clamps to `now()`; after `follow()` new events land.
- **split**: condensed→split round trip: 1 node becomes 3 with animated bloom; edges
  redirected; store round-trips.
- **labels**: an `edge.label` renders and tracks its edge through a relayout.
- **collapseAll/expandAll** flip every container in one transition.
- **a11y**: every node has `role=treeitem`; container toggles `aria-expanded`; ArrowRight
  moves focus (activeElement data-id changes in rank order); Enter expands a container.
- **exports**: `exportSVG` string contains a `<style>` + all visible node labels and
  parses as XML; `exportPNG` resolves to an image/png blob, decoded dimensions match
  bounds×scale.
- **no regression**: zero console errors; `npm test`, `npm run size`, e2e-m0, e2e-m1 all
  green.

## `src/interact.js` — tap-to-toggle (post-review M2 addition)

`attachTapToggle(g, {svg}) → {destroy}` — pointerdown resolves the `.smv-node[data-id]`
under the finger (before the viewport's setPointerCapture retargets the gesture);
pointerup toggles the container through public `g.expand/collapse` ONLY when the pointer
stayed within a 6px slop and no second pointer joined (pinch). Wired by index.js unless
`opts.interaction.tapToggle === false`; containers get `cursor: pointer`. Ships in the
IIFE.

---

# M3 contracts (in-house layered engine · dagre adapter · size · culling)

M2 is DONE and merged (351 tests, e2e-m0/1/2, size, types green). Do not regress it.

**File ownership (hard rule — a file is edited ONLY by its owner):**

| files | owner |
|---|---|
| `src/engine.js` + optional `src/engine/*.js` (new), `test/engine.test.js`, `test/engine-parity.test.js` | engine agent |
| `src/render.js`, `src/viewport.js`, `test/cull.test.js` | culling agent |
| `src/layout.js`, `src/adapters/dagre.js` (new), `src/index.js`, `package.json`, `scripts/*`, `types/*`, `test/golden/*`, `test/layout.test.js`, README, docs/DEVIATIONS.md | integration agent |
| `demo/*`, `test/e2e-m3.mjs` | verify agent |

## `src/engine.js` — the in-house layered solver (D2/M3), PURE, no deps

```js
engineSolve(input, opts) → { nodes: {id:{x,y,w,h}}, edges: {id:{points:[{x,y},…]}},
                             order: string[][], layers: string[][] }
```

- `input = { nodes: [{id, w, h, parent?}], edges: [{id, source, target}] }` with two
  invariants the caller (layout.js shell) guarantees: the edge set is **acyclic** (back
  edges already withheld) and **no edge touches a node that has children** (viewstate's
  entry/exit re-attachment, D5). Multi-edges (same endpoints, distinct ids) and
  disconnected components must work.
- `opts = { dir:'LR'|'RL'|'TB'|'BT', nodesep, ranksep, marginx, marginy,
  prevOrder?: string[][], prevLayers?: string[][], chromePad?: number }`. Implement
  internally for TB; transpose/flip for the others.
- Output: x,y are **centers**; container nodes (those that are some node's `parent`)
  get a rect covering their children (the shell's `padContainers` adds chrome after —
  engine padding just needs children strictly inside). Edge `points` include the bend
  chain (dummy positions), ≥2 points, running source→target. `order` = final per-rank
  id sequences (real nodes only) — the caller persists it and passes it back as
  `prevOrder` for order stability across re-layouts (the dagre `useDynamic` role).
- **`layers` is the other half of that channel, and it is not optional.** `order` names
  only the real nodes, and a drawing is *not* determined by those alone: every
  multi-rank edge's bends sit between them, and a container that spans a rank without
  holding anything there sits somewhere among them too. Re-deriving those on each solve
  made a re-layout start from a differently-scored arrangement than the one it was
  supposed to reproduce, so some sweep looked "strictly better" and ranks nobody had
  touched got reshuffled. `layers` = the same per-rank sequences with those items
  interleaved as opaque tokens; the caller persists it beside `order` and hands it back
  as `prevLayers`. **Contract: `engineSolve(g, {prevOrder, prevLayers})` fed its own
  output is a fixed point in `order`, `layers`, `nodes` AND `edges`.** A solver that
  cannot produce `layers` (the dagre adapter) omits it, and the shell degrades to `[]`.
- **`componentOrder` (opts) — `slot`, the primary in-rank ordering key, AHEAD of `pref`.**
  Disconnected components have no edges between them, so crossing minimization has nothing
  to say about their relative order and only `pref` (the previous drawing, read rank-major)
  holds them apart — which a rank shift in one component defeats: the whole component then
  carries keys smaller than its new rank-mates' and falls to the bottom, taking every id
  added afterwards with it. `opts.componentOrder` is an array of slots, each entry a node id
  or an array of alias ids; `assignSlots` (engine.js, straight after `indexInput`) does
  union-find over every id — every edge, every containment link, plus `opts.backLinks` —
  and hands each component the lowest entry index it holds an id for, `spec.length` if it
  holds none. Unknown ids are ignored. `g.slot` is the id→slot map, and every layout node
  carries a `slot`: a leaf its own, an edge dummy its source's, a border dummy its
  cluster's. It is enforced in exactly two places — `sortRank` (both the item sort and the
  sibling-block reassignment lead with `a.slot - b.slot`) and `transpose` (never swaps
  across two slots) — and it is a PRIMARY key, so no median, no crossing count and no
  previous order can move an item out of its band. **Inert when absent**: no
  `componentOrder` means `g.slot === null`, every slot is 0, every comparison above is a
  no-op, and the drawing is identical to one built without the feature. It is engine-only;
  the dagre adapter reads the opts it knows and ignores this one.
  The solve also EMITS `slots` (`{id: slotIndex}` over the real leaf/cluster ids) — just
  `g.slot` serialized — and only when the option was active, so a result built without it
  keeps exactly the shape it had. The engine stays pure: it remembers nothing between
  calls, it only hands the caller what it decided.
- `chromePad` is how much padding the CALLER will add around a container rect after the
  solve (layout.js passes its `CONTAINER_PAD`). The solver reserves it in the rank axis;
  without that the padded rect eats the neighbouring rank whenever `ranksep` is small.
- Passes (plan D2/M3, keep it the simple heuristic ON PURPOSE):
  1. **Nesting**: derive the cluster tree; constrain ranking so a cluster's nodes
     occupy a contiguous rank interval (nesting border ranks: reserve a top/bottom
     border rank contribution per cluster level, dagre-style, simplified is fine).
  2. **Ranking**: longest-path, then one tightening pass (pull every node with slack
     toward its tightest successor) so chains don't left-pack.
  3. **Dummies**: split multi-rank edges into unit spans; per-cluster border dummies
     per spanned rank so ordering keeps foreign nodes out of a cluster's interval.
  4. **Ordering**: init from `prevOrder` (append unknown ids in input order), else DFS;
     N≤8 alternating down/up **median** sweeps with transpose passes; **tie-breaks and
     equal-crossing decisions always prefer the previous order** (stability beats one
     crossing); keep the best-crossing result; cluster children stay contiguous within
     a rank (sort by cluster block).
     **A cluster's block order is global, not per-rank.** Which side of a sibling a
     container's block sits on is decided once, for every rank it spans; letting each
     rank pick from its own members lets a container sit left of a sibling on one rank
     and right of it on the next, and since the emitted rect is the union of the
     members' cells across all ranks, both siblings then get a rect spanning the whole
     drawing — each containing the other's children.
     **The search must be idempotent, not merely bounded**: it ends only once a full
     run of sweeps started from the best arrangement fails to improve on it. Stopping
     after a fixed sweep count leaves an order the next solve (which starts from that
     best) can still beat, which is the fixed point above breaking.
  5. **Coordinates**: rank axis = cumulative max-extent + ranksep; in-rank positions by
     a few median-alignment relaxation sweeps (parent/child barycenter) with minimum
     separation `nodesep` enforced left-to-right then right-to-left (priority: dummies
     straighten first). NO Brandes–Köpf (plan explicitly ships the simpler heuristic).
     Container chrome is **reserved, not assumed**: a border dummy is at least as wide
     as the padding the rect grows by, its distance from the rect edge is what the
     separation rule will demand of the first member inside, two nested borders are only
     the nesting step apart (charging them a whole node's gap makes the alignment
     targets unreachable at ≥2 levels and pools them instead), and the border-alignment
     loop runs until the rects stop moving rather than for a fixed number of passes.
     Two sibling containers whose rank spans overlap are grown to their common window,
     so the band each reserves exists on every rank that can put them side by side.
  6. Margins applied last; deterministic throughout (no Math.random, stable sorts).
- Determinism: same input+opts → identical output, byte for byte.
- Target ≤ ~10KB gzip alone. No imports beyond possibly `./cycles.js` helpers (should
  need none).

## `src/layout.js` — solver shell (integration agent)

`layout(view, opts)` keeps its exact public shape and gains `opts.solver` (defaults to
`engineSolve`), `opts.prevOrder` and `opts.prevLayers`; the result gains `order` and
`layers` (alongside `reversedEdgeIds`) for the caller to persist — both, together.
The shell also derives `opts.chromePad` from its own `CONTAINER_PAD` so the solver can
reserve the padding `padContainers` is about to add. It likewise derives `opts.backLinks`
(source/target pairs) whenever `opts.componentOrder` is an array: the edge set handed to the
solver is the ACYCLIC one, every cycle-broken edge withheld, so a solver judging
connectivity on it alone would tear a cyclic pipeline — or any component whose only link is
a `loop:true` edge — into two components and slot them independently. `backLinks` names the
withheld pairs so connectivity is judged on the real graph; the solver uses them for nothing
else. Both are written onto the shell's own merged copy of the opts, never the caller's. The
result passes the solver's `slots` straight through, key and all, or omits it.

**Sticky slots live in `src/index.js`, not the engine.** A spec entry can only name ids, and
the user who removes a pipeline's head has removed the id that named its slot — the
component would drop into the trailing unlisted band, which is the reordering the option
exists to prevent. So `relayout()` persists each result's `slots` (beside `prevOrder` /
`prevLayers`, snapshotted and restored with them for the same G2 reason) and hands it back
down as **`opts.componentOrderMemory`** (`{id: slot}`), filtered to ids the store still has,
resolved through any collapse, and never naming the trailing unlisted slot. `assignSlots`
applies it strictly AFTER the list and only to components no listed id claimed — memory is
a fallback, never a rival. It is deliberately NOT merged into the entries: a remembered id
folded into entry `i` would be seen first and silently beat the same id listed explicitly
in entry `j > i`, so an explicit re-slot after two components split apart would not take.
`reseat()` (the condense/split hook that already remaps `order`/`layers` through an id
change) remaps the memory too, so a condense that consumes every remembered id of a
component hands the merged node the lowest slot its sources held. The memory belongs to ONE
list: `relayout()` compares a JSON of the raw `componentOrder` against the one it memorised
and drops the memory whenever it changes (a non-array included).

Everything else in the shell (breakCycles
+ pinning, back-edge/self-loop arcs, `padContainers`, bounds) is UNCHANGED. The dagre
import is REMOVED from this file.

## `src/adapters/dagre.js` — optional ESM adapter (integration agent)

Exports `dagreSolver(input, opts)` (same solver contract, delegating to
`@dagrejs/dagre` exactly as the M2-era layout.js did — compound graph, multigraph,
rankdir mapping; returns `order` derived from dagre's result ordering) and
`dagreLayout(view, opts) = layout(view, {...opts, solver: dagreSolver})`.
Package export `"./adapters/dagre"` with a `types/adapters-dagre.d.ts`. `@dagrejs/dagre`
moves from `dependencies` to `devDependencies` + `peerDependenciesMeta` optional —
the IIFE and default ESM path must not pull it in at all.

## Culling (culling agent)

- `viewport.visibleWorldRect(pad = 200)` → world-space rect currently on screen.
- `renderer.setCull(fn|null)` — when set, `frame(visual)` skips geometry writes AND sets
  `display:none` (via a `data-culled` attr + CSS is fine) for node/edge groups fully
  outside `fn()`; entering/exiting the rect restores them. Only engage when
  `visual.nodes.size + visual.edges.size > 150` (below that the check costs more than
  it saves). Token layer (`run-render`) reads positions from `scene.visual` — culling
  must not corrupt tokens whose node is culled (skip drawing their pulse when outside).
- index.js wires `renderer.setCull(() => viewport.visibleWorldRect())` after mount and
  re-arms from **`viewport.onChange`**, not from the svg's pointer events (integration
  agent). "Pan/zoom" includes `g.fitView()`, `viewport.zoomBy()`, the anchored
  correction and every tick of their tweens — none of which fire a pointer event, and
  all of which used to leave whatever the previous transform had hidden hidden for good.
- Culling is live-DOM state, so anything that reads the live DOM has to account for it:
  - `export.js` clones the live svg, so it **clears `data-culled`/`display:none` on the
    clone**. A standalone export always draws the whole graph its viewBox claims.
  - `a11y.js` never parks the roving tabindex on a culled group: `.focus()` on a hidden
    element is a silent no-op, so committing `currentId` there strands real focus on the
    element just demoted to `tabindex="-1"`. Arrow/Home/End walk the focusable subset.

## Gates & budget (integration + verify)

- `scripts/size-budget.js`: IIFE limit tightens **56 → 50KB** gzip (plan §8 M3 public
  commitment); core stays 40KB.
- Goldens: regenerate via `node test/golden/update.js` (intentional layout change).
  “Parity” gate = structural invariants + crossing non-regression, recorded as such in
  DEVIATIONS (coordinate-identical parity with dagre is not a meaningful target):
  - every forward edge strictly advances along the rank axis;
  - no two visible sibling nodes overlap; children strictly inside container rects
    (post-padContainers);
  - per-fixture crossing count ≤ the recorded dagre-era count (extend
    `test/golden/crossing.js` fixtures with the dagre numbers as of M2, hard-coded);
  - back edges below the flow (LR), self-loops side arcs — unchanged shell behavior.
- `test/engine-parity.test.js` (engine agent): run BOTH solvers (dagre from
  devDependencies) over the fixture set + randomized-but-seeded graphs (~40: chains,
  diamonds, fan-out/in, multi-edges, disconnected, 2-level nesting, wide ranks);
  assert the invariants above for engineSolve and crossings(engine) ≤
  crossings(dagre) + 2 per fixture (small slack on non-goldens; goldens get ≤).
- Stability: appending one node to a 30-node fixture with `prevOrder` passed changes no
  existing rank's relative order (test).
- e2e-m3 (verify agent): flagship `demo/pipeline.html` narrative runs on the in-house
  engine (it does automatically once layout.js swaps) — assert the §6 storyline still
  passes (reuse e2e-m1's checks), plus: no dagre chunk in dist (grep the IIFE for
  "dagre"), pipeline stage order left→right matches the DAG, containers contain their
  children, no overlaps/NaN, and a 300-node synthetic graph mounts with culling active
  (fewer rendered-visible groups than total when zoomed in) at interactive frame cost.
- Compositor offload (plan: only if profiling justifies): verify agent profiles the
  300-node run; if median frame ≤ 8ms headless, record "not justified at v1 scale" in
  DEVIATIONS instead of building it. Gantt mode: skipped by default per plan (no
  demand); note in DEVIATIONS.

---

# M4 contracts (director ops: camera · highlight · caption · declared timeline)

M3 is DONE and green (435 tests, e2e-m0/1/2/3, size, types). Do not regress it. M4a lands
the core director ops (D12–D15 in PLAN.md, op shapes in §5.7); the deterministic frame
renderer is M4b and its plumbing (`opts.ticker/motion`, `data-smv-record`,
`setInteractive`) is landed here so M4b touches no core file.

## `src/director.js` — camera targeting + emphasis/caption state (D12–D14)

Same `internals`-taking contract as condense-anim.js: no renderer import, no global
document, runs against a fake host in tests.

```js
resolveCameraTarget(opts, layoutResult, size, current) → {x, y, k}   // PURE
createDirector(internals) → d
  internals = { root, lastLayout(), emphasize(id, value), dim(id, value), captions }
d.highlight(sel), d.clearHighlight(), d.caption(text, opts) , d.captionText()
d.reassert()                       // apply(force): rewrite every data-emph/data-dim
d.snapshot() → {emphasis, caption} / d.restore(snap), d.destroy()
```

- `resolveCameraTarget` resolution order, first match wins: absolute `x`/`y` (+`k`) →
  `node` → `nodes` (union box) → `fit:true` (layout bounds) → relative `zoom`/`k` +
  `by:{dx,dy}`. Boxes come from `layoutResult.nodes[id]` (centre-origin {x,y,w,h}); a box
  target centres it, `k` on it is explicit scale, else fit with `pad` (default 24). Bare
  `k`/`zoom` scale about the pane centre; `by` is a screen-px nudge applied after any
  zoom. Relative moves compose onto `current` — index.js passes `viewport.target`, the
  frame the move is written into, never a mid-tween sample (viewport.anchor's reasoning).
  Unknown node ids resolve to "stay put". Every derived `k` (fitted, explicit-on-a-box,
  `zoom`) is clamped to the viewport's own `MIN_K..MAX_K` BEFORE x/y are derived from it —
  `setTo` clamps `k` but copies x/y verbatim, so an unclamped fit would centre the shot at
  a scale the viewport never applies and land it off-screen by the clamp ratio. FIT_MAX_K
  is structurally absent from the camera path.
- Emphasis: `Map<id, variant>` + dim `Set`, replace-not-accumulate (D14). `apply()` diffs
  desired vs a `written` shadow (Map + Set) and writes only what differs;
  `apply(force)` clears the shadow first — that is `reassert()`, for elements the
  renderer just rebuilt. `highlight({dim:true})` dims every id the last layout drew
  (nodes AND edges) that is not emphasised.
- Caption: lazily-created `div.smv-caption` on the mount root (transport.js pattern),
  `role="status"`, never `aria-live="assertive"`; `data-place`/`data-variant` attrs.
  Inert with no document. `internals.captions === false` suppresses the DOM only: the
  caption stays state — snapshotted, restored, readable via `captionText()` for cues.

## `src/viewport.js` additions

```js
vp.fit(bounds, {pad=24, duration=0, ease, maxK=FIT_MAX_K}) → Promise<{canceled}>
vp.fit(bounds, pad, animate)              // M0 spelling still works (object-vs-scalar sniff)
vp.moveTo({x?,y?,k?}, {duration=0, ease}={}) → { promise, cancel }
vp.setInteractive(bool)                   // attach/detach ALL pointer+wheel listeners
vp.size() → {w, h}
vp.target                                 // getter: where a live tween is heading, else state
```

- **`stopTween(canceled)` settles the tween's promise on every exit path** — landing,
  retarget, `setNow`, destroy, clock teardown. Through M3 it dropped tweens silently;
  that would strand `moveTo`'s awaitable (D9: a canceled move resolves `{canceled:true}`).
  A `ticker.onDestroy` subscription covers the clock being torn down under a live tween
  (`g.ticker` is public).
- `tick()` uses the tween's own `ease` (default still cubicOut). `fit`'s `maxK` overrides
  the FIT_MAX_K=1.5 auto-fit lid (`MAX_K`/`FIT_MAX_K` now exported). No
  `prefersReducedMotion()` in this file — index.js owns `reduced` and passes the duration.

## `src/render.js` + `src/styles.js` + `src/storyboard.js`

- `r.emphasize(id, value)` / `r.dim(id, value)` — lookup in nodeEls then edgeEls, write
  `data-emph` / `data-dim` on the group. NOT folded into `mark()`: `data-condense` is the
  condense choreography's channel and a highlight outliving a merge must not fight it.
- CSS: `[data-emph]` variants (focus/warn/ok/mute) via a `--smv-emph` indirection over the
  existing color vars; `.smv-node[data-dim],.smv-edge[data-dim]{opacity:.28}` (scoped, so
  it can't leak onto host markup — the opacity property beats the per-frame presentation
  attribute); `.smv-caption` with `data-place`/`data-variant` and a `.smv-has-transport`
  bottom offset mirroring `.smv-totalbar`; the `[data-smv-record] *` transition/animation
  kill-switch (D15). No transitions on any of it (D14).
- storyboard.js: `"camera" | "highlight" | "clearHighlight" | "caption"` join OPS and
  NAMED — method-shaped, so applyStep's default branch dispatches them.

## `src/index.js` — the director surface

- `g.camera(o) → Awaitable` — `resolveCameraTarget(o, last, viewport.size(),
  viewport.target)` → `viewport.moveTo(to, {duration, ease})`. Duration:
  `stepDur ?? o.dur ?? 600` — step-first, the same order `durOf()` reads, so a step
  declaring both durations cannot play at one length and be measured at the other —
  reduced → 1, forward-scrub `instant` → 0. Ease: string key
  into EASINGS, default cubic-in-out. First call sets `cameraOwned = true` AND
  `viewport.userMoved = true` (reuses the auto-refit suppression signal, D13).
  Deliberately not routed through `viewport.fit()` — see the FIT_MAX_K note above.
- `g.highlight(sel)` / `g.clearHighlight()` / `g.caption(text, o?)` — thin delegates to
  the director; return `g`.
- `g.cues() → [{kind:"label"|"caption", at, label?, text?, index}]` — absolute ms offsets
  off the same `durOf()` table the scrubber reads (D12); truthful under `captions:false`.
- **`durOf(step)`** replaces NOMINAL_STEP_MS: `step.dur` wins; else label 0, wait its ms,
  camera `args[0].dur ?? 600`, highlight/clearHighlight/caption 0 (`props` joined the
  zero list in M4d), `run.step`/`run.seek` 0
  (instantaneous: nothing to await), condense/split `CHOREO_MS` (the CONDENSE_PHASES sum,
  900), batch max of members (one commit, parallel), default `baseDuration`.
  `run.play` slices still come from the run's own clock.
- **`stepDur` ambient (D12):** `applyStep` saves/sets `stepDur = step.dur ?? null` around
  the op and restores after (a batch's `dur` survives its children); `relayout` reads
  `duration ?? stepDur ?? baseDuration` (reduced → 1). Every mutation op gains per-step
  pacing with zero signature churn.
- **Snapshot gating (D13):** `host.snapshot()` always spreads `director.snapshot()`
  (emphasis + caption, D14); `camera: viewport.target` + `userMoved` join it ONLY when
  `cameraOwned` — set at `buildStoryboard` time by `hasCameraOp(steps)` (batches
  recursed), because the step-0 snapshot is taken before any op runs. `restore()` drives
  the camera AFTER `relayout()` returns, at duration 0 (relayout's anchor/auto-refit has
  just written the viewport synchronously), then `director.restore(snap)`.
- **Reassertion:** `bus.on("commit", () => director.reassert())` — render.js builds a
  fresh `<g>` for a re-added id, so a commit reviving an emphasised node hands back a
  blank element.
- **Forward scrub:** `seekTimeline` raises a `scrubDepth` counter (a depth, not a boolean:
  a drag seeks on every `input`, so scrubs overlap and an earlier one settling must not
  lower the flag under a newer replay); `applyStep` snaps ONLY the
  four director ops to `instant` (duration 0). Mutations keep their real timing —
  test/e2e-m3's scrubForward leans on the condense choreography; widening is a
  deliberate later decision.
- **Record plumbing (D15):** `opts.ticker === "manual"` → `createTicker({manual:true})` +
  `data-smv-record` on the root; `opts.motion === "full"` → `reduced = false`;
  `opts.captions` → director. `g.ticker` is public. `fitView` and relayout's auto-refit
  pass the reduced-computed duration into `fit`'s opts form (through M3 that tween ran a
  flat 350ms whatever the environment asked).

## M4b (deterministic frame renderer) — landed

`bin/smv-record.mjs` + `scripts/harness.mjs` + `test/e2e-m4.mjs`. Everything the renderer
needs was already public after M4a — manual ticker, `motion:"full"`, `data-smv-record`,
`setInteractive(false)`, `g.ticker`, `g.scene`, `g.viewport`, `g.timeline()`, `g.cues()` —
so M4b is all `bin/`, at no cost against the size budget. The one core change it forced is
in `applyOp`/`durOf`: a batch step now awaits its children's awaitables alongside the shared
commit, and `durOf('batch')` stops counting a child `dur` that playback ignores (see D12).
Without it a heterogeneous batch put every later step — and every cue offset after it —
~450ms ahead of the cue sheet the frame renderer shares.

- **`scripts/harness.mjs`** — `findChromium()` / `serveRoot(root = ROOT)` / `ROOT`. The
  four e2e scripts each carried a byte-identical private copy; they now import this one.
  `serveRoot` gained the `root` parameter (default: the repo) because the recorder serves
  a temp directory holding one packed page, not the checkout.
- **`bin/smv-pack.mjs --record`** — the D15 mount variant: `{controls:false,
  captions:true, autoplay:false, ticker:"manual", motion:"full"}` (+ `--theme`), and
  `window.__smv = SparkleMotion.mount(...)`, the CLI's only handle into the page. Autoplay
  is deliberately OFF: the recorder starts the story itself, after `document.fonts.ready`
  and after the interaction interlock, so frame 0 is the same frame every time. Without
  `--record` the emitted bytes are unchanged (asserted in test/record-cli.test.js).
- **`bin/smv-record.mjs`** — pack → serve → chromium at `{width, height,
  deviceScaleFactor: scale}` → `document.fonts.ready` (text metrics decide node boxes, so
  the layout is only reproducible once the fonts are) → `viewport.setInteractive(false)`
  → measure `timeline()`/`cues()` → `storyboard().play()` → per frame:
  `ticker.tick(frameMs)`, settle, `page.screenshot({clip: root box})`.
  Defaults: fps 60, 1920×1080 @2x, tail 1200ms; `--png-dir` clears stale `frame-*.png`
  first. `parseArgs` and `findLiveRun` are exported so test/record-cli.test.js covers the
  flag grammar and the Mode B check without a browser.
- **Measuring a `run.play` story.** `stepSlices()` prices a run step off the run
  transport's own clock, and that transport only exists once a `run.*` op created it —
  but the record pack does not autoplay, so at measuring time it does not. Measuring first
  therefore priced a whole simulated run at one mutation's `baseDuration` and cut the take
  off inside step 1, at exit 0. So when the storyboard contains a `run.play` (batches
  walked), the CLI calls `g.run()` in the same evaluate, before `timeline()` — exactly what
  `applyStep`'s `ensureRun()` does at the step. It also creates the token layer at frame 0,
  which is a deliberate, visible change to frame 0's pixels.
- **How long a take is.** The declared timeline is the **floor**, not the cut. Each async
  phase boundary resolves on the first tick at or past its duration and the next phase's
  `t0` is that tick, so a story of N boundaries runs up to N frames past `timeline().total`
  (condense's highlight/converge/reveal chain ends ~58ms past its declared 900ms). Cutting
  at `ceil((total + tail)/frameMs)` dropped the end-of-choreography state flip — with
  `--tail 0` every written frame still carried `data-condense="reveal"` — and spent the
  tail on the overrun instead of on the finished picture. The loop therefore shoots at
  least `ceil(total/frameMs)` frames, then keeps going while `stepFrame` reports the story
  unfinished (`storyboard().position().done` and no live `scene.transition`), capped at
  2000ms past the declared total (a warning on stderr if that cap bites), and only then
  writes `ceil(tail/frameMs)` held frames. Still wall-clock-free: every bound is ticks.
- **Settling.** A step boundary lands on a promise chain (a transition resolving hands the
  storyboard its next op), never on a timer, so one macrotask turn drains everything the
  tick released. The loop turns at least 2 times (one drains, one proves nothing new was
  queued) and at most 8, stopping as soon as the observable signature —
  `timeline().index/time/steps`, the live transition, `viewport.transform` — repeats. Frame 0 is `tick(0)` + settle: play()'s first ops land, the clock does not move.
- **Refusals.** Mode B is rejected before the browser launches — a live run replays a real
  event log against real time. The check is scoped to a `run.play` step's own options
  (`{op,args:[{mode}]}` or `{op,mode}`, batches recursed): node/edge `data` is an arbitrary
  user payload the store preserves verbatim and `data:{mode:"live"}` is this project's own
  pipeline idiom, so a deep walk refused perfectly recordable Mode A stories. (M4b also
  owed the user a message for `--out` with no encoder behind it; M4c wired the pipe, and
  that message is now only the genuinely-no-ffmpeg case — see below.)
- **Direct-invocation guard.** Both bins compare `import.meta.url` against
  `pathToFileURL(realpathSync(process.argv[1]))`, not against `` `file://${process.argv[1]}` ``:
  npm installs `bin.smv-record` as a symlink (argv[1] is the link, `import.meta.url` the
  realpath) and a space in the path is percent-encoded on one side only. Either divergence
  made the documented `npx smv-record …` invocation a silent no-op at exit 0.
- **Cleanup.** The mkdtemp serve directory holds the whole packed story (spec + the 128KB
  IIFE), so it is created *inside* the try that also opens the browser: the paths the code
  explicitly anticipates — no playwright-core, no chromium binary, a launch that rejects —
  used to leak a copy of it per run. The finally is guarded, since it can now run before
  the server and browser exist.
- **e2e-m4** renders the fixture (`test/fixtures/record-demo.{spec,sb}.json`: camera,
  highlight+dim, captions, condense, labels) twice at 10fps/480×270 and asserts every frame
  is byte-identical across the two takes, that the frame count is at least the declared
  timeline's (2900ms + 200ms tail) and within one frame per step boundary of it, that the
  last two frames are identical (the tail holds a *settled* picture), that a `run.play`
  story is measured at the compiled run's duration rather than 350ms, and the refusals.

## M4c (publishing: mp4, cue sheets, ranges, pinned fonts) — landed

Still all `bin/` except one ESM-only export path, so still zero bundle cost. What M4b
rendered, M4c publishes: `--out story.mp4` (the ffmpeg pipe), `--cues` (three formats),
`--from/--to` (one chapter), `--font` (cross-machine layout), and
`exportSVG(g, {viewport:true})` (the matching still).

- **`--out` / the ffmpeg pipe.** One long-lived
  `ffmpeg -y -f image2pipe -framerate <fps> -i - -c:v libx264 -pix_fmt yuv420p -crf 18 <out>`
  reading screenshots off stdin, so no intermediate sequence is written and `--png-dir` is
  no longer on the critical path. `page.screenshot()` now returns the buffer instead of
  taking a `path`, and the two outputs are *sinks*: `--out`, `--png-dir`, or both. Three
  things the pipe has to get right, all of them load-bearing: **backpressure** — a 4K frame
  is megabytes and the encoder is slower than the capture loop, so a `write()` that returns
  false is awaited to `drain` or the whole take buffers in RSS; **a dead encoder** — every
  wait races the child's `close`, or a drain that will never come hangs the CLI; and
  **why** — ffmpeg's own stderr is the only thing that knows, so the last 12 lines are kept
  and surfaced on a nonzero exit. Failure aborts with SIGKILL, not SIGTERM (a terminated
  ffmpeg finalizes what it has, and half a story that looks whole is worse than no file)
  and unlinks the partial output; the sinks join the existing single `finally`.
  `$SMV_FFMPEG` overrides the binary, which is also how the tests exercise the
  no-encoder path on a machine that has one.
- **Ctrl+C is a path the `finally` does not cover**, and it is the way a long take normally
  ends early. A terminal delivers the signal to the whole process *group*, so ffmpeg used to
  get it first-hand, finalize what it had, and leave a valid, playable 0.4s clip of a 3.4s
  story — the finalized half-story the abort path exists to prevent — while node exited
  through playwright's own handler without unwinding anything (the mkdtemp serve dir leaked
  too). Three pieces: ffmpeg is spawned `detached` (its own group, so only the recorder ever
  decides that file's fate; deliberately not `unref`'d, or `closed` would stop resolving),
  chromium is launched with `handleSIGINT/SIGTERM/SIGHUP: false` (playwright's handlers
  `process.exit()` out from under both the finally and ours), and `record()` registers one
  handler per signal that does what the finally does — but **synchronously**, since a
  handler that awaits races process exit and can lose. Hence `sink.abortSync()` beside
  `abort()`: `child.kill("SIGKILL")` + `rmSync(out)` with no await in between. Exit 130 for
  SIGINT, 143 for SIGTERM, one stderr line naming what was removed and what survived
  (`--png-dir` frames are individually complete — that is the salvageable take). The
  handlers come off in the finally so an importing test is not left holding them.
- **`--cues` (`bin/cues.mjs`).** Formatting lives in `bin/` — a subtitle serializer is a
  publishing concern the 50KB budget should not pay for — and imports nothing from `src/`.
  The extension picks the format so a filename cannot lie: `.json` is `g.cues()` verbatim
  plus render metadata (`fps/width/height/scale/total/range`), `.srt` turns captions into
  spans (each runs to the next caption, a `caption(null)` clear, or the story end) timed
  `HH:MM:SS,mmm`, `.txt` is a YouTube chapter list off the labels. The two text formats
  annotate the *media file*, so a `--from/--to` take clips and rebases them onto the range
  (and pins the first chapter to `00:00`, or YouTube drops the list); `.json` stays on the
  story's clock and carries `range` to rebase with. Written *before* the frame loop: it is
  a function of the declared timeline alone, so an interrupted take still leaves one.
  The media is longer than the story, which the `.srt` has to know: the recorder passes
  `mediaEnd = total + tailFrames·frameMs` (equal to `total` under `--to`, which spends no
  tail) and that, not `total`, closes the last open caption span. Otherwise a caption issued
  as the story's **last** step — captions are zero-duration ops, so it sits at exactly
  `total` — becomes the span `[total, total)`, which `clip()`'s `!(end > start)` guard drops
  as a same-frame replacement, while the pixels show it for every frame of the tail. The
  guard is right; the span's end was wrong.
- **`--from/--to`.** Labels → absolute ms through the same cue sheet (D12) → frame indices
  (`ceil(ms/frameMs - 1e-9)`; the epsilon is float hygiene — `600/16.666…` lands a hair
  under 36 and would otherwise cost a whole frame). Capture starts at `--from`'s frame and
  ends on the first frame at or past `--to`, inclusive; a `--to` take spends no tail (the
  story is not finished there). The story is **not** seeked: the take plays from step 0
  with the identical tick cadence and only the capture window moves. A seek would replay
  director ops instantly and skip the tweens they were meant to leave behind — the first
  frame would show a state the story never held. Label *existence* is checked against the
  storyboard file before a browser launches; the offsets come from the page, because a
  `run.play` step's length depends on a compiled run only the browser can build.
- **Skipped frames still get a compositor frame.** Measured, not assumed: fast-forwarding
  by ticking without capturing made the first captures after the gap differ from the same
  frames of a full render — ~92dB PSNR, a few antialiased pixels, only on frames inside a
  camera tween. The JS state is identical (the ticks are); the raster is not, because a
  screenshot forces a paint and shooting every frame leaves Skia somewhere else than
  shooting one in eight. One `requestAnimationFrame` round-trip per skipped frame restores
  the cadence at a fraction of a screenshot's cost and makes a slice byte-identical to the
  full render's matching frames — which is the only reason to render a range separately.
- **`--font`.** The face is copied next to the served page (relative URL, same origin —
  not a data: URI in a file that already carries the spec and the 128KB IIFE) and
  `buildHTML` grows a record-only layer: `@font-face` + a `font-family` override, and the
  mount is deferred behind `document.fonts.load(...)` because node boxes are measured
  *during* mount. It pins both pipelines. CSS alone pins only what is drawn: `system-ui`
  is a generic family keyword `@font-face` may not redefine, and `src/measure.js` sizes
  every node box with canvas `measureText` against `500 13px system-ui, …`. So the record
  page also patches the 2D-context `font` setter to swap the family list for the injected
  face — scoped to this generated harness page, and the difference is visible: pinning
  Liberation Serif moved the fixture's node widths from 41/47/49/45px to 36/41/43/41px.
  Without it `--font` would restyle the glyphs while the *layout* stayed machine-dependent,
  which is the one thing the flag exists to fix. **The pin is verified**, because failing to
  apply it is silent: `document.fonts.ready` resolves for a face that errored, smv-pack
  mounts on `.then(go, go)` by design, and chromium reports a decode failure as a console
  *warning*, which the pageErrors collector does not keep — so a bad face used to render a
  whole take at exit 0 in the machine's default font. Two checks: the file's first four
  bytes must agree with its extension (`wOF2`/`wOFF`/`OTTO`/`\x00\x01\x00\x00`/`true`/`ttcf`
  — the two sfnt flavours are one bucket, since CFF outlines in a `.ttf` decode fine, while a
  WOFF2 named `.ttf` makes the injected `format("truetype")` hint skip the src), which
  catches the everyday git-lfs-pointer and renamed-file accidents before a browser launches;
  and after the mount, the page is asked whether a face of that family reached it and
  decoded (`status === "error"` tells "failed to decode" apart from "never asked for"),
  which catches a truncated but correctly-signed file. The second check is inside the take's
  try, so the sinks abort and no truncated mp4 survives the refusal.
- **`exportSVG(g, {viewport:true})`** (`src/export.js`, ESM-only entry, not in the IIFE).
  Keeps the live `.smv-viewport` transform AND the live culling state, with the pane as the
  `viewBox` (`g.viewport.size()`, falling back to the element box, then 800×600) and `pad`
  ignored. Both are deliberate inversions of the default path, and the code says so: the
  defaults exist because a whole-graph document showing only what was on screen is a bug
  (a near-empty file whenever the user was zoomed in), while shot mode asks for the
  opposite document, where the transform *is* the framing and culled elements are by
  definition outside it. Un-culling there would add nothing visible and pour every
  off-screen node into a document that clips them anyway. Change one, change the other.
- **e2e-m4 (M4c half)** probes a real mp4 (h264 stream, `nb_frames` equal to the frames the
  take shot, duration = frames/fps), reads back `cues.json`, renders `--from focus --to
  automate` and asserts all 8 frames are byte-identical to frames 7–14 of the full take
  with the chapter file rebased onto the slice, and renders `--font` twice (identical to
  each other, different from the unpinned take — the only proof from outside the page that
  the face reached both the drawing and the measurement), asserts a story whose last step is
  a caption keeps that caption in the `.srt` (held for the tail), and interrupts a take
  mid-flight with a real process-group SIGINT to prove the mp4 is gone, the exit is nonzero,
  the `--png-dir` frames survive and no serve dir is left behind. ffmpeg and a pinned font
  file are environment, not contract: those sections **skip with a printed notice** rather
  than fail when the machine has neither. The ffmpeg gate probes `-encoders` for `libx264`,
  not just `ffmpeg -version`: the pipe hardcodes `-c:v libx264`, and a build without it
  (Fedora/RHEL `ffmpeg-free`) answers `-version` perfectly well and then fails the encode —
  which is an environment the recorder cannot fix, so it must skip, with the reason named.

## M4d (voice-over fitting · property overrides · the pulse) — landed

The half of the loop M4c left open. `--cues` tells a narrator *when* each beat is; M4d
takes the timestamps the read actually landed on and moves the story to them. Plus the two
small core additions the milestone reserved: a per-step `--smv-*` override layer (D16) and
an emphasis pulse (D17). Both stay inside channels that already exist, and together they
cost ~0.6KB gzip of the core budget.

### `bin/smv-fit.mjs` — VO-first hold fitting

```
smv-fit script.sb.json --vo marks.json [-o fitted.sb.json] [--base 350]
```

Pure JSON→JSON, no browser, no `src/` import, zero bundle cost. `marks.json` is either
`{"intro":0,"focus":4200}` (key order is the file's, which `JSON.parse` preserves) or
`[{"label":…,"ms":…}]`. Exports `durOf`, `labelOffsets`, `parseMarks`, `fit`, `parseArgs`
so the whole transform is testable without a CLI.

- **The pricing is a copy, and the copy is gated.** `durOf()` here is `src/index.js`'s
  table verbatim — a fit computed off a different clock than the scrubber, the cue sheet
  and the frame renderer read would be worse than no fit. It cannot be *imported*: the
  library's `durOf` is a closure over `baseDuration` and the run transport inside `mount()`.
  So `test/fit-cli.test.js` mounts `test/fixtures/record-demo.{spec,sb}.json` through the
  DOM shim and asserts `labelOffsets(steps)` equals the `kind:"label"` half of a real
  `g.cues()`, plus totals against `g.timeline().total`. That test is the seam's contract.
- **Anchors.** The story start is an implicit anchor at 0ms, so the run-up to the first
  marked label is fitted like any other segment (and a mark on a label that is *not* step 0
  works without special-casing). Marks are resolved to label indices and re-ordered by
  where they sit in the SCRIPT, not by the marks file, then checked monotonic against that
  order — a VO tool's key order is the narrator's.
- **Per segment:** `floor` = what the segment's non-`wait` steps cost, the shortest it can
  possibly be; `budget` = the requested gap minus that floor, handed to the segment's waits
  in proportion to what they already hold (integer shares, remainder on the last, so the
  sum is exactly `budget`). A segment with no wait gets one inserted immediately before the
  label. That is also what makes the transform **idempotent**: a re-fit finds a wait holding
  exactly `budget`, asks for `budget` again, and writes it back unchanged (proportional
  shares of `T` out of a total that is already `T` are the same integers).
- **The walk is backwards**, so an inserted wait never shifts an anchor index not yet used.
  Steps are mutated in place on a fresh `JSON.parse`, so key order and step identity
  survive; the only key ever added to an existing step is `ms` on a wait that declared
  neither `ms` nor `args[0]`. A wait carrying `dur` is repriced on `dur` too, because that
  is the field `durOf()` reads first.
- **Refusals, all exit 1 before anything is written:** a mark naming a label the storyboard
  does not have (with the known labels listed), marks that run backwards against script
  order, a negative or non-numeric ms, a duplicate mark, and a gap smaller than the
  segment's floor — named with the label, the floor and the gap asked for. Also `run.play`:
  its length is measured off the compiled run transport inside the browser, so a segment
  containing one cannot be priced statically and the CLI says so rather than guessing.
- Unmarked labels ride along on whatever the fit did around them; everything after the last
  marked label is untouched. The script goes to `-o` or to stdout (report on stderr, so the
  transform pipes).

### `{"op":"props"}` — the override layer (D16)

`g.props({id: {"--smv-*": value}})`, `g.props(null)` to clear; `"props"` joins OPS/NAMED and
`durOf()`'s zero list. State lives in the director (`props` Map + a `wroteP` shadow), which
is why it snapshots and restores with emphasis for free.

- **It rides the style commit, not a second write path.** `director.propsLayer()` is read at
  the two `renderer.styleCommit()` call sites (`relayout` and the new `styleNow()` behind
  `g.style()`/`g.props()`) and nowhere else — it rolls its own shadow forward, so exactly one
  read per commit is the contract. `render.js` merges it over `styleFn(n)` per node, and
  applies it to edges too (the user style function is node-scoped, §5.6). Because
  `styleCommit` runs *before* the elements exist, a re-added id's fresh `<g>` gets the
  override out of `nodeStyle` at `ensureNode()` — no commit hook needed, unlike `data-emph`.
- **A dropped key has to arrive as an explicit `null`.** `setProps()` only removes what it
  is handed, so an inline property would outlive the override that wrote it; `propsLayer()`
  therefore starts every id with nulls for the keys the LAST layer set. In `mergeProps` a
  null removes the property only when the style function is not setting the same key — that
  is what makes `g.props(null)` a return to the styled picture rather than a stripped one.
  (`false` is the caller's own "remove this" and does clobber the style function.)
- Validation is D7's: only `--smv-*` keys, and the whole map is validated before anything is
  written, so a rejected map leaves the previous layer standing.
- **`host.restore()` now restores the director BEFORE `relayout()`**, where it used to run
  after. The property layer is read by the style commit *inside* relayout, so restoring it
  afterwards would leave the outgoing step's overrides on screen for a whole commit.
  Emphasis is re-asserted off the `"commit"` event either way, so moving the whole call up
  costs nothing. The camera stays after relayout, for the reason it always was.

### `highlight({pulse: true})` — the attention pulse (D17)

Spelled as a modifier, not a fifth `variant`: the four variants are colours, and a warning
that breathes is still a warning, so `pulse` is orthogonal to `variant` exactly like `dim`.

- The director registers ONE callback on the shared ticker (D1) and writes ONE root custom
  property, `--smv-pulse` — `round(((1 - cos(2π·phase)) / 2) · 12) / 12` over a 1400ms
  cycle. Bucketed on purpose: a raw float would make a frame's markup depend on the exact
  tick arithmetic, and 12 stops quantize with the frame loop. The CSS is one changed rule,
  `stroke-width: calc(2.5px + var(--smv-pulse, 0) * 2px)` on the existing `[data-emph]`
  selectors, so an unset property is byte-for-byte the picture M4a shipped.
- **Not a CSS animation, deliberately.** `data-smv-record` (D15) exists to kill wall-clock
  transitions; a pulse that needed it would be a pulse that could not be *tested* under the
  manual ticker either. Under manual ticks the same tick sequence produces identical DOM —
  `test/director.test.js` asserts that against a second director, and `test/e2e-m4.mjs`
  proves it end to end: the record fixture's highlight now carries `pulse:true`, so the 33
  byte-identical frames of the determinism gate include it, and frames 12/13 (1.2s/1.3s — a
  `wait` where nothing else is moving) must *differ*, which is the pulse doing per-frame
  work inside a gate that would have caught any nondeterminism in it.
- It comes off the ticker on `clearHighlight()`, on a restore into a snapshot without one,
  and on `destroy()` (before the `destroyed` flag, or the guard would block its own
  teardown), so the rAF loop can idle. G9: under reduced motion it never registers at all
  and holds the peak statically — the motion shrinks, the emphasis is not skipped.
