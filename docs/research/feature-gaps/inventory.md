# Capability inventory of sparkle-motion-visualizer v0.1.0
> Part of the [feature-gap research corpus](./README.md) · 2026-09-05 · produced by a sonnet reader over README.md, types/index.d.ts, docs/ and src/index.js; it is the baseline every gap claim was judged against.

## Summary

sparkle-motion-visualizer (v0.1.0, MIT) is a zero-dependency (default path), no-build-step, framework-free embeddable animated SVG graph/pipeline visualization library. It ships an in-house layered (Sugiyama-family) layout engine with an optional pluggable dagre adapter, first-class cycle/back-edge handling, compound/container nodes with animated expand-collapse, condense/split (N<->1) choreography, and a dual-mode token execution engine: Mode A simulates runs from declared node durations (join policies, bounded retry loops, per-branch speed, seek/scrub, declared data.fail), and Mode B replays a real append-only event log with a frontier/view two-clock model for live time-travel. A full director/storyboard system (JSON op array) drives camera moves, emphasis/spotlight highlights, per-element style overrides, and captions, with a declared per-step timeline shared by the scrubber, a cue-sheet generator, and a deterministic frame-by-frame video renderer (smv-record, via headless Chromium + ffmpeg) plus a voice-over-fitting CLI (smv-fit) and a single-file HTML packer (smv-pack). Styling is exclusively via --smv-* CSS custom properties/data-* attributes (no CSS-in-JS); accessibility ships an ARIA tree + linearized table fallback with keyboard navigation and a live-status announcer. Interaction is limited to pan (drag), ctrl/cmd+wheel zoom, and tap-to-toggle containers — there is no node dragging, multi-select, context menu, or tooltip system built in. Rendering is SVG-only with viewport culling above 150 elements (though token pulses are documented as not yet culling-aware). All error handling for structural misuse is synchronous and typed (GraphError with ~19 codes); presentational/diagnostic issues warn instead of throwing. Distribution covers CDN IIFE, ESM, and npm with hand-written TypeScript types and enforced (<45KB/<50KB gzip) size budgets; exportSVG/exportPNG/a11y-table are ESM-only, excluded from the IIFE. Storyboards and the recording/fitting toolchain explicitly and by design work with Mode A (simulated) runs only, not Mode B (live) runs.

## Data model

**Capabilities**

- Nodes: {id, label, parent (compound/container link), data (free-form payload), collapsed, join, w/h, durationAgg}
- Edges: {id, source, target, label, data, loop (bool, retry/back edge), maxIterations, weight (meta-edge aggregation, >1 renders heavier line + badge)}
- Compound/container nodes via `parent`; nesting is arbitrary depth; a container and its children count as one component for layout purposes
- Cycles are first-class: back edges auto-detected via DFS/FAS pinning (never rejected), rendered as consistent-side arcs; self-loops bow out of the node
- Duration grammar on node.data.duration: number=seconds, or '<num><unit>' with unit ms|s|m|h|d, case-insensitive, decimals, whitespace tolerated; unparseable/negative -> console.warn + 600ms default fallback; absent duration is silent (no warning)
- data.fail (bool or string reason) marks a node as a declared-failure step for Mode A; string carried through as the 'fail' event reason
- join policy per node: 'all' (implicit AND-join default), 'any' (first-arrival), {count:k} (quorum); extra arrivals after fire are dropped/ghost-faded and emit a 'drop' event
- No explicit 'ports' concept — edges attach node-to-node (or, for expanded containers, are force-reattached by the layout shell to an interior entry/exit child, deterministic first/last fallback, since dagre/engine cannot route an edge onto a cluster node)
- Weights/labels only on edges (weight = aggregation count for meta-edges when collapsed; label is free text); no node weights beyond the duration field
- GraphSpec is just {nodes[], edges[]}; extra unknown keys pass through ([key: string]: unknown) on both Node/EdgeSpec

**Known limits**

- No first-class 'ports' (multiple named connection points per node) — edges connect to whole nodes only
- Container node itself cannot declare data.fail (not an executable step); it inherits earliest-failing descendant's status
- split() cannot be called on a node that has children (containers) — throws GraphError('split-container')
- condense() requires the source id set to be convex (no path leaves and re-enters) or throws GraphError('non-convex')

## Layout

**Capabilities**

- In-house layered (Sugiyama-family) engine since M3 (src/engine.js, ~630 lines, zero dependencies): cluster-aware ranking (longest path + tightening pass), dummy bend chains, median ordering sweeps with transpose + previous-order tie-break, isotonic-regression coordinate pass guaranteeing >= nodesep spacing as an invariant
- All four directions (LR/RL/TB/BT) solved top-to-bottom internally and transposed on output — equally good in all directions
- Order stability across re-layouts: mount() persists per-rank `order` + `layers` (bend-interleaved) and feeds back as prevOrder/prevLayers; unchanged-graph relayout reproduces identical drawing (measured 0 drift after M3 fix, previously 232/600 order drift + 440/600 coordinate drift on random DAGs)
- componentOrder option: pins the left-to-right/top-to-bottom slot order of disconnected components; entries are id or alias-array; unknown ids ignored; sticky across mutations (mount remembers component->slot even after all listed ids are removed); condense/split hand the slot on to new nodes; engine-only (dagre adapter ignores it); null/omitted = no cost, no slots
- Layout options: dir, nodesep, ranksep, marginx, marginy, solver (pluggable seam)
- g.layout(opts) triggers relayout + animated transition into new options/direction
- Pluggable solver seam: LayoutSolver = (input, opts) => {nodes, edges, order, layers?, slots?}; default is in-house engine
- Optional dagre adapter (sparkle-motion-visualizer/adapters/dagre) behind the same seam, requires peer dep @dagrejs/dagre (not bundled, not a dependency, install separately); build hard-fails if dagre leaks into default bundles
- Container geometry: containers padded to clear header strip; sibling containers reserve corridors; component/cluster block order decided globally (not per-rank)
- Compound container layout: child layout -> resize -> parent relayout -> translate (D5), realized via engine's cluster corridor reservation + post-pass padding
- condense()/split() reseat the new merged/split node into the slot the source nodes held (not appended at rank tail) so the choreography's entrance matches the layout

**Known limits**

- No Gantt/temporal layout mode (x=time, sweeping-line scrubber) — explicitly skipped, 'if demanded' in the plan, never built
- Layered/Sugiyama-style only — no force-directed, radial, or other layout algorithm families
- Reversed/back edges are withheld entirely from the ranking solver (not fed reversed) — a documented tradeoff: loops don't pull endpoints closer in rank, in exchange for guaranteed non-flipping side-stability
- Container residual limit: on 400 random cluster forests, sibling-rect overlap violations went from 292/400 to 60/400 (2 levels) / 278->70 (4 levels) after fixes — NOT zero; structural limit of rectangular containers over partially-overlapping rank spans is acknowledged as unresolved (would need a real nesting-graph approach)
- Parallel/multi-edges between the same ADJACENT rank pair now render as identical (coincident) polylines — a capability lost vs. dagre, which bent them apart via intermediate-rank dummies; multi-rank multi-edges still separate; not planned to be added to the solver, would be a rendering-layer fix if ever done
- componentOrder is engine-only; ignored by the dagre adapter
- Golden-file 'parity' with dagre is structural/crossing-count non-regression, NOT coordinate-identical output

## Rendering

**Capabilities**

- Pure inline SVG rendering, no canvas/WebGL default path (canvas used only for exportPNG rasterization and offscreen text measurement)
- Node shapes: rounded-rect boxes (--smv-radius custom property controls corner radius); containers render as either a header-strip frame (expanded) or a stacked-card look (collapsed, with a data-count child-count badge)
- Edge routing: layered bend-chain polylines (>=2 points) with arrowheads; back/loop edges render as consistent-side arcs; self-loops bow out of the node
- Edge labels supported
- Viewport culling above 150 elements: nodes/edges/groups fully outside the visible world rect stop being drawn (skip geometry writes, data-culled + display:none), re-armed on every viewport.onChange (drags, pinches, wheel, fit()/zoomBy()/anchor() and every tween tick) — measured median frame 1.6-1.8ms on a 300-node/870-group synthetic graph, up to 87% culled when zoomed in
- Animated diff-based transitions: library diffs old vs new state and generates keyed enter/update/exit + FLIP animation automatically — caller never hand-authors animations
- Per-node expand<->collapse animated transitions with meta-edge aggregation (deduped, weighted) while collapsed
- condense()/split() staged 3-phase choreography: highlight -> converge/diverge -> reveal, with a convexity guard on condense()
- expandAll()/collapseAll(): every container flips in ONE shared transition, parents first
- Styling entirely via --smv-* CSS custom properties + data-* attributes written once per commit (never per animation frame) — theming is ordinary CSS, no CSS-in-JS
- Token visuals: pulses, occupancy badges, loop-iteration badges (iter N/M), join-slot pips (data-filled), traversed-edge progressive width (--smv-traversed, data-traversed)
- Emphasis/spotlight rendering: data-emph variant colors (focus/warn/ok/mute via --smv-emph), data-dim for spotlight (everything non-emphasized drops to 28% opacity), pulse:true modifier drives a ticker-based breathing stroke width (never a CSS animation, so it records frame-perfectly; reduced-motion holds it static)
- Per-element style overrides: g.style(fn) (per-node, inline custom properties, highest specificity) and g.props(map) (director/storyboard override layer merged over style(), applies to nodes AND edges, replace-not-accumulate, snapshotted for scrub)
- Caption overlay (role='status', bottom or top placed, 'note' variant)
- Node text sized from real offscreen canvas measureText against a fixed font stack (src/measure.js) — deterministic box sizing

**Known limits**

- Token pulses are NOT culling-aware as of the last recorded status (M3 follow-up left open): a token pulse anchored to a culled/hidden node still draws, appearing as a floating pulse with no node under it on very large (150+ element) graphs
- No canvas/WebGL rendering backend — SVG only
- Parallel edges between adjacent ranks render as coincident (overlapping) polylines, not fanned apart
- No node shapes beyond rounded rects (no circles, diamonds, custom shape system) documented

## Interaction

**Capabilities**

- Pan: click-drag on the svg (pointer events, touch-friendly, unifies mouse/touch/pen via pointerdown/pointerup/pointercancel)
- Zoom: ctrl/cmd+wheel or pinch ONLY — plain wheel scroll is never intercepted (page can still scroll past the graph)
- Tap/click-to-toggle on container nodes (on by default): a tap that travels < 6px slop toggles expand/collapse; anything beyond that (or a second pointer / pinch) is treated as a pan, never a toggle; opt out via `interaction: {tapToggle: false}`
- fitView()/viewport.fit(bounds, opts): explicit programmatic fit, capped at maxK 1.5 by default (4 to frame a single node)
- Anchored viewport correction (D10): the focal node holds still while the graph reflows around it on mutation
- Keyboard navigation (via a11y layer): arrow keys move focus in reading order (rank-major, inferred from layout), Home/End jump, Enter/Space toggles a container
- viewport.zoomBy(factor, at), viewport.anchor(before, after, duration), viewport.screenToWorld/worldToScreen
- viewport.setInteractive(false) detaches all pointer+wheel listeners in one flip (used by the frame recorder to disable live interaction)
- CSS-only hover affordance: .smv-node:hover strokes the accent color (transition-based, not JS-driven)
- Transport bar UI (opts.controls: true): play/pause/step/scrub/speed buttons + a scrub slider (drag-to-seek)

**Known limits**

- No node dragging/repositioning by the user — layout is entirely computed, not manually adjustable
- No multi-select or selection API/state beyond query-sugar reads (g.nodes(filter) reads spec data, it is not an interactive 'selected' concept)
- No context menu (right-click menu) support
- No built-in tooltip system — only the CSS :hover stroke highlight; anything richer (tooltips) must be built by the consumer via a preset
- Plain mouse wheel is deliberately NOT hijacked for zoom — ctrl/cmd+wheel only, to avoid trapping page scroll

## Animation & transitions

**Capabilities**

- Single shared clock/ticker per instance (D1): all motion (layout tweens, camera, pulses, emphasis) rides one ticker, never independent setIntervals/rAFs, guaranteeing one consistent frame budget
- Diff-based auto-animation: adding/removing/updating nodes/edges is diffed and animated via keyed enter/update/exit + FLIP; no hand-authored animation needed
- Overlapping mutations cancel-and-retarget (D9) instead of queueing or corrupting state — an in-flight transition redirected mid-flight to a new target rather than stacking
- Every mutation returns an Awaitable+cancelable handle resolving {canceled, applied} (plus extra ids fields for removeNode/condense/split); cancel() only interrupts the trailing animation tween, never undoes a structural change already committed
- manual ticker mode (opts.ticker: 'manual') for the deterministic frame renderer: ticker only advances when the CLI calls ticker.tick(ms), used by smv-record for byte-identical output
- motion: 'full' mount option forces reduced-motion OFF regardless of OS setting (for recording)
- prefers-reduced-motion respected by default: camera moves shrink to ~1ms, pulse holds static instead of animating
- g.batch(fn): defers multiple ops' relayouts into a single shared commit/transition (NOT transactional — ops commit synchronously one at a time as fn runs; a throw partway leaves earlier ops committed, no rollback; fn must be synchronous or throws GraphError('batch-async'))

**Known limits**

- batch() is explicitly NOT transactional/atomic — no rollback on partial failure
- Compositor-thread offload for non-choreographed motion deliberately NOT built — profiling showed it 'not justified at v1 scale' (median frame 1.6-1.8ms well under an 8ms budget on a 300-node graph); everything animates on the main thread

## Execution / token engine

**Capabilities**

- Mode A (simulate): g.run() compiles a full token schedule up front from declared data.duration values; play/pause/seek/step/speed then just sample the compiled artifact (cheap, exact)
- Implicit fan-out (2+ out-edges spawn tokens automatically) and implicit AND-join fan-in; join policy override: 'all'|'any'|{count:k}
- Bounded retry loops: loop:true edge + maxIterations>0; first iteration is a real arc-crossing hop, subsequent iterations are compressed 250ms in-place ticks on the target node (never re-flying the arc); emits 'loop' {iteration,max} events; iterations option can cap a given compile below maxIterations
- Per-branch speed control: run.speed(factor, {branch}) scoped by node id or global '*'; factor 0 freezes a branch; step({token}) built on isolating a token's rate to 0
- run.step({token?}): jump to next event boundary, globally or for one token
- run.seek(ms): scrub without re-firing already-passed events (state restore, not replay)
- run.play({until: nodeId}): resolves when that node reaches 'done' OR 'failed' — never hangs on a failed branch
- run.timeOf(nodeId): first finish/fail instant for that node
- Declared failure: data.fail (bool or string reason) on Mode A nodes — runs full dwell then fails: status 'failed', no finish event, no fan-out, branch stops; container status rolls up from earliest-failing descendant
- Full event vocabulary re-emitted on run bus: enter/start/finish/fail/spawn/join/drop/loop/warn/done (engine-level) plus play/pause/seek/speed/step/tick/end/cancel/recompile/remap/destroy (transport-level)
- Mode B (live): g.run({mode:'live'}) replays a real, append-only event log fed via start(id)/finish(id,{n})/fail(id,{reason})/spawn(id,n), each accepting {at} timestamp, all clamped to [0, frontier], none ever throw (unknown id or zero-occupancy -> console.warn + no-op, self-heals once matching node appears)
- Mode B two-clock model: frontier (run.now(), real elapsed time, always advancing) vs view clock (run.time(), follows frontier unless detached by seek); follow() snaps back to live; play() only catches up at 1x unless sped up
- Mode B fail() is finish()'s terminal sibling: consumes every occupant, no fan-out, status 'failed'; 'failed' is sticky (only an explicit start() clears/retries it, counting as the loop iteration) unlike 'done' which resets to 'pending' on fresh arrival
- Mode B reconnect/persistence: run.log() gives a full copy of the event log; run.reset({log,mode:'live'}, time?) re-seeds the SAME transport identity/listeners; options() round-trips the whole log for snapshot/restore
- Mode B performance: replayLive rebuilt around binary min-heaps, O(n log n) in log size (was superlinear); memoized state() keyed on (time, store revision, log revision) so an idle live graph costs a comparison per frame not a re-replay; measured 40,000 events at 72.74ms (was 1996.95ms)
- run.state()/sim().stateAt(t) returns unified RunState: {tokens[], nodes{status,progress,occupancy}, edges{traversed}, joins{arrived,needed,fired}, loops{iteration,max}, done}
- compileRun duration grammar warnings pushed as {t:0, type:'warn', nodeId, message, value} events, re-emitted on the run bus

**Known limits**

- Per-branch speed() is Mode A only — 'branch' option is a documented no-op in Mode B (live mode has no per-token rate concept; only global catch-up speed scaling)
- Mode B has no fixed duration/total — run.duration is 'the growing frontier, not a fixed total'
- Storyboards drive Mode A ONLY in v1 — a storyboard step naming/driving a Mode B (live) run is out of scope (explicitly stated in README and enforced: smv-record/smv-fit refuse a storyboard driving g.run({mode:'live'}), exiting nonzero rather than recording/pricing it)
- Mode B does not re-resolve past events against topology that postdates them — an edge added after a node finished will NOT re-fan that old finish over the new edge, by design (protects time-travel correctness, deviates from a naive 'recompute against current spec' reading of the original plan)
- A container node cannot itself declare data.fail (not an executable step)

## Storyboard / director / camera / captions / recording

**Capabilities**

- Storyboards: serializable JSON op array (g.storyboard(steps) or opts.storyboard at mount); every step snapshotted so backward scrub through structural changes works (G2)
- Storyboard ops: every g mutation method (addNode/addEdge/removeNode/removeEdge/update/expand/collapse/condense/split/batch) plus director ops (camera/highlight/clearHighlight/caption/props) plus run.play/run.step/run.seek/wait, plus bare {label} position markers
- Build-time validation: unknown op name, a step with neither op nor label, or a malformed props key throws GraphError immediately at storyboard build (not at playback), including nested inside batch children at any depth, with a dotted step index in the error
- Director camera op: frame a single node ({node,k,pad,dur,ease}), a union of nodes ({nodes}), the whole graph ({fit:true}), an absolute transform ({x,y,k}), a relative pan ({by:{dx,dy}}), or a relative zoom ({zoom}); first camera op in a script takes over the viewport permanently (auto-refit stops); camera misuse (bad id, unsupported variant) never throws, only console.warn once per call naming every issue and does its best with what resolves
- Director highlight op: emphasis is replace-not-accumulate state (one call IS the emphasis), 4 variants (focus/warn/ok/mute), dim:true for spotlight (everything else to 28% opacity), pulse:true modifier (stacks with variant) for a ticker-driven attention beat; survives relayouts/expand-collapse/backward scrubs
- Director props op: per-step --smv-* custom-property override layer, keyed by node OR edge id, replace-not-accumulate, layered over g.style(fn), snapshotted/restorable; only --smv-* keys accepted or throws
- Director caption op: one narration overlay (role='status'), place top/bottom, 'note' variant; captions:false mount option hides overlay but keeps text in cue sheet
- Per-step dur (ms) pacing on ANY op — the declared timeline is the single source of truth that the scrubber, g.cues() and the frame renderer all read (D12); documented defaults per op type when dur omitted (labels/highlight/caption/props=0, wait=its own ms, camera=600, condense/split=900, other mutations=animation.duration default 350, batch=longest of its own commit/wait/camera/condense/split children)
- g.cues(): every label + caption with absolute ms offset — the voice-over/chapter sheet
- g.timeline(): transport-facing {total,time,label,index,steps,playing}
- Fluent storyboard builder (src/storyboard.js timeline(g).camera(...).wait(...).caption(...).build()) — JSON array is still the actual public/portable artifact
- smv-pack CLI: bundles the built IIFE + spec JSON (+ optional storyboard JSON) into one self-contained .html file, no build step needed to view; --record flag emits the deterministic-frame-renderer variant (manual ticker, forced full motion, no autoplay, window.__smv exposed)
- smv-record CLI: drives real headless Chromium (playwright-core) frame-by-frame, pipes frames into ffmpeg for an h.264 mp4, or writes a PNG sequence (--png-dir); byte-identical across two runs on one machine; --fps/--width/--height/--scale/--theme/--tail/--preset flags; --from/--to re-renders one labelled chapter frame-identical to the full take; --font pins a woff2/woff/ttf/otf both in CSS AND in canvas measureText so cross-machine layout is stable; Ctrl+C cleans up partial --out files (removes them, exits 130), leaves partial --png-dir sequences intact
- --cues flag on smv-record: writes cue sheet as .json (raw g.cues() + render metadata), .srt (subtitles), or .txt (YouTube chapter list), extension-selected format
- smv-fit CLI: pure JSON->JSON transform that stretches/shrinks 'wait' steps between labels to match a recorded voice-over's actual landing timestamps (marks.json); idempotent; refuses (exit 1) rather than guess on out-of-order marks, unreachable gaps, duplicate labels, or a script containing run.play (whose duration can't be priced outside a browser)
- exportSVG(g, {viewport:true}) produces a still frame matching the live pan/zoom + culling state exactly (for a thumbnail of a story beat) as opposed to the default whole-graph export
- cues/fit pure functions reachable as library imports without shelling out: sparkle-motion-visualizer/cues (formatCues, toSRT, toChapters) and sparkle-motion-visualizer/fit (fit, parseMarks)

**Known limits**

- Storyboards drive Mode A (simulate) runs only — NOT Mode B (live) — enforced at multiple layers (see execution engine limits)
- smv-record refuses to record any storyboard containing a run.play step targeting a Mode B run; wall-clock/live replay is fundamentally non-reproducible
- smv-fit refuses (cannot price) a run.play step at all, live or simulated, because its duration depends on the compiled token run inside a real browser, not on the step object alone — 'pure JSON->JSON' cannot see that
- smv-record requires a chromium binary on disk (bundled or via playwright-core) — not usable without that dependency chain, and requires ffmpeg on the system for --out (video) output specifically (--png-dir works without it)
- A forward seek/scrub through a storyboard replays camera/highlight/caption ops instantly (position, not a screening) — cannot recreate the exact tween frames a live forward play would show, which is why chapter re-renders replay from step 0 rather than seeking

## Styling / theming

**Capabilities**

- Single styling mechanism (D7): everything visual driven by --smv-* CSS custom properties + data-* attributes, written once per commit, never per animation frame
- One global deduplicated <style data-smv-styles> injected once per document, shared across multiple instances on a page
- Three-tier theme cascade: light defaults at :where(.smv-root) (specificity 0, trivially overridable), explicit dark override at .smv-root[data-smv-theme="dark"], OS-driven dark at @media(prefers-color-scheme:dark) scoped to data-smv-theme="auto"
- theme: 'auto'|'light'|'dark' at mount, or runtime g.theme(t)
- Documented full --smv-* token reference (bg, fill, stroke, text, muted, edge, edge-width, accent, ok/ok-stroke, active/active-stroke, container, header, condense, radius, traversed [write-only per commit], emph [write-only], pulse [write-only per tick])
- Documented full data-* attribute reference (theme, id, status, mode, run, container, collapsed, count, emph, dim, smv-record, condense, reversed, weight, traversed, frozen, filled, style-injection markers)
- g.style(fn): per-node function re-run every commit, returns --smv-* values as inline custom properties (highest specificity); null clears
- g.props(map): director/storyboard override layer for nodes AND edges, layered over g.style(fn)
- CSS-only theming fully supported with zero JS (custom status vocab like data-status="blocked" works with no specificity fight since it's not a built-in selector)

**Known limits**

- Only --smv-* custom properties are accepted by style()/props() — anything else throws GraphError('style-key'/'props-key')
- --smv-fill/--smv-stroke are overridden locally by status/mode selectors, so a naive global override can be shadowed for done/active/container nodes unless scoped correctly (documented gotcha, not a bug)

## Export

**Capabilities**

- exportSVG(g, opts): ESM-only, standalone SVG string; default produces the whole graph (drops pan/zoom, re-frames to bounds-sized viewBox, un-hides culled elements); opts.pad, opts.theme (bakes resolved theme onto <svg> since there's no root to carry data-smv-theme)
- exportSVG(g, {viewport:true}): inverted mode — keeps live pan/zoom transform AND live culling state, sizes viewBox to the pane (a 'shot' matching what's on screen, ignores pad)
- exportPNG(g, {scale}): browser-only canvas rasterization returning a Blob
- smv-pack: single self-contained .html file bundling IIFE + spec (+ storyboard) — offline, file:// openable, no fetch/CDN dependency
- smv-record: deterministic mp4 (via ffmpeg piping) or PNG frame sequence

**Known limits**

- exportSVG/exportPNG/a11y-table are NOT included in the IIFE bundle — ESM-only, reached via a separate <script type=module> import or npm subpath import (sparkle-motion-visualizer/export), by design to keep the default embed small (D11)
- exportPNG is browser-only (canvas rasterization) — not usable in Node
- No other export formats documented (no PDF, no GraphML/DOT/JSON-diagram interchange export beyond the graph spec itself)

## Accessibility

**Capabilities**

- attachA11y runs at mount unless opts.a11y===false: svg gets role='application'/aria-roledescription='graph', node layer role='tree', each node role='treeitem' with aria-level, aria-label ('label · status'), aria-expanded on containers
- Keyboard navigation: arrow keys move focus in reading order (rank-major, inferred from layout result — correct for TB/BT, degrades to LR/RL when nothing to infer), Home/End jump, Enter/Space toggles a container; focus arriving via click or external .focus() is picked up too
- Live run status ('active'/'done'/'failed') is folded into the accessible name (data-run channel) while a run drives the node, falling back to data.status otherwise
- Dedicated role='status' aria-live='polite' region announces '<label> started/finished/failed' as they happen; several landing in the same tick are coalesced into one joined announcement
- Decoration (token pulses, occupancy/loop badges, edge labels, container chrome) is aria-hidden
- attachA11yTable (sparkle-motion-visualizer/a11y-table): a fully linearized <table> fallback, visually-hidden by default; its status column also tracks live run status, not just static spec data.status
- Culling-aware focus: arrow/Home/End walk only the focusable (non-culled) subset; focusId refuses to commit focus to a culled element (fixed regression noted in DEVIATIONS)

**Known limits**

- Only ONE a11y surface is ever exposed at a time: with the interactive tree on (default) the table is aria-hidden (visual/structural fallback only); a11y:false makes the table the sole accessible surface AND disables the interactive tree entirely — the graph becomes non-keyboard-navigable in that mode, table is read-only with no graph interaction
- No stated WCAG conformance level or third-party a11y audit result — only the mechanisms above are documented

## Querying

**Capabilities**

- g.nodes(filter?) / g.edges(filter?): filter can be a predicate function or a partial-match object (including nested data: {...}); returns plain copies (mutating them never touches the store)
- g.node(id) / g.edge(id): singular plain-copy lookups
- g.children(id) / g.descendants(id) / g.roots()
- g.spec(): plain-copy snapshot of the whole graph (nodes/edges arrays)
- g.bounds() / g.layoutResult(): current computed layout geometry
- g.props/g.style are write-side (styling), not querying

**Known limits**

- Read-only query sugar — no query language/DSL beyond predicate functions and shallow partial-match objects; no path-finding, no graph-algorithm queries (e.g. no shortest-path, no built-in cycle-listing API beyond internal FAS)

## Events

**Capabilities**

- g.on(type, fn)/g.off(type, fn) on the mounted instance's own event bus, plus a wildcard g.on('*', fn) that receives (type, payload)
- GraphEventMap: commit (full layout/render result), add, remove, update, expand, collapse, expandAll, collapseAll, condense, split, runstatus (a node's run status transition, emitted per-transition not per-frame)
- Run-level event bus (separate from g's): transport events (play/pause/seek/speed/step/tick/end/cancel/recompile/remap/destroy) and engine events (enter/start/finish/fail/spawn/join/drop/loop/warn/done for Mode A; start/finish/fail/spawn plus shared transport events for Mode B — Mode B never emits enter/join/drop/loop/warn/done/recompile)
- Storyboard handle events via its own on/off (position/labels changes etc., via StoryboardHandle interface)

**Known limits**

- No event replay/history API beyond what run.log() (Mode B) and the compiled sim().events (Mode A) already expose
- runstatus payload only lists status ∈ pending|active|done (not 'failed') per the typed GraphEventMap, though prose elsewhere describes a 'failed' announcement via the aria-live region — worth flagging as a minor doc/type inconsistency, not confirmed as a real gap

## Error model

**Capabilities**

- GraphError: real exported class (instanceof works), every message embeds its code as [smv:<code>] ...
- ~19 documented error codes covering structural misuse: no-mount, node-id, edge-id, dup-id, dangling, unbounded-loop, missing, parent-cycle, non-convex, split-container, split-edge, split-no-entry, split-no-exit, props-key, style-key, storyboard-step, storyboard-op, storyboard-label, batch-async
- Every structural misuse throws synchronously at the call/build site (not deferred to playback/animation)
- Non-structural misuse (camera/highlight target resolution, e.g. unresolved node id, mistyped key, unsupported variant) is deliberately NOT an error — presentational, only console.warn, best-effort execution
- Duration-parsing failures and Mode B unknown-id calls are also non-throwing — console.warn + safe fallback/no-op, self-healing where relevant (Mode B ids)

**Known limits**

- No structured/typed warning objects — diagnostics are console.warn strings (some also surfaced as bus 'warn' events in Mode A only)
- batch(fn) provides no rollback/atomicity on partial failure (documented, not a bug, but a real limit for anyone expecting transactional semantics)

## Tooling (CLIs, harness, testing)

**Capabilities**

- Three CLIs shipped as npm bin entries: smv-pack, smv-record, smv-fit (all under bin/)
- scripts/build.js: esbuild-based build producing ESM (smv.esm.js) + minified IIFE (smv.iife.min.js) + an internal-only core metric bundle (smv.core.esm.js, gitignored, never published) for size accounting; hard-fails if @dagrejs/graphlib/dagre strings leak into any published bundle
- scripts/size-budget.js: hard-fail CI budget gate (core <45KB gzip, full IIFE <50KB gzip)
- scripts/check-doc-versions.mjs: verifies every sparkle-motion-visualizer@ version pin across README/docs matches package.json
- scripts/harness.mjs: findChromium() locator for the headless-recording pipeline (repo image, PLAYWRIGHT_BROWSERS_PATH, playwright-core's own cache), used by smv-record
- Test suite: node --test unit tests, golden-file layout snapshot tests (test/golden/*), dagre-vs-engine parity test (test/engine-parity.test.js, needs dev-installed @dagrejs/dagre), and headless-chromium e2e milestone gates (test/e2e-m0.mjs through m4.mjs)
- npm scripts: build/test/size/check-doc-versions/check (the full CI gate)/types (tsc over types/check.ts, the hand-written .d.ts surface validated against real usage)/prepack/prepublishOnly

**Known limits**

- smv-record needs a chromium binary (bundled image or `npx playwright install chromium`) and, for --out (video), ffmpeg on the system — --png-dir avoids the ffmpeg dependency but still needs chromium
- The metric-only core bundle (smv.core.esm.js) is explicitly a build artifact, not a published/reachable entry point (no ./dist/* subpath is exported)

## Distribution

**Capabilities**

- No build step required for basic usage: single <script> IIFE tag (global SparkleMotion) via jsdelivr/unpkg CDN, or ESM <script type=module> import from the CDN's dist/smv.esm.js, or npm install + `import {mount} from 'sparkle-motion-visualizer'` for bundler users
- package.json exports map: '.', './preset-pipeline', './export', './a11y-table', './adapters/dagre' (all with types + default conditions), plus './cues' and './fit' (bin-backed pure-function subpaths, no types condition listed)
- Hand-written TypeScript types (types/index.d.ts, ~820 lines) covering the full public API, validated via `npm run types` (tsc -p types/check.ts) against real usage rather than generated from JS
- Enforced bundle size budgets: core (layout engine external) 42.62KB min+gzip (<45KB budget), full IIFE incl. in-house layout 47.50KB min+gzip (<50KB budget) — as of the M3 engine swap (dagre out, saved ~13KB gzip)
- Straight git install supported: `npm install github:Selaya/research-graph-library`
- 'files' in package.json: src, dist, types, bin, scripts/harness.mjs are published; the dead metric bundle explicitly excluded after a past bug shipped it
- Optional peerDependency: @dagrejs/dagre (^3.1.1), marked optional in peerDependenciesMeta — install separately only if using the dagre adapter
- No framework dependency (React/Vue/etc.) — plain DOM/SVG

**Known limits**

- IIFE bundle intentionally omits exportSVG/exportPNG/a11y-table (ESM-only, D11) to keep the default embed under budget
- version pinned at 0.1.0 (pre-1.0) — no semver stability guarantee implied by the package's own versioning stage; not independently confirmed via npm registry in this pass (repo-local package.json is the source of truth used here)

## Integrations / adapters

**Capabilities**

- Single adapter: sparkle-motion-visualizer/adapters/dagre exposing dagreSolver/dagreLayout behind the LayoutSolver seam — swap in via mount(el, spec, {layout:{solver: dagreSolver}})
- Solver seam is generically pluggable: any function matching (input, opts) => {nodes, edges, order, layers?, slots?} can be supplied as opts.layout.solver, so third-party layout algorithms could in principle be plugged in without forking the library
- presetPipeline / preset system: a documented, minimal contract ((g)=>{destroy()}) for building decoration layers off the public g.on('commit',...)/g.renderer.node|edge/g.spec()/g.nodes() surface, without reaching into internal modules — enables authoring custom presets/plugins that ship as separate entry points

**Known limits**

- No adapters for other layout engines besides dagre are shipped (e.g. no ELK, no Graphviz/dot adapter) — the seam exists but only one adapter is implemented
- No data-source adapters (no built-in GraphML/DOT/JSON-schema importers) — spec is the library's own {nodes,edges} JSON shape only
- No framework wrapper packages (no official React/Vue/Svelte component) — integration is DOM-element + imperative API only

## Public API surface

- mount(el, spec, opts) -> Graph
- g.addNode/addEdge/removeNode/removeEdge/update/batch/style/theme
- g.expand/collapse/expandAll/collapseAll
- g.condense(ids, newNode)/g.split(id, {nodes,edges})
- g.run(opts) -> SimRun | LiveRun
- g.storyboard(steps) -> StoryboardHandle
- g.timeline()/g.camera()/g.highlight()/g.clearHighlight()/g.caption()/g.cues()/g.props()
- g.layout(opts)/g.fitView()/g.bounds()/g.layoutResult()/g.spec()/g.destroy()
- g.on(type,fn)/g.off(type,fn)
- g.nodes()/g.edges()/g.node(id)/g.edge(id)/g.children(id)/g.descendants(id)/g.roots()
- GraphError (exported class)
- presetPipeline(g)
- sparkle-motion-visualizer/export: exportSVG(g,opts), exportPNG(g,opts)
- sparkle-motion-visualizer/a11y-table: attachA11yTable(g,opts)
- sparkle-motion-visualizer/adapters/dagre: dagreSolver, dagreLayout
- sparkle-motion-visualizer/cues: formatCues, toSRT, toChapters
- sparkle-motion-visualizer/fit: fit, parseMarks
- CLI: smv-pack <spec.json> [-o out.html] [--storyboard] [--preset] [--theme] [--record]
- CLI: smv-record <spec.json> --storyboard sb.json (--out mp4 | --png-dir) [--fps][--width][--height][--scale][--theme][--tail][--cues][--from][--to][--font]
- CLI: smv-fit <sb.json> --vo marks.json [-o fitted.sb.json] [--base ms]
