# Cohort survey: large-scale-and-analytics
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** Cosmograph / cosmos.gl, Ogma (Linkurious), KeyLines/ReGraph (Cambridge Intelligence), Gephi Lite, ngraph/vivagraph, G6 large graph mode, graphology algorithms (centrality, communities, shortest path) — scale (WebGL, LOD, clustering), analytics, filtering, time bar/timeline, geo mode, search

**Verification tally:** 21 claimed gaps: 17 missing, 3 partial, 1 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| cosmos.gl / @cosmograph/cosmos | v3.0 (npm: @cosmograph/cosmos) | MIT (OpenJS Foundation project) | https://github.com/cosmosgl/graph | yes | GPU-accelerated (WebGL2/luma.gl) force-directed graph layout+rendering engine for hundreds of thousands of points/links, now under OpenJS Foundation |
| Ogma | 5.x (5.3 cluster-layout release seen; 5.0.8-rc4 referenced) | Commercial (proprietary, subscription) | https://doc.linkurious.com/ogma/latest/ | yes | Commercial JS library (Linkurious) for large-scale interactive graph visualization: WebGL rendering, LOD, clustering, geo mode via Leaflet |
| KeyLines / ReGraph | unknown | Commercial (proprietary) | https://cambridge-intelligence.com/regraph/ | yes | Commercial Cambridge Intelligence SDKs (vanilla JS / React) for graph visualization with Time Bar, Map Mode, combos, and social network analysis metrics |
| Gephi Lite | v0.6 (Feb 2025 release) | GPL-3.0 (Gephi project) | https://gephi.org/lite/ / https://lite.gephi.org/ | yes | Open-source, serverless, browser-based visual network analysis app (successor UI paradigm to desktop Gephi) built on graphology |
| ngraph (ngraph.graph / ngraph.forcelayout / ngraph.pixi etc.) | unknown (many independently versioned sub-packages) | BSD/MIT (per-package, from memory) | https://github.com/anvaka/ngraph | no | Modular family of small graph data-structure, force-layout, and renderer packages by anvaka; layout listens to live graph mutation events |
| AntV G6 | 5.1.1 (npm @antv/g6) | MIT | https://g6.antv.antgroup.com/en/ / https://github.com/antvis/G6 | yes | Full graph visualization framework (Alibaba/AntV): Canvas/SVG/WebGL/3D rendering, large-graph mode, combos, minimap, edge bundling, plugin ecosystem |
| graphology (+ standard-library algorithm packages) | per-package, e.g. graphology-shortest-path 2.1.0, graphology-louvain 2.0.2, graphology-components 1.5.4 | MIT | https://graphology.github.io/standard-library/ | yes | Graph data-structure spec plus a standard library of algorithm packages (graphology-shortest-path, graphology-louvain, graphology-components, graphology-metrics, etc.) |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. WebGL/GPU rendering backend for scale

- **Category:** Rendering / scale · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Cosmograph/cosmos.gl; Ogma; G6
- **What they offer:** Cosmos.gl runs simulation and rendering entirely on the GPU (WebGL2/luma.gl) for hundreds of thousands of points/links; Ogma and G6 both offer WebGL rendering paths specifically for large-graph performance beyond what SVG/Canvas can sustain.
- **Why it matters here:** smv is explicitly SVG-only (confirmed knownLimit); pipeline/process diagrams are typically small-to-medium (tens to low hundreds of nodes) so this is mostly out of remit, but it caps how large a rendered pipeline/DAG can ever get before frame budget degrades, which matters if smv is ever used for e.g. a large microservice dependency map rather than a single pipeline run.
- **How it could fit:** Not a natural fit given the library's explicit SVG/no-build-step/small-bundle design goals (D7, D11, size budgets); would require a wholesale second rendering backend behind the existing renderer seam, which does not currently exist for rendering (only layout has a solver seam).
- **Survey evidence:** https://github.com/cosmosgl/graph , https://doc.linkurious.com/ogma/latest/ , https://g6.antv.antgroup.com/en/manual/further-reading/renderer (verified)
- **Repo check:** src/render.js and src/measure.js use only SVG + a 2D canvas (offscreen text measurement in measure.js:9-10, export rasterization in export.js:163-176). No WebGL/luma.gl/regl usage anywhere in src/. docs/research/rendering.md:67 explicitly discusses and rejects WebGL (sigma.js comparison), confirming SVG-only is a deliberate design choice, not an oversight.
- **Verifier note:** Claim is accurate; library is SVG-rendered by design, documented tradeoff in docs/research/rendering.md.

### 2. Geo / map mode (coordinate-projected nodes over a real map)

- **Category:** Layout / rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Ogma; KeyLines/ReGraph
- **What they offer:** Ogma's Geo engine (built on Leaflet) and ReGraph/KeyLines Map Mode let nodes be plotted at real lat/lng coordinates on a tile map, with clustering of geo markers and custom projections, coexisting with the same graph API.
- **Why it matters here:** Out of scope for a process/pipeline narration tool — no evidence this library targets geospatial network data at all.
- **How it could fit:** Would be a wholesale alternate layout+substrate mode; nothing in the current layout-solver seam anticipates map tiles or coordinate systems.
- **Survey evidence:** https://linkurious.com/blog/get-more-geospatial-data-ogma-28/ ; https://cambridge-intelligence.com/time/ (verified)
- **Repo check:** No matches for geo/leaflet/lat-lng/tile anywhere in src/, README.md, or docs/ (only a false-positive comment-word match in director.js:294).
- *Verifier's phrasing of the claim:* Geo / map mode

### 3. Time bar / timeline component synced to graph state, with histogram + trendlines and playback/filter-by-time

- **Category:** Time / analytics UI · **Fit:** 4/5 · **Verified in repo:** `partial`
- **Who has it:** KeyLines/ReGraph; Cosmograph (timeline component)
- **What they offer:** ReGraph/KeyLines ship a dedicated Time Bar React/JS component: histogram of overall activity plus trendlines for a node/subgraph, two-way synced with graph selection, with navigation/filter/playback controls driven purely by timestamp fields in the data. Cosmograph's ecosystem similarly ships a ready-made timeline component.
- **Why it matters here:** smv already has a transport bar (play/pause/scrub) driven by its compiled token schedule, but that's tied to Mode A/B run state, not to a generic timestamp-filterable visualization of arbitrary event density across the whole graph — a histogram-style 'activity over time' overview for a long-running pipeline (many parallel branches, retries) would materially help a viewer see where the interesting time regions are before scrubbing.
- **How it could fit:** Could be a new opt-in overlay component (similar to the caption overlay) that reads run.log()/sim().events and renders a small SVG histogram synced to run.seek(); a natural companion to the existing transport bar rather than a replacement.
- **Survey evidence:** https://cambridge-intelligence.com/time/ ; https://github.com/cosmosgl/graph (verified)
- **Repo check:** src/transport.js implements a transport bar with play/pause/seek/speed and a scrubber driven by controller.timeline() (transport.js:11-12, 68-99), and src/storyboard.js has a `timeline()` builder (storyboard.js:218). But this is a linear step-sequence scrubber, not a timestamp-driven histogram/trendline component; no chart/histogram rendering code found, and it isn't synced to arbitrary node/edge selection filtering.
- **Verifier note:** Playback/scrub exists; histogram+trendline+selection-sync visualization does not.
- *Verifier's phrasing of the claim:* Time bar / timeline component with histogram+trendlines+playback

### 4. Minimap / navigator overview panel

- **Category:** Interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** G6; Ogma; KeyLines
- **What they offer:** A small overview thumbnail of the whole graph with a draggable viewport rectangle, standard in most large-graph libraries (G6 ships it as a built-in plugin).
- **Why it matters here:** smv has fitView()/anchor() and viewport culling but no persistent spatial-orientation aid; for large multi-container pipelines with pan/zoom, a minimap helps viewers stay oriented, especially during storyboard playback with camera moves.
- **How it could fit:** Could ship as a preset (matches the documented presetPipeline contract: (g)=>{destroy()} off g.on('commit',...)/g.bounds()) rather than a core feature — draws a scaled-down exportSVG-like view plus a rect tracking the current viewport transform.
- **Survey evidence:** https://g6.antv.antgroup.com/en/manual/whats-new/feature (verified)
- **Repo check:** No minimap code in src/. docs/research/ux.md:17,64 and docs/research/critique.md:150,230 explicitly discuss minimap as a considered-but-deferred 'optional preset component, not core' — docs/PLAN.md:693 lists 'minimap' among hypothetical future extension points not yet built.

### 5. Built-in tooltip system

- **Category:** Interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** G6; Ogma; KeyLines
- **What they offer:** G6 ships a Tooltip as a built-in plugin; Ogma and KeyLines both offer configurable hover tooltips out of the box, showing node/edge data on hover/tap.
- **Why it matters here:** Explicitly listed as a knownLimit already (no built-in tooltip system, must be built via preset) — cohort libraries treat this as table stakes, so it's a real, common gap worth flagging even though the inventory already names it as a limit (confirms it, doesn't add new info) — included because it's a very high-value, low-effort addition for a narration tool where hover-to-read node.data details is a natural ask.
- **How it could fit:** Could be a first-party preset shipped alongside presetPipeline, built purely on existing primitives (pointer events + g.node(id) + a positioned <div>/<foreignObject>), no core API change needed.
- **Survey evidence:** https://g6.antv.antgroup.com/en/manual/whats-new/feature (verified)
- **Repo check:** No 'tooltip' string appears in src/, README.md, or types/index.d.ts; only a single unrelated mention in docs/research/ux.md:43 describing a third-party UI (Temporal Web UI) as inspiration, not a shipped feature.

### 6. Node dragging / manual repositioning

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6; Ogma; KeyLines; ngraph+renderers; Gephi Lite
- **What they offer:** Nearly universal in the cohort: users can drag individual nodes to reposition them, often with the layout algorithm re-settling around the manual pin (e.g. force layouts treat a dragged node as fixed).
- **Why it matters here:** Already an explicit knownLimit (layout is entirely computed, not manually adjustable) — confirmed gap. For a pipeline-narration tool the computed/deterministic layout is largely a deliberate tradeoff (order stability, storyboard determinism), so manual dragging would conflict with core design goals (D-numbered invariants around layout determinism).
- **How it could fit:** Low fit given the library's explicit bet on deterministic, non-manual layout; if ever added it would need to be an opt-in override layer, not a default.
- **Survey evidence:** from memory (near-universal feature across cohort, confirmed by G6/Ogma docs) (verified)
- **Repo check:** src/viewport.js implements pointer drag only for canvas panning (viewport.js comments 'Pan: pointer drag' per docs/INTERNALS.md:139) and pinch-zoom; there is no per-node pointer-down/drag handler in src/interact.js or render.js that repositions an individual node. docs/PLAN.md:32 explicitly excludes 'graph editing UI (drag-to-connect)' from scope.
- **Verifier note:** Layout is algorithmic (dagre-style DAG layout in src/layout.js/engine.js) with no manual pin/fixed-node mechanism.

### 7. Box/rectangle select and multi-select interaction with a selection API

- **Category:** Interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** G6; Ogma; KeyLines; Gephi Lite
- **What they offer:** Drag a rectangle to select multiple nodes/edges; selection becomes stateful and drives further operations (styling, filtering, algorithms) — standard in Gephi Lite, G6, Ogma.
- **Why it matters here:** Confirmed knownLimit already (no multi-select or selection API/state). For process narration, multi-select matters less than for exploratory analysis, but a lightweight 'select a subgraph to condense/highlight' interaction would streamline authoring storyboards interactively rather than hand-writing highlight ops.
- **How it could fit:** Could layer onto g.props()/highlight as an authoring-time preset (not runtime default): box-select emits ids, calls g.highlight({nodes:ids}) or seeds a condense() call — an authoring tool, not a viewer feature.
- **Survey evidence:** from memory (verified)
- **Repo check:** types/index.d.ts:494 HighlightSelection exists (780: highlight(selection?)) but this is a presentational/programmatic emphasis API (set via code, e.g. g.highlight({nodes:[...]})), not a pointer-driven rectangle-drag multi-select interaction. No rubber-band/rect-select code in src/interact.js or viewport.js.
- *Verifier's phrasing of the claim:* Box/rectangle select and multi-select interaction with selection API

### 8. Context menu (right-click menu)

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6; Ogma; KeyLines
- **What they offer:** Right-click on a node/edge opens a configurable action menu (expand, delete, inspect, run algorithm, etc.) — standard plugin in G6 and Ogma.
- **Why it matters here:** Confirmed knownLimit already. Lower priority for a narration/playback tool where interaction is meant to be minimal (pan/zoom/tap-to-toggle only, by design per D-decisions), but relevant if smv is ever used as an authoring tool rather than pure playback.
- **How it could fit:** Would fit as a preset, similar to tooltip.
- **Survey evidence:** from memory (verified)
- **Repo check:** No 'context menu' or 'contextmenu' references anywhere in src/, README.md, or types/index.d.ts.

### 9. Search / find-node UI with highlight-and-focus

- **Category:** Interaction / analytics · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Cosmograph (ready-made search component); G6; Ogma; KeyLines
- **What they offer:** Cosmograph ships a ready-to-use search component; G6/Ogma expose search/highlight-matching-node APIs; typically type-to-filter with autocomplete that pans/zooms to the match.
- **Why it matters here:** For a pipeline with many named steps, a 'jump to node by label' search would be a genuinely useful addition on top of existing camera/highlight director ops — low overlap with anything already documented.
- **How it could fit:** Natural fit: a thin preset combining g.nodes({label: predicate}) query sugar + g.camera({node}) + g.highlight({nodes, variant:'focus'}); could also be exposed as a storyboard-authoring convenience, not necessarily core API.
- **Survey evidence:** https://github.com/cosmosgl/graph (ecosystem includes ready-to-use search) (verified)
- **Repo check:** src/query.js provides a programmatic query API (makeQuery(store) -> nodes(filter), edges(filter), children, descendants, roots — query.js:32-45) usable from application code, and g.highlight()/g.camera() exist as separate primitives an app could wire together, but there is no shipped search input UI, autocomplete, or built-in pan-to-match component.

### 10. Faceted/attribute filtering UI (show/hide nodes by attribute value, cascading filter pipeline)

- **Category:** Analytics / filtering · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Gephi Lite; Ogma; KeyLines
- **What they offer:** Gephi Lite's filter pipeline lets users chain attribute filters, script filters, and topological filters (e.g. largest connected component, k-core) cascading on the prior result; Ogma/KeyLines offer similar rule-based node/edge filtering with show/hide state.
- **Why it matters here:** smv's query sugar (g.nodes(filter)) is read-only and does not drive visibility/dimming state; a real filter-to-visual-state pipeline (hide/dim nodes not matching an attribute) would be a genuinely new capability, useful for e.g. 'show only the failed branch' during debugging playback.
- **How it could fit:** Could build on the existing g.props()/highlight (dim:true) replace-not-accumulate model — a filter() convenience that computes matching ids via existing predicate/partial-match querying and calls highlight({dim:true, nodes: complement}) under the hood; doesn't need new core mutation primitives.
- **Survey evidence:** https://www.ouestware.com/2025/02/26/gephi-lite-0-6-en/ (verified)
- **Repo check:** src/query.js (line 25-45) supports predicate/match-object filtering programmatically (makeQuery(store).nodes(filter)), but there is no UI component, no show/hide visual state toggle, and no chainable/cascading filter pipeline (e.g. topological filters like k-core or largest-component) — this is a low-level data query helper, not a filtering feature or UI.
- *Verifier's phrasing of the claim:* Faceted/attribute filtering UI (cascading filter pipeline)

### 11. Graph analytics algorithms: shortest path, centrality (betweenness/degree/PageRank/eigenvector), community detection (Louvain/Leiden/label propagation)

- **Category:** Analytics · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** graphology (graphology-shortest-path, graphology-louvain, graphology-metrics, etc.); ngraph.centrality; KeyLines/ReGraph (social network analysis metrics); Gephi Lite (statistics panel)
- **What they offer:** The graphology ecosystem ships dedicated algorithm packages for shortest paths (Dijkstra/A*/Bellman-Ford), centrality measures, and community detection (Louvain); Gephi Lite exposes these as a 'statistics' panel; ReGraph/KeyLines bundle SNA metrics directly into the graph API.
- **Why it matters here:** Confirmed knownLimit already (no path-finding, no graph-algorithm queries beyond internal FAS). For pipeline visualization specifically this is lower priority than for general network-analysis tools — a DAG pipeline rarely needs betweenness centrality — but 'critical path' / longest-duration-path highlighting (a shortest/longest-path variant over the compiled Mode A schedule) would be a directly relevant, narration-specific analytic smv currently has no equivalent for.
- **How it could fit:** Rather than a general graph-algorithms library, the highest-fit version of this for smv specifically would be a 'critical path' helper computed from sim().stateAt() timing data (finish/start times per node) and surfaced as a highlight() convenience — narrower and more targeted than adopting a full graphology dependency, which would also blow the size budget.
- **Survey evidence:** https://graphology.github.io/standard-library/ ; https://cambridge-intelligence.com/regraph/features/ (verified)
- **Repo check:** Searched src/, README.md, types/index.d.ts, and docs/ for dijkstra, shortest-path, centrality, pagerank, louvain, community, betweenness — only hits are in docs/research/*.md discussing unrelated topics (layout papers, UI research), no algorithm implementations or exports exist.
- *Verifier's phrasing of the claim:* Graph analytics algorithms (shortest path, centrality, community detection)

### 12. Combo / grouping visualization distinct from compound containers (auto-computed clusters, not author-declared parents)

- **Category:** Data model / layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (Combo); Ogma (clustering, grouping); KeyLines/ReGraph (combos)
- **What they offer:** G6's Combo and Ogma/KeyLines' grouping features let the library auto-cluster nodes by an attribute or algorithm (e.g. community detection) and visually group them, distinct from author-declared parent/child containers.
- **Why it matters here:** smv's container model is entirely author-declared via node.parent; there's no automatic grouping by data attribute or detected community — for very branchy pipelines, auto-grouping by e.g. a 'team' or 'stage' tag without hand-authoring parent links could reduce spec authoring burden.
- **How it could fit:** Could be a preprocessing convenience function (not a runtime feature) that synthesizes container nodes + parent links from a groupBy(node => node.data.team) function before mount() — stays entirely within the existing data model rather than adding a new concept.
- **Survey evidence:** https://g6.antv.antgroup.com/en/manual/whats-new/feature ; https://linkurious.com/blog/ogma-5-3/ (verified)
- **Repo check:** No 'combo' or 'auto-cluster' matches in src/, README.md, or types/index.d.ts. The library's only grouping primitive is author-declared parent/child compound nodes (README.md:90-91: 'parent links make containers'), exactly the mechanism the claim says is distinct from what's missing.
- *Verifier's phrasing of the claim:* Combo / auto-computed grouping distinct from compound containers

### 13. Undo/redo history

- **Category:** Interaction / state · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Ogma; KeyLines; G6 (via plugins)
- **What they offer:** Common in editor-oriented graph tools — a history stack of mutations that can be stepped backward/forward.
- **Why it matters here:** smv already has a documented, arguably superior mechanism for this in its domain — storyboard backward scrubbing through structural changes (G2) — so true undo/redo is largely subsumed. Still worth naming as a gap for the case of live/ad-hoc (non-storyboard) mutation sequences via g.addNode/removeNode etc., which have no history/undo at all outside a storyboard.
- **How it could fit:** Low priority given storyboard scrub already covers the narration use case; would only matter for an interactive editing tool built on top of smv, which is out of the library's stated remit (no context menu/drag/select either).
- **Survey evidence:** from memory (verified)
- **Repo check:** Searched src/ and types/index.d.ts for undo/redo — only hits are code comments using 'undo' colloquially (e.g. export.js:108 'Undo viewport culling', index.js:88/519/785 discussing that animation-cancel 'never undoes' a mutation). No history stack, no undo()/redo() API in types/index.d.ts.

### 14. Edge bundling (visually merging near-parallel edges along shared routes)

- **Category:** Rendering / layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (edge bundling)
- **What they offer:** G6 offers edge-bundling algorithms that curve and merge visually parallel edges to reduce clutter in dense graphs.
- **Why it matters here:** Directly relevant to a documented smv knownLimit: parallel/multi-edges between adjacent ranks render as coincident overlapping polylines (a capability lost vs. dagre) and the fix is explicitly deferred as a 'rendering-layer fix if ever done.' Edge bundling is a fancier version of the same underlying problem (visually distinguishing multiple edges along a shared path).
- **How it could fit:** Simpler fan-out (offsetting coincident polylines by a small perpendicular delta, as dagre used to do via dummy nodes) would likely serve smv's actual need better than full bundling; true bundling is more suited to dense non-layered graphs.
- **Survey evidence:** https://g6.antv.antgroup.com/en/manual/whats-new/feature (verified)
- **Repo check:** Searched src/, README.md, types/index.d.ts for 'bundl' — only hits are about JS module bundles (dist bundle, IIFE bundle), none about visual edge-bundling of near-parallel edges.
- *Verifier's phrasing of the claim:* Edge bundling

### 15. Radial / circular / grid / tree / force-directed layout algorithm families

- **Category:** Layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (multiple built-in layouts); ngraph.forcelayout; Gephi Lite (ForceAtlas2, etc. via graphology-layout); Cosmograph (GPU force layout)
- **What they offer:** All cohort members offer non-layered layout families — force-directed (ngraph, Cosmograph, Gephi Lite's ForceAtlas2), radial, circular, grid, concentric (G6) — chosen per use case (e.g. force layout for organic network exploration).
- **Why it matters here:** Already an explicit knownLimit (layered/Sugiyama-style only). For a pipeline/process narration tool, DAG-appropriate layered layout is the right default and this is arguably correctly out of scope; flagged for completeness since it's the single largest capability class the whole cohort has that smv lacks.
- **How it could fit:** The existing pluggable LayoutSolver seam (already used for the dagre adapter) is the correct extension point if this were ever wanted — a force-directed or radial adapter could be shipped the same way dagre is, as an optional peer-dependency package, without touching the in-house engine or its size budget.
- **Survey evidence:** https://github.com/anvaka/ngraph ; https://g6.antv.antgroup.com/en/manual/whats-new/feature ; https://www.ouestware.com/2025/02/26/gephi-lite-0-6-en/ (verified)
- **Repo check:** src/layout.js (lines 1-24) and src/engine.js implement only a layered/DAG (dagre-style) layout with an interchangeable dagre adapter (src/adapters/dagre.js) — the doc comment explicitly frames layout.js as 'the frozen layout seam' around a layered solver contract (ranks/order/layers). No radial, circular, grid, or force-directed solver exists in src/ or src/adapters/.
- *Verifier's phrasing of the claim:* Radial / circular / grid / force-directed layout algorithm families

### 16. Level-of-detail (LOD) rendering that simplifies/abstracts geometry at zoomed-out scales (not just culls off-screen elements)

- **Category:** Rendering / scale · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** Ogma; G6
- **What they offer:** Ogma's LOD zooming and G6's large-graph mode progressively simplify rendering (e.g. drop labels, merge small nodes into dots, reduce edge detail) as zoom level decreases, distinct from simple visibility culling.
- **Why it matters here:** smv has viewport culling (skip fully off-screen elements) but nothing that simplifies on-screen-but-zoomed-out geometry — for a large pipeline viewed fully zoomed-out (fitView on a big DAG), labels/badges would just get tiny/unreadable rather than adaptively simplifying.
- **How it could fit:** Could hook the existing per-commit data-* attribute writing: a data-lod tier attribute driven by current zoom k, with CSS rules that hide labels/badges below a threshold scale — fits the existing 'CSS-only theming' styling mechanism (D7) without new rendering code.
- **Survey evidence:** https://linkurious.com/blog/get-more-geospatial-data-ogma-28/ (LOD zooming) ; https://g6.antv.antgroup.com/en/manual/further-reading/renderer (verified)
- **Repo check:** src/a11y.js:169-182 and src/viewport.js/export.js document viewport-based culling: off-screen elements get `data-culled` + display:none once a graph is big enough (a11y.js:169). This is visibility culling only — no evidence of label-dropping, node-merging-into-dots, or edge-simplification at zoom levels; comments in export.js (96-115) explicitly frame this as culling, not geometric simplification.
- *Verifier's phrasing of the claim:* Level-of-detail (LOD) rendering

### 17. URL/state serialization for shareable views (deep link to a specific pan/zoom/selection/filter state)

- **Category:** State / collaboration · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** Gephi Lite (GitHub Gist save/load); Ogma/KeyLines (session state save typical in commercial tooling)
- **What they offer:** Gephi Lite can save/load a full graph+view state via GitHub Gist login, giving a shareable persistent link with no server of its own.
- **Why it matters here:** smv has g.spec()/g.storyboard() JSON snapshots and exportSVG, but no notion of serializing current *view* state (pan/zoom/theme/highlight) to a URL or blob for share-a-moment use cases distinct from full storyboard authoring.
- **How it could fit:** Could be a small optional helper: g.viewState()/g.restoreViewState() returning/consuming {transform, theme, emphasis} — orthogonal to storyboards, useful for e.g. bug reports ('here's exactly what I'm looking at').
- **Survey evidence:** https://www.ouestware.com/2025/02/26/gephi-lite-0-6-en/ (verified)
- **Repo check:** README.md:105 and storyboard.js describe 'serializable op array' storyboards that can replay a full narrative (structural/animation state), and src/export.js supports exporting SVG/PNG stills. But there is no URL/hash-based serialization of pan/zoom/selection/filter view-state, and no gist/save-load mechanism comparable to Gephi Lite's — storyboards serialize narrative scripts, not current view state for deep-linking.
- *Verifier's phrasing of the claim:* URL/state serialization for shareable views

### 18. Real-time collaborative/multi-user session sync

- **Category:** Collaboration · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** KeyLines/ReGraph (typical enterprise deployments, though not confirmed as core SDK feature)
- **What they offer:** Enterprise graph tools in this tier are sometimes embedded in collaborative investigation platforms with shared cursors/selection across users.
- **Why it matters here:** No evidence this is a core SDK-level feature of KeyLines/ReGraph itself (more an application-layer concern) — flagged with low confidence and low fit; likely out of scope for an embeddable, no-backend, framework-free library.
- **How it could fit:** Not a natural fit for a client-only, no-server library by design.
- **Survey evidence:** from memory, low confidence (from memory / unverified)
- **Repo check:** No websocket, multi-user, shared-cursor, or collaboration code found in src/ (confirmed by absence in all prior greps and by docs/PLAN.md:32's scope note excluding editing UI); this is a single-user embeddable visualization library with no networking layer at all.

### 19. Framework wrapper packages (official React/Vue bindings)

- **Category:** Distribution / integrations · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** ReGraph (React-native design); G6 (React node support, likely wrapper packages)
- **What they offer:** ReGraph is built React-first; G6 5.x added first-class React node rendering support.
- **Why it matters here:** Confirmed knownLimit already (no official framework wrapper packages). Worth noting cohort members increasingly treat React support as a differentiator (ReGraph's whole value prop vs KeyLines).
- **How it could fit:** Given the library's explicit no-framework, no-build-step design goal (D-decisions, size budgets), an official React wrapper would be a deliberate scope expansion, not a natural incremental fit; a thin community wrapper is more consistent with current architecture.
- **Survey evidence:** https://cambridgeintel.medium.com/getting-started-with-regraph-the-graph-visualization-toolkit-for-react-2404b0510333 ; https://medium.com/antv/g6-5-0-beta-changlog-f86caccd2ce7 (verified)
- **Repo check:** README.md:8 states explicitly: 'One <script> tag, no build step, no framework.' docs/PLAN.md:32 explicitly lists 'React/Vue bindings' among things out of scope. No src/react* or src/vue* files, no such exports in types/index.d.ts or package.json.
- *Verifier's phrasing of the claim:* Framework wrapper packages (React/Vue bindings)

### 20. Touch/multitouch gesture support beyond pinch-zoom (e.g. Gephi Lite 'browse networks like a map')

- **Category:** Interaction · **Fit:** 1/5 · **Verified in repo:** `present`
- **Who has it:** Gephi Lite; Cosmograph v3 (tap/drag/pinch on phones/tablets)
- **What they offer:** Gephi Lite explicitly supports touch and multitouch map-like browsing; Cosmograph v3 added tap/drag/pinch-to-zoom for phones and tablets as a named release feature.
- **Why it matters here:** smv's interaction model already unifies pointer events (pointerdown/up/cancel, touch-friendly per the inventory) and supports pinch for zoom, so this is largely already covered — flagged as a partial/near-miss rather than a clean gap; the residual gap is any touch-specific affordance beyond pan/pinch (e.g. long-press for context actions).
- **How it could fit:** Low priority — likely already substantially covered by the existing pointer-event unification.
- **Survey evidence:** https://github.com/cosmosgl/graph (verified)
- **Repo check:** src/viewport.js implements multi-pointer tracking (`pointers` Map, lines ~193-261) with pinch-to-zoom gesture handling (pinch var, gesture(), zoomAbout on pinch — viewport.js:193,210-215,230) and pointer-drag panning; styles.js:88 sets `touch-action:none` so pan/pinch are handled by the library on touch devices. docs/INTERNALS.md:139 confirms: 'Pan: pointer drag. Zoom: wheel only with ctrl/cmd (never hijack page scroll) + pinch.'
- **Verifier note:** This covers pan+pinch-zoom via pointer events (works for touch); no evidence of additional multitouch gestures (e.g. two-finger rotate) beyond pinch/drag, but the core claim (pinch-to-zoom, drag-to-pan on touch) is present, contradicting a 'missing' framing — though the claim as stated ('beyond pinch-zoom') asks for gestures past pinch/drag, which is not found.
- *Verifier's phrasing of the claim:* Touch/multitouch gesture support beyond pinch-zoom

### 21. Data import adapters for common graph interchange formats (GEXF, GraphML, CSV edge lists)

- **Category:** Data model / integrations · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Gephi Lite (Gephi's native GEXF plus GraphML/CSV import)
- **What they offer:** Gephi Lite, inheriting Gephi's ecosystem, imports GEXF/GraphML/CSV directly in the browser.
- **Why it matters here:** Confirmed knownLimit already (no built-in GraphML/DOT/JSON-schema importers, spec is smv's own JSON shape only). Relevant mainly if users want to visualize pipelines/DAGs authored in another tool's export format.
- **How it could fit:** Would fit best as a separate, tree-shakeable subpath package (sparkle-motion-visualizer/import-gexf, etc.) consistent with the existing exports-map pattern (./export, ./adapters/dagre), not core.
- **Survey evidence:** from memory (Gephi/Gephi Lite's known format support) (verified)
- **Repo check:** Searched src/, README.md, docs/ for gexf/graphml/csv — zero matches anywhere. The library's only documented input is its own JS/JSON node/edge spec object (README.md nodes/edges example, lines 15-30); no import parsers exist in src/ or bin/.
- *Verifier's phrasing of the claim:* Data import adapters (GEXF, GraphML, CSV edge lists)

## Borrowable ideas

- Cosmograph's async-ready + queued-methods pattern (graph.ready/isReady, calls queue until GPU device ready) — a cleaner analog for smv's own async work like font loading in --record mode
- ReGraph/KeyLines Time Bar: a dedicated timeline sub-component (histogram + trendline) that stays two-way synced with the graph via selection — smv already has a scrub-capable transport bar; a similar 'activity histogram' overlay would fit the run/storyboard model well
- Gephi Lite's cascading filter pipeline (filters chain, each applied to the previous result) — a clean mental model smv's query sugar (g.nodes(filter)) could grow toward for a lightweight filter/spotlight builder
- Ogma's single 'geo mode' toggle that swaps the same API onto a Leaflet/map substrate rather than a separate geo library — a good precedent for how a mode-swap (not a rewrite) could work if smv ever added a coordinate-projected layout mode
- G6's declarative theme token sets (light/dark + community palettes) bundled as swappable presets on top of raw CSS vars — smv could ship a few canned --smv-* token presets the same way
- ngraph's 'layout listens to graph events and stays incrementally up to date' pattern — validates smv's own commit-driven incremental relayout approach, worth citing as prior art
- Cosmograph's getSampledLinks()/getSampledLinkPositionsMap() for placing overlay labels along on-screen edges only — directly applicable to smv's viewport-culling system for edge labels
- Gephi Lite's GitHub Gist save/load for shareable state with no server — a lightweight persistence pattern smv's spec/storyboard JSON could copy for a 'share a run' URL feature

## Survey notes

Time budget was moderate; version/license numbers for KeyLines/ReGraph and ngraph sub-packages could not be pinned precisely (search results didn't surface exact npm version strings), so those are marked unknown/from-memory. Ogma pricing is not public. Gap analysis is scoped strictly to what the provided capability inventory does NOT already claim — several near-misses (e.g. smv's viewport culling vs G6/Ogma/Cosmograph's true WebGL LOD, smv's condense/split vs Ogma/G6 grouping) are listed as gaps because the inventory's own knownLimits sections confirm the underlying mechanism (SVG-only, no canvas/WebGL backend, layered-only layout, no drag) rather than assuming.
