# sparkle-motion-visualizer

A small, embeddable, **animated** graph visualization library — built for narrating
pipelines of work: steps appearing over time, tokens flowing through fan-outs and joins,
retry loops ticking, manual steps condensing into automated ones, and a transport bar to
play, pause, and scrub the whole story.

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
  sheet both read. See `docs/RECORDING.md` for the full recipe, including recording a
  story as video and fitting its holds to a recorded voice-over.
- **Pipeline preset** — duration chips, sum/max rollups, manual/auto badges, the
  `2h → 8s` odometer + delta badge when automation lands, a total-duration bar.
  `presetPipeline(g)` called after mount back-fills whatever's already on screen instead of
  waiting for the next mutation. Writing your own preset: docs/PRESETS.md.
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

Every mutation returns an awaitable, cancelable handle that resolves `{canceled, applied}` —
`applied` says whether the structural change actually landed in the store (`cancel()` only
ever interrupts the trailing animation; it never undoes an add/remove/update, and for
condense/split the merge/split itself lands mid-flight, in the async phase, so
`{canceled: true, applied: true}` is a real, expected combination — "this run reports
canceled, but the change it caused is real"). `removeNode(id)` additionally resolves
`ids: {nodes, edges}` — the full doomed cascade, every swallowed descendant and every edge
left dangling; `condense`/`split` resolve `ids: {created, removed}` once `applied` flips
true. Overlapping calls cancel-and-retarget rather than queue:

```js
const r = await g.removeNode("clean");                    // { canceled, applied: true, ids: { nodes, edges } }
const c = await g.condense(["a", "b"], { id: "merged" });  // { canceled, applied, ids?: { created, removed } }
g.condense(["a", "b"], { id: "merged" }).cancel();
```

```js
g.addNode(node, { after })  g.addEdge(edge)  g.removeNode(id)  g.removeEdge(id)
g.update(id, patch)         g.batch(fn)      g.style(fn)       g.theme(t)
g.expand(id)   g.collapse(id)   g.expandAll()   g.collapseAll()
g.condense([ids], newNode)   g.split(id, { nodes, edges })
g.run(opts)    g.storyboard(steps)   g.timeline()
g.camera(target)   g.highlight(sel)   g.clearHighlight()   g.caption(text, o)   g.cues()
g.props({ id: { "--smv-fill": "#7c5cff" } })   // per-step overrides; null clears
g.layout(opts) g.fitView()   g.bounds()  g.layoutResult()  g.spec()  g.destroy()
g.on(type, fn) / g.off(type, fn)
```

`g.batch(fn)` is NOT transactional: `fn`'s ops commit to the store one at a time,
synchronously, as `fn` itself runs — `batch()` only defers the relayout(s) they'd each have
caused into one shared commit. An op that throws partway through leaves every earlier op
committed (no rollback). `fn` must be synchronous: a `Promise`-returning `fn` throws
`GraphError('batch-async')` immediately, rather than let its post-`await` code run after
`batch()` has already returned and drained.

**Errors.** Every structural misuse throws a synchronous `GraphError` — a real exported
class, so `instanceof` works, and every message already embeds its code (`[smv:<code>] …`):

```js
import { GraphError } from "sparkle-motion-visualizer";

try { g.addNode({ id: "b1" }); g.addNode({ id: "b1" }); }
catch (e) { if (e instanceof GraphError) console.log(e.code); }   // "dup-id"
```

| code | thrown when |
|---|---|
| `no-mount` | `mount(el)` got a bad/missing element or selector |
| `node-id` | a node (or a condense/split new-node spec) has no non-empty `id` |
| `edge-id` | an edge spec has no non-empty `id` |
| `dup-id` | a duplicate node/edge id (initial spec, `addNode`/`addEdge`, `condense`, `split`) |
| `dangling` | an edge, `parent`, or split-parent references an id that doesn't exist |
| `unbounded-loop` | a `loop: true` edge has no `maxIterations > 0` |
| `missing` | a referenced node/edge doesn't exist (`removeNode`/`removeEdge`/`update`/`condense`/`split`) |
| `parent-cycle` | a node's `parent` chain would cycle back to itself |
| `non-convex` | `condense()`'s node set isn't convex — a path leaves it and re-enters |
| `split-container` | `split()` was called on a node that has children |
| `split-edge` | a `split()` internal edge doesn't connect two of its own new nodes |
| `split-no-entry` / `split-no-exit` | `split()` has no entry/exit node to redirect the old edges onto |
| `props-key` | `g.props()` (or a storyboard `props` step) set a key that isn't `--smv-*` |
| `style-key` | `g.style(fn)`'s return set a key that isn't `--smv-*` |
| `storyboard-step` | a storyboard step has neither `op` nor `label` |
| `storyboard-op` | an unknown storyboard op name (checked inside `batch` children too) |
| `storyboard-label` | `sb.seek(label)` given an unknown storyboard label |
| `batch-async` | `g.batch(fn)` was handed a `Promise`-returning `fn` |

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

`g.node(id)` / `g.edge(id)` singular return the same kind of plain copy — mutating what
they hand back never touches the store.

**Director ops / storytelling.** Storyboards (and the same methods called directly)
drive the presentation, not just the graph:

```js
await g.camera({ node: "clean", k: 1.8, pad: 60, dur: 700 });   // also {nodes:[…]},
g.camera({ fit: true });     g.camera({ zoom: 1.6 });           // {x,y,k}, {by:{dx,dy}}
g.highlight({ nodes: ["a"], edges: ["e1"], variant: "focus", dim: true });  // spotlight
g.highlight({ nodes: ["a"], variant: "warn", pulse: true });     // + an attention beat
g.clearHighlight();
g.props({ clean: { "--smv-fill": "#7c5cff" } });   g.props(null);  // override layer
g.caption("Three manual steps become one.", { place: "bottom" });  g.caption(null);
g.cues();   // every label + caption with its absolute ms offset — the voice-over sheet
```

Every storyboard step — a mutation op name (the set mirrors `g`'s own methods, `condense`
and `split` both included) or a director op — is validated when the storyboard is *built*,
not when it plays: an unknown op throws `GraphError('storyboard-op')` at the step's own
index, recursing into `batch` children too (a typo three levels into a nested `batch`
throws as step `"1.2.0"`, not a bare `TypeError` mid-playback), and a malformed `props`
step's keys are checked the same way, at the same time. Camera and highlight misuse — an
unresolved node id, a mistyped key (`nod` for `node`), an unsupported `variant` — is
presentational, not structural: it never throws, just one `console.warn` per call naming
every issue found (`[smv:camera] …` / `[smv:highlight] …`), and the call still does its
best with whatever it could resolve.

Camera moves ride the shared clock and cancel-and-retarget like everything else; the
first one in a script takes the viewport (auto-refit stops, the camera joins the scrub
snapshots). A highlight *is* the emphasis state (replace, not accumulate) and survives
relayouts and backward scrubs — and so does the `props` override layer, which sits over
your `style()` function on the same `--smv-*` channel. `pulse: true` breathes the
emphasis off the shared ticker (never a CSS animation, so it records frame-perfectly;
reduced motion holds it still). Every storyboard step takes an optional `dur` (ms) —
per-step pacing for any op, and the number the scrubber, `g.cues()` and the coming
frame renderer all agree on. Mount opts: `captions: false` hides the caption overlay
(cues stay truthful); `motion: "full"` and `ticker: "manual"` are recording mode.
The full script-writing and video-recording guide is `docs/RECORDING.md`.

`g.run()` (no args) returns the current run — compiling a default Mode A one on first call
if none exists. `g.run(opts)`, with **any** opts object, even `{}`, destroys the current
run and replaces it with a fresh one built from `opts`; call it bare unless you actually
mean to restart the run.

**Simulated runs (Mode A).** The default: `g.run()` compiles the whole schedule from
declared `data.duration`s once, up front, so everything after that — seek, scrub, `step()`,
per-branch `speed()` — is just sampling the compiled artifact:

```js
const run = g.run();                          // Mode A (simulate) is the default
run.play({ until: "deploy" });                 // -> Promise<{canceled}>, also run.promise
run.pause();   run.seek(4000);   run.step();   run.step({ token: "t3" });
run.speed(2, { branch: "clean" });             // per-branch rate, Mode A only
run.state();                                    // {tokens, nodes, edges, joins, loops, done}
run.sim();                                      // the compiled schedule: {duration, events, stateAt}
run.timeOf("deploy");                           // first finish/fail instant — a storyboard step's worth
```

Duration grammar (`data: { duration: "2h" }`): a bare number is seconds; a string is
`<number><unit>` with `unit ∈ ms|s|m|h|d` (case-insensitive, decimals fine — `"1.5h"`,
`".25s"`, whitespace around the number/unit tolerated). Unparseable or negative values
`console.warn` (naming the node and the bad value) and fall back to the 600ms default — a
node with no `duration` at all stays silent, that's not a mistake. An unannotated fan-in is
an implicit AND-join; `join: "all" | "any" | { count }` overrides it. A `loop: true` edge
needs `maxIterations > 0` or the edge throws (`unbounded-loop`) at `addEdge`/mount time.

**Failed steps.** `data: { duration: "3s", fail: true }` — or `fail: "exit code 137"` to
carry a reason through onto the emitted event — runs the node's dwell in full and then
fails: status `'failed'`, no `finish` event, no loop, no fan-out to successors; the branch
just stops. `play({until})` and `timeOf()` treat `'failed'` as terminal exactly like
`'done'`, so a step waiting on a branch that failed doesn't hang. A container can't declare
`data.fail` itself (it isn't an executable step); it inherits the earliest failure among
its descendants.

| event | fires when |
|---|---|
| `play` / `pause` / `seek` / `speed` / `step` | a transport call |
| `tick` | every advancing frame while playing |
| `end` / `cancel` | a `play()` awaitable settled — target reached, or interrupted |
| `recompile` | a graph mutation invalidated the compiled schedule (recompiles lazily, on next sample) |
| `remap` | a condense remapped tokens onto the merged node |
| `enter` / `start` / `finish` / `fail` | a token entering, dwelling on, finishing, or failing a node |
| `spawn` | implicit fan-out mints a new token |
| `join` / `drop` | a fan-in fired, or a late arrival at an already-fired join |
| `loop` | a retry edge ticks (carries `iteration`/`max`) |
| `warn` | a compile-time diagnostic (e.g. an unparseable duration) |
| `done` | the compiled schedule has fully played out |

Everything through `remap` above is the transport's own event; everything from `enter` down
is the compiled schedule's, re-emitted on `run.on(type, fn)` by `type` as playback reaches
it. Full run-handle reference: docs/RUN.md.

**Live mode (Mode B).** Instead of simulating from declared durations, replay a real
event log. Live time (`run.now()`) always flows; the view clock follows it until you
scrub away:

```js
const run = g.run({ mode: "live" });
run.start("build");            // node goes active
run.finish("build");           // tokens fan out along its non-loop out-edges
run.spawn("test", 3);          // runtime fan-out — occupancy badge ×3
run.start("check");
run.fail("check", { reason: "exit code 137" });  // finish()'s terminal sibling: no fan-out, status 'failed'
run.seek(pastMs);              // time travel; can never scrub past now()
run.follow();                  // jump back to live
run.log();                     // the event log (a copy)
```

`fail()` is `finish()`'s terminal sibling — no `n` option (it consumes every current
occupant; a partially-failed node isn't a coherent status) — and like `start`/`finish`/
`spawn` it never throws: an unknown id or a zero-occupancy node gets one `console.warn` and
is a no-op. `'failed'` is sticky against a token merely arriving (unlike `'done'`, which a
fresh arrival resets to `'pending'`) — only an explicit `start()` clears it, and that IS the
retry: it counts a targeting `loop: true` edge's iteration exactly like restarting a
`'done'` node already did. `play({until})`/`timeOf()` treat `'failed'` as terminal here too.

`run.duration` is the growing frontier, not a fixed total. `speed(f)` scales replay
playback only (live time is real time), and per-branch speed is a no-op. Because both
clocks advance at 1×, `play()` from a detached position only catches up at
`speed(f > 1)` — `follow()` is the "jump to live" primitive. Storyboards drive Mode A
only in v1. Full integration guide — `opts.log` seeding, `reset()`/`options()` reconnect,
a WebSocket wiring example — is docs/LIVE.md.

**Accessibility.** `attachA11y` runs at mount unless `opts.a11y === false`: the svg is
`role="application"` / `aria-roledescription="graph"`, the node layer is `role="tree"`,
each node a `role="treeitem"` with `aria-level`, `aria-label` (`label · status`) and
`aria-expanded` on containers. Arrow keys move focus in **reading order** — rank-major,
inferred from the layout result, so it's correct for `TB`/`BT` (top-to-bottom) as well as
the `LR`/`RL` it degrades to when there's nothing to infer from — Home/End jump, Enter/Space
toggle a container, and focus arriving any other way (a click, an external `.focus()`) is
picked up too. `status` in the name is the live run status while a run is driving the node
(`active`/`done`/`failed`). That alone only reaches a screen reader when the
node in question is focused, so a dedicated `role="status"` `aria-live="polite"` region
also announces "`<label> started`" / "`finished`" / "`failed`" as they happen — several
landing in the same tick are coalesced into one joined announcement, not one per node.
Decoration — token pulses, occupancy/loop badges, edge labels, container chrome — is
`aria-hidden`.

For a fully linearized fallback:

```js
import { attachA11yTable } from "sparkle-motion-visualizer/a11y-table";
const t = attachA11yTable(g, { visible: false });   // visually-hidden by default
```

The table's status column tracks the same live run status as the tree (not just the
spec's static `data.status`), so it stays current whether it's a fallback or the primary
surface. The table and the interactive tree are two views of the same content, so only one
is ever announced: with the tree on (the default) the table is `aria-hidden` and serves as
a visual/structural fallback; mount with `{ a11y: false }` to make the table the accessible
surface instead. Be clear about the trade-off: `a11y: false` also skips attaching the
interactive tree entirely — the graph itself is not keyboard-navigable, and the table (read
only, no graph interaction of its own) is what a keyboard/screen-reader user gets in its
place.

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

That channel holds a *connected* drawing together, but it cannot hold apart what was never
joined: draw four parallel pipelines in one graph and there are no edges between them, so
nothing decides which sits above which — remove a node from the second and it can slide to
the bottom, taking every later addition with it. **`componentOrder`** pins that down. Each
entry is one slot, in order: an id, or an array of ids that are aliases for the same slot
(list a few, and the slot survives losing one). Unknown ids are ignored, a container and
its children count as one component (list either), and every component nobody listed shares
one slot after the listed ones — so naming the two that matter is enough.

```js
mount(el, spec, { layout: { componentOrder: ["ingest0", ["enrich0", "enrich1"], "export0"] } });
g.layout({ componentOrder: ["export0", "ingest0"] });  // re-slot at runtime; it persists
g.layout({ componentOrder: null });                    // back to whatever the solver likes
```

Slots are **sticky**: `mount()` remembers which component landed in which slot, so a
pipeline keeps its band even after every id you listed for it has been removed — name its
head and stop worrying about whether that head survives. Handing `g.layout()` a different
list (or `null`) drops the memory and re-resolves from what you just passed.

It is an engine-only option — the dagre adapter ignores it — and it costs nothing when it
is absent: with no list there are no slots and the drawing is the one you already had.

*Want dagre back?* It lives on as an optional adapter behind the same solver seam —
install the optional peer and pass a solver:

```
npm install @dagrejs/dagre
```
```js
import { mount } from "sparkle-motion-visualizer";
import { dagreSolver, dagreLayout } from "sparkle-motion-visualizer/adapters/dagre";

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
import { exportSVG, exportPNG } from "sparkle-motion-visualizer/export";
const svg  = exportSVG(g, { pad: 24, theme: "dark" });   // standalone SVG string (whole graph)
const shot = exportSVG(g, { viewport: true });           // current pan/zoom framing, culling kept
const blob = await exportPNG(g, { scale: 2 });           // browser only
```

Also ESM-only, and now shipping their own `types:` condition alongside `.`/`./export`:
`sparkle-motion-visualizer/preset-pipeline` (writing your own preset — see docs/PRESETS.md)
and the CLIs' own pure functions, reachable without shelling out —
`sparkle-motion-visualizer/cues` (`formatCues`, `toSRT`, `toChapters`) and
`sparkle-motion-visualizer/fit` (`fit`, `parseMarks`).

**Single-file HTML.** `smv-pack` inlines the built IIFE, your spec and an optional
storyboard into one self-contained `.html`:

```
npm run build                       # produces dist/smv.iife.min.js first
npx smv-pack spec.json -o out.html --storyboard sb.json --preset pipeline --title "Pipeline"
```

See `docs/EMBED.md` for the full recipe.

**Deterministic video.** `smv-record` drives a record-mode pack (manual ticker, motion
forced full, every CSS transition off) frame by frame in headless chromium and pipes the
frames straight into ffmpeg — two runs of one script are byte-identical:

```
npx smv-record spec.json --storyboard sb.json --out story.mp4 --fps 60 --scale 2 \
    --cues cues.srt --font Inter.woff2
```

The frame count is the declared timeline (D12), nothing wall-clock. `--png-dir frames/`
writes a PNG sequence instead (the route on a machine with no ffmpeg), `--cues` writes the
cue sheet as JSON, subtitles or a YouTube chapter list, `--from/--to` re-renders one
labelled chapter so it intercuts frame-for-frame with the full take, and `--font` pins the
typeface so two machines lay the graph out identically. Needs a chromium binary — falls
back to `playwright-core`'s own discovery when the repo's bundled one isn't present:
`npm i -D playwright-core && npx playwright install chromium`. `docs/RECORDING.md` §3 has
the full flag list.

**Fitting a script to a voice-over.** Record the read against the cue sheet, then hand
`smv-fit` the timestamps each beat actually landed on — it stretches and shrinks the
`wait` steps between labels until every label lands on its mark, and touches nothing else:

```
npx smv-fit sb.json --vo marks.json -o fitted.sb.json   # {"intro":0,"focus":4200,…}
```

Pure JSON→JSON, priced off the same declared timeline everything else reads, idempotent,
and it exits 1 naming the beat when the animation in a segment is simply longer than the
gap the narration left it. `docs/RECORDING.md` §6.

## Size

Enforced by a hard-fail CI budget (`npm run size`):

| bundle | min+gzip | budget |
|---|---:|---:|
| core (layout engine external) | 42.62KB | <45KB |
| full IIFE incl. in-house layout | 47.50KB | <50KB |

The M3 engine swap took the shipped IIFE from **51.66KB → 40.04KB** gzip (dagre 17.1KB
out, `engine.js` ~3.6KB in), which is what bought the tightened 50KB budget. The usability
round after it — misuse warnings and build-time validation across director/run/live-mode,
the aria-live region, `--smv-radius`, richer mutation handles, the `fail` primitive — grew
the core bundle past its old 40KB budget, so core's budget moved to 45KB while the shipped
IIFE's 50KB budget held.

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
npm run check-doc-versions  # every sparkle-motion-visualizer@ pin in README/docs must match package.json
npm run check     # test + build + size + check-doc-versions — the CI gate
npm run types     # tsc over types/check.ts (the hand-written .d.ts surface)
node test/e2e-m0.mjs && node test/e2e-m1.mjs && node test/e2e-m2.mjs   # headless chromium
node test/e2e-m3.mjs && node test/e2e-m4.mjs                          # engine gates, frame-render determinism
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
caption, the declared timeline), M4b (`smv-record`, the deterministic frame renderer),
M4c (ffmpeg piping, cue sheets, chapter re-renders, pinned fonts, `exportSVG({viewport:
true})`) and M4d (`smv-fit` voice-over fitting, per-step `props` overrides, the emphasis
pulse) all landed. Deliberate departures from the plan —
including what "parity with dagre" was gated on, and what M3 skipped — are recorded in
`docs/DEVIATIONS.md`. Embedding: `docs/EMBED.md`.

License: MIT.
