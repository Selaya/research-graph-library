# sparkle-motion-visualizer

A small, embeddable, **animated** graph visualization library for the browser. Hand it
nodes and edges and every change animates for you: DAGs, cyclic graphs, nested
containers, sequence diagrams, live event feeds. Use it to replay a CI run or an agent
trace as it happens, animate a pipeline as it gets automated, or record a narrated
walkthrough as a deterministic video. A transport bar lets readers play, pause and scrub
the whole story.

One `<script>` tag, no build step, no framework:

```html
<div id="pipe" style="height:480px"></div>
<script src="https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@0.1.0"></script>
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

ESM for bundler users: `import { mount } from "sparkle-motion-visualizer"`.

## Install

From npm, for projects with a bundler or Node-based toolchain:

```bash
npm install sparkle-motion-visualizer
```

```js
import { mount } from "sparkle-motion-visualizer";
```

From a CDN, for plain HTML pages — the package's `unpkg`/`jsdelivr` entry points
resolve to the prebuilt IIFE bundle (global `SparkleMotion`), so a single script tag
works with no build step:

```html
<script src="https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@0.1.0"></script>
<!-- or: https://unpkg.com/sparkle-motion-visualizer@0.1.0 -->
```

The ESM bundle is also on the CDN for `<script type="module">` pages without a bundler:

```html
<script type="module">
  import { mount } from "https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@0.1.0/dist/smv.esm.js";
  const g = mount("#pipe", spec, { controls: true, preset: "pipeline" }); // same spec/opts as above
</script>
```

A container with no explicit size still renders — `.smv-root` carries a `min-height:120px`
safety net, and an unmeasured svg falls back to an 800×600 layout box — but that's a cramped
strip, not the graph you want; give it a real `height` (or width) as in every example here.

Straight from git (no registry involved):

```bash
npm install github:Selaya/research-graph-library
```

The optional dagre layout adapter needs the peer dependency: `npm install @dagrejs/dagre`,
then `import { dagreSolver } from "sparkle-motion-visualizer/adapters/dagre"`.

## What it does

- **Animate any graph change** — the library diffs old vs. new state and generates the
  transition (keyed enter/update/exit + FLIP); you never hand-author animations.
  Overlapping mutations cancel-and-retarget instead of queueing or corrupting.
- **Cycles are first-class** — back edges are detected (never rejected), rendered as
  consistent-side arcs that never flip sides as the graph grows; self-loops bow out of
  the node.
- **Compound nodes** — `parent` links make containers; per-node animated
  expand ⇄ collapse with meta-edge aggregation (deduped, weighted) while collapsed.
  `container: true` declares one up front, so a container that has no children *yet*
  draws as a header-only box instead of a plain node. It is a drawing/layout flag only:
  until real children arrive there is nothing to fold, so collapse/expand, the tap toggle,
  `aria-expanded` and the run engine all keep keying off "has children".
- **Condense / split** — `g.condense([ids], newNode)` merges N nodes into one with a
  staged highlight → converge → reveal choreography (and a convexity guard against
  silent graph corruption); `g.split(id, {nodes, edges})` is the mirror image, 1 → N,
  with the former node's edges redirected onto the new entry/exit nodes.
- **Token engine, two modes** — `g.run()` *simulates* an execution from declared
  durations (implicit fan-out, `join: "all" | "any" | {count}` fan-in, bounded retry
  loops with iteration badges, per-branch speed, `step()`, seek/scrub anywhere);
  `g.run({mode:"live"})` *replays a real event log* you feed it as things actually
  happen, with time-travel scrub back through it. Both modes report a `'failed'` status
  alongside `'done'` — `data.fail` in Mode A, `run.fail(id)` in Mode B — so a step that
  didn't succeed is a first-class outcome, not a silent hang.
- **Accessible** — every node is a `role="treeitem"` with `aria-expanded` and keyboard
  navigation in reading order, plus an optional linearized `<table>` fallback.
- **Storyboards** — a serializable op array replays a full narrative; every step is
  snapshotted so scrubbing backward through structural changes just works.
- **Director ops** — scripts also drive the camera (`{node}` / `{nodes}` / `{fit}` /
  absolute / relative moves), highlights and spotlights (`data-emph`/`data-dim`, four
  variants, an optional ticker-driven pulse), a caption overlay, per-element `--smv-*`
  overrides, and per-step pacing via `dur` — the declared timeline the scrubber and cue
  sheet both read. See [`docs/RECORDING.md`](docs/RECORDING.md), including recording a
  story as video and fitting its holds to a recorded voice-over.
- **Pipeline preset** — duration chips (nodes *and* edges), sum/max rollups, manual/auto
  badges, the `2h → 8s` odometer + delta badge when automation lands, and a total-duration
  bar that names both totals it could mean: the summed work and the critical path.
  Applied at mount it also tells layout to reserve room for what it draws, so a long label
  never runs under a chip. `presetPipeline(g)` called after mount back-fills whatever's
  already on screen instead of waiting for the next mutation. Writing your own preset:
  [`docs/PRESETS.md`](docs/PRESETS.md).
- **Sane viewport** — anchored (the focal node holds still; the graph reflows around
  it), zoom only on ctrl/cmd+scroll, `fitView()` when *you* ask. Past 150 elements,
  groups fully outside the visible rect stop being drawn at all.
- **Layered layout, in-house** — zero runtime dependencies: cluster-aware ranking,
  median ordering, order stability across re-layouts, all four directions. dagre is still
  available as an optional adapter.

## API at a glance

`mount(el, spec, opts) → g`. `el` is an element or selector; `spec` is `{nodes, edges}`;
`opts` covers `theme`, `layout`, `animation`, `controls`, `preset`, `storyboard`,
`autoplay`, `a11y` and `interaction`.

```js
g.addNode(node, { after })  g.addEdge(edge)  g.removeNode(id)  g.removeEdge(id)
g.update(id, patch, opts)   g.batch(fn)      g.style(fn)       g.theme(t)
g.validate(ops | fn)        // dry-run the structural guards; { ok, errors: [GraphError] }
g.expand(id, { camera })   g.collapse(id, { camera })   g.expandAll({ camera })   g.collapseAll({ camera })
g.condense([ids], newNode)   g.split(id, { nodes, edges })
g.run(opts)    g.storyboard(steps)   g.timeline()   g.finished   g.finish()
g.camera(target)   g.highlight(sel)   g.clearHighlight()   g.caption(text, o)   g.cues()
g.props({ id: { "--smv-fill": "#7c5cff" } }, { merge })   // overrides; null clears
g.layout(opts) g.fitView()   g.bounds()  g.layoutResult()  g.spec()  g.destroy()
g.nodes(filter)  g.edges(filter)  g.node(id)  g.edge(id)  g.children(id)  g.roots()
g.on(type, fn) / g.off(type, fn)
```

Every mutation returns an awaitable, cancelable handle resolving `{canceled, applied}`;
overlapping calls cancel-and-retarget rather than queue. Structural misuse throws a
synchronous, exported `GraphError` with a stable `code` (`dup-id`, `dangling`,
`non-convex`, …).

Optional ESM entry points:

| import | what |
|---|---|
| `sparkle-motion-visualizer/export` | `exportSVG`, `exportPNG` |
| `sparkle-motion-visualizer/a11y-table` | `attachA11yTable` — linearized `<table>` fallback |
| `sparkle-motion-visualizer/preset-pipeline` | `applyPipelinePreset` and its helpers, for building your own preset |
| `sparkle-motion-visualizer/adapters/dagre` | `dagreSolver`, `dagreLayout` (needs `@dagrejs/dagre`) |
| `sparkle-motion-visualizer/cues`, `/fit` | the CLIs' pure functions |

CLIs: `smv-pack` (single-file HTML), `smv-record` (deterministic mp4 / PNG frames),
`smv-fit` (fit a storyboard to a voice-over).

## Documentation

- [`docs/API.md`](docs/API.md) — full API reference: mutations, errors, condense/split,
  queries, events, edge labels, camera framing, accessibility, layout and custom solvers
- [`docs/RUN.md`](docs/RUN.md) — simulated runs (Mode A)
- [`docs/LIVE.md`](docs/LIVE.md) — live runs from a real event log (Mode B)
- [`docs/RECORDING.md`](docs/RECORDING.md) — storyboards, director ops, `smv-record`, `smv-fit`
- [`docs/EMBED.md`](docs/EMBED.md) — script-tag embedding and `smv-pack`
- [`docs/THEMING.md`](docs/THEMING.md) — `--smv-*` custom properties and `data-*` hooks
- [`docs/PRESETS.md`](docs/PRESETS.md) — writing your own preset
- [`docs/INTERNALS.md`](docs/INTERNALS.md) — module contracts, for contributors
- [`docs/RELEASING.md`](docs/RELEASING.md) — publishing to npm

## Size

Enforced by a hard-fail CI budget (`npm run size`):

| bundle | min+gzip | budget |
|---|---:|---:|
| core (layout engine external) | 48.75KB | <50KB |
| full IIFE incl. in-house layout | 54.22KB | <55KB |

## Demos

`demo/index.html` is the gallery GitHub Pages serves. Every page is self-contained over
`dist/smv.iife.min.js` (run `npm run build` first) and supports `?auto=1` for unattended
playback.

- `demo/pipeline.html` — the flagship: steps appear, a 3-way fan-out runs at different
  rates into a join, a retry loop ticks, a container expands, steps condense, and the
  whole thing scrubs.
- Use-case pages — CI matrix builds, Terraform applies, git branching, incident replays,
  multi-agent swarms, tool-use loops, LLM evals, prompt-chain debugging, human-in-the-loop
  approval, Kafka streaming, A/B experiments, onboarding, a kitchen ticket, an assembly
  line, a recipe, sequential-vs-parallel, a WebSocket bridge, and a live spec editor.
- `demo/seq-*.html` — nine animated sequence diagrams built on a custom layout solver
  (`demo/sequence-solver.js`): login, checkout, OAuth PKCE, retries and a circuit
  breaker, a saga, chat fan-out, cache-aside, a live distributed trace, GraphQL federation.
- `demo/m0.html`, `demo/m2.html`, `demo/m3-scale.html` — test pages driven by the
  `test/e2e-m*.mjs` browser checks (mutation stress, live mode + export, 300-node scale).

## Development

```
npm install
npm test          # node --test unit suite + golden-file layout snapshots
npm run size      # build ESM + IIFE, verify no dagre leaked in, enforce the size budget
npm run check     # test + build + size + check-doc-versions — the CI gate
npm run check-demos  # every demo/*.html in headless chromium: no errors, no [smv:] warnings, graph rendered
npm run types     # tsc over types/check.ts (the hand-written .d.ts surface)
node test/e2e-m0.mjs && node test/e2e-m1.mjs && node test/e2e-m2.mjs   # headless chromium
node test/e2e-m3.mjs && node test/e2e-m4.mjs                          # engine gates, frame-render determinism
```

`node test/golden/update.js` regenerates the layout goldens — only ever run deliberately,
and it refuses to write a fixture whose crossing count regressed. `test/engine-parity.test.js`
runs both solvers side by side (it needs the dev-installed `@dagrejs/dagre`).

## License

MIT
