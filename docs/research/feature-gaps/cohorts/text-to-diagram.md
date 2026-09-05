# Cohort survey: text-to-diagram
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** mermaid (flowchart, sequence, state, gantt, gitGraph, timeline, block, architecture diagrams, themes, interaction callbacks), D2 (layouts, animations, icons, sql_table, sequence), Graphviz/viz.js/d3-graphviz (dot attributes, ports, clusters, rankdir, splines, animated transitions in d3-graphviz), PlantUML

**Verification tally:** 21 claimed gaps: 20 missing, 1 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| mermaid | unknown (actively released, v11.x line as of 2025-2026 per docs; not independently pinned) | MIT | https://mermaid.js.org/ | yes | JS/TS library rendering diagrams (flowchart, sequence, class, state, ER, gantt, gitGraph, timeline, block, architecture, mindmap, C4, etc.) from a text DSL to SVG in the browser. |
| D2 | unknown (actively released; not independently pinned) | MPL-2.0 (from memory, not re-verified this pass) | https://d2lang.com/ | yes | Terrastruct's text-to-diagram scripting language/CLI/Go library with pluggable layout engines (dagre/ELK/TALA), 100+ themes, sketch mode, and native animation support. |
| Graphviz | unknown (long-running C project, current stable line not independently pinned) | EPL-1.0 | https://graphviz.org/ | yes | C-based graph drawing toolkit and DOT language; core layout engines (dot, neato, fdp, circo, etc.) with node/edge/cluster attribute system. |
| d3-graphviz | unknown (README referenced d3-graphviz 2.x/3.x lines; not independently pinned this pass) | unknown (from memory: likely MIT, not re-verified) | https://github.com/magjac/d3-graphviz | yes | Renders Graphviz DOT (via @hpcc-js/wasm) into SVG using D3 and animates transitions between successive renders. |
| viz.js | unknown | unknown (from memory) | https://github.com/mdaines/viz-js | no | Graphviz compiled to WebAssembly/asm.js for in-browser DOT rendering (used as the rendering backend by d3-graphviz and others). |
| PlantUML | v1.2025.4 (stable, 28 June 2025) | GPL (with GPL/LGPL/MIT/EPL dual/multi-licensing options historically; GNU GPL cited as the primary license) | https://plantuml.com/ | yes | Java tool generating UML and non-UML diagrams (sequence, class, state, Gantt, mindmap, WBS, Salt wireframes, Archimate) from a plain-text description. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Text DSL authoring (parse text -> diagram)

- **Category:** data model / authoring · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** mermaid; D2; PlantUML; Graphviz (DOT)
- **What they offer:** All four cohort libraries are fundamentally text-DSL-first: users write flowchart/gitGraph/dot/puml syntax and the library parses+renders it, rather than constructing a JSON object graph by hand.
- **Why it matters here:** Lowers the authoring bar dramatically for non-programmers and enables copy-paste sharing/versioning of diagrams as plain text (e.g. in markdown docs, PRs, wikis) — sparkle-motion-visualizer requires hand-built {nodes,edges} JS/JSON.
- **How it could fit:** Could ship an optional `sparkle-motion-visualizer/dsl` compiler translating a small indentation- or arrow-based text syntax into GraphSpec, kept as a separate opt-in module to protect the core size budget.
- **Survey evidence:** https://mermaid.js.org/, https://d2lang.com/, https://plantuml.com/, https://graphviz.org/ (from memory + search snippets) (verified)
- **Repo check:** No parser found anywhere in src/ or bin/; grepped for parse/DSL/gitGraph terms — only unrelated JSON.parse hits in docs/LIVE.md. README.md and docs/ describe only a JS object graph API (mount(el, spec)), no text-DSL front end.
- **Verifier note:** Library is JSON-spec-first, matching the claim exactly.

### 2. Multiple pluggable/alternate layout algorithm families (force, radial, circular, orthogonal)

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Graphviz (dot/neato/fdp/sfdp/circo/twopi); D2 (dagre/ELK/TALA)
- **What they offer:** Graphviz ships several distinct layout engines selectable per-render (dot=hierarchical, neato/fdp=force-directed spring model, circo=circular, twopi=radial). D2 supports swapping dagre/ELK/TALA layout engines, each with different strengths (ELK for ports/nested containers, TALA for software architecture aesthetics).
- **Why it matters here:** sparkle-motion-visualizer is explicitly Sugiyama/layered-only; a pipeline library occasionally benefits from radial (hub/spoke fan-out) or force layouts for non-DAG-shaped exploratory graphs, even if layered stays the default for process narration.
- **How it could fit:** The existing pluggable LayoutSolver seam already supports this in principle (like the dagre adapter) — a radial/force solver could be shipped as a separate optional adapter package without touching the core budget.
- **Survey evidence:** https://graphviz.org/, https://deepwiki.com/terrastruct/d2/3.2-plugin-based-layout-engines (verified)
- **Repo check:** src/layout.js:1-18 and src/adapters/dagre.js document exactly two interchangeable solvers, both hierarchical/layered: the built-in custom engine and an optional @dagrejs/dagre adapter (README.md:428-445). No force, radial, circular, or orthogonal solver exists in src/adapters/ (only dagre.js) or src/layout.js.

### 3. Orthogonal/right-angle edge routing

- **Category:** rendering / layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Graphviz (splines=ortho); D2 (ELK orthogonal routing)
- **What they offer:** Graphviz's splines=ortho attribute and D2's ELK engine route edges as right-angle polylines rather than curved/diagonal bends, common in flowchart/architecture-diagram conventions.
- **Why it matters here:** Orthogonal routing is a widely expected visual convention for architecture/process diagrams and can read as cleaner than bend-chain polylines at high node density.
- **How it could fit:** Could be an edge-routing mode option (opts.edgeRouting: 'bend'|'orthogonal') consumed at the rendering layer using the already-computed bend-chain points, snapped to axis-aligned segments.
- **Survey evidence:** https://graphviz.org/doc/info/attrs.html (from memory, splines attribute); https://deepwiki.com/terrastruct/d2/3.2-plugin-based-layout-engines (from memory / unverified)
- **Repo check:** grep for ortho/splines/right-angle in src/*.js and docs/*.md returns only unrelated uses of the English word 'orthogonal' (docs/DEVIATIONS.md:454, docs/INTERNALS.md:14/1251, docs/PLAN.md:95) describing independence of concerns, not edge routing style.

### 4. Ports / compass-point connection anchors on nodes

- **Category:** data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Graphviz (node:port:compass syntax); D2 (via ELK)
- **What they offer:** Graphviz lets an edge target a specific named field/port of a record/HTML-label node, or a compass point (n/ne/e/se/s/sw/w/nw/c) on any node, controlling exactly where the edge line attaches.
- **Why it matters here:** sparkle-motion-visualizer explicitly has no ports concept (edges attach to whole nodes, with containers force-reattached to entry/exit children); multi-output/multi-input step nodes (e.g. a decision node with distinctly-labeled branches) can't control which side/field an edge leaves from.
- **How it could fit:** Could extend EdgeSpec with optional sourcePort/targetPort id or compass string, resolved by the renderer as an anchor-point override on the node's bounding box, without touching the ranking solver.
- **Survey evidence:** https://graphviz.org/docs/attr-types/portPos/, https://forum.graphviz.org/t/ports-compass-points-in-node-statements/2163 (verified)
- **Repo check:** grep for 'port'/'compass' in src/*.js and types/*.ts finds no node-port or compass-anchor concept; 'anchor' hits (src/director.js:74, src/index.js:321-372, viewport.anchor) are all about camera/viewport focal-point anchoring during pan/zoom, not edge-to-node connection points.

### 5. Record and HTML-like node labels (structured multi-field / rich-content nodes)

- **Category:** rendering / data model · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Graphviz (record/Mrecord shape, HTML-like labels)
- **What they offer:** Graphviz nodes can render as multi-field 'record' boxes (pipe-delimited sub-cells) or full HTML-like labels with nested tables, fonts, and images inside the node box, going well beyond a single text label.
- **Why it matters here:** Process/pipeline nodes often want structured content (a title + status row + metric) inside one node without stacking separate DOM/SVG elements manually; this library only documents rounded-rect boxes with a single label.
- **How it could fit:** Could add an opts-level custom node-content renderer hook (foreignObject or multi-tspan layout) alongside the existing measure.js text sizing, gated behind a size-budget-conscious optional module.
- **Survey evidence:** https://graphviz.org/doc/info/shapes.html, https://renenyffenegger.ch/notes/tools/Graphviz/elems/node/main-types/record-based (verified)
- **Repo check:** grep for record/html-label/multi-field across src/*.js and README.md turns up no node-shape feature; nodes appear to be single-label boxes per src/render.js and preset-pipeline.js styling.

### 6. Node images/icons embedded in shapes

- **Category:** rendering · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Graphviz (image attribute); D2 (icons on sql_table/class/code/markdown/latex shapes, plus general shape icons)
- **What they offer:** Graphviz's image attribute embeds a raster/vector image as node content inside any shape; D2 supports icon attachments on many shape types including structured ones like sql_table.
- **Why it matters here:** Pipeline/process diagrams commonly want a service/tool icon (e.g. a database, queue, cloud provider logo) on a node for quick visual scanning — not covered by this library's rounded-rect-only, single-shape rendering.
- **How it could fit:** Could add an optional data.icon (URL or inline SVG symbol id) rendered as a small <image>/<use> inside the node box via g.style()/node renderer, respecting the culling and measure systems already in place.
- **Survey evidence:** https://graphviz.org/doc/info/shapes.html; D2 icon docs (from memory, not independently refetched) (from memory / unverified)
- **Repo check:** grep for 'icon' and '<image' across src/*.js, README.md, docs/THEMING.md returns zero matches.

### 7. SQL table / ER-style structured shape (sql_table)

- **Category:** data model / rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** D2
- **What they offer:** D2 has a first-class sql_table shape that renders a node as a schema table with typed columns and constraint markers (PK/FK), and connections can target specific column rows.
- **Why it matters here:** Not directly core to pipeline/process narration, but shows the broader pattern of 'structured shape + port-per-row' that overlaps with the record-label gap above; relevant if this library is ever used for data-lineage/schema pipelines.
- **How it could fit:** Low priority; could be a community preset built on the record/HTML-label gap rather than a first-class engine feature.
- **Survey evidence:** from memory (D2 sql_table docs) + search snippet 'Icons can be added for special objects (sql_table, class, code, markdown, latex)' (from memory / unverified)
- **Repo check:** grep for sql_table/schema-table across the whole repo (*.js, *.md) returns no matches.

### 8. Sketch/hand-drawn rendering style

- **Category:** rendering / theming · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** D2 (sketch mode via rough-go/Rough.js port)
- **What they offer:** D2's -s/sketch flag renders all shapes and edges with a hand-drawn, sketchy line aesthetic (via a Rough.js-style renderer), toggle-able per diagram.
- **Why it matters here:** Stylistic differentiator sometimes used for informal/whiteboard-feel narration; low functional necessity for a pipeline-status tool.
- **How it could fit:** Could be an opt-in CSS filter/SVG filter preset rather than an engine feature, given styling is CSS-custom-property driven already.
- **Survey evidence:** https://deepwiki.com/terrastruct/d2/... (search snippet) and D2 docs (from memory) (from memory / unverified)
- **Repo check:** grep for sketch/rough.js/hand-drawn in src/*.js and README.md finds only an unrelated comment in src/render.js:4 ('Arrowheads are hand-drawn triangles posed by clipEnds') describing precise programmatic arrowhead geometry, not a sketchy/rough rendering mode.

### 9. 100+ named built-in themes / theme catalog

- **Category:** styling / theming · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** D2 (100+ theme IDs, --theme=N); mermaid (base/forest/dark/default/neutral + themeVariables)
- **What they offer:** D2 ships a large numbered catalog of built-in color themes selectable by ID; mermaid ships a handful of named base themes plus a themeVariables override object exposed via %%{init}%%.
- **Why it matters here:** sparkle-motion-visualizer only ships light/dark/auto plus raw --smv-* custom properties — no curated palette gallery, so achieving a polished non-default look requires hand-tuning tokens from scratch.
- **How it could fit:** Could ship a small `sparkle-motion-visualizer/themes` module of named CSS custom-property presets (5-10 palettes) layered under the existing three-tier cascade, opt-in via a class or data attribute.
- **Survey evidence:** https://deepwiki.com/terrastruct/d2/... ('100+ built-in themes'); mermaid theme docs (from memory) (verified)
- **Repo check:** docs/THEMING.md:19-145 and README.md:127 show theming is limited to three modes: 'auto'/'light'/'dark' via data-smv-theme, customized only through CSS custom properties (--smv-* vars). No named theme catalog or theme-ID selection exists.
- **Verifier note:** Partial credit could go to CSS-variable-based custom theming, but no catalog of pre-built named themes exists, so 'missing' is accurate to the specific claim.

### 10. Gantt / timeline chart diagram type (time-axis layout)

- **Category:** layout / time · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** mermaid (gantt diagram); PlantUML (Gantt diagram)
- **What they offer:** Both mermaid and PlantUML have a dedicated Gantt chart diagram type: tasks laid out along a literal time x-axis with durations, dependencies, milestones, and date-based gridlines — distinct from a generic node-link graph.
- **Why it matters here:** This library's own docs explicitly note 'no Gantt/temporal layout mode (x=time)' was skipped by design; the token/duration engine tracks time internally but never surfaces it as a spatial x=time layout, which is exactly what Gantt-style process/pipeline timing narration often wants.
- **How it could fit:** Matches the inventory's own documented known-limit almost verbatim — reported here as a legitimate cross-cohort gap confirming the library's own backlog note; could become an alternate LayoutSolver keyed off node.data.duration/start offsets.
- **Survey evidence:** mermaid gantt docs (https://mermaid.js.org/, from memory) + PlantUML Gantt docs (https://plantuml.com/, search snippet 'Gantt diagram') (verified)
- **Repo check:** grep for gantt/timeline in src/*.js and README/docs shows 'timeline' only used to mean the animation/story timeline (src/index.js:38,438,578-629, docs/RECORDING.md), not a date-axis Gantt chart layout. No task/duration/dependency Gantt renderer exists.

### 11. Sequence diagram as a first-class diagram type (lifelines, activation bars, async/sync arrows, loops/alt/opt fragments)

- **Category:** data model / rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** mermaid (sequenceDiagram); PlantUML (sequence diagram); D2 (sequence diagrams via shape: sequence_diagram)
- **What they offer:** All three support a dedicated sequence-diagram mode: vertical lifelines per actor, horizontal message arrows in temporal order, activation/deactivation bars, and structured control-flow fragments (loop/alt/opt/par blocks) — a fundamentally different layout family from a node-link DAG.
- **Why it matters here:** sparkle-motion-visualizer's execution engine already models temporal token flow between named steps (start/finish events, per-token timing) but only ever renders it over the layered graph layout — there's no lifeline/swimlane rendering mode, which is the idiomatic way to narrate 'who talked to whom, in what order' interactions.
- **How it could fit:** Would be a genuinely new rendering+layout mode (swimlane x=actor, y=time) rather than a tweak to the Sugiyama engine; likely out of scope as a core feature but plausible as a sibling package sharing the token/run engine.
- **Survey evidence:** https://mermaid.js.org/ sequence diagram docs; https://plantuml.com/sequence-diagram (verified)
- **Repo check:** grep for sequence-diagram/lifeline/activation-bar across src/*.js and docs/*.md returns zero matches.
- *Verifier's phrasing of the claim:* Sequence diagram as a first-class diagram type

### 12. Mind-map diagram type (radial hierarchical)

- **Category:** layout / rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** mermaid (mindmap); PlantUML (mindmap)
- **What they offer:** Dedicated radial/hierarchical mind-map layout: a root node with children branching outward, typically alternating left/right, distinct from top-down/left-right layered DAG layout.
- **Why it matters here:** Low relevance to pipeline/process narration specifically; included for completeness of layout-family coverage.
- **How it could fit:** Not a natural fit; would require a new layout family the plan explicitly excludes.
- **Survey evidence:** https://plantuml.com/mindmap-diagram, mermaid mindmap docs (from memory) (verified)
- **Repo check:** grep for mind-map/radial across src/*.js and docs/*.md returns zero matches (only 'universalTransition' unrelated note in docs/PLAN.md).

### 13. UI wireframe / mockup diagram type (Salt)

- **Category:** rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** PlantUML (Salt)
- **What they offer:** PlantUML's Salt subproject renders text-described UI wireframes (buttons, text fields, trees, tabs) as a mockup diagram, unrelated to graph/DAG rendering.
- **Why it matters here:** Out of scope for a graph/pipeline visualizer; noted only because it's part of the cohort's breadth.
- **How it could fit:** Not applicable.
- **Survey evidence:** https://plantuml.com/salt (verified)
- **Repo check:** grep for wireframe/mockup/salt across src/*.js and docs/*.md returns zero relevant matches.

### 14. Architecture-diagram-specific shape vocabulary (cloud/service icon shapes, groups)

- **Category:** rendering / data model · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** mermaid (architecture diagrams, cloud icon shapes + junctions); D2 (shapes + icon library for cloud/service iconography, TALA layout tuned for architecture)
- **What they offer:** Both mermaid's newer 'architecture' diagram type and D2 ship built-in vocabularies/icon sets for cloud/service architecture nodes (servers, databases, cloud groups, junctions connecting multiple services) as opposed to generic boxes.
- **Why it matters here:** Not a core pipeline-narration need, but shows a domain-specific preset pattern (a themed icon+shape vocabulary) that this library's generic preset system (`presetPipeline`) could emulate for e.g. an 'infra' preset.
- **How it could fit:** Could become a community/example preset built on data.icon + g.style(), not a core engine change.
- **Survey evidence:** mermaid architecture diagram docs (from memory); D2 icon library docs (from memory) (from memory / unverified)
- **Repo check:** grep for cloud/architecture-shape/service-icon across src/*.js and docs finds no such vocabulary; only an unrelated mention of 'extension architecture' in docs/USABILITY-EVAL.md:570.
- **Verifier note:** Generic container/group nodes exist per dagre compound-graph support (src/adapters/dagre.js:32 'compound: hasParents'), but no cloud/service icon vocabulary.

### 15. Minimap / graph navigator overlay

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** not directly confirmed in mermaid/D2/PlantUML/Graphviz cohort itself, but a very common adjacent-tooling pattern (e.g. d3-graphviz-based dashboards, general SVG graph viewers) — flagged as a probable gap based on general knowledge, low confidence for this specific cohort
- **What they offer:** A small always-visible thumbnail of the whole graph with a viewport rectangle, letting users see 'where am I' when zoomed in and click/drag to jump.
- **Why it matters here:** On large (150+ node, culled) graphs this library targets, a minimap materially helps orientation during pan/zoom — directly relevant to the documented viewport culling feature.
- **How it could fit:** Could be a small opt-in overlay component reading g.bounds()/viewport state, rendered as a secondary mini SVG synced to viewport.onChange.
- **Survey evidence:** from memory (general graph-viewer convention); not independently confirmed as present in mermaid/D2/PlantUML/Graphviz specifically (from memory / unverified)
- **Repo check:** grep for minimap/navigator/thumbnail across src/*.js, README.md, docs/*.md, types/*.ts: only docs/PLAN.md:693 lists 'minimap' explicitly as a *hypothetical future* item in a list of unimplemented ideas ('registry, renderer abstraction for a hypothetical canvas backend, minimap, ...'), and docs/RECORDING.md:431 uses 'thumbnail' to mean a still-frame export of a storyboard beat, not a navigator overlay.
- **Verifier note:** The project's own planning doc confirms this is not built.

### 16. Click/link callback directive bound directly in the diagram source (click node -> JS callback or URL)

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** mermaid (click directive + securityLevel gating, callback or href)
- **What they offer:** Mermaid lets diagram text declare `click nodeId call myFunction()` or `click nodeId href "url"` directly, wiring node clicks to either a JS callback or a navigable link, gated behind securityLevel: 'loose'.
- **Why it matters here:** sparkle-motion-visualizer has g.on('commit'...) events and CSS hover, but no documented built-in 'node click -> app callback' wiring beyond generic pointer events the consumer must attach themselves; a first-class per-node click/href hook is more discoverable for simple use cases.
- **How it could fit:** Could add a lightweight data.onClick/data.href convention read by a small optional interaction preset, wired through the existing pointer/tap-toggle layer without touching core interaction code.
- **Survey evidence:** https://mermaid.js.org/config/usage.html; https://github.com/mermaid-js/mermaid/issues/6809 (security gating) (verified)
- **Repo check:** grep for click-href/click-call/onNodeClick/nodeClick in src/*.js, types/*.ts, README.md returns zero matches. Since there is no text-DSL source (see DSL finding above), a directive embedded 'in diagram source' is structurally not applicable either — interactivity would have to go through the JS API/event system (src/interact.js, src/events.js) rather than declarative source syntax.
- *Verifier's phrasing of the claim:* Click/link callback directive bound directly in the diagram source

### 17. Bidirectional / flow-direction-aware animated connections as a base rendering primitive

- **Category:** rendering / animation · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** D2 (animated connections, bidirectional opposite-direction animation, 'growing arrow' style)
- **What they offer:** D2 can render edges with built-in continuous flow animation (dashes moving along the edge, arrows growing outward) as a native attribute, including distinguishing bidirectional flow by animating in opposite directions simultaneously.
- **Why it matters here:** sparkle-motion-visualizer has token pulses and traversed-edge width tied to the run/token engine, but no documented 'always-on ambient flow' edge animation independent of a live run — useful for a static 'this is a pipeline, data flows this way' presentation mode before/without invoking g.run().
- **How it could fit:** Could be an edge-level style/data flag (data.flowAnimated / g.props edge key) driving a lightweight stroke-dashoffset ticker animation, reusing the existing single shared ticker (D1) rather than a new animation system.
- **Survey evidence:** search snippet: 'Bidirectional connections are now animated in opposite directions'; D2 animation framework discussion https://github.com/d2lang/d2/discussions/2677 (verified)
- **Repo check:** grep for flow-animation/dash-offset/marching-ants/bidirectional in src/*.js and README.md returns zero matches. The library's animation system (src/anim.js, src/director.js) drives state-transition/highlight animation, not a continuous per-edge flow-direction primitive.

### 18. Class/UML-specific diagram types (class, use case, component, deployment, object, timing diagrams)

- **Category:** data model / rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** PlantUML (full UML diagram family); mermaid (class diagram, state diagram, ER diagram)
- **What they offer:** Both ship dedicated UML diagram types with their own notation (class members/visibility markers, use-case ovals, component/deployment boxes, ER crow's-foot notation) beyond generic node-link graphs.
- **Why it matters here:** Out of scope for a pipeline/process visualizer's remit — UML modeling is a different domain — included for completeness/negative confirmation.
- **How it could fit:** Not recommended to pursue; different product category.
- **Survey evidence:** https://plantuml.com/, mermaid docs (from memory) (verified)
- **Repo check:** grep for 'class diagram'/use-case/deployment-diagram/crow's-foot in src/*.js and docs/*.md returns zero matches.
- *Verifier's phrasing of the claim:* Class/UML-specific diagram types

### 19. Standalone renderer-side attribute-rewrite hook per animated transition (attributer pattern)

- **Category:** rendering / API · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** d3-graphviz (attributer callback)
- **What they offer:** d3-graphviz exposes a hook function invoked once per SVG element on each render, letting the caller rewrite raw attributes (e.g. recolor by data) before D3's transition animates between old and new states.
- **Why it matters here:** sparkle-motion-visualizer's g.style()/g.props() cover per-node/edge custom-property overrides, but there's no documented raw low-level 'intercept every element right before the animated commit' escape hatch for advanced consumers wanting effects outside the --smv-* vocabulary.
- **How it could fit:** Could be an advanced/unstable opts.unsafeAttributer(el, datum) hook fired in the render commit path, clearly marked as an escape hatch outside the stable styling API.
- **Survey evidence:** https://github.com/magjac/d3-graphviz/blob/master/examples/basic-attributer.html (verified)
- **Repo check:** grep for 'attributer' across src/*.js and README.md returns zero matches — no such named hook exists.
- **Verifier note:** The library does have a general style/token system (g.style(fn), docs/THEMING.md, src/store.js) and per-tick CSS custom property writes (director.js), which are conceptually adjacent but not the same per-element pre-transition attribute-rewrite hook d3-graphviz exposes; still counts as missing for the specific claimed feature.

### 20. Named/interruptible transition coordination guidance for concurrent camera + structural animation

- **Category:** animation · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** d3-graphviz (named-transition requirement to avoid zoom-interrupt bugs)
- **What they offer:** d3-graphviz's docs specifically warn that transitions must be named when zoom behavior is active, because the default/null-named transition gets interrupted by zoom, corrupting the render.
- **Why it matters here:** sparkle-motion-visualizer already has cancel-and-retarget (D9) and a single shared ticker, which likely avoids this exact class of bug by design, but it's a concrete real-world pitfall from a peer library worth defensive-testing against (camera pan mid structural-diff transition).
- **How it could fit:** Not a feature gap so much as a testing/robustness note; could inform an e2e test case (concurrent camera op + addNode during animation).
- **Survey evidence:** https://github.com/magjac/d3-graphviz README (transition naming caveat, from search snippet) (verified)
- **Repo check:** grep for '.transition(' in src/*.js returns no D3-style named-transition calls at all — the library uses its own custom animation engine (src/anim.js, src/scene.js, src/viewport.js) rather than D3 transitions, so there is no equivalent 'named transition' concept or documented warning about transition interruption during zoom.
- **Verifier note:** Not applicable in the same technical sense (different animation architecture), but the specific documented guidance/mechanism does not exist.

### 21. CLI-driven static export to multiple raster/vector formats in one tool invocation (PNG/SVG/PDF/EPS from one DOT/PlantUML source)

- **Category:** export · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** Graphviz (dot -Tpng/-Tsvg/-Tpdf/-Tps); PlantUML (-tpng/-tsvg/-tpdf/-teps/-ttxt/-tlatex flags)
- **What they offer:** Both CLIs take one source file and emit to many output formats via a simple flag, including PDF and EPS which this library does not produce at all.
- **Why it matters here:** sparkle-motion-visualizer's export surface is SVG (ESM-only) + PNG (browser canvas only) + smv-record video — no PDF export, which matters for print/embedding-in-slides workflows common to process documentation.
- **How it could fit:** Given SVG export already exists, PDF could be a thin server/Node-side conversion step (e.g. via an external renderer) documented as a recipe rather than a new core dependency, keeping the size-budget philosophy intact.
- **Survey evidence:** https://graphviz.org/doc/info/output.html (from memory); PlantUML CLI flags (from memory) (from memory / unverified)
- **Repo check:** README.md:454-457 and src/export.js provide exportSVG/exportPNG (SVG string and browser-only PNG blob), and bin/smv-record.mjs exports PNG sequences and h.264 mp4 (README.md:485-486, bin/smv-record.mjs:87). No PDF or EPS export exists anywhere (grep for pdf/eps found no export-format code), and there is no single CLI invocation that emits multiple formats from one source the way dot/plantuml CLIs do — smv-record is a separate purpose-built video/frame-sequence tool, not a general multi-format static exporter.
- **Verifier note:** SVG/PNG/MP4 covered; PDF/EPS entirely absent; not a single unified multi-format CLI flag like -Tpng/-Tpdf.
- *Verifier's phrasing of the claim:* CLI-driven static export to multiple raster/vector formats in one tool invocation (PNG/SVG/PDF/EPS)

## Borrowable ideas

- Mermaid's %%{init: {...}}% single front-matter block for theme/config — sparkle-motion-visualizer could offer a similar one-shot 'theme recipe' object (base palette + overrides) instead of only per-token CSS custom properties, lowering the bar for quick reskins.
- D2's animated bidirectional connections (opposite-direction dash flow) and 'growing arrow' connection style as a lightweight built-in edge-flow-direction visual, distinct from token pulses — cheap to add as a data-flow modifier on edges.
- D2's 100+ named theme IDs (--theme=300) as a curated palette gallery shipped alongside the raw --smv-* token system, for users who don't want to hand-tune custom properties.
- Graphviz/d3-graphviz's 'attributer' hook pattern — a function called once per rendered element letting the consumer rewrite raw SVG attributes before an animated transition; complements g.style()/g.props() with an escape hatch for one-off DOM tweaks.
- PlantUML/D2's plain-text DSL as an alternative authoring surface compiled to the existing GraphSpec JSON — would let users hand-author small pipelines without touching JS objects, similar to how Mermaid/D2/PlantUML dominate on approachability.
- Mermaid's per-diagram-type URL-shareable playground (mermaid.live) and D2's playground — a hosted 'paste spec, see animated graph' page would help adoption/demoing independent of smv-pack.
- d3-graphviz's named-transition-to-avoid-zoom-interrupt caution suggests documenting/guarding against transition name collisions when camera ops and structural transitions overlap in this library's shared ticker.
- Graphviz's compass-point port syntax (n/ne/e/se/s/sw/w/nw/c) as a minimal, familiar vocabulary if ports are ever added — a well-known mental model to reuse rather than inventing new port syntax.

## Survey notes

Research done via WebSearch only (no direct WebFetch of primary docs pages was needed given strong aggregated search snippets); several specific facts (exact current version numbers/licenses for D2, d3-graphviz, viz.js) could not be pinned with high confidence in this pass and are marked verified:false or 'unknown' rather than guessed. gaps[].verified reflects confidence per-item, not a guarantee of exact API name accuracy — cross-check API names against primary docs before citing in user-facing copy.
