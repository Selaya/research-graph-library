# API frictions found while building the demo gallery

**Status: resolved, except F2 (L) and F19, which are proposed in `docs/PLAN.md` (D18, D19)
and not implemented, and F42 (M), proposed below with an API sketch.** The table under
**Resolution** at the end says what each item became; the item text below is kept as
written, as the record of what the gallery hit and why. The demo pages were rewritten in
the same round to drop the workarounds this document describes.

F37–F42 came from a second pass with a different lens: not "what did the gallery have to
work around" but "where does a script author — an AI assistant in particular — have to
compose two to four primitives in a fixed order, and get a visibly wrong result (a
stutter, an overflow, a warning, a clock that lies) from the obvious ordering". Each one
is a case where the right shot or beat depends on state that does not exist until the
first primitive commits, so no ordering could compose it; the fix in every case is an
option on the mutation that owns that state. The candidates that turned out to be
already covered, or not worth an API, are listed under **Considered and dropped**.

This document collects every rough edge the demo builders hit while producing the
27 use-case demos under `demo/` (18 pipeline, agent and live-mode pages, then 9 sequence-diagram
pages built on `demo/sequence-solver.js`). Each page was written by an agent working only
from the README and docs, so the frictions below are the places where a reasonable reader
of the docs reached for something the library does not offer, or where the library's
behaviour surprised them enough to need a workaround. Every item names the demo(s) that hit
it, the workaround that shipped, and a recommendation with a rough size (S = a contained
change in one module, M = touches two or three modules or the public types, L = a design
decision with tests and docs).

Items are grouped by module; the **Suggested order** at the end ranks them by how often a
friction recurred and how much page code it cost.

## 1. Run engine, Mode A (simulate)

### F1. A failed step can never take its own retry loop
**Observed in:** `llm-eval-harness`, `assembly-line`, `terraform-plan`, `seq-retry-circuit`.
`data.fail` runs the dwell and then terminates the branch, and README/RUN.md are explicit
that a failed node does not fire the `loop: true` edge that leaves it. But "fail, then retry"
is exactly what a retry loop means, so every demo that wanted a red step followed by an
iteration badge had to fake it: compile once with `fail` set, `seek(0)`, `g.update()` the
flag away, recompile, and play a second pass (`assembly-line`); or run three separate
`g.run(opts)` compiles off storyboard step events (`llm-eval-harness`); or split the failure
onto a separate activation from the loop's source (`seq-retry-circuit`).
**Recommendation (M):** let a loop edge whose source fails fire while iterations remain —
`'failed'` becomes the terminal status only once the loop is exhausted. `data.fail` could
take `{ reason, retries: n }` or the loop edge could carry `onFail: true`. Emit `fail`
each attempt and `loop` for each retry so narration hangs off real events.

### F2. Later loop iterations are an in-place tick, not a replay
**Observed in:** `ab-experiment`, `tool-use-loop`, `git-branching`, `seq-retry-circuit`.
Iteration 1 visibly crosses the arc; iterations 2..n are a compressed ~250 ms tick on the
target node with a badge. A story like "iteration 2 wins" or "the agent calls a different
tool each time" cannot be shown by the engine, so pages narrate it reactively off
`run.on('loop')` with captions. Because those captions are not storyboard steps they are
not snapshotted, so scrubbing backwards through the run does not restore them.
**Recommendation (L):** a `loop: { replay: true }` (or `run({ loops: 'replay' })`) mode that
re-simulates the subgraph between the loop's target and source for each iteration, with the
badge still ticking. Independently (S): document the in-place tick prominently in the README
loop section, not only in RUN.md.

### F3. Tokens only start at roots; nothing can inject one mid-graph
**Observed in:** `seq-saga`, `seq-oauth-pkce`, `prompt-chain-debugger`.
After a `data.fail` the ball is dead. A saga's compensation, a token refresh after a 401,
or any "second request" must therefore start from a brand-new root node the storyboard adds
later, which is a structural workaround for what is really a token-level need.
**Recommendation (M):** `run.inject(nodeId, { at })` in Mode A (mint a token at a node, from
the compiled clock), or `spec.data.entry: true` to declare additional seeds. Live mode
already effectively has this through `run.start()` on a root.

### F4. Every root token is seeded at t = 0
**Observed in:** `seq-saga`.
The workaround for F3 (a new root added mid-story) exposes a second problem: Mode A mints
one token per root at t = 0, so a compensation root added after the failure has already
run its whole dwell "in the past" and is `done` the instant it is drawn. The page pins the
failure instant from `run.on('fail')` and pads that one node's dwell through a closure in
`RUN_OPTS.dwell` so the ball is still parked on it when it appears. The t = 0 `enter` /
`start` events for that node are also behind the cursor and never re-emitted, so its side
panel row lights up from `g.on('add')` instead.
**Recommendation (M):** `data.startAt` (or `run.inject(id, { at })` from F3) so a root can
declare when its token appears; and re-emit `enter`/`start` for a node that is added while
the run is already past its compiled start.

### F5. Storyboards cannot recompile or restart a run, nor flip every container
**Observed in:** `terraform-plan`, `llm-eval-harness`, `assembly-line`, `sequential-vs-parallel`.
The op set has `run.play` / `run.step` / `run.seek` but no `run` (compile with opts),
`run.reset`, `expandAll`, `collapseAll`, or `layout`. Pages hook `sb.on('step')` and call
`g.run(opts)` / `g.expandAll()` from a label match, which puts a part of the declared timeline
outside the storyboard (so `cues()` and `smv-fit` cannot see it).
**Recommendation (S):** add `run` (args: opts), `run.reset`, `expandAll`, `collapseAll` and
`layout` to `src/storyboard.js`'s op table, mirroring `g`'s own methods like every other op.

### F6. `g.run(opts)` silently drops every listener
**Observed in:** `llm-eval-harness`, `terraform-plan`.
A recompile via `g.run(opts)` replaces the transport, so `run.on(...)` handlers registered
on the old handle stop firing. Pages re-attach after every compile.
**Recommendation (S):** carry subscriptions across `g.run(opts)` (the handle is
conceptually the same run), or expose run events on `g` (`g.on('run:finish', …)`) so
listeners outlive recompiles. The existing `g.on('runstatus')` shows the shape.

### F7. `run.speed()` changes `sim().duration`, so pacing and reporting fight
**Observed in:** `sequential-vs-parallel`.
A rate event is folded into the compiled schedule, so the compiled duration a page shows as
"3h 20m vs 1h 05m" moves the moment the visitor changes playback speed. The page had to
pace via a custom `dwell` instead of `speed()`.
**Recommendation (M):** separate the declared timeline from playback: keep per-branch rate
events as a compile input (`rates`) but make bare `speed(f)` a pure playback multiplier, as
it already is in live mode, and expose `sim().declared` vs `sim().playback`.

### F8. Edges have no duration of their own
**Observed in:** every `seq-*` page.
`hopMs` is one global number, but in a sequence diagram the wire time *is* the story: a 1 ms
local call and a 400 ms cross-region call look identical. Pages could only stretch `hopMs`
globally.
**Recommendation (M):** honour `edge.data.duration` (same grammar as nodes) in the compiler,
with `hopMs` as the default when absent; render the value as an edge chip in the preset.

### F9. Containers route the token to one child only
**Observed in:** `tool-use-loop`.
An edge into a container attaches to its first entry child; with no internal edges the
other children never see a token, so "the agent picks a tool" cannot be shown as the ball
visiting different children.
**Recommendation (M):** allow `entry: [ids]` / `exit: [ids]` on a container spec, and fan
out to all entry children when several exist, as a fan-out already does for plain nodes.

## 2. Run engine, Mode B (live)

### F10. No join semantics in live mode
**Observed in:** `websocket-bridge`, `incident-postmortem`, `seq-trace-live`.
N arrivals at a fan-in stay N occupants; a bare `finish(id)` drains all of them and mints one
downstream token per occupant, so a `×N` badge propagates forever. Pages shaped their graphs
so every fan-in is terminal, or hand-rolled `finish(id, { n })` bookkeeping.
**Recommendation (M):** honour `join` in live mode: count arrivals per join node and
release one token when the join condition is met, exactly like Mode A.

### F11. `run.start()` mints phantom tokens and `state()` hides waiting vs active
**Observed in:** `streaming-kafka`, `seq-trace-live`.
Calling `start(id)` on a node with no waiting occupant fabricates a token — right for a root,
a footgun anywhere else — and `state()` exposes only occupancy, so a page cannot tell
"waiting to start" from "active". `streaming-kafka` keeps its own per-node active count.
**Recommendation (S):** `start()` on a non-root with zero waiting occupants should warn and
no-op unless `{ spawn: true }` is passed; add `waiting` / `active` to `RunState.nodes`.

### F12. `reset({ log })` rebases the clock and replays silently
**Observed in:** `websocket-bridge`.
Seeding a log rebases the frontier onto the seeded span, so later events stamped with a
server `{ at }` clamp a few hundred ms behind, and entries that arrive through `reset()`
never re-emit `fail` / `start`, so UI beats must hang off `g.on('runstatus')` instead.
**Recommendation (S):** `reset({ log, now })` with an explicit epoch, and a `replay: true`
flag that re-emits the seeded events.

### F13. Live mode has no expected duration
**Observed in:** `prompt-chain-debugger`, `seq-trace-live`.
`data.duration` only paces the progress fill; there is no way to show "this step is over its
budget". Fine as a design choice, but undocumented, and pages assumed otherwise.
**Recommendation (S):** document it in LIVE.md; optionally render an SLA tick on the
progress fill when a live dwell exceeds the declared duration.

### F14. Live timestamps give every message a zero-length hop
**Observed in:** `seq-trace-live`.
In a real trace a parent's dispatch instant *is* the child's start instant, so replaying
spans with `{ at }` stamps makes every token teleport between activations; the page inserts
a fixed hop at each dispatch and scales the trace clock around it.
**Recommendation (S):** a `minHopMs` live-mode option so a `start()` that immediately
follows the upstream `finish()` still shows the crossing.

## 3. Director: camera, highlight, props, captions

### F15. `fitView()` / `camera({ fit })` ignore the pane's own chrome
**Observed in:** `sequential-vs-parallel`, `incident-postmortem`, `kitchen-tickets`,
`seq-basics`, `websocket-bridge`, and most `seq-*` pages.
The transport bar (34 px), the preset's total-duration bar (22 px) and the caption strip all
sit over the bottom of the pane, and fit centres on the whole pane, so the last rank lands
under them. Nearly every page ends with a hand-tuned `camera({ by: { dy: -N } })` nudge.
**Recommendation (S):** measure the chrome the library itself mounted and subtract it in
`fitView()` / `camera({ fit })`, or accept `inset: { top, right, bottom, left }`. This is the
single most-repeated workaround in the gallery.

### F16. Camera and highlight are order-sensitive and warn instead of resolving
**Observed in:** `human-in-the-loop`, `employee-onboarding`, `incident-postmortem`.
Targeting a node the storyboard has not added yet, or a child inside a collapsed container,
logs `[smv:camera]` / `[smv:highlight]` warnings. Pages filter ids through
`g.layoutResult()` before every director call.
**Recommendation (S):** resolve a collapsed descendant to its nearest drawn ancestor (and
say so in the docs); keep the warning for truly unknown ids.

### F17. `camera({ nodes, pad })` on a short pane is an extreme close-up
**Observed in:** `websocket-bridge`, `tool-use-loop`.
Fitting two nodes into a 420 px pane produces k ≈ 3; pages pass an explicit `k`.
**Recommendation (S):** a `maxK` option with a sane default (1.5).

### F37. Framing an expansion takes three camera moves and stutters
**Observed in:** `tool-use-loop`, `ci-matrix`, `spec-editor`, and nearly every script an
AI assistant writes against the library.
There is no way to say "open this container and show me the result". The script frames
the collapsed stub (`camera({node})`), expands it, watches the children spill past the
pane, and fits again — or expands first and fits second, which is the same overflow with
the order swapped. Both read as a zoom-in / spill / zoom-out stutter, and because the
right shot depends on a layout that does not exist until the toggle commits, no ordering
of the existing ops can compose it.
**Recommendation (S):** a `camera` option on `expand` / `collapse` / `expandAll` /
`collapseAll` (and `update`'s `collapsed` route), resolved against the layout the toggle
produces and flown on the toggle's own clock, so the pull-back and the bloom are one tween.

### F38. Framing an added node is two tweens, the second aimed at an id the first has not drawn yet
**Observed in:** `seq-basics` (l.160–161), `seq-checkout` (l.197–204, 212–214),
`seq-oauth-pkce` (l.228–237, 250–251), `seq-saga` (l.216–219), `seq-chat-fanout`
(l.176–180, 187–191), `seq-retry-circuit` (l.226–234), `terraform-plan` (l.228–230).
Every sequence-diagram page advances the same way: a `batch` step that adds the next
activation and its edge (`dur: 260`), then a `camera` step framing `[prev, new]` (`dur:
300`). The new node blooms first — wherever the D10 anchor left it, often half off the
pane — and only then does the camera pan to it: two tweens where one beat was wanted, and
a pan that always arrives late. `terraform-plan` does the same with `addEdge` then
`camera({nodes: [source, target]})`. The order cannot be swapped: a `camera` step before the
add names an id nothing has drawn (`[smv:camera] unknown node id`), so the shot depends
on a layout that does not exist until the add commits — the F37 diagnosis, one op over.
The same hole is under `layout({dir})`: once a script owns the camera (D13) nothing
refits, so a direction change re-flows the whole drawing under a shot composed for the
old direction, and the `camera({fit})` that follows it is a second tween chasing the first.
**Recommendation (S):** the F37 `{camera}` option on every relayout-producing op —
`addNode` / `addEdge` / `removeNode` / `removeEdge` / `update` (its non-toggle route) and a
second argument on `layout` — resolved against the layout the op produces and flown on
its clock; inside a `batch`, composed against the batch's one commit. `true` frames the
op's subject (the node, the edge's endpoints, `[after, id]`), or fits the graph when the
op has no one subject.

### F39. The merged node cannot be framed: it does not exist before the condense, and the camera is late after it
**Observed in:** `seq-cache-aside` (l.245–249), `recipe-dag` (l.232–235, 241–244),
`employee-onboarding` (l.278–282), `sequential-vs-parallel` (l.506–509, `fitSide` after a
programmatic condense).
Every page that condenses or splits wants the camera on the result. It cannot be
composed: a `camera({node: merged.id})` step *before* the condense warns (`[smv:camera]
unknown node id`) because the id is minted 150ms into the choreography; the F16 resolver
maps a collapsed descendant to its drawn ancestor, not an unborn id to anything. A camera
step *after* the condense starts 900ms later, once the converge has already flown the
sources into a spot the anchored viewport (D10) chose — the merged node blooms wherever
that was, then the camera pans to it, and the reveal pulse plays on a node that is still
being framed. `seq-cache-aside` pins an explicit `k: 1.1` on that trailing shot to keep
the pan from also zooming; `recipe-dag` and `employee-onboarding` settle for a `camera({fit})`
after the fact. The right shot depends on a layout that only exists mid-choreography, and
the phase that produces it already goes through `relayout()`.
**Recommendation (S):** a third argument, `condense(ids, node, { camera })` / `split(id,
parts, { camera })`, forwarded to the choreography's converge/diverge relayout so it rides
that phase's tween and is resolved against the merged layout. `true` frames the merged
node / the union of the parts.

### F40. A `dur` on a caption is declared to the scrubber but never awaited
**Observed in:** `ci-matrix` (l.236–239, 243–245), `llm-eval-harness` (l.290–292,
308–310, 323–325, 335–337), `seq-basics` (l.167–168), `seq-cache-aside` (l.219–220,
227–228, 232–233, 250–251, 255–256), and the `cap()` + `hold()` helper pairs every
pipeline page defines (`ab-experiment`, `agent-swarm`, `git-branching`,
`human-in-the-loop`, `recipe-dag`, `sdlc`'s `holdAt`).
The natural way to hold a caption on screen is `{ "op": "caption", "args": ["…"], "dur":
1600 }` — `dur` is the declared pacing on every step, and `durOf()` reads it first for
every op, so the scrubber and `g.cues()` price that step at 1600. But `g.caption()`
returns `g`, the sequencer has nothing to await, and the story moves on at once: a
storyboard of held captions declares a 2.4s timeline and finishes with zero ticks of the
clock (reproduced), which is precisely the disagreement D12 forbids. Nobody noticed
because every page wrote the beat as three steps instead — `caption`, `wait`,
`caption(null)` — and the `wait` carried the time. The same is true of a `dur` on
`highlight`, `clearHighlight`, `props`, `run.step` and `run.seek`.
**Recommendation (S):** make the declaration true: a step that hands the sequencer
nothing to await holds for its `dur` on the shared clock (skipped on a forward scrub, like
every director tween; `run`/`run.reset` stay 0). Then a held caption is one step, and
`smv-record --cues` ends the subtitle span where the hold ends.

### F41. A reader's tap opens a container but never frames it, and hand-rolling the shot breaks the keyboard
**Observed in:** every page that leaves `tapToggle` on (all 27), by inspection of
`src/interact.js` l.62–66 and `src/a11y.js` l.307–318: both paths call bare
`g.expand(id)` / `g.collapse(id)`, so a container opened by hand blooms under the D10
anchor and, once the reader has panned (or a script owns the camera), spills past the
pane exactly as F37 described for scripts. The only way to give the reader the F37 shot
today is to set `interaction: { tapToggle: false }`, listen to `nodeclick`, check
`g.viewstate.isContainer(id)` (an internal), and call `g.expand(id, { camera: true })` —
three primitives, and they get the keyboard wrong: `a11y.js`'s Enter/Space handler emits
the same `nodeclick` and *then* runs its own toggle, which is not switched off by
`tapToggle: false`, so it fires after the page's handler has already opened the box and
closes it again (reproduced in `test/a11y.test.js`). No demo ships this because the
gallery's stories are scripted; every embedder who wants "tap to open and look" will.
**Recommendation (S):** `interaction: { tapToggle: { camera } }` taking the F37 option,
routed through ONE toggle function that `interact.js` and `a11y.js` both call, so a tap
and an Enter frame identically. It is the reader's move, so it flips `userMoved` (as a pan
does) but never takes the camera from a storyboard (D13).

### F42. A run cannot be followed: framing the active token is a per-event camera call
**Observed in:** `incident-postmortem` (l.493, `if (ev.cam) g.camera(ev.cam)` on every
feed line), `seq-trace-live` (l.405–408, a camera per span start), `prompt-chain-debugger`
(l.438, 465), and the Mode A pages that narrate off `run.on(...)` — `tool-use-loop`,
`agent-swarm`, `ab-experiment`.
A story that plays a run and wants the camera on the ball has no op for it: `run.play` is
one step, priced off the compiled transport, and the camera can only be moved between
steps. So pages hang `g.camera({node})` off `run.on('enter')` / `start` events — one call
per hop, each a 600ms tween that lands after the token has already moved on, all of them
outside the declared timeline (they are not steps, so `cues()` and `smv-record` do not
see them, and a backward scrub does not restore them: the F19 shape). Fan-outs make it
worse: N tokens, N competing camera calls, the last one wins.
**Recommendation (M, proposed):** a `follow` option on the run step —
`{ "op": "run.play", "args": [{ "until": "gate", "follow": true }] }`, or `follow: { pad,
maxK }` — that keeps the viewport on the union of the nodes currently occupied by
tokens, retargeted on the run's own clock (a `moveTo` per `enter`/`start`, with the union
lidded at `NODES_MAX_K` so a fan-out pulls back rather than thrashing), and hands the
camera back at the step's end. It is M rather than S because three things have to be
decided first: (1) D13 ownership inside one step — the viewport must be snapshotted for
the seek *into* a followed `run.play` to land the camera where the run's clock has it,
which the per-step snapshot cannot express today; (2) a `run.seek` inside the step must
reposition the camera from the schedule, not replay tweens; (3) live mode has `follow()`
already — for the *clock* — and the option should not collide with it in name or in
`run.options()`.

### Considered and dropped

Candidates from the same pass that turned out to be covered, or not to need an API.

- **`highlight` + `camera` on the same set** (`employee-onboarding` l.254–255,
  `llm-eval-harness` l.288–289, `ci-matrix` l.241–242, and most `seq-*` pages). Two steps,
  but both correct: the highlight is a 0ms flip and the camera a tween, and either order
  reads as intended. A `camera: true` on `highlight` would be sugar over a composition
  that is not wrong. Dropped.
- **`collapse` then `fitView`.** Covered by F37 (`collapse(id, { camera: { fit: true } })`).
- **`layout({ dir })` leaving the camera stale.** Folded into F38 (`layout(o, { camera })`).
- **Mount-time `storyboard` + `autoplay` boilerplate.** Covered by F36; the `__smvExit`
  lines the pages still carry are the older checker hook, kept on purpose.
- **A `caption` that clears itself after its hold.** F40 makes `dur` the hold; where the
  clear sits (`caption(null)`, a 0ms flip) is editorial — some pages let the next caption
  replace the last, others clear before a camera move. Dropped.
- **`{camera}` on `batch()` itself.** A child's option already composes against the
  batch's one commit (F37/F38), and `g.batch(fn, opts)` would put a presentation option
  on an op whose only job is to coalesce. Dropped.

### F18. `props()` replaces rather than merges, and out-ranks status styling
**Observed in:** `agent-swarm`, `seq-saga`.
Recolouring one node from an event handler wipes every other node's override unless the
page re-sends the full map. And because props/style write inline custom properties, a
role-coloured node never shows the built-in done/failed tint.
**Recommendation (M):** `g.props(patch, { merge: true })`, and move status colour to its own
channel (`--smv-status-fill`) that composes with role colour instead of losing to it.

### F19. Reactive narration is invisible to the declared timeline
**Observed in:** `tool-use-loop`, `ab-experiment`, `agent-swarm`, `llm-eval-harness`.
Captions and highlights driven from `run.on(...)` are not storyboard steps, so they are not
snapshotted for backward scrub and do not appear in `cues()`.
**Recommendation (L):** a reactive storyboard step, `{ on: 'run.loop', match: { edgeId },
steps: [...] }`, evaluated at compile time against the simulated schedule so its cues have
real offsets.

### F20. Top-placed captions broke under the transport bar (fixed in this round)
**Observed in:** `seq-checkout`, `seq-oauth-pkce`, `seq-basics`.
`.smv-root.smv-has-transport .smv-caption{bottom:46px}` outranked
`.smv-caption[data-place="top"]{bottom:auto}`, so with `controls: true` a top caption kept
both `top` and `bottom` and stretched into a near-full-height box over the diagram. Two
builders shipped a page-scoped `!important` override before the root cause was found; the
fix (an equally specific transport-aware rule, plus `test/caption-place.test.js`) landed
with the sequence demos.
**Recommendation (S):** done. The general lesson: the caption, transport, and total bar all
position themselves independently; a single "pane chrome" layout that stacks them would
prevent the next collision (see F15).

## 4. Pipeline preset and rendering

### F21. The duration chip and the occupancy badge share a corner
**Observed in:** `streaming-kafka`.
Both draw in the node's top-right, so a `×N` badge and a `4ms` chip overlap; the page dropped
durations on the nodes that mattered.
**Recommendation (S):** give badges and chips fixed slots (chip top-right, badge top-left, or
stack them).

### F22. Chips overlay label text because node width is label-derived
**Observed in:** `incident-postmortem`, `git-branching` (verifier finding), `seq-cache-aside`.
`NODE_PAD_X` does not know the preset will park a chip and a mode glyph in the top-right,
so long labels run under them; pages set explicit `w` on every node.
**Recommendation (S):** let the preset contribute to measurement (an `extraWidth` hook in
`measure.js`), or reserve the chip's width in the default padding when a preset is active.

### F23. The duration chip collides with the label on short nodes
**Observed in:** `seq-saga`, `seq-retry-circuit`.
The preset draws the chip 10 px below the node's top edge, which overlaps a vertically
centred label on the default 36 px box; pages pass `h: 44` on every activation.
**Recommendation (S):** the preset should reserve chip height in measurement (same hook as
F22), or draw the chip outside the box when the box is short.

### F24. The total-duration bar sums declared work, `sim().duration` is the critical path
**Observed in:** `sequential-vs-parallel`, `recipe-dag`.
Two different "totals" appear on the same page with no label saying which is which.
**Recommendation (S):** a preset option `total: 'sum' | 'critical' | 'both'`, defaulting to
showing both with labels.

### F25. Edge labels are small, rotated, and unplaceable
**Observed in:** every `seq-*` page.
A message label along a diagonal arrow is the primary text of a sequence diagram, but the
renderer draws it as a small rotated string at the path midpoint with no background.
**Recommendation (M):** `label: { text, place: 'mid' | 'start' | 'end', rotate: false,
pill: true }` on edges, or at least an upright option and a background pill.

### F26. Edge labels are truncated at a fixed 90 px
**Observed in:** `seq-retry-circuit`, and every other `seq-*` page.
`EDGE_LABEL_MAX_W = 90` in `render.js` truncates a message label after roughly twelve
characters of the node font, so `retry · backoff 200ms → 800ms` renders as `retry ×3 · b…`.
Pages shortened every message to fit and moved the real text into captions.
**Recommendation (S):** make the cap an option (`layout.edgeLabelMaxW` or per-edge
`label: { text, maxW }`), and let the preset raise it when edge labels are the content.

### F27. No public click / select event on nodes
**Observed in:** `prompt-chain-debugger`, `seq-trace-live`, `spec-editor`.
The viewport calls `setPointerCapture` on pointerdown, so a `click` listener on the root
sees the `<svg>` as its target; pages resolve the node at pointerdown by reading
`interact.js`.
**Recommendation (S):** `g.on('nodeclick', ({ id, event }) => …)` and `g.on('edgeclick', …)`,
suppressed when the pointer travelled past the tap slop (the toggle logic already has this).

## 5. Store and structural ops

### F28. `condense()` rejects `parent: null`, and loop edges break convexity
**Observed in:** `employee-onboarding`, `human-in-the-loop`, `seq-graphql-federation`.
The merged node's spec must omit `parent` entirely (null is treated as a dangling id), and a
retry loop leaving the set makes it non-convex, so pages remove the loop edge first.
**Recommendation (S):** accept `parent: null` as "inherit"; exclude `loop: true` edges from
the convexity walk, since a back edge re-entering the set is not a path through it.

### F29. `update()` cannot unset a data key or change `collapsed`
**Observed in:** `spec-editor`, `assembly-line`.
`data` is merged, so a key can be changed but never removed; `collapsed` is folded into
view state once at first sight, so patching it is a no-op and pages dispatch to
`expand()` / `collapse()` themselves.
**Recommendation (S):** an explicit `unset` (e.g. `data: { fail: undefined }` removes the key,
or `update(id, patch, { replace: true })`), and route a `collapsed` patch to expand/collapse.

### F30. `batch()` is not transactional
**Observed in:** `spec-editor`.
Documented, but a diff-and-apply UI would like to validate before committing.
**Recommendation (M):** `g.validate(ops)` that runs the same structural checks as the ops
without committing, so a page can refuse a whole patch up front.

### F31. A failed child turns its whole container red, forever
**Observed in:** `seq-oauth-pkce`, `ci-matrix`.
Container status rolls up the earliest failure among descendants, so one 401 on a lifeline
paints the entire actor column red for the rest of the story, even after a retried call on
the same actor succeeds. In a pipeline that reads as "the matrix is red", which is right; on
a lifeline it reads as "this service is down", which is wrong.
**Recommendation (S):** make the rollup a policy — `statusAgg: 'earliest-fail' | 'latest' |
'none'` on the container, mirroring `durationAgg` — with the current behaviour as default.

## 6. Layout and the solver seam

### F32. Solvers see ids and sizes, never `data`
**Observed in:** `demo/sequence-solver.js` (all `seq-*` pages).
A placement-driven solver (actor column, time row) needs per-node hints, but the shell hands
down only `{ id, w, h, parent }`. The solver keeps its own placement map that the page must
fill before every `addNode`, which is easy to forget (unplaced ids are parked in a spare
column with a warning).
**Recommendation (S):** pass `data` (or a `layout.hint(node)` pick) through to the solver
input. Custom keys already pass through the layout opts by spread — document that, too.

### F33. A childless container is not a container
**Observed in:** `seq-saga`, `seq-graphql-federation`, `seq-basics`.
An actor declared up front with no activations yet is a plain leaf node until its first
child arrives: the solver sees no `parent` pointing at it, so it lands in the spare column
with a warning, and it is drawn as one big filled node rather than a lifeline header.
Pages place each actor id at the head of its own column and restyle it dashed until its
first activation.
**Recommendation (S):** a `container: true` flag on the node spec (or treat any node that
some spec later parents to as a container from the start) so an empty container draws as
a header-only box and reaches the solver with `parent`-less children semantics intact.

### F34. Condense across containers needs an explicit parent and a placement
**Observed in:** `seq-graphql-federation`.
Merging activations from two lifelines (the three Reviews fetches plus the two gateway
waits the convexity guard requires) produces a node with mixed-parent sources, which
`condense()` leaves parentless unless the new-node spec names `parent`. The merged id also
needs its solver placement registered before the step runs.
**Recommendation (S):** document the mixed-parent rule next to the `parent: null` one
(F28); pass the merged node's `data` to the solver (F32) so a placement-driven solver can
read it instead of needing an out-of-band registration.

### F35. A solver must produce container rects or accept a phantom union
**Observed in:** `demo/sequence-solver.js`.
When the solver omits a container, the shell defaults it to a rect at the origin and then
unions that with the children's bbox, dragging the container towards (0, 0).
**Recommendation (S):** derive the rect purely from children when the solver returns
nothing for a container.

### F36. Every page reinvents the "run to the end and tell me" hook
**Observed in:** all 27 demos and `scripts/check-demos.mjs`.
Headless verification needs a "story finished" signal; each page installs its own
`window.__smvExit`. The storyboard has `play()` returning a promise, but nothing at the page
level, and nothing for live-mode pages.
**Recommendation (S):** a documented convention: `mount(..., { autoplay: 'auto' })` honours
`?auto=1`, and `g.finished` resolves when the storyboard (or a live run marked done) ends.
Then `check-demos.mjs` can become an official `smv-check` next to `smv-record`.

## Resolution

What shipped for each item, by module. "Docs" columns point at where the new surface is
described; every public addition is typed in `types/index.d.ts` and covered by tests.

| Item | Status | What shipped |
|---|---|---|
| F1 | done | `data.fail: { reason, retries, recover }` and `onFail: true` on a loop edge; `fail` events carry `attempt`/`retries`/`terminal`, a `loop` fires per retry (RUN.md §Retries) |
| F2 (S) | done | README loop section documents the in-place tick and the `run.on('loop')` narration pattern |
| F2 (L) | proposed | `loop: { replay: true }` / `run({ loops: 'replay' })` — PLAN.md D18, open questions listed |
| F3 | done | `run.inject(id, { at })`, `data.entry: true`, compile input `entries`, bus event `inject` |
| F4 | done | `data.startAt`; a recompile re-emits the backlog for a node the old schedule had no events for |
| F5 | done | storyboard ops `run`, `run.reset`, `expandAll`, `collapseAll`, `layout` (+ fluent `runCompile/runReset/...`); `layout` opts are snapshotted for backward seeks |
| F6 | done | `run.on()` subscriptions survive `g.run(opts)`; run events mirrored as `g.on('run:<type>')` |
| F7 | done | bare `speed(f)` is a playback multiplier; `sim().declared` / `sim().playback`; `run.playbackSpeed()` |
| F8 | done | `edge.data.duration` is the hop time (compiler); the preset draws it as an edge chip |
| F9 | done | `entry: [ids]` / `exit: [ids]` on a container spec, fan-out to all entries, join across exits |
| F10 | done | live mode honours `join` (AND / `any` / `{count}`), re-arming per group of arrivals |
| F11 | done | `start(id, { spawn })`, `spawnOnStart: false` for the strict no-op, `waiting` / `active` in `state().nodes` (default keeps spawning, with a `[smv:live]` warning) |
| F12 | done | `reset({ log, now, replay: true })`; `options()` round-trips `now` |
| F13 | done | LIVE.md "Durations are expectations"; `state().nodes[id].overBudget` → `data-over-budget` |
| F14 | done | `minHopMs` live option; a finish stamped inside the window is deferred to the landing instant |
| F15 | done | `fitView()` / `camera({ fit })` subtract the chrome the library mounted; explicit `inset` on both |
| F16 | done | camera/highlight resolve a collapsed descendant to its drawn ancestor; the warning stays for unknown ids |
| F17 | done | `camera({ nodes, maxK })`, default 1.5 for a multi-node fit |
| F18 | done | `g.props(map, { merge: true })`; status colour on its own `--smv-status-fill` / `--smv-status-mix` channel |
| F19 | proposed | reactive storyboard step — PLAN.md D19, with the step-splitting problem it has to solve |
| F20 | done | shipped earlier; the pane-chrome lesson is recorded in INTERNALS.md |
| F21 | done | occupancy badge and duration chip have fixed slots (PRESETS.md "The slots a node already has") |
| F22 | done | `layout.measure: { extraWidth, extraHeight }` hook; the preset installs `PIPELINE_MEASURE` and labels truncate before the reserve |
| F23 | done | preset reserves chip height (36 → 44px) and lifts the chip row above a short plain box |
| F24 | done | preset `total: 'sum' \| 'critical' \| 'both'` (default both, labelled); `criticalPathSec()` export |
| F25 | done | `label: { text, place, rotate, pill, maxW }` on edges; upright by default, pill background |
| F26 | done | `layout.edgeLabelMaxW` and per-edge `maxW`; the preset raises the cap to 180 |
| F27 | done | `g.on('nodeclick')` / `g.on('edgeclick')`, suppressed past the tap slop; `interaction.click: false` |
| F28 | done | `condense()` accepts `parent: null`; loop edges excluded from the convexity walk; mixed-parent warning |
| F29 | done | `data: { key: undefined }` unsets; `update(id, patch, { replace: true })`; a `collapsed` patch routes to expand/collapse |
| F30 | done | `g.validate(ops \| fn)` → `{ ok, errors }` without committing |
| F31 | done | `statusAgg: 'earliest-fail' \| 'latest' \| 'none'` on containers |
| F32 | done | solvers receive `{ id, w, h, parent, container, data }`; `layout.hint(node)` picks what `data` carries |
| F33 | done | `container: true` on a node spec: header-only dashed box, flagged to the solver |
| F34 | done | documented next to F28/F32; the demo solver reads placement from `data.seq` |
| F35 | done | a container the solver omitted is derived from its children alone (an empty one warns) |
| F36 | done | `autoplay: 'auto'` honours `?auto=1`; `g.finished` / `g.finish(reason)`; `check-demos.mjs` awaits `window.smv.finished` |
| F37 | done | `expand/collapse/expandAll/collapseAll(…, { camera })` frame the post-toggle layout in the toggle's own tween; storyboard args carry it; D13 ownership |
| F42 | proposed | `run.play({ follow })` — keep the viewport on the occupied nodes on the run's own clock; needs a D13 decision for seeks into the step (sketch above) |
| F41 | done | `interaction: { tapToggle: { camera } }` — the reader's tap and Enter/Space toggle both frame through one `readerToggle`; `userMoved` flips, D13 ownership does not |
| F40 | done | a `dur` on `caption`/`highlight`/`clearHighlight`/`props`/`run.step`/`run.seek` is held on the shared clock (skipped on a scrub), so declared = awaited; a held batch child counts toward the batch |
| F39 | done | `condense(ids, node, { camera })` / `split(id, parts, { camera })` frame the merged node / the parts' union in the converge/diverge tween |
| F38 | done | `addNode/addEdge/removeNode/removeEdge/update(…, { camera })` and `layout(o, { camera })` frame the op's subject against the layout it produces, on its own clock; a batch child's shot rides the batch's one commit |

## Suggested order

1. F15 (fit insets), F5 (storyboard ops), F6 (listener survival) — small, and they remove the
   three most-repeated workarounds.
2. F1 (fail + retry), F10 (live joins), F8 (edge durations) — medium, and they unlock stories
   the gallery could only fake.
3. F25 (edge labels), F27 (click events), F18 (props merge) — presentation gaps the sequence
   diagrams made obvious.
4. F2 and F19 — larger design work, worth a docs/PLAN.md decision first.
5. F42 (follow the run) — an M with the same D13 question F19 has; decide them together.
