# Cohort survey: node-editors
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** Rete.js, litegraph.js, drawflow, Baklava.js, Node-RED editor, n8n canvas, ComfyUI graph, Blender-style node editors (as a design reference), Unreal Blueprints visual language — editing/authoring features: sockets, typed connections, subflows, groups, comments, undo, copy/paste, minimap, execution highlighting

**Verification tally:** 21 claimed gaps: 19 missing, 2 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| Rete.js | 2.0.6 (core 'rete' package) | MIT | https://retejs.org / https://github.com/retejs/rete | yes | Plugin-based JS/TS framework for building visual node editors, framework-agnostic core + React/Vue/Angular/Svelte/Lit renderers. |
| litegraph.js | 0.7.18 (also forked/maintained as @comfyorg/litegraph for ComfyUI's frontend) | MIT | https://github.com/jagenjo/litegraph.js | yes | Canvas2D node graph engine and editor (PD/UDK-Blueprints-style), runs client or server side, exports JSON. |
| Drawflow | 0.0.60 | MIT | https://github.com/jerosoler/Drawflow | yes | Zero-dependency vanilla-JS flow/node editor library. |
| Baklava.js | 2.8.1 (npm 'baklavajs') | MIT | https://github.com/newcat/baklavajs / https://baklava.tech | yes | TypeScript node/graph editor with a Vue 3 renderer, plugin ecosystem (engine, interface-types, themes). |
| Node-RED editor | unknown (bundled with Node-RED core, tracks node-red releases) | Apache-2.0 | https://nodered.org/docs/user-guide/editor/ | yes | Browser-based flow editor for wiring together hardware/APIs/services, part of the Node-RED project. |
| n8n canvas | unknown (SaaS/self-hosted app, not a standalone published lib) | Sustainable Use License / Apache-2.0 (n8n dual-license, source-available) — from memory, not independently re-confirmed this pass | https://docs.n8n.io | no | Workflow-automation editor canvas (Vue Flow-based) for n8n, the fair-code workflow automation platform. |
| ComfyUI graph (litegraph-based frontend) | frontend ~0.3.51 referenced for minimap/subgraph features (Sept 2025 blog post) | GPL-3.0 | https://github.com/comfyanonymous/ComfyUI | yes | Node-based Stable Diffusion pipeline UI/frontend, built on a litegraph.js fork (@comfyorg/litegraph). |
| Blender node editors | n/a (desktop app, not embeddable) | GPL-2.0-or-later | https://www.blender.org | yes | Shader/Compositor/Geometry-Nodes editors inside Blender — design reference only, not a JS library. |
| Unreal Engine Blueprints | n/a (proprietary engine feature, not embeddable/licensable as a library) | proprietary (Epic Games EULA) | https://www.unrealengine.com | yes | Visual scripting node graph inside Unreal Editor — design reference only, not a JS library. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Typed sockets/ports with connection-compatibility validation

- **Category:** data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js; Baklava.js; litegraph.js; ComfyUI; Blender; Unreal Blueprints
- **What they offer:** Nodes expose multiple named/typed input and output sockets (not whole-node edges); a connection is only permitted between compatible types, and mismatched drags are rejected or auto-coerced with a converter node. Rete.js does this via its Socket class plus rete-connection-plugin validation hooks; Baklava.js via its interface-types plugin; litegraph/ComfyUI via colored typed slots.
- **Why it matters here:** sparkle-motion-visualizer explicitly has no ports concept (edges attach node-to-node only); a pipeline/process narration tool that wants to show 'this output feeds that specific input' or validate wiring before recording a storyboard has no way to express or enforce that today.
- **How it could fit:** Could extend NodeSpec with an optional `ports: {in: PortSpec[], out: PortSpec[]}` and EdgeSpec with `sourcePort`/`targetPort` ids, purely additive to the existing node-to-node model, with rendering as small labeled anchor points along the node's border; type-check would be an opt-in validation callback at addEdge() time.
- **Survey evidence:** https://retejs.org/docs/guides/connections/ ; https://github.com/newcat/baklavajs (verified)
- **Repo check:** types/index.d.ts EdgeSpec connects node ids only (no per-socket typed ports); grepped README/types for socket/port/type-compat concepts — none found. src/store.js edges reference node id -> node id, whole-node.

### 2. Manual node dragging / repositioning by the end user

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js; litegraph.js; Drawflow; Baklava.js; Node-RED editor; n8n canvas; ComfyUI; Blender; Unreal Blueprints
- **What they offer:** Every cohort tool lets the user grab a node and drag it to a new screen position, with the editor persisting that manual position (litegraph/Drawflow/Rete area-plugin drag, Node-RED workspace, n8n canvas, ComfyUI/Blender/Blueprints canvas drag).
- **Why it matters here:** sparkle-motion-visualizer's knownLimits explicitly state layout is entirely computed, no manual repositioning — for a narration/authoring tool, presenters often want to nudge one node to avoid an overlap or for a specific camera composition without fighting the auto-layout every time.
- **How it could fit:** Could add an opt-in interaction.dragNodes mode that lets a user-set {x,y} override participate as a soft constraint the engine respects on relayout (similar to componentOrder's slot-pinning mechanism), off by default to preserve deterministic auto-layout.
- **Survey evidence:** from memory (well-documented standard feature across all nine) (from memory / unverified)
- **Repo check:** src/interact.js (69 lines, only exported function attachTapToggle) implements only tap-to-expand/collapse a container node via pointerdown/up; no drag-to-move handler anywhere in src/. Layout positions are computed by the layout engine (src/layout.js/engine.js), not user-settable.
- *Verifier's phrasing of the claim:* Manual node dragging/repositioning by end user

### 3. Box/rubber-band multi-select and group operations

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js; litegraph.js; Drawflow; Baklava.js; Node-RED editor; n8n canvas; ComfyUI
- **What they offer:** Drag a selection rectangle to multi-select nodes, then move/delete/copy/group them together; Node-RED has explicit 'group selected nodes'/'merge groups'/'remove from group' commands, ComfyUI supports selecting nodes+groups+reroutes together for 'Collapse to Subgraph'.
- **Why it matters here:** sparkle-motion-visualizer's knownLimits explicitly say there is no multi-select or selection API/state — condense()/split() require the caller to already know the id set programmatically; there's no interactive way for a human operator to lasso a region and act on it.
- **How it could fit:** Could add g.select(ids)/g.selection() as a lightweight interactive state layer (separate from the read-only query sugar) feeding into condense() as the id source, plus a director op like {op:'select', ids}.
- **Survey evidence:** https://flowfuse.com/node-red/getting-started/editor/workspace/ ; https://blog.comfy.org/p/comfyui-035-frontend-updates (verified)
- **Repo check:** No selection state in store.js/viewstate.js/interact.js; grep for 'select' in interact.js/query.js finds none related to UI selection (query.js 'roots'/'children' are graph-structure queries, not UI selection).

### 4. Visual (non-container) grouping / freeform annotation regions

- **Category:** rendering / data model · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Node-RED editor; n8n canvas; ComfyUI
- **What they offer:** A lightweight rectangular 'group' or colored region drawn around a set of nodes purely for visual/organizational purposes, distinct from a structural compound/container node — Node-RED's flow groups, ComfyUI's colored group boxes (preserved in the minimap), n8n's ability to drag sticky notes behind nodes to visually cluster them.
- **Why it matters here:** sparkle-motion-visualizer's only grouping mechanism is the structural `parent` (compound/container) relationship, which affects layout and execution rollup; there is no way to visually annotate 'these three nodes belong together' for narration purposes without making them an actual executable container.
- **How it could fit:** Could add a non-structural `groups: [{id, nodeIds, label, color}]` array in GraphSpec, rendered as a background rect behind member nodes with zero layout/execution effect — purely cosmetic, orthogonal to `parent`.
- **Survey evidence:** https://flowfuse.com/node-red/getting-started/editor/workspace/ ; https://blog.comfy.org/p/comfyui-035-frontend-updates (verified)
- **Repo check:** Only structural containment exists (viewstate.isContainer, store.condense() collapsible container nodes in src/condense-anim.js); no free rectangular/organizational group primitive independent of containment was found in src or types/index.d.ts.

### 5. Freeform text/sticky-note annotations placed anywhere on canvas

- **Category:** rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** n8n canvas; Node-RED editor; Blender; Unreal Blueprints
- **What they offer:** n8n: Shift+S drops a draggable, Markdown-formatted, color-pickable sticky note anywhere on the canvas (docs.n8n.io/workflows/components/sticky-notes/); Node-RED has comment nodes; Blueprints/Blender support comment boxes around node clusters.
- **Why it matters here:** sparkle-motion-visualizer only has a single caption overlay (one narration line, top/bottom, role=status) — there's no way to pin multiple independent free-floating annotations near specific nodes/regions, which a process-diagram narration tool would want for 'why this branch exists' style notes that persist alongside the diagram (not just a transient caption during playback).
- **How it could fit:** Could extend GraphSpec with `annotations: [{id, x, y, w, h, text, color}]`, rendered as simple rects+text, participating in bounds()/fitView() but not layout ranking; storyboard op `{op:'annotate', ...}` for animated reveal.
- **Survey evidence:** https://docs.n8n.io/workflows/components/sticky-notes/ (verified)
- **Repo check:** No 'sticky'/'annotation'/'comment' node concept in src/, types/index.d.ts, or README.md; only a code-comment at src/run.js:175 unrelated to UI notes.

### 6. Minimap / navigator overlay

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js (rete-minimap-plugin); ComfyUI
- **What they offer:** A small always-visible thumbnail of the whole graph in a corner, showing a viewport rectangle and letting the user click/drag inside it to jump the main view; ComfyUI's minimap preserves node size/position and group colors and handles collapsed/grouped nodes gracefully.
- **Why it matters here:** sparkle-motion-visualizer has fitView()/zoomBy()/anchor() for programmatic navigation but no persistent spatial-overview widget — on a large graph (its own culling threshold of 150+ elements implies it expects large graphs) a viewer has no at-a-glance sense of where they are relative to the whole structure.
- **How it could fit:** Could ship as an official optional preset (matching the existing presetPipeline contract) reading g.bounds()/g.layoutResult() and viewport.screenToWorld/worldToScreen — no core engine changes needed, fits the plugin/preset seam already documented.
- **Survey evidence:** https://retejs.org/docs/api/rete-connection-plugin/ (plugin list) ; https://blog.comfy.org/p/comfyui-035-frontend-updates (verified)
- **Repo check:** docs/research/ux.md:64 and docs/PLAN.md:693 discuss minimap only as an unbuilt 'optional preset'/'hypothetical' idea; no minimap implementation exists in src/.

### 7. Right-click context menu for node/edge creation and actions

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js (rete-context-menu-plugin); litegraph.js; Drawflow; ComfyUI; Blender; Unreal Blueprints
- **What they offer:** Right-clicking canvas/node/edge opens a contextual menu (add node, delete, duplicate, convert to reroute, add to group, etc.); Rete.js ships this as a dedicated official plugin with renderer bindings for every supported framework.
- **Why it matters here:** sparkle-motion-visualizer's knownLimits explicitly state no context menu support — for any interactive authoring workflow (as opposed to purely programmatic spec construction) this is a basic expected affordance that's entirely absent.
- **How it could fit:** Natural preset-layer addition (like the minimap) rather than a core change: a preset listening to a custom DOM contextmenu handler and calling existing g.addNode/removeNode/addEdge methods.
- **Survey evidence:** https://retejs.org/docs/guides/context-menu/ (verified)
- **Repo check:** grep for contextmenu/context menu across src and docs found nothing; interact.js only wires pointerdown/pointerup/pointercancel for tap-toggle.

### 8. Full undo/redo command stack

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js (rete-history-plugin); Node-RED editor (RED.history); Drawflow; n8n canvas; ComfyUI; Blender; Unreal Blueprints
- **What they offer:** An event-sourced history of editor actions (add/delete/move/edit) that can be stepped backward/forward, typically bound to Ctrl+Z/Ctrl+Y; Node-RED's RED.history is a well-documented internal module.
- **Why it matters here:** sparkle-motion-visualizer has no undo/redo of structural edits at all — g.batch() is explicitly non-transactional with no rollback, and there's no history stack; every cohort tool treats this as baseline authoring-time functionality.
- **How it could fit:** Could layer on top of the existing GraphEventMap (add/remove/update/expand/collapse/condense/split are already emitted) by recording inverse operations per event type and exposing g.undo()/g.redo(); distinct from batch()'s atomicity gap since this is about user-facing edit history, not transactional commit.
- **Survey evidence:** https://retejs.org/docs/api/rete-connection-plugin/ (plugin list) ; https://flowfuse.com/node-red/getting-started/editor/workspace/ (verified)
- **Repo check:** README.md:136 explicitly states the library 'never undoes an add/remove/update' — mutations are one-way; no history module comparable to RED.history exists in src/.

### 9. Copy/paste (including cross-tab/cross-instance paste via serialized clipboard JSON)

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** litegraph.js; Drawflow; ComfyUI; Node-RED editor; Blender; Unreal Blueprints
- **What they offer:** Selected nodes+edges can be copied and pasted (often via the OS clipboard as serialized JSON), including duplicating within the same graph or pasting into a different editor instance; ComfyUI/litegraph support Ctrl+C/Ctrl+V of node subgraphs.
- **Why it matters here:** With no multi-select and no clipboard concept, sparkle-motion-visualizer has no way for an interactive user to duplicate a subgraph pattern; this compounds the multi-select gap above.
- **How it could fit:** Would build naturally on the multi-select gap: g.selection() -> g.copy() returning a portable JSON fragment -> g.paste(fragment, {at}) reusing addNode/addEdge under the hood.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** No clipboard/copy/paste code in src/ or README.md; the library's mutation surface is programmatic (g.addNode/removeNode via spec calls), not a UI clipboard operation.
- *Verifier's phrasing of the claim:* Copy/paste (clipboard JSON) of nodes/edges

### 10. Execution highlighting / live debug flow overlay while running

- **Category:** execution / rendering · **Fit:** 1/5 · **Verified in repo:** `partial`
- **Who has it:** Node-RED editor (status LEDs, debug sidebar); n8n canvas (node execution status rings, data pinning); Unreal Blueprints (execution wire pulse during Play-In-Editor); ComfyUI (running node highlight/progress bar)
- **What they offer:** While a flow/blueprint actually executes, the editor highlights the active node/wire in real time (n8n shows colored status rings and item counts on each node post-run; Unreal pulses the white execution wire as control flow passes through nodes during PIE; ComfyUI shows a green progress border and queue position on the currently-processing node).
- **Why it matters here:** sparkle-motion-visualizer already has a comparable and arguably more sophisticated feature (token pulses, traversed-edge width, data-status/data-run attributes) — this is NOT a gap, listed here only to confirm the inventory's execution/token engine already covers the cohort's equivalent and no action is implied. Excluded from gap count intent — kept only as a boundary check, fitScore reflects 'already covered, do not treat as gap'.
- **How it could fit:** n/a — already covered by Mode A/B token engine + data-run/data-status/data-traversed.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** src/director.js implements a scripted highlight(sel) 'emphasis state' (line 220) and docs/RECORDING.md describe cue-driven highlight/camera ops, but this is authored/scripted via API calls for a recorded storyboard, not automatic live status-ring/progress-border overlay driven by actual node execution telemetry as in n8n/ComfyUI/Unreal.

### 11. Search / find-node-by-name with jump-to-node

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Node-RED editor; n8n canvas; ComfyUI; Rete.js community presets
- **What they offer:** A search box (often Ctrl+F or a dedicated sidebar) that filters/searches nodes by label/type and pans+zooms the canvas to the match; Node-RED has a global search across the whole flow tab set; n8n has a node-search palette (also used for the 'add node' picker, reused as an on-canvas finder).
- **Why it matters here:** On a large graph (which the library's own 150+-element culling design implies is a real target), there is no way to locate a specific node by name — g.node(id)/g.nodes(filter) is a read-only query, not a UI affordance that pans the camera to the result.
- **How it could fit:** Thin wrapper: a preset that does g.nodes(predicate) then viewport.anchor()/fitView() to frame the match(es) — no core API change needed beyond what already exists (g.nodes, fitView).
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** query.js provides programmatic nodes(filter)/edges(filter) for scripting, but there is no UI search box or camera-jump-to-match feature; director.js camera targeting is scripted (via highlight/camera calls), not driven by an interactive search UI.

### 12. Node search/insertion palette (double-click canvas or drag-from-panel to add a node)

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js; litegraph.js; Drawflow; Baklava.js; Node-RED editor (drag from palette); n8n canvas (node panel); ComfyUI (double-click search); Unreal Blueprints (right-click 'add node' search)
- **What they offer:** A discoverable UI for adding new node types to the canvas — dragging from a categorized side palette (Node-RED, n8n) or double-clicking empty canvas to open a fuzzy-searchable node-type picker (ComfyUI, Blueprints).
- **Why it matters here:** sparkle-motion-visualizer's addNode() is purely programmatic (spec-driven); there is no interactive 'what node types exist, let me add one' affordance, consistent with the library's design as an embeddable visualization/narration tool rather than a full authoring IDE — flagged as a gap for completeness but likely intentionally out of scope.
- **How it could fit:** Out of scope for a visualization library unless the project pivots toward being an authoring tool rather than a renderer of externally-authored specs.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** Nodes are only added programmatically via g.addNode()/spec mutation (see README mutation API section); no side palette or canvas double-click picker UI exists in src/ or demo/.
- *Verifier's phrasing of the claim:* Node search/insertion palette (drag-from-panel or double-click to add)

### 13. Reroute / pass-through routing nodes for taming long edges

- **Category:** data model / rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** litegraph.js; ComfyUI (Reroute node)
- **What they offer:** An invisible or minimal single-in/single-out node purely for bending a long connection's path around clutter; ComfyUI's built-in Reroute node has untyped in/out and a right-click toggle between horizontal/vertical routing.
- **Why it matters here:** sparkle-motion-visualizer's edge routing is layered bend-chain polylines computed entirely by the engine with no user-insertable manual routing waypoint; on especially cluttered graphs a caller can't manually declare 'route this edge via here' the way ComfyUI users do.
- **How it could fit:** Low priority given the engine already auto-computes bend chains; could be an escape hatch via edge.data.waypoints consumed by rendering only (not the layout solver).
- **Survey evidence:** https://docs.comfy.org/built-in-nodes/Reroute (verified)
- **Repo check:** No reroute node type or bend-only routing primitive in types/index.d.ts NodeSpec/EdgeSpec or src/path.js; path.js computes edge bend geometry automatically from layout, not via user-placed reroute nodes.
- *Verifier's phrasing of the claim:* Reroute / pass-through routing nodes

### 14. Node/graph-level pinning of intermediate data for iterative dev ("pin data")

- **Category:** execution / authoring · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** n8n canvas
- **What they offer:** n8n lets a user freeze/pin a specific node's output data so re-running the workflow during development skips re-executing that node and reuses the pinned value.
- **Why it matters here:** Not directly applicable to sparkle-motion-visualizer's read-only-of-external-execution model (Mode A/B don't compute real outputs), but conceptually adjacent to an authoring-time convenience (e.g. pin a token/run state at a node while iterating on a storyboard) that doesn't exist today.
- **How it could fit:** Speculative fit; would need a 'freeze this node's run status during Mode A recompute' concept layered onto run.seek()/recompileRun, not clearly demanded by current architecture.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep for 'pin' across src/docs/types shows only unrelated usages (componentOrder 'pins' a layout slot, docs/RECORDING.md 'pinned fonts'); no per-node data-freeze/skip-execution concept exists — the library has no execution/run-skip model at all.
- *Verifier's phrasing of the claim:* Node/graph-level pinning of intermediate data ('pin data')

### 15. Node version pinning / per-node semantic versioning with upgrade prompts

- **Category:** data model · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** n8n canvas
- **What they offer:** n8n tracks a typeVersion per node instance so workflows keep working against older node behavior even as the node type's implementation evolves, surfacing an 'update available' affordance in the UI.
- **Why it matters here:** Not really applicable — sparkle-motion-visualizer nodes are pure visualization data, not executable typed components with their own versioned implementations; included only because it surfaced in cohort research, marked very low fit.
- **How it could fit:** Out of scope.
- **Survey evidence:** from memory (not independently re-confirmed via docs this pass) (from memory / unverified)
- **Repo check:** No typeVersion or per-node-instance versioning field in types/index.d.ts NodeSpec; only whole-package version pinning is discussed (scripts/check-doc-versions.mjs checks README/docs package version strings), unrelated to per-node versioning.

### 16. Collapsible 'subgraph' node created interactively from an arbitrary user selection (not just programmatic condense())

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** ComfyUI ('Collapse to Subgraph'); Unreal Blueprints (Collapse to Function/Collapse Nodes)
- **What they offer:** User selects any set of nodes+edges and one command bundles them into a single collapsible subgraph/function node, fully editable by expanding again; ComfyUI explicitly supports selecting nodes, groups, and reroutes together for this.
- **Why it matters here:** sparkle-motion-visualizer's condense() exists and is powerful (with a convexity guard and staged choreography) but is purely programmatic — there's no interactive trigger for a human operator to do this from a live selection, tying back to the missing multi-select primitive.
- **How it could fit:** Directly buildable once multi-select exists: a preset/context-menu action calling g.condense(selection.ids(), {...}) — condense() itself needs no change.
- **Survey evidence:** https://blog.comfy.org/p/comfyui-035-frontend-updates (verified)
- **Repo check:** g.condense() (src/condense-anim.js, store.condense()) does bundle a set of source nodes into a single collapsible/expandable container node with an animated choreography — but sources are supplied programmatically as an id list argument to condense(), not chosen via an interactive canvas multi-select gesture (no selection UI exists, per the multi-select finding above).
- *Verifier's phrasing of the claim:* Collapsible subgraph created interactively from arbitrary user selection

### 17. Multiple typed/categorized edge styles distinguishing data-flow vs control-flow wires

- **Category:** data model / rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Unreal Blueprints (white exec pins/wires vs colored data pins/wires); Node-RED (implicit single wire type, but colored by connected node category)
- **What they offer:** Blueprints draws a structurally distinct thick white 'execution' wire (control flow, sequential) separate from thin colored 'data' wires (value flow) on the same node, both native concepts in the visual language.
- **Why it matters here:** sparkle-motion-visualizer's edges are a single undifferentiated kind (aside from the loop:true boolean and weight); a pipeline-narration tool depicting both control flow and data dependencies would have no built-in way to visually distinguish the two edge classes beyond ad hoc props()/style() overrides.
- **How it could fit:** Could be handled entirely with existing data-* on edges plus CSS, or formalized as an edge.kind enum with default styling — largely coverable today via props()/style(), so a soft gap.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** EdgeSpec in types/index.d.ts and store.js model a single homogeneous edge kind; no execution-wire vs data-wire distinction found in render.js/styles.js beyond general theming (checked EdgeSpec fields and styles.js for a 'kind'/'flowType' discriminator — none present).
- *Verifier's phrasing of the claim:* Multiple typed/categorized edge styles distinguishing data-flow vs control-flow

### 18. Node resize (user-draggable resize handle on a node, e.g. for comment boxes or preview nodes)

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** litegraph.js; Drawflow; ComfyUI; Blender; Unreal Blueprints
- **What they offer:** Certain node types (comment/reroute-adjacent, image-preview nodes) expose a corner drag-handle to resize the node's box independent of its content.
- **Why it matters here:** sparkle-motion-visualizer sizes nodes deterministically from measured text (src/measure.js) with w/h as computed/declared fields; there's no interactive resize handle since layout is fully computed, consistent with its 'no manual dragging' limitation — same root cause as the drag-node gap.
- **How it could fit:** Only relevant if manual positioning (gap above) is ever added; otherwise out of scope by design.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** src/render.js:418 comment references nodes 'resizing' only in the sense of automatic layout-driven size changes ('edges stay attached while nodes resize'), not a user-facing drag-handle; no resize-handle interaction code found in interact.js.
- *Verifier's phrasing of the claim:* Node resize (user-draggable resize handle)

### 19. HTML/DOM-embedded custom node bodies (widgets: sliders, dropdowns, live previews inside a node)

- **Category:** rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Rete.js (framework renderers let node bodies be full React/Vue/Svelte components); Baklava.js (Vue-rendered custom node interfaces: number/select/checkbox widgets); litegraph.js/ComfyUI (widgets: combo boxes, sliders, image previews embedded directly in node body); Node-RED (node config forms, though those're on a side panel not inline)
- **What they offer:** Node bodies can host arbitrary interactive form controls or live content (an image thumbnail, a slider, a live-updating value) rendered by the host framework, not just a label/status box.
- **Why it matters here:** sparkle-motion-visualizer is explicitly pure SVG with rounded-rect boxes only, no node shapes beyond rounded rects, no HTML/foreignObject node bodies documented — for pipeline nodes that might want to show a live thumbnail or parameter widget inline, this is unavailable; likely an intentional simplicity tradeoff given the size-budget goals (<50KB gzip).
- **How it could fit:** Could be exposed narrowly via SVG <foreignObject> injection through the existing g.style()/g.props() override layer, but conflicts with the deterministic-measurement/culling/theming architecture and the strict size budget — genuinely a harder fit than most gaps here.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** render.js renders pure SVG (rect/text/path elements); no foreignObject or innerHTML usage found via grep across src/, so no interactive form-control/slider/thumbnail widgets can be hosted inside a node.
- *Verifier's phrasing of the claim:* HTML/DOM-embedded custom node bodies (widgets)

### 20. Comment/documentation node as a first-class graph node type (not just an overlay caption)

- **Category:** data model · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Node-RED (comment node type); Baklava.js (community comment-node examples); Blender/Unreal (comment/frame boxes around node clusters)
- **What they offer:** A dedicated non-executing node type whose sole purpose is holding freeform documentation text, placed inline in the graph and participating in the same drag/select/save flow as functional nodes.
- **Why it matters here:** Overlaps with the annotations gap above but framed as a first-class *node* rather than a separate canvas layer — sparkle-motion-visualizer has neither; every node in its data model is implicitly an executable/visual pipeline step.
- **How it could fit:** Could be modeled as a regular Node with a reserved data.kind:'comment' convention plus a preset renderer, needing no core schema change since NodeSpec already allows arbitrary passthrough keys.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** types/index.d.ts NodeSpec has no comment/note node kind; grep for comment/annotation node concepts across src/types/README found nothing matching a non-executing documentation node type.
- *Verifier's phrasing of the claim:* Comment/documentation node as first-class graph node type

### 21. Force-directed / radial / grid layout algorithm options

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** litegraph.js (community layout add-ons); Baklava.js (community); general graph-viz ecosystem, referenced as design contrast to the cohort's mostly-manual-layout norm
- **What they offer:** Alternative automatic layout families beyond layered/Sugiyama — force-directed for organic clustering, radial for hub-and-spoke, grid/snap-to-grid for dense regular graphs.
- **Why it matters here:** Already an explicit, acknowledged knownLimit in the inventory ('Layered/Sugiyama-style only'); listed here only as cohort corroboration that some node-editor ecosystems do offer alternate layout modes as plugins, not as a new discovery — low incremental value since the inventory already flags this.
- **How it could fit:** n/a — already documented as a known limit; solver seam already supports plugging in alternates.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** src/layout.js header (lines 1-18) states the library ships only a layered/Sugiyama-style engine (src/engine.js) plus an equivalent @dagrejs/dagre adapter (src/adapters) — grep for force/radial/grid in layout.js found no such alternative algorithm families.

## Borrowable ideas

- Rete.js's plugin-per-concern architecture (rete-connection-plugin, rete-context-menu-plugin, rete-history-plugin, rete-minimap-plugin, rete-auto-arrange-plugin, rete-readonly-plugin) — sparkle-motion-visualizer's preset system could similarly ship official optional preset packages (minimap, search, context-menu) rather than leaving everything to custom presets.
- n8n's Shift+S 'sticky note' pattern — a single keyboard shortcut that drops a free-floating annotation directly on the canvas at the cursor, draggable behind nodes for grouping — much lighter-weight than the caption overlay for ad hoc narration notes.
- ComfyUI's 'Collapse to Subgraph' one-click conversion of a multi-select into a reusable subgraph node (analogous to condense() but user-initiated from a selection rather than programmatic) — worth citing as a UX pattern even though sparkle-motion-visualizer's condense/split is programmatic-only by design.
- Node-RED's RED.history event-sourced undo/redo model (typed events: add/delete/move/edit, replayable) is a clean shape to borrow if undo/redo is ever added — it composes naturally with sparkle-motion-visualizer's existing diff/commit model.
- Blender's node-editor color-coded socket types (a distinct color per data type on every socket) is a strong, low-cost visual-language idea even without adding real typed ports — could be approximated via data-* driven edge/handle coloring.
- Unreal Blueprints' inline execution-flow 'pulse' along wires during PIE (play-in-editor) debugging is conceptually very close to sparkle-motion-visualizer's token/pulse system already — worth studying their pacing/easing for the traversed-edge visual.
- litegraph.js/ComfyUI's reroute node (an invisible/minimal pass-through node purely for bending a long edge) is a cheap, generally useful primitive for taming visual clutter on wide DAGs.
- n8n's node 'pin data' (freeze a node's output value for repeat testing without re-executing upstream) is a nice authoring-time affordance; a Mode A analog could be 'pin token state' at a node during scrub/dev iteration.

## Survey notes

Research done via WebSearch for version/license/feature confirmation on Rete.js, litegraph.js, Drawflow, Baklava.js, Node-RED, n8n, ComfyUI. n8n's canvas is an app feature, not a redistributable library, so no independent npm version applies — its license claim is from memory and flagged unverified. Blender and Unreal are design references per the task brief, not JS libraries, so no npm/license research applies beyond confirming their own product licensing for completeness. Feature claims for interaction/editing (sockets, subflows, groups, comments, undo, copy/paste, minimap, execution highlighting) are drawn from official docs/GitHub pages found in search plus well-established prior knowledge of these widely-documented OSS projects; items not directly hit by a search snippet are marked verified:false in the gap list below and described as "from memory" in evidence.
