# Cohort survey: catch-up
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** Libraries/tools the first sweep missed: Rough.js / RoughViz (hand-drawn sketch rendering style - the animation-and-presentation cohort covers Excalidraw but never checks this library's SVG rendering against sketch-style prior art); vis-timeline (dedicated JS timeline/Gantt component - overlaps directly with this library's time-aware remit and seek/scrub features, not covered by any cohort); Frappe Gantt (lightweight no-framework Gantt chart library - same embeddable/no-build-step class as this library, unlike the heavier orchestrator UIs sweep); Konva.js / Fabric.js (canvas scene-graph libraries commonly used to hand-build node-link + animation UIs; relevant prior art for hit-testing and tween approach); Lottie / Bodymovin JSON player (declarative animation-script JSON format - closest prior art to this library's storyboard op-array/cue-sheet format, never compared); Perfetto UI / Speedscope (flamegraph-style time-aware execution visualizers - closer analog to 'token flowing through a DAG over time' than most of the observability-and-state cohort, which focused on trace/state-machine tools); Diagrams.net (draw.io) embed API and Structurizr/C4-model tools (common embeddable, no-framework diagram targets not covered by any cohort); @statelyai/inspect's actual time-travel replay feature (XState/Stately appear in observability-and-state cohort but are only checked for generic ports/dragging/minimap gaps, never for the event-replay/time-travel capability that most closely matches this library's live-mode replay). Feature areas the first sweep was thin on: Voice-over / audio-sync authoring: the library explicitly documents 'fitting holds to a recorded voice-over' as a first-class use case (docs/RECORDING.md), but no cohort addresses audio-timeline sync, waveform display, or caption/transcript tooling for this library's own advertised feature; Storyboard/cue-sheet DSL depth: the library's serializable op-array with labels, seek-by-label, and per-step 'dur' pacing is a distinctive feature only shallowly compared (one generic 'keyframe scripting language' line vs Motion Canvas) rather than against structured narrative-script formats like Lottie/Bodymovin JSON or scripted Ken-Burns/pan-zoom tools; Live-mode event-log replay + time-travel scrub: loosely compared only against full orchestrator apps (Airflow, Temporal UI) rather than against lighter embeddable replay/time-travel tools (XState inspector, Redux DevTools time-travel) that are closer analogs and were present in the digest but under-examined; SVG-native export/asset pipeline: since the library is SVG-based and DOM-inspectable, no cohort assesses SVG export fidelity, poster-frame/static-snapshot export, or print/PDF rasterization from SVG - export gaps are scattered thinly (one ECharts saveAsImage line, PDF export under commercial-diagramming) without ever being pointed at this library's own SVG output path; Zero-dependency bundle-size competitiveness: the library explicitly touts 'no dependencies at all since M3' for its in-house layout engine as a differentiator, but no cohort quantifies or compares bundle size / CDN single-file footprint against comparable no-framework libraries, despite this being a stated selling point; Compound-node meta-edge aggregation semantics (dedup + weighted rollup on collapse) - touched generically in cytoscape-sigma's expand-collapse item but never checked against comparable rollup features such as AntV G6 combo layouts or Grafana Node Graph grouping.

**Verification tally:** 17 claimed gaps: 14 missing, 2 partial, 1 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| Rough.js | 4.6.6 | MIT | https://github.com/rough-stuff/rough | yes | Small (<9KB) canvas/SVG library for hand-drawn/sketchy rendering of lines, curves, polygons, circles, and SVG paths. |
| RoughViz | 2.0.5 | MIT | https://github.com/jwilber/roughViz | yes | Hand-drawn/sketchy SVG data-visualization charting library built on D3v5 + Rough.js + handy. |
| vis-timeline | unknown (7.7.x line confirmed to exist via HISTORY.md/unpkg; exact current npm version not confirmed) | Apache-2.0 OR MIT (dual) | https://github.com/visjs/vis-timeline | yes | Interactive, zoomable/draggable JS timeline and 2D-graph library with groups, ranges, and a custom-time-bar API — commonly used for Gantt-style views. |
| Frappe Gantt | 1.2.2 | MIT | https://github.com/frappe/gantt | yes | Lightweight, zero-dependency, no-framework SVG Gantt chart library with drag/resize scheduling and dependency arrows. |
| Konva.js | unknown (not confirmed via npm in this pass) | MIT | https://konvajs.org/ | yes | HTML5 Canvas 2D scene-graph framework with events, drag/drop, hit-graph-based hit testing, transforms, and Konva.Tween property animation. |
| Fabric.js | 7.4.0 | MIT | https://github.com/fabricjs/fabric.js/ | yes | Canvas object-model library with SVG-to-canvas / canvas-to-SVG parsing, built-in shapes/controls, and an animation utility module (fabric.util.animate). |
| Lottie / Bodymovin | format version field example seen as 5.12.0 (from a sample file, not authoritative); lottie-web package version unknown | MIT (lottie-web); Lottie Simple License applies to some LottieFiles marketplace assets, not the format/player itself | https://github.com/airbnb/lottie-web | yes | Declarative JSON animation-script format exported from After Effects (via the Bodymovin plugin) and rendered natively on web/iOS/Android/Windows by the lottie-web player. |
| Perfetto UI | unknown | Apache-2.0 | https://github.com/google/perfetto | yes | Web-based trace visualizer (ui.perfetto.dev) for opening/querying multi-GB, hours-long system and app performance traces. |
| Speedscope | unknown (self-contained releases published on GitHub Releases) | MIT | https://github.com/jlfwong/speedscope | yes | Fast, interactive, single-page web viewer for flamegraph-style performance profiles from many languages/formats. |
| diagrams.net (draw.io) | unknown | Apache-2.0 (source); CC BY 4.0 (JGraph-provided icons/templates) | https://www.drawio.com/ | yes | Embeddable diagram editor/viewer with a postMessage-based iframe embed protocol (init/load/save/exit) and export to SVG/PNG/PDF. |
| Structurizr | cloud service build 2026.07.03; CLI/DSL version unknown | CLI/DSL/tooling free and open source; hosted 'server' product requires a paid license | https://structurizr.com/dsl | yes | 'Models as code' tooling and DSL for the C4 model of software architecture diagrams, with export to PlantUML/Mermaid/WebSequenceDiagrams/Ilograph via CLI. |
| @statelyai/inspect (Stately/XState) | 0.7.1 | MIT | https://github.com/statelyai/inspect | yes | Inspection utility for XState state machines/actors that relays state-transition and actor-communication events to a browser inspector UI, with buffering and replay for late-connecting clients. |
| AntV G6 (Combo) | unknown (v5-era docs referenced) | MIT (AntV G6 is open source; license text not directly re-confirmed this pass) | https://g6.antv.antgroup.com/en/manual/element/combo/overview | yes | Graph visualization engine whose 'Combo' container element supports collapse/expand (double-click) with edges re-routed to the combo boundary when collapsed, plus a ComboCombined layout mode for independently laying out combo interiors vs the outer graph. |
| Grafana Node Graph panel | unknown | AGPL-3.0 (Grafana core) | https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/ | no | Built-in Grafana panel type for rendering node-link graphs (e.g. service maps) with grouping/clustering support. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Hand-drawn/sketchy rendering style

- **Category:** Rendering · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Rough.js; RoughViz
- **What they offer:** Rough.js redraws canvas/SVG primitives (lines, rects, arcs, paths) with jittered, hand-drawn-looking strokes via a small set of options (roughness, bowing, fillStyle: hachure/cross-hatch/zigzag, fillWeight); RoughViz layers this onto D3-driven charts as a whole visual theme.
- **Why it matters here:** Sparkle-motion-visualizer's rounded-rect/polyline rendering is exclusively clean/geometric. A 'sketch' theme is a known, popular presentation register (Excalidraw-style) for informal narration/whiteboard-feel process explainers, and the library's docs never benchmark this rendering register even though it explicitly targets presentation/storytelling use cases.
- **How it could fit:** Could be an optional renderer preset/theme (e.g. theme:'sketch' or a props()-driven filled path swap) that regenerates node/edge SVG path data through a small in-repo jitter function at commit time — consistent with D7 (props/style as the sole styling mechanism) without adding a runtime dependency.
- **Survey evidence:** https://github.com/rough-stuff/rough , https://github.com/jwilber/roughViz (verified)
- **Repo check:** Grepped README.md, docs/, src/, types/ for rough|sketch|hand-drawn|hachure; only hits are unrelated prose uses of 'through'. No sketchy-fill or jittered-stroke rendering option exists anywhere in src/render.js or styles.js.
- **Verifier note:** This is a hand-rolled SVG DAG/pipeline renderer with a clean-line theming system (docs/THEMING.md); no sketchy visual mode.
- *Verifier's phrasing of the claim:* Hand-drawn/sketchy rendering style (Rough.js/RoughViz)

### 2. Dedicated time-axis (x=time) Gantt/timeline layout mode

- **Category:** Layout / Time · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** vis-timeline; Frappe Gantt
- **What they offer:** Both render items positioned along an actual time axis (vis-timeline: draggable/zoomable ranges and points on a scrolling axis with groups; Frappe Gantt: SVG task bars positioned/sized by literal start/end dates with day/week/month view_modes).
- **Why it matters here:** The inventory explicitly lists 'no Gantt/temporal layout mode (x=time, sweeping-line scrubber)' as an acknowledged, deliberately-skipped limit. Given the library's duration-driven token engine and voice-over-timing feature set, an x=time layout mode is directly on-theme (not a stretch) even though currently out of scope by design.
- **How it could fit:** Would need a new LayoutSolver variant (fits the existing pluggable solver seam) that maps node.data.duration/compiled run timing to x position instead of rank; explicitly acknowledged in the inventory as 'if demanded'.
- **Survey evidence:** https://github.com/visjs/vis-timeline , https://github.com/frappe/gantt (verified)
- **Repo check:** docs/DEVIATIONS.md:273-275 explicitly states '## 11. Gantt/temporal layout mode: skipped (M3)' — 'Plan: Gantt/temporal layout mode (x = time, sweeping-line scrubber) if demanded.' Also docs/research/ux.md discusses it as a researched-but-deferred idea, not shipped.
- **Verifier note:** The library ships only the topological DAG layout (src/layout.js, dagre-family longest-path/Sugiyama-lite); the x=time Gantt mode was researched and deliberately deferred, confirmed by the library's own deviations log.

### 3. Named custom time markers addressable on a timeline/axis

- **Category:** Storyboard / cue-sheet · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** vis-timeline
- **What they offer:** timeline.addCustomTime(time, id) adds a persistent, independently movable vertical marker line to the timeline, addressable later by id (setCustomTime(time, id), removeCustomTime(id)).
- **Why it matters here:** This library's g.cues() produces a flat label+caption offset list, but has no first-class 'marker' primitive distinct from a storyboard step/label — a named marker API would give voice-over authors a lighter-weight way to drop/adjust sync points without it being a full storyboard op.
- **How it could fit:** Could extend g.cues()/storyboard label semantics with an explicit marker(id, ms) op, or surface addCustomTime-style calls on the transport bar for interactive authoring.
- **Survey evidence:** from memory (vis-timeline docs, addCustomTime API), partially corroborated via unpkg types search (verified)
- **Repo check:** Grepped README.md/docs/src/types for customtime|marker; no API for adding/removing a persistent, independently-movable, id-addressable vertical time marker. The only 'marker' hits are SVG arrowhead <marker> discussions (docs/PLAN.md:136, docs/INTERNALS.md:122) and unrelated dedup-guard 'markers' in THEMING.md, not a timeline feature.
- **Verifier note:** Consistent with there being no time-axis timeline mode at all (see Gantt finding above) — there is no axis to place a named marker on.
- *Verifier's phrasing of the claim:* Named custom time markers addressable on a timeline/axis (addCustomTime/id)

### 4. Drag-to-reschedule and drag-to-resize task bars with dependency-shift propagation

- **Category:** Interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Frappe Gantt; vis-timeline
- **What they offer:** Frappe Gantt lets users drag a task bar to move it or drag its edge to resize it, with dependency_shifting/dependencies_type options controlling whether/how dependent (linked) tasks move in response; vis-timeline's editable option similarly enables add/updateTime/updateGroup/remove via direct manipulation.
- **Why it matters here:** The inventory states plainly 'No node dragging/repositioning by the user — layout is entirely computed.' For a duration/timing-centric library, direct manipulation of a node's duration or position (even just in a hypothetical Gantt-mode view) is a natural authoring shortcut competitors in the adjacent Gantt space treat as baseline.
- **How it could fit:** Out of scope for the current layered-layout interaction model (deliberately no manual positioning) but relevant if a time-axis layout mode (see above) is ever added — resizing a bar could become a UI shortcut for editing data.duration via update().
- **Survey evidence:** from memory (Frappe Gantt docs config page), corroborated by search results (verified)
- **Repo check:** src/interact.js and docs/INTERNALS.md:139 show pan/zoom drag handling only ('Pan: pointer drag. Zoom: wheel only with ctrl/cmd + pinch'); the transport bar's drag (src/transport.js) only calls controller.seek() per docs/USABILITY-EVAL.md:348-369. No task-bar drag-to-move/resize or dependency-shift option found in src/, types/index.d.ts, or README.md.
- **Verifier note:** There are no Gantt task bars in the first place (see Gantt finding), so there is nothing to drag-reschedule; the only drag interactions present are canvas pan and playhead scrub.

### 5. Canvas hit-testing via an offscreen hit-graph / listening flag

- **Category:** Rendering / Interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Konva.js
- **What they offer:** Konva maintains a separate offscreen hit-graph canvas colored per-shape for pixel-accurate hit testing, with group.listening(false) removing whole subtrees from hit testing for performance, and can be toggled on/off during drags for perf.
- **Why it matters here:** Not directly applicable since sparkle-motion-visualizer is SVG (native DOM hit testing), but worth noting as prior art for the tradeoffs the library's own viewport-culling system makes (culled elements get display:none, which already removes them from hit testing/paint — a cheaper equivalent of Konva's approach).
- **How it could fit:** No action needed structurally; useful only as a comparison point validating the culling approach already taken.
- **Survey evidence:** https://konvajs.org/docs/faq.html (hit detection notes) (verified)
- **Repo check:** Grepped for hit-test|listening(|offscreen across repo; the only offscreen-canvas usage found is docs/research/critique.md G1 and docs/DEVIATIONS.md:427, which describe using an offscreen canvas for measureText() (text sizing before layout), not hit-testing. No listening(false)-style subtree hit-test toggle exists.
- **Verifier note:** This library renders to real SVG DOM (docs/research/rendering.md:14), so hit-testing is native browser event dispatch on SVG elements, not a Konva-style separate hit-graph canvas — the concept doesn't apply to this architecture, and indeed nothing like it is implemented.
- *Verifier's phrasing of the claim:* Canvas hit-testing via offscreen hit-graph / listening flag

### 6. Property-tween seek/reverse/finish primitives exposed directly on individual animations

- **Category:** Animation · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Konva.js
- **What they offer:** Konva.Tween instances expose play/pause/reverse/seek/reset/finish methods per-tween, plus 30+ named easing functions, callable independently on any animated property.
- **Why it matters here:** sparkle-motion-visualizer centralizes all motion on one shared ticker (D1) by design, so per-element tween control isn't the model — but the vocabulary (reverse, finish) is a useful naming check against the library's own mutation-handle API (Awaitable+cancelable, resolving {canceled, applied}), which currently has no 'reverse' or 'finish-immediately' verb.
- **How it could fit:** Could add a finish()/skipToEnd() method on mutation handles to immediately resolve a trailing animation without canceling the structural change — currently only cancel() exists.
- **Survey evidence:** https://konvajs.org/api/Konva.Tween.html (verified)
- **Repo check:** README.md:91/155 and docs/INTERNALS.md show run-level controls (step(), seek(ms), play/pause) on the RunController (types/index.d.ts RunControllerBase, per docs/USABILITY-EVAL.md:348-352), but these operate on the whole run's declared timeline, not on individually addressable per-animation Tween objects with their own play/pause/reverse/seek/reset/finish methods and 30+ named easings.
- **Verifier note:** The library uses WAAPI (docs/research/rendering.md:19) driven by a single global playhead per run; there is no per-property Tween-instance API analogous to Konva.Tween.

### 7. SVG-to-canvas and canvas-to-SVG bidirectional parsing/export

- **Category:** Export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Fabric.js
- **What they offer:** Fabric.js includes a built-in parser that converts SVG markup into canvas objects and can serialize a canvas scene back out to SVG (fabric.Canvas#toSVG), alongside object-level export and image filters.
- **Why it matters here:** sparkle-motion-visualizer's export path is exportSVG/exportPNG only; there's no documented import path (e.g. taking a hand-authored SVG fragment as a custom node visual/icon). This bears on the 'no node shapes beyond rounded rects, no custom shape system' known limit.
- **How it could fit:** Not a strict match (Fabric is canvas-based) but the pattern of accepting arbitrary SVG as an embeddable node visual (icon/logo per node) is the closest actionable idea — g.style(fn) could in principle return a background-image/foreignObject SVG reference, but this isn't documented as supported today.
- **Survey evidence:** https://github.com/fabricjs/fabric.js/ (verified)
- **Repo check:** src/export.js implements exportSVG() (serializes the live SVG scene to a standalone SVG string) and exportPNG() (rasterizes that SVG to a PNG Blob via canvas, one-way SVG->PNG). There is no canvas rendering target at all in this library (scene is native SVG per docs/research/rendering.md:14) and no SVG-markup-to-object parser.
- **Verifier note:** Not applicable to this architecture — the library has no canvas-based scene graph to parse SVG into or serialize out of; export is SVG-string and SVG->PNG only.

### 8. Declarative animation-script JSON with per-layer keyframe tracks, embedded in-file version/metadata, and a dedicated cross-platform player runtime

- **Category:** Storyboard DSL · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** Lottie / Bodymovin
- **What they offer:** The Lottie JSON format encodes named layers, per-property keyframe arrays (shape, transform, opacity, etc.), markers (named time ranges), and assets, all in one versioned JSON document (`v` field) rendered by a portable player (lottie-web / native SDKs) with no dependency on the original authoring tool.
- **Why it matters here:** This is the single closest prior-art format to sparkle-motion-visualizer's storyboard op-array: both are serializable, versioned(-ish), player-agnostic-ish JSON scripts driving timed visual playback. Lottie's format has two things smv's storyboard doesn't: (1) an explicit format-version field for compatibility, and (2) named 'markers' as a first-class concept distinct from both keyframes and comments — closely matching smv's own label/cue gap noted above.
- **How it could fit:** Adopt an explicit schemaVersion on the storyboard array (or a wrapper object) for forward compatibility as the op vocabulary grows; consider Lottie-style 'markers' array in cues() output for tooling interop (e.g. exporting cues in a Lottie-marker-compatible shape) alongside existing SRT/chapter formats.
- **Survey evidence:** https://docs.lottiefiles.com/en/format/lottie-json/specification (from memory/search summary, not independently fetched line-by-line this pass) (from memory / unverified)
- **Repo check:** The library does have a declarative JSON operation script (docs/research/critique.md:111: 'a JSON [{op, args, at}] array' — 'the only primitive', also referenced as the storyboard format in src/storyboard.js and README.md's g.storyboard(steps)) and a version-pinning discipline (npm run check-doc-versions, README.md:537-538) plus its own player/runtime (the mount+run engine itself, bin/smv-record.mjs for offline playback/rendering).
- **Verifier note:** This is structurally similar in spirit to Lottie (declarative timed script + dedicated player) but is NOT a per-layer keyframe-track format like Lottie's (no per-shape/per-property keyframe arrays, no 'v' schema-version field embedded in the document, no named time-range markers segment) — it's an ops-array script over a graph/pipeline spec, a different data model for a different purpose. Marking partial because the 'declarative script + dedicated portable player' shape is real, but the specific per-layer-keyframe-track JSON format is not.
- *Verifier's phrasing of the claim:* Declarative animation-script JSON with per-layer keyframe tracks, embedded version/metadata, dedicated cross-platform player runtime

### 9. Zoom-to-frame + breadcrumb navigation stack for drilling into a time-sliced visualization

- **Category:** Interaction / Time · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Speedscope
- **What they offer:** Speedscope's flamegraph view lets a user click a frame to zoom the view to that frame's time span, with a breadcrumb/back mechanism to zoom back out, layered over left-heavy/sandwich/time-order view modes.
- **Why it matters here:** sparkle-motion-visualizer's camera.node()/camera.nodes() director op already frames nodes, but there's no documented 'zoom stack' / back-navigation primitive for interactive (non-storyboard-scripted) exploration — relevant to live-mode (Mode B) exploration of a running/replayed process where a viewer might want to drill into a subgraph and back out.
- **How it could fit:** Could add viewport.pushFocus()/popFocus() convenience wrapping camera framing + an internal stack, for interactive (not just scripted) drill-down during live-mode viewing.
- **Survey evidence:** https://github.com/jlfwong/speedscope (README/features, from search summary) (from memory / unverified)
- **Repo check:** Grepped README.md/docs/src for breadcrumb|zoom.to.frame|drill; no hits. The library has compound-node expand/collapse (README.md:91,153) and pan/zoom (src/viewport.js) but no click-to-zoom-to-frame-span-with-breadcrumb-back mechanism analogous to Speedscope's flamegraph view.
- **Verifier note:** Zoom/pan is a plain 2D affine transform (docs/research/rendering.md:20) with no navigation-stack/breadcrumb concept.

### 10. SQL-queryable trace analysis over the visualized data

- **Category:** Analytics · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Perfetto UI
- **What they offer:** Perfetto's web UI allows arbitrary SQL queries against a loaded multi-GB trace (via a WASM trace_processor) to filter/aggregate events, in addition to the visual flame/track view.
- **Why it matters here:** sparkle-motion-visualizer's query surface (g.nodes(filter)/g.edges(filter)) is predicate/partial-match only, with 'no query language/DSL' as a documented limit. Perfetto shows the ceiling of what a time-aware execution visualizer's query layer can look like, though full SQL is likely overkill for this library's scale/remit.
- **How it could fit:** Out of scope for a lightweight embeddable library; noted mainly to confirm the existing 'no query DSL' limit is a deliberate, reasonable scope boundary rather than an oversight.
- **Survey evidence:** https://perfetto.dev/docs/ (general knowledge of trace_processor SQL, from memory) (from memory / unverified)
- **Repo check:** Grepped for 'sql' (case-insensitive) across README.md/docs/src; no hits. src/query.js exists but per README.md:554 ('query sugar') is a small JS query-helper API over the graph spec, not a SQL engine over trace data.
- **Verifier note:** No WASM trace_processor or query language of any kind beyond the JS query.js helper functions.

### 11. postMessage-based iframe embed protocol with a formal init/load/save/exit handshake

- **Category:** Distribution / Integrations · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** diagrams.net (draw.io)
- **What they offer:** draw.io's embed mode runs the full editor inside an iframe and communicates with the host page via window.postMessage using a documented protocol: host waits for an 'init' event, sends a 'load' action with xml/config, and listens for 'save'/'export'/'exit' events; a configure=1 URL flag lets the host push theme/fonts/colors/libraries at init.
- **Why it matters here:** sparkle-motion-visualizer is mounted directly into the host DOM (mount(el, spec, opts)), which is appropriate for its 'no build step, inline SVG' model, but there is no documented sandboxed/cross-origin embed mode — relevant if the library is ever embedded in contexts (CMS widgets, untrusted third-party pages) wanting DOM isolation.
- **How it could fit:** Likely out of current scope (adds real complexity for a stated zero-dependency, DOM-embed library) but worth flagging as the standard pattern if a sandboxed embed mode is ever requested.
- **Survey evidence:** from memory + search summary of jgraph/drawio-integration protocol docs (from memory / unverified)
- **Repo check:** docs/EMBED.md's actual headings (grepped: '## 1. Copy-paste embed', '## 2. smv-pack CLI — one self-contained HTML file', '## Spec and mount options') show the embed story is copy-paste script tags and a single self-contained HTML file packer (bin/smv-pack.mjs). Grepped docs/EMBED.md directly for postMessage|iframe: zero hits.
- **Verifier note:** No iframe-hosted editor or cross-frame message protocol exists; embedding means inlining the library/spec into the host page directly, the opposite approach from draw.io's iframe handshake.
- *Verifier's phrasing of the claim:* postMessage-based iframe embed protocol with init/load/save/exit handshake

### 12. Text-based architecture-diagram DSL with multi-target export (PlantUML/Mermaid/etc.) from one source model

- **Category:** Text DSL input · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Structurizr
- **What they offer:** Structurizr DSL is a plain-text 'models as code' language that defines a C4 software-architecture model once and renders/exports it to multiple diagram formats (PlantUML, Mermaid, WebSequenceDiagrams, Ilograph) via the Structurizr CLI, decoupling the model from any one rendering target.
- **Why it matters here:** sparkle-motion-visualizer's GraphSpec is JSON-only ({nodes[],edges[]}); there's no text/DSL authoring format (e.g. a Mermaid-like shorthand) and no documented export to other diagram interchange formats (DOT/GraphML/Mermaid/PlantUML) — both are stated known limits ('no data-source adapters', 'no other export formats'). Structurizr is concrete prior art for what a lightweight DSL-to-spec compiler could look like.
- **How it could fit:** A small text-DSL-to-GraphSpec compiler (e.g. accepting Mermaid flowchart syntax or a custom terse format) could ship as a separate optional entry point (sparkle-motion-visualizer/dsl) without touching the core zero-dependency bundle, consistent with the existing ESM-only optional-subpath pattern (export, a11y-table, adapters/dagre).
- **Survey evidence:** https://structurizr.com/dsl , https://docs.structurizr.com/dsl (verified)
- **Repo check:** Grepped README.md/docs/src for mermaid|dsl|plantuml (case-insensitive); the only hits are docs/research/landscape.md and docs/research/cyclic-layout.md discussing Mermaid as *competing prior art being researched*, and docs/PLAN.md:32 explicitly disclaims building 'a text DSL à la Mermaid' as out of scope.
- **Verifier note:** The library's input is a JSON graph spec (nodes/edges), not a text DSL, and it has no multi-target diagram-format exporter — export is limited to SVG/PNG of its own rendering (src/export.js).
- *Verifier's phrasing of the claim:* Text-based architecture-diagram DSL with multi-target export (PlantUML/Mermaid/etc.)

### 13. Buffered event relay with replay-for-late-connections to a separate inspector process/tab

- **Category:** Live-mode event-log replay / time-travel · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** @statelyai/inspect (XState/Stately)
- **What they offer:** @statelyai/inspect's inspector relays every state-machine transition and actor-communication event to a Stately inspector UI (in-browser or via a websocket-relayed server), buffering events so a browser tab that connects late still receives the full history and can replay/scrub it.
- **Why it matters here:** This is a much closer analog to sparkle-motion-visualizer's Mode B (live) event-log replay + two-clock (frontier/view) model than the heavier orchestrator UIs (Airflow/Temporal) the first sweep compared against. The specific gap: @statelyai/inspect supports a detached/out-of-process inspector (separate browser tab or server relay) receiving a buffered event stream over the network, whereas smv's Mode B only documents an in-page, same-process event feed (start(id)/finish(id)/fail(id)/spawn(id) calls into the same g instance) with run.log()/run.reset() for manual snapshot/restore — there's no documented transport-agnostic 'buffer + relay to a remote/later-connecting viewer' primitive.
- **How it could fit:** run.log() + run.reset({log, mode:'live'}) already gives the building blocks (full log export/reseed); a documented pattern or thin helper for piping that log over a WebSocket/SSE to a remote viewer instance (buffering while disconnected) would close this gap without new core API surface.
- **Survey evidence:** https://github.com/statelyai/inspect (README: buffering/replay for late connections), https://www.npmjs.com/package/@statelyai/inspect (verified)
- **Repo check:** Grepped src/events.js and docs/LIVE.md-adjacent files for buffering/replay/late-connect semantics; src/run-transport.js and src/transport.js handle the run's own event stream and scrubber but there is no separate inspector-process relay or late-joining-viewer replay buffer mentioned in README.md, docs/LIVE.md, or src/events.js.
- **Verifier note:** The library does have time-travel scrub (README.md:100, 'time-travel scrub back through it') but that is local seek within one mounted instance's own timeline, not a buffered relay to a second, possibly-later-connecting inspector tab/process.

### 14. Compound-container collapse with automatic external-edge re-routing and combo-scoped sub-layout

- **Category:** Layout / Data model · **Fit:** 3/5 · **Verified in repo:** `present`
- **Who has it:** AntV G6 (Combo)
- **What they offer:** G6's Combo element supports double-click collapse/expand where, on collapse, all internal nodes hide and any edges crossing the combo boundary are automatically re-routed to terminate at the combo itself; a dedicated ComboCombined layout mode configures the interior-of-combo layout independently from the outer/top-level graph layout.
- **Why it matters here:** The inventory already covers dedup+weighted meta-edge aggregation on collapse for this library, so the rollup semantics itself is not a gap — but G6's separately-configurable interior-vs-outer layout (ComboCombined) is: sparkle-motion-visualizer's container geometry is a single engine pass (child layout -> resize -> parent relayout), with no documented way to pick a different layout algorithm/options for what happens *inside* an expanded container versus the top-level graph.
- **How it could fit:** Could extend layout options with a per-node (container) override, e.g. node.data.layout = {...opts}, consumed by the engine's cluster/corridor pass for that container's children only — a natural extension of the existing pluggable-solver seam scoped to one container rather than the whole graph.
- **Survey evidence:** https://g6.antv.antgroup.com/en/manual/layout/combo-combined-layout , https://g6.antv.antgroup.com/en/manual/behavior/collapse-expand (verified)
- **Repo check:** README.md:91 'expand ⇄ collapse with meta-edge aggregation (deduped, weighted) while collapsed'; README.md:153 'g.expand(id)  g.collapse(id)  g.expandAll()  g.collapseAll()'; README.md:215-217 describes expandAll/collapseAll semantics; docs/PLAN.md D5 'Compound expand/collapse (R4)' (~line 236-249) details the collapse-to-meta-edge mechanics: 'collapse to one edge carrying weight: N, badged'; while expanded, edges attach to interior nodes. Implementation touchpoints in src/a11y.js:202/239/310 and src/engine.js reference collapsed containers structurally.
- **Verifier note:** This matches the claimed G6-Combo behavior closely: on collapse, boundary-crossing edges are automatically re-routed/aggregated onto the container as weighted meta-edges (deduped+weighted per README.md:91), and expand/collapse is a first-class animated core primitive, not a plugin. Did not find a distinct 'ComboCombined'-style separately-configurable interior-layout mode, but the core collapse+reroute claim is substantiated with concrete API and doc citations, not just a keyword hit.

### 15. Node grouping/clustering with edge-count and traffic-based visual weighting on aggregated edges between groups

- **Category:** Data model / Rendering · **Fit:** 1/5 · **Verified in repo:** `partial`
- **Who has it:** Grafana Node Graph panel
- **What they offer:** Grafana's Node Graph panel groups service-map nodes and renders aggregated edges between groups with visual weight (thickness) tied to traffic/count between the underlying members, alongside stat-based node coloring (error rate, latency).
- **Why it matters here:** Loosely overlaps with smv's existing meta-edge weight rendering; the notable difference (not independently verified) is Grafana's grouping being driven by arbitrary runtime metrics/tags rather than the library's declared parent/container hierarchy — flagged for awareness only, not independently confirmed via docs in this pass.
- **How it could fit:** No concrete action — this entry is speculative/from-memory territory and should be weighted low confidence.
- **Survey evidence:** https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/ (not fetched/confirmed this pass) (from memory / unverified)
- **Repo check:** README.md:91 confirms meta-edges are 'weighted' when a container is collapsed (i.e. edge thickness/weight scales with how many underlying edges/tokens are aggregated), and docs/PLAN.md:249 says the collapsed meta-edge carries 'weight: N, badged'.
- **Verifier note:** This gives group-level edge aggregation with a weight value, similar in kind to Grafana's Node Graph traffic-weighted aggregated edges. Marked partial rather than present because: (1) this repo has no service-map/stat-based node coloring (error rate, latency) analog — grepped and found no such feature — and (2) it's unclear from docs alone whether 'weight' visually renders as edge thickness (traffic-weighting) versus just a numeric badge; PLAN.md text says 'badged' which suggests a label/counter rather than confirmed variable stroke-width scaling.

### 16. Waveform/audio-timeline display and transcript/caption sync tooling for voice-over authoring

- **Category:** Voice-over / audio-sync authoring · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** 
- **What they offer:** No cohort library in this sweep was confirmed to directly offer a bundled waveform-display or transcript-alignment component; this is flagged as a category the research prompt called out as a real gap for this library specifically (docs/RECORDING.md advertises 'fitting holds to a recorded voice-over' as a first-class use case via smv-fit, but smv-fit only consumes a flat marks.json of landing timestamps — there is no visual waveform, no transcript/caption-to-audio alignment UI, and no bundled tool to help a user produce marks.json from an actual audio file in the first place).
- **Why it matters here:** This is the single most distinctive documented use case (voice-over fitting) with the thinnest tooling: smv-fit is a pure JSON-to-JSON stretcher assuming marks.json already exists, with no guidance or tooling for generating those marks (e.g. from Whisper-style forced alignment, or a simple visual waveform-click marker tool) — a real, self-identified gap rather than a cohort-library comparison.
- **How it could fit:** Could ship a small optional browser tool/CLI (e.g. smv-marks) that loads an audio file, shows a waveform (canvas/SVG), and lets an author click-to-place named marks exporting directly to the marks.json shape smv-fit already consumes — closing the authoring loop without touching the core runtime.
- **Survey evidence:** inferred directly from the library's own docs/RECORDING.md description and smv-fit's documented input contract (no external library confirmed to fill this gap in this research pass) (from memory / unverified)
- **Repo check:** docs/RECORDING.md section 6 'Fitting the script to a recorded voice-over: smv-fit' (line 433) and bin/smv-fit.mjs: usage is `npx smv-fit sb.json --vo marks.json -o fitted.sb.json` where marks.json is a flat set of landing timestamps per label (docs/RECORDING.md:445). Grepped README.md/docs/src for waveform|transcript|caption: zero hits besides the word 'caption' appearing once in README.md:557 referring to storyboard step captions, unrelated to audio captions.
- **Verifier note:** Confirms the claim precisely: smv-fit consumes only a timestamp-per-label marks.json: there is no waveform display, no transcript/caption-to-audio alignment UI, and no bundled tool to produce marks.json from raw audio (the user is expected to supply marks.json themselves).

### 17. SVG-to-PDF / print rasterization export path

- **Category:** SVG-native export/asset pipeline · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** diagrams.net (draw.io)
- **What they offer:** draw.io's export supports SVG, PNG, and PDF directly from its diagram source, including print-oriented output.
- **Why it matters here:** sparkle-motion-visualizer's export surface is exportSVG + exportPNG only (both documented, ESM-only); there's no PDF or print-oriented rasterization path despite the library's SVG-native, DOM-inspectable output being unusually well-suited to a clean SVG->PDF conversion (e.g. via a headless-Chromium print-to-PDF, similar machinery to what smv-record already depends on for Chromium).
- **How it could fit:** Given smv-record already carries a Chromium dependency chain, a smv-print or --pdf flag reusing that same headless-browser infra (page.pdf()) to rasterize exportSVG output would be a natural, low-net-new-dependency extension.
- **Survey evidence:** https://www.drawio.com/ (from search summary: 'export to SVG, PNG, PDF') (verified)
- **Repo check:** Grepped README.md/docs/src/bin for 'pdf' (case-insensitive, word boundary): zero hits. src/export.js implements only exportSVG() (SVG string) and exportPNG() (canvas-rasterized PNG Blob) per its own header comment 'exportSVG / exportPNG (M2, D11)'.
- **Verifier note:** No PDF export path of any kind (no print stylesheet, no PDF library, no CLI flag) exists in the codebase.

## Borrowable ideas

- RoughViz/Rough.js's single 'roughness'/'fillStyle'/'bowing' knob set for a hand-drawn rendering variant — sparkle-motion could offer an optional --smv-sketch theme or a renderer preset that redraws rounded-rect/polyline paths with jittered control points, reusing the existing style()/props() override layer rather than a new subsystem.
- Frappe Gantt's dependency_shifting / dependencies_type options (how a dragged/resized bar propagates to dependents) — even without user dragging, this library's condense/split reflow logic could borrow the naming/semantics for how duration edits to one node should (or shouldn't) cascade timing to downstream nodes.
- Konva.Tween's play/pause/reverse/seek/reset/finish vocabulary is close to this library's own transport verbs — worth auditing for parity/naming consistency (e.g. does g's ticker expose 'reverse'?).
- vis-timeline's addCustomTime(time, id) for multiple named markers on one timeline — directly portable as a storyboard/cue-sheet concept: multiple named markers (not just labels) addressable by id for voice-over sync points.
- Lottie/Bodymovin's JSON spec versioning field (`v`) baked into every exported file — the storyboard op-array format could adopt an explicit schema-version field for forward compat, since GraphSpec/StoryboardStep currently have none documented.
- Speedscope's drag-and-drop-a-local-file-to-view + zero-backend, fully static single-page viewer model reinforces smv-pack's single-file .html approach — worth citing as validation, and its flamegraph zoom-to-frame interaction (click a frame to zoom, breadcrumb to zoom back out) is a reusable pattern for camera.node() with a 'back' stack.
- draw.io's postMessage embed protocol (init/load/save/exit handshake, configure=1 for theming) is a clean model if sparkle-motion-visualizer ever wants a hosted-iframe embed mode distinct from the current inline-script mount.
- AntV G6's ComboCombined layout naming ('combo' as the container-layout term, separate outer/inner layout configs) is a useful naming reference if this library ever exposes independent layout options for container-interior vs top-level graph.

## Survey notes

Coverage was uneven across the named cohort due to sandbox/time constraints: strong, source-verified detail obtained for Rough.js/RoughViz (npm + GitHub), Frappe Gantt (npm+GitHub+docs), Fabric.js (npm/GitHub releases), @statelyai/inspect (npm+GitHub), Structurizr (official docs), draw.io/diagrams.net (GitHub integration repo + drawio.com), Perfetto (Google GitHub + perfetto.dev), Speedscope (GitHub). Weaker/unverified: exact current vis-timeline npm version (only HISTORY.md/type-defs confirmed, not a pinned version number — reported as unknown rather than guessed), Konva.js exact npm version (not independently pinned), Lottie/lottie-web exact package version (only an example format-version field '5.12.0' seen, not the player's npm version), Grafana Node Graph grouping semantics (flagged low-confidence, not fetched). No fabricated version numbers were reported; all uncertain values are explicitly marked 'unknown' per instructions. The 'waveform/voice-over tooling' gap and 'SVG-to-PDF' gap are the two highest-fitScore items (4 and 3) since they map directly onto capabilities this library itself advertises but leaves shallow, per the task's explicit callouts about docs/RECORDING.md and the SVG export pipeline. Two entries (Grafana Node Graph, Konva hit-testing) are included at low fitScore/verified:false mainly for completeness against the prompt's explicit request list, not because they represent strong actionable gaps.
