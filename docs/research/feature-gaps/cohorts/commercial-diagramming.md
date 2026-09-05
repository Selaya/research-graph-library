# Cohort survey: commercial-diagramming
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** JointJS core + JointJS+ (commercial), GoJS, yFiles for HTML, Syncfusion Diagram — focus on what premium diagramming tiers offer (routing, ports, layouts, groups, undo/redo, palette, overview, printing, etc.)

**Verification tally:** 25 claimed gaps: 22 missing, 3 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| JointJS (core) | unknown | MPL-2.0 | https://www.jointjs.com/ | yes | Open-source (MPL-2.0) SVG diagramming library; foundation for JointJS+. |
| JointJS+ (Rappid) | unknown | Commercial, proprietary | https://www.jointjs.com/jointjs-plus | yes | Commercial superset of JointJS adding stencil, toolbar, snaplines, CommandManager (undo/redo), minimap, tooltip, context menu, property editor, layouts, import/export. |
| GoJS | unknown (2.x/3.x lines observed in search results, e.g. gojs@2.1.42 on unpkg; not independently confirmed as latest) | Commercial (proprietary; free trial/eval, per-developer pricing e.g. ~$3,995 individual perpetual as of last check) | https://gojs.net/ | yes | Commercial (non-OSS) JS/TS library for interactive diagrams: layouts, ports, palette, overview, undo/redo, table/tree nodes. |
| yFiles for HTML | unknown | Commercial, proprietary | https://www.yfiles.com/ | yes | Commercial high-end diagramming/graph-visualization SDK from yWorks: extensive layout algorithm library, edge routers, and graph analysis (centrality/clustering/paths). |
| Syncfusion Diagram (JS/EJ2) | unknown | Commercial (Syncfusion community license free tier for small teams/revenue, else paid) | https://www.syncfusion.com/javascript-ui-controls/js-diagram | yes | Commercial (Syncfusion Essential Studio) diagram component: symbol palette, overview panel, BPMN/flowchart shapes, print/export. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Interactive node dragging / manual repositioning

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS/JointJS+; GoJS; yFiles for HTML; Syncfusion Diagram
- **What they offer:** All four let end users drag nodes to reposition them (with optional snap-to-grid/snaplines in JointJS+ and Syncfusion), overriding or seeding the automatic layout.
- **Why it matters here:** This library's own docs flag 'no node dragging' as a known limit; for a narration/pipeline tool this is a deliberate tradeoff (deterministic recorded output), but it means any consumer wanting an editable canvas must go elsewhere.
- **How it could fit:** Could be added as an opt-in interaction mode that, on drag-end, records a per-node manual {x,y} pin consumed by the engine as a hard constraint on next layout — but conflicts with deterministic-recording guarantees (smv-record) unless disabled during capture.
- **Survey evidence:** from memory + JointJS+/GoJS/yFiles marketing pages describing drag-and-drop editing (verified)
- **Repo check:** src/interact.js only implements attachTapToggle (tap/click to expand/collapse a container node), gated by TAP_SLOP_PX; the viewport (src/viewport.js) only handles pan/zoom of the whole canvas via pointer capture. No code anywhere sets per-node drag translation or lets a mutation update x/y from a pointer gesture; layout.js/engine.js compute positions purely from the layered solver. Grepped src/, types/index.d.ts for 'drag' — only hits are unrelated comments about scrub/seek 'drag' on the timeline transport (src/transport.js:96, src/index.js:170,679).

### 2. Interactive edge creation / rewiring by dragging from a node or port

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS/JointJS+; GoJS; yFiles for HTML; Syncfusion Diagram
- **What they offer:** Users draw new links by dragging from a source node/port to a target; JointJS+ adds magnet/port snapping and obstacle-avoiding connection.
- **Why it matters here:** Pipeline/process editing tools commonly let a user sketch the graph interactively; this library only accepts a pre-built spec via addNode/addEdge API calls.
- **How it could fit:** Out of scope for a narration/playback library by design; would require a full interactive-authoring mode distinct from the current programmatic mount(el,spec) model.
- **Survey evidence:** WebSearch: JointJS+ comparison page, GoJS overview (verified)
- **Repo check:** No pointer handler builds or rewires edges; src/interact.js's only interaction is tap-to-toggle a container. Edge creation is exclusively programmatic via the store/index.js API (addEdge et al.). No 'port' or edge-drag code exists in src/.

### 3. Box/marquee select and multi-select with a selection API/state

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS/JointJS+; GoJS; yFiles for HTML; Syncfusion Diagram
- **What they offer:** Drag a rubber-band rectangle to select multiple nodes/edges; selection is a first-class, queryable/settable state used by other operations (delete, group, style panel).
- **Why it matters here:** Explicitly called out as a known limit here (g.nodes(filter) is read-only query sugar, not a selection concept). Even a narration tool could use selection for authoring-time convenience (e.g. building storyboard highlight ops by selecting nodes).
- **How it could fit:** Could live as an ESM-only optional preset (like exportSVG) exposing g.selection() get/set and emitting a 'selectionchange' event, without touching the core render/animation loop.
- **Survey evidence:** from memory; corroborated generally by JointJS+/GoJS/Syncfusion feature pages (verified)
- **Repo check:** No selection model found: grepped src/, types/index.d.ts for 'select'/'selection' with no hits beyond unrelated words. The only interactive/queryable state on the graph is viewstate.collapsed (a Set of collapsed container ids, types/index.d.ts:689) — not a node/edge selection concept, and there is no rubber-band/marquee code in src/interact.js or src/viewport.js.

### 4. Context menu (right-click) framework

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+; GoJS (via HTMLInfo/custom); Syncfusion Diagram
- **What they offer:** JointJS+ ships a ready-to-use context-menu UI component; Syncfusion and GoJS support building context menus tied to diagram elements.
- **Why it matters here:** Explicit known limit in the inventory ('No context menu support'). Would help consumer-built presets (e.g. right-click a node to jump to that step in the storyboard).
- **How it could fit:** Fits the existing preset contract: presetContextMenu(g, itemsFn) hooking g.on('commit') and native contextmenu events, no core changes needed.
- **Survey evidence:** WebSearch: JointJS+ features/comparison page (verified)
- **Repo check:** Grepped src/, types/, docs/ for 'context menu' / 'contextmenu' — zero hits anywhere in the repo (only shows up as a category label in docs/research landscape notes about other libraries, not this one).

### 5. Built-in tooltip system

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+ (ui.Tooltip); GoJS (Adornment-based tooltips); Syncfusion Diagram; yFiles for HTML
- **What they offer:** A managed tooltip component that shows on hover, positioned relative to the element, with templated content.
- **Why it matters here:** Explicit known limit ('No built-in tooltip system'). A narration tool showing token/duration/status detail on hover is a very natural fit.
- **How it could fit:** Could reuse the existing caption-overlay CSS pattern (role=status) generalized into a hover-positioned variant, shipped as an ESM preset rather than core (keeps IIFE budget).
- **Survey evidence:** WebSearch: JointJS+ ui.Tooltip docs (verified)
- **Repo check:** Grepped src/ and types/index.d.ts for 'tooltip' — no hits. The only 'tooltip' mention in the repo is docs/research/ux.md:43, a research note describing another product's UI (Temporal Web UI) as prior art, not a shipped feature.

### 6. Overview/minimap navigator panel

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** GoJS (Overview class); JointJS+ (minimap); Syncfusion Diagram (overview panel)
- **What they offer:** A small secondary view showing the whole diagram with a draggable viewport rectangle for quick navigation on large graphs.
- **Why it matters here:** Not present in this library; for large pipeline graphs with viewport culling already built (150+ element threshold), a minimap is a natural complementary navigation aid.
- **How it could fit:** Could be built entirely from existing public API: g.bounds()/g.layoutResult() for the world rect + viewport.screenToWorld/worldToScreen for the draggable box — a good candidate ESM preset, no core changes.
- **Survey evidence:** WebSearch: GoJS Overview class docs, Syncfusion overview panel docs (verified)
- **Repo check:** No minimap/overview component in src/. All mentions ('minimap') are in docs/PLAN.md:693 (listed as an explicit non-goal: 'renderer abstraction for a hypothetical canvas backend, minimap' left out of scope) and docs/research/*.md (research notes recommending it as a future optional preset, e.g. docs/research/ux.md:64 'minimap ... as optional preset components for large graphs, not core' and docs/research/critique.md:230 listing it among things to keep as future ESM-only optional entries). Nothing implements it.

### 7. Symbol/stencil palette for drag-and-drop authoring

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+ (Stencil); GoJS (Palette); Syncfusion Diagram (SymbolPalette)
- **What they offer:** A sidebar of draggable node/shape templates that create a new element on drop into the canvas.
- **Why it matters here:** This library has no interactive authoring surface at all (spec is built via JS calls only) — a palette is the standard 'build a diagram by hand' UX these commercial tools all offer.
- **How it could fit:** Would need a drag target wired to g.addNode(); plausible as an optional preset for consumer-built editors, but is a bigger lift than most gaps since it implies a general editing mode.
- **Survey evidence:** WebSearch: GoJS Palette class, Syncfusion Symbol Palette docs, JointJS+ Stencil plugin (verified)
- **Repo check:** Grepped src/, types/, docs/ for 'palette'/'stencil' — only research-doc mentions (docs/research/ux.md, docs/research/critique.md, docs/research/landscape.md) discussing other libraries' stencil features as prior art; docs/THEMING.md and docs/PRESETS.md hits are about CSS color 'palette' and preset styling, unrelated to a drag-and-drop shape sidebar. No such UI exists.

### 8. Undo/redo command history

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+ (CommandManager); GoJS (transactional undo/redo); Syncfusion Diagram
- **What they offer:** Unlimited-depth undo/redo of structural and property changes, transactional (grouped edits commit/rollback as one undo unit).
- **Why it matters here:** This library's g.batch() is explicitly non-transactional with no rollback — closest analog, but there's no undo concept at all for committed mutations (only in-flight tween cancel()).
- **How it could fit:** Could be layered on top of storyboard infrastructure: since every mutation is already a serializable op and g.spec() gives cheap snapshots, an opt-in history preset could record spec snapshots (or inverse ops) and expose g.undo()/g.redo(), reusing the animated-transition path for the replay.
- **Survey evidence:** WebSearch: JointJS+ CommandManager docs, GoJS transactional undo/redo (verified)
- **Repo check:** Grepped src/, types/index.d.ts for 'undo'/'redo' — every hit is either an unrelated code comment (e.g. src/index.js:88 'cancel() never undoes add/remove/update', src/index.js:519 'undoing a pan the reader made', src/index.js:785) or docs/PRESETS.md's presetPipeline decorator cleanup handle ('undo everything it did' = removing CSS/labels the preset added, not a graph edit history). There is no command-history/undo stack, no redo, and no batched transactional undo unit anywhere in src/store.js or src/index.js.

### 9. Node/element resizing by the user (interactive resize handles)

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+; GoJS; Syncfusion Diagram; yFiles for HTML
- **What they offer:** Drag handles on a selected node's corners/edges to resize it live, often with aspect-lock and min/max constraints.
- **Why it matters here:** Sizing here is entirely computed (measure.js + w/h passthrough); no interactive resize exists or is implied by current API.
- **How it could fit:** Out of scope given deterministic-layout design goal; would conflict with automatic text-measurement sizing unless resize became a data override consumed at layout time.
- **Survey evidence:** from memory, standard feature across all four vendors' editor UIs (verified)
- **Repo check:** The only 'resize' hit in src/ is src/render.js:418, a comment about clipping edges against per-frame rects 'so edges stay attached while nodes resize' during layout-driven animated transitions (auto layout changing a node's box over time) — not user-drag resize handles. No pointer-driven resize code exists in src/interact.js or elsewhere.

### 10. Ports as first-class, independently addressable connection points

- **Category:** data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS/JointJS+ (element.addPort/ports config); GoJS (GraphObject.portId, dynamic ports); yFiles for HTML (IPort/PortStyle); Syncfusion Diagram (connection points)
- **What they offer:** Named ports on a node, each with its own position/shape/markup, that edges attach to individually (not just the node as a whole); multiple edges can target distinct ports with independent routing per port.
- **Why it matters here:** Called out as an explicit knownLimit here ('No first-class ports — edges connect to whole nodes only'). For process diagrams with distinct in/out/error connectors this is a common modeling need.
- **How it could fit:** Could be added additively as node.ports[] (id, side, offset) purely for label/anchor-point purposes, with layout still treating the node as one box — a scoped, non-breaking extension of the existing 'edges attach node-to-node' model.
- **Survey evidence:** WebSearch: JointJS ports tutorials, GoJS port docs, yFiles IPort docs (verified)
- **Repo check:** Grepped src/*.js and types/index.d.ts for 'port' — zero real hits (the string never appears as a graph concept). Edges attach node-to-node only; there is no per-port markup/position/id and no way to target a specific port on a node (see NodeSpec/EdgeSpec shape in types/index.d.ts, which has no port field).

### 11. Multi-edge separation/bridging between the same node pair

- **Category:** rendering · **Fit:** 4/5 · **Verified in repo:** `partial`
- **Who has it:** JointJS (link bridging, jointjs.com router 'metro'/manhattan with gap); GoJS (parallel link routing); yFiles for HTML (ParallelEdgeRouter)
- **What they offer:** When two+ edges connect the same pair of nodes, these libraries fan them apart into visually distinct parallel paths, or draw a 'bridge' gap where one line crosses another so they read as separate.
- **Why it matters here:** Directly matches a documented knownLimit here: adjacent-rank parallel/multi-edges now render as coincident overlapping polylines (a capability explicitly lost vs. the old dagre-based approach, not planned to be fixed).
- **How it could fit:** A rendering-layer offset pass (perpendicular jitter per duplicate source/target pair) could fix this without touching the ranking solver, matching the doc's own suggested remediation path.
- **Survey evidence:** WebSearch: yFiles ParallelEdgeRouter docs; JointJS link bridging is well-known from memory (verified)
- **Repo check:** docs/DEVIATIONS.md:168-172 explicitly documents this as a regression versus the earlier dagre-based approach: 'One behaviour genuinely lost in the swap: parallel edges between the same adjacent-rank pair now get identical polylines... Multi-edges spanning two or more ranks still separate. Fanning coincident edges is a rendering concern, not a solver one, so it is not being added to engine.js.' So separation works for multi-rank-spanning parallel edges but not same-adjacent-rank parallel edges, and there is no bridging/crossing-gap feature at all.

### 12. Orthogonal / octilinear / bus-style edge routing as selectable routing styles

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** yFiles for HTML (EdgeRouter: orthogonal, octilinear, curved, bus); JointJS (router: 'orthogonal', 'manhattan', 'metro'); GoJS (LayeredDigraphLink, AvoidsNodes routing); Syncfusion Diagram (orthogonal connector routing)
- **What they offer:** Multiple distinct edge-path styles beyond straight/bend-chain polylines — right-angle-only orthogonal routing, 45-degree octilinear, curved bezier, or a shared 'bus' trunk line for multiple edges.
- **Why it matters here:** This library only offers layered bend-chain polylines and arcs for back-edges; there is no alternative routing style (e.g. strict orthogonal) a consumer could opt into for a more technical/schematic look.
- **How it could fit:** Fits the existing pluggable LayoutSolver seam conceptually but routing is currently baked into the engine's bend-chain output, not a separable stage — would need a new 'edge router' seam distinct from node placement.
- **Survey evidence:** WebSearch: yFiles EdgeRouter docs, JointJS router options (verified)
- **Repo check:** src/path.js only implements cubic Bezier sampling (sampleCubic) and Catmull-Rom polyline interpolation (catmullRom) for smoothing the layered layout's polyline edges — a single fixed routing style, not selectable. Grepped for 'orthogonal', 'octilinear', 'bus' routing terms across src/ and docs/ — no hits besides unrelated word fragments (e.g. 'bus' as in event bus in src/index.js/condense-anim.js).

### 13. Non-layered layout algorithm families: organic/force-directed, tree, radial, circular

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** yFiles for HTML (OrganicLayout, TreeLayout, CircularLayout, RadialLayout); GoJS (ForceDirectedLayout, TreeLayout, CircularLayout); JointJS+ (force-directed, tree, grid layouts)
- **What they offer:** Layout algorithm families beyond layered/Sugiyama: force-directed physics simulation, radial (concentric rings from a root), pure tree layout, circular/ring layout.
- **Why it matters here:** Explicit knownLimit here: 'Layered/Sugiyama-style only — no force-directed, radial, or other layout algorithm families.' Confirms this is a real, named gap versus all four cohort members.
- **How it could fit:** The existing solver seam (LayoutSolver = (input,opts)=>{nodes,edges,order,layers?,slots?}) could in principle host a force-directed or radial solver as a second adapter alongside the dagre one, though 'order/layers' fields are Sugiyama-specific and might need to be optional/ignored by non-layered solvers.
- **Survey evidence:** WebSearch: yFiles/GoJS layout algorithm lists; also directly confirms an existing documented knownLimit (verified)
- **Repo check:** src/layout.js exports a single `layout()` entry point wrapping the in-house layered engine (src/engine.js, `engineSolve`) or the optional dagre adapter (src/adapters/dagre.js) — both layered/Sugiyama-family. docs/research/layout.md (a research/planning doc, 2026-08-29) discusses a possible future 'force-directed fallback' using d3-force-equivalent code as an *estimate/recommendation*, explicitly not yet built ('Either vendor... or write an equivalent from scratch'). No radial, tree-only, circular, or force-directed algorithm exists in src/.

### 14. Graph analysis algorithms (shortest path, centrality, clustering/community detection)

- **Category:** analytics · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** yFiles for HTML (ShortestPath, BetweennessCentrality, ClosenessCentrality, PageRank, EigenvectorCentrality, Louvain/Label-Propagation/EdgeBetweenness/K-Means clustering)
- **What they offer:** A library of graph-theoretic analysis algorithms operable on the same graph model used for rendering — path finding, multiple centrality measures, and several clustering/community-detection algorithms.
- **Why it matters here:** Explicit knownLimit here: 'no path-finding, no graph-algorithm queries... no built-in cycle-listing API beyond internal FAS.' For a pipeline-narration tool, even basic shortest-path/critical-path-style analysis (e.g. 'longest path by duration') could feed captions/highlights.
- **How it could fit:** Could ship as a pure-function ESM subpath (sparkle-motion-visualizer/analysis) operating on g.spec(), matching the existing cues/fit precedent of tree-shakeable pure-function exports outside the core bundle.
- **Survey evidence:** WebSearch: yFiles graph analysis docs (Centrality Measures, Clustering pages) (verified)
- **Repo check:** src/query.js only provides structural read sugar: nodes(filter), edges(filter), children(id), descendants(id), roots() — simple containment/predicate queries, no path-finding, no centrality measures, no clustering/community detection. Grepped src/ for 'shortest', 'centrality', 'community', 'cluster' algorithmic terms — no hits (src/cycles.js only does cycle *detection* for layout validation, not general graph analysis).

### 15. Group/subgraph collapse with independent group-level styling and nested-group interactive UI (expand/collapse handles, group resize-to-fit)

- **Category:** rendering · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** GoJS (Group class, subgraph expander button); JointJS+ (grouping plugin); yFiles for HTML (folding/GroupNodeStyle); Syncfusion Diagram (group/expand-collapse)
- **What they offer:** Full group/subgraph model with a dedicated expander UI affordance, group-level padding/style independent of member nodes, and folding (nested group-of-groups) support with interactive collapse triggers on the group chrome itself.
- **Why it matters here:** This library does have compound/container nodes with animated expand/collapse (comparable capability), but the inventory notes container sibling-overlap is not fully solved and there's no described dedicated group-resize-to-fit-content interactive handle; largely already covered — listed for completeness/partial gap rather than a hard miss.
- **How it could fit:** Given substantial existing overlap, treat as low priority — mainly the interactive (not scripted) resize-to-fit / expander-button affordance would be new.
- **Survey evidence:** WebSearch: GoJS Group class, yFiles folding docs (verified)
- **Repo check:** Container/compound nodes with expand()/collapse()/expandAll()/collapseAll() are a real, first-class, tested feature (types/index.d.ts:14,23-24,693-697,745-758; interactive tap-to-toggle in src/interact.js) with animated bloom/converge transitions. But: (1) the only interactive collapse trigger is a tap/click anywhere on the container (no dedicated expander-handle affordance on the group chrome), (2) container padding is a single fixed CONTAINER_PAD constant (src/layout.js:37: top/side/bottom pixel padding) rather than independent per-group style/padding, and (3) no evidence of nested group-of-groups 'folding' semantics or independent group-resize-to-fit was found beyond the flat container-padding model — docs/DEVIATIONS.md:352-355 even flags a bug around nested container borders, suggesting nesting is a source of edge cases rather than a polished folding UI.
- *Verifier's phrasing of the claim:* Group/subgraph collapse with independent group-level styling and nested-group interactive UI

### 16. Print support (paginated diagram printing, multi-page tiling)

- **Category:** export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Syncfusion Diagram (print module); GoJS (print via browser + PrintDocument samples); JointJS+ (print plugin)
- **What they offer:** Dedicated print pipeline that tiles a large diagram across multiple printed pages with margins/scale control, distinct from plain image export.
- **Why it matters here:** Explicit knownLimit here: exportSVG/exportPNG exist but no PDF or print-specific pagination; consumers wanting a printable process document have no built-in path.
- **How it could fit:** Could be a thin ESM helper building on exportSVG({viewport:false}) plus a CSS @media print stylesheet and page-tiling math — doesn't need new core capability.
- **Survey evidence:** WebSearch: Syncfusion Diagram print/export docs (verified)
- **Repo check:** No print pipeline exists. src/export.js only offers exportSVG (serialize to SVG string) and exportPNG (browser canvas rasterization to a Blob) — single-image export, no page tiling, margins, or print-specific API. Grepped for 'print' across src/ and docs/ — only hits are console.log-style 'prints' (CLI messages) unrelated to diagram printing (e.g. docs/EMBED.md:102 'the CLI does not try to build it for you — it prints:').

### 17. PDF export

- **Category:** export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Syncfusion Diagram (native PDF export); JointJS+ (export plugin, PDF via server-side rendering)
- **What they offer:** Direct export of the diagram to a PDF file, not just raster/SVG.
- **Why it matters here:** Explicit knownLimit here: 'No other export formats documented (no PDF...)'.
- **How it could fit:** Feasible client-side via exportSVG + a PDF-embedding library, or server-side via smv-record's headless-Chromium pipeline extended to 'print to PDF'.
- **Survey evidence:** WebSearch: Syncfusion export docs listing PDF (verified)
- **Repo check:** src/export.js exports exactly exportSVG and exportPNG (confirmed via file header comment 'exportSVG / exportPNG (M2, D11)' and docs/EMBED.md:53/62, docs/INTERNALS.md:561-568). No PDF export path anywhere; grepped for 'pdf'/'PDF' in src/, docs/ — zero hits.

### 18. Clipboard copy/paste and duplicate of nodes/subgraphs

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+; GoJS (commandHandler copy/paste); Syncfusion Diagram
- **What they offer:** Standard OS-clipboard-integrated copy/cut/paste of selected elements, including keyboard shortcuts (Ctrl+C/V) and structural duplication with new ids.
- **Why it matters here:** No selection concept and no clipboard API exist in this library at all (confirmed absent from inventory); relevant mainly if any interactive-authoring surface is ever added.
- **How it could fit:** Depends on selection API existing first; otherwise out of scope for the current programmatic-only mutation model.
- **Survey evidence:** WebSearch: GoJS commandHandler docs (from memory of standard GoJS API), general knowledge (verified)
- **Repo check:** Grepped src/, types/, docs/ for 'clipboard' and 'copy...paste' — the only hits are docs/EMBED.md:3 and docs/INTERNALS.md:578 describing the library's own 'copy-paste' embed *recipe* (copying a code snippet into a page), not an in-diagram clipboard feature for nodes. No keyboard-shortcut handling or duplicate-with-new-ids API exists in src/interact.js, src/index.js, or types/index.d.ts.

### 19. Search/filter UI over the diagram (find node by label/data, highlight matches)

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** GoJS (samples demonstrate search-and-highlight); Syncfusion Diagram (search feature); JointJS+ (via custom UI on top of query API)
- **What they offer:** A built-in or ready-made search box that highlights/pans to matching nodes by label or data field.
- **Why it matters here:** This library's g.nodes(filter) supports query but there's no ready-made 'search UI' component or documented pattern connecting it to camera/highlight.
- **How it could fit:** Very buildable today as a thin preset: g.nodes({label: term}) + g.highlight({nodes}) + g.camera({nodes}) already compose this almost entirely — mostly a documentation/preset gap, not a core gap.
- **Survey evidence:** WebSearch: Syncfusion/GoJS search feature mentions; largely inferred, treat as lower-confidence (from memory / unverified)
- **Repo check:** Programmatic building blocks exist — src/query.js's nodes(filter)/edges(filter) predicate/match-object query API, and a director-level highlight(selection) API (types/index.d.ts:780, src/director.js:217-232, CONDENSE... highlight phase) that can visually emphasize a selection and is exposed as a storyboard op ({op:'highlight'}). But there is no shipped search-box UI component, no pan-to-match, and no label/data full-text search helper — a consumer would have to wire query()+highlight() together themselves. No 'search' string appears anywhere in src/ or types/index.d.ts as a feature.

### 20. Typed/multiple distinct edge kinds with per-type default styling (e.g. 'dependency' vs 'data flow' edge classes)

- **Category:** data model · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** yFiles for HTML (custom IEdgeStyle per edge type); JointJS (custom link types/subclasses, e.g. presets like BPMN sequence-flow vs message-flow); GoJS (Link.category-based templates)
- **What they offer:** A registered set of named edge/link 'types' each with its own default template/style, selected by a type key on the edge data, rather than per-edge inline overrides only.
- **Why it matters here:** This library has edge.data free-form + g.props()/style() overrides but no first-class 'edge type registry' concept comparable to GoJS's linkTemplateMap or JointJS's typed link classes.
- **How it could fit:** Could be layered as a small opts.edgeTypes map resolved in g.style()'s default resolution order, without changing the edge schema.
- **Survey evidence:** WebSearch/from memory: GoJS templateMap pattern, JointJS custom link subclassing (verified)
- **Repo check:** Checked types/index.d.ts EdgeSpec-equivalent shape and src/styles.js for a registered edge-type/kind system — found none; grep for '"kind"'/'edgeType' in types/index.d.ts returned no hits. Edges only carry generic per-edge style/props overrides (g.style()/g.props() per docs/USABILITY-EVAL.md:570), not a named, registered set of edge 'types' each with its own default template selected by a type key.
- *Verifier's phrasing of the claim:* Typed/multiple distinct edge kinds with per-type default styling

### 21. HTML/DOM-based node content (rich HTML forms, arbitrary embedded widgets inside a node, not just SVG shapes)

- **Category:** rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS (HTMLElement / dia.Element with HTML markup via foreignObject or overlay); GoJS (HTMLInfo for HTML tooltips/overlays; nodes generally still GraphObject-based); Syncfusion Diagram (HTML nodes)
- **What they offer:** Nodes whose visible content is real HTML (inputs, rich text, images, arbitrary widgets) rather than pure SVG shapes, positioned in sync with the diagram's pan/zoom.
- **Why it matters here:** Explicit knownLimit here: 'No node shapes beyond rounded rects... no custom shape system' and pure-SVG-only rendering; no HTML-in-node story at all.
- **How it could fit:** Would be a significant rendering-model change (foreignObject or an HTML overlay layer kept in sync with SVG transforms) — meaningfully bigger scope than a typical gap here, and in tension with the deterministic frame-recording pipeline (HTML overlay content must also be screenshot-stable).
- **Survey evidence:** WebSearch/from memory: JointJS HTMLElement shapes, Syncfusion HTML node docs (verified)
- **Repo check:** Grepped src/render.js and src/ broadly for 'foreignObject', 'innerHTML', or any DOM-widget mounting — no hits. Rendering is pure SVG (docs/PLAN.md:113: 'the SVG is the document'); nodes are SVG shapes/text only, no path to embed live HTML content synced to pan/zoom.
- *Verifier's phrasing of the claim:* HTML/DOM-based node content (rich HTML forms, arbitrary embedded widgets inside a node)

### 22. Constraint-based / incremental layout (fix a subset of node positions, relayout only the rest; alignment/distribution constraints)

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** yFiles for HTML (constraint incremental layout, ComponentLayout with fixed nodes); GoJS (incremental TreeLayout updates)
- **What they offer:** Layout that respects pinned/fixed node positions and only re-solves the remainder, or applies alignment/equal-spacing constraints between named nodes.
- **Why it matters here:** This library's engine does have order-stability/prevOrder persistence (a related but different guarantee — order stability, not position pinning), and componentOrder pins slot order but not literal coordinates; true per-node position constraints are not described.
- **How it could fit:** A natural extension of the existing componentOrder mechanism — could add a nodesPinned/constraints option to LayoutSolver input alongside componentOrder, since the engine already threads similar sticky state through mount().
- **Survey evidence:** WebSearch: yFiles incremental/constraint layout docs (verified)
- **Repo check:** src/layout.js/engine.js run a full layered-layout solve on every call; docs/research/layout.md discusses (as a *research recommendation*, not shipped) dagre v3.1's 'useDynamic' ordering-stability tie-breaker for a possible future engine, explicitly noting that even that only stabilizes ordering, not fixed pixel positions, and 'coordinate assignment... is a global pass recomputed every call.' No API to pin a node's position or apply alignment/equal-spacing constraints exists in types/index.d.ts or src/.
- *Verifier's phrasing of the claim:* Constraint-based / incremental layout (fixed positions, alignment constraints)

### 23. Snapping/alignment guides during interactive placement (snaplines)

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS+ (Snaplines plugin); Syncfusion Diagram (snapping); GoJS (grid snapping)
- **What they offer:** Visual alignment guides that appear when dragging an element near alignment with another element's edge/center, snapping into place.
- **Why it matters here:** Not applicable without interactive drag (which this library doesn't have); listed for completeness as a natural companion to any future drag feature.
- **How it could fit:** Depends entirely on adding interactive node dragging first — no standalone value otherwise.
- **Survey evidence:** WebSearch: JointJS+ Snaplines plugin page (verified)
- **Repo check:** Depends entirely on interactive dragging, which does not exist (see node-dragging finding above). No 'snap' code found in src/ (grepped alongside 'drag' with no relevant hits); nothing computes alignment guides.

### 24. URL/deep-link state serialization (encode current pan/zoom/selection/filter state into a shareable URL)

- **Category:** export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** GoJS (samples demonstrate saving diagram+viewport state to a query string / localStorage); Syncfusion Diagram (state persistence via saveDiagram/loadDiagram)
- **What they offer:** Serialize not just the graph spec but the current view state (camera position, expanded/collapsed set, active highlights) into a compact, restorable form (URL params, localStorage blob).
- **Why it matters here:** g.spec() gives structural state and g.storyboard/cues cover authored narration, but there's no documented 'current live view state' snapshot/restore API distinct from a storyboard step, useful for e.g. deep-linking to 'this exact pan/zoom/expand state' outside of storyboard playback.
- **How it could fit:** Could be a small helper: g.viewState() returning {camera, collapsed[], highlight} and g.restoreViewState(state) replaying it as a synthetic single storyboard step — reuses existing director-op machinery.
- **Survey evidence:** WebSearch: Syncfusion saveDiagram/loadDiagram docs mention serialization; GoJS state persistence is general knowledge, lower confidence on URL-specific pattern (from memory / unverified)
- **Repo check:** src/viewstate.js exists for the collapsed-container Set and internal state used for expand/collapse choreography, but grepped for 'URLSearchParams', 'location.hash', 'localStorage', 'serialize' view-state-to-URL patterns across src/ and docs/ — no hits. No API serializes pan/zoom/selection/filter to a shareable string; the library has no selection state to serialize in the first place (see marquee-select finding).
- *Verifier's phrasing of the claim:* URL/deep-link state serialization

### 25. Framework wrapper packages (official React/Angular/Vue components)

- **Category:** integration · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** JointJS for React (official); Syncfusion (React/Angular/Vue/Blazor Diagram packages); GoJS (community + some official React bindings via gojs-react)
- **What they offer:** First-party wrapper packages exposing the diagram as an idiomatic framework component (props, JSX, two-way binding) rather than an imperative DOM API only.
- **Why it matters here:** Confirmed absent here (knownLimit: 'No framework wrapper packages... integration is DOM-element + imperative API only'). Directly matches JointJS's own recent (2025-2026) investment in 'JointJS for React' as a flagship feature, suggesting real market demand.
- **How it could fit:** A thin wrapper package (e.g. a React component calling mount()/destroy() in effects, forwarding spec/opts as props) could be built without touching the core library at all — pure integration-layer work.
- **Survey evidence:** WebSearch: 'JointJS for React: Production-grade diagramming for React' blog/docs page (verified)
- **Repo check:** Grepped src/, types/, and package.json for 'React'/'Vue'/'Angular' — zero hits. package.json exports are plain ESM/IIFE subpaths only (src/index.js, src/export.js, adapters/dagre, preset-pipeline, a11y-table); README/docs/EMBED.md describe only a vanilla script-tag or npm+ESM imperative API, explicitly 'no framework, no build step' per the repo's own description. No first-party wrapper package exists.

## Borrowable ideas

- GoJS Overview class API shape (a second small linked viewport showing the whole graph + a draggable viewport rectangle) — sparkle-motion-visualizer could expose an `attachOverview(g, opts)` ESM-only preset mirroring the existing preset-pipeline contract, reusing exportSVG's bounds logic.
- JointJS+ CommandManager as a model: an opt-in undo/redo layer that simply records/replays the same storyboard-op vocabulary this library already has (addNode/removeNode/update/etc.) rather than inventing new primitives — 'undo' becomes 'play the inverse op' or 'restore prior spec()' snapshot.
- yFiles EdgeRouter family naming convention (OrganicEdgeRouter, ParallelEdgeRouter, SelfLoopRouter, BundledEdgeRouter) as a menu of pluggable *edge*-routing strategies distinct from node layout — this library's LayoutSolver seam only covers node placement; a parallel 'EdgeRouter' seam could fix the documented parallel-edge-coincidence limitation without touching the ranking solver.
- Syncfusion/GoJS SymbolPalette + drag-to-canvas as a lightweight preset: a `presetPalette(g, symbols)` that drag-drops a addNode() call, staying inside the existing preset contract ((g)=>{destroy()}) rather than becoming a new core concept.
- yFiles centrality/clustering algorithms exposed as pure, tree-shakeable functions operating on g.spec() (not baked into rendering) — matches this library's existing 'cues/fit as pure importable functions' pattern (sparkle-motion-visualizer/cues, /fit) and could ship as sparkle-motion-visualizer/analysis without touching the core bundle budget.
- JointJS+ port-based connection model (ports as named, positioned sub-elements with their own markup/tooltips) could be added additively as an optional `node.ports[]` array that layout treats as label metadata only (no routing change) — cheap accessibility/labeling win without committing to full port-aware routing.
- GoJS's link data-binding for routes ('save and load custom routes within Model JSON') suggests a pattern: let edge.data carry an optional manual waypoint override that the renderer honors verbatim, bypassing the engine's own bend-chain computation for that one edge — an escape hatch for a hand-tuned diagram without building a full interactive router.
- Syncfusion/GoJS keyboard shortcut tables (copy/paste, delete, arrow-nudge, ctrl+Z) as documentation precedent for extending this library's existing a11y arrow-key/Home/End/Enter vocabulary with a documented, overridable keymap object rather than hardcoded bindings.

## Survey notes

Version numbers for GoJS/yFiles/Syncfusion current releases could not be pinned precisely via search (search results surfaced older/mixed version signals, e.g. gojs@2.1.42 on unpkg) — reported as unknown/unverified per instructions rather than guessed. JointJS core license (MPL-2.0) and JointJS+ commercial status are well-established from memory and corroborated by search. All four are mature, long-established commercial-grade diagramming libraries whose 'premium tier' feature sets (interactive editing surface: drag/select/resize/context-menu/undo-redo/palette/overview/print, plus deep layout/routing algorithm libraries and graph analysis) are structurally the biggest gap category vs. sparkle-motion-visualizer, which is explicitly a read-mostly, storyboard-driven narration/playback library rather than an interactive diagram editor. Many gaps below are consequences of that intentional design split (this library computes layout, doesn't let users edit it) — fitScore reflects how much of that gap is still in-scope for a narration tool vs. fundamentally out of scope (interactive editing).
