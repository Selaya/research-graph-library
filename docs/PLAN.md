# sparkle-motion-vizualizer — an embeddable, animated graph visualization library

**Design plan · 2026-08-29**

*(Name: **`sparkle-motion-vizualizer`** — verified free on npm (2026-08-29), as is the
alternate spelling `sparkle-motion-visualizer`. Browser global: `SparkleMotion`;
short prefix for files/CSS: `smv`.)*

---

## 1. Goals

A small JavaScript library for rendering and **animating** graphs, embeddable in a plain
HTML page with a single `<script>` tag — no build step, no server, no framework.

Requirements, from the motivating use case (visualizing a pipeline of work):

| # | Requirement |
|---|---|
| R1 | Single-file embed: one script tag (IIFE) or one self-contained HTML file; ESM for bundler users |
| R2 | Declarative JSON graph spec + imperative mutation API |
| R3 | Animation is first-class: append nodes/edges over time, smooth transition on *any* graph change |
| R4 | Hierarchical compound nodes with per-node animated expand/collapse (step ⇄ substeps) |
| R5 | Graph morphing: N nodes **condense** into 1 (manual steps → automated step), with the time saved communicated visually |
| R6 | Animated progression ("stepping") through the pipeline, with play/pause/step/scrub controls |
| R7 | **Loops/cycles**: the graph is not necessarily a DAG; progression can step through loop iterations |
| R8 | **Parallelism**: fan-out into branches progressing simultaneously at different rates; fan-in with join semantics |
| R9 | Generalized: pipelines are the motivating case, not the boundary of the design |
| R10 | Size: core well under ~50KB min+gzip (see §9 for the honest math) |

Non-goals (v1): huge graphs (>2,000 visible nodes), force-directed physics, WebGL,
graph *editing* UI (drag-to-connect), React/Vue bindings, a text DSL à la Mermaid.

---

## 2. Why build (landscape verdict)

Seven parallel research passes surveyed the landscape and measured real shipped artifacts
(npm tarballs, `gzip -9` on the actual `dist/*.min.js` — third-party size sites were
unavailable, so these are first-hand numbers):

| Library | min+gzip (measured) | Fatal problem for our use |
|---|---:|---|
| cytoscape.js core | 136.4KB | 2.7× the entire budget before extensions; animation is generic tweening, no morph/playhead semantics |
| vis-network | 62KB (esnext) / 150KB (standalone) | monolith with always-on physics; no compound model, no layered layout |
| sigma.js + graphology | 61KB | WebGL flat-network renderer; no hierarchy, no layered layout; own docs recommend DOM-based tools at our scale |
| AntV G6 / X6, JointJS+, GoJS | 90–300KB+ / commercial | heavy, bundler-oriented, or the needed features are behind a paid tier |
| mermaid | 953KB (UMD) | static render-once architecture; no mutation, no animation API |
| React Flow / reaflow | n/a | require React + a build step |
| elkjs (layout only) | **464.6KB** | disqualified outright (GWT-compiled, async/worker-only, EPL/GPL) |
| **@dagrejs/dagre 3.1.1 (layout only)** | **17.1KB** | ✅ viable — MIT, active (3.1.x shipped Aug 2026), sync, **graphlib inlined in dist/dagre.min.js (verified: self-contained IIFE, no external requires)** |

Three requirements together form a filter nothing passes: (R1 + R10) small/no-build,
(R3 + R5 + R6) narrative animation, (R4) built-in animated compound expand/collapse.
Everything small is too shallow; everything capable is too big, commercial, or
framework-coupled. **No surveyed library has a "condense N→1 with a speed-up cue"
primitive at all** — the differentiating work is ours to build regardless.

What we borrow (patterns, not code):
- **cytoscape.js**: flat node/edge JSON with `parent` for hierarchy; batch mutations.
- **cytoscape-expand-collapse**: collapsed container becomes a real proxy node with synthesized **meta-edges** aggregating child edges.
- **ECharts `universalTransition`**: the groupId/childGroupId correspondence idea → our explicit `condense()`/`split()`.
- **vis-data DataSet**: add/update/remove verbs + event emitter.
- **D3**: keyed enter/update/exit diffing as the internal reconciler (the single highest-leverage idea: the library diffs old vs new state and *generates* the transition; callers never hand-author animations).
- **GSAP/WAAPI**: the timeline transport surface (play/pause/seek/labels/speed).
- **dagre 3.1**: `useDynamic` order-stability and recursive cluster layout as reference designs.
- **BPMN token simulation / Petri nets / Temporal / Airflow / Dagster**: token semantics and run-visualization conventions (§6).

Mistakes we deliberately avoid: bundled physics engines (vis-network), Java-compiled layout
(elkjs), kitchen-sink bundles (mermaid), paywalling the hard parts (JointJS+/GoJS), and
essential features as separately-versioned extensions (cytoscape ecosystem) — expand/collapse,
layout, morph, and the token engine are **core**, not plugins.

---

## 3. Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│  Public API   mount() · mutations · run (tokens) · storyboard  │
├────────────────────────────────────────────────────────────────┤
│  Graph store      flat spec, validation, keyed diff, snapshots │
│  Layout           frozen layout(view) interface                │
│                   M0–M2: @dagrejs/dagre  ·  M3: in-house       │
│  View state       expand/collapse, meta-edges, back-edge marks │
│  Token engine     schedule compile (Mode A) / event log (B)    │
│  Animation core   ONE rAF clock · FLIP · path resampling ·     │
│                   interruption queue (cancel-and-retarget)     │
│  SVG renderer     nodes/edges/arrowheads/badges · style commit │
│  Chrome           pan/zoom/fit · transport bar · preset-pipeline│
└────────────────────────────────────────────────────────────────┘
```

Everything flows one way: **spec mutation → view state → layout → diff → animated commit**.
The token engine is orthogonal: it never mutates the graph, it *decorates* it
(token positions, progress fills, badges) sampled from `stateAt(t)` each frame.

---

## 4. Core decisions

Each decision below was pressure-tested by an adversarial critique pass across the
research reports; where reports conflicted, the resolution and reasoning are noted.

### D1 — Rendering: pure SVG, one rAF clock

SVG (`<svg><g id=viewport>`), nodes as `<g><rect><text>`, edges as `<path>`. Rationale:
- Our stress case is a bounded ~400–900ms transition over ≤ a few hundred elements —
  roughly 20–50 frames of work, an order of magnitude below where SVG DOM updates
  struggle (continuous force simulations at 300–400+ nodes; Canvas only wins at
  *tens of thousands of edges* per cytoscape's own WebGL benchmarks).
- Native hit-testing, native text, real DOM accessibility, and **export for free**
  (the SVG *is* the document — serialize it; PNG via canvas rasterization).
- Every ready-made engine already blows the size budget, so we hand-roll regardless;
  SVG is the cheapest thing to hand-roll on.

**One clock.** All choreographed motion is driven by a single rAF loop reading one
WAAPI `Animation` on a detached element used purely as a **clock source** — that gives
`currentTime`/`playbackRate`/`reverse()` (free play/pause/scrub/speed) without splitting
animation across compositor and main threads (mixed WAAPI-transforms + rAF-edges would
let edges visibly detach from nodes under jank; uniform is better than fast-but-torn).
CSS transitions are allowed **only** for non-choreographed affordances (hover/focus) —
they are not seekable and may never participate in storyboard steps.
Compositor offload is a profiling-driven M3 optimization, not a design premise.

**Edge geometry:** before/after paths routinely have different point counts (layered
layouts insert dummy-node bends), so naive control-point lerp is impossible. Resample
both paths to N=24 points by arc length (`getPointAtLength` on a detached path, ~25 LOC),
then lerp pointwise. One code path serves every edge transition: reroute, redirect on
condense, expand/collapse. Budget ~2KB.

**Two known traps, designed around from day one:**
- *Container growth ≠ scale.* Expanding a compound node must animate `width`/`height`
  on the rect (SVG2 geometry properties) with the label repositioned per frame — a
  `scale()` on the group would zoom stroke widths and text.
- *Arrowheads:* SVG `marker-end` doesn't inherit stroke color reliably and animates
  poorly; draw the head as a small `<path>` positioned/rotated at the border-clipped
  endpoint (ray–rounded-rect intersection, recomputed per frame while node sizes animate).

### D2 — Layout: dagre now, in-house later, behind a frozen seam

Sequencing resolved by the critique against both original recommendations:
**M0–M2 use `@dagrejs/dagre` 3.1.x** (17.1KB gzip *including* graphlib — verified in this
session by unpacking the tarball: `dist/dagre.min.js` is a self-contained IIFE), because it
already solves the three hardest sub-problems in battle-tested MIT code: compound cluster
space reservation, order stability across re-layouts (`useDynamic`), and cycle breaking
(`acyclic.run/undo`). The "sync layout is needed for per-frame animation" argument is a
false premise — layout runs **once per mutation**, we tween between two static results.

**M3 replaces it** with an in-house layered engine (longest-path ranking + median/barycenter
ordering with old-order tie-breaks + simplified coordinate assignment + nesting border
nodes), gated on golden-file parity tests and a crossing-count non-regression. Realistic
estimate: **2,000–2,800 LOC, ~10KB gzip, 3–5 weeks** (the optimistic 4–8KB/1,400-LOC figure
double-counted TypeScript overhead; and the canonical Brandes–Köpf coordinate algorithm had
flaws found 18 years post-publication — we ship a simpler heuristic on purpose).

The only plugin seam in v1, frozen at M0 so the swap is a 40-line change:

```
layout(graphView, opts) -> {
  nodes:  { [id]: {x, y, w, h} },
  edges:  { [id]: { points: [{x,y},...], reversed?: true } },
  bounds: {x, y, w, h}
}
```

### D3 — Cycles are first-class (R7)

Layered layout requires acyclic input, so cycle handling is a **cycle-breaking phase**,
never a rejection:

- **Detection:** DFS back-edge detection (dagre's default `dfsFAS`, ~40 lines of logic) —
  deterministic and predictable for human-authored graphs. Greedy Eades–Lin–Smyth FAS is a
  possible later opt-in; never the default.
- **Reversal is bookkeeping, not semantics:** edges are flipped only inside the ranking
  pass, tagged `reversed`, and restored for rendering — arrowheads always show true
  direction; the `reversed` flag feeds distinct styling *and* tells the token engine which
  hops are loop-backs.
- **Back edges must read as loops, not glitches:** self-loops render as a side-arcing
  spline bowing out of the node (Graphviz/dagre convention — explicitly not Mermaid's
  known-buggy through-the-node kink). Multi-node back edges route as arcs on **one
  consistent side** of the flow (the 2025 VEIL CFG paper's finding: consistent-side
  grouping is what makes nested loops legible), in a distinct visual channel (dashed,
  muted color).
- **Loops × containers:** a loop wholly inside a *collapsed* container is a **loop-marker
  badge** on the container (BPMN convention: `retry ≤5` glyph), revealed as a real back
  edge only on expand. A loop spanning containers routes entirely outside their bounding
  boxes, attached to fixed boundary ports.
- **Stability:** pin the previous cycle-breaking choice across re-layouts (stable edge IDs
  + prefer-previous-reversal, mirroring dagre 3.1's dynamic mode) — otherwise appending a
  node can make an unrelated loop visually flip sides, a mental-map violation.

### D4 — Progression is a token engine, not a playhead index (R6, R7, R8)

A scalar playhead cannot represent loops or concurrent branches. The primitive is the
**token**: an individually-identified activation living on a node or edge, with its own
entry time, duration, **rate multiplier**, and per-loop iteration counters
(Petri-net individual-token semantics; the model behind bpmn-js token simulation and
every workflow engine's run view).

- **Fan-out is implicit:** a completing node with k out-edges spawns k child tokens —
  the linear pipeline needs zero new syntax. Explicit `gateway:exclusive` nodes exist
  only for conditional single-path branching (not inferable from shape).
- **Fan-in is a node join policy:** `join: "all" | "any" | {count:k}` — statically
  decidable thresholds only. General dynamic OR-join is **deliberately unsupported**
  (YAWL's research shows it is deadlock-prone and needs reachability lookahead);
  documented limitation.
- **Loops:** a `loop: true` back edge with **mandatory `maxIterations`** (compile
  rejects unbounded), or `iterate: {maxTimes, until}` sugar on a group that desugars to
  one. Collapsed rendering: `iter 2/5` badge; per-iteration ticks pulse a counter
  in place (the Temporal/Airflow/Argo convention) rather than re-flying the arc every
  time — the literal traversal animation plays on the first iteration and on demand.
- **Two backends, one interface** (`TokenState[] = stateAt(t)`), one renderer:
  - **Mode A `simulate`** (default): durations are declared, so a discrete-event
    compile pass produces a flat time-sorted schedule up front → `seek`/scrub/reverse/
    per-branch `speed()` are trivial O(log n) sampling. This is the demo/sharing mode.
  - **Mode B `live`**: an append-only event log (`run.start(id)`, `run.finish(id)`,
    `run.spawn(id, n)` for runtime fan-out) with deterministic replay up to `t` —
    Temporal-style time-travel into history; you cannot scrub past `now`.
- **`step()` semantics:** advance the virtual clock to the *next event boundary across
  all live tokens* — collapses to "next node" when one token is live; `step({token})`
  advances one branch while others hold.
- **Rendering concurrency legibly:** one moving pulse per token (positioned by arc-length
  interpolation along the edge path), per-node progress fill while a token dwells,
  occupancy badge (`×3`) when several tokens share a node, k-slot fill on join nodes with
  a converge-burst when the policy fires, ghost-fade for branches mooted by `any`/`count`
  joins. All sampled from `stateAt(t)` inside the single rAF loop — **never** one WAAPI
  animation per token (unbounded fan-out is exactly how Airflow's graph view fell over).

**Token ↔ morph boundary rule:** structural morphs and token time are independent axes.
When `condense()` removes nodes that hold live tokens, tokens remap to the target node,
carrying `max(progress)` of their sources; tokens on plainly-removed nodes ghost-fade out.
Storyboards should normally sequence morphs *between* token steps, but the mid-flight
rule above is defined so nothing corrupts.

### D5 — Compound expand/collapse (R4)

The four-step relayout (no report had it fully right; this is the reconciled pipeline):

1. Lay out the child subgraph **in isolation** → child bbox.
2. Set the compound node's w/h = child bbox + padding + header strip.
3. Re-run the **parent** layout with the node at its new size (this is what reflows
   siblings and grows the canvas — "sublayout then translate" alone overlaps siblings).
4. Translate children into the container's final rect.

Then FLIP the whole result: survivors tween old→new, children enter from the container's
collapsed centroid; collapse is the exact inverse. While collapsed, boundary edges
aggregate into **meta-edges** with a dedupe rule (N child edges → same external target
collapse to one edge carrying `weight: N`, badged); while expanded, edges attach to the
actual child, not the container.

### D6 — Condense / split (R5)

`condense(ids, newNodeSpec)` is a first-class op (merge semantics can't be inferred from
a diff). Guards: the set must be **convex** — no path may leave the set and re-enter
(otherwise `A→B→C` condensing `{A,C}` silently creates `M→B→M`); ~15-LOC DFS check,
named error. Redirected edges dedupe with weights.

Choreography (Heer & Robertson staged-transition principle; total ≤ 900ms):
1. **Highlight** (~150ms): sources get a shared glow + a bracket beneath — the eye
   registers *what* is about to merge before anything moves.
2. **Converge** (~450ms): sources FLIP toward the target centroid, shrinking; incident
   edges retarget on the same clock; at ~70% a crossfade swaps in the merged node
   (avoids an N-overlapping-rects frame).
3. **Reveal** (~300ms): merged node settles with a slight overshoot ease. **Core stops
   here.** The pipeline preset (subscribed to the `condense` event) adds the payoff:
   duration chip odometer-rolls `2h → 8s`, the in-node duration bar shrinks to a sliver,
   a transient `−99.9% · 14× faster` delta badge pops.
   (Separation per critique: core knows nothing about durations.)

`split(id, nodes[])` is the reserved inverse; API reserved in v1, implemented M2.

### D7 — One styling mechanism

Style resolution runs at **commit time** (on mutation), never per frame, and writes only
(a) `data-*` attributes and (b) CSS custom properties (`--smv-fill`, `--smv-stroke`, …).
The default theme is a stylesheet consuming those properties → CSS-only theming, devtools
inspectable; user style functions *set custom properties*, composing with CSS instead of
fighting it (no precedence rules needed). Rejected: sigma-style per-frame reducers
(immediate-mode artifact, waste in a retained DOM), cytoscape-style selector-string
stylesheets (a parser is real KB), inline-style-always-wins (clobbers theming).
One deduped global `<style>` (guarded by a marker), instance values on the mount root —
multi-instance safe.

### D8 — Storyboard: JSON ops are the primitive, seek via snapshots

The serializable op array `[{op, args, at?, label?}]` is the **only** primitive; the
fluent `g.timeline().to(...)` builder is ~20 lines of sugar that produces it. One dispatch
table, one test surface, and the shareable-HTML story needs zero authored JS.

Structural ops aren't reversible, but `seek()`/`stepBack()` must be: **snapshot per step**
(graphs are tens of nodes; structural clones are kilobytes). `seek(k)` = restore snapshot
k, then let the standard keyed diff animate from the *current visual state* — which also
delivers the "reconciler auto-generates transitions" property everywhere for free.
`prefers-reduced-motion`: durations → ~0 (fast crossfade), **sequencing and waits
preserved** (otherwise the narrative fires instantly and reads as broken).

### D9 — Interruption: cancel-and-retarget

The #1 source of visual corruption in graph animation, designed in at M0: on any new
operation mid-transition, sample every element's **current interpolated** position, use
it as the new FLIP "First", cancel outstanding tweens, start one new transition. Never
queue-sequentially (laggy), never let two transitions write one element.

### D10 — Viewport: anchored, not auto-fit

Auto-`fitView` after every change would superimpose a viewport tween on the FLIP tween
(object constancy destroyed) and steal deliberate user pan/zoom. Instead: fit on mount
and explicit `fitView()` only; after a mutation, keep the operation's **focal node
stationary in screen space** (translate-only correction on the same clock); auto-refit
only when new content lands fully outside the viewport. Zoom on ctrl/cmd+scroll or
pinch — never hijack plain page scroll (a documented GitHub-Actions-graph complaint).

### D11 — Distribution

`dist/smv.esm.js` (tree-shakeable) + `dist/smv.iife.min.js` (global `SparkleMotion`)
on npm → jsdelivr/unpkg. No required external CSS/fonts/assets (styles injected). No
plugin registry in v1 (an un-walk-backable API commitment; optional pieces are ESM-only
entries; the IIFE is a monolith containing exactly what the pipeline demo needs).
A self-contained single-`.html` export is a **docs recipe + optional tiny CLI**, not a
runtime feature (`exportHTML()` at runtime would require the bundle to embed its own
source — cut). CI enforces a hard size budget from M0.

### D12 — The declared timeline is the contract (M4)

Every storyboard step is worth a specific number of milliseconds — its own `dur` field, or
the op's default — and the scrubber, `g.cues()` and the frame renderer all read that one
number, so they cannot disagree about where a step sits. Replaces the flat
`NOMINAL_STEP_MS = 400` guess, which no op honoured (condense actually costs 900ms, a
camera move 600, a label or a highlight nothing at all). `dur` is published as an ambient
value for the whole op, so every existing mutation gains per-step pacing with no signature
change.

### D13 — The script may take the camera (M4)

A storyboard containing at least one `camera` op owns the viewport for the duration of
playback: `{x,y,k}` + `userMoved` join the G2 snapshot, and the first camera move sets
`userMoved` so relayout's auto-refit stops landing on top of composed shots. Gated on that
op being present — snapshotting the camera unconditionally would yank an existing
interactive storyboard's viewport back on every seek, undoing a pan the reader just made.
Camera moves ride the shared ticker and cancel-and-retarget like everything else (D1/D9).

### D14 — Emphasis and captions are discrete state, not motion (M4)

`data-emph` / `data-dim` flips plus one DOM overlay (`.smv-caption`), snapshotted as state
and never tweened in v1. Highlights are replace-not-accumulate: one call IS the emphasis
state. Deliberately not CSS-transitioned — a wall-clock transition is nondeterministic
under frame capture, which is the whole point of the renderer that consumes this.

### D15 — Recording mode overrides the environment (M4)

`opts.motion:"full"` forces `reduced = false`; `opts.ticker:"manual"` builds the shared
clock with `createTicker({manual:true})` so the renderer steps it frame by frame instead of
riding rAF; and the root gets `data-smv-record`, which disables every CSS transition and
animation beneath it. Together these make two captures of the same frame byte-identical.

---

## 5. Data model & API

### 5.1 Graph spec

```js
const spec = {
  nodes: [
    { id: "ingest", label: "Ingest",  data: { duration: "45m", status: "done" } },

    // Hierarchy: any node referenced as `parent` renders as a container.
    { id: "clean", label: "Clean data", collapsed: true,
      data: { duration: "2h", status: "active", mode: "manual" } },
    { id: "clean.dedupe",    parent: "clean", label: "Dedupe",    data: { duration: "30m" } },
    { id: "clean.validate",  parent: "clean", label: "Validate",  data: { duration: "1h"  } },
    { id: "clean.normalize", parent: "clean", label: "Normalize", data: { duration: "30m" } },

    // Parallel fan-out needs no gateway: three out-edges from "collect" IS the fan-out.
    { id: "collect" },
    { id: "lint", data: { duration: "8s"  } },
    { id: "unit", data: { duration: "40s" } },
    { id: "e2e",  data: { duration: "3m"  } },

    // Fan-in: join policy lives on the node.
    { id: "report", join: "all" },          // also: "any" | { count: 2 }

    // Loop as a group: collapsed → "iter i/5" badge; expanded → animated back edge.
    { id: "deploy", type: "group", iterate: { maxTimes: 5, until: "ctx.healthy" },
      children: ["deploy.push", "deploy.check"] },
  ],
  edges: [
    { id: "e1", source: "ingest", target: "clean" },
    // Low-level loop form: an explicit back edge (maxIterations is mandatory).
    { id: "retry", source: "deploy.check", target: "deploy.push",
      loop: true, maxIterations: 5 },
    // ...
  ],
};
```

`durationAgg: 'sum' | 'max'` on containers controls whether a collapsed parent shows the
sequential sum or the parallel max of its children (default `sum`) — so the flagship
"2h → 8s" claim stays numerically consistent through expand/collapse.

### 5.2 Mount

```html
<div id="pipe" style="height:480px"></div>
<script src="https://cdn.jsdelivr.net/npm/sparkle-motion-vizualizer@1/dist/smv.iife.min.js"></script>
<script>
  const g = SparkleMotion.mount("#pipe", spec, {
    theme: "auto",                       // "light" | "dark" | "auto" | token object
    layout: { dir: "LR" },
    animation: { duration: 350, easing: "cubic-out" },
    controls: true,                      // transport bar: play/pause/step/scrub/speed
  });
</script>
```

### 5.3 Mutations — every call returns an awaitable, cancelable Transition

```js
await g.addNode({ id: "monitor", data: { status: "pending" } }, { after: "deploy" });
await g.addEdge({ id: "e9", source: "deploy", target: "monitor" });
await g.update("clean", { data: { status: "done" } });   // property tween
await g.expand("clean");                                  // 4-step relayout + FLIP
await g.collapse("clean");

await g.condense(
  ["clean.dedupe", "clean.validate", "clean.normalize"],  // must be convex
  { id: "clean.auto", label: "Automated cleaning",
    data: { duration: "8s", mode: "automated" } }
);

g.batch(() => { g.addNode(...); g.addEdge(...); });       // one relayout+transition

g.on("condense", ({ sources, target, sourceData, targetData }) => { /* preset hooks here */ });
```

### 5.4 Run control (token engine)

```js
const run = g.run({ mode: "simulate" });   // Mode A: compiled schedule (default)

run.play();  run.pause();
run.seek(12000);            // ms of pipeline time — cheap, schedule is precomputed
run.speed(2);               // global; and per branch:
run.speed(0.25, { branch: "e2e" });
run.step();                 // next event boundary across ALL live tokens
run.step({ token: "unit" }); // advance one branch, others hold

run.on("join",  ({ nodeId, arrived, dropped }) => {});
run.on("loop",  ({ loopId, iteration, max }) => {});

// Mode B mirrors a real pipeline: same renderer, event-sourced.
const live = g.run({ mode: "live" });
live.start("build"); live.finish("build");   // auto-spawns into out-edges
live.spawn("process_files", 12);             // runtime fan-out cardinality
live.seek(pastT);                            // time-travel replay; can't scrub past now
```

### 5.5 Storyboard (what a shared HTML file replays)

```js
SparkleMotion.mount("#pipe", spec, {
  controls: true, autoplay: false,
  storyboard: [
    { op: "run.play",  until: "clean" },
    { label: "expand" },
    { op: "expand",    args: ["clean"] },
    { op: "run.play",  until: "deploy" },
    { label: "automate" },
    { op: "condense",  args: [["clean.dedupe","clean.validate","clean.normalize"],
                              { id: "clean.auto", data: { duration: "8s" } }] },
    { op: "run.play" },
  ],
});
// g.timeline().to(...).label("automate")... is sugar that emits exactly this array.
```

### 5.6 Styling

```js
g.style(n => ({ "--smv-fill": statusColor[n.data.status],
                "--smv-w": 60 + Math.sqrt(n.data.durationSec || 0) }));
```
```css
.smv-node[data-status="done"]   { --smv-fill: var(--ok); }
.smv-edge[data-back-edge]       { stroke-dasharray: 4 3; opacity: .7; }
```

### 5.7 Director ops (M4 — camera · highlight · caption · pacing)

The same serializable op array (§5.5), four more ops. They dispatch through the ordinary
`g[op](...args)` branch, and every step may carry `dur` — the declared timeline (D12) that
the scrubber, `g.cues()` and the frame renderer all read.

```js
SparkleMotion.mount("#pipe", spec, {
  controls: true,
  storyboard: [
    { "op": "camera", "args": [{ "node": "clean", "k": 1.8, "pad": 60, "dur": 700, "ease": "cubic-in-out" }], "dur": 700 },
    { "op": "camera", "args": [{ "nodes": ["a", "b"], "pad": 48 }] },      // union box
    { "op": "camera", "args": [{ "fit": true, "pad": 24, "dur": 800 }] },  // whole graph
    { "op": "camera", "args": [{ "x": 120, "y": -40, "k": 1.25 }] },       // absolute transform
    { "op": "camera", "args": [{ "by": { "dx": -200, "dy": 0 } }] },       // screen-px pan
    { "op": "camera", "args": [{ "zoom": 1.6 }] },                         // × about the pane centre
    { "op": "highlight", "args": [{ "nodes": ["a"], "edges": ["e1"], "variant": "focus", "dim": true }] },
    { "op": "clearHighlight" },
    { "op": "caption", "args": ["Some narration text", { "place": "bottom", "variant": "note" }] },
    { "op": "caption", "args": [null] },                                   // clear
  ],
});
```

- **camera** target resolution, first match wins: absolute `x`/`y` (+`k`) → `node` →
  `nodes` → `fit:true` → relative `zoom`/`k` + `by:{dx,dy}`. A box target centres the box;
  `k` on it is an explicit scale, else the box is fitted with `pad` (default 24). `zoom`
  and a bare `k` scale about the pane centre; `by` is a screen-px nudge applied after any
  zoom. Relative moves compose onto the *target* transform, never a mid-tween sample (D9).
  Default `dur` 600, `ease` `"cubic-in-out"` (ease ∈ `linear | cubic-out | cubic-in-out |
  overshoot`). An unknown node id means "stay put", not "fly to the origin".
- **highlight** is replace-not-accumulate (D14): one call IS the emphasis state.
  `variant ∈ focus | warn | ok | mute`; `dim:true` makes it a spotlight — everything drawn
  and not selected gets `data-dim`.
- **caption** writes one `role="status"` overlay; `place ∈ bottom (default) | top`,
  `variant:"note"` mutes it. `captions:false` at mount suppresses the overlay only — the
  text stays snapshotted and stays in `g.cues()`.
- **`dur` on any step** (not just these four) is ambient for the whole op, so a mutation
  step paces its relayout without a signature change. What a step is worth without one:
  label 0 · `wait` its ms · camera 600 · highlight/clearHighlight/caption 0 ·
  `run.step`/`run.seek` 0 · condense/split 900 (the choreography's real cost) · batch the
  max of its members (one commit, parallel) · every other mutation the mount's
  `animation.duration` (350).

---

## 6. How the motivating scenario looks

**Visual language** (pipeline preset): rounded-rect cards; left accent bar in status
color; status glyph (clock=pending, pulsing dot=active, check=done); duration chip
top-right; hand badge = manual, bolt badge = automated; containers get a stacked-card
shadow + chevron, so "has substeps" reads at a glance.

**The narrative a shared file plays:**

1. **Pipeline appears** — steps fly in left-to-right as `addNode` appends land.
2. **Run** — a bright token pulse travels each edge (~300ms/hop; 600–900ms felt too slow
   across a 12-step pipeline); traversed edges keep a persistent progress fill; the
   active node shows an internal fill bar for its dwell time; arrival pulses, then the
   node settles to done-green. At the fan-out, the pulse **splits into three tokens**
   moving at visibly different rates (lint sprints, e2e crawls); the join node fills
   three slots and fires a converge-burst when the last arrives. At the deploy loop,
   the token loops the back-edge arc once, then the badge ticks `iter 2/5 · 3/5 …` in
   place with a pulse per iteration.
3. **Drill in** — clicking *Clean data* grows the card into a container
   (width/height animation, never scale); its three substeps bloom from the container's
   centroid with a ~12ms stagger; siblings glide aside (FLIP); the viewport shifts only
   enough to keep the expanded node anchored.
4. **Automation lands** — the three manual substeps glow with a bracket beneath
   (*highlight*), sweep into a single point while their edges follow (*converge*),
   and the new *Automated cleaning* node settles with a slight overshoot (*reveal*)
   as its duration chip odometers `2h → 8s` and a `−99.9%` badge pops (*preset payoff*).
   The whole pipeline compacts; the total-duration bar under the graph shrinks
   proportionally.
5. **Replay/scrub** — the transport bar scrubs backward to "before automation" and
   forward again; every transition replays from snapshots with no corruption.

Everything above decomposes into the general primitives (state styling, token engine,
expand/collapse, condense, storyboard); only the duration chips, odometer, badges, and
total-duration bar are `preset-pipeline`.

---

## 7. Milestones

### M0 — Walking skeleton
*A static graph renders; one mutation animates correctly; the foundations that are
painful to retrofit are in.*

- Graph store + validation (dup ids, dangling endpoints; **cycles allowed** and back
  edges detected/tagged, not rejected).
- Text measurement via offscreen canvas `measureText` (SVG text width without reflow) → node sizing; truncation.
- SVG renderer: nodes, edges, hand-drawn arrowheads clipped to node borders, style
  commit as `data-*` + custom properties.
- Layout via `@dagrejs/dagre` behind the frozen `layout()` seam; back-edge styling +
  self-loop side arcs; FAS pinning across re-layouts.
- Diff-and-animate core: keyed diff → enter/update/exit; single rAF clock (WAAPI clock
  source); FLIP moves; arc-length path resample+lerp.
- Mutations (`addNode/addEdge/removeNode/removeEdge/update/batch`) + events.
- **Interruption policy (cancel-and-retarget) from day one.**
- Pan/zoom/`fitView()` with the anchored-viewport rule.
- Golden-file layout snapshots + crossing-count assertions; CI size budget (hard fail).

**Exit:** append 5 nodes one at a time to a 10-node graph *containing one loop*; every
existing node reflows smoothly, the back edge never flips sides, nothing corrupts when
appends overlap mid-animation.

### M1 — The pipeline demo end to end (the proof)
- Compound expand/collapse per D5 (4-step relayout, meta-edges with dedupe/weights,
  width/height container transform).
- `condense()` per D6 (convexity check, 3-phase choreography, reduced-motion fallback).
- **Token engine Mode A**: compile pass, implicit fan-out, `join: all/any/count`,
  loop iterations with caps + badges, per-branch `speed()`, `step()` semantics; token
  pulses / node fills / occupancy badges / join slots rendered from `stateAt(t)`.
- Storyboard: JSON ops, snapshot-seek, transport bar, labels.
- `preset-pipeline`: duration chips, duration→width, manual/auto badges, `durationAgg`,
  odometer + delta badge on `condense`, total-duration bar.
- Deduped global stylesheet; multi-instance safe.

**Exit:** one static HTML file with one `<script>` tag plays the full §6 narrative —
including a 3-way fan-out at different rates, an `all`-join, and a retry loop ticking
to 3/5 — and scrubs backward/forward with no corruption.

### M2 — Generalization
- Mode B `live` (event-log replay, `spawn()` runtime fan-out, time-travel scrub).
- `split()` (1→N), edge labels, `collapseAll/expandAll`, query sugar.
- ARIA (`role=treeitem`/`aria-expanded`, keyboard nav) + linearized table fallback —
  non-negotiable before 1.0.
- `exportSVG()` / `exportPNG()`; single-file HTML recipe + optional CLI.
- Theming docs, TypeScript types.

### M3 — Size & scale
- In-house layered engine (incl. DFS cycle-breaking + pinning, ~400–550 LOC of the
  ~2,000–2,800 total) replacing dagre, gated on golden-file parity; dagre becomes an
  optional ESM adapter.
- Selective compositor offload for non-choreographed motion (profiled), viewport culling.
- Gantt/temporal layout mode (x = time, sweeping-line scrubber) **if demanded**.

Cut from v1 entirely (over-engineering, per critique): force-directed fallback,
runtime `exportHTML()`, per-frame style reducers, selector-string stylesheets, plugin
registry, renderer abstraction for a hypothetical canvas backend, minimap,
small-multiples diff view (an app *on* the library; docs example instead),
`groups`/swimlanes (field name reserved in the spec, ignored until there's demand).

---

## 8. Sizing (honest math)

| Module | est. KB gzip |
|---|---:|
| Graph store + validation + keyed diff | 3.5 |
| SVG renderer (incl. text measure, arrowheads, clipping) | 6.0 |
| Animation core (clock, tweens, FLIP, easings, interruption) | 4.5 |
| Path resample + lerp | 2.0 |
| Compound expand/collapse + meta-edges | 2.5 |
| Condense choreography + convexity | 2.5 |
| **Token engine (Mode A) + loop/join/badge rendering** | 3.5 |
| Back-edge routing/styling (over dagre's cycle handling) | 1.0 |
| Storyboard + snapshots + transport bar | 5.0 |
| Pan/zoom/fit + anchored viewport | 2.0 |
| Theme + style commit + injected CSS | 2.5 |
| **Core subtotal** | **≈35** |
| `preset-pipeline` | 3.5 |
| Layout: dagre era (M0–M2), graphlib included (verified) | 17.1 |
| Layout: in-house (M3) | ≈10 |

- **M1 IIFE ≈ 55–56KB gzip** (≈ 47–48KB brotli as CDNs actually serve it) — slightly over
  the aspirational 50 during the dagre era.
- **M3 IIFE ≈ 48–49KB gzip / ≈ 42KB brotli.**
- Raw min (the `file://` single-file case, no transport compression): ~160–200KB.

**Public commitment:** *core (no layout) < 40KB gzip; full pipeline IIFE < 50KB gzip from
M3; ~55KB during the dagre era* — enforced by a CI hard-fail budget from M0, with
optional pieces (exports, ARIA fallback table, adapters) as ESM-only entries.

---

## 9. Risks & open questions

1. **Layered-layout correctness tail** (M3): coordinate assignment is the bug farm —
   mitigated by shipping dagre first, golden-file parity gates, and choosing a simpler
   heuristic over full Brandes–Köpf.
2. **Condense visual fidelity**: true shape-divide morphing (ECharts-style) is out of
   budget; the staged converge+crossfade must be validated by eye early (M1 spike).
3. **`step()` UX under near-ties**: a wide fan-out can advance many tokens in one step;
   `step({token})` exists, but default behavior needs a usability pass.
4. **Mode A is an estimate, not truth**: simulated timing must be visually labeled
   (persistent "estimated" vs "live" indicator) or users will over-trust it.
5. **WAAPI/CSS animatability of SVG2 geometry props** (`width/height/x/y/r`) across
   engines: our design only *requires* rAF writes (safe everywhere); re-check before
   using them as an optimization.
6. **Concurrent-token rendering at scale** unproven past a few hundred tokens —
   prototype before promising dynamic fan-out ceilings.
7. **Research provenance**: bundle sizes were measured first-hand from npm tarballs
   in-session; a few claims (VEIL back-edge grouping, yFiles port stability, GitLab
   design details) rest on search summaries because their sites were egress-blocked —
   re-verify if any becomes load-bearing for public claims.

---

## Appendix: research provenance

Produced by 7 parallel research agents + an adversarial critique pass (2026-08-29):
landscape/build-vs-buy, rendering technology, layout algorithms, API & data model,
pipeline UX/motion design, cyclic-graph layout, token/execution semantics. Key
verifications performed directly in-session: npm tarball size measurements
(`gzip -9` on shipped `dist` files), dagre 3.1.1 source reading (acyclic.ts,
greedy-fas.ts, layout.ts, changelog), `dist/dagre.min.js` self-containment (graphlib
inlined), npm name availability (`sparkle-motion-vizualizer` free, 2026-08-29).
