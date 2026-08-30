# sparkle-motion-vizualizer

A small, embeddable, **animated** graph visualization library — built for narrating
pipelines of work: steps appearing over time, tokens flowing through fan-outs and joins,
retry loops ticking, manual steps condensing into automated ones, and a transport bar to
play, pause, and scrub the whole story.

One `<script>` tag, no build step, no framework:

```html
<div id="pipe" style="height:480px"></div>
<script src="dist/smv.iife.min.js"></script>
<script>
  const g = SparkleMotion.mount("#pipe", {
    nodes: [
      { id: "ingest", label: "Ingest", data: { duration: "45m" } },
      { id: "clean", label: "Clean data", collapsed: true, durationAgg: "sum" },
      { id: "clean.dedupe",   parent: "clean", label: "Dedupe",   data: { duration: "30m" } },
      { id: "clean.validate", parent: "clean", label: "Validate", data: { duration: "1h" } },
      { id: "build", label: "Build" },
      { id: "deploy", label: "Deploy" },
      { id: "check", label: "Health check" },
    ],
    edges: [
      { id: "e1", source: "ingest", target: "clean" },
      { id: "e2", source: "clean", target: "build" },
      { id: "e3", source: "build", target: "deploy" },
      { id: "e4", source: "deploy", target: "check" },
      { id: "retry", source: "check", target: "deploy", loop: true, maxIterations: 5 },
    ],
  }, { controls: true, preset: "pipeline" });

  g.run().play();                      // token flows through the pipeline
</script>
```

ESM for bundler users: `import { mount } from "sparkle-motion-vizualizer"`.

## What it does

- **Animate any graph change** — the library diffs old vs. new state and generates the
  transition (keyed enter/update/exit + FLIP); you never hand-author animations.
  Overlapping mutations cancel-and-retarget instead of queueing or corrupting.
- **Cycles are first-class** — back edges are detected (never rejected), rendered as
  consistent-side arcs that never flip sides as the graph grows; self-loops bow out of
  the node.
- **Compound nodes** — `parent` links make containers; per-node animated
  expand ⇄ collapse with meta-edge aggregation (deduped, weighted) while collapsed.
- **Condense / split** — `g.condense([ids], newNode)` merges N nodes into one with a
  staged highlight → converge → reveal choreography (and a convexity guard against
  silent graph corruption); `g.split(id, {nodes, edges})` is the mirror image, 1 → N,
  with the former node's edges redirected onto the new entry/exit nodes.
- **Token engine, two modes** — `g.run()` *simulates* an execution from declared
  durations (implicit fan-out, `join: "all" | "any" | {count}` fan-in, bounded retry
  loops with iteration badges, per-branch speed, `step()`, seek/scrub anywhere);
  `g.run({mode:"live"})` *replays a real event log* you feed it as things actually
  happen, with time-travel scrub back through it.
- **Accessible** — every node is a `role="treeitem"` with `aria-expanded` and keyboard
  navigation in reading order, plus an optional linearized `<table>` fallback.
- **Storyboards** — a serializable op array replays a full narrative; every step is
  snapshotted so scrubbing backward through structural changes just works.
- **Director ops** — scripts also drive the camera (`{node}` / `{nodes}` / `{fit}` /
  absolute / relative moves), highlights and spotlights (`data-emph`/`data-dim`, four
  variants), a caption overlay, and per-step pacing via `dur` — the declared timeline
  the scrubber and cue sheet both read. See `docs/RECORDING.md` for the full recipe,
  including recording a story as video.
- **Pipeline preset** — duration chips, sum/max rollups, manual/auto badges, the
  `2h → 8s` odometer + delta badge when automation lands, a total-duration bar.
- **Sane viewport** — anchored (the focal node holds still; the graph reflows around
  it), zoom only on ctrl/cmd+scroll, `fitView()` when *you* ask. Past 150 elements,
  groups fully outside the visible rect stop being drawn at all.
- **Layered layout, in-house** — no dependencies at all since M3: cluster-aware ranking,
  median ordering, order stability across re-layouts, all four directions. dagre is still
  available as an optional adapter.

## API

`mount(el, spec, opts) → g`. `el` is an element or a selector; `opts` takes
`theme` (`auto`/`light`/`dark`), `layout` (`{dir:"LR"|"RL"|"TB"|"BT", nodesep, ranksep,
marginx, marginy, solver}` — see **Layout** below),
`animation` (`{duration, easing}`), `controls`, `preset`, `storyboard`, `autoplay`,
`a11y: false` to opt out of the ARIA layer, and `interaction: { tapToggle: false }` to
turn off tap/click-to-toggle on container nodes (on by default; a tap that travels past
a small slop radius counts as a pan and never toggles — touch-friendly by construction).

Every mutation returns an awaitable, cancelable handle (`await g.addNode(…)`,
`g.condense(…).cancel()`); overlapping calls cancel-and-retarget rather than queue.

```js
g.addNode(node, { after })  g.addEdge(edge)  g.removeNode(id)  g.removeEdge(id)
g.update(id, patch)         g.batch(fn)      g.style(fn)       g.theme(t)
g.expand(id)   g.collapse(id)   g.expandAll()   g.collapseAll()
g.condense([ids], newNode)   g.split(id, { nodes, edges })
g.run(opts)    g.storyboard(steps)   g.timeline()
g.camera(target)   g.highlight(sel)   g.clearHighlight()   g.caption(text, o)   g.cues()
g.layout(opts) g.fitView()   g.bounds()  g.layoutResult()  g.spec()  g.destroy()
g.on(type, fn) / g.off(type, fn)
```

**Split (1 → N).** The inverse of condense, same three-phase choreography:

```js
await g.split("clean", {
  nodes: [{ id: "dedupe" }, { id: "validate" }, { id: "normalize" }],
  edges: [{ id: "s1", source: "dedupe", target: "validate" },
          { id: "s2", source: "validate", target: "normalize" }],
});
```

Entry nodes (no internal in-edge) inherit every edge that pointed at the old node; exit
nodes (no internal out-edge) inherit every edge that left it — the first keeps the
original edge id, extra fan-out clones get `<edgeId>:<newNodeId>`. Weights pass through;
self-loops on the split node are dropped. Containers can't be split (`split-container`).

**expandAll / collapseAll.** Every container flips in ONE transition, parents first;
children bloom out of (or fly into) whichever box actually held them. Events
`expandAll` / `collapseAll` carry `{ids}` — the containers that actually changed.

**Query sugar.** Read-only, returns plain copies:

```js
g.nodes()                            g.nodes({ data: { status: "done" } })
g.edges({ loop: true })              g.nodes((n) => n.data?.duration)
g.children(id)   g.descendants(id)   g.roots()
```

(`g.node(id)` / `g.edge(id)` singular are unchanged.)

**Director ops / storytelling.** Storyboards (and the same methods called directly)
drive the presentation, not just the graph:

```js
await g.camera({ node: "clean", k: 1.8, pad: 60, dur: 700 });   // also {nodes:[…]},
g.camera({ fit: true });     g.camera({ zoom: 1.6 });           // {x,y,k}, {by:{dx,dy}}
g.highlight({ nodes: ["a"], edges: ["e1"], variant: "focus", dim: true });  // spotlight
g.clearHighlight();
g.caption("Three manual steps become one.", { place: "bottom" });  g.caption(null);
g.cues();   // every label + caption with its absolute ms offset — the voice-over sheet
```

Camera moves ride the shared clock and cancel-and-retarget like everything else; the
first one in a script takes the viewport (auto-refit stops, the camera joins the scrub
snapshots). A highlight *is* the emphasis state (replace, not accumulate) and survives
relayouts and backward scrubs. Every storyboard step takes an optional `dur` (ms) —
per-step pacing for any op, and the number the scrubber, `g.cues()` and the coming
frame renderer all agree on. Mount opts: `captions: false` hides the caption overlay
(cues stay truthful); `motion: "full"` and `ticker: "manual"` are recording mode.
The full script-writing and video-recording guide is `docs/RECORDING.md`.

**Live mode (Mode B).** Instead of simulating from declared durations, replay a real
event log. Live time (`run.now()`) always flows; the view clock follows it until you
scrub away:

```js
const run = g.run({ mode: "live" });
run.start("build");            // node goes active
run.finish("build");           // tokens fan out along its non-loop out-edges
run.spawn("test", 3);          // runtime fan-out — occupancy badge ×3
run.seek(pastMs);              // time travel; can never scrub past now()
run.follow();                  // jump back to live
run.log();                     // the event log (a copy)
```

`run.duration` is the growing frontier, not a fixed total. `speed(f)` scales replay
playback only (live time is real time), and per-branch speed is a no-op. Because both
clocks advance at 1×, `play()` from a detached position only catches up at
`speed(f > 1)` — `follow()` is the "jump to live" primitive. Storyboards drive Mode A
only in v1.

**Accessibility.** `attachA11y` runs at mount unless `opts.a11y === false`: the svg is
`role="application"` / `aria-roledescription="graph"`, the node layer is `role="tree"`,
each node a `role="treeitem"` with `aria-level`, `aria-label` (`label · status`) and
`aria-expanded` on containers. Arrow keys move focus in reading order, Home/End jump,
Enter/Space toggle a container, and focus arriving any other way (a click, an external
`.focus()`) is picked up too. `status` in the name is the live run status while a run is
driving the node, so a screen reader hears nodes start and finish. Decoration — token
pulses, occupancy/loop badges, edge labels, container chrome — is `aria-hidden`.

For a fully linearized fallback:

```js
import { attachA11yTable } from "sparkle-motion-vizualizer/a11y-table";
const t = attachA11yTable(g, { visible: false });   // visually-hidden by default
```

The table and the interactive tree are two views of the same content, so only one is ever
announced: with the tree on (the default) the table is `aria-hidden` and serves as a
visual/structural fallback; mount with `{ a11y: false }` to make the table the accessible
surface instead.

**Layout.** Layered (Sugiyama-family) and **in-house** since M3 — `src/engine.js`, ~630
lines, no dependencies: cluster-aware ranking (longest path + a tightening pass), dummy
bend chains, median ordering sweeps with transpose and previous-order tie-breaks, and a
coordinate pass that repairs every relaxation move with isotonic regression, so
"≥ `nodesep` apart, never overlapping" is an invariant rather than a hope. It replaced
`@dagrejs/dagre`, which cost 17.1KB gzip against the engine's 4.0KB.

```js
mount(el, spec, { layout: { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 } });
g.layout({ dir: "TB" });    // relayout + animate into the new direction
```

All four directions (`LR`/`RL`/`TB`/`BT`) are solved top-to-bottom internally and
transposed on the way out, so they are exactly as good as each other. Order stability
across re-layouts is automatic: `mount()` persists each layout's per-rank order (`order`,
plus `layers` — the same sequences with each multi-rank edge's bends interleaved, because
the real nodes alone do not determine a drawing) and feeds both back as `prevOrder` /
`prevLayers`, the same way it pins cycle-breaking reversals. Relaying out an unchanged
graph reproduces it exactly, appending a node does not reshuffle the ranks around it, and
storyboard snapshots carry both so a backward scrub restores the drawing it is replaying.

*Want dagre back?* It lives on as an optional adapter behind the same solver seam —
install the optional peer and pass a solver:

```
npm install @dagrejs/dagre
```
```js
import { mount } from "sparkle-motion-vizualizer";
import { dagreSolver, dagreLayout } from "sparkle-motion-vizualizer/adapters/dagre";

mount("#pipe", spec, { layout: { dir: "LR", solver: dagreSolver } });
const result = dagreLayout(view, { dir: "LR" });   // or drive layout() directly
```

Nothing on the default path imports dagre — the build hard-fails if it appears in any
bundle — so the adapter costs non-users nothing. A solver is just
`(input, opts) → {nodes, edges, order, layers?}` (`layers` is the bend-stability channel;
omit it and the shell simply returns `[]`); the shell keeps cycle breaking, back-edge and
self-loop arcs, container padding and bounds either way.

**Exports.** ESM-only entries (not in the IIFE, D11):

```js
import { exportSVG, exportPNG } from "sparkle-motion-vizualizer/export";
const svg  = exportSVG(g, { pad: 24, theme: "dark" });   // standalone SVG string
const blob = await exportPNG(g, { scale: 2 });           // browser only
```

**Single-file HTML.** `smv-pack` inlines the built IIFE, your spec and an optional
storyboard into one self-contained `.html`:

```
npm run build                       # produces dist/smv.iife.min.js first
npx smv-pack spec.json -o out.html --storyboard sb.json --preset pipeline --title "Pipeline"
```

See `docs/EMBED.md` for the full recipe.

## Size

Enforced by a hard-fail CI budget (`npm run size`):

| bundle | min+gzip | budget |
|---|---:|---:|
| core (layout engine external) | 36.22KB | <40KB |
| full IIFE incl. in-house layout | 40.04KB | <50KB |

The M3 engine swap took the shipped IIFE from **51.66KB → 40.04KB** gzip (dagre 17.1KB
out, `engine.js` ~3.6KB in), which is what bought the tightened 50KB budget.

## Demos

- `demo/pipeline.html` — the flagship narrative (steps appear → run with a 3-way
  fan-out at different rates and an all-join → retry loop ticks to 3/5 → expand →
  condense with the odometer → scrub).
- `demo/m2.html` — the M2 surface: a live event feed with time-travel scrub, split,
  edge labels, expand/collapse-all, keyboard navigation, SVG/PNG export.
- `demo/m0.html` — mutation/animation stress check (overlapping appends onto a cyclic graph).

## Development

```
npm install
npm test          # node --test unit suite + golden-file layout snapshots
npm run size      # build ESM + IIFE, verify no dagre leaked in, enforce the size budget
npm run types     # tsc over types/check.ts (the hand-written .d.ts surface)
node test/e2e-m0.mjs && node test/e2e-m1.mjs && node test/e2e-m2.mjs   # headless chromium
```

`node test/golden/update.js` regenerates the layout goldens — only ever run deliberately,
and it refuses to write a fixture whose crossing count regressed past the recorded
dagre-era bar. `test/engine-parity.test.js` runs both solvers side by side (it needs the
dev-installed `@dagrejs/dagre`).

Design: `docs/PLAN.md` (decisions D1–D15, milestones), `docs/INTERNALS.md` (module
contracts), `docs/RECORDING.md` (director scripts + video capture), `docs/research/`
(landscape + critique the plan rests on).

Status: M0 (walking skeleton), M1 (pipeline demo end to end), M2 (live mode, split,
edge labels, expand/collapse-all, query sugar, ARIA + table fallback, SVG/PNG export,
`smv-pack`) and M3 (in-house layered engine, dagre demoted to an optional adapter,
viewport culling, IIFE under 50KB gzip) complete; M4a (director ops: camera, highlight,
caption, the declared timeline) landed — the deterministic frame renderer is M4b. Deliberate departures from the plan —
including what "parity with dagre" was gated on, and what M3 skipped — are recorded in
`docs/DEVIATIONS.md`. Embedding: `docs/EMBED.md`.

License: MIT.
