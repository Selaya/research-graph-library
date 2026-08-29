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
semantics exactly as D3 specifies. Revisit at M3 when the in-house engine owns ranking.

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
with dagre doing steps 1–3. The literal four-step pipeline becomes the M3 in-house
engine's job, as the plan's M3 milestone already states.

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
