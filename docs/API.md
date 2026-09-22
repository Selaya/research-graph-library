# API reference

The full public surface of `sparkle-motion-visualizer`. The [README](../README.md) has the
quick tour; deep dives live alongside this file: [`RUN.md`](RUN.md) (simulated runs),
[`LIVE.md`](LIVE.md) (live runs), [`RECORDING.md`](RECORDING.md) (storyboards, camera,
video), [`THEMING.md`](THEMING.md), [`PRESETS.md`](PRESETS.md), [`EMBED.md`](EMBED.md).

## mount

`mount(el, spec, opts) → g`. `el` is an element or a selector; `opts` takes
`theme` (`auto`/`light`/`dark`), `layout` (`{dir:"LR"|"RL"|"TB"|"BT", nodesep, ranksep,
marginx, marginy, solver}` — see [Layout](#layout)),
`animation` (`{duration, easing}`), `controls`, `preset`, `storyboard`, `autoplay`
(`true`, or `'auto'` to play only when the page URL carries `?auto=1`),
`a11y: false` to opt out of the ARIA layer, and `interaction: { tapToggle: false }` to
turn off tap/click-to-toggle on container nodes (on by default; a tap that travels past
a small slop radius counts as a pan and never toggles — touch-friendly by construction).
`interaction: { click: false }` turns off the `nodeclick`/`edgeclick` events below, which
are otherwise on whether or not `tapToggle` is. `interaction: { tapToggle: { camera: true } }`
makes the reader's toggle frame what it opens or closes — the same `camera` option a
script gives `expand()` (see [Framing an expansion](#framing-an-expansion)), applied to taps and to the
keyboard toggle alike, so a container never spills past the pane when someone opens it
by hand. It is the reader's move, not the script's: the viewport stops auto-refitting,
as after a pan, but a running storyboard does not start snapshotting the camera.

`preset` is `"pipeline"`, or an object when the preset takes options:
`{ name: "pipeline", total: "sum" | "critical" | "both" }`.

## Mutations

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
g.update(id, patch, opts)   g.batch(fn)      g.style(fn)       g.theme(t)
g.validate(ops | fn)        // dry-run the structural guards; { ok, errors: [GraphError] }
g.expand(id, { camera })   g.collapse(id, { camera })   g.expandAll({ camera })   g.collapseAll({ camera })
g.condense([ids], newNode)   g.split(id, { nodes, edges })
g.run(opts)    g.storyboard(steps)   g.timeline()   g.finished   g.finish()
g.camera(target)   g.highlight(sel)   g.clearHighlight()   g.caption(text, o)   g.cues()
g.props({ id: { "--smv-fill": "#7c5cff" } }, { merge })   // overrides; null clears
g.layout(opts) g.fitView()   g.bounds()  g.layoutResult()  g.spec()  g.destroy()
g.on(type, fn) / g.off(type, fn)
```

`g.batch(fn)` is NOT transactional: `fn`'s ops commit to the store one at a time,
synchronously, as `fn` itself runs — `batch()` only defers the relayout(s) they'd each have
caused into one shared commit. An op that throws partway through leaves every earlier op
committed (no rollback). `fn` must be synchronous: a `Promise`-returning `fn` throws
`GraphError('batch-async')` immediately, rather than let its post-`await` code run after
`batch()` has already returned and drained.

## Validate before you commit

`g.validate(ops)` runs exactly those guards against a
throwaway clone of the store and commits nothing, so a diff-and-apply UI can refuse a whole
patch up front instead of discovering the bad op halfway through:

```js
const { ok, errors } = g.validate([
  { op: "addNode", args: [{ id: "verify" }] },
  { op: "addEdge", args: [{ id: "e9", source: "build", target: "verify" }] },
]);
if (!ok) return show(errors.map((e) => `${e.code}: ${e.message}`));
g.batch((b) => { b.addNode({ id: "verify" }); b.addEdge({ id: "e9", source: "build", target: "verify" }); });
```

It takes either an array of storyboard-shaped `{op, args}` steps (nested `batch` steps
included) or a `batch()`-shaped function called with a probe carrying the same mutation
methods plus `node`/`edge`/`children`/`spec`. Every `GraphError` the ops would have thrown
comes back in `errors` rather than being thrown — a failing op simply does not land in the
clone, and the ops after it are still checked. Director and transport steps (`camera`,
`run.play`, `wait`, `label` markers…) are skipped; an `op` that `storyboard()` itself would
not accept reports `validate-op`. `expand` / `collapse` steps are checked for a live id.

## `update()`

`patch.data` merges into the existing `data`. An explicit `undefined`
removes a key, and `{ replace: true }` swaps the whole payload:

```js
g.update("deploy", { data: { fail: undefined } });            // the key is gone
g.update("deploy", { data: { duration: "8s" } }, { replace: true });   // data is now exactly this
g.update("deploy", { data: {} }, { replace: true });          // data is gone entirely
```

A `data` left with no keys is dropped from the record, so `g.node(id).data` reads
`undefined` rather than `{}` (and `spec()` still round-trips through JSON).

`collapsed` is view state rather than a rendered spec field, so a `collapsed` patch is
routed to the real `expand()` / `collapse()` instead of quietly doing nothing. A patch whose
only key is `collapsed` resolves exactly as they do — `applied: false` when the container was
already in the requested state. Anything else in the same patch still renders either way, so
a patch that carries more than `collapsed` always resolves `applied: true`, whether or not
the fold actually moved.

## Errors

Every structural misuse throws a synchronous `GraphError` — a real exported
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
| `validate-op` | `g.validate()` got a step whose `op` is not a known op name (reported in `errors`, never thrown) |

## Condense (N → 1)

The set must be **convex** — no path may leave it and re-enter
(`non-convex`) — but a `loop: true` back edge never counts against that: a retry loop
around the set re-enters it rather than passing through it, and is redirected onto the
merged node like any other boundary edge.

```js
await g.condense(["call", "verify"], { id: "attempt", parent: null });
```

The merged node inherits the sources' common parent, and `parent: null` says so explicitly
(handy when the spec comes from a form or a diff, where "absent" has to be expressible).
When the sources have **different** parents there is no common one to inherit: the merged
node lands at the top level and warns — name a `parent` yourself for a cross-container
merge. A source that another source swallows (naming a container *and* one of its own
children) does not count as a second parent: its parent is disappearing with it, so the
merge still inherits the container's own parent.

## Split (1 → N)

The inverse of condense, same three-phase choreography:

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

## expandAll / collapseAll

Every container flips in ONE transition, parents first;
children bloom out of (or fly into) whichever box actually held them. Events
`expandAll` / `collapseAll` carry `{ids}` — the containers that actually changed.

## Query sugar

Read-only, returns plain copies:

```js
g.nodes()                            g.nodes({ data: { status: "done" } })
g.edges({ loop: true })              g.nodes((n) => n.data?.duration)
g.children(id)   g.descendants(id)   g.roots()
```

`g.node(id)` / `g.edge(id)` singular return the same kind of plain copy — mutating what
they hand back never touches the store.

## Click / select

A clean tap or click publishes on the instance bus, with the raw
pointer event attached. The same slop that keeps a pan from toggling a container keeps it
from reading as a click, so these never fire mid-drag; a pinch kills the gesture outright.

```js
g.on("nodeclick", ({ id, event }) => inspector.show(id));
g.on("edgeclick", ({ id }) => console.log("edge", id));   // stroke AND label are the hit area
```

Enter/Space on a focused node publishes the same `nodeclick`, so an inspector wired to it
is reachable without a pointer.

## Edge labels

`edge.label` is a string, or an object when the message *is* the content
(a sequence diagram, say) rather than a hint on a line:

```js
{ id: "e1", source: "api", target: "db", label: {
    text: "SELECT … FOR UPDATE",
    place: "start",   // 'mid' (default) | 'start' | 'end' — where along the path it rides
    rotate: true,     // lay it along the line; default upright, and never upside down
    pill: true,       // opaque backing plate instead of the background-colored halo
    maxW: 220,        // truncation cap in px for this one label
} }
```

Labels truncate at 90px by default. `mount(el, spec, { layout: { edgeLabelMaxW: 200 } })`
moves that for the whole drawing (`preset: "pipeline"` raises it to 180 when you set none),
and a per-edge `maxW` beats both. With the pipeline preset, `edge.data.duration` is drawn
as a chip on the wire next to the label.

## Director ops / storytelling

Storyboards (and the same methods called directly)
drive the presentation, not just the graph:

```js
await g.camera({ node: "clean", k: 1.8, pad: 60, dur: 700 });   // also {nodes:[…]},
g.camera({ fit: true });     g.camera({ zoom: 1.6 });           // {x,y,k}, {by:{dx,dy}}
g.camera({ nodes: ["a", "b"], maxK: 2 });   // fit lid, 1.5 by default for a union
g.camera({ fit: true, inset: { bottom: 80 } });   // pane chrome to stay clear of
g.highlight({ nodes: ["a"], edges: ["e1"], variant: "focus", dim: true });  // spotlight
g.highlight({ nodes: ["a"], variant: "warn", pulse: true });     // + an attention beat
g.clearHighlight();
g.props({ clean: { "--smv-fill": "#7c5cff" } });   g.props(null);  // override layer
g.props({ clean: { "--smv-fill": "#f50" } }, { merge: true });   // …or patch it
g.caption("Three manual steps become one.", { place: "bottom" });  g.caption(null);
g.cues();   // every label + caption with its absolute ms offset — the voice-over sheet
```

In a storyboard a `dur` on a `caption` (or `highlight` / `props`) step is its **hold**:
`{ "op": "caption", "args": ["…"], "dur": 1500 }` shows the line and keeps the clock for
1.5s — one step in place of `caption` + `wait`, and the cue sheet's subtitle span ends
where the hold does.

Every storyboard step — a mutation op name (the set mirrors `g`'s own methods:
`condense`, `split`, `expandAll`, `collapseAll` and `layout` included), a run op
(`run` to recompile like `g.run(opts)`, `run.reset`, `run.play`, `run.step`, `run.seek`) or
a director op — is validated when the storyboard is *built*,
not when it plays: an unknown op throws `GraphError('storyboard-op')` at the step's own
index, recursing into `batch` children too (a typo three levels into a nested `batch`
throws as step `"1.2.0"`, not a bare `TypeError` mid-playback), and a malformed `props`
step's keys are checked the same way, at the same time. Camera and highlight misuse — an
unresolved node id, a mistyped key (`nod` for `node`), an unsupported `variant` — is
presentational, not structural: it never throws, just one `console.warn` per call naming
every issue found (`[smv:camera] …` / `[smv:highlight] …`), and the call still does its
best with whatever it could resolve.

Camera moves ride the shared clock and cancel-and-retarget like everything else; the
`run` and `run.reset` cost nothing on the cumulative timeline (they put the run's clock
back to 0). `run.play` is priced off the compiled transport, and only one compile is live
at a time — a script that recompiles *between* two `run.play` steps gets a cue sheet that
changes as it plays, so keep one compile per script when the numbers have to be exact
(`docs/RUN.md`, "Driving a run from a storyboard").

## Framing an expansion

Don't chase it with the camera. The reflex — `camera({node})`,
then `expand(id)`, then a second `camera` to fit what spilled past the pane — is three
tweens where one was wanted, and it reads as a zoom-in / overflow / zoom-out stutter.
Give the toggle the shot instead:

```js
await g.expand("clean", { camera: true });            // frame the OPENED box, one motion
await g.collapse("clean", { camera: { fit: true } }); // …or the whole graph, closed
g.expandAll({ camera: true });                        // fit everything, opened
```

`camera` on `expand` / `collapse` / `expandAll` / `collapseAll` (and on
`update(id, { collapsed }, opts)`) takes the same target object as `g.camera()`, but it is
resolved against the layout the toggle *produces* and flies on the toggle's own clock — a
storyboard step's `dur`, or the mount's `animation.duration` — so the pull-back and the
bloom are one movement. `true` frames the toggled container itself (`fit: true` for the
`-All` ops); an object that names no box (`{ pad: 60 }`) frames it with those options; a
fitted scale is lidded at 1.5 like a `nodes` union, so a lone closed box is never a
close-up (`k` / `maxK` still win). Taking the shot takes the camera exactly as
`g.camera()` does, and a toggle that turns out to be a no-op still flies it, resolving
`applied: false` — so an assistant re-issuing "show me this open" gets the same frame twice
instead of a warning. In a storyboard: `{ "op": "expand", "args": ["clean", { "camera": true }] }`.

## Framing any mutation

The same option is on every op that re-lays the graph out —
`addNode`, `addEdge`, `removeNode`, `removeEdge`, `update`, `layout`, and the `condense` /
`split` choreographies — because "add this and show me it" has the same problem: the shot
depends on where the new node *lands*, which no `camera` step can know until the add has
already committed. For `condense` it is worse: the merged id does not exist until the
converge phase, so a `camera({node})` before the step warns and one after it starts 900ms
late. `true` frames the op's subject: the added or patched node (with `after`, that node
and the one it hangs off), an edge's two endpoints, the merged node, the union of a
split's parts; ops with no one subject (a remove, `layout`) fit the whole graph. Inside a
`batch` a child's shot is composed against the batch's single commit:

```js
await g.addNode({ id: "deploy" }, { after: "test", camera: true });     // frame test + deploy
g.batch((b) => {                                                        // one commit, one shot
  b.addNode(m, { camera: { nodes: [prev, m.id], maxK: 1, pad: 120 } });
  b.addEdge(e);
});
await g.layout({ dir: "TB" }, { camera: true });   // refit after a direction change
await g.condense(["x", "y", "z"], { id: "clean" }, { camera: true });  // frame the merge as it lands
```

Without it, `layout({ dir })` under a script-owned camera re-flows the drawing under a
shot composed for the old direction — the anchored viewport never refits on its own once
the script has taken the camera.

Camera moves ride the shared clock and cancel-and-retarget like everything else; the
first one in a script takes the viewport (auto-refit stops, the camera joins the scrub
snapshots). Every fit — `g.fitView()`, `camera({fit})`, `camera({node|nodes})` — frames
inside the pane *minus the chrome the library mounted over it* (transport bar, the preset's
total-duration bar, the caption strip), so the last rank never lands underneath them; pass
`inset: {top,right,bottom,left}` for chrome of your own (only the library's own top/bottom
bars are measured), or `inset: 0` to opt out. The caption strip counts while it is up, so
fit before you caption if a beat should hold one framing. Targeting
a node inside a collapsed container aims at the ancestor drawn in its place instead of
warning. A highlight *is* the emphasis state (replace, not accumulate) and survives
relayouts and backward scrubs — and so does the `props` override layer, which sits over
your `style()` function on the same `--smv-*` channel (`g.props(patch, { merge: true })`
patches that layer instead of replacing it). `pulse: true` breathes the
emphasis off the shared ticker (never a CSS animation, so it records frame-perfectly;
reduced motion holds it still). Every storyboard step takes an optional `dur` (ms) —
per-step pacing for any op, and the number the scrubber, `g.cues()` and
`smv-record` all agree on. Mount opts: `captions: false` hides the caption overlay
(cues stay truthful); `motion: "full"` and `ticker: "manual"` are recording mode.
The full script-writing and video-recording guide is [`docs/RECORDING.md`](RECORDING.md).

## Knowing when the story ended

`g.finished` is one promise per instance, resolving
`{reason}` when the storyboard runs out of steps (`"storyboard"`), when the page calls
`g.finish()` — the explicit end for a live-mode or hand-driven story, which has no last
step to reach — or when the instance is destroyed (`"destroy"`, so awaiting it can never
hang). `g.on("finish", …)` is the same beat as an event. With `autoplay: 'auto'` (plays
only when the page URL has `?auto=1`) it is the whole unattended-playback convention:

```js
const g = mount("#pipe", spec, { storyboard: steps, autoplay: "auto" });
window.smv = g;              // what npm run check-demos looks for
await g.finished;            // { reason: "storyboard" }
```

## Runs

`g.run()` animates tokens flowing through the graph, in one of two modes.

`g.run()` (no args) returns the current run — compiling a default Mode A one on first call
if none exists. `g.run(opts)`, with **any** opts object, even `{}`, destroys the current
run and replaces it with a fresh one built from `opts`; call it bare unless you actually
mean to restart the run. Your subscriptions survive that recompile — everything registered
with `run.on(...)` is carried onto the new transport (`run.off()` still drops it), and
every run event is mirrored onto the instance bus as `g.on("run:finish", …)` /
`g.on("run:end", …)`, which outlives any number of recompiles.

**Simulated (Mode A, the default)** compiles a whole schedule up front from declared
`data.duration`s, so seek, scrub, `step()` and per-branch `speed()` are exact:

```js
const run = g.run();
run.play({ until: "deploy" });   run.pause();   run.seek(4000);   run.step();
run.speed(2);                    run.speed(0.5, { branch: "clean" });
run.inject("compensate", { at: 8000 });
run.on("loop", ({ edgeId, iteration, max }) => g.caption(`attempt ${iteration}/${max}`));
```

Durations are `"45m"`, `"1.5h"`, `"400ms"` (a bare number is seconds). Fan-in is an
implicit AND-join unless `join: "all" | "any" | { count }` says otherwise; `loop: true`
edges need `maxIterations`; `data.fail` (optionally with `retries`/`recover`) makes a step
fail as a first-class outcome. Full reference — duration grammar, seeding tokens,
failures and retries, multi-port containers, retry-loop semantics and the event
vocabulary: [`docs/RUN.md`](RUN.md).

**Live (Mode B)** replays a real, append-only event log as things actually happen, with
time-travel scrub back through it:

```js
const run = g.run({ mode: "live" });
run.start("build");   run.finish("build");   run.spawn("test", 3);
run.fail("check", { reason: "exit code 137" });
run.seek(pastMs);     run.follow();          run.log();
```

Joins, occupancy, reconnect/re-seed and a WebSocket wiring example:
[`docs/LIVE.md`](LIVE.md).

## Accessibility

`attachA11y` runs at mount unless `opts.a11y === false`: the svg is
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

## Layout

Layered (Sugiyama-family) and **in-house** — `src/engine.js`, ~630
lines, no dependencies: cluster-aware ranking (longest path + a tightening pass), dummy
bend chains, median ordering sweeps with transpose and previous-order tie-breaks, and a
coordinate pass that repairs every relaxation move with isotonic regression, so
"≥ `nodesep` apart, never overlapping" is an invariant rather than a hope. It replaced
`@dagrejs/dagre`, which cost 17.1KB gzip against the engine's 4.0KB.

```js
mount(el, spec, { layout: { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 } });
g.layout({ dir: "TB" });    // relayout + animate into the new direction
```

A node's box is measured from its label. `layout.measure` lets whatever decorates a node
contribute to that measurement, so a corner chip and a long label stop fighting for the
same pixels:

```js
mount(el, spec, { layout: { measure: {
  extraWidth: (node, ctx) => (node.data && node.data.owner ? 44 : 0), // number, or a fn
  extraHeight: 8,
} } });
```

`extraWidth` is reserved **chrome**, not label room: it widens the box *and* comes out of
what the label may fill, so the label truncates before it reaches your decoration. It grows
the box only up to the usual 220px maximum — past that the label gives way instead. A node
that declares both `w` and `h` opts out; one that declares only `w` keeps its width and
still gets the reserve. `ctx` is `{nodes, cache}` — the whole node set, for chrome whose
size depends on more than the node itself. `preset: "pipeline"` installs its own unless you
set one, which is why a preset mount sizes nodes slightly larger than a bare one.

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
head and stop worrying about whether that head survives, and a `condense()` or `split()`
hands the slot on to the nodes it mints. The list always outranks that memory, which only
places components no listed id claims; handing `g.layout()` a different list (or `null`)
drops the memory entirely and re-resolves from what you just passed. One consequence: if a
remembered component and a listed one end up with the same slot (re-add a deleted head as a
fresh, unconnected node, say), they share that band rather than splitting it.

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

## What a solver sees

Each input node is
`{ id, w, h, parent?, container?, data? }`. `data` is the node's own spec `data`, so a
placement-driven solver (an actor column, a time row) can read per-node hints straight off
the graph instead of keeping its own registry — pass `layout: { hint: (n) => … }` to send
something else (or `undefined`) in its place. `container: true` marks a container,
*including* one declared with `container: true` on the spec before it has any children.
Every key you put on the layout opts reaches the solver untouched, by spread, so a solver's
own options travel with it:

```js
mount("#seq", spec, { layout: { dir: "TB", solver: seq.solver, minColWidth: 140 } });
```

A solver that returns no rect for a container *with children* is not guessing wrong: the
shell then derives that container's box purely from its children's bounding box plus
`containerPad`. An empty declared container has no bbox to derive from, so an omitted rect
leaves it at the origin and the shell warns (`[smv:layout] solver returned no rect for
empty container(s): …`).

## Exports

ESM-only entries (not in the IIFE):

```js
import { exportSVG, exportPNG } from "sparkle-motion-visualizer/export";
const svg  = exportSVG(g, { pad: 24, theme: "dark" });   // standalone SVG string (whole graph)
const shot = exportSVG(g, { viewport: true });           // current pan/zoom framing, culling kept
const blob = await exportPNG(g, { scale: 2 });           // browser only
```

Also ESM-only, each with its own `types:` condition:
`sparkle-motion-visualizer/preset-pipeline` (writing your own preset — see [`docs/PRESETS.md`](PRESETS.md))
and the CLIs' own pure functions, reachable without shelling out —
`sparkle-motion-visualizer/cues` (`formatCues`, `toSRT`, `toChapters`) and
`sparkle-motion-visualizer/fit` (`fit`, `parseMarks`).

## CLIs

- **`smv-pack`** inlines the built IIFE, a spec and an optional storyboard into one
  self-contained `.html`: `npx smv-pack spec.json -o out.html --storyboard sb.json`.
  See [`docs/EMBED.md`](EMBED.md).
- **`smv-record`** renders a storyboard frame by frame in headless chromium into an mp4
  (or a PNG sequence, cue sheet, subtitles, chapter list) — two runs are byte-identical.
- **`smv-fit`** stretches a storyboard's `wait` steps so every label lands on a
  voice-over timestamp.

Both recording tools are covered in [`docs/RECORDING.md`](RECORDING.md).
