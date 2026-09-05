# Cohort survey: vis-echarts-plotly
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** vis-network (incl. DataSet/DataView, physics, clustering, manipulation, hierarchical layout), Apache ECharts graph/sankey/tree series, Plotly network figures

**Verification tally:** 23 claimed gaps: 19 missing, 3 partial, 1 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| vis-network | 10.1.2 | Apache-2.0 OR MIT (dual) | https://github.com/visjs/vis-network | yes | Canvas-based dynamic network visualization with physics, clustering, and manipulation UI. |
| Apache ECharts | 6.1.0 | Apache-2.0 | https://echarts.apache.org | yes | General-purpose charting library including graph, sankey, and tree series among many chart types. |
| Plotly.js | 3.7.0 | MIT | https://github.com/plotly/plotly.js | yes | General charting library; network graphs done manually via go.Scatter node/edge traces, not a first-class graph chart type. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Physics-based force-directed layout with live simulation

- **Category:** Layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network; Apache ECharts (force layout)
- **What they offer:** vis-network runs a continuous Barnes-Hut/repulsion physics engine (options.physics, springLength, gravitationalConstant, stabilization) that nodes settle into interactively, including drag-to-perturb; ECharts graph series has type:'force' with force.repulsion/gravity/edgeLength and friction, also interactively draggable.
- **Why it matters here:** Pipeline graphs with cycles/complex topology sometimes benefit from an organic layout as an alternative to strict layered ranking, especially for exploratory/ad-hoc graphs not meant to read top-to-bottom.
- **How it could fit:** Could be a new LayoutSolver ('force') behind the existing pluggable solver seam, opt-in via opts.layout.solver, without touching the default Sugiyama engine.
- **Survey evidence:** https://visjs.github.io/vis-network/docs/network/ (from search); ECharts graph series docs (from memory, confirmed via search) (verified)
- **Repo check:** docs/PLAN.md:31 lists 'force-directed physics' explicitly as a v1 non-goal; docs/research/critique.md:143 rejects a force-directed fallback layout as undermining determinism; docs/research/landscape.md:17 calls out avoiding vis-network's always-on Barnes-Hut physics as a deliberate anti-goal. src/engine.js implements only a deterministic layered (Sugiyama-style) DAG layout with no simulation loop, no springLength/gravitationalConstant/friction options anywhere in types/index.d.ts.
- **Verifier note:** deliberate design decision, documented as a non-goal, not an oversight

### 2. Interactive node dragging / manual repositioning

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network; Apache ECharts (graph draggable:true); Plotly.js (via custom drag handlers)
- **What they offer:** Nodes can be picked up and dragged by the end user to reposition them (vis-network default; ECharts graph series draggable option; Plotly requires manual event wiring).
- **Why it matters here:** sparkle-motion-visualizer explicitly states layout is fully computed with no manual repositioning — this is a documented, deliberate gap the cohort covers as standard.
- **How it could fit:** Would conflict with the deterministic layout/order-stability model; could be offered as an opt-in interaction mode that pins dragged nodes as manual overrides feeding back into the engine, but is a large design change.
- **Survey evidence:** vis-network docs (verified via search); ECharts graph series 'draggable' option (verified via search) (verified)
- **Repo check:** src/interact.js and src/viewport.js implement pan/zoom (pointer drag moves the viewport transform, per docs/INTERNALS.md:139 'Pan: pointer drag') but grep for 'drag' across src turns up only viewport-panning and transport-scrubber references, no per-node drag handler, no node pointerdown->reposition code in src/render.js or src/interact.js.
- **Verifier note:** nodes are positioned only by the layout engine; no end-user repositioning API exists

### 3. Dynamic clustering algorithms (hub-based, outside-in/inside-out, box clustering)

- **Category:** Layout / Data model · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network
- **What they offer:** vis-network's cluster()/clusterByConnection()/clusterByHubsize()/clusterOutliers() APIs auto-group nodes by connectivity heuristics for datasets >50k nodes, with openCluster()/isCluster() for interactive drill-down.
- **Why it matters here:** sparkle-motion-visualizer has manual condense()/split() (explicit id sets) and collapse/expand for author-declared containers, but no automatic degree/hub-based grouping for arbitrary large graphs.
- **How it could fit:** Could add a g.autoCluster({by:'hub'|'connection', threshold}) helper that computes id sets and calls the existing condense() choreography, reusing convexity guard/animation.
- **Survey evidence:** https://github.com/visjs/vis-network (from memory, general knowledge, feature name confirmed by search snippet mentioning outside-in/inside-out clustering) (verified)
- **Repo check:** README.md/src use 'cluster' only to mean the author-declared containment/nesting hierarchy consumed by the layout engine (src/engine.js:106 'split leaves from clusters', :144 clusters = ids.filter(childrenOf.has)) — a static grouping given in the spec, not a runtime connectivity-based algorithm. No clusterByHubsize/clusterByConnection/clusterOutliers/openCluster equivalents found anywhere in src or types/index.d.ts.
- **Verifier note:** the word 'cluster' is present but names a different feature (nesting), not connectivity-based auto-grouping

### 4. Built-in manipulation/edit UI toolbar (add node, add edge by click-drag, edit/delete node or edge)

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network
- **What they offer:** options.manipulation:{enabled:true} renders an on-canvas toolbar letting end users add nodes, draw new edges by dragging from one node to another, edit or delete elements, with localization support and controlNodeStyle customization.
- **Why it matters here:** sparkle-motion-visualizer is spec-driven/programmatic only; no end-user graph-editing affordance exists, consistent with its narration/visualization focus, but worth flagging since some pipeline-authoring tools want a lightweight in-browser editor.
- **How it could fit:** Out of scope for a narration library, but a minimal preset (via the documented preset contract) exposing add/connect/delete gestures wired to addNode/addEdge/removeNode/removeEdge could be built as an optional companion package.
- **Survey evidence:** vis-network manipulation docs (verified via search) (verified)
- **Repo check:** README.md:151 'g.addNode(node,{after}) g.addEdge(edge) g.removeNode(id) g.removeEdge(id)' — these are programmatic API methods for scripted mutation (also used by storyboards, src/storyboard.js:10), not an on-canvas UI toolbar. No rendered add/edit/delete controls found in src/render.js or src/transport.js (transport.js only builds play/seek buttons).
- *Verifier's phrasing of the claim:* Built-in manipulation/edit UI toolbar

### 5. Multiple node shapes including images, icons, and HTML-like rendering

- **Category:** Rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network; Apache ECharts (symbol: image/path)
- **What they offer:** vis-network node shape option supports box, circle, ellipse, database, diamond, dot, star, triangle, image, circularImage, icon (fontawesome/material). ECharts graph nodes support symbol:'image://url' or SVG path strings for custom icon shapes.
- **Why it matters here:** sparkle-motion-visualizer explicitly documents rounded-rect only, no circles/diamonds/images — pipeline diagrams commonly want a service icon or status glyph per node.
- **How it could fit:** Could extend node.data with an optional icon/image field rendered as an <image>/<use> inside the existing rounded-rect box (additive, not a new shape system) rather than a full custom-shape API.
- **Survey evidence:** vis-network nodes docs; ECharts graph series symbol option (from memory, general knowledge of ECharts API) (verified)
- **Repo check:** src/render.js:153-155 shows every node is drawn as a single SVG 'rect' element (make('rect','smv-node-box')); grep for shape/circle/diamond/icon/image across src/render.js and types/index.d.ts finds no shape option or image/icon node type.
- **Verifier note:** nodes have rounded-rect corners (corner radius) but there is no alternate shape or image/icon rendering path

### 6. Configuration UI generator (interactive options panel)

- **Category:** Tooling · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network
- **What they offer:** vis-network's configure module (options.configure:{enabled:true}) auto-generates an on-page GUI of every configurable option with live preview, useful for tuning physics/layout during development.
- **Why it matters here:** Helps consumers tune nodesep/ranksep/theme without reading docs; sparkle-motion-visualizer has no analogous dev-time inspector.
- **How it could fit:** Could ship as a small opt-in dev preset that reads the documented opts schema and renders sliders calling g.layout()/g.theme() live.
- **Survey evidence:** vis-network docs (from memory; general feature, well known) (from memory / unverified)
- **Repo check:** grep for 'configure', 'options panel', 'gui' across README.md and src/*.js finds nothing resembling vis-network's auto-generated options GUI; the library's options are plain JS objects passed to mount()/layout(), no live-editing panel component exists in src/.

### 7. Sankey diagram flow layout (weighted flow-width bands between stages)

- **Category:** Layout / Rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Apache ECharts
- **What they offer:** ECharts sankey series lays out nodes in ordered columns with edges drawn as flow-proportional-width bands (edge value -> width), automatic node/edge label placement, and iterative crossing-reduction (layoutIterations).
- **Why it matters here:** sparkle-motion-visualizer's weight field only thickens a polyline and shows a badge; it does not render true proportional-flow-band edges (Sankey-style) which is a natural fit for showing volume/throughput between pipeline stages.
- **How it could fit:** Could be a rendering-mode option on edges (edgeStyle:'band') that scales stroke-width to weight already partially supported, extended to draw a trapezoidal band between node boundaries instead of a constant-width polyline.
- **Survey evidence:** https://github.com/apache/echarts-doc/blob/master/en/option/series/sankey.md (verified via search) (verified)
- **Repo check:** grep -rn 'sankey' over the whole repo (js and md files) returns zero matches; the layout engine (src/engine.js) is a single layered-DAG algorithm with no flow-width-by-edge-value mode.
- *Verifier's phrasing of the claim:* Sankey diagram flow layout

### 8. Multiple simultaneous graph-family layout algorithms (circular, radial/tree, orthogonal) selectable per chart

- **Category:** Layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Apache ECharts (graph: none/circular/force; tree: orthogonal/radial)
- **What they offer:** ECharts graph series layout option switches among 'none' (manual/fixed positions), 'circular' (ring arrangement), and 'force'; its separate tree series supports orient (LR/TB/etc.) plus layout:'orthogonal'|'radial' with curveness-controlled edge bends.
- **Why it matters here:** sparkle-motion-visualizer is explicitly layered/Sugiyama-only; no radial or circular layout family exists, which is a real, acknowledged limitation for org-chart or radial dependency views.
- **How it could fit:** Fits the existing pluggable LayoutSolver seam — a 'radial' or 'circular' solver could be added as an optional adapter package (like the dagre adapter) without touching the core engine.
- **Survey evidence:** ECharts graph/tree series docs (from memory, confirmed generally by search results mentioning force/circular layout) (verified)
- **Repo check:** README.md:120/384 describe exactly one layout mode: 'Layered layout, in-house ... cluster-aware ranking (longest path + a tightening pass), dummy [nodes]'. No 'circular', 'radial', or alternate layout option appears in types/index.d.ts's layout options or README.
- **Verifier note:** docs/PLAN.md:31 explicitly scopes out alternate layout algorithms as non-goals

### 9. Roam (independent pan/zoom scale and translate binding) with toolbox zoom/reset/restore controls

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** Apache ECharts
- **What they offer:** ECharts roam:true|'scale'|'move' plus a toolbox component offering dataZoom, restore (reset view), saveAsImage, and other one-click chart utilities rendered as clickable icons over the chart.
- **Why it matters here:** sparkle-motion-visualizer's fitView()/viewport API is programmatic only; there is no discoverable on-canvas reset/save button UI equivalent to a toolbox, though captions/transport bar exist for playback.
- **How it could fit:** A small optional toolbox preset (reset view, export PNG button) could be built on presetPipeline + existing fitView()/exportPNG() calls.
- **Survey evidence:** ECharts roam / toolbox docs (from memory, general ECharts knowledge) (from memory / unverified)
- **Repo check:** Pan/zoom itself exists (src/viewport.js: fit(), zoomBy(), pointer-drag pan, ctrl/cmd+scroll zoom per docs/INTERNALS.md:139) and g.fitView() (src/index.js:1021) resets the view programmatically, but there is no on-chart toolbox UI (no rendered reset/restore/save-as-image icon buttons) — fitView must be called from code, not clicked by the end user.
- **Verifier note:** the pan/zoom capability is present; the clickable toolbox chrome around it is what's missing
- *Verifier's phrasing of the claim:* Roam (independent pan/zoom) with toolbox zoom/reset/restore controls

### 10. Undirected edges / bidirectional arrow toggling as a first-class edge property

- **Category:** Data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network; Apache ECharts
- **What they offer:** vis-network edges.arrows can independently enable/disable arrowheads at 'to','middle','from', letting an edge render as undirected (no arrows) or bidirectional; ECharts graph edges likewise support symbol:['none','arrow'] per end.
- **Why it matters here:** sparkle-motion-visualizer's edge model implies directed source->target always (arrowheads always rendered); there's no documented way to render a relationship edge as undirected or bidirectional for non-pipeline (e.g. dependency/association) diagrams.
- **How it could fit:** Could add an edge.data.arrows or edge-level style token (--smv-arrow-to/--smv-arrow-from display:none) toggled via g.style/g.props rather than a new spec field.
- **Survey evidence:** vis-network edges docs (verified via search) (verified)
- **Repo check:** src/render.js:4 'Arrowheads are hand-drawn triangles' and :196-201 every edge unconditionally gets an arrow element appended (e = {g,line,arrow,...}); grep for 'arrows' in types/index.d.ts returns no per-end arrow toggle option (no arrows.to/from/middle-style field found).

### 11. Legend / category-based color coding with click-to-filter

- **Category:** Interaction / Rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Apache ECharts
- **What they offer:** ECharts graph series categories array plus a legend component: nodes tagged with a category get an auto-generated color-coded legend; clicking a legend entry toggles visibility of all nodes/edges in that category.
- **Why it matters here:** For pipelines with many node 'types' (services, stages, teams), a legend + click-to-filter is a common way to declutter a large graph — sparkle-motion-visualizer has no legend component and no group/category visibility toggle, only spotlight/dim emphasis driven programmatically.
- **How it could fit:** Could be a preset built on g.nodes(filter)/g.props() to dim non-matching categories, plus a simple DOM legend reading node.data.category — no core API change needed.
- **Survey evidence:** ECharts graph categories/legend (from memory, general ECharts knowledge) (from memory / unverified)
- **Repo check:** grep -rniE 'legend|categor' over README.md and src/*.js returns no matches; styling is via variant/theme tokens (docs/THEMING.md) applied per-node/edge in the spec, not an auto-generated clickable legend component.

### 12. Search/highlight-by-text box over the rendered graph

- **Category:** Interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network (community add-ons); ECharts (via legend/tooltip search patterns)
- **What they offer:** Common pattern (via vis-network examples and various dashboard integrations) of a text input that highlights/filters matching nodes by label, dimming the rest.
- **Why it matters here:** sparkle-motion-visualizer has g.nodes(filter) for programmatic querying and emphasis/spotlight via g.highlight(), but no built-in search-box widget wiring text input to spotlight.
- **How it could fit:** Straightforward preset: text input -> g.nodes({label: substringMatch}) -> g.props()/highlight with dim:true. Very small addition, high reuse of existing primitives.
- **Survey evidence:** from memory (common vis-network example pattern, not independently re-verified this pass) (from memory / unverified)
- **Repo check:** No search/filter/highlight-by-label UI or helper found in src/; g.query() and src/query.js were checked for a text-search/highlight API distinct from structural graph queries — README and types/index.d.ts show query.js is a structural graph-traversal query API, not a text-match highlight box.
- **Verifier note:** src/query.js exists but serves graph traversal queries (ancestors/descendants/paths), not a rendered search input

### 13. Graph analytics: shortest path, centrality/hub detection used to drive clustering

- **Category:** Analytics · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network (hub-based clustering implies degree centrality)
- **What they offer:** vis-network's clusterByHubsize computes a degree-centrality ranking internally to pick hub nodes for clustering; broader graph-analysis libraries in this space (and typical vis-network + graphology combos) expose shortest-path/centrality separately.
- **Why it matters here:** sparkle-motion-visualizer's querying category explicitly states no path-finding/graph-algorithm queries exist — flagged in its own knownLimits, and the cohort (vis-network's hub clustering) is a mild example of this class of feature.
- **How it could fit:** Out of scope for a rendering/narration library per its own design philosophy; likely stays a documented non-goal rather than something to build.
- **Survey evidence:** vis-network clustering docs (from memory, degree/hub concept implied by 'hubsize' method name, confirmed generally by search) (from memory / unverified)
- **Repo check:** grep -rniE 'shortest|centrality|hub' over src/*.js and README.md returns no matches (only an unrelated 'github:' URL hit); src/query.js/src/cycles.js provide cycle detection and structural queries for layout purposes but no shortest-path or centrality computation is exposed.

### 14. Multiple simultaneous chart/series composition (graph overlaid with other chart types, e.g., graph + bar axis)

- **Category:** Rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Apache ECharts
- **What they offer:** Because ECharts is a general charting library, a graph series can be combined in one chart instance alongside other series (e.g., a legend, a title, tooltip formatter shared with bar/line series) via the unified option object.
- **Why it matters here:** Not very relevant to a pipeline-narration tool; sparkle-motion-visualizer is single-purpose (graph only) by design, which is appropriate for its remit.
- **How it could fit:** Not recommended — would break the library's zero-dependency, single-purpose scope.
- **Survey evidence:** general ECharts knowledge (from memory) (from memory / unverified)
- **Repo check:** This is a single-purpose graph/pipeline visualizer (per README.md and docs/PLAN.md) with one scene type; there is no series/chart-type abstraction in src/scene.js or types/index.d.ts that would allow composing a bar/line chart alongside the graph.
- *Verifier's phrasing of the claim:* Multiple simultaneous chart/series composition (graph overlaid with other chart types)

### 15. Rich hover tooltips with custom HTML/formatter content

- **Category:** Interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network (title property, HTML/DOM element); Apache ECharts (tooltip.formatter); Plotly.js (hovertemplate/hoverinfo on scatter traces)
- **What they offer:** vis-network node/edge 'title' accepts a string or DOM element shown as a hover tooltip; ECharts tooltip.formatter allows custom HTML per node/edge; Plotly hovertemplate lets each point/edge segment show arbitrary formatted text (including from customdata arrays).
- **Why it matters here:** sparkle-motion-visualizer explicitly documents 'no built-in tooltip system' as a known limit — this is a very common ask for pipeline diagrams (show duration/status detail on hover) and all three cohort libraries support it out of the box.
- **How it could fit:** Fits well as an optional preset: a small DOM tooltip layer subscribing to pointerenter/pointerleave on .smv-node, reading node.data, rendered as absolutely-positioned HTML — consistent with the existing 'preset system, no core reach-in' contract.
- **Survey evidence:** vis-network 'title' property, ECharts tooltip component, Plotly hovertemplate — general/common knowledge (from memory) (from memory / unverified)
- **Repo check:** grep -rniE 'tooltip|title' across README.md, src/*.js, types/index.d.ts finds only the transport bar's button 'title' attributes (src/transport.js:26-30, native HTML tooltip on play/pause icons) and unrelated 'subtitle' text-recording features — no node/edge hover tooltip or formatter API exists.

### 16. Box/rubber-band multi-select of nodes

- **Category:** Interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network (getSelectedNodes + selectionBox community patterns); ECharts (brush component: brushSelect over graph/scatter series)
- **What they offer:** ECharts brush component lets a user drag a rectangle/lasso to select multiple data points across a chart, firing brushSelected events; vis-network exposes selectNodes()/getSelection() APIs commonly paired with a drag-select UI.
- **Why it matters here:** sparkle-motion-visualizer's knownLimits explicitly say no multi-select/selection API exists beyond read-only query sugar — this is a real, acknowledged gap versus the cohort.
- **How it could fit:** Could add an opt-in interaction mode (interaction:{boxSelect:true}) emitting a 'select' bus event with matched node ids, letting presets (e.g., a bulk-highlight tool) subscribe without new core state beyond a transient selection set.
- **Survey evidence:** ECharts brush component (from memory, general knowledge); vis-network selection API (from memory) (from memory / unverified)
- **Repo check:** grep -rniE 'select|brush|rubber' over src/interact.js and README.md finds no selectNodes/getSelection/brush API or drag-rectangle selection handler; src/interact.js implements pan/zoom pointer handling only.

### 17. Context menu (right-click) on nodes/edges

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network (community pattern via oncontext event); ECharts (contextmenu event on chart instance)
- **What they offer:** Both libraries expose a raw contextmenu/oncontext DOM event hook that consumers wire up to custom right-click menus (not a built-in styled menu, but the event plumbing is documented).
- **Why it matters here:** sparkle-motion-visualizer's own knownLimits explicitly say 'No context menu support' — worth noting the cohort at least exposes the raw event, even if not a full built-in menu component.
- **How it could fit:** Minimal: expose the underlying SVG element's native contextmenu event (already fires natively) plus a documented way to resolve which node/edge was targeted (data-id attribute lookup) — likely just a doc addition, not new code.
- **Survey evidence:** from memory, general knowledge of vis-network 'oncontext' event and ECharts chart-level DOM events (from memory / unverified)
- **Repo check:** grep -rniE 'contextmenu|oncontextmenu' over the whole src/ and README.md returns zero matches — no right-click event hook is wired to nodes or edges.

### 18. Zoom-to-fit / auto-scale with automatic re-fit as data streams in (live-updating bounds tracking)

- **Category:** Interaction · **Fit:** 1/5 · **Verified in repo:** `present`
- **Who has it:** ECharts (dataZoom auto-adjust, graph roam auto); vis-network (fit() method + stabilizationIterationsDone auto-fit)
- **What they offer:** vis-network calls network.fit() automatically once physics stabilizes on load; ECharts dataZoom can be configured to track new data ranges.
- **Why it matters here:** sparkle-motion-visualizer already has fitView()/anchor() and an explicit auto-refit-until-first-camera-op behavior documented, so this is only a partial gap (continuous auto-refit as nodes stream in over time via addNode, vs one-shot).
- **How it could fit:** Likely already substantially covered; not worth much design effort — mostly a documentation nuance, not a functional gap.
- **Survey evidence:** from memory, general knowledge (from memory / unverified)
- **Repo check:** src/index.js:329 'if (!viewport.userMoved && !viewport.contains(res.bounds)) viewport.fit(res.bounds, {pad:24, duration:dur})' — the library automatically re-fits the view on layout/data changes unless the user has manually panned/zoomed, and exposes g.fitView() (src/index.js:1021) for manual triggering.
- **Verifier note:** this is a genuine present feature, contrary to the claim
- *Verifier's phrasing of the claim:* Zoom-to-fit / auto-scale with automatic re-fit as data streams in

### 19. URL/state serialization for shareable views (deep-linking to a specific pan/zoom/selection state)

- **Category:** Export · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Plotly.js (figure JSON + view state in layout, commonly serialized to URL by dashboards); ECharts (getOption()/setOption() round-trip, commonly used for shareable state)
- **What they offer:** Plotly figures are fully JSON-serializable (data+layout) including axis ranges/camera, which dashboard integrators commonly persist to a URL query param or local storage for shareable views; ECharts' getOption()/setOption() offers the same round-trip.
- **Why it matters here:** sparkle-motion-visualizer has g.spec() (structural snapshot) and storyboard JSON, but no documented single call to capture+restore full view state (camera position/zoom, emphasis, expanded/collapsed set) as one shareable blob distinct from a full storyboard.
- **How it could fit:** Could add a g.viewState()/g.restoreViewState() convenience combining bounds/camera transform + collapsed-node ids + current props/style overrides, useful for deep links without authoring a full storyboard.
- **Survey evidence:** from memory, general knowledge of Plotly/ECharts JSON round-trip patterns (from memory / unverified)
- **Repo check:** grep -rniE 'getOption|setOption|serializ|deep-?link' over src/*.js and types/index.d.ts finds only exportSVG's DOM-serialization helper (src/export.js:26, unrelated to view-state) and g.spec() which returns the graph structure spec, not viewport/pan/zoom/selection state; no toJSON/fromJSON round-trip of camera or selection state exists.
- *Verifier's phrasing of the claim:* URL/state serialization for shareable views (deep-linking to pan/zoom/selection state)

### 20. 3D graph rendering (WebGL) for network layouts

- **Category:** Rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Plotly.js (Scatter3d for 3D network layouts); ECharts (via echarts-gl extension, graphGL series)
- **What they offer:** Plotly supports go.Scatter3d for 3D-positioned nodes/edges (common with spring_layout in 3D via networkx); ECharts-GL adds a graphGL series with WebGL-rendered 3D force layouts.
- **Why it matters here:** Not relevant to this library's remit (2D SVG pipeline diagrams); flagged as explicitly out of scope.
- **How it could fit:** Not recommended — would require an entirely different renderer, contrary to the library's documented SVG-only, no-canvas/WebGL design decision.
- **Survey evidence:** from memory, general knowledge (Plotly Scatter3d, echarts-gl) (from memory / unverified)
- **Repo check:** grep -rniE 'webgl|3d|scatter3d' over src/ and README.md returns no matches; docs/research/rendering.md explicitly chose 'native SVG' over Canvas/WebGL as the sole rendering technology (docs/research/rendering.md:7), so no WebGL/3D layer exists.
- *Verifier's phrasing of the claim:* 3D graph rendering (WebGL)

### 21. Static image/PDF export triggered from within the chart UI (saveAsImage toolbox button)

- **Category:** Export · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** Apache ECharts (toolbox.feature.saveAsImage); Plotly.js (built-in camera/download-image mode bar button)
- **What they offer:** Both ship a built-in, end-user-facing 'download as PNG' button in their default chart chrome, no code required by the integrator beyond enabling the toolbox/modebar.
- **Why it matters here:** sparkle-motion-visualizer has exportSVG/exportPNG as programmatic ESM APIs, but no built-in UI button exposing this to the end viewer directly in the mounted graph chrome.
- **How it could fit:** Could add an optional opts.controls addition (an export button next to the transport bar) that calls the existing exportPNG/exportSVG functions — small, additive, reuses existing export code.
- **Survey evidence:** ECharts toolbox.saveAsImage, Plotly modebar (from memory, general/common knowledge of both libraries' default UI chrome) (from memory / unverified)
- **Repo check:** exportSVG/exportPNG exist as programmatic functions (src/export.js:39-182, 'exportSVG(g,opts) -> string', 'exportPNG(g,opts) -> Promise<Blob>') and bin/smv-record.mjs offers CLI-driven export/recording, but these must be invoked from code/CLI — grep of src/render.js and src/transport.js shows no rendered 'save as image' button in the on-chart UI chrome (the transport bar only has play/seek/pause controls, src/transport.js:26-30).
- **Verifier note:** the export capability exists and is documented (docs/RECORDING.md) but is not a one-click in-chart UI control like ECharts'/Plotly's toolbox/modebar button
- *Verifier's phrasing of the claim:* Static image/PDF export triggered from within the chart UI (built-in toolbox button)

### 22. Edge bundling / curved multi-edge separation between adjacent nodes

- **Category:** Rendering · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** vis-network (smooth curve types: curvedCW/curvedCCW auto-separate parallel edges); Apache ECharts (edge curveness auto-offset for graph series)
- **What they offer:** vis-network's smooth.type with roundness automatically bends multiple parallel edges apart into a fan so overlapping edges between the same node pair remain visually distinct; ECharts graph edges expose a per-edge curveness value achieving the same.
- **Why it matters here:** This directly matches an explicit, self-reported gap in sparkle-motion-visualizer: parallel/multi-edges between adjacent ranks render as coincident overlapping polylines, a capability the library states it lost versus dagre and has 'not planned' to fix at the solver level.
- **How it could fit:** The library's own notes suggest this is a rendering-layer fix, not a solver fix — matches vis-network/ECharts's approach of applying a curveness offset purely at draw time per duplicate (source,target) pair, without touching rank/order computation.
- **Survey evidence:** vis-network smooth curve docs (verified via search, confirmed in earlier vis-network results); ECharts edge curveness (from memory) (verified)
- **Repo check:** src/render.js draws edges as straight/clipped line paths (clipEnds, line ~419-421) with no curveness/smooth.type/roundness option; grep -rniE 'curve|bundl|parallel.*edge' over src/*.js and README.md finds no per-edge curvature or automatic fan-out of parallel edges between the same node pair.

### 23. Tree series with dedicated radial and orthogonal collapsible tree layout, distinct from general graph layout

- **Category:** Layout · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** Apache ECharts (series: 'tree')
- **What they offer:** ECharts ships a separate 'tree' series purpose-built for strict hierarchies: collapsible subtrees (click to expand/collapse per node, initialTreeDepth), orient (LR/RL/TB/BT), layout 'orthogonal' or 'radial', and edgeShape 'curve'|'polyline'.
- **Why it matters here:** sparkle-motion-visualizer already has compound containers and expand/collapse, but that's for container/aggregation semantics, not a strict single-parent tree layout family (radial tree, click-anywhere-to-collapse-subtree) — a distinct, unaddressed layout mode.
- **How it could fit:** Could be a 'radial-tree' LayoutSolver adapter for pure-tree GraphSpecs (single parent per node, no cycles), analogous to the dagre adapter, reusing existing expand/collapse animation machinery.
- **Survey evidence:** ECharts tree series docs (from memory, general ECharts knowledge, category confirmed via earlier search results distinguishing tree from graph series) (from memory / unverified)
- **Repo check:** The library does support expand/collapse of container/cluster nodes (src/render.js nodeEls tracks a 'collapsed' state per node, and docs mention 'condense'/expand-collapse as a core differentiator per docs/research/landscape.md:17e — 'bake expand/collapse ... into our core'), but this is collapse of nested containers within the single layered-DAG layout, not a separate tree series with selectable orient (LR/TB) or layout:'orthogonal'|'radial' with edgeShape curve/polyline — no 'radial' or 'orthogonal' layout keyword found anywhere in src/engine.js or types/index.d.ts.
- **Verifier note:** expand/collapse of compound nodes exists; the radial/orthogonal tree-specific layout variants do not
- *Verifier's phrasing of the claim:* Tree series with dedicated radial and orthogonal collapsible tree layout

## Borrowable ideas

- vis-network's DataSet/DataView pattern (reactive, subscribable collections with get/add/update/remove and DataView as a filtered live projection) is a cleaner mental model than raw addNode/removeNode calls for consumers managing large mutable datasets — worth considering as a thin optional wrapper over g.spec()/g.on('commit').
- ECharts' single declarative `option` object (setOption/getOption round-trip) as the whole chart state is a simple pattern for 'get current visual state as JSON, restore it later' — informs the suggested g.viewState()/restoreViewState() gap above.
- vis-network's per-edge smooth.roundness auto-fanning of parallel edges is a targeted, minimal fix directly applicable to this library's own documented parallel-edge-coincidence limitation.
- ECharts categories[] + auto-legend + click-to-toggle-visibility is a very cheap high-value UX pattern (color-code by node.data.category, click legend entry to dim/undim) buildable entirely on existing g.style()/g.highlight() primitives.
- Plotly's hovertemplate/customdata pattern (arbitrary per-point formatted text driven by a data field) is a good template for a future tooltip preset: read node.data via a user-supplied formatter function rather than a fixed label+status string.
- vis-network's cluster()/openCluster() naming (verb pair for group/ungroup) is a clean precedent if this library ever adds automatic (non-author-declared) grouping alongside its manual condense()/split().
- ECharts' toolbox component (small row of icon buttons: saveAsImage, restore/reset view, dataZoom) is a good compact UI-chrome pattern to extend the existing transport bar with export/reset buttons.
- vis-network's stabilizationProgress/stabilizationIterationsDone events (progress signal during an expensive computed operation) is a good precedent for exposing layout-computation progress events on very large graphs, if layout time ever becomes visible to users.

## Survey notes

Web fetch access to visjs.github.io was blocked by the egress proxy, so several vis-network specifics (smooth curve types, edges.arrows, manipulation, navigationButtons, hierarchical layout options) come from WebSearch result snippets that quoted the docs directly (marked verified:true) rather than a full page fetch. ECharts and Plotly claims not directly quoted in search snippets are marked verified:false and flagged 'from memory' per instructions; these are standard, long-documented features of both libraries (graph series layout modes, tooltip formatter, roam, categories/legend, edge curveness, toolbox) but were not re-confirmed via a fresh fetch in this pass. Versions confirmed via npm/libraries.io search: vis-network 10.1.2 (dual Apache-2.0/MIT), Apache ECharts 6.1.0 (Apache-2.0), Plotly.js 3.7.0 (MIT). Plotly has no dedicated 'network graph' chart type — it is conventionally built manually from go.Scatter node/edge traces (often via networkx for layout), so most Plotly-specific gaps identified are about general Plotly.js capabilities (hovertemplate, Scatter3d, JSON round-trip) applied to that manual pattern rather than a packaged network-graph feature set.
