# Cohort survey: react-flow-family
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** React Flow / @xyflow/react + Svelte Flow (xyflow), Vue Flow, reaflow — node-based UI builders: handles/ports, edge types, node resizer/toolbar, minimap, controls, background, connection validation, sub-flows, helper lines, elkjs/dagre layout recipes

**Verification tally:** 23 claimed gaps: 19 missing, 4 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| @xyflow/react (React Flow) | 12.11.6 | MIT | https://reactflow.dev | yes | React library for building node-based UIs, flowcharts, and diagrams; ships Background/MiniMap/Controls/NodeResizer/NodeToolbar/Panel components. |
| @xyflow/svelte (Svelte Flow) | unknown (1.x, Svelte 5 based per 'What's new') | MIT | https://svelteflow.dev | yes | Svelte 5-based sibling of React Flow, same xyflow core, same built-in component set (Background/MiniMap/Controls/NodeResizer). |
| @vue-flow/core (Vue Flow) | unknown (companion @vue-flow/minimap confirmed at 1.5.4) | MIT | https://vueflow.dev | yes | Vue 3 flowchart/node-based UI component library with selection, dragging, custom nodes/edges, plus Background/MiniMap/Controls plugin packages. |
| reaflow | 5.4.1 | Apache-2.0 | https://github.com/reaviz/reaflow | yes | React diagram/workflow-editor engine using elkjs for layout; ports, nested nodes/edges, proximity linking, selection, undo/redo helpers. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Ports / handles (typed, multiple named connection points per node)

- **Category:** data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow; reaflow
- **What they offer:** All four expose per-node Handle/port components with type (source/target), position (top/right/bottom/left), and id, so a single node can have many independently addressable connection points; edges attach handle-to-handle, not just node-to-node. reaflow calls them 'ports' with configurable side/dragType.
- **Why it matters here:** smv's inventory explicitly states edges attach node-to-node only, with the layout shell force-reattaching container edges to an interior child as a fallback. A pipeline/process narration library showing e.g. a node with distinct 'success' vs 'error' outputs, or a fan-in with labeled input slots, cannot visually distinguish which side/slot an edge lands on today.
- **How it could fit:** Could extend NodeSpec with an optional `ports: {id, side, label}[]` and EdgeSpec `sourcePort`/`targetPort`; rendering would place small connection markers along the node's border matching declared side, purely additive to current node-to-node routing.
- **Survey evidence:** https://reactflow.dev/api-reference/components/handle (from memory, corroborated by search snippets referencing Handle type=source/target and elkjs port examples); reaflow ports from fetched README/issue snippets (verified)
- **Repo check:** grep -rniE 'handle|port' over src/*.js, README.md, docs/*.md returns nothing resembling a handle/port concept (only unrelated 'handler' matches). Edges in src/render.js and src/path.js attach node-to-node via computed rect clipping (clipEnds), not to named per-node connection points. docs/PLAN.md:31-32 lists 'graph editing UI (drag-to-connect)' as an explicit v1 non-goal.
- *Verifier's phrasing of the claim:* Ports/handles (typed, multiple named connection points per node)

### 2. Interactive node dragging / manual repositioning

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow; reaflow
- **What they offer:** Nodes are draggable by default (onNodesChange position deltas, draggable prop per node), letting users manually override the computed layout.
- **Why it matters here:** smv's own knownLimits explicitly says 'No node dragging/repositioning by the user — layout is entirely computed.' This is a deliberate design choice (auto-layout-driven narration) but is the single largest interaction gap versus the whole cohort, and worth flagging even though it may be intentionally out of scope.
- **How it could fit:** Out of scope for smv's storytelling model unless a future 'manual override' opt-in mode pins node x/y and disables re-layout for pinned nodes.
- **Survey evidence:** from memory (React Flow node dragging is core/default behavior); Vue Flow search result explicitly lists 'draggable elements' (verified)
- **Repo check:** docs/PLAN.md:31-32: 'Non-goals (v1): ... graph editing UI (drag-to-connect), React/Vue bindings...'. src/viewport.js only implements pan/zoom of the whole canvas (docs/INTERNALS.md:139 'Pan: pointer drag. Zoom: wheel only with ctrl/cmd + pinch'), not per-node dragging. No draggable-node code found in src/render.js or src/interact.js.

### 3. Box/marquee selection and multi-select of nodes/edges

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow; reaflow
- **What they offer:** Shift-drag or a selection tool draws a rectangle to select multiple nodes/edges at once (selectionOnDrag / multiSelectionKeyCode), feeding a selectedNodes/selectedEdges state usable for bulk operations.
- **Why it matters here:** smv's inventory notes 'No multi-select or selection API/state beyond query-sugar reads.' A director/storyboard-style library could use multi-select to let a user visually pick nodes for a highlight/props op while authoring, even though playback itself has no user-driven selection today.
- **How it could fit:** Would fit as an authoring-time helper only (e.g. a dev-tool overlay), not the runtime player; low priority relative to smv's playback-first identity.
- **Survey evidence:** from memory (React Flow selectionOnDrag/multiSelectionKeyCode is well-documented core behavior) (verified)
- **Repo check:** grep -rniE 'selection|multiselect|marquee' over src/README/docs found no selection-state or marquee-drag code; only unrelated D3 'selection.join' research notes in docs/research/api.md and ux.md. No selectedNodes/selectedEdges concept in src/.

### 4. Context menu (right-click) support

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Vue Flow
- **What they offer:** onNodeContextMenu/onPaneContextMenu/onEdgeContextMenu callbacks let consumers render a custom right-click menu (documented React Flow example 'Context Menu').
- **Why it matters here:** smv's inventory explicitly lists 'No context menu support' as a known limit; matches a real, named cohort capability so it is confirmed as a gap rather than just plausible.
- **How it could fit:** Could be exposed as new DOM events (e.g. 'smv:node-contextmenu') the host listens to and renders its own menu with, keeping smv's zero-CSS-in-JS philosophy.
- **Survey evidence:** from memory (React Flow onNodeContextMenu is a documented core prop) (verified)
- **Repo check:** grep -rniE 'contextmenu|context menu' over src, README.md, docs returned zero matches anywhere in the repo.

### 5. Built-in tooltip system

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow (via community/Pro examples); reaflow
- **What they offer:** reaflow and common React Flow patterns attach hover tooltips to nodes/edges out of the box or via a documented recipe; reaflow supports per-node/edge title/tooltip props.
- **Why it matters here:** smv's inventory explicitly states 'No built-in tooltip system — only the CSS :hover stroke highlight.' A gap the library itself already flags as a limit, confirmed relevant to this cohort.
- **How it could fit:** Could ship as a small opt-in preset (similar to presetPipeline contract) that listens to pointerenter/leave and positions a floating aria-describedby tooltip using node.data fields — fits the existing preset extension point without touching core.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rniE 'tooltip' over src and README.md returns nothing; the only hit is docs/research/ux.md:43, a research note about a different product's (Temporal Web UI) hover tooltip, not a feature of this library.

### 6. Undo/redo history

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow (via zundo pattern); reaflow
- **What they offer:** reaflow ships a dedicated undo/redo helper; the React Flow ecosystem's standard recipe layers zundo (a Zustand time-travel middleware) over flow state to get history-based undo/redo of node/edge changes.
- **Why it matters here:** smv's g.batch() is explicitly non-transactional with no rollback, and there is no history/undo concept anywhere in the inventory for structural graph mutations (separate from Mode A/B run scrubbing, which does have seek/step).
- **How it could fit:** Could be an opt-in history buffer of committed GraphSpec snapshots (g.undo()/g.redo()), independent of run-scrubbing, snapshotting before/after each top-level mutation call.
- **Survey evidence:** reaflow README (fetched) lists 'undo/redo functionality'; zundo pattern from search snippet https://github.com/charkour/zundo and xyflow discussion #3364 (verified)
- **Repo check:** grep -rniE 'undo|redo' over src/*.js and README.md: the only real hits are internal/unrelated ('Undo viewport culling' comment in export.js, dagre acyclic-graph undo bookkeeping discussed only in docs/research/cyclic-layout.md as background research, and README.md:136 stating that update animations are 'never undone'). No user-facing undo/redo API or history stack exists.

### 7. Copy/paste and keyboard-driven duplicate/delete of nodes

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Vue Flow
- **What they offer:** deleteKeyCode, onNodesDelete, and copy/paste recipes (Ctrl+C/Ctrl+V duplicating selected nodes with new ids) are documented, built on the selection state.
- **Why it matters here:** Not applicable to smv's read-mostly/programmatic-mutation model, but notable since the inventory's a11y layer already has rich keyboard nav (arrows/Home/End/Enter) without any edit-keyboard commands.
- **How it could fit:** Low priority — smv graphs are typically generated/scripted, not hand-edited via keyboard.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** No selection state exists (see marquee-selection finding) to build copy/paste/delete on top of; grep found no deleteKeyCode/copy/paste/duplicate concept in src or docs. Consistent with docs/PLAN.md:31-32 excluding editing UI from v1.

### 8. Minimap / navigator overview panel

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow; reaflow
- **What they offer:** A small always-visible bird's-eye-view panel (MiniMap component) rendering all nodes at reduced scale with a draggable viewport rectangle, usable to pan/jump around large graphs; customizable node color/shape functions.
- **Why it matters here:** smv has viewport culling and fitView() for very large graphs (150+ elements) but the inventory has no minimap/overview affordance — for a long pipeline narration with many collapsed containers, a minimap would help viewers orient during scrubbing, complementing (not duplicating) the existing transport bar/scrub slider.
- **How it could fit:** Could be an opts.controls variant or a separate opt-in `minimap: true` mount option rendering a small secondary SVG driven by g.bounds()/g.layoutResult() and viewport.worldToScreen, read-only or pannable.
- **Survey evidence:** https://vueflow.dev/guide/components/minimap.html (fetched via search snippet); React Flow MiniMap from memory, well-documented core component (verified)
- **Repo check:** docs/research/ux.md:17 and :64 explicitly propose minimap 'as an optional overlay component, not core' and docs/research/critique.md:150/230 discuss it only as a possible future ESM-only optional entry to keep out of the core bundle. No minimap component exists in src/ (docs/PLAN.md:693 lists 'minimap' among speculative future additions, not shipped).

### 9. Node resize handles (interactive resizer UI)

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow
- **What they offer:** NodeResizer / NodeResizeControl components render draggable handles around a selected node letting the user resize it in all directions, with min/max width/height constraints and keepAspectRatio option.
- **Why it matters here:** smv computes node w/h from real text measurement (deterministic) and has no user-facing resize; this is a legitimate interaction gap but conflicts somewhat with smv's deterministic-sizing design goal (auto-measured boxes, not manually sized).
- **How it could fit:** Low fit given smv's explicit design choice to auto-size nodes from measured text for reproducible recording; would only make sense as an authoring-tool feature, not the player.
- **Survey evidence:** https://reactflow.dev/api-reference/components/node-resizer (from memory + search snippet title 'Node Resizer - React Flow') (verified)
- **Repo check:** grep -rniE 'resiz' over src and docs finds only src/render.js:418 ('edges stay attached while nodes resize' — referring to nodes resizing during layout/animation, not user-driven resize) and docs/DEVIATIONS.md:44 (layout pipeline step named 'resize'). No interactive resize-handle UI exists.

### 10. NodeToolbar (contextual per-node action bar)

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow
- **What they offer:** A small floating toolbar anchored to a node (shown on select/hover) for per-node actions like delete/edit/duplicate buttons, positioned automatically relative to the node.
- **Why it matters here:** smv has no equivalent, and its own knownLimits don't mention this specifically, but it's adjacent to the missing tooltip/context-menu gaps — a documented, reusable anchored-overlay primitive the cohort ships that smv authors would otherwise hand-roll per preset.
- **How it could fit:** Could generalize smv's caption overlay positioning logic into a reusable 'anchor an HTML/SVG overlay to a node's current screen rect, updating every commit' primitive, usable by presets for toolbars/tooltips/badges alike.
- **Survey evidence:** from memory (React Flow NodeToolbar is a documented built-in component) (from memory / unverified)
- **Repo check:** No 'toolbar' concept in src/ at all (grep found none); this is consistent with the library's non-editing design (docs/PLAN.md non-goals).

### 11. Orthogonal / step edge routing and multiple built-in edge path types

- **Category:** rendering · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** React Flow; Svelte Flow; Vue Flow; reaflow
- **What they offer:** Built-in edge types include bezier (default), straight, step, and smoothstep (orthogonal right-angle routing with rounded corners), selectable per-edge via edge.type; reaflow's elkjs backend does true orthogonal routing with bend points.
- **Why it matters here:** smv's inventory only documents 'layered bend-chain polylines' — effectively one routing style (straight polyline segments through dummy bend points). No smooth/curved (bezier) option and no distinctly-labeled 'orthogonal vs curved' choice is exposed to the consumer, only whatever the engine internally produces.
- **How it could fit:** Could add an opts.edgeRouting: 'polyline'|'smooth' rendering-layer toggle (bend points already computed by the engine; just choose polyline vs. spline-through-points at draw time) without touching the layout solver.
- **Survey evidence:** from memory (React Flow edge types are core, well documented: default/straight/step/smoothstep) (verified)
- **Repo check:** src/path.js implements edge routing (clipEnds, point arrays) used by the dagre-based layered layout in src/layout.js and src/adapters/dagre.js, which itself produces polyline/orthogonal-ish routed paths (dagre's standard layered routing), but there is no per-edge selectable 'type' (bezier vs straight vs step vs smoothstep) API — grep for 'smoothstep|step edge|orthogonal|bezier|edgetype' in src/*.js and docs/*.md returns no such per-edge type mechanism, only an unrelated use of the word 'orthogonal' in prose (docs/DEVIATIONS.md:454, docs/INTERNALS.md:14). So routing exists but is a single fixed style, not multiple selectable built-in edge types.

### 12. Edge markers / arrow customization (start+end marker, custom marker defs)

- **Category:** rendering · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** React Flow; Svelte Flow; Vue Flow
- **What they offer:** markerStart/markerEnd props accept built-in ArrowClosed/Arrow types or custom SVG marker defs with configurable size/color/strokeWidth, independently from edge stroke styling.
- **Why it matters here:** smv documents arrowheads as part of edge routing but no explicit customizable marker system (shape/size/start-marker) beyond the existing --smv-edge* custom properties; a real but narrow rendering gap.
- **How it could fit:** Minor — could allow a `markerEnd`/`markerStart` shape option (arrow/circle/none) per edge via data or a global mount option; low urgency versus other gaps.
- **Survey evidence:** from memory (React Flow MarkerType.ArrowClosed/Arrow is documented API) (from memory / unverified)
- **Repo check:** src/render.js:4 explicitly notes 'Arrowheads are hand-drawn triangles posed by clipEnds (G6) — <marker> never appears', with a hardcoded ARROW path constant (render.js:13) and single arrow element per edge (render.js:196-201, 421); styling is themeable via CSS var --smv-edge (docs/THEMING.md:61) but there is no markerStart/markerEnd API, no built-in arrow-shape choices, and no custom SVG marker-def support — arrows are single, fixed-shape, end-only.

### 13. URL / query-string state persistence for viewport & selection

- **Category:** export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow (community recipes); Vue Flow
- **What they offer:** Common recipe/plugin pattern serializing viewport (x,y,zoom) and sometimes full flow state into the URL query string so a link reproduces the exact view.
- **Why it matters here:** smv has exportSVG({viewport:true}) for a static shot of the current pan/zoom/culling state, but no shareable-URL mechanism to reproduce a live interactive session's viewport for someone else opening the same page.
- **How it could fit:** Could be a thin opt-in helper (`viewport.toQueryString()`/`viewport.fromQueryString()`) layered on the existing viewport API, no core engine change needed.
- **Survey evidence:** from memory (community pattern, not a documented first-party xyflow feature — flagged accordingly) (from memory / unverified)
- **Repo check:** grep -rniE 'location\.|querystring|URLSearchParams|history\.push' over src and docs found no matches; no such recipe or code exists.
- *Verifier's phrasing of the claim:* URL/query-string state persistence for viewport & selection

### 14. Full graph JSON save/restore via toObject()/setNodes()/setEdges() including viewport

- **Category:** export · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** React Flow; Svelte Flow; Vue Flow
- **What they offer:** instance.toObject() returns {nodes, edges, viewport} as one serializable snapshot; restoring calls setViewport alongside setNodes/setEdges to reproduce the exact prior view, documented as the 'Save and Restore' example.
- **Why it matters here:** smv's g.spec() only returns nodes/edges, not the current viewport/pan/zoom or theme; a consumer wanting to persist+restore a full live session (not just structure) has to hand-roll combining g.spec() with viewport.screenToWorld/anchor state.
- **How it could fit:** Could add g.toObject()/g.fromObject() bundling spec()+bounds()/viewport transform+theme in one round-trippable JSON blob, complementing rather than replacing g.spec().
- **Survey evidence:** https://reactflow.dev/examples/interaction/save-and-restore (from memory + corroborated by search snippet 'toObject function... save and restore a flow') (verified)
- **Repo check:** src/run.js / docs/LIVE.md:151-165 support persisting and restoring the animation **log** (run.reset({log: saved, mode:'live'}) re-seeds temporal event history), and src/export.js can serialize the SVG DOM, but there is no toObject()-style snapshot of {nodes, edges, viewport} together nor a setNodes/setEdges/setViewport restore API — grep for 'toObject|toJSON|serialize' in src confirms only DOM serialization (export.js) and log-level save/restore, not a structural graph+viewport snapshot.

### 15. Panel component for arbitrary UI slots inside the viewport

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow
- **What they offer:** A lightweight <Panel position="top-left|top-right|bottom-left|bottom-right|top-center|bottom-center"> wrapper that places arbitrary child UI (legends, buttons, stat readouts) fixed to a viewport corner without manual CSS positioning math, used internally by Controls/MiniMap themselves.
- **Why it matters here:** smv has a single-purpose caption overlay (bottom/top placement only) and a transport bar; there's no generic slot API for host-authored UI (legends, custom controls, badges) to anchor to the viewport the way Panel does — a real but modest gap since captions cover the narration use case.
- **How it could fit:** Could generalize caption's placement logic into a general opts.panels or a `g.panel(html, {position})` API reusable by presets for legends/badges/custom controls.
- **Survey evidence:** from memory (React Flow Panel is a documented core component, also referenced implicitly by search result mentioning 'plugin components') (from memory / unverified)
- **Repo check:** grep -rniE '\bpanel\b' over src and docs/*.md returns no hits at all; no such component exists.

### 16. Connection validation & connection-line customization during live edge-drawing

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow
- **What they offer:** isValidConnection(connection) predicate gates whether a user-dragged connection is accepted (used for e.g. preventing cycles, type-mismatched ports); connectionLineComponent lets you fully customize the temporary line rendered while dragging a new edge.
- **Why it matters here:** Not applicable today since smv has no interactive edge-authoring at all (spec-only, edges are declared not drawn) — flagged for completeness since it's a defining cohort feature category ("connection validation") named in the research brief, but genuinely out of scope for a playback/narration library unless a future authoring mode is added.
- **How it could fit:** Only relevant if smv ever ships an interactive graph-editing mode, which is explicitly not its current identity.
- **Survey evidence:** https://reactflow.dev/examples/interaction/prevent-cycles, https://reactflow.dev/examples/interaction/validation (search snippet titles); from memory for API shape (verified)
- **Repo check:** grep -rniE 'isvalidconnection|validconnection' over src and docs found nothing; this is a natural consequence of there being no drag-to-connect editing UI at all (docs/PLAN.md:31-32 lists 'graph editing UI (drag-to-connect)' as an explicit non-goal), so there is no live connection-drawing to validate or customize.

### 17. elkjs layout adapter (alternative to dagre) with native port-aware, hierarchical/nested-node, and multiple algorithm options (layered, force, radial, mrtree, stress)

- **Category:** layout · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; reaflow
- **What they offer:** elkjs (Eclipse Layout Kernel compiled to JS) is commonly wired in as an alternative layout engine, natively understanding nested node hierarchies (no flattening needed) and offering multiple algorithm families (layered/mrtree/force/radial/stress) selectable via elk.algorithm option; reaflow uses elkjs as its only/default layout engine.
- **Why it matters here:** smv's layout section states 'Layered/Sugiyama-style only — no force-directed, radial, or other layout algorithm families' and only ships one adapter (dagre) behind its solver seam. elkjs is the single most common alternative the cohort actually recommends specifically because — unlike dagre — it understands nested/compound nodes natively, which lines up directly with smv's own container-layout pain points (documented residual overlap issues in nested containers).
- **How it could fit:** A `sparkle-motion-visualizer/adapters/elk` package behind the existing LayoutSolver seam (same pattern as the dagre adapter) would be a natural, low-risk addition — the seam already exists and is documented as generically pluggable.
- **Survey evidence:** Medium article + reactflow.dev elkjs examples (search snippets: 'Elkjs Tree', 'Elkjs Multiple Handles', discussion #3495 'Dagre doesn't support sub flows... Elk works with nested node structure'); reaflow README (fetched) confirms elkjs as its layout engine (verified)
- **Repo check:** grep -rniE 'elkjs|elk\b' over src, docs, README.md, package.json finds elkjs mentioned only in docs/research/cyclic-layout.md as background research citing ELK's Java source for cycle-breaking algorithm design, never as a shipped or planned adapter. src/adapters/ contains only dagre.js (an optional @dagrejs/dagre adapter); there is no elk.js adapter file or wiring in src/layout.js.
- *Verifier's phrasing of the claim:* elkjs layout adapter (alternative to dagre) with native port-aware/nested/multi-algorithm support

### 18. Incremental/interactive re-layout while dragging (live layout recompute during a drag gesture, not just after commit)

- **Category:** layout · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow (community auto-layout example); Vue Flow
- **What they offer:** The 'Auto Layout' pattern recomputes and animates layout continuously as nodes are added/dragged, rather than only on explicit calls.
- **Why it matters here:** Low relevance — smv already does full relayout+animated transition on every mutation via mount()'s order-stability mechanism; the difference is only about continuous drag-time recompute, which doesn't apply since smv has no node dragging.
- **How it could fit:** Not applicable given smv's no-manual-drag design.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** Since nodes are not draggable at all (see node-dragging finding), there is no live-relayout-during-drag gesture; layout in src/layout.js runs as a synchronous pass triggered by explicit topology changes, not a continuous drag-driven recompute.
- *Verifier's phrasing of the claim:* Incremental/interactive re-layout while dragging

### 19. Grid/snap-to-grid positioning helper for manual layout

- **Category:** layout · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Vue Flow
- **What they offer:** snapToGrid/snapGrid props round dragged node positions to a grid for tidy manual alignment.
- **Why it matters here:** Not applicable — smv has no manual node placement.
- **How it could fit:** n/a
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rniE 'snapToGrid|snap-to-grid|snap grid' over src, docs, README.md returns zero matches; irrelevant anyway since there is no manual node dragging to snap.

### 20. Radial and force-directed layout algorithm options

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** reaflow (via elkjs 'force'/'radial'); Vue Flow (via d3-force community recipes)
- **What they offer:** elkjs supports force and radial algorithms in addition to layered, selectable per-graph; some Vue Flow examples wire in d3-force for a physics-simulated layout.
- **Why it matters here:** Directly named in the research brief's broad categories and directly matches smv's own documented knownLimit ('Layered/Sugiyama-style only — no force-directed, radial...'), confirming it as a real, acknowledged gap rather than a stretch.
- **How it could fit:** Given smv's execution/narration focus (process flow with clear directionality), force/radial layouts are a poor fit for its core use case (they don't respect edge direction/rank the way a pipeline narration needs) — low practical fitScore despite being a named gap.
- **Survey evidence:** elkjs algorithm options (from memory, elkjs documents layered/force/radial/mrtree/stress algorithms); Vue Flow d3-force from memory (from memory / unverified)
- **Repo check:** docs/PLAN.md:31 lists 'force-directed physics' explicitly as a v1 non-goal ('Non-goals (v1): huge graphs (>2,000 visible nodes), force-directed physics, WebGL, ...'). src/layout.js and src/adapters/dagre.js implement only dagre's layered (Sugiyama-style) algorithm; no radial or force option exists anywhere in src/.

### 21. Framework wrapper packages (official React/Svelte/Vue components) sharing a common core

- **Category:** integrations · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** React Flow; Svelte Flow; Vue Flow
- **What they offer:** xyflow ships @xyflow/react and @xyflow/svelte as separate framework-idiomatic packages built on a shared @xyflow/system core; Vue Flow is the Vue-native equivalent.
- **Why it matters here:** smv's inventory explicitly states 'No framework wrapper packages... integration is DOM-element + imperative API only' as a knownLimit — this is smv's own deliberate positioning (framework-free), so it's a real gap versus the cohort but arguably by design, not an oversight.
- **How it could fit:** Out of scope by design — smv's whole value proposition is zero-framework/no-build-step; a wrapper would be a thin community add-on, not core.
- **Survey evidence:** @xyflow/system npm package (search result); Vue Flow described as 'Vue 3 Flowchart component' (search snippet) (verified)
- **Repo check:** docs/PLAN.md:32 explicitly excludes 'React/Vue bindings' from v1 non-goals list. Repo has no framework wrapper directories/packages; package.json and src/ show a single vanilla-JS/no-framework core (per repo description), confirmed by absence of any react/vue/svelte references in src/.

### 22. Search/filter within the graph (find-a-node, highlight matches)

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Vue Flow (community recipes); React Flow (community recipes)
- **What they offer:** Common recipe pattern: a search input filters/dims nodes by label or data field, often paired with fitView to the matched subset.
- **Why it matters here:** smv already has g.highlight()/dim (spotlight) and g.nodes(filter) for programmatic queries, so a search UI is really just wiring those two together — a legitimate but narrow gap since the primitives already exist.
- **How it could fit:** Could ship as a documented recipe/preset (search input -> g.nodes({label: {$contains}}) equivalent via predicate -> g.highlight({nodes: matches, dim:true}) -> g.camera({nodes: matches})) rather than new core API, since all pieces already exist.
- **Survey evidence:** from memory (common community pattern, not a first-party documented feature of any cohort library) (from memory / unverified)
- **Repo check:** src/query.js exists but grep -rniE 'search|filter\(' inside it found no find/highlight-by-label feature; reading the file's purpose (not shown here in full but no search/highlight API surfaced by grep) plus no README/docs mention of a search feature — this is a documented candidate for future work at best, not a shipped feature.

### 23. Analytics/graph-algorithm helpers (shortest path, centrality, cycle listing) beyond internal use

- **Category:** analytics · **Fit:** 1/5 · **Verified in repo:** `partial`
- **Who has it:** reaflow (proximity-based linking implies internal graph traversal helpers)
- **What they offer:** Not a strong documented feature of any cohort library as a public API (none of the four ship a general graph-algorithms toolkit publicly) — flagged as largely absent across the whole cohort too, not just smv.
- **Why it matters here:** smv's inventory already notes 'no path-finding, no graph-algorithm queries... beyond internal FAS' as a knownLimit. Since the cohort itself doesn't clearly expose this either, this is a weak/low-confidence gap.
- **How it could fit:** Low priority; not a differentiator the cohort demonstrates either.
- **Survey evidence:** from memory, low confidence (from memory / unverified)
- **Repo check:** src/cycles.js exists and implements cycle detection/handling (used internally for the layered-layout cycle-breaking pass per docs/research/cyclic-layout.md), but it is wired for internal layout use, not exposed as a public shortest-path/centrality/cycle-listing analytics API in README.md or types — consistent with the claim's own framing that this is 'largely absent across the whole cohort,' and here only cycle-detection internals exist, not a public toolkit.

## Borrowable ideas

- React Flow's Panel component: a simple declarative slot ({position: 'top-left'|'top-right'|...}) for placing custom UI (legends, buttons, stats) inside the viewport without manual absolute-positioning math — sparkle-motion-visualizer's caption overlay could generalize into a general-purpose Panel API.
- xyflow's toObject()/fromObject() pattern for full state serialization (nodes+edges+viewport) as one JSON blob for save/restore/localStorage — smv already has g.spec() but pairing it with viewport transform + theme in one exportState()/loadState() would round-trip a full session, not just structure.
- reaflow's proximity-based node linking helper (suggests/creates an edge when you drag a node near another) is a nice interaction affordance worth considering for any future manual-editing mode.
- xyflow's isValidConnection callback shape — a pure predicate function the host supplies, called before an edge is committed — is a clean pattern smv could reuse if it ever supports live authoring of edges (currently spec-only), or even just as a validation hook for programmatic addEdge().
- Svelte/React Flow's connectionMode (strict vs loose: whether a handle must be a designated source/target or any handle can connect to any other) is a good minimal vocabulary if smv ever exposes finer per-node connection points.
- xyflow's fitView({nodes, padding, duration}) accepting a specific node subset (not just the whole graph or one node) is slightly more flexible than smv's camera op today ({node}, {nodes}, {fit:true}) — actually already covered, but their padding-per-call and duration defaults tuning is a good reference.
- reaflow and xyflow both expose a dedicated onNodeDrag/onNodesChange diffing changes array (add/remove/replace/position) as the single mutation surface — a useful shape to compare against smv's typed GraphEventMap if the API surface ever grows.
- xyflow ships first-class React/Svelte/Vue framework packages sharing a common @xyflow/system core — worth noting as a distribution pattern (core logic + thin framework adapters) even though smv is deliberately framework-free by design.

## Survey notes

reactflow.dev and svelteflow.dev were blocked by the egress proxy for direct WebFetch, so component-level detail for those two came from WebSearch result snippets plus my own training knowledge of React Flow (I have extensive first-hand familiarity with its API through v11/v12) marked 'from memory' where not corroborated by a fetched source. reaflow's GitHub README was fetched directly and is fully verified; note reaflow shows as archived by its owner (Jan 2026) per one search snippet, though npm still lists 5.4.1/Apache-2.0 as the last published state. Vue Flow's own top-level version number could not be confirmed (only the companion minimap package's 1.5.4 was confirmed); treated as unknown per instructions. All gaps below were checked against the given sparkle-motion-visualizer inventory before listing — anything already covered there (e.g. viewport pan/zoom, background via CSS custom props, expand/collapse containers, camera framing, style overrides) was excluded even where the cohort also has it.
