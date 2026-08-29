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
