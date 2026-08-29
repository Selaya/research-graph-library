# Deviations from docs/PLAN.md

Per the ground rules: any place the implementation departs from the plan's core
decisions (D1–D11), with reasoning.

## 1. Back edges are excluded from dagre's ranking, not fed to it reversed (D3)

**Plan:** "edges are flipped only inside the ranking pass, tagged `reversed`, and
restored for rendering."

**Implementation (`src/layout.js`):** reversed edges (explicit `loop: true`, pinned
reversals, and DFS-detected back edges) are withheld from the dagre graph entirely.
Their geometry is synthesized as a consistent-side arc (below the flow for LR) after
dagre positions the forward subgraph.

**Why:** feeding a reversed loop edge to dagre lets it participate in rank compaction,
so appending unrelated nodes can re-shape or re-route the loop between layouts — exactly
the mental-map violation D3's pinning exists to prevent. Excluding the edge makes the
"back edge never flips sides" exit criterion true *by construction* (verified across
overlapping appends in `test/e2e-m0.mjs`), at the cost of loops not pulling their
endpoints closer together in rank. For the human-scale graphs in scope, side-stability
won over compaction. The `reversed` tag still feeds styling and token loop-back
semantics exactly as D3 specifies.

**M3 update:** revisited and kept. The in-house engine owns ranking now, and the shell
withholds back edges from it for the same reason — the solver contract (INTERNALS §M3)
states the acyclic input as an invariant, and `test/layout.test.js` asserts the shell
never hands a reversed edge down.

## 2. Edges to an *expanded* container attach to an interior entry/exit child (D5)

**Plan:** "while expanded, edges attach to the actual child, not the container."

**Implementation (`src/viewstate.js`):** the same — but note it is also *forced*:
dagre throws on any edge incident to a cluster node, so `view()` re-attaches boundary
edges of expanded containers to the interior entry child (no incoming interior edge)
or exit child (no outgoing interior edge), deterministic first/last fallback. The edge
keeps its own id, so the attachment tweens smoothly across expand/collapse. This is a
sharpening of D5 (which child, chosen how), not a contradiction; recorded because the
"entry/exit child" rule is an implementation decision the plan left open.

## 3. D5's four-step relayout realized via dagre's compound layout + post-padding

**Plan:** the explicit four-step pipeline (child layout → resize → parent relayout →
translate).

**Implementation (`src/layout.js` `padContainers`):** dagre's native cluster handling
performs the space reservation and sibling reflow in one pass (that is what D2 chose it
for); a post-pass grows each cluster rect to the union of dagre's reservation and
(children bbox + header/side padding) so the 28px header strip always clears children.
Same result as the four steps — containers size to content, siblings never overlap —
with dagre doing steps 1–3.

**M3 update:** unchanged, with the in-house engine in dagre's place. `engine.js` reserves
the cluster corridor with border dummies per spanned rank and emits a container rect
covering its children + 8px; `padContainers` still grows that to clear the 28px header
strip. The post-pass survives the swap verbatim — it was written against the seam's
output, not against dagre.

## 4. Mode B realizes D4's token↔morph rule by rewriting the log, not by carrying progress (D4)

**Plan:** "When `condense()` removes nodes that hold live tokens, tokens remap to the
target node, carrying `max(progress)` of their sources; tokens on plainly-removed nodes
ghost-fade out."

**Implementation (`src/run-transport.js`, live branch):** Mode A answers a condense by
sampling the old schedule and recompiling, which is why it hands the merged node a
progress floor and ghost-fades the tokens that vanish. Mode B has no schedule to
recompile — its truth is the event log — so the equivalent operation is to rewrite
history: every log entry naming a removed source is re-pointed at the survivor (for a
`split`, at the entry part). The merged node then inherits its sources' `start`/`finish`
instants and re-fans them over the redirected edges by ordinary replay. `remap` is still
emitted (so the renderer's progress floor works identically), but with `ghosts: []`.

**Why:** nothing is "plainly removed" once the log is remapped — no token disappears, so
there is nothing to ghost-fade, and the merged node's progress is derived rather than
asserted. Leaving the log alone was the alternative, and it is not a simplification but an
inversion of the rule: `replayLive` filters the log by `nodes.has(e.id)`, so the whole of
the sources' history is silently deleted on the next replay, the tokens downstream of them
vanish with no fade, and `state().done` flips true in the middle of a running pipeline.

## 5. Mode B does not re-resolve past events against topology that postdates them (D4)

**Plan / M2 contract:** "Graph mutations mark dirty exactly as Mode A (replay hits the new
spec lazily)."

**Implementation (`src/run-transport.js` + `src/run-live.js`):** still lazy and still
uncompiled — but the live transport stamps each edge with the frontier instant it was
added (from the host bus's `add` event) and `replayLive` skips fan-out over an edge whose
stamp is newer than the `finish` being replayed.

**Why:** in Mode A "recompute against the current spec" is correct, because durations are
declared truth and the schedule is a derivation. In Mode B the log is a *record*: an edge
added now was not there when a node completed a minute ago, so re-fanning that finish over
it fabricates a traversal and an occupant that never happened — visible live, and visible
again when scrubbing back to an instant before the edge existed. D4 frames Mode B as
"Temporal-style time-travel into history", which this protects. Nodes are not stamped:
replaying an event for a node is only ever driven by an explicit log entry naming it.

## 6. The Mode B frontier is floored by a seeded log (M2 contract)

**Plan / M2 contract:** "the frontier ... starts at 0 when the run is created."

**Implementation (`src/run-transport.js`):** exactly 0 for a run created with no log —
the normal case, unchanged. When the run is *seeded* with one (`opts.log`, or
`reset(opts.log, time)`, both of which the same contract exists to support), the frontier
starts at that log's own span instead.

**Why:** `t` is clamped to `[0, frontier]`, so a frontier of 0 makes every seeded event
past `t=0` permanently unreachable — `seek()` cannot get to it and `state()` cannot show
it. That made both documented uses of `opts.log` (re-seeding and the G2 storyboard
snapshot/restore round trip) silently no-ops. Real elapsed time still advances the
frontier from there exactly as before.

## 7. `aria-label` reflects live run status, and the linearized table defers to the tree (M2 a11y contract)

**Plan / M2 contract:** per node, "`aria-label` = `label · status` (from spec/data)"; and
`a11y-table.js` is offered as an "accessible fallback" with no stated relationship to the
always-on interactive tree.

**Implementation (`src/a11y.js`, `src/run-render.js`, `src/a11y-table.js`):** the name
prefers the live run status (the `data-run` channel run-render.js owns, announced on a new
`runstatus` bus event) and falls back to `data.status`; and `attachA11yTable` marks its
table `aria-hidden` while the interactive tree is attached.

**Why:** the contract line was written before Mode A/B run playback existed as an M2
surface, and taken literally it leaves a screen-reader user with no signal whatsoever
while a run plays — sighted users get fills, pulses, badges and `data-run` styling. Run
state is never written back into the spec (deliberately), so "from spec/data" could never
carry it. Separately, nothing prevented a page attaching both a11y surfaces — the
documented `attachA11yTable(g, …)` snippet does not tell the caller to pass `a11y: false`
— which made assistive tech read every node twice; exposing exactly one of the two keeps
either configuration correct.

## 8. M3 "parity" with dagre is structural + crossing non-regression, not coordinate identity (D2)

**Plan:** the in-house engine is "gated on golden-file parity tests and a crossing-count
non-regression."

**Implementation (`test/layout.test.js`, `test/golden/*`, `test/engine-parity.test.js`):**
the goldens were **regenerated** at the swap, and the gate is defined as:

- every forward edge strictly advances along the rank axis;
- no two sibling nodes overlap, same-rank neighbours keep ≥ `nodesep`, children stay
  strictly inside their container rect (post-`padContainers`);
- per-fixture crossings ≤ the **hard-coded dagre-era count** (`DAGRE_CROSSINGS` in
  `test/golden/crossing.js`: diamond 0, loop 0, selfloop 0 — measured on
  `@dagrejs/dagre` 3.1.1 immediately before the swap, and re-measurable at any time via
  `dagreLayout` from the adapter);
- `test/engine-parity.test.js` additionally runs both solvers over the fixtures plus 45
  seeded synthetics (a `siblings` kind — two or three sibling containers trading edges
  across the ranks they share — joined the corpus with item 14) and requires
  `crossings(engine) ≤ crossings(dagre)` on goldens,
  `≤ +2` on synthetics (observed: never worse, 20 vs 29 in total);
- shell behaviour (back edges below the flow for LR, self-loop side arcs, pinning) is
  unchanged and still asserted by the same tests, unmodified in spirit.

**Why:** "golden-file parity" cannot mean *coordinate-identical to dagre* — a different
engine that reproduced dagre's coordinates would be dagre. Two differences are
structural and intended: (a) edge points now start and end at node **centres** rather
than on the node border (`clipEnds` in `path.js` trims either form identically, verified
over both solvers' output), and (b) an adjacent-rank edge is **2 points**, where dagre
always emitted 3 because it doubles ranks to make room for edge labels. Coordinates are
also quantized to 1e-4 px. The goldens therefore still do their real job — they pin
*this* engine byte-for-byte, so an unintended layout change fails loudly — while the
cross-engine promise is the invariant + crossing bar above.

One behaviour genuinely lost in the swap: **parallel edges between the same
adjacent-rank pair now get identical polylines**, where dagre bent them apart via its
intermediate-rank dummy. Multi-edges spanning two or more ranks still separate. Fanning
coincident edges is a *rendering* concern, not a solver one, so it is not being added to
`engine.js`; if it is ever wanted it belongs in `render.js`/`path.js`.

Two facts worth recording from the parity run: the engine reproduces dagre's node
coordinates exactly on the diamond fixture (with B/C mirrored), and **dagre 3.1.1 itself
throws `Not possible to find intersection inside of the rectangle` on 3 of the 40 seeded
compound synthetics** — the engine lays out all 40. The parity test tolerates dagre
crashing (skips that comparison, still requires ≥30 comparable graphs) rather than
pretending it did not happen.

## 9. dagre survives as an optional adapter, not a dependency (D2/D11)

**Plan / M3:** "dagre becomes an optional ESM adapter."

**Implementation (`src/adapters/dagre.js`, `package.json`):** `layout()` is now a shell
around a pluggable `opts.solver` (default `engineSolve`); `dagreSolver`/`dagreLayout` are
the M2-era invocation, verbatim, behind that seam. `@dagrejs/dagre` moved from
`dependencies` to `devDependencies` + an **optional** `peerDependency`, exported as
`sparkle-motion-vizualizer/adapters/dagre`. `scripts/build.js` hard-fails if the string
`@dagrejs`/`graphlib` appears in any bundle, or if `dagre` appears in either minified one.

Recorded because it changes the install contract: nothing on the default path imports
dagre, so a consumer who wants the adapter installs the peer themselves. Verified
equivalence at the swap: `dagreLayout` reproduces all three pre-M3 goldens byte-for-byte.

**Now gated, not just asserted (review fix):** that sentence was a one-off manual check —
no test imported `src/adapters/dagre.js` at all (`test/engine-parity.test.js` hand-rolled
its own copy of the dagre invocation), so a botched rankdir or dimension mapping in the
shipped adapter could break the public escape hatch with the whole suite green. The
pre-M3 output is now committed under `test/golden/dagre/{diamond,loop,selfloop}.json`
(commit `01b9911`'s goldens verbatim, minus the `crossings`/`order` keys that did not
exist then) and `test/adapter-dagre.test.js` imports the real `dagreSolver`/`dagreLayout`
and byte-compares against them. Confirmed live: swapping `w`/`h` in `dagreSolver` — the
realistic form of this regression — now fails four tests; before, it failed none.

## 10. Compositor offload: deferred, pending the verify agent's profiling (D1)

**Plan:** "Selective compositor offload for non-choreographed motion (profiled)" —
explicitly "a profiling-driven M3 optimization, not a design premise."

**Implementation:** not built. The decision gate is the verify agent's 300-node headless
profile: if the median frame is ≤ 8ms, the entry stands as *"not justified at v1 scale"*
and no compositor path is added. Viewport culling — the other half of that milestone
line — **is** built (`renderer.setCull` + `viewport.visibleWorldRect`, engaged only above
150 elements, wired in `index.js` and re-armed from `viewport.onChange`).

**Review fix — "re-armed on pan/zoom" was narrower than it read.** Culling re-ran only
from the svg's own `pointermove`/`pointerup`/`wheel` listeners, so every *programmatic*
viewport move left the previous transform's hidden elements hidden: `g.fitView()` reset
the transform correctly and still showed ~13% of the graph, and `g.viewport.zoomBy()`
was the same. The re-arm now hangs off `viewport.onChange`, which fires from the single
place the transform is ever written (`apply()`), so it covers drags, pinches, wheel
zooms, `fit()`/`zoomBy()`/`anchor()` and every tick of their tweens alike; it skips while
a scene transition is live, because that already repaints (and re-reads the cull rect)
every tick. `demo/m3-scale.html` no longer needs the synthetic `pointermove` it used to
dispatch after its programmatic zoom, and `test/e2e-m3.mjs` now asserts
`culledAfterFit === 0` (measured: 0 → 754/870 zoomed → 0 after `fitView`).

Culling is *live-DOM* state, which two other modules read, and both were wrong about it:

- **`export.js`** builds the exported document by cloning the live svg. It reset the
  viewBox to the whole graph but left `data-culled` + `display:none` on the clone, so
  exporting while zoomed in produced a valid SVG (and PNG) whose metadata claimed the
  whole drawing while ~87% of it was hidden — silent, no error. It now clears both on
  the clone: a standalone export always draws everything its viewBox claims.
- **`a11y.js`** moved the roving tabindex before calling `.focus()` and never checked
  that focus moved. `.focus()` on a `display:none` element is a silent no-op, so
  `Home`/`End`/arrows landing on a culled node put `tabindex="0"` on something nobody
  can reach while the element that still held focus was demoted to `tabindex="-1"`.
  Arrow/Home/End now walk the focusable subset, and `focusId` refuses to commit to a
  culled element.

**Measured (verify agent, `demo/m3-scale.html` + `test/e2e-m3.mjs`, headless chromium,
1280×900, `--no-sandbox`):** a synthetic 300-node / ~570-edge layered graph (870 rendered
groups, well above the 150-element culling threshold), driven through a 2-second simulated
pointer pan (real `PointerEvent`s dispatched on `renderer.svg`, exercising the actual
pan → recull → `renderer.frame` path). Per-frame cost is the *synchronous work time* inside
each frame's `dispatchEvent` call, not the wall-clock gap between `requestAnimationFrame`
callbacks (that gap is vsync-bound at ~16.7ms regardless of work done, and would make every
page "cost" the same — measuring it would have produced a false positive here: an early,
uncorrected pass of this same harness recorded ~16.7ms via that wrong method before the fix).

| metric | value |
|---|---:|
| median frame | **1.6–1.8ms** (two runs) |
| mean frame | 1.7ms |
| max frame (worst observed) | 13.4ms (one outlier per run; GC/layout-thrash class, not the steady state) |
| samples | 120–121 over 2s |
| groups culled at initial fit (whole graph visible) | 0 / 870 |
| groups culled after a moderate zoom into one corner | 754 / 870 (~87%) |

Median ≤ 8ms by a wide margin (≈5× headroom before the budget is even touched) — the
*"not justified at v1 scale"* verdict stands. Culling alone is doing the load-bearing work:
with 87% of groups skipped once zoomed in, the remaining paint cost is small even before
considering any compositor split. Re-measure if the target scale grows materially past
300 nodes or the pan/zoom interaction pattern changes.

**Why:** D1's own rationale argues *against* splitting motion across the compositor and
main threads (edges visibly detaching from nodes under jank), and the plan makes the
optimization conditional on measurement. Building it unmeasured would trade the one-clock
guarantee for a speed-up nobody has shown is needed.

## 11. Gantt/temporal layout mode: skipped (M3)

**Plan:** "Gantt/temporal layout mode (x = time, sweeping-line scrubber) **if demanded**."

**Implementation:** not built. No demand has materialized, and the plan's own condition is
explicit. The solver seam (item 9) is what makes it cheap later: a temporal mode is another
`opts.solver`, not a fork of `layout.js`.

## 12. Known M3 follow-up: token pulses are not culling-aware (M3 culling contract)

**Contract:** "culling must not corrupt tokens whose node is culled (skip drawing their
pulse when outside)."

**Status:** the renderer's culling is complete and correct (geometry writes skipped,
`data-culled` + `display:none` on the group, restored on re-entry). `src/run-render.js`
reads token positions from `scene.visual`, which is culling-agnostic by design, so a
token pulse anchored to a culled node is still drawn — a floating pulse with no visible
node under it, at the far edge of a 150+ element graph. `run-render.js` is not in the M3
file-ownership table, so the fix (check `data-culled` / `display` on
`renderer.node(id)` before drawing the pulse) is deliberately left as a scoped follow-up
rather than an out-of-lane edit. Nothing else about culling depends on it.

## 13. The order-stability channel is two arrays, not one: `order` + `layers` (D2/M3)

**Contract (INTERNALS §M3, as first written):** "`order` = final per-rank id sequences
(real nodes only) — the caller persists it and passes it back as `prevOrder`", and
"feeding `order` back as `prevOrder` is a fixed point".

**Problem:** those two sentences cannot both be true. `order` names only the real nodes,
and a layered drawing is not determined by those alone — every multi-rank edge's bends
sit *between* them, and so does a container that spans a rank without holding anything
there. Both were re-derived from scratch on each solve while the real nodes were not, so
a re-solve started from a differently-scored arrangement than the one it was supposed to
reproduce, some sweep looked "strictly better", and it was adopted along with whatever
real-node reshuffling that sweep also did. Measured on 600 random DAGs, calling
`.layout()` twice on an unmodified graph changed the per-rank order on **232** of them
and moved node coordinates on **440** — a documented no-op API path (`index.js`
`relayout()` always threads `prevOrder`) visibly jumping the whole drawing.

**Implementation:** `engineSolve` now also returns `layers` — the same per-rank sequences
with those items interleaved as opaque tokens — and accepts it back as `opts.prevLayers`.
`layout()` passes both through, `mount()` persists both (including in the storyboard
snapshot, which owns solver order for the same G2 reason it owns the FAS pins), and the
ordering search was made **idempotent**: it now ends only once a full run of sweeps
started from the best arrangement fails to improve on it, instead of after a fixed eight.
Result on the same 600 graphs: **0** order drift, **0** coordinate drift.

**Why not the obvious alternative:** deriving the bends deterministically from the real
order (so `order` alone would suffice) was tried and rejected — it is a much worse
drawing. Bend placement is most of what the ordering sweeps buy: total drawn crossings
over 300 random graphs went 1339 → 3707, and the engine went from beating dagre
everywhere to being worse than `dagre + 2` on 76 of them. Persisting the bends keeps the
sweeps free and costs one more array.

**Cost:** the solver contract gained a field, so a third-party solver that does not
produce `layers` (the dagre adapter is exactly that) simply omits it and the shell
degrades to `[]` — asserted in `test/adapter-dagre.test.js`. The 300-node solve went
25ms → ~40ms for the idempotent search; the budget is 4000ms.

## 14. Container geometry: what the solver reserves, and the residual limit (D5/M3)

**Contract (item 8, the M3 gate):** "no two sibling nodes overlap, ... children stay
strictly inside their container rect (post-`padContainers`)."

**What was wrong.** Three separate things, all of which could put a container rect on top
of a sibling — including, at worst, handing two sibling containers *byte-identical* rects
each reporting the other's children as inside it:

1. **Block order was per-rank.** Each rank sorted its cluster blocks by the mean key of
   that rank's own members, with no memory across ranks, and the border-dummy chains that
   exist to penalise interleaving were only crossing-count fodder, never a constraint. A
   container could therefore sit left of a sibling on rank 0 and right of it on rank 1;
   since the emitted rect is the union of the members' cells across *all* ranks, both
   siblings got a rect spanning the whole drawing. A cluster's block order is now decided
   once, globally, and applied at every rank it spans.
2. **The alignment targets were geometrically infeasible.** A border dummy was pinned
   `nodesep/2` outside the rect while the separation rule demanded a full node's gap
   between it and the first member inside — 6px of contradiction per pass at the
   defaults, which the loop chased for exactly three passes and then stopped, emitting
   rects nothing had ever been separated against. Worse, two *nested* borders were
   charged `1.5 × nodesep` while the rects they mark nest only `CLUSTER_PAD` apart, so at
   two or more nesting levels PAVA pooled them and the corridor collapsed onto a sibling.
   Border width and offset are now derived from the padding actually drawn, a nested
   border pair costs the nesting step, and the loop runs until the rects stop moving.
3. **Chrome was never reserved in the rank axis.** The rect grows `CLUSTER_PAD` (engine)
   and then `CONTAINER_PAD` (`padContainers`) past its outermost member; ranks were
   spaced by `ranksep` alone, so below `ranksep ≈ 12` (or `nodesep ≈ 6`) the padded rect
   simply ate the neighbouring rank. `layout()` now tells the solver how much chrome it
   is about to add (`opts.chromePad`) and the solver reserves it where a container's span
   starts and ends. Sibling containers whose rank spans overlap are also grown to their
   common window, so the band each reserves exists on every rank that can put them side
   by side.

**Residual, recorded honestly.** On 400 *randomly generated* cluster forests (random
nesting up to 4 deep, random cross-cluster edges) the contract violation rate went from
**292/400 to 60/400** at two nesting levels, and 278 → 70 at four. It is not zero. The
remaining cases are the structural limit of a rectangular container over a rank range:
two containers whose spans only partly overlap have their in-rank bands set by members on
ranks the other does not span, and the per-rank border alignment can be asked for
something no single rectangle satisfies. Closing that properly means a real nesting graph
(dot's approach) rather than border dummies plus an alignment loop, which is a larger
change than this review warrants — plan §9.1 ships the simple heuristic on purpose. Every
shape the gate names is covered by a test (`test/engine.test.js` sibling containers and
3-level nesting, `test/layout.test.js` small `nodesep`/`ranksep`) and a new `siblings`
generator joins the seeded parity corpus, which is now 45 graphs.

## 15. The core-size metric bundle is a build artifact, not a deliverable (D11)

**Plan D11:** the published dist surface is `smv.esm.js` + `smv.iife.min.js`.

**Problem:** `scripts/build.js` emits a third bundle, `smv.core.esm.js`, built with
`external: ['./engine.js']` purely so `size-budget.js` can subtract the layout engine from
the "core, no layout" gzip figure. Its own comment said "never shipped" — but
`package.json`'s `files` packs the whole of `dist` with no exclusions, so ~106KB of dead
code went out in every publish, and it is a *broken* module the moment anything loads it
(the externalized `./engine.js` is never emitted next to it). No documented entry point
reaches it (`exports` has no `./dist/*` subpath), so the exposure was package bloat plus a
trap for anyone poking at `node_modules` or a hand-built CDN URL — but "never shipped" was
simply false.

**Implementation:** the metric bundle is written to `build/` (gitignored, absent from
`files`), `size-budget.js` reads it from there, and `build.js` deletes any stale copy left
in `dist/` by an older checkout. `test/package.test.js` gates all three facts.

## 16. condense/split seat their new node where the sources were, not at the tail (D6)

**Contract (INTERNALS §M3 ordering):** "init from `prevOrder` (append unknown ids in
input order)" — i.e. an id the previous drawing never had sorts after everything known.

**Problem:** `condense`/`split` mint brand-new ids, so that rule put the merged (or split)
node at the *end* of its rank on the very layout the choreography commits — while
`condense-anim.js`/`split-anim.js` animate its entrance out of the sources' old centroid.
The node bloomed where the sources were and then flew past every untouched sibling to the
end of the rank. Measured on a 5-way fan: sources at y=38/102 (centroid 70) produced a
merged node at y=230, past all three siblings that never moved; splitting the middle node
(y=166) landed its parts at y=294/358.

**Implementation:** `mount()` gained an internal `reseat(newIds, sourceIds)` that rewrites
the persisted `order`/`layers` so the new ids take the slot the sources held, and both
choreographies call it right after the store mutation and before the relayout. The general
"unknown ids append" rule is unchanged — this is the one case where the previous drawing
*does* say where the new node belongs, because the thing it replaces was there.

**Why it was invisible:** `test/condense.test.js`'s fake host does not thread `prevOrder`
through its relayout stub at all, so it structurally could not see this. The regression
test (`test/mental-map.test.js`) drives the real `mount()` instead.
