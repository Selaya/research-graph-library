# Cohort survey: d3-and-layout-engines
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** d3 (d3-dag, d3-sankey, d3-hierarchy, d3-zoom, d3-drag, d3-transition, d3-force), dagre-d3, elkjs (ELK layout options: ports, orthogonal edge routing, layered/stress/mrtree/radial/disco, hierarchy handling, port constraints), cola.js (webcola constraints)

**Verification tally:** 20 claimed gaps: 17 missing, 3 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| d3-dag | 1.2.2 | MIT | https://github.com/erikbrinkman/d3-dag | yes | Layout algorithms (sugiyama, zherebko, grid) for directed acyclic graphs, decoupled layering/decrossing/coord stages |
| d3-sankey | 0.12.3 | ISC | https://github.com/d3/d3-sankey | yes | Computes node/link positions for Sankey flow diagrams (weighted flow between stages) |
| d3-hierarchy | 3.1.2 | ISC | https://github.com/d3/d3-hierarchy | no | Layout algorithms for rooted trees: tree, cluster, treemap, partition (icicle/sunburst), pack (circle packing) |
| d3-zoom | 3.0.0 | ISC | https://github.com/d3/d3-zoom | no | Pan/zoom behavior with configurable event filter, wheel-delta, scale extent, and zoom transform interpolation |
| d3-drag | 3.0.0 | ISC | https://github.com/d3/d3-drag | no | Drag-and-drop gesture behavior (mouse/touch unified), used for node dragging in force-directed graphs |
| d3-transition | 3.0.1 | ISC | https://github.com/d3/d3-transition | no | General-purpose declarative DOM transition engine with easing, chaining, interrupt, and selection-based tweening |
| d3-force | 3.0.0 | ISC | https://github.com/d3/d3-force | no | Velocity-Verlet force-directed layout simulation (charge, link, collide, center, x/y, radial forces) |
| dagre-d3 | 0.6.4 | MIT | https://github.com/dagrejs/dagre-d3 | yes | D3-based SVG renderer for dagre layouts: node shapes, edge paths/markers, clusters, zoom example |
| elkjs | 0.12.0 (also widely pinned at 0.9.x/0.10.x) | EPL-2.0 | https://github.com/kieler/elkjs | yes | JS/WASM port of the Eclipse Layout Kernel: layered/stress/mrtree/radial/force/disco algorithms, ports, orthogonal edge routing, hierarchical (nested) layout, constraints |
| WebCola (cola.js) | 3.4.0 | MIT | https://github.com/tgdwyer/WebCola | yes | Constraint-based force layout: alignment/separation constraints, non-overlap, group/containment, flow-direction constraints, VPSC/gradient-descent solver |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Ports / explicit connection points on nodes

- **Category:** data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** elkjs
- **What they offer:** ELK nodes can declare an array of 'ports' each with its own layoutOptions (side, index, position), and edges connect to a specific port rather than the node body; port constraints (FIXED_SIDE, FIXED_ORDER, FIXED_POS, FIXED_RATIO) control which sides/ordering are respected during layout.
- **Why it matters here:** A pipeline node with multiple distinct inputs/outputs (e.g. a join node with 'success'/'retry'/'timeout' outputs) currently has all edges converging on the same node boundary with no semantic distinction of where each connects; ports would let a fan-out/fan-in node visually organize its edges by meaning, which matters for narrating branching pipeline logic.
- **How it could fit:** Could extend NodeSpec with an optional ports:[{id,side?,order?}] array; edges reference sourcePort/targetPort; engine would need a port-aware bend-chain attachment pass analogous to the existing container entry/exit reattachment logic.
- **Survey evidence:** https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html and https://github.com/kieler/elkjs README (ports section) (verified)
- **Repo check:** grep for port-related APIs on the node/edge spec model (src/index.js, types/index.d.ts) finds none; the only 'port' hits are in docs/research/*.md discussing ELK's port model as background research, not implemented features. No node spec field for ports, no edge field for a port id.

### 2. Orthogonal (right-angle/Manhattan) edge routing

- **Category:** rendering/layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** elkjs
- **What they offer:** ELK's layered algorithm supports 'elk.edgeRouting: ORTHOGONAL' producing right-angle polyline edges with explicit bend points, as an alternative to the default splines/polylines; dagre-d3 also renders orthogonal-style stepped edges via its curve option.
- **Why it matters here:** Orthogonal routing is a common 'flowchart' visual convention distinct from the library's current diagonal bend-chain polylines; some pipeline/process diagram consumers expect strict right-angle edges for a schematic/wiring-diagram look.
- **How it could fit:** Could be a layout.edgeRouting:'diagonal'|'orthogonal' option consumed purely at the rendering/bend-interpolation stage since the engine already emits dummy-node bend points.
- **Survey evidence:** https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeRouting.html (verified)
- **Repo check:** grep -i 'orthogonal|manhattan' across src/types/README/docs turns up only unrelated uses of the word 'orthogonal' (meaning 'independent', e.g. src/director.js docs) and research notes about ELK's ORTHOGONAL option; src/path.js (edge path generation, 203 lines) implements only spline/curve routing, no right-angle polyline mode.

### 3. Multiple layout algorithm families (radial, tree, stress/force, disco, treemap, circle-pack, sankey)

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** elkjs; d3-hierarchy; d3-force; d3-sankey; d3-dag
- **What they offer:** ELK ships layered/stress/mrtree/radial/force/disco algorithms selectable per-subgraph; d3-hierarchy provides tree/cluster/treemap/partition/pack; d3-force provides general force-directed simulation; d3-sankey provides flow-proportional-width layouts.
- **Why it matters here:** sparkle-motion-visualizer is explicitly layered/Sugiyama-only; a radial or tree layout is a very different, often clearer, visualization for a shallow hierarchy or org-chart-shaped pipeline, and a Sankey-style width-by-weight layout would be a natural complement to the existing edge.weight aggregation concept for meta-edges.
- **How it could fit:** The pluggable LayoutSolver seam already exists (used by the dagre adapter); a first-party 'radial' or 'tree' adapter package could reuse that seam rather than the in-house engine growing new algorithm families itself.
- **Survey evidence:** https://github.com/kieler/elkjs README; https://github.com/d3/d3-hierarchy; from memory for d3-force/d3-sankey (verified)
- **Repo check:** src/layout.js and src/engine.js implement a single custom Sugiyama-style layered algorithm (own build, per docs/PLAN.md and docs/research/layout.md); docs/research/critique.md:143 explicitly rejects a force-directed fallback ('Force-directed fallback layout... undermines the determinism/mental-map property... Cut from v1 entirely') and docs/PLAN.md:31 lists 'force-directed physics' as an explicit non-goal. No radial/tree/stress/disco/treemap/pack/sankey algorithm exists anywhere in src/.

### 4. Constraint-based layout (alignment, separation, containment/grouping, non-overlap)

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** cola.js
- **What they offer:** WebCola lets callers declare explicit constraints — align a set of nodes on an axis, enforce minimum separation/gap, group nodes into a bounding container, or require a partial order — solved via VPSC alongside a force simulation.
- **Why it matters here:** The library's componentOrder option already pins block order; true alignment/grouping constraints (e.g. 'these three status nodes must sit on the same rank column regardless of the solver's normal ordering') would generalize that into an author-facing constraint layer for storyboard authors who need specific visual arrangements.
- **How it could fit:** Could surface as a lightweight opts.layout.constraints:[{type:'align'|'sameRank', ids, axis}] pre/post-pass on top of the existing engine rather than a full physics solver.
- **Survey evidence:** https://ialab.it.monash.edu/webcola/ ; https://github.com/tgdwyer/WebCola (verified)
- **Repo check:** src/engine.js:784 has a comment '// separation constraints after every move' referring only to same-rank node spacing within the custom layered engine — not a general VPSC-style solver with align/gap/group/partial-order declarations. Compound containment (parent/children) exists (src/query.js children/descendants, viewstate.js) but that's hierarchy nesting, not caller-declared alignment/separation constraints. No API for arbitrary alignment or grouping constraints was found.

### 5. Node dragging / manual repositioning

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** d3-drag; cola.js; dagre-d3 (via consumer wiring)
- **What they offer:** d3-drag provides unified mouse/touch drag gestures typically wired to force/cola nodes so users can grab and reposition a node; cola.js integrates this with its constraint solver so dragged nodes push/resolve against constraints live.
- **Why it matters here:** Explicitly listed as a known limit already (no node dragging/repositioning) — confirming it is a real, named gap versus this cohort where interactive repositioning is a first-class, commonly-demoed feature.
- **How it could fit:** Already documented as an intentional design choice (computed layout, not manual); any addition would need to decide how a drag interacts with animated relayout/order stability.
- **Survey evidence:** from memory (d3-drag docs; cola.js drag+constraint demos) (from memory / unverified)
- **Repo check:** src/interact.js (69 lines) implements only tap-to-expand/collapse of container nodes via pointer events (TAP_SLOP_PX gesture); no drag-to-reposition of nodes. grep for '\bdrag\b' in src/ hits only unrelated comments about viewport pan gestures and transport-bar scrubbing (src/viewport.js, src/transport.js), not node repositioning. docs/PLAN.md:32 explicitly lists 'graph *editing* UI (drag-to-connect)' as an excluded non-goal.

### 6. Minimap / graph navigator overview panel

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** dagre-d3 (community examples); elkjs (via consuming editors like Sprotty)
- **What they offer:** A small secondary rendering showing the whole graph with a viewport rectangle, letting users click/drag to jump the main pan/zoom elsewhere; common pattern built on top of d3-zoom transforms in dagre-d3-based apps.
- **Why it matters here:** On large pipeline graphs (150+ elements, where the library already does viewport culling) a minimap is the standard way to orient users; the library's viewport.fit/anchor/screenToWorld API already exposes the primitives a minimap would need but doesn't ship one.
- **How it could fit:** Could be an optional preset (matches the existing presetPipeline contract) rendering a scaled-down exportSVG-style view driven by g.bounds()/viewport events, not a core rendering feature.
- **Survey evidence:** from memory (common d3-zoom minimap pattern; not a documented built-in of any single cohort library) (from memory / unverified)
- **Repo check:** docs/research/critique.md:150 lists 'Minimap.' as a rejected/cut feature and docs/PLAN.md:693 lists 'minimap' among things cut from v1 ('registry, renderer abstraction for a hypothetical canvas backend, minimap...'). No minimap code in src/ or demo/.

### 7. Box/rubber-band selection and multi-select

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** cola.js (demo tooling); d3-drag (as a building block)
- **What they offer:** Drag-select a rectangular region to select multiple nodes at once, typically built from d3-drag plus hit-testing, used in cola.js's interactive editing demos.
- **Why it matters here:** Listed explicitly as a known limit (no multi-select/selection API); relevant if consumers want to build authoring tools (e.g. selecting nodes to condense(), or to apply a props() override to a batch) on top of the public API.
- **How it could fit:** Would sit above the existing g.nodes(filter) query sugar as a pure interaction-layer preset, not a core data-model change.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** No hits for 'rubber-band', 'box-select', 'multi-select', or 'lasso' anywhere in src/types/README/docs. src/interact.js only supports single-node tap toggle; no selection state or drag-rectangle hit-testing exists.

### 8. Force-directed simulation as a layout mode

- **Category:** layout · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** d3-force
- **What they offer:** d3-force runs an iterative physics simulation (charge/repulsion, link springs, collision, centering, x/y positional forces, radial forces) producing organic, non-hierarchical layouts, with forceSimulation().on('tick', ...) driving incremental redraws.
- **Why it matters here:** Explicitly out of the layered/Sugiyama-only family listed as a known limit; relevant for pipelines whose structure isn't naturally rank-ordered (e.g. peer-to-peer service meshes) though it's a poor fit for the library's narrative/deterministic-frame-recording goals since physics sims aren't naturally deterministic/replayable.
- **How it could fit:** Low priority given smv-record's deterministic-output requirement conflicts with iterative physics settling; would need a fixed-seed, fixed-iteration-count variant to stay reproducible.
- **Survey evidence:** from memory (d3-force API: forceSimulation, forceManyBody, forceLink, forceCollide, forceCenter, forceX/forceY, forceRadial) (from memory / unverified)
- **Repo check:** Same as the layout-families item: docs/research/critique.md:143 explicitly rejects a force-directed fallback layout as undermining the library's determinism/mental-map goals, and docs/PLAN.md:31 lists 'force-directed physics' as a stated non-goal for v1. No force simulation code (charge/link/collision/tick) exists in src/.

### 9. Sankey-proportional edge widths for flow diagrams

- **Category:** rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** d3-sankey
- **What they offer:** d3-sankey computes node heights and link widths proportional to flow value, with sankeyLinkHorizontal() generating smooth flow-ribbon paths between stages.
- **Why it matters here:** The library already has edge.weight for meta-edge aggregation rendering 'heavier line + badge' but not a true proportional-width flow rendering; a Sankey-style rendering mode would make aggregate throughput/volume visually legible in a condensed pipeline view.
- **How it could fit:** Could be a rendering-only alternate edge style (edgeStyle:'ribbon') keyed off edge.weight, reusing existing layered rank positions rather than a new layout algorithm.
- **Survey evidence:** https://github.com/d3/d3-sankey (verified)
- **Repo check:** No 'sankey' hits in src/ or types/; only mentions are in docs/research/landscape.md and PLAN.md as background survey of d3-sankey, not an implemented feature. Edge rendering (src/render.js, src/path.js) uses fixed-width stroked paths, no width-by-value encoding.

### 10. Independently swappable layering / crossing-reduction / coordinate-assignment stages

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** d3-dag
- **What they offer:** d3-dag's sugiyama() layout exposes .layering(), .decross(), .coord() as separately pluggable strategy functions (e.g. layeringLongestPath vs layeringCoffmanGraham; decrossTwoLayer vs decrossOpt; coordSimplex vs coordQuad), each independently swappable and even user-authorable to a documented interface.
- **Why it matters here:** sparkle-motion-visualizer's engine has a single pluggable LayoutSolver at the whole-algorithm granularity; d3-dag demonstrates a more surgical extension point letting consumers, say, keep the existing ranking/ordering but drop in an exact-crossing-minimization ILP solver for small graphs, or a different coordinate assignment for tighter/looser spacing — impossible today without replacing the entire engine.
- **How it could fit:** A finer solver seam (opts.layout.stages:{layering?,ordering?,coord?}) could sit alongside the existing whole-solver seam as an additive, non-breaking option.
- **Survey evidence:** https://github.com/erikbrinkman/d3-dag README (sugyiama layering/decross/coord API) (verified)
- **Repo check:** src/layout.js and src/engine.js implement one fixed custom layered algorithm; docs/research/layout.md describes the ordering/crossing-reduction approach as an internal, non-pluggable module ('mirrors dagre's order/ module... trimmed of dagre's full constraint-graph generality'). The only swap point exposed is the whole-solver level (src/adapters/dagre.js shows an alternate solver can be plugged in via {layout:{solver:dagreSolver}}), not independently pluggable layering/decross/coord functions like d3-dag's sugiyama().layering()/.decross()/.coord().

### 11. Zoom event filter / customizable trigger predicate

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** d3-zoom
- **What they offer:** d3-zoom exposes a .filter(fn) hook controlling exactly which pointer/wheel events initiate a zoom/pan gesture (default excludes right-click and non-primary buttons but is fully overridable), plus .wheelDelta(fn) to customize scroll sensitivity and .clickDistance()/.tapDistance() for click-vs-drag disambiguation.
- **Why it matters here:** The library hardcodes ctrl/cmd+wheel-only zoom and a fixed 6px tap-toggle slop as a deliberate default; consumers who want, say, plain-wheel zoom inside a modal/lightbox context (where page-scroll trapping is not a concern) have no supported override today.
- **How it could fit:** Could add interaction.zoomFilter(event)=>boolean and interaction.tapSlop(px) opts mirroring d3-zoom's filter/clickDistance without changing the safe default.
- **Survey evidence:** from memory (d3-zoom API: zoom.filter, zoom.wheelDelta, zoom.clickDistance) (from memory / unverified)
- **Repo check:** src/viewport.js implements hand-rolled pan/zoom (pointer drag for pan, wheel only with ctrl/cmd + pinch for zoom per docs/INTERNALS.md:139 'Zoom: wheel only with ctrl/cmd... + pinch'), which is itself a fixed trigger predicate baked into the implementation, but there is no exposed .filter()/.wheelDelta()/.clickDistance() hook for callers to customize which events trigger zoom — grep for 'wheelDelta|clickDistance|\.filter\(' against viewport.js/docs found nothing.

### 12. Cluster/hierarchical layout for ELK where a container's internal algorithm can differ from its parent's

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** elkjs
- **What they offer:** ELK supports per-subgraph layoutOptions so a compound node's children can be laid out with a different algorithm (e.g. outer graph 'layered', one container's children 'stress' or 'mrtree') in a single combined layout pass, hierarchy handled natively rather than via post-hoc translation.
- **Why it matters here:** The library's compound container layout is explicitly a 4-step choreography (child layout -> resize -> parent relayout -> translate) rather than one integrated hierarchical solve; ELK's native nested-algorithm support is a documented, more principled alternative to that acknowledged 'unresolved without a real nesting-graph approach' limit (sibling-rect overlaps).
- **How it could fit:** Out of scope for a quick fix — would likely require adopting ELK itself as an adapter (similar to the dagre adapter) rather than reworking the in-house engine's corridor-reservation approach.
- **Survey evidence:** https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html (verified)
- **Repo check:** Only one layout algorithm exists in the whole library (the custom layered engine, optionally swapped in full via the dagre adapter) — there is no per-subgraph/per-container algorithm selection. docs/research/layout.md:148 notes ELK's 'precise port constraints'/per-subgraph configurability was a known gap accepted when ELK was excluded on size grounds.
- *Verifier's phrasing of the claim:* Cluster/hierarchical layout where a container's internal algorithm can differ from its parent's

### 13. Selection/highlight of shortest path or connected subgraph (graph analytics)

- **Category:** analytics · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** d3-dag (topological utilities); cola.js (via graph structure)
- **What they offer:** d3-dag exposes topological sort and connected-component utilities on its DAG structure; broader D3/graph-analytics ecosystem convention includes shortest-path/ancestor-descendant highlighting built on such primitives.
- **Why it matters here:** The library already has g.descendants(id)/g.roots() query sugar but explicitly documents no shortest-path or cycle-listing API; a 'trace path from A to B' helper would pair naturally with the highlight/spotlight director op for narrating causal chains in a failure post-mortem storyboard.
- **How it could fit:** Could be a pure function export (like cues/fit) — sparkle-motion-visualizer/paths: shortestPath(g, from, to) — feeding director.highlight({nodes: path}) rather than a new rendering feature.
- **Survey evidence:** from memory (d3-dag topological API; general graph-lib convention) (from memory / unverified)
- **Repo check:** src/query.js exposes children(id)/descendants(id)/roots()/nodes()/edges() (query.js:32,51,58,74) — ancestor/descendant traversal utilities exist for compound hierarchy — but there is no topological-sort export, no connected-components utility, and no shortest-path or path-highlighting API anywhere in src/ or types/index.d.ts.

### 14. Text/DSL-based graph input (declarative language parsed into the graph model)

- **Category:** data model / input · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** elkjs (JSON is native, but ecosystem tools like elkjs-based editors and dagre-d3 demos commonly parse DOT/Graphviz text)
- **What they offer:** Common companion tooling in this space accepts a compact text DSL (e.g. Graphviz DOT-like syntax) and converts it to the node/edge JSON the layout engine consumes, letting authors hand-write graphs without JSON boilerplate.
- **Why it matters here:** sparkle-motion-visualizer's GraphSpec is JSON-only; a terse DSL (mermaid-like) would lower the barrier for quickly sketching a pipeline for smv-pack, especially given the library already targets a no-build-step CLI workflow.
- **How it could fit:** Would be a separate optional parser package producing GraphSpec JSON, not a core library change — keeps the zero-dependency default path intact.
- **Survey evidence:** from memory (general ecosystem pattern, not a specific documented feature of the named cohort libraries themselves) (from memory / unverified)
- **Repo check:** docs/research/api.md:40 explicitly documents the design decision rejecting a Mermaid-style text DSL as the primary format ('A JSON/object-literal spec (not a Mermaid-style text DSL) is recommended as the primary authoring format... Rejected as the primary spec format') and docs/PLAN.md:32 lists 'a text DSL à la Mermaid' as an explicit non-goal. No DSL parser exists in src/ or bin/.

### 15. Disconnected-component packing layout (disco)

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** elkjs
- **What they offer:** ELK's 'disco' algorithm specifically lays out multiple disconnected components compactly (polyomino packing) rather than a simple slot order, minimizing bounding-box area across unrelated subgraphs.
- **Why it matters here:** The library's componentOrder option only pins left-to-right/top-to-bottom slot order of disconnected components along the main axis; it does not attempt 2D compaction/packing of unrelated components the way ELK's disco algorithm does, which matters when a spec has many small unrelated pipelines shown together.
- **How it could fit:** Could be a follow-on to componentOrder: a packing:true option that lets independent components tile in both axes instead of one linear slot sequence.
- **Survey evidence:** https://github.com/kieler/elkjs README (disco algorithm) (verified)
- **Repo check:** src/engine.js:65 has a comment ('Disconnected components have no edges between them, so crossing minimization has...') indicating disconnected components are handled as an edge case within the single layered algorithm (e.g., simple slot ordering), not a polyomino-packing 'disco' algorithm. No packing/bounding-box-minimization code found.

### 16. Edge label auto-avoidance / label-aware routing

- **Category:** rendering/layout · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** elkjs
- **What they offer:** ELK treats edge labels as first-class layout objects with 'elk.edgeLabels.inline' and label placement options, reserving space for labels during layout so they don't overlap edges/nodes.
- **Why it matters here:** sparkle-motion-visualizer supports edge labels but layout is computed without reserving space for them, risking label/edge or label/node overlap on dense graphs — a documented capability, not called out as a limit, so worth flagging as a partial gap.
- **How it could fit:** Could extend the isotonic coordinate pass to add a per-edge label-height reservation similar to existing container header-strip padding.
- **Survey evidence:** https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeLabels-inline.html (verified)
- **Repo check:** src/render.js:208 ensureEdgeLabel() and :305 place a label per edge, and the custom layered engine (per docs/research/layout.md's mention of dagre's 'makeSpaceForEdgeLabels' pipeline stage as a studied precedent) reserves some layout space, but no explicit 'edgeLabels.inline' or dedicated label-collision-avoidance option/flag was found in src/layout.js, engine.js, or types/index.d.ts — could not confirm labels are treated as first-class layout objects with placement options as ELK does.

### 17. Undo/redo (transaction history)

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** cola.js (via consuming editors); d3-transition (as a building block for animated undo)
- **What they offer:** Not a built-in of any single cohort library directly, but the broader interactive-graph-editing ecosystem these libraries serve (cola.js constraint editors, dagre-d3 based diagram tools) commonly layers undo/redo command stacks atop mutation APIs.
- **Why it matters here:** The library's g.batch() is explicitly non-transactional with no rollback; a real undo/redo stack (snapshot g.spec() before each mutation, replay/restore) would address both the batch-rollback limit and give storyboard authors an 'undo last op while authoring' workflow.
- **How it could fit:** Could be a thin history preset built entirely on existing g.spec()/g.on('commit')/addNode etc. — no core change needed, just a documented recipe or shipped preset.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep for 'undo|redo|transaction history' in src/types/README finds only unrelated internal uses of the word 'undo' (e.g. src/export.js:108 'Undo viewport culling', src/index.js:88/785 describing that trailing animations are never undone). No command-stack or history API exists for reverting graph mutations.

### 18. Edge bundling for dense multi-edge graphs

- **Category:** rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** d3 ecosystem (d3-hierarchy's bundle-adjacent layouts, commonly paired with d3 for hierarchical edge bundling)
- **What they offer:** Hierarchical edge bundling routes many edges along shared hierarchical curve paths to reduce visual clutter, a well-known D3 example built on d3-hierarchy cluster layout plus custom line generators.
- **Why it matters here:** The library explicitly notes parallel/multi-edges between adjacent ranks now render as coincident overlapping polylines (a capability regression vs dagre); edge bundling is the more sophisticated end of solving crowded-edge legibility that this cohort's ecosystem addresses.
- **How it could fit:** Low priority/out of scope given the library's own docs treat multi-edge fanning as a 'rendering-layer fix if ever done', not a roadmap item; bundling is a further step beyond that.
- **Survey evidence:** from memory (classic Bostock hierarchical edge bundling example built on d3-hierarchy) (from memory / unverified)
- **Repo check:** No hits for 'bundl' relating to edge bundling anywhere in src/; the only 'bundle' hits refer to the JS build/IIFE bundle (src/layout.js:18, src/adapters/dagre.js:8, README.md build docs), an unrelated meaning of the word.

### 19. Non-overlap / collision constraint solving independent of rank structure

- **Category:** layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** cola.js
- **What they offer:** WebCola's avoidOverlaps:true option automatically inserts separation constraints between all node pairs so the solver guarantees zero rectangle overlap, generalized beyond same-rank spacing to arbitrary node placement.
- **Why it matters here:** The engine's isotonic pass guarantees >=nodesep spacing within a rank as an invariant, but container/sibling overlap is explicitly documented as unresolved (60-70/400 residual violations); cola's general-purpose overlap-removal constraint is a directly relevant prior art for closing that specific gap.
- **How it could fit:** Could inform a targeted post-pass overlap-removal step for container rectangles specifically, reusing the existing isotonic-regression machinery's spirit rather than adopting a full VPSC solver.
- **Survey evidence:** https://ialab.it.monash.edu/webcola/ (avoidOverlaps option) (verified)
- **Repo check:** The only overlap-prevention found is src/engine.js:784's same-rank separation-constraint comment, scoped to spacing nodes within a layer of the layered algorithm — not a general avoidOverlaps-style solver guaranteeing zero overlap for arbitrary node placement outside rank structure.

### 20. Radial/tree layout for shallow hierarchies

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** d3-hierarchy
- **What they offer:** d3.tree() and d3.cluster() lay out rooted trees radially or linearly with configurable node/link separation, commonly used for org charts and dependency trees distinct from a layered DAG look.
- **Why it matters here:** For pipelines that are actually simple trees (a fan-out with no merges), a radial layout is often clearer and more compact than a rank-based layered layout; currently only one layout family is offered.
- **How it could fit:** Same seam-extension idea as the ELK radial/mrtree entry above — best delivered as an alternate adapter rather than engine surgery.
- **Survey evidence:** https://github.com/d3/d3-hierarchy (verified)
- **Repo check:** Same conclusion as the layout-families item: only the single custom layered (Sugiyama-style, left-to-right/top-down) algorithm exists; no radial or linear tree-layout mode (d3.tree()/d3.cluster() equivalent) was found in src/layout.js or src/engine.js, and no README/docs section describes one.

## Borrowable ideas

- elkjs's declarative per-node/per-port layoutOptions map (a node can carry its own algorithm/spacing overrides inline in the graph JSON) — sparkle-motion-visualizer's node.data could support a local layout override object for one subtree without a full custom solver.
- dagre-d3's render().createNodes/createEdgePaths as separately-overridable pipeline stages (a documented extension seam) — a more granular preset hook than the current single (g)=>{destroy()} preset contract, letting a preset override just arrowhead/label drawing.
- WebCola's declarative constraint objects ({type:'alignment'/'separation', axis, offsets}) as pure JSON — a storyboard 'constrain' op expressing 'keep these nodes column-aligned' would compose well with the existing JSON-op storyboard model without needing a physics engine.
- d3-zoom's separate .filter() predicate for which input events count as pan/zoom (vs. hardcoded ctrl/wheel-only) — exposing an interaction.zoomFilter(event=>boolean) hook would let consumers opt into plain-wheel zoom themselves without the library hardcoding it.
- d3-dag's multiple decoupled algorithm stages (layering, decrossing, coordinate assignment each independently swappable via .layering()/.decross()/.coord()) — a finer-grained solver seam than the current all-or-nothing LayoutSolver could let consumers swap just the ordering heuristic.
- dagre-d3's built-in zoomable-and-pannable full example wiring d3-zoom straight to the rendered <g> in ~5 lines — worth mirroring in sparkle-motion-visualizer's own quickstart/preset docs as a 'bring your own d3-zoom' escape hatch note, even though native pan/zoom already exists.
- ELK's 'interactive' layout mode (layoutOptions: {'elk.interactive': true}) that respects existing node positions as a hint rather than fully re-solving — relevant to the order-stability work already done, as a documented opt-in knob (interactiveBias) for how strongly relayout should preserve manual/prior placement.
- cola.js's browser-based interactive constraint-editing demo pattern (drag a node, constraints resolve live) — even without runtime node dragging, an offline 'preview constraint' storyboard-authoring aid modeled on this could help authors iterate on props()/camera framing.

## Survey notes

Version/license figures for elkjs, d3-dag, d3-sankey, dagre-d3, and WebCola were confirmed live via web search in this session (Sept 2026). d3-hierarchy/d3-zoom/d3-drag/d3-transition/d3-force version numbers are from training-data memory (widely stable at d3 v7-era ^3.x for the d3-* micro-libraries) and were not re-confirmed via a successful fetch in this pass — marked verified:false accordingly; treat as likely-correct but not freshly checked. Some gap entries note explicitly that a feature is 'ecosystem convention' rather than a single cohort library's documented API (undo/redo, minimap, box-select, DSL input) since the task's broad prompt list includes categories the four named libraries don't all natively cover themselves — flagged with lower confidence/verified:false and noted in description.
