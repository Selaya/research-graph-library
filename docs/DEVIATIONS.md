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
- `test/engine-parity.test.js` additionally runs both solvers over the fixtures plus 40
  seeded synthetics and requires `crossings(engine) ≤ crossings(dagre)` on goldens,
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

## 10. Compositor offload: deferred, pending the verify agent's profiling (D1)

**Plan:** "Selective compositor offload for non-choreographed motion (profiled)" —
explicitly "a profiling-driven M3 optimization, not a design premise."

**Implementation:** not built. The decision gate is the verify agent's 300-node headless
profile: if the median frame is ≤ 8ms, the entry stands as *"not justified at v1 scale"*
and no compositor path is added. Viewport culling — the other half of that milestone
line — **is** built (`renderer.setCull` + `viewport.visibleWorldRect`, engaged only above
150 elements, wired in `index.js` and re-armed on pan/zoom).

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
