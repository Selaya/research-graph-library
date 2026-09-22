# smv internals

A contributor's map of `src/`: what each module owns, the contracts between modules, how
data moves through them, and the invariants a change must not break. The public API is in
[`API.md`](API.md); runs are in [`RUN.md`](RUN.md) (simulated) and [`LIVE.md`](LIVE.md)
(live); storyboards, director ops and the recording CLIs are in
[`RECORDING.md`](RECORDING.md). This file covers only what those leave out.

The code is plain-JS ESM with no TypeScript and no framework. Types are hand-written in
`types/`. Naming: npm `sparkle-motion-visualizer`, IIFE global `SparkleMotion`, prefix
`smv` (`.smv-*` classes, `--smv-*` custom properties, `data-smv-*` markers).

Source comments still cite short tags such as `D7`, `G2` or `F37`. They are labels from
the design history and do not point to a document. The invariant each one names is stated
next to it in the code, and the load-bearing ones are listed below.

## Module map

| module | owns | DOM? | in the IIFE |
|---|---|---|---|
| `events.js` | `emitter()`: `{on(type, fn) → off, off, emit}`; `"*"` receives every event | no | yes |
| `anim.js` | `EASE`, `createTicker()` (the one clock), `prefersReducedMotion()` | guarded | yes |
| `path.js` | polyline geometry: Bézier sampling, Catmull-Rom, resample, `pointAt`, `clipEnds` | no | yes |
| `diff.js` | `diffKeys(old, new) → {enter, update, exit}` | no | yes |
| `store.js` | `Store` (validated flat spec, mutations, condense/split, snapshot), `GraphError`, `containmentClosure`, `isConvex` | no | yes |
| `query.js` | `makeQuery(store)`, `cloneItem` | no | yes |
| `cycles.js` | `breakCycles`, `isAcyclic` | no | yes |
| `measure.js` | text measurement, `truncate`, `sizeNode`, node size constants | guarded | yes |
| `viewstate.js` | expand/collapse state and the `view` handed to layout (meta-edges, container sizing) | no | yes |
| `layout.js` | the layout shell: cycle breaking, arc routing, container padding, solver dispatch | no | yes |
| `engine.js` | `engineSolve`, the default layered solver | no | yes |
| `adapters/dagre.js` | `dagreSolver` / `dagreLayout` on `@dagrejs/dagre` | no | no (ESM subpath) |
| `scene.js` | the DOM-free diff-and-tween core (`scene.visual`) | no | yes |
| `render.js` | SVG element lifecycle, commit-time styling, per-frame geometry, culling | yes | yes |
| `styles.js` | the injected stylesheet (`CSS`, `injectStyles`) | yes | yes |
| `viewport.js` | pan/zoom/fit, anchored correction, camera tweens, pane chrome measurement | yes | yes |
| `index.js` | `mount()`: wires everything, owns the relayout pipeline and the storyboard host | yes | yes |
| `condense-anim.js` / `split-anim.js` | the three-phase condense and split choreographies | no | yes |
| `director.js` | camera target resolution, emphasis/dim, captions, the `--smv-*` override layer, the pulse | guarded | yes |
| `storyboard.js` | the pure step sequencer, op table, `timeline()` builder | no | yes |
| `transport.js` | the `.smv-transport` control bar | yes | yes |
| `run.js` | Mode A engine: `compileRun`, `parseDuration` | no | yes |
| `run-live.js` | Mode B engine: `replayLive`, `liveBoundaries`, `liveFedTargets` | no | yes |
| `run-transport.js` | the run handle (`g.run()`): clocks, play/seek/speed/step, the live log | no | yes |
| `run-render.js` | the `g.smv-tokens` layer and per-node run attributes | yes | yes |
| `interact.js` | tap-to-toggle and `nodeclick`/`edgeclick` | yes | yes |
| `a11y.js` | ARIA tree roles and keyboard navigation | yes | yes |
| `a11y-table.js` | linearised `<table>` fallback | yes | no (ESM subpath) |
| `export.js` | `exportSVG`, `exportPNG` | yes | no (ESM subpath) |
| `preset-pipeline.js` | the `pipeline` preset (duration chips, status glyphs, odometer, total bar) | yes | yes |

"Guarded" means the module touches browser APIs only after feature-detecting them.

## Global invariants

These hold across modules. Most bugs this codebase has had came from breaking one of them.

1. **Every module imports cleanly under Node.** Tests run under `node --test` with no
   browser, so browser APIs are feature-detected or reached only through an injected
   `doc`. Tests that need a DOM use hand-rolled fakes; `getBoundingClientRect` and similar
   may be missing.
2. **One clock.** All choreographed motion (scene tweens, viewport tweens, condense/split
   phases, storyboard waits, run playback, the pulse) is driven by one `createTicker()`
   per instance. No per-element WAAPI, no `setTimeout` pacing, and no CSS transitions for
   choreographed motion. CSS transitions are only for hover and focus affordances. This is
   what makes `ticker: "manual"` recording deterministic.
3. **Commit-time styling, frame-time geometry.** `data-*` attributes and `--smv-*`
   properties are written only at style-commit time (`renderer.styleCommit`). The
   per-frame path (`renderer.frame`) writes only geometry and opacity.
4. **Size animates through `width`/`height`, never a group `scale()`.**
5. **Anything suspended on the clock settles on teardown.** An awaitable that resolves from
   inside a tick has to register `ticker.onDestroy()` and resolve `{canceled: true}` from
   it, otherwise `g.destroy()` strands it forever. The condense and split phases, the
   storyboard's `waitMs`, and viewport tweens all do this.
6. **Reduced motion shrinks durations but keeps sequencing.** Under
   `prefers-reduced-motion`, durations drop to about 1ms and phases still run in order.
   `motion: "full"` overrides it. `prefersReducedMotion()` is read in `index.js` only;
   modules receive a `reduced` flag or a computed duration.
7. **Determinism.** The layout, the engines (`compileRun`, `replayLive`), the director's
   pulse and the storyboard timing have no `Math.random` and read no wall clock. The same
   inputs produce byte-identical output.
8. **Copies out, never live refs.** `g.node()`, `g.edge()`, `g.spec()`, the query methods
   and `run.state()` all hand back copies. Callers may mutate what they receive.
9. **Every `g` mutation returns an awaitable.** It is a thenable
   `{then, catch, finally, cancel}` resolving `{canceled, applied?}`, never a bare promise
   and never `g`. The director state setters (`highlight`, `caption`, `props`, `style`)
   return `g` and are not awaitable.

## Data flow

```
spec mutation (Store)
  → viewstate.view()       visible nodes, meta-edges, sizes (measure.js)
  → layout(view, opts)     shell + solver: rects, edge polylines, order/layers
  → renderer.styleCommit   data-* / --smv-* (+ director.propsLayer())
  → scene.commit(target)   keyed diff, one tween on the shared ticker
  → renderer.frame(visual) per tick: geometry only
  → viewport               anchored correction, auto-refit or camera shot, same duration
  → bus "commit"           a11y, preset, director.reassert, run layer react
```

The run engines are orthogonal to this flow. `run-render.js` samples
`stateAt(t)` / `replayLive(…, t)` each tick and decorates the current `scene.visual`. It
never mutates the graph.

## Core primitives

### `anim.js`

- `createTicker({manual?}) → {now, add(fn), remove(fn), onDestroy(fn) → off, destroy, tick(ms)}`.
  The rAF loop starts on the first `add` and stops on the last `remove`. The clock source
  is a WAAPI `Animation`'s `currentTime` on a detached element when available, otherwise
  `performance.now()`. `manual: true` never schedules frames: `tick(ms)` advances time and
  fires callbacks, for tests and the recorder.
- `EASE = {linear, cubicOut, cubicInOut, overshoot}`, each `fn(t) → t'`. `overshoot` is
  back-out with a slight excursion past 1, used for the condense and split reveals.

### `path.js`

Pure, shared by `layout.js`, `scene.js`, `render.js` and `run-render.js`.

- `sampleCubic`, `catmullRom(points, per = 8)` (straight pass-through below 3 points),
  `resample(points, n = 24)` (arc-length uniform, endpoints kept, zero-length input
  repeats the point), `lerpPoints`, `arcLength`, `pathString` (2-decimal `M…L…`).
- `pointAt(points, t) → {x, y, angle}` at arc-length fraction `t`. Tokens, edge labels
  and arrowheads use it.
- `clipEnds(points, srcRect, tgtRect) → {points, arrow: {x, y, angle}}`, where rects are
  centre-origin `{x, y, w, h, r}`. It runs **per frame** during transitions, so keep it
  cheap and NaN-proof: overlapping rects produce a short degenerate segment, not NaN.

## Store (`store.js`, `query.js`, `cycles.js`)

`Store` holds the flat spec: `nodes: Map`, `edges: Map`, and `rev`, a counter bumped on
every structural change that memo keys use. Cycles are allowed; nothing rejects them.
Parent chains may not cycle. Errors are `GraphError(code, message)`; codes are listed in
[API.md › Errors](API.md#errors).

- `update(id, patch, {replace})`: `data` merges shallowly; an `undefined` value deletes
  that key; `replace` swaps the payload; an emptied `data` is dropped so `spec()` still
  round-trips through JSON.
- `condense(ids, newNode)`: convexity and edge redirection are judged over
  `containmentClosure(store, ids)`, which includes the children of condensed containers.
  `isConvex()` skips `loop: true` edges, since a back edge re-entering the set is not a
  path through it. `parent: null` on the merged node means "inherit". If the sources'
  parents differ and no parent was named, `condense` warns. `index.js` and
  `condense-anim.js` ask the same convexity question synchronously before starting the
  choreography.
- `split(id, {nodes, edges})`: `id` must exist and must not have children
  (`split-container`). New ids must not collide (`dup-id`). Internal edges may only join
  new nodes (`split-edge`). Entry parts are the new nodes with no internal in-edge, and
  exit parts are those with no internal out-edge. Every former in-edge is redirected to
  every entry part: the first keeps its id and clones get `id + ':' + targetId`. Out-edges
  are redirected the same way from every exit part. `weight` is kept and self-loops on
  `id` are dropped. Wiring with no entry or no exit (a cycle across every part) is rejected
  up front (`split-no-entry` / `split-no-exit`), and only when there is something to
  redirect. Returns `{added, addedEdges, removedEdges}`. `g.split()` runs the same guards
  synchronously.
- `snapshot()` is a JSON deep copy of `spec()` and `restore(snap)` replaces the state
  wholesale. Condense and split compose from primitives, so both round-trip.

`makeQuery(store)` returns `{nodes(filter?), edges(filter?), children(id),
descendants(id), roots()}`. A filter is a predicate, or a match object whose top-level
keys compare with `===` and whose `data` key matches shallowly. Results are `cloneItem`
copies. `index.js` spreads the result onto `g`.

`breakCycles(nodes, edges, pinned) → Set<edgeId>` picks edges to reverse so that ranking
sees a DAG. `loop: true` edges and pinned edges (reversed by the previous layout) are
reversed up front, and a DFS reverses whatever back edges remain. A pin that the DFS
would not re-cut is released once the graph stays acyclic without it. Self-loops are
ignored. Pinning is what stops an unrelated append from flipping which side a loop is
drawn on.

## View state (`viewstate.js`, `measure.js`)

`createViewState(store, measureOf) → vs`, where `measureOf` is a live getter for
`opts.layout.measure` so `g.layout({measure})` re-measures without rebuilding the view
state.

- `vs.collapsed: Set<id>`, seeded from `node.collapsed === true`. A node declared
  collapsed before its children exist is tracked in `pendingCollapse`, and
  `expand()`/`collapse()` own that bookkeeping.
- `vs.expand(id)`, `vs.collapse(id)`, `vs.expandAll()` and `vs.collapseAll()` mutate the
  set only and return what changed. `index.js` drives the relayout. `vs.containers()`
  lists container ids parents-first. `vs.visibleAncestor(id)` maps a hidden id to the
  ancestor drawn in its place, and the camera and highlight resolve ids through it.
- `vs.view() → {nodes, edges, sizes, meta}` is the layout input:
  - A node is visible when every ancestor is expanded. Children of expanded containers
    carry `parent`.
  - A container is any node with children, or one declared `container: true`. The
    childless case is marked `empty`, which render writes as `data-empty`.
  - A collapsed container is a plain node sized by `sizeNode`, plus room for its `×N`
    badge.
  - **Two edge remaps, not to be confused.** (1) An endpoint that is hidden re-attaches to
    its nearest visible ancestor. The edge loses its identity and dedupes into
    `meta:<src>-><tgt>` with `weight` = count. Self-referential results drop. A loop
    wholly inside a collapsed container becomes a loop badge instead of an edge. (2) An
    endpoint that is an expanded container re-attaches to that container's entry or exit
    child and keeps its id, so it simply tweens across an expand. Remap (2) is why no edge
    handed to the solver ever touches a container.
  - `meta = {metaEdges: Map<metaId, {sources, weight}>, loopBadges: [{id, max}]}`.

`measure.js`: `textWidth` uses canvas `measureText` in a browser and a deterministic
per-glyph estimate scaled by font px under Node, which keeps golden files browser-free.
`sizeNode(node, measure, ctx) → {w, h, reserve}`. `measure = {extraWidth, extraHeight}`,
each a number or `(node, ctx) => number`, with `ctx = {nodes: Map, cache}` so a hook can
depend on other nodes (for example a rollup chip). `extraWidth` is added **inside** the
`NODE_MAX_W` (220px) clamp and returned as `reserve`, which `render.js` subtracts from the
label's room: reserved chrome is never label room. A node declaring both `w` and `h` opts
out (`reserve: 0`). One declaring only `w` keeps that width and still gets the reserve.
How presets use this is in [PRESETS.md](PRESETS.md).

## Layout (`layout.js`, `engine.js`, `adapters/dagre.js`)

### The shell: `layout(view, opts)`

```
layout(view, opts) → {
  nodes:  {id: {x, y, w, h}},          // x, y are CENTRES
  edges:  {id: {points, reversed?}},   // points always run source → target
  bounds: {x, y, w, h},
  reversedEdgeIds: Set,                // persist → opts.pinnedReversals
  order:  string[][],                  // persist → opts.prevOrder
  layers: string[][],                  // persist → opts.prevLayers
  slots?: {id: number},                // only when opts.componentOrder is an array
}
```

- Cycle handling lives in the shell, not the solver. `breakCycles` runs with
  `pinnedReversals`, and back edges and self-loops are withheld from the solver and
  routed here as consistent-side arcs (below the flow for LR). They cannot flip sides
  across re-layouts.
- **Solver input invariant:** the edge set handed down is acyclic, and no edge touches a
  node that has children. Solver nodes are `{id, w, h, parent?, container?, data?}`.
  `container: true` marks every container, including an empty one. `data` is the node's
  spec data, or `opts.hint(node)`'s return value when `hint` is a function. Every custom
  key on the opts reaches the solver by spread.
- The shell derives `opts.chromePad` from `CONTAINER_PAD` (`{top: 40, side: 12, bottom:
  12}`: the 28px header strip plus a 12px gap, and 12px on the other sides) so the solver
  reserves the padding `padContainers` adds afterwards. When `componentOrder` is an array
  it also derives `opts.backLinks`, the withheld cycle edges as source/target pairs, so
  connectivity is judged on the real graph rather than the acyclic one. Both are written
  to the shell's own copy of the opts, never the caller's.
- `padContainers` grows each container rect to its children plus `CONTAINER_PAD`. If the
  solver returned no rect for a container, the rect comes from the children's bounding
  box alone rather than being unioned with a `{0,0}` placeholder. Leaving containers to
  the shell is a supported way to write a solver.
- Neither the shell nor any default bundle imports dagre. `scripts/build.js` fails the
  build if dagre appears in one.

Writing a custom solver is documented in [API.md › Layout](API.md#layout) and
[API.md › What a solver sees](API.md#what-a-solver-sees); `demo/sequence-solver.js` is a
worked example.

### The solver contract

```
solver(input, opts) → {nodes, edges: {id: {points}}, order, layers?, slots?}
opts = {dir: 'LR'|'RL'|'TB'|'BT', nodesep, ranksep, marginx, marginy,
        prevOrder?, prevLayers?, chromePad?, componentOrder?, componentOrderMemory?, backLinks?}
```

Container rects must strictly contain their children. Edge `points` include the bend
chain (at least 2 points, source to target). `order` holds the final per-rank real-node
sequences. Multi-edges and disconnected components must work.

### `engineSolve` (`engine.js`)

Pure, dependency-free and deterministic: stable sorts, no randomness. It works internally
in TB and transposes or flips for the other directions. Passes:

1. **Nesting.** Derive the cluster tree and keep each cluster's nodes on a contiguous rank
   interval, using border ranks per cluster level.
2. **Ranking.** Longest-path ranking, then one tightening pass that pulls nodes with slack
   toward their successors.
3. **Dummies.** Multi-rank edges are split into unit spans. Per-cluster border dummies on
   every spanned rank keep foreign nodes out of a cluster's interval.
4. **Ordering.** Initialise from `prevOrder` (unknown ids are appended in input order),
   otherwise DFS. Then alternate median sweeps with transpose passes and keep the result
   with the fewest crossings.
5. **Coordinates.** The rank axis is cumulative max extent plus `ranksep`. In-rank
   positions come from median-alignment relaxation sweeps with `nodesep` enforced in both
   directions; dummies straighten first. Brandes–Köpf is not used on purpose.
6. **Margins** are applied last.

Invariants inside the engine:

- **Fixed point.** `engineSolve(g, {prevOrder, prevLayers})` fed its own output
  reproduces `order`, `layers`, `nodes` and `edges` exactly. `layers` is the same per-rank
  sequence as `order` with edge dummies and spanning-container borders interleaved as
  opaque tokens. Without it a re-layout re-derives bend positions, scores the arrangement
  differently, and reshuffles ranks nobody touched. A solver that cannot produce `layers`
  (dagre) omits it and the shell substitutes `[]`.
- **Stability over crossings.** Ties and equal-crossing decisions prefer the previous
  order. The only reshuffle allowed on an append is one that strictly reduces crossings
  among the existing edges (`test/engine-parity.test.js`).
- **The ordering search is idempotent, not just bounded.** It ends only when a full round
  of sweeps from the best arrangement fails to improve on it. Stopping after a fixed count
  leaves an order the next solve can still beat, which breaks the fixed point.
- **A cluster's block order is global, not per-rank.** Which side of a sibling a container
  sits on is decided once for all its ranks. Per-rank choices yield sibling rects that
  each contain the other's children.
- **Container chrome is reserved, not assumed.** A border dummy is at least as wide as the
  padding the rect will grow by. Nested borders are separated by the nesting step, not a
  full `nodesep`. Border alignment iterates until rects stop moving. Sibling containers
  with overlapping rank spans are grown to their common window. `chromePad` is reserved on
  the rank axis so the padded rect does not eat the next rank at small `ranksep`.
- **`componentOrder` is a primary key.** `assignSlots` (union-find over edges, containment
  and `backLinks`) gives each connected component the index of the first entry naming one
  of its ids, or `spec.length` if none does. Only `sortRank` (item sort and
  sibling-block reassignment lead with `slot`) and `transpose` (never swaps across slots)
  enforce it, and no median, crossing count or previous order can move an item out of its
  band. When the option is absent, `g.slot === null`, every slot is 0 and the drawing is
  identical to one built without the feature. The solve emits `slots` only when the option
  was active.
- **`componentOrderMemory` is a fallback, never a rival.** It is applied strictly after
  the list and only to components no listed id claimed. Folding it into the entries would
  let a remembered id in entry `i` silently beat the same id listed explicitly in entry
  `j > i`.

### Order, layers and slot memory in `index.js`

`relayout()` persists `reversedEdgeIds`, `order`, `layers` and `slots` from each result
and feeds them back as `pinnedReversals`, `prevOrder`, `prevLayers` and
`componentOrderMemory`. The memory is filtered to live ids, resolved through collapses,
and never names the trailing unlisted slot. It belongs to one `componentOrder` list:
`relayout()` compares the list's JSON with the one it stored and drops the memory when it
changes. All four values are part of the storyboard snapshot (see
[Storyboard host](#storyboard-host-indexjs)).

`reseat(newIds, sourceIds)` is called by condense and split. It moves the ids those ops
mint into the position their sources held in `order`, `layers` and the slot memory.
Without it, an unknown id sorts to the end of its rank and the merged node jumps past
every sibling after blooming at the sources' centroid.

### `adapters/dagre.js`

`dagreSolver(input, opts)` implements the solver contract on `@dagrejs/dagre` (compound
graph, multigraph, rankdir mapping, `order` derived from dagre's result).
`dagreLayout(view, opts) = layout(view, {...opts, solver: dagreSolver})`. dagre is an
optional peer dependency, and this is the only file that imports it.

## Scene and rendering (`scene.js`, `render.js`, `styles.js`, `viewport.js`)

### `scene.js`

```
createScene(ticker) → scene
scene.visual   {nodes: Map<id, {x, y, w, h, opacity}>, edges: Map<id, {points, opacity, reversed}>}
scene.onFrame(cb)                 cb(visual) after each step, and once per commit
scene.commit(target, opts) → {promise, cancel(), done}   promise → {canceled}
scene.transition                  the live transition, or null
opts = {duration = 350, easing, enterFrom?: {id: {x, y}}, exitTo?: {id: {x, y}},
        easeOverride?: {id: fn}, holdOpacity?: Set}
```

- Keyed diff of `visual` against `target`. Updated nodes tween x/y/w/h. Every edge is
  normalised to `EDGE_POINTS` (24) arc-length-uniform points (`resample(catmullRom(…))`),
  so any two geometries lerp pointwise. Entering nodes start at `enterFrom[id]` or their
  target, at 60% size and opacity 0. Exiting nodes fade out, or fly to `exitTo[id]` while
  shrinking to 60%, and are then deleted from `visual`. `easeOverride` gives one node its
  own easing (the overshooting reveal).
- **Interruption is cancel-and-retarget.** A `commit()` during a live transition samples
  the current interpolated `visual` as the new start, resolves the old promise with
  `{canceled: true}`, and starts exactly one new transition. Two transitions never write
  the same element.
- Zero and short durations complete on the next tick, never synchronously.

### `render.js`

```
createRenderer(rootEl, doc) → r
r.svg, r.viewportG
r.styleCommit(like)      commit time: data-* and --smv-* per element, label text/truncation
r.frame(visual)          per tick: geometry only
r.setCull(fn | null)
r.mark(id, value)        data-condense="src"|"reveal"|null (choreography channel)
r.emphasize(id, value)   data-emph   (director channel)
r.dim(id, value)         data-dim    (director channel)
r.node(id), r.edge(id), r.destroy()
```

- DOM shape: `svg.smv > g.smv-viewport > (g.smv-edges > g.smv-edge*, g.smv-nodes >
  g.smv-node*)`, and `run-render.js` appends `g.smv-tokens` after the nodes. A node is
  `<g class="smv-node" data-id>` with a rect and text; containers get
  `data-container`, header chrome and a top-left label, and are drawn before their
  children. An edge is `<g class="smv-edge" data-id>` with `path.smv-edge-line` and
  `path.smv-edge-arrow`: a hand-posed triangle, never `<marker>`.
- Elements are created and removed keyed by the ids present in `visual`. A re-added id
  gets a fresh `<g>`, so any state written outside the style commit (`data-emph`,
  `data-dim`) must be re-asserted on `commit`; the director does this.
- Per frame, `clipEnds` runs against the **current-frame** node rects from `visual`, so
  edges track nodes mid-tween.
- `styleCommit(like)` takes `{nodes, edges, reversed, style, sizes, props, edgeLabelMaxW}`
  and writes `data-status`, `data-mode`, `data-container`, `data-collapsed`, `data-empty`,
  `data-count`, `data-reversed`, `data-weight` and `data-pill`. It writes the user style
  function's `--smv-*` output merged under the director's `props` layer; see
  [Director](#director-directorjs). Only `--smv-*` keys are accepted. The label is
  truncated to `w − 2·NODE_PAD_X − reserve`.
- Edge labels: `edge.label` is a string or `{text, place, rotate, pill, maxW}`, normalised
  at commit time to `{text, t, rotate, pill, w}` and cached on the element record so
  `frame()` does no map lookups. The label is positioned per frame at `pointAt(clipped, t)`
  with a perpendicular nudge. `rotate` is normalised into ±90°. `pill` inserts a
  `rect.smv-edge-pill` behind the text. The truncation cap is `maxW`, then
  `layout.edgeLabelMaxW`, then 90px, measured in the label's own 10px font. Labels do not
  affect layout. A meta-edge aggregating two or more labelled edges drops the label.
- `mark` and `emphasize`/`dim` are deliberately separate attributes, so a highlight that
  outlives a merge does not fight the condense choreography.

### Culling

- Above `CULL_THRESHOLD` (150) elements in `visual`, `frame()` asks `cullFn()` for the
  visible world rect and sets `data-culled` (`display: none`) on groups entirely outside
  it, skipping their geometry writes. Below that threshold the test costs more than it
  saves.
- `index.js` wires `setCull(() => viewport.visibleWorldRect())` and re-arms from
  `viewport.onChange`, not pointer events, because `fitView()`, `zoomBy()`, the anchored
  correction and every tween tick move the rect with no pointer event. The re-arm repaints
  only when the transform actually changed, and skips while a scene transition is already
  repainting.
- Anything that reads the live DOM must account for culling. `export.js` clears culling on
  its clone by default. `a11y.js` never parks the roving tabindex on a culled group, and
  its arrow, Home and End keys walk only the focusable subset. The token layer is never
  culled: `run-render.js` reads positions from `scene.visual`, which culling does not
  touch.
- There is no compositor-offload layer. `demo/m3-scale.html` and `test/e2e-m3.mjs`
  measure synchronous pan cost on a 300-node graph. Adding one is justified only if the
  headless median exceeds 8ms per frame.

### `styles.js`

`injectStyles(doc)` injects one deduplicated `<style data-smv-styles>` per document,
however many instances mount. The CSS uses only `.smv-*` classes, `[data-*]` selectors
and `--smv-*` properties, with defaults at zero specificity (`:where`) so user rules and
`data-smv-theme="dark"` win. The full attribute and property reference is
[THEMING.md](THEMING.md). Things a CSS edit must keep:

- `[data-smv-record] *` disables every transition and animation during recording.
- The status tint is `--smv-status-fill`, a `color-mix` of the status token over
  `--smv-fill` behind `@supports`, so an inline fill composes with the tint instead of
  hiding it.
- The pulse is one rule, `stroke-width: calc(2.5px + var(--smv-pulse, 0) * 2px)` on
  `[data-emph]`. An unset `--smv-pulse` renders exactly as without the pulse.
- **The caption strip, the transport bar and the preset's total bar each position
  themselves against the pane independently.** Any placement rule has to beat the
  transport-aware offset by specificity: for example
  `.smv-root.smv-has-transport .smv-caption[data-place="top"]{bottom:auto}` must outrank
  `.smv-has-transport .smv-caption{bottom:46px}`, or a top caption stretches over the pane.
  `test/caption-place.test.js` guards this. Fits avoid the chrome through `paneInsets()`
  (below), not through CSS.
- `a11y.js`, `a11y-table.js` and the preset inject their own deduplicated `<style>`
  blocks rather than editing this file.

### `viewport.js`

```
createViewport(svgEl, viewportG, ticker) → vp
vp.transform {x, y, k}            vp.target (where a live tween is heading, else transform)
vp.userMoved (get/set)            vp.size() → {w, h}
vp.fit(bounds, {pad = 24, duration = 0, ease, maxK = FIT_MAX_K, inset}) → Promise<{canceled}>
vp.fit(bounds, pad, animate)      the older positional form, still accepted
vp.moveTo({x?, y?, k?}, {duration = 0, ease}) → {promise, cancel}
vp.anchor(worldBefore, worldAfter, duration)   translate-only correction on the shared clock
vp.contains(bounds), vp.visibleWorldRect(pad = 200), vp.zoomBy(f, at?)
vp.screenToWorld(pt), vp.worldToScreen(pt)     svg-local coordinates, not client
vp.setInteractive(bool), vp.onChange(cb) → off, vp.destroy()
paneBox(size, pad, inset) → {cx, cy, w, h}     PURE
paneInsets(root, svgEl) → {top, right, bottom, left}
normInset(number | partial) → {top, right, bottom, left}
MIN_K = 0.1, MAX_K = 4, FIT_MAX_K = 1.5
```

- Zoom only with ctrl/cmd+wheel or pinch. Plain wheel is never intercepted, so the page
  keeps scrolling. A manual pan or zoom sets `userMoved`, which turns auto-refit off.
- `stopTween(canceled)` settles the tween's promise on every exit path: landing,
  retarget, `setNow`, destroy, and clock teardown via `ticker.onDestroy`.
- Relative camera moves compose onto `vp.target`, never onto a mid-tween sample.
- `paneInsets()` measures the chrome the library mounts over the pane (`.smv-transport`,
  `.smv-totalbar`, `.smv-caption`). Each bar is assigned to the top or bottom edge it
  hugs and the deepest intrusion per side wins. Anything covering half the pane is treated
  as a host panel and ignored, and top and bottom are each capped at 40%. Left and right
  come only from a caller's `inset`. It returns zeros without `getBoundingClientRect`, so
  fake-DOM tests fit as before. `fit()` and `resolveCameraTarget()` both frame through
  `paneBox()`, so they agree by construction.
- This file does not read `prefersReducedMotion()`. Callers pass the duration.

## The instance (`index.js`)

`mount(el, spec, opts) → g` builds one of everything (store, view state, ticker, scene,
renderer, viewport, director, bus) and wires them. The public surface is documented in
[API.md](API.md). Internal contracts:

### The relayout pipeline

`relayout({focal, duration, enterFrom, exitTo, easeOverride, camera})`:

1. `vs.view()`, then `layout(view, {...layoutOpts, pinnedReversals, prevOrder,
   prevLayers, componentOrder*})`, persisting the result's channels.
2. `renderer.styleCommit(…)` with sizes taken from the layout result, so containers get
   their solver-computed boxes, while keeping each node's measured `reserve`.
3. `scene.commit(…)` with `duration = reduced ? 1 : (duration ?? stepDur ?? baseDuration)`.
4. Viewport: if a `camera` shot came with the mutation, resolve it against **this**
   layout and `moveTo` it on the commit's own duration and easing, and set
   `cameraOwned` and `userMoved`. Otherwise **anchor**: keep the focal node (or the bounds
   centre) stationary on screen, and refit only if the user never moved and the new
   bounds fall outside the pane. The refit uses the same duration and `chromeInset()`.
5. Emit `commit` with `{nodes, edges, bounds, reversedEdgeIds, meta, focal, duration,
   transition}`.

`styleNow()` is the style-only commit behind `g.style()` and `g.props()`: same sizes, no
relayout.

`commitOrDefer(focal, extra, meta)`: inside `g.batch()`, ops accumulate `enterFrom`,
`exitTo` and `easeOverride`, and the last `camera` wins, all feeding one relayout that
every op in the batch shares as one awaitable. `settled()` is the awaitable for a no-op
(`applied: false`).

### The `{camera}` option on mutations

`shotFor(camera, subject)` turns a mutation's `camera` option into a camera target:
`true` frames the subject (one id → `{node}`, a list → `{nodes}`, none → `{fit: true}`).
An object that names no box gets the subject added. `maxK: NODES_MAX_K` (1.5) is injected
unless `k` or `maxK` is given, and `dur` is dropped because the shot rides the mutation's
clock. `MUTATION_CAMERA_ARG` records which argument slot holds the options for each op;
`hasCameraOp(steps)` uses it at storyboard build time. A no-op toggle that carries a shot
still moves the camera, through `shotOnly()`. Condense and split pass the shot to their
phase-2 relayout. User-facing semantics are in
[API.md › Framing any mutation](API.md#framing-any-mutation).

### `internals`

The object handed to the choreography modules and the run layer. It contains everything
they need and nothing DOM-shaped, so they run against fake hosts in tests:

```
{ticker, store, scene, renderer, bus, viewstate, reduced, lastLayout(), relayout, reseat, mark(ids, value)}
```

### Other wiring

- `g.validate(ops | fn)` dry-runs structural ops against `new Store(store.snapshot())`
  and returns `{ok, errors}` without committing or laying out. The op whitelist is
  storyboard's `STORYBOARD_OPS`. `expand`/`collapse` probes still report unknown ids.
- A `collapsed` key in `g.update()` is routed through `expand()`/`collapse()`. The commit
  still runs when that route changed nothing, so the rest of the patch renders.
- `g.finished` is one deferred per instance, resolved by the storyboard's `done`,
  `g.finish(reason)` or `destroy()`. `scripts/check-demos.mjs` waits on it through the
  snippets in `scripts/finish-signal.mjs`, which are unit-tested without a browser.
- Mount order matters: the preset must exist before the first `commit`, a11y and tap
  toggle attach after it, and the mount-time fit runs after the transport mounts so there
  is chrome to measure.
- The IIFE global is exactly the default export `{mount, version, presetPipeline,
  GraphError}`. `export.js`, `a11y-table.js` and the dagre adapter stay ESM-only.

## Choreography (`condense-anim.js`, `split-anim.js`)

`runCondense(g, internals, ids, newNodeSpec, opts)` and
`runSplit(g, internals, id, parts, opts)` each run three phases on the shared ticker,
`{highlight: 150, converge|diverge: 450, reveal: 300}` (`CONDENSE_PHASES`,
`SPLIT_PHASES`), 900ms in total:

1. **Highlight**: sources get `data-condense="src"`; geometry does not change.
2. **Converge / diverge**: `store.condense()` / `store.split()`, `internals.reseat(…)`,
   then one `relayout`. For condense, the sources fly to the merged node (`exitTo`) and
   the merged node blooms from the sources' centroid. For split, the parts bloom from the
   source's centre. The new nodes use `EASE.overshoot`. `condense`
   (`{sources, target, sourceData, targetData}`) or `split` (`{source, targets,
   sourceData}`) is emitted at the start of this phase. Listeners such as the preset's
   odometer and the run layer's remap react here and never read the phase durations.
3. **Reveal**: new nodes get `data-condense="reveal"` and it is removed at the end.

Each returns `{promise, cancel}` resolving `{canceled}`, registers `ticker.onDestroy`, and
under reduced motion keeps each phase at 1ms or more with the sequence intact. `g.condense`
and `g.split` run the store's guards synchronously before starting, so errors throw at the
call site. `durOf()` prices both at the phase sum (`CHOREO_MS`).

## Runs (`run.js`, `run-live.js`, `run-transport.js`, `run-render.js`)

User-facing semantics (duration grammar, pacing, joins, loops, retries, `statusAgg`, the
live primitives, the event vocabulary) are specified in [RUN.md](RUN.md) and
[LIVE.md](LIVE.md). Treat those as the behavioural contract; the tests in
`test/run*.test.js` enforce them. This section covers the module boundaries.

### The shared state shape

Both engines are **pure**: no DOM, no imports from render, index or scene, and no wall
clock. Both produce the same state shape, so `run-render.js` has no mode branch:

```
{ tokens: [{id, rate, at: {kind: 'node'|'edge', id, progress}}],
  nodes:  {id: {status, progress, occupancy, …}},
  edges:  {id: {traversed: 0..1}},
  joins:  {nodeId: {arrived, needed, fired}},
  loops:  {edgeId: {iteration, max}},
  done }
```

Mode B adds `waiting`, `active` (`waiting + active === occupancy`) and `overBudget` to
`nodes[id]`.

### Mode A: `compileRun(spec, opts) → sim`

`sim = {duration, events, boundaries, stateAt(t), nextBoundary(t, tokenId?)}`. The whole
schedule is compiled once as a discrete-event pass, and seek, scrub and step only sample
it. Container edges are remapped to entry and exit children; a single spec edge can
expand into several engine edges that keep its `id`, and loop-budget bookkeeping stays
keyed by `id`. `breakCycles` runs over the remapped edges, and untagged back edges act as
zero-iteration loops, excluded from join arity. Compilation is capped at `MAX_STEPS` so a
pathological spec cannot hang the page. Unparseable input produces `warn` events, not
exceptions.

### Mode B: `replayLive(spec, events, t, opts) → state`

It replays the append-only log up to `t` with no container remap. `opts = {hopMs = 300,
minHopMs = 0, bornAt}`. `hopMs` is rendering travel time and never gates the feed. A
`start` that arrives before the hop lands consumes it. A landing that coincides with a log
event at the same `t` is ordered before it. `bornAt` (edge id to live ms) stops a `finish`
from fanning out over an edge that did not exist yet. `liveFedTargets(nodes, edges)` is
the engine's own definition of a non-root: loop edges, self-edges and edges cut by
`breakCycles` do not feed. It is exported so the transport's start guard cannot drift
from it. `liveBoundaries(events)` returns sorted distinct event times, which `step()`
walks.

### The transport: `createRunTransport(internals, opts) → run`

It owns everything time-shaped: `play/pause/seek/speed/step/timeOf/reset`, and in live
mode `start/finish/fail/spawn/follow/now/log`. See [RUN.md › The run
handle](RUN.md#the-run-handle) and [LIVE.md › The primitive
surface](LIVE.md#the-primitive-surface).

- **Mode A:** `speed()` and `step()` are not engine features. `speed()` appends a rate
  event and recompiles against the same spec at the current virtual time. The past is
  unchanged because a rate is applied only when a token enters a node at or after the
  event's `t`.
- **Mode B:** a **frontier** clock advances with the ticker unconditionally, and view
  time `t` follows it until a `seek` detaches it. The view can never pass the frontier.
  `state()` is memoised on `(t, store.rev, log revision)` and returns a private copy,
  because the state is sampled every frame and a replay is O(events).
- `reset(opts, time)` re-seats **the same handle** (identity and listeners intact), and
  `options()` returns what `reset` needs, including the live log. The storyboard
  snapshot/restore round trip depends on this pair and must not lose live history.
- Graph mutations reach the engines lazily through the new spec. On `condense`/`split`,
  Mode A recompiles and emits `remap`, and tokens move to the survivor. Mode B **rewrites
  the log** so entries naming a removed source point at the survivor (or a split's entry
  part). Without that, `replayLive` drops the history and `done` flips mid-run. An edge
  added in live mode is stamped with the frontier in `bornAt`.
- `index.js`'s `createRun()` keeps `runSubs`, the set of every `run.on()` a caller
  registered, and re-seats it on the fresh transport each `g.run(opts)` recompile builds,
  so caller listeners and their unsubscribers survive. The run layer's own subscriptions
  use the raw `on()` and are rebuilt per compile. The same hop mirrors every run event
  onto the instance bus as `run:<type>`.

### `run-render.js`

`createRunRender(internals, run)` draws into `g.smv-tokens` inside the shared tick: one
pulse per token, placed with `pointAt` on the **current** edge geometry so it follows
edges mid-transition; a per-node progress fill; the occupancy badge; join pips; loop
badges; and `data-traversed` / `--smv-traversed` on edges. It writes the live status to
`data-run` and `data-over-budget` on node groups, and emits `runstatus` on the bus **per
status transition, never per frame**. `a11y.js` and `a11y-table.js` refresh on
`runstatus`, since a run is not a spec mutation and fires no `commit`. The layer is
`aria-hidden`.

## Storyboard and timeline

### `storyboard.js`

`createStoryboard(host, steps)` is a pure sequencer with no DOM and no ticker.
`host = {apply(step) → awaitable | {run} | null, snapshot(), restore(snap) → awaitable}`.
It snapshots **before** every step, and `seek(i)` restores snapshot `i`. Label-only
entries are zero-duration markers. The sequencer exposes
`play/pause/next/prev/seek/labels/position/on/off`.

- `STORYBOARD_OPS` is the op whitelist. `validate()` checks every step at build time,
  recursing into batches with dotted indexes: unknown ops, `props` keys that are not
  `--smv-*`, and `run`/`run.reset`/`layout` arguments that are not options objects all
  fail at their own step index.
- `stepGen` and `loopGen` generation counters make interleaved play/pause/seek safe. A
  `seek()` always leaves the storyboard paused.
- `timeline(g)` is the fluent builder (`NAMED` maps method names to ops). The array it
  builds is the only primitive.

The op table and step fields are documented in
[RECORDING.md › The op reference](RECORDING.md#the-op-reference).

### Storyboard host (`index.js`)

- **`applyStep`** sets the ambient `stepDur = step.dur ?? null` around the op and restores
  it afterwards, so a batch's `dur` survives its children, and `relayout` reads it. This
  gives every mutation per-step pacing with no signature change. During a forward scrub,
  the director ops (`DIRECTOR_OPS`) run instantly; mutations keep their real timing.
- **Holds.** If a step declares a positive `dur` and its op returns nothing awaitable
  (not a thenable and not `{run}`; note that `g` has a `run` *function*), `applyStep`
  waits `dur` on the ticker. `run`/`run.reset` are excluded, and so is any step during a
  scrub.
- **Batches** await the shared commit together with every child that returns its own
  awaitable. `PARALLEL_IN_BATCH` lists the ops that keep their own clock inside a batch.
- **`durOf(step)` is the declared timeline, and the scrubber, `g.cues()`, `smv-record`
  and `smv-fit` all read it.** Labels cost 0. `run`/`run.reset` cost 0, decided before
  `dur` is read. Otherwise `step.dur` wins. Otherwise: `wait` costs its ms, `camera` its
  `dur` or `CAMERA_MS` (600), the director ops and `run.step`/`run.seek` cost 0, `condense`
  and `split` cost `CHOREO_MS`, a batch costs the maximum of its `PARALLEL_IN_BATCH`
  members and `baseDuration`, and everything else costs `baseDuration`. `run.play` slices
  come from the run's own clock (`stepSlices()`, which subtracts the run time already
  spent). **What a step is priced at must be what it is awaited for**; a change to either
  side has to change both, and `bin/smv-fit.mjs` as well (see [CLIs](#clis-bin)).
- **`host.snapshot()`** captures everything a step can move: `spec`, `collapsed`,
  `reversals`, `order`, `layers`, `slots`/`slotsKey`, `layout` (the `layout` op mutates
  instance options), `runTime`, `runCompiled`, `runOpts`, and `director.snapshot()`
  (emphasis, caption, props, pulse). It also captures `camera` and `userMoved`, **but
  only when `cameraOwned`**. That flag is set at build time by `hasCameraOp(steps)`,
  because the step-0 snapshot precedes every op. Snapshotting the camera unconditionally
  would undo a reader's pan on every seek.
- **`host.restore()`** order: store, view state, pins, order, layers and slots, layout
  opts, **then `director.restore()` before `relayout()`** (the props layer is read inside
  the style commit), then `relayout()`, **then the camera at duration 0** (after, because
  relayout's anchoring writes the viewport synchronously), then the run: `runCtl.reset()`
  on the same handle, a fresh compile, or `disposeRun()` with the compile inputs put back.
  `runCompiled: false` is distinct from "compiled with no options", so a backward seek
  never leaves a later step's inputs behind.
- **`seekTimeline(ms)`** pauses, finds the owning step (a label exactly at `ms` wins),
  `sb.seek(idx)`s, then `run.seek`s inside a `run.play` step. `scrubDepth` is a counter,
  not a boolean, because drag seeks overlap.
- The director's state re-asserts on every `commit` event, because a re-added id gets a
  blank element.

### `transport.js`

`createTransport(rootEl, controller)` mounts the `.smv-transport` bar (play/pause, step,
scrubber over `controller.timeline()`, speed 0.5/1/2/4, label readout) when
`controls: true`. `controller = {play, pause, next, prev, seek(ms), speed(f),
timeline(), on}` is defined in `index.js`, and seeking pauses before moving the head.

## Director (`director.js`)

`createDirector(internals)` takes `{root, captions, ticker, reduced, lastLayout(),
resolveId, emphasize, dim}`. It imports no renderer and touches no global document, and
tests run it against a fake host.

- **`resolveCameraTarget(opts, layout, size, current, resolveId?) → {x, y, k}`** is pure.
  The first matching form wins: absolute `x`/`y`(+`k`), then `node`, then `nodes` (union
  box), then `fit: true`, then relative `k`/`zoom` + `by: {dx, dy}`. Relative moves
  compose onto `current` (`viewport.target`). A box is fitted into
  `paneBox(size, pad, inset ?? size.inset)`. `maxK` caps only a *fitted* `k`; an explicit
  `k` is honoured. Every derived `k` is clamped to `MIN_K..MAX_K` **before** x and y are
  derived from it, otherwise the shot lands off-centre by the clamp ratio. Unknown ids
  resolve through `resolveId` (`vs.visibleAncestor`); an id that resolves to nothing drawn
  warns and the camera stays put. `g.camera()` goes through `viewport.moveTo`, not
  `viewport.fit`, so `FIT_MAX_K` never applies to it.
- **Emphasis:** a `Map<id, variant>` plus a dim `Set`, replaced rather than accumulated on
  each `highlight()`. `apply()` diffs the desired state against a `written` shadow and
  writes only differences. `reassert()` clears the shadow first, for elements the renderer
  rebuilt. `highlight({dim: true})` dims every drawn id (nodes and edges) that is not
  emphasised. Node ids resolve through `resolveId`; edges do not, because a hidden edge's
  stand-in is a meta-edge with a different id.
- **Captions:** a lazily-created `div.smv-caption` with `role="status"` (never
  assertive), `data-place` and `data-variant`. With `captions: false` the caption is still
  state (snapshotted, restored, readable via `captionText()` for cues), but no DOM is
  written.
- **Props layer:** `props(map, {merge})` validates the whole map (only `--smv-*`
  keys) before writing anything, so a rejected map leaves the previous layer in place.
  `propsLayer()` returns `Map<id, {key: value | null}>` and advances its own `wroteP`
  shadow, so **it must be read exactly once per style commit**; `relayout` and `styleNow`
  are its only callers. Keys the previous layer set arrive as `null`. In the renderer's
  `mergeProps`, `null` removes a property only if the style function is not setting it,
  so `g.props(null)` returns to the styled picture. `false` from the caller always removes.
  The renderer also applies the layer at `ensureNode()`, so re-added elements need no
  commit hook.
- **Pulse:** `highlight({pulse: true})` registers one ticker callback that writes one root
  property, `--smv-pulse`, quantised to 12 steps over a 1400ms cycle so a frame's markup
  does not depend on tick arithmetic. It is not a CSS animation, which is what keeps it
  deterministic under the manual ticker. It is removed from the ticker on
  `clearHighlight()`, on restoring a snapshot without a pulse, and on `destroy()` (before
  the `destroyed` flag is set). Under reduced motion it never registers and holds the peak
  value statically.

## Interaction and accessibility

### `interact.js`

`attachTapToggle(g, {svg, toggle = true, emit, onToggle})`. On `pointerdown` it resolves
the `.smv-node`/`.smv-edge` under the pointer, before the viewport's
`setPointerCapture` retargets the gesture. On `pointerup` it emits
`nodeclick`/`edgeclick` and toggles containers, but only within a 6px slop and with no
second pointer (pinch). `interaction.tapToggle === false` drops the toggle and
`interaction.click === false` drops the events.

### `a11y.js`

`attachA11y(g, {root, svg, emit, onToggle})` is attached by default and skipped with
`a11y: false`.

- `role="application"` with `aria-roledescription="graph"` on the svg, `role="tree"` on
  the nodes group, and on each node `role="treeitem"`, `aria-level`, `aria-label =
  label · status`, `aria-expanded` on containers, and a roving `tabindex`. Roles are
  re-applied after every `commit` by querying the DOM; this module never reaches into
  `render.js`.
- The status in the label is the live `data-run` value when a run drives the node,
  otherwise `data.status`. It refreshes on `runstatus`.
- The roving focus follows **real** DOM focus through `focusin`. When a commit removes the
  focused node, focus is re-homed to the new roving stop instead of falling to `<body>`.
- Tokens, edge labels and container chrome are `aria-hidden`; the treeitem's label is the
  authoritative name.
- Keys: arrows move through `readingOrder(layoutResult)`, which infers the rank axis from
  `order` (falling back to x then y), Home/End jump to the ends, and Enter/Space toggle a
  container.

### One toggle for both paths

`attachTapToggle` and `attachA11y` both take `onToggle(id)`. `index.js` passes the same
`readerToggle` to both, built from `interaction.tapToggle.camera`. It calls
`g.expand/collapse(id, {camera})` and then restores `cameraOwned`: the reader's tap sets
`userMoved`, but it does not hand the camera to a storyboard. Keeping one function for
both paths prevents Enter/Space and tap from disagreeing.

### `a11y-table.js`

`attachA11yTable(g, {visible = false}) → {el, destroy}` renders one row per visible node
(label, status, duration, depth, outgoing targets) and updates on `commit`, `update` and
`runstatus`. Only one rendering is in the accessibility tree at a time: while `a11y.js`
is attached the table is `aria-hidden`, and with `a11y: false` the table is the
accessible surface.

## Preset (`preset-pipeline.js`)

`applyPipelinePreset(g, opts)` works through public `g.on` subscriptions and DOM
adornments only. It adds duration chips with `durationAgg` rollups, status and mode
glyphs, the condense odometer and delta badge, and the `.smv-totalbar`. It reserves chip
room through `PIPELINE_MEASURE` (`layout.measure`) and injects its own styles. Applied
after mount, it back-fills the current layout synchronously so it matches
`preset: 'pipeline'` at mount. The boundary rules a preset must follow are in
[PRESETS.md](PRESETS.md).

## Export (`export.js`)

- `exportSVG(g, {pad = 24, theme, width, viewport})` clones the live svg, strips
  transport and interaction residue, inlines `CSS` from `styles.js` plus resolved theme
  properties, and returns a standalone SVG string. It builds strings where possible so
  Node tests can use a fake clone. The default document is the **whole graph**: the
  viewBox is `g.bounds()` plus `pad`, the viewport transform is dropped, and culling is
  cleared on the clone.
- `viewport: true` inverts both defaults on purpose: the pane is the viewBox, and the live
  transform and culling are kept, because the transform is the framing and culled
  elements are outside it. **If you change one default, change the other.**
- `exportPNG(g, {scale = 2, background})` renders SVG to an `Image`, then a canvas, then a
  `Blob`. It is browser-only and rejects cleanly under Node.

## CLIs (`bin/`)

Usage is documented in [EMBED.md](EMBED.md) (`smv-pack`) and
[RECORDING.md](RECORDING.md) (`smv-record`, `--cues`, `smv-fit`). No `bin/` file costs
bundle size, and `cues.mjs` and `smv-fit.mjs` import nothing from `src/`. Invariants a
change there must keep:

- **Direct-invocation guard.** Every bin compares `import.meta.url` with
  `pathToFileURL(realpathSync(process.argv[1]))`, because npm installs bins as symlinks
  and paths with spaces are percent-encoded on one side only.
- **`smv-pack --record`** emits the recording mount (`controls: false, captions: true,
  autoplay: false, ticker: "manual", motion: "full"`, and `window.__smv`). Without
  `--record` the output bytes are unchanged, which `test/record-cli.test.js` asserts.
- **`smv-record` is wall-clock free.** It waits for `document.fonts.ready` (node boxes
  depend on text metrics), disables interaction, measures `timeline()`/`cues()`, then
  alternates `ticker.tick(frameMs)`, settle, and screenshot. A story containing a
  `run.play` is measured only after calling `g.run()`, because the record page does not
  autoplay and `run.play` slices come from the compiled run. Settling turns the macrotask
  queue 2 to 8 times until the observable signature repeats. The declared timeline is the
  **floor** of a take, not its cut: the loop continues while the story is unfinished, up
  to 2000ms past the total, then writes the tail. Mode B stories are refused before
  launch; the check looks only at `run.play` step options, never at node `data`.
- **Ranges** (`--from`/`--to`) play from step 0 and move only the capture window;
  seeking would skip tweens. Skipped frames still get one `requestAnimationFrame`
  round-trip each, so a slice is byte-identical to the matching frames of a full render.
- **The ffmpeg sink** honours backpressure (awaits `drain`), races every wait against the
  child's `close`, surfaces ffmpeg's last stderr lines, and aborts with SIGKILL and
  unlinks the partial file, never leaving a finalised half-story. Ctrl+C takes the same
  path synchronously: ffmpeg is spawned `detached`, chromium's own signal handlers are
  off, and `sink.abortSync()` runs from the signal handler. The exit code is 130 or 143.
  `$SMV_FFMPEG` overrides the binary.
- **`--font`** pins both drawing and measurement. The record page injects `@font-face`
  and also patches the 2D-context `font` setter, because `measure.js` sizes boxes with
  canvas `measureText` against `system-ui`, which CSS cannot redefine. The pin is
  verified twice, by the file's magic bytes before launch and by the page's
  `document.fonts` status after mount, because a failed face otherwise renders silently.
- **Cue sheets** (`cues.mjs`) are written before the frame loop. `.srt` spans close at
  `mediaEnd` (story plus tail), so a caption on the last step survives. `.srt` and `.txt`
  rebase onto a `--from/--to` range; `.json` stays on the story clock and carries `range`.
- **`smv-fit`'s `durOf` is a copy of `index.js`'s**, since the original is a closure
  inside `mount()`. `test/fit-cli.test.js` mounts `test/fixtures/record-demo.*` and
  asserts that `labelOffsets()` equals the label half of a real `g.cues()`. That test is
  the contract between the two copies. Fitting walks backwards, distributes budget to
  waits proportionally (integer shares), and is idempotent.

## Build, size and tests

- `scripts/build.js` bundles `src/index.js` with esbuild into `dist/smv.esm.js` and
  `dist/smv.iife.min.js` (global `SparkleMotion`), plus `build/smv.core.esm.js`, a metric
  bundle with `./engine.js` external that is never published. Template-literal
  stylesheets are run through esbuild's CSS minifier for the minified bundles.
  `assertNoDagre()` fails the build if dagre reaches any default bundle.
- `scripts/size-budget.js` builds, then hard-fails if min+gzip reaches **50KB** for the
  core metric or **55KB** for the IIFE. Raise a budget deliberately, never to hide a leak.
  README's size table reports the current numbers.
- `scripts/check-doc-versions.mjs` fails if a doc pins a version other than
  `package.json`'s.
- `npm run check` runs tests, build, size and doc versions. `npm run types` type-checks
  `types/` against `types/check.ts`, which exercises the public surface; update both when
  the API changes. CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test` and
  `npm run size`.

### Layout gates

- Golden layouts (`test/golden/*.json`) use fixtures with explicit node `w`/`h`, which
  keeps `sizeNode` out of the loop. Regenerate them with `node test/golden/update.js`,
  and only when a layout change is intended.
- Coordinate parity with dagre is **not** a goal. The gates are structural: every forward
  edge advances along the rank axis, visible siblings never overlap, children sit strictly
  inside container rects after padding, back edges are drawn below the flow (LR), and
  self-loops are side arcs. Crossings must not regress: each golden fixture's crossing
  count stays at or below `DAGRE_CROSSINGS` in `test/golden/crossing.js`. Those numbers
  are hard-coded on purpose, so the bar never moves with the engine and the tests need no
  dagre. If the bar fails, fix the engine, not the bar.
- `test/engine-parity.test.js` runs both solvers over the fixtures and about 40 seeded
  synthetic graphs, asserts the invariants above, allows the engine at most dagre's
  crossings + 2 on non-goldens, and checks append stability with `prevOrder`.

### End-to-end scripts

The browser scripts are not part of `npm test`. Run them directly with `node`. They use
`scripts/harness.mjs` (`findChromium`, `serveRoot`) and need chromium (the pre-installed
one at `/opt/pw-browsers/chromium` is found automatically).

| script | page / fixture | asserts |
|---|---|---|
| `test/e2e-m0.mjs` | `demo/m0.html` | no errors; back edge keeps its side across overlapping appends; finite positions |
| `test/e2e-m1.mjs` | `demo/pipeline.html` | the flagship story: fan-out at distinct rates, `all` join, retry loop to 3/5, expand, condense with odometer, clean backward/forward scrub |
| `test/e2e-m2.mjs` | `demo/m2.html` | live run (occupancy, seek clamped at `now`, `follow`), condense/split round trip, edge labels through relayout, collapseAll/expandAll, keyboard/ARIA, SVG/PNG export |
| `test/e2e-m3.mjs` | `demo/pipeline.html`, `demo/m3-scale.html` | the flagship story on the in-house engine, no dagre in the IIFE, structural parity, 300-node culling, pan-frame cost |
| `test/e2e-m4.mjs` | `test/fixtures/record-demo.*` | two `smv-record` takes byte-identical frame for frame (pulse included), frame count against the declared timeline, settled tail, mp4/cues/range/font/SIGINT paths; ffmpeg and font sections skip with a notice when the environment lacks them |

`node scripts/check-demos.mjs --all` smoke-tests every demo page. It waits for
`g.finished` (or the older `window.__smvExit`) and fails on page errors, console errors,
`[smv:` warnings, or non-finite geometry.
