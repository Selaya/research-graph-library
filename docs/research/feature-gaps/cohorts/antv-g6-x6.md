# Cohort survey: antv-g6-x6
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** AntV G6 v5 (combos, behaviors, plugins, animations, themes, layouts) and AntV X6 (ports, stencil, snapline, history, keyboard, clipboard, selection, minimap, dnd)

**Verification tally:** 26 claimed gaps: 17 missing, 9 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| @antv/g6 | 5.1.1 (v5 line) | MIT | https://g6.antv.antgroup.com/ | yes | Graph visualization framework in JS/TS with combos, layouts, behaviors, plugins, Canvas/SVG/WebGL rendering |
| @antv/x6 | 3.1.8 | MIT | https://x6.antv.antgroup.com/ | yes | JavaScript graph editing engine (flowchart/DAG/ER/UML editor building blocks: ports, stencil, snapline, history, keyboard, clipboard, selection, minimap, dnd) |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Ports / connection points with typed link validation

- **Category:** data model / interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** X6
- **What they offer:** X6 nodes declare `ports: {groups:{...}, items:[{id,group}]}` with per-group position (top/bottom/left/right/absolute), markup, and label placement; edges can source/target a specific port id (not just a node), and `connecting.validateConnection`/`validateMagnet` callbacks gate which port-to-port links are allowed (e.g. only 'out' ports connect to 'in' ports).
- **Why it matters here:** This library's inventory explicitly notes edges attach node-to-node only, with no multi-connection-point concept — a pipeline library modeling e.g. multiple named outputs (success/failure/timeout) from one step could use ports to give each a distinct anchor point and validated connection rules instead of one node-level edge bundle.
- **How it could fit:** Could extend NodeSpec with an optional `ports: {id, side}[]` array and let EdgeSpec.source/target accept 'nodeId:portId'; layout engine would need a per-port attach offset instead of node-center attach.
- **Survey evidence:** https://x6.antv.antgroup.com/en/tutorial/plugins/stencil (search snippet) + from memory of X6 ports API (verified)
- **Repo check:** types/index.d.ts NodeSpec/EdgeSpec (lines 11-50) have no port concept; grep for 'port' across src/types/README returns nothing related to connection points.
- *Verifier's phrasing of the claim:* Ports / typed connection-point validation

### 2. Interactive node dragging / free repositioning

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6; X6
- **What they offer:** Both libraries support dragging nodes by pointer via built-in behaviors (G6: 'drag-element' / 'drag-canvas' behaviors; X6: node dragging is core, plus a Transform plugin for resize/rotate handles).
- **Why it matters here:** This library's inventory explicitly states layout is entirely computed with no user drag/reposition — for ad-hoc pipeline exploration or manual layout touch-ups, users of the cohort libraries can nudge a node and have edges follow live.
- **How it could fit:** Would conflict with the library's deterministic-layout/order-stability design goal (D-something); could be offered as an opt-in `interaction: {dragNode: true}` that locally overrides computed position via a 'pin' concept without disturbing relayout of siblings, similar to G6's combo drag.
- **Survey evidence:** from memory + WebSearch snippet confirming X6 core node dragging and G6 behaviors list (verified)
- **Repo check:** src/interact.js (69 lines) only implements attachTapToggle (tap to expand/collapse a container node); no drag/pointermove reposition logic exists in src/render.js or src/viewport.js, which only handle pan/zoom of the viewport, not node dragging.

### 3. Box/lasso multi-select and Selection plugin

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** X6; G6
- **What they offer:** X6's Selection plugin supports rubber-band box-select, ctrl/shift multi-select, and a `getSelectedCells()` API; G6 has a 'brush-select' behavior for lasso selection over nodes/edges.
- **Why it matters here:** This library's inventory explicitly notes no multi-select or selection API/state beyond read-only query sugar — a narration/authoring tool built on top of this library (e.g. a storyboard editor) would want to select several nodes to batch-apply a highlight/props op.
- **How it could fit:** Could add a `g.select(ids)`/`g.selection()` read/write state plus a `selection:true` interaction option driving a lasso, feeding director ops (highlight/props) with the current selection as a convenience.
- **Survey evidence:** WebSearch snippet: 'Lasso selection' listed as X6 extension; G6 behavior list 'brush-select' from memory (verified)
- **Repo check:** types/index.d.ts:494 HighlightSelection / EmphasisVariant supports a 'focus' selection set with spotlight dimming (data-dim), driven programmatically via g.highlight()-style API, but there is no pointer-driven rubber-band box-select or ctrl/shift click multi-select in src/interact.js or src/events.js.
- *Verifier's phrasing of the claim:* Box/lasso multi-select + Selection API

### 4. Undo/redo history stack

- **Category:** interaction / editing · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** X6; G6 (history plugin)
- **What they offer:** X6's History plugin and G6's 'history' plugin track command stacks and expose undo()/redo()/canUndo()/canRedo(), typically wired to Ctrl+Z/Ctrl+Y.
- **Why it matters here:** Neither this library's mutation API nor its storyboard system offers undo of structural edits made outside the storyboard (e.g. live g.addNode calls during interactive authoring) — relevant if this library is ever used interactively rather than purely as a playback/narration engine.
- **How it could fit:** Out of scope for a narration/playback-focused library, but could be a thin optional preset that snapshots g.spec() before each mutation call and offers g.undo()/g.redo().
- **Survey evidence:** WebSearch snippet listing X6 History plugin and G6 'history' plugin (verified)
- **Repo check:** types/index.d.ts MutationResult (line 123) documents cancel() on awaitables for in-flight animation, not a command history; no undo/redo/canUndo/canRedo symbols found anywhere in types/index.d.ts, src/, or README.md.

### 5. Keyboard shortcut plugin for editing operations (delete/copy/paste/undo)

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `partial`
- **Who has it:** X6
- **What they offer:** X6's Keyboard plugin binds configurable key combos (delete, ctrl+c/v, ctrl+z) to graph editing commands, layered with the Clipboard plugin for copy/paste of cells (including their ports/data).
- **Why it matters here:** This library's inventory notes keyboard nav is read/navigation-only (arrows, Home/End, Enter/Space to toggle) with no editing shortcuts — again mainly relevant if used as an interactive editor rather than a narration viewer, which is this library's stated remit.
- **How it could fit:** Low priority given this library's viewer/narration focus, not an editor; could be left to a consumer preset.
- **Survey evidence:** WebSearch snippet confirming X6 Keyboard + Clipboard plugins (verified)
- **Repo check:** README.md:379 and src/a11y.js provide keyboard NAVIGATION (arrow keys/treeitem focus) for accessibility, but there is no keybinding for delete/copy/paste/undo editing commands anywhere in src/.
- *Verifier's phrasing of the claim:* Keyboard shortcut plugin (delete/copy/paste/undo)

### 6. Clipboard (copy/paste subgraphs)

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** X6
- **What they offer:** X6 Clipboard plugin copies selected cells (with descendants/edges) and pastes with new ids and an offset, optionally cross-graph.
- **Why it matters here:** Not aligned with this library's declarative-spec/playback model; flagged for completeness only.
- **How it could fit:** Out of scope; the library's condense()/split() choreography is a closer analog to structural graph surgery than clipboard duplication.
- **Survey evidence:** WebSearch snippet (verified)
- **Repo check:** No 'clipboard', 'copy', or 'paste' symbols in types/index.d.ts or src/; the library's mutation API (g.update/g.add/g.remove per README:152) has no copy/paste helpers.

### 7. Stencil / drag-and-drop node palette for building graphs

- **Category:** interaction / authoring · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** X6
- **What they offer:** X6 Stencil plugin renders a sidebar of draggable shape templates (grouped, collapsible, searchable) that can be dropped onto the canvas to create new nodes, built atop a lower-level Dnd plugin.
- **Why it matters here:** Irrelevant to a spec-driven visualization/narration library where the graph is always defined programmatically or via JSON, not built interactively by dragging shapes.
- **How it could fit:** Out of scope by design (D: spec-first, no visual authoring).
- **Survey evidence:** WebSearch snippet: 'Stencil is a further encapsulation based on Dnd, providing a sidebar-like UI component' (verified)
- **Repo check:** No stencil/palette/dnd-related files in src/, demo/, or README.md; demo/ files (m0.html, m2.html, m3-scale.html, pipeline.html, sdlc.html) are static pipeline visualizations, not editors.
- *Verifier's phrasing of the claim:* Stencil / drag-and-drop node palette

### 8. Context menu (right-click menu)

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (contextmenu plugin); X6 (community/contextmenu pattern)
- **What they offer:** G6 ships a built-in 'contextmenu' plugin that renders a configurable menu of actions on right-click over nodes/edges/canvas.
- **Why it matters here:** This library's inventory explicitly lists 'no context menu support' as a known limit — directly matches this gap category the task asked to check.
- **How it could fit:** Could be a small optional preset (`presetContextMenu`) built on the documented preset contract (g.on('commit',...) + g.spec()), consistent with the library's plugin/preset seam, rather than a core feature.
- **Survey evidence:** WebSearch result listing G6 v5 built-in plugins including 'contextmenu' (verified)
- **Repo check:** grep for 'contextmenu'/'context menu' across src/ and README.md returns nothing; src/events.js exposes GraphEventMap (index.d.ts:593) with run/mutation events only, no contextmenu event.
- *Verifier's phrasing of the claim:* Context menu (right-click)

### 9. Tooltip plugin

- **Category:** interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (tooltip plugin)
- **What they offer:** G6's built-in 'tooltip' plugin shows a positioned DOM tooltip on hover/click over a node or edge, driven by a render callback over the element's data.
- **Why it matters here:** This library's inventory explicitly states 'no built-in tooltip system' as a known limit — direct match.
- **How it could fit:** Fits the documented preset contract; a `presetTooltip(g, {render})` shipped as an optional entry point (like preset-pipeline) would be a natural, low-risk addition without growing the core bundle.
- **Survey evidence:** WebSearch result: G6 v5 built-in plugins list includes 'tooltip' (verified)
- **Repo check:** No 'tooltip' symbol anywhere in src/, types/index.d.ts, or README.md.

### 10. Minimap / navigator overview panel

- **Category:** interaction / navigation · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (minimap plugin); X6 (MiniMap plugin)
- **What they offer:** Both ship a minimap plugin: a small overview render of the whole graph with a draggable viewport rectangle synced to the main canvas pan/zoom.
- **Why it matters here:** For large pipeline graphs (this library already engineers for 150+ element culling), a minimap is a standard large-graph navigation aid this library has no equivalent of.
- **How it could fit:** Could be built as an optional preset using g.bounds()/g.layoutResult() + viewport.screenToWorld/worldToScreen + g.on('commit') to redraw a small synced SVG, all public API already exists to build this outside core.
- **Survey evidence:** WebSearch: G6 plugin list includes 'minimap'; X6 'MiniMap' plugin confirmed (verified)
- **Repo check:** src/viewport.js implements pan/zoom of the single canvas only; no minimap/navigator/overview code or CSS class (e.g. .smv-minimap) found in src/ or styles.js.

### 11. Toolbar plugin (built-in UI controls for common graph actions)

- **Category:** UI/interaction · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** G6 (toolbar plugin); X6 (Toolbar UI)
- **What they offer:** G6/X6 ship a configurable toolbar UI (zoom in/out/fit/undo/redo/delete buttons) as a plugin, separate from any transport/timeline controls.
- **Why it matters here:** This library only has a transport bar (play/pause/scrub) for Mode A playback; no zoom/fit UI chrome is built in (fitView etc. are programmatic only).
- **How it could fit:** Small optional preset wrapping fitView()/viewport.zoomBy() as buttons would fit the existing preset pattern.
- **Survey evidence:** WebSearch snippets naming G6 'toolbar' plugin and X6 Toolbar UI page (verified)
- **Repo check:** README.md documents a mounted `.smv-transport` control (play/pause/step/scrub/speed, MountOpts transport at types/index.d.ts:290) for RUN playback, but no generic graph-editing toolbar (zoom in/out/fit/undo/redo/delete) exists; src/transport.js is playback-only.
- *Verifier's phrasing of the claim:* Toolbar plugin (zoom/fit/undo/redo/delete UI)

### 12. Fisheye / focus+context distortion lens

- **Category:** rendering / interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (fisheye plugin)
- **What they offer:** G6's 'fisheye' plugin magnifies a region around the cursor in place, a focus+context technique for exploring dense graphs without zooming.
- **Why it matters here:** No equivalent distortion/lens technique exists in this library; relevant only as a dense-graph exploration aid, tangential to a pipeline-narration tool's goals.
- **How it could fit:** Would require canvas-space post-transform per node near cursor — significant new rendering complexity, low priority.
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'fisheye' (verified)
- **Repo check:** No 'fisheye' or lens-distortion code in src/ or README.md; CameraTarget (index.d.ts:469) supports simple pan/zoom-to-node framing only, not local magnification.
- *Verifier's phrasing of the claim:* Fisheye / focus+context lens

### 13. Hull / bubble-sets set visualization around arbitrary node groups

- **Category:** rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (hull, bubble-sets plugins)
- **What they offer:** G6's 'hull' plugin draws a convex/concave boundary around an arbitrary (non-hierarchical) subset of nodes; 'bubble-sets' draws smooth organic set boundaries, useful for showing ad-hoc groupings that aren't parent/child containers.
- **Why it matters here:** This library's only grouping mechanism is the strict parent/container hierarchy; hull/bubble-sets let you visually group nodes that cut across the tree (e.g. 'all nodes owned by team X') without restructuring the graph.
- **How it could fit:** Could be an optional preset drawing an SVG path behind the node layer, computed from g.nodes(filter) positions each commit — doesn't require core changes since node positions are already queryable via g.layoutResult().
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'bubble-sets' and 'hull' (verified)
- **Repo check:** No 'hull' or 'bubble' symbols in src/, types/, or README.md; the only grouping concept is container nodes (parent/child, viewstate.isContainer per src/interact.js:48), not arbitrary set overlays.
- *Verifier's phrasing of the claim:* Hull / bubble-sets grouping visualization

### 14. Grid-line / background canvas plugins

- **Category:** rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (grid-line, background plugins)
- **What they offer:** G6 ships 'grid-line' (a graph-paper style background grid, often snapping-related) and 'background' (custom canvas background image/color) plugins.
- **Why it matters here:** Minor visual polish item not covered by this library's CSS-custom-property theming (which controls node/edge/text colors but not a canvas-wide grid backdrop).
- **How it could fit:** Trivial to add as a CSS background pattern on .smv-root; doesn't need a plugin architecture.
- **Survey evidence:** WebSearch: G6 plugin list includes 'grid-line', 'background' (verified)
- **Repo check:** No grid-line or configurable background-image/color plugin; src/styles.js defines theme colors (light/dark/auto) for the graph chrome itself, not a canvas backdrop feature.

### 15. Legend plugin

- **Category:** rendering / UI · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (legend plugin)
- **What they offer:** G6's 'legend' plugin auto-generates a legend UI mapping node/edge categorical styles (color/shape) to labels.
- **Why it matters here:** This library's data-* / status vocabulary (done/active/failed/blocked/etc.) has no built-in legend to explain the color coding to viewers of an exported video or embed, which matters for narration-style output aimed at an audience.
- **How it could fit:** Could be a small optional caption-adjacent overlay reading g.nodes() distinct statuses + the current theme's CSS variables; fits naturally next to the existing caption overlay concept.
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'legend' (verified)
- **Repo check:** No 'legend' symbol found in src/, types/index.d.ts, or README.md.

### 16. Watermark plugin

- **Category:** rendering / export · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (watermark plugin)
- **What they offer:** G6's 'watermark' plugin overlays a repeated text/image watermark across the canvas.
- **Why it matters here:** Tangential; could matter for exported videos/screenshots wanting attribution/branding, but not core to pipeline visualization.
- **How it could fit:** Trivial CSS/SVG overlay, doesn't need special API.
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'watermark' (verified)
- **Repo check:** No 'watermark' symbol found anywhere in the repo.

### 17. Fullscreen plugin

- **Category:** UI · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (fullscreen plugin)
- **What they offer:** G6's 'fullscreen' plugin toggles the browser Fullscreen API on the graph container.
- **Why it matters here:** Minor convenience gap; embeds/presentations might want a one-call fullscreen toggle.
- **How it could fit:** Two lines of wrapper code around requestFullscreen(); trivial to add as a small opts flag or documented snippet rather than a library feature.
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'fullscreen' (verified)
- **Repo check:** No 'fullscreen' symbol or Fullscreen API usage found in src/ or README.md.

### 18. Timebar plugin (time-axis scrub/filter control bound to node/edge time fields)

- **Category:** time / interaction · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** G6 (timebar plugin)
- **What they offer:** G6's 'timebar' plugin renders a time-axis slider (optionally with a mini chart) that filters or highlights which nodes/edges are visible/active based on a time-valued data field, distinct from any execution/animation timeline.
- **Why it matters here:** This library's transport bar scrubs Mode A/B run time, but has no independent 'filter graph by a time-range field on the data' control (e.g. show only nodes created before date X) — a genuinely different feature from run playback.
- **How it could fit:** Could map to a filter predicate applied via a G.nodes(filter)-driven visibility toggle bound to a slider, exposed as an optional preset rather than core, since it's data-filtering not execution-time.
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'timebar' (verified)
- **Repo check:** README.md documents a `.smv-transport` play/pause/step/scrub/speed control (types/index.d.ts Timeline interface, line 569) bound to the RUN execution timeline (progress/status over run events), which is a time-axis scrub UI — but it drives animation playback of a fixed run, not filtering/highlighting nodes by an arbitrary data time-field as G6's timebar does.
- *Verifier's phrasing of the claim:* Timebar plugin (time-axis scrub/filter)

### 19. Multiple concrete layout algorithm families: force-directed (force, d3-force, force-atlas2, fruchterman), radial, circular, concentric, grid, tree/dendrogram/indented, mds, mindmap

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** G6
- **What they offer:** G6 v5 ships 10+ built-in layouts spanning force-directed, radial/circular/concentric, grid, and multiple tree-shaped layouts (dendrogram, indented, mindmap), several GPU/Rust-accelerated.
- **Why it matters here:** This library's inventory explicitly states it is layered/Sugiyama-only with no force-directed, radial, or other layout family — directly confirms and quantifies this known limit against a concrete list of what's missing.
- **How it could fit:** The library's pluggable LayoutSolver seam (already used for the dagre adapter) is architecturally ready to host a radial or force adapter without touching core; a single well-chosen addition (e.g. a simple radial/tree layout for non-DAG or org-chart-like specs) would have the best fit-to-effort ratio.
- **Survey evidence:** WebSearch result: 'built-in layouts include antv-dagre, combo-combined, compact-box, force-atlas2, circular, concentric, d3-force, dagre, dendrogram, force, fruchterman, grid, indented, mds, mindmap, radial, and random' (verified)
- **Repo check:** src/layout.js (D2 comment, line 1) implements a single in-house layered/hierarchical (DAG rank) engine, matching dagre's model; README.md:121 confirms 'median ordering, order stability... all four directions' for one layered algorithm plus an optional dagre adapter (src/adapters/dagre.js) — no force-directed, radial, circular, concentric, grid, dendrogram, mds, or mindmap layouts exist.
- *Verifier's phrasing of the claim:* Multiple concrete layout algorithm families (force/radial/circular/tree/etc.)

### 20. Canvas and WebGL rendering backends (in addition to SVG)

- **Category:** rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** G6
- **What they offer:** G6 v5 supports Canvas, SVG, and WebGL renderers selectable per graph instance, with WebGL aimed at very large graphs (thousands of elements) via GPU acceleration.
- **Why it matters here:** This library's inventory explicitly documents SVG-only rendering as a known limit; G6 quantifies the alternative with a concrete multi-backend renderer story, useful context for how far this gap goes (up to WebGL for scale).
- **How it could fit:** A WebGL/Canvas backend would be a major architectural change conflicting with this library's core design (CSS-custom-property styling, DOM-based a11y tree, animation via inline SVG attributes) — likely out of scope, flagged low fit.
- **Survey evidence:** WebSearch/README fetch: 'multi-environment support including Canvas, SVG, and WebGL rendering' (verified)
- **Repo check:** src/render.js:1 comment states 'SVG renderer' explicitly; types/index.d.ts Renderer (line 632) exposes only svg/viewportG SVGGElement handles; README.md's whole size/architecture section (lines 506-561) discusses only the SVG-based IIFE, no canvas or WebGL renderer option.
- *Verifier's phrasing of the claim:* Canvas and WebGL rendering backends

### 21. Built-in theme system with 20+ community color palettes

- **Category:** theming · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** G6
- **What they offer:** G6 ships light/dark theme presets that additionally bundle 20+ popular categorical color palettes for encoding node/edge categories, selectable via a theme option.
- **Why it matters here:** This library's theming is CSS-custom-property-only with exactly light/dark/auto — no bundled categorical palette system for encoding many distinct categories (e.g. 10 different pipeline stage types) via color.
- **How it could fit:** Could ship as a small optional CSS file defining extra --smv-* palette variants, consistent with the library's 'theming is ordinary CSS' philosophy rather than adding a JS theme system.
- **Survey evidence:** WebSearch: 'two sets of built-in themes, light and dark, that integrate over 20 popular community color palettes' (verified)
- **Repo check:** src/styles.js and types/index.d.ts:232 ThemeName support only 'auto'|'light'|'dark' (a 2-mode light/dark theme), with no categorical color-palette library or palette-selection option — far short of 20+ bundled palettes.
- *Verifier's phrasing of the claim:* Built-in theme system with 20+ community palettes

### 22. Orthogonal / Manhattan edge routing and pluggable connectors

- **Category:** layout / rendering · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** X6
- **What they offer:** X6 supports pluggable named Routers (e.g. 'orthogonal', 'manhattan', 'metro', 'oneSide') and Connectors (e.g. 'smooth', 'rounded', 'jumpover') that determine how an edge's path is drawn between two points, independent of node layout.
- **Why it matters here:** This library's inventory explicitly notes it only produces layered bend-chain polylines with no orthogonal/spline routing option, and that parallel edges between adjacent ranks now render coincident rather than fanned — X6's router/connector split is the concrete alternative architecture.
- **How it could fit:** Could be exposed as a pluggable EdgeRouter seam analogous to LayoutSolver, letting a consumer swap bend-chain polylines for an orthogonal router without touching node layout — a natural, scoped fit.
- **Survey evidence:** from memory of X6 Router/Connector API (x6.antv.antgroup.com/en/docs/api/registry/router, blocked by proxy this session) (from memory / unverified)
- **Repo check:** src/path.js exists for edge path generation but layout is purely a top-to-bottom/left-to-right layered DAG (LayoutOpts.dir in types/index.d.ts:236 supports LR/RL/TB/BT only); no named pluggable Router/Connector system (orthogonal, manhattan, metro, jumpover) is exposed in types/index.d.ts or README.md — edges follow the fixed layered-engine bend geometry, not a selectable routing API.
- *Verifier's phrasing of the claim:* Orthogonal/Manhattan edge routing and pluggable connectors

### 23. Combo collapse/expand with automatic edge re-routing to combo boundary, plus combo layouts (combo-combined)

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** G6
- **What they offer:** G6 combos are first-class graph elements with their own dedicated 'combo-combined' layout algorithm that lays out combos and their children together, plus fine-grained combo style/behavior control (drag combo to reparent nodes, combo-level events).
- **Why it matters here:** This library already has containers/collapse with meta-edge aggregation (a comparable feature), but lacks a dedicated combo-aware layout algorithm variant and drag-to-reparent interaction — useful to note as a depth difference rather than a binary gap.
- **How it could fit:** Given this library explicitly rates container-overlap residuals as an acknowledged unresolved structural limit, G6's dedicated combo-combined algorithm is evidence a purpose-built combo layout (vs. generic Sugiyama + padding) reduces overlap — worth referencing if the container-layout limitation is revisited.
- **Survey evidence:** WebSearch: 'ComboCombined Layout' doc page title + G6 combo description snippet (verified)
- **Repo check:** src/interact.js and src/viewstate.js implement container node expand/collapse (attachTapToggle, vs.isContainer/collapsed) which is a real collapse/expand feature, and src/condense-anim.js appears to animate structural condense/split — but this is parent/child DAG containment, not X6/G6-style arbitrary combos, and there is no dedicated 'combo-combined' layout algorithm or combo-level drag-to-reparent/events found in src/layout.js or types/index.d.ts.
- *Verifier's phrasing of the claim:* Combo collapse/expand with combo-specific layout and edge re-routing to boundary

### 24. Edge bundling / edge-filter-lens plugin for reducing visual clutter in dense edge sets

- **Category:** rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** G6 (edge-filter-lens plugin)
- **What they offer:** G6's 'edge-filter-lens' plugin lets a user hover/drag a lens region that filters which edges are shown, reducing clutter in dense graphs; G6 also has separate edge-bundling layout options in its broader ecosystem.
- **Why it matters here:** This library has no edge-bundling or clutter-reduction mechanism beyond viewport culling of whole elements; for pipelines with many crossing meta-edges (post-collapse aggregation), a lens/bundling technique is a plausible relevant addition.
- **How it could fit:** Low priority — the library's condense()/collapse already reduces edge count structurally (aggregation), which is arguably a better-fit solution to the same problem than a hover lens.
- **Survey evidence:** WebSearch: G6 v5 plugin list includes 'edge-filter-lens' (verified)
- **Repo check:** No 'bundl' or 'edge-filter' symbols found in src/, types/, or README.md.
- *Verifier's phrasing of the claim:* Edge bundling / edge-filter-lens for dense-edge clutter reduction

### 25. Graph analytics algorithms surfaced as callable utilities (shortest path, etc.)

- **Category:** analytics · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** G6 (via @antv/algorithm / graphlib utilities bundled in ecosystem); X6 (basic graph traversal helpers on Graph/Cell)
- **What they offer:** G6's ecosystem (via @antv/algorithm, used internally and re-exposable) includes shortest-path, connected-components and similar graph algorithms; X6's Graph API exposes helpers like getPredecessors/getSuccessors/getNeighbors and hasCycle-style traversal helpers on cells.
- **Why it matters here:** This library's inventory explicitly states no path-finding, no built-in cycle-listing API beyond internal FAS — direct match to a documented known limit.
- **How it could fit:** g.roots()/g.children()/g.descendants() already exist; adding g.shortestPath(fromId,toId) or g.predecessors(id)/g.successors(id) as read-only query sugar would be a small, natural extension of the existing Querying category rather than a new subsystem.
- **Survey evidence:** from memory of X6 Graph API (getPredecessors/getSuccessors) and G6's algorithm utilities; not independently re-confirmed this session due to proxy block (from memory / unverified)
- **Repo check:** src/cycles.js exists (cycle detection, used to validate the DAG structure) and types/index.d.ts:594 GraphEventMap plus g.query (src/query.js) provide predicate-based node/edge querying, but no shortest-path, connected-components, getPredecessors/getSuccessors/getNeighbors traversal helpers were found — only cycle detection is confirmed present.
- *Verifier's phrasing of the claim:* Graph analytics utilities (shortest path, predecessors/successors, cycle detection)

### 26. URL/state serialization or graph export to JSON matching an editable schema round-trip (toJSON/fromJSON)

- **Category:** export / data model · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** X6 (graph.toJSON()/graph.fromJSON())
- **What they offer:** X6's Graph exposes toJSON()/fromJSON() that round-trips the full editable cell graph (including ports, styles, z-order) for save/load workflows.
- **Why it matters here:** This library already has g.spec() (plain snapshot) which is a close analog; flagged mainly because X6's version also round-trips z-order/visual override state (akin to props()) which this library's spec snapshot does not capture (props/style overrides are separate, not included in g.spec()).
- **How it could fit:** Could add an optional g.snapshot() that bundles spec() + current props()/style() overrides + camera/theme state for a fuller save/restore, complementing the existing storyboard/spec split.
- **Survey evidence:** from memory of X6 Graph.toJSON/fromJSON API (from memory / unverified)
- **Repo check:** README.md:454-456 and src/export.js provide exportSVG/exportPNG for rendering output (visual export only, not data), while GraphSpec (types/index.d.ts:51, the {nodes,edges} input to mount()) is itself a plain JSON-serializable object that can be round-tripped by the caller (no built-in g.toJSON()/g.fromJSON() API mutating live state was found, e.g. no such method in the Graph interface at index.d.ts ~line 780-830).
- *Verifier's phrasing of the claim:* toJSON()/fromJSON() editable graph round-trip export

## Borrowable ideas

- G6's plugin registry pattern (named built-ins like 'minimap', 'contextmenu', 'tooltip' instantiated via a `plugins: [{type, ...opts}]` array) is a clean shape for sparkle-motion-visualizer's existing preset/adapter seam — could formalize opts.plugins similarly instead of ad-hoc preset wiring.
- X6's unified Router/Connector seam (pluggable named strategies like 'orthogonal', 'manhattan', 'smooth' registered by string) mirrors this library's LayoutSolver seam — an analogous EdgeRouter seam could let consumers swap polyline bend-chains for orthogonal routing without touching the engine.
- X6 Stencil's drag-from-sidebar-to-canvas UX is a good reference if a future 'graph editor' preset is ever built on top of the read/mount API.
- G6's dual light/dark theme with 20+ palette presets baked in (vs. this library's raw CSS custom properties) suggests shipping a small optional palette pack as a companion CSS file rather than a JS theme system.
- X6 History plugin's simple undo()/redo()/canUndo()/canRedo() API is a good minimal shape to borrow if storyboard-level undo is ever wanted for the director/editor workflows.
- G6 Behavior composition (a flat array of named behaviors like ['drag-canvas','zoom-canvas','click-select']) is a cleaner interaction-config shape than growing many boolean opts.interaction flags.
- X6's Transform plugin (resize/rotate handles as a togglable plugin) shows how optional heavier interaction features can be opt-in without bloating the core bundle — matches this library's own IIFE-size-budget philosophy.
- G6 Timebar plugin (a scrub/filter bar bound to a time-valued field on nodes) is conceptually adjacent to this library's transport bar and could inform a 'filter by time range across nodes' control if temporal filtering is ever added.

## Survey notes

WebFetch to g6.antv.antgroup.com and x6.antv.antgroup.com was blocked by the sandbox egress proxy for essentially every page, so most feature-level claims below rely on (a) WebSearch result snippets (which surfaced accurate high-level lists of built-in plugins/behaviors/layouts, confirmed against known facts) and (b) prior model knowledge of these well-documented, popular libraries, marked 'from memory' per claim. Versions/license/homepage were confirmed live via npm registry. Where a claim could not be corroborated by any fetched source it is marked verified:false and evidence:'from memory' even though confidence is generally high given these are widely-documented flagship AntV libraries with stable, long-established APIs.
