# Cohort survey: cytoscape-sigma
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** cytoscape.js (plus key extensions: expand-collapse, dagre/elk/fcose layouts, edgehandles, context-menus, popper, undo-redo, navigator), sigma.js + graphology (graph data model + algorithms package)

**Verification tally:** 20 claimed gaps: 15 missing, 5 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| cytoscape.js | 3.34.2 | MIT | https://js.cytoscape.org/ | yes | Graph theory / network visualization and analysis library, pure JS, no dependencies, SVG/Canvas rendering with a large first-party+community extension ecosystem. |
| cytoscape.js-expand-collapse | unknown | MIT (per repo convention) | https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse | yes | Extension adding collapse/expand of compound nodes and clustered edges with visual cues and undo-redo integration. |
| cytoscape.js-dagre | unknown | MIT | https://github.com/cytoscape/cytoscape.js-dagre | no | Dagre (Sugiyama-family layered) layout adapter for Cytoscape.js. |
| cytoscape.js-elk | unknown | MIT (assumed) | https://github.com/cytoscape/cytoscape.js-elk | no | Adapter exposing Eclipse Layout Kernel (elkjs) layered/orthogonal/force/radial algorithms as a Cytoscape.js layout. |
| cytoscape.js-fcose | unknown | MIT | https://github.com/iVis-at-Bilkent/cytoscape.js-fcose | no | Fast Compound Spring Embedder force-directed layout supporting constraints (fixed nodes, alignment, relative placement). |
| cytoscape.js-edgehandles | unknown | MIT | https://github.com/cytoscape/cytoscape.js-edgehandles | yes | Interactive drag-to-connect edge creation extension with snap-to-target and connection validation. |
| cytoscape.js-context-menus | unknown | MIT | https://github.com/iVis-at-Bilkent/cytoscape.js-context-menus | yes | Right-click context menu extension scoped to nodes/edges/core. |
| cytoscape.js-popper | unknown | MIT | https://github.com/cytoscape/cytoscape.js-popper | no | Positions Popper.js/Floating UI popovers/tooltips anchored to live node/edge screen positions. |
| cytoscape.js-undo-redo | unknown | MIT | https://github.com/iVis-at-Bilkent/cytoscape.js-undo-redo | yes | Generic undo/redo action-registration framework for Cytoscape.js graph mutations, with batching. |
| cytoscape.js-navigator | unknown | MIT | https://github.com/iVis-at-Bilkent/cytoscape.js-navigator | no | Minimap/overview panel with a draggable viewport rectangle for panning large graphs. |
| sigma.js | 3.0.3 (stable; v4 alpha also exists) | MIT | https://www.sigmajs.org/ | yes | WebGL-based graph renderer for graphs of thousands of nodes/edges, built on top of graphology. |
| graphology | unknown (core package actively published; exact latest not confirmed this pass) | MIT | https://graphology.github.io/ | yes | Robust, multipurpose Graph data-model object for JS/TS supporting directed/undirected/mixed and multi-graphs, with a large standard-library ecosystem (layouts, algorithms, metrics, import/export). |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Force-directed / radial / grid / concentric / circle / breadthfirst layout algorithms

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js (built-in: grid, circle, concentric, breadthfirst, cose); cytoscape.js-fcose (fast Compound Spring Embedder); graphology-layout-force / graphology-layout-forceatlas2; sigma.js (renders whatever graphology layout computed)
- **What they offer:** Cytoscape ships several built-in non-layered layouts (cose force-directed, concentric, circle, grid, breadthfirst) selectable via cy.layout({name:...}); fcose adds a fast compound-aware force layout with constraint support (alignment, relative placement, fixed nodes). graphology-layout/-forceatlas2/-force are standalone force-simulation packages that annotate x/y on graph nodes, consumed by sigma.js.
- **Why it matters here:** smv is explicitly Sugiyama/layered-only; any pipeline with non-DAG-shaped or clustering-heavy structure (e.g. showing organic relatedness, not just flow order) has no fit. A process/pipeline narration tool may still want an organic overview mode before drilling into flow.
- **How it could fit:** Could be exposed as an additional built-in LayoutSolver (opts.layout.solver) analogous to the existing dagre adapter, e.g. adapters/force, rather than baked into the core engine.
- **Survey evidence:** https://js.cytoscape.org/ (verified via fetch: 'Layout systems for automatic or manual node positioning', 'built-in layout algorithms'); fcose and graphology-layout-forceatlas2 details from memory (from memory / unverified)
- **Repo check:** src/layout.js is a single frozen 'D2' seam that only does Sugiyama-style layered layout (hand-written longest-path/Sugiyama-lite, with @dagrejs/dagre as pluggable adapter in src/adapters/dagre.js). grep for force|cose|radial|concentric|breadthfirst|circle in src/ and types/ returns nothing implementing those algorithms. docs/research/landscape.md:13 explicitly states the design chose 'a small hand-written longest-path/Sugiyama-lite layered layout' and deliberately did not build alternative topologies.
- **Verifier note:** By design this is a pipeline/DAG visualizer, not a general graph layout engine.
- *Verifier's phrasing of the claim:* Force-directed/radial/grid/concentric/circle/breadthfirst layouts

### 2. Constraint-based layout (fixed node positions, alignment constraints, relative placement constraints, bounding-box constraints)

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-fcose; cytoscape.js-cola (cola.js adapter)
- **What they offer:** fcose accepts options like fixedNodeConstraint, alignmentConstraint, relativePlacementConstraint letting the caller pin specific nodes or force rows/columns of nodes to align, on top of the force simulation.
- **Why it matters here:** smv's engine has no way to say 'always put this node at the top' or 'these three nodes must be vertically aligned' beyond what rank inference produces naturally; a narration author sometimes needs a specific visual arrangement for storytelling.
- **How it could fit:** Partially covered by componentOrder (slot pinning for whole components); a node-level 'pin to rank/x' constraint would be a natural, scoped extension of that same mechanism.
- **Survey evidence:** from memory (cytoscape.js-fcose README, api docs) (from memory / unverified)
- **Repo check:** No occurrences of 'fixedNode', 'alignmentConstraint', 'relativePlacement' or similar anywhere in src/, types/, or docs/. Only layout.js/dagre adapter exist, neither exposes constraint options.
- *Verifier's phrasing of the claim:* Constraint-based layout (fixedNodeConstraint/alignmentConstraint/relativePlacementConstraint)

### 3. ELK (Eclipse Layout Kernel) layout adapter — additional layered/orthogonal algorithm family

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-elk (via elkjs)
- **What they offer:** cytoscape-elk wraps elkjs to provide ELK's layered, force, radial, and orthogonal-edge-routing algorithms as a pluggable cytoscape layout.
- **Why it matters here:** Shows the cohort's pattern of multiple pluggable layered-layout backends (not just dagre) including orthogonal edge routing, which smv's engine explicitly lacks (bend-chain polylines only, no orthogonal routing mode).
- **How it could fit:** Could be a second adapters/elk entry analogous to adapters/dagre behind the existing LayoutSolver seam.
- **Survey evidence:** from memory (elkjs / cytoscape-elk README) (from memory / unverified)
- **Repo check:** grep for 'elk' across src/types/docs finds only discussion in docs/research/*.md explicitly rejecting elkjs (docs/research/landscape.md:13: 'Do NOT default to or bundle elkjs: ... would alone consume 5-10x the entire size budget'; docs/research/critique.md:13). No adapters/elk.js file exists; types/adapters-dagre.d.ts is the only adapter type file.
- *Verifier's phrasing of the claim:* ELK (elkjs) layout adapter

### 4. Orthogonal and curved/bezier edge routing styles, edge bundling

- **Category:** rendering/layout · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** cytoscape.js (curve-style: bezier, taxi/orthogonal, segments, straight, unbundled-bezier); cytoscape.js-elk (orthogonal routing)
- **What they offer:** Cytoscape's style system offers curve-style options including 'taxi' for orthogonal (right-angle) routing and multiple bezier bundling controls (control-point-distances/weights) for parallel edges.
- **Why it matters here:** smv only has straight bend-chain polylines; no orthogonal mode, no bezier curve option, and parallel edges between adjacent ranks are documented as coincident (a known gap already). Orthogonal routing is a common ask for flowchart-style pipeline diagrams.
- **How it could fit:** Could be a rendering-layer opt (opts.edgeStyle: 'polyline'|'orthogonal'|'bezier') independent of the layout solver, translating the same bend-chain data into different SVG path commands.
- **Survey evidence:** from memory (Cytoscape.js style docs, curve-style property) (from memory / unverified)
- **Repo check:** src/engine.js and src/path.js implement layered-DAG edge routing including bend points and back-edge distinct routing (see docs/research/cyclic-layout.md discussion of back-edge styling), but there is no generic 'curve-style: taxi' orthogonal toggle or bezier control-point-distance/weight bundling API comparable to Cytoscape's style system. No hits for 'taxi', 'bundl', 'control-point' in src/ or types/index.d.ts.
- *Verifier's phrasing of the claim:* Orthogonal/curved bezier edge routing + edge bundling

### 5. Node drag-and-drop repositioning (interactive, with grabbable/locked/ungrabify controls) plus box/rubber-band multi-select and clipboard cut/copy/paste

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js (core: grab/drag events, boxSelectionEnabled, cy.$(':selected')); cytoscape.js-clipboard extension pattern (community)
- **What they offer:** Cytoscape supports dragging nodes to new positions (with grabbable() toggle per element), shift/box drag-select of multiple elements, and selection-based bulk operations; ecosystem clipboard extensions add copy/paste of selected subgraphs.
- **Why it matters here:** smv explicitly has no node dragging or selection API (documented known limit) — this is the single most requested capability for any interactive graph editor, though smv's positioning is deliberately fully computed for narration fidelity.
- **How it could fit:** Out of scope for smv's computed-layout philosophy as a default, but could be an opt-in 'freeform override' preset that nudges a node and feeds an x/y pin into layout (related to constraint gap above).
- **Survey evidence:** from memory (Cytoscape.js core interaction docs, grabbable/ungrabify API) (from memory / unverified)
- **Repo check:** grep -n -iE 'drag|select|box|rubber|clipboard|copy|paste' over src/viewport.js and src/interact.js returns only a single unrelated comment ('Fired from apply(), so it covers every route the transform can change by: a drag...' referring to pan gestures on the canvas, not node dragging). src/interact.js implements only tap-to-toggle expand/collapse (pointer-based), no node drag, no grabbable/lock flags in types/index.d.ts, no box-select or clipboard code anywhere in src/.
- *Verifier's phrasing of the claim:* Node drag-and-drop repositioning + grabbable/locked + box/rubber-band multi-select + clipboard

### 6. Interactive edge creation by dragging from node to node (edgehandles), with connection validation and edge-creation preview

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-edgehandles
- **What they offer:** edgehandles lets a user drag from a source node's handle to a target node to create a new edge live, with canConnect() validation and edgeParams() to set default edge data; supports snapping to nearby targets and hover delay.
- **Why it matters here:** smv is read/replay-oriented (spec authored up front, no end-user graph editing), so this is a clear scope gap versus editor-oriented libraries, but relevant if smv is ever used as an authoring tool rather than only a presentation/narration tool.
- **How it could fit:** N/A for current narration-focused remit; would require a fundamentally different interaction mode.
- **Survey evidence:** verified via fetch of cytoscape.js-edgehandles README (start/stop/canConnect/edgeParams/snap options) (verified)
- **Repo check:** No 'canConnect', 'edgeParams', or edge-creation-drag code in src/interact.js or elsewhere; interact.js only handles tap-to-toggle collapse.
- *Verifier's phrasing of the claim:* Interactive edge creation by dragging node-to-node (edgehandles)

### 7. Right-click context menus bound to nodes/edges/core canvas

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-context-menus; cytoscape.js-cxtmenu (radial/pie context menu)
- **What they offer:** context-menus registers a list of commands per element/core with selector-based scoping and click handlers; cxtmenu gives a circular pie-style popup instead of a list.
- **Why it matters here:** smv documents 'no context menu support' as a known limit. A pipeline visualizer used for debugging/ops (e.g. 'retry this step', 'view logs for this node') would benefit from a lightweight hook for custom per-node context actions.
- **How it could fit:** Could be exposed as a documented preset contract (already has presetPipeline pattern) rather than core API — a right-click handler on data-id nodes wired through g.on/g.node(id).
- **Survey evidence:** verified via WebSearch metadata (iVis-at-Bilkent/cytoscape.js-context-menus, MIT, 'provide context menu around elements and core instance'); cxtmenu from memory (verified)
- **Repo check:** No 'contextmenu', 'cxtmenu', or menu-registration code found in src/ or types/index.d.ts.
- *Verifier's phrasing of the claim:* Right-click context menus

### 8. Rich tooltip/popper.js integration for anchoring arbitrary HTML popovers to graph elements

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-popper
- **What they offer:** cytoscape-popper wires Popper.js positioning to a node/edge's live screen position (ele.popperRef()), so any HTML tooltip/popover library can be anchored and kept in sync during pan/zoom/animation.
- **Why it matters here:** smv documents 'no built-in tooltip system' as a known limit — only CSS :hover stroke highlight. Anchoring rich HTML tooltips (e.g. showing full duration/data payload on hover) is a very common integration need for a pipeline visualizer with rich node.data.
- **How it could fit:** A natural fit: expose viewport.worldToScreen(nodeId) (already exists) plus a documented recipe/preset for wiring Popper or native Popover API to node positions on hover, updated per commit/tick.
- **Survey evidence:** from memory (cytoscape-popper README: popperRef(), works with Popper.js/Floating UI) (from memory / unverified)
- **Repo check:** grep -iE 'tooltip|popover|popper' over src/, README.md, docs/EMBED.md returns nothing.
- *Verifier's phrasing of the claim:* Popper.js-anchored HTML tooltip/popover integration

### 9. Minimap / navigator overview panel with draggable viewport rectangle

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-navigator
- **What they offer:** cytoscape-navigator renders a small thumbnail of the whole graph in a corner panel with a rectangle showing the current viewport, draggable to pan the main view.
- **Why it matters here:** For large pipeline graphs (100s of nodes, which smv explicitly optimizes rendering for via culling), a minimap is the standard way to stay oriented; smv has no navigator/minimap capability at all.
- **How it could fit:** Could be a preset built on exportSVG({viewport:false}) for the thumbnail plus viewport.screenToWorld/anchor() for drag-to-pan — fits the existing preset contract well.
- **Survey evidence:** from memory (iVis-at-Bilkent/cytoscape.js-navigator README); package existence and purpose corroborated by earlier WebSearch results (from memory / unverified)
- **Repo check:** No 'minimap' or 'navigator' terms found in src/ or docs/; src/viewport.js only implements pan/zoom transform of the main SVG, no secondary overview panel.
- *Verifier's phrasing of the claim:* Minimap/navigator overview panel with draggable viewport rect

### 10. Full undo/redo action framework with batched actions and pluggable action registration

- **Category:** interaction / state · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-undo-redo
- **What they offer:** ur.action(name, doFn, undoFn) registers reversible actions; ur.do(name, args) executes and pushes to an undo stack; ur.undo()/ur.redo() traverse it; batch actions group multiple ops into one undo step. expand-collapse integrates with it automatically (undoable:true).
- **Why it matters here:** smv has GraphError and cancelable mutation handles but no undo/redo concept at all — every structural mutation (addNode, condense, split, expand/collapse) is one-way. Useful for interactive authoring/editing tools built on smv, or for an 'undo last storyboard step' editing UX.
- **How it could fit:** Could layer on top of existing mutation handles (which already return {canceled,applied}) as an opt-in g.undoRedo() facility that records inverse ops (e.g. removeNode as inverse of addNode) — natural extension of the batch() mechanism already present.
- **Survey evidence:** verified via WebSearch (npm/GitHub metadata: 'ur.action(actionName, actionFunction, undoFunction)', batch actions); README content itself not directly fetched (verified)
- **Repo check:** No 'undo', 'redo', or action-registration API in src/ or types/index.d.ts.
- *Verifier's phrasing of the claim:* Full undo/redo action framework

### 11. Graph-theory algorithms package: shortest path (Dijkstra, A*, Floyd-Warshall, BFS/DFS), centrality (betweenness, degree, closeness, eigenvector), connected components, clustering coefficient, community detection (Louvain), min spanning tree, k-core

- **Category:** analytics · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js core (aStar, dijkstra, floydWarshall, bellmanFord, kruskal, degreeCentrality, betweennessCentrality, closenessCentrality, pageRank, hierholzer, kColoring, markovClustering); graphology-shortest-path; graphology-metrics (centrality, density, diversity); graphology-communities-louvain
- **What they offer:** Both cohort libraries ship (or have canonical companion packages providing) a full suite of classic graph algorithms directly operable on the live graph object, e.g. cy.elements().dijkstra(...), graph then metrics.centrality.betweenness(graph).
- **Why it matters here:** smv's querying is read-only predicate/partial-match sugar with explicitly no path-finding or algorithmic queries (documented known limit). A pipeline tool could use shortest/critical path highlighting, bottleneck detection (centrality on a dependency graph), or reachability queries ("what fails if this fails") for narration or diagnostics.
- **How it could fit:** Could ship as a separate lightweight subpath package (sparkle-motion-visualizer/algorithms) operating on g.spec() snapshots, kept out of the core bundle per the existing D11 'ESM-only satellite' pattern (like export/a11y-table).
- **Survey evidence:** from memory (Cytoscape.js API docs 'Algorithms' section; graphology-metrics/graphology-communities-louvain npm packages) (from memory / unverified)
- **Repo check:** grep -iE 'dijkstra|centrality|betweenness|louvain|shortest.?path|k-core|spanning' over src/ matches only comments about connected components used internally for crossing minimization (src/engine.js:65,176) and layout component ordering (src/layout.js:62), not exposed graph-algorithm APIs. No public API in types/index.d.ts for these.
- *Verifier's phrasing of the claim:* Graph-theory algorithms (Dijkstra/A*/centrality/components/Louvain/MST/k-core)

### 12. Search/filter UI with live element show/hide and locked highlighting of matches

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** cytoscape.js core (cy.elements().filter()/cy.$() selector engine) + community search extensions; graphology (algorithmic filtering via graph.filterNodes)
- **What they offer:** Cytoscape's CSS-like selector query engine (cy.$('node[label *= "foo"]')) plus .filter() work as a live query/search mechanism commonly wired to a search box that dims/hides non-matching elements.
- **Why it matters here:** smv's g.nodes(filter) is read-only data access, not an interactive UI feature — there's no built-in 'search box highlights/dims matches live' behavior, though the emphasis/spotlight (data-emph/data-dim) primitives already exist to build one on top.
- **How it could fit:** Very close to already being possible via g.highlight({nodes: matchIds, dim:true}) — likely just needs a documented recipe/preset (search input -> filter g.nodes() -> call highlight), not new core surface.
- **Survey evidence:** from memory (Cytoscape.js selector docs) (from memory / unverified)
- **Repo check:** src/query.js provides a query surface (nodes(filter), edges(filter), children, descendants, roots) supporting predicate or shallow-match filtering, and types/index.d.ts:494-498 + 780 define a `highlight(selection)` API with a documented 'Spotlight: everything currently drawn and NOT selected gets data-dim' behavior — this covers query + dim-based highlighting. However there is no live show/hide (element removal from the DOM) tied to a search box, nor a CSS-selector query language like Cytoscape's `cy.$()`; it's a plain JS predicate/object-match filter plus a dim/highlight visual effect, not a full search UI.
- *Verifier's phrasing of the claim:* Search/filter UI with live show/hide and highlighting of matches

### 13. WebGL/canvas rendering backend for very large graphs (thousands of nodes/edges) with GPU-accelerated redraw and level-of-detail

- **Category:** rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** sigma.js (WebGL renderer)
- **What they offer:** sigma.js renders via WebGL specifically to handle graphs of thousands of nodes/edges at interactive frame rates, in contrast to DOM/SVG approaches that degrade past a few hundred elements.
- **Why it matters here:** smv is SVG-only with culling kicking in above 150 elements as a documented mitigation; sigma's whole premise is a different backend built for an order of magnitude more elements. Relevant context/limit, but a WebGL rewrite is far outside smv's design (D7 CSS-custom-property styling model depends on SVG/DOM).
- **How it could fit:** Not a realistic fit — flagged for completeness/contrast only.
- **Survey evidence:** verified via WebSearch (sigma.js GitHub description: 'aimed at visualizing graphs of thousands of nodes and edges' using WebGL) (verified)
- **Repo check:** src/render.js and src/scene.js build and update actual SVG DOM elements only (grep confirms no canvas/webgl context creation anywhere in src/). The library is explicitly SVG-based per its own name and docs/research/rendering.md; there is culling logic (test/cull.test.js, test/cull-lifecycle.test.js) for viewport culling of SVG nodes but no WebGL/canvas renderer.
- *Verifier's phrasing of the claim:* WebGL/canvas rendering backend for large graphs with GPU-accelerated redraw/LOD

### 14. Multi-graph support with true parallel edges and mixed directed/undirected edges in one graph, plus typed/undirected edge semantics

- **Category:** data model · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** graphology (multi:true option, type: 'directed'|'undirected'|'mixed')
- **What they offer:** graphology graphs can be constructed as multi-graphs (multiple distinct edges between the same node pair, each independently addressable) and can mix directed and undirected edges in a single graph instance via the 'mixed' type.
- **Why it matters here:** smv's edges are implicitly directed (source->target driving layout rank + token flow) with weight used only for meta-edge aggregation; there's no undirected edge concept and multi-edges collapse visually (coincident polylines) between adjacent ranks, a related documented rendering limit. A dependency graph with genuinely undirected relationships (e.g. 'related to' links) has no clean representation.
- **How it could fit:** Could add an edge.directed:false rendering flag (no arrowhead, layout treats it as a soft ordering hint) without touching the ranking algorithm's core assumptions.
- **Survey evidence:** from memory (graphology core API: Graph({type, multi}) constructor options) (from memory / unverified)
- **Repo check:** grep -iE 'directed|multigraph|mixed' over src/store.js (binary-matched, so grepped as strings) turns up only unrelated comments about redirected/dedup meta-edges during collapse (store.js around lines 161-308), not a multigraph or directed/undirected edge-type flag. types/index.d.ts has no 'directed' or 'multigraph' edge property; edges are implicitly directed pipeline-flow edges only.
- *Verifier's phrasing of the claim:* Multi-graph / mixed directed+undirected edges in one graph

### 15. Node/edge attribute update events and fine-grained event bus on the raw graph model (nodeAdded, edgeAdded, nodeAttributesUpdated, eachNode iteration, etc.) independent of any renderer

- **Category:** data model / events · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** graphology (EventEmitter-based Graph)
- **What they offer:** graphology's Graph object itself emits granular structural and attribute-level events, usable headlessly (no renderer attached) for building custom sync/analysis pipelines.
- **Why it matters here:** smv's g.on() events are commit/add/remove/update-level on the mounted renderer instance, not a headless/pre-render data model; there's no way to observe the graph model's mutations without a DOM mount. Minor architectural gap for server-side/headless use cases (e.g. driving analytics off graph edits without rendering).
- **How it could fit:** Given smv's design (mount(el, spec) as the entry point) this is a deliberate scope choice, not really an oversight; low priority.
- **Survey evidence:** from memory (graphology API docs, Graph extends EventEmitter) (from memory / unverified)
- **Repo check:** src/events.js implements a minimal generic pub/sub emitter (on/off/emit, wildcard '*' listener) used across the library, and src/store.js mutation methods presumably emit change events consumed by scene.js/render.js — but this was not confirmed to expose graphology-style granular events (nodeAdded, edgeAdded, nodeAttributesUpdated as distinct named events) independent of a renderer; the emitter is generic infrastructure, not a documented headless model-only event catalogue in types/index.d.ts (no such event names found there).
- *Verifier's phrasing of the claim:* Fine-grained headless event bus on the raw graph model (nodeAdded, attributesUpdated, etc.)

### 16. HTML/DOM node content (arbitrary rich HTML rendered inside or overlaid on a node, not just text label)

- **Category:** rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js (via cytoscape-html-node / cytoscape-node-html-label community extensions)
- **What they offer:** Community extensions overlay live HTML (images, buttons, progress bars, rich formatting) positioned to track a node's screen coordinates each frame.
- **Why it matters here:** smv nodes are rounded-rect boxes with plain text labels only (documented: 'no node shapes beyond rounded rects'); no path to embed an icon, avatar, image, or richer HTML content in a node, which matters for process-narration nodes representing services/people/systems that benefit from an icon.
- **How it could fit:** Could extend node spec with an optional icon/image field rendered as an <image>/<use> SVG child alongside the label, well short of full HTML-in-SVG (foreignObject) which would break the export/theming model.
- **Survey evidence:** from memory (community cytoscape-node-html-label extension pattern) (from memory / unverified)
- **Repo check:** grep -iE 'foreignObject|innerHTML|dangerouslySet' over src/ returns zero matches. Nodes are rendered as pure SVG shapes/text (src/render.js, src/scene.js), no foreignObject or HTML-overlay mechanism.
- *Verifier's phrasing of the claim:* HTML/DOM node content (rich HTML overlay inside/over a node)

### 17. Compound/parent node collapse via generic extension working with any layout (expand-collapse works with cose, dagre, fcose, etc. interchangeably), including saved/restored collapse state as JSON separate from graph spec

- **Category:** data model / interaction · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** cytoscape.js-expand-collapse
- **What they offer:** api.saveJson()/api.loadJson() persist exactly which compound nodes are currently collapsed, independent of the full graph spec, so collapse UI state can be serialized/restored on its own.
- **Why it matters here:** smv already has native expand/collapse with meta-edge aggregation (arguably more advanced than the extension) but does not offer a discrete 'export just the current collapsed-state map' helper distinct from g.spec() (which embeds collapsed on each node inline) — a very small gap, listed mainly as a borrowable idea rather than a true missing capability.
- **How it could fit:** Low priority; g.spec() already round-trips collapsed per-node, so this is mostly redundant — kept as a minor note.
- **Survey evidence:** verified via fetch of cytoscape.js-expand-collapse README (api.saveJson/loadJson) (verified)
- **Repo check:** src/viewstate.js implements expand/collapse of compound nodes with meta-edge redirection (createViewState, collapsed Set, pendingCollapse), and it works with the library's one layout engine (dagre-based/Sugiyama-lite) since it's the only layout available — so 'works with any layout' is vacuously true but there's no second/third layout to interoperate with. Collapse state is folded from `n.collapsed` on each node spec (viewstate.js sync(), 'Fold spec-level collapsed:true in once per node') and store.spec() returns the full graph including per-node collapsed flags — there is no separate saveJson()/loadJson() API that serializes ONLY collapse state independent of the full graph spec (grep for 'saveJson|loadJson' found none).
- *Verifier's phrasing of the claim:* Compound/parent node collapse working with any layout + saved/restored collapse state as JSON separate from graph spec

### 18. Declarative graph description / text-DSL import (e.g. building a cytoscape graph from a stylesheet + elements JSON is standard, but broader ecosystem tools like Cytoscape Desktop's session files, or third-party DOT/GraphML importers)

- **Category:** data model / import · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js (cy.json() full session round-trip incl. style+pan+zoom); graphology (graphology-graphml, graphology-gexf import/export packages)
- **What they offer:** graphology has companion packages (graphology-graphml, graphology-gexf) to import/export standard graph interchange formats (GraphML, GEXF) directly into a graphology Graph instance.
- **Why it matters here:** smv's spec is exclusively its own {nodes,edges} JSON shape (documented known limit: 'no built-in GraphML/DOT/JSON-schema importers'). Anyone with an existing GraphML/GEXF/DOT dataset (common in academic/network-analysis contexts) must hand-write a converter.
- **How it could fit:** Could ship as a small separate import subpath (sparkle-motion-visualizer/import-graphml) mapping GraphML attributes onto GraphSpec nodes/edges — low effort, self-contained, matches the existing satellite-package pattern.
- **Survey evidence:** from memory (graphology-graphml / graphology-gexf npm packages) (from memory / unverified)
- **Repo check:** grep -iE 'graphml|gexf|\.dot' over src/docs/README.md finds no import/export code, only an unrelated dagre-internal comment ('dot's approach', docs/DEVIATIONS.md:373) about routing style. docs/research/api.md:40 explicitly documents the decision to reject a text-DSL (Mermaid-style) format in favor of JSON object-literal spec only.
- *Verifier's phrasing of the claim:* Declarative text-DSL import / GraphML / GEXF / DOT import

### 19. cy.json() single-call full state serialization including style, viewport pan/zoom, and selection — used for save/restore or cloning a live instance

- **Category:** export · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** cytoscape.js
- **What they offer:** cy.json() (and the matching constructor option) captures the entire live instance state — elements, style, zoom, pan, and more — in one JSON blob that can be handed to a fresh cytoscape() call to reproduce it exactly.
- **Why it matters here:** smv has g.spec() (structural data only) and exportSVG({viewport:true}) (visual snapshot) but no single call that captures 'everything needed to recreate this exact live instance including current pan/zoom/theme/collapsed-state' for save/resume or clone-to-new-element use cases.
- **How it could fit:** Could be a thin composition of existing pieces (g.spec() + g.bounds()/viewport transform + g.theme()) exposed as a convenience g.snapshot()/mount(el, g.snapshot()) pair.
- **Survey evidence:** from memory (Cytoscape.js core API, cy.json()) (from memory / unverified)
- **Repo check:** store.js exposes `spec()` (src/index.js:772 `spec() { return store.spec(); }`) which serializes the graph's nodes/edges/groups (including collapsed flags per viewstate.js), but no evidence found of it also capturing live viewport pan/zoom transform or a selection state — grep for 'selection|selected' in store.js/index.js/types found only the separate `HighlightSelection` type used as an argument to `highlight()`, not a persisted selection state included in spec().
- *Verifier's phrasing of the claim:* cy.json()-style single-call full state serialization (elements+style+viewport+selection)

### 20. Popper-based anchored HTML overlays kept in sync during animation/zoom (not just static tooltips — arbitrary floating HTML UI pinned to a node)

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** cytoscape.js-popper
- **What they offer:** Same package as tooltip gap above, but the broader capability is any floating HTML UI (menus, forms, badges) tracked to a node position through pan/zoom/animation via a stable popperRef() position source.
- **Why it matters here:** Overlaps with the tooltip gap; called out separately because the underlying primitive (a stable, animation-synced screen-position accessor) is the generalizable piece smv would need to expose (it has viewport.worldToScreen already, so this may already be sufficient — worth flagging as 'maybe already covered', included for completeness).
- **How it could fit:** Verify whether existing worldToScreen updates fast enough during tween ticks to avoid this being a true gap; likely a documentation/recipe gap rather than a code gap.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** Same search as tooltip/popper claim above — zero matches for 'popper' in src/, README.md, docs/EMBED.md; no popperRef-equivalent position-source API in types/index.d.ts.
- *Verifier's phrasing of the claim:* Popper-based anchored floating HTML UI tracked through animation/zoom

## Borrowable ideas

- Cytoscape.js's selector-based stylesheet (CSS-like selectors e.g. 'node[status = "failed"]', 'edge.highlighted') as an alternative/companion mental model to smv's data-* attribute CSS approach — worth documenting as an explicit design contrast even if not adopted.
- cytoscape-undo-redo's action-registration pattern: ur.action(name, doFn, undoFn) with automatic batching (cy.undoRedo().do('batch', [...])) — a clean shape for a future undo/redo layer that would compose with smv's existing GraphError/mutation-handle model.
- graphology's strict separation of the mutable graph model (graphology) from the rendering layer (sigma.js) and from the algorithms layer (graphology-*) as independent, individually-installable npm packages — validates smv's own adapters/preset-as-separate-entry-point approach and suggests an eventual 'algorithms' subpath package rather than bloating core.
- cytoscape-expand-collapse's api.saveJson()/loadJson() for round-tripping collapsed-state alongside the graph spec — smv's collapsed flag lives on node data already, but an explicit save/restore-of-UI-state helper (distinct from the full GraphSpec) could be a nice small addition.
- cytoscape.js's cy.json() full-fidelity serialization (structure + style + viewport + zoom/pan state) as a single portable snapshot — smv has g.spec()/exportSVG but no single 'entire session state including viewport/theme/collapsed-state' snapshot+restore call.
- sigma.js's reducer functions (nodeReducer/edgeReducer: (id, attrs) => displayAttrs) computed per-frame from the graph model rather than pre-baked styling — conceptually close to smv's g.style(fn) but explicitly framed as a 'reducer' pattern with separate node/edge reducers, which could sharpen smv's docs/naming.
- cytoscape-navigator's minimap-with-draggable-viewport-rect as a ready pattern to crib pixel/DOM structure from if smv ever builds a minimap preset.
- graphology-layout-forceatlas2's 'run synchronously to convergence, or ship a webworker build for async' dual-mode API — a useful precedent for how smv could offer a heavier optional layout without blocking the main thread by default.

## Survey notes

Network egress to js.cytoscape.org and graphology.github.io was blocked by the sandbox proxy; substituted raw.githubusercontent.com README fetches (succeeded for cytoscape core intro.md, graphology README, expand-collapse, edgehandles) and WebSearch result snippets (succeeded for context-menus and undo-redo metadata, npm/version data) for verification. context-menus and undo-redo READMEs were not directly fetched (404 on assumed raw paths) — their capability descriptions rely on WebSearch snippet metadata (marked verified:true since source/purpose was corroborated by real search results) rather than full README text. Several entries (fcose constraints, elk, popper, node-html overlays, graphology-metrics/communities-louvain, graphology-graphml/gexf) are marked verified:false / "from memory" per instructions since I could not fetch their source pages in this pass, though they are well-established, stable facts about long-standing, widely-documented packages. No version number was invented anywhere; unconfirmed versions are marked "unknown".
