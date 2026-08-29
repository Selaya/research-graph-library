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
- **Condense** — `g.condense([ids], newNode)` merges N nodes into one with a staged
  highlight → converge → reveal choreography (and a convexity guard against silent
  graph corruption).
- **Token engine** — `g.run()` plays an execution over the graph: implicit fan-out,
  `join: "all" | "any" | {count}` fan-in, bounded retry loops with iteration badges,
  per-branch speed, `step()` to the next event boundary, seek/scrub anywhere.
- **Storyboards** — a serializable op array replays a full narrative; every step is
  snapshotted so scrubbing backward through structural changes just works.
- **Pipeline preset** — duration chips, sum/max rollups, manual/auto badges, the
  `2h → 8s` odometer + delta badge when automation lands, a total-duration bar.
- **Sane viewport** — anchored (the focal node holds still; the graph reflows around
  it), zoom only on ctrl/cmd+scroll, `fitView()` when *you* ask.

## Size

Enforced by a hard-fail CI budget (`npm run size`):

| bundle | min+gzip | budget |
|---|---:|---:|
| core (layout engine external) | ~27KB | <40KB |
| full IIFE incl. dagre layout | ~43KB | <56KB (dagre era; <50KB from M3) |

## Demos

- `demo/pipeline.html` — the flagship narrative (steps appear → run with a 3-way
  fan-out at different rates and an all-join → retry loop ticks to 3/5 → expand →
  condense with the odometer → scrub).
- `demo/m0.html` — mutation/animation stress check (overlapping appends onto a cyclic graph).

## Development

```
npm install
npm test          # node --test unit suite + golden-file layout snapshots
npm run size      # build ESM + IIFE and enforce the size budget
node test/e2e-m0.mjs && node test/e2e-m1.mjs   # headless-chromium end-to-end checks
```

Design: `docs/PLAN.md` (decisions D1–D11, milestones), `docs/INTERNALS.md` (module
contracts), `docs/research/` (landscape + critique the plan rests on).

Status: M0 (walking skeleton) and M1 (pipeline demo end to end) complete; M2
(generalization: live mode, split, ARIA, exports) and M3 (in-house layout engine,
size/scale) tracked in `docs/PLAN.md` §7.

License: MIT.
