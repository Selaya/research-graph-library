# Cohort survey: observability-and-state
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** Jaeger/Grafana Tempo trace views & service graphs, Kiali service graph (animated traffic, health), Grafana node graph panel, Datadog/New Relic service maps, Perfetto/Chrome trace viewer (flame + flow arrows), XState/Stately visualizer & inspector (state machines, actor events), bpmn-js (BPMN modeling, token simulation plugin), Camunda

**Verification tally:** 4 claimed gaps: 4 missing, 0 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| Jaeger UI | unknown (monorepo, no single confirmed release tag checked) | Apache-2.0 | https://github.com/jaegertracing/jaeger-ui | yes | Trace waterfall/timeline viewer + service dependency graph for distributed tracing |
| Grafana Tempo / Grafana Explore trace view | unknown | AGPL-3.0 (Grafana) | https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/ | yes | Trace UI embedded in Grafana Explore, node-graph-based service graph derived from trace data |
| Kiali | unknown exact npm version; PatternFly Topology is current graph backend (from v2.0+) | Apache-2.0 | https://kiali.io/docs/features/topology/ | yes | Istio service-mesh observability console with an animated, health-colored service graph, now built on PatternFly Topology (Cytoscape.js deprecated as of v2.0, removed v2.8) |
| Grafana Node Graph panel | unknown | AGPL-3.0 (Grafana core) | https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/node-graph/ | yes | Built-in Grafana panel type for arbitrary node/edge graphs with arc-section rings and stat overlays |
| Datadog Service Map | n/a (SaaS feature) | proprietary/SaaS | https://docs.datadoghq.com/tracing/services/services_map/ | yes | Real-time, auto-discovered service dependency map with clustering, faceted filtering, and time-range scoping |
| New Relic Service Maps | n/a | proprietary/SaaS | unknown - not independently fetched this pass | no | APM-derived service dependency topology view |
| Perfetto UI | unknown | Apache-2.0 | https://ui.perfetto.dev / https://github.com/google/perfetto | yes | Web-based trace viewer: zoomable multi-track timeline, flame/pprof-style aggregation, flow-event arrows between slices, SQL query console over Trace Processor |
| XState | unknown (v5 line current, not independently confirmed exact patch this pass) | MIT | https://github.com/statelyai/xstate | no | State machine / statechart / actor library for JS/TS |
| @statelyai/inspect (Stately Inspector) | unknown | MIT | https://github.com/statelyai/inspect / https://stately.ai/docs/inspector | yes | Drop-in runtime inspector for XState actors: live actor-tree, event log, snapshot updates, session recording/export, browser + WebSocket transports |
| bpmn-js | 18.19.0 (npm, per search result — not independently re-verified against npm registry directly) | MIT (bpmn.io / Camunda Services GmbH) | https://github.com/bpmn-io/bpmn-js | yes | BPMN 2.0 rendering/modeling toolkit for the web: palette, context pad, drag-connect, properties panel extension |
| bpmn-js-token-simulation | unknown | MIT (bpmn.io) | https://github.com/bpmn-io/bpmn-js-token-simulation | yes | BPMN 2.0-compliant token simulation plugin for bpmn-js/Camunda Modeler: play tokens through gateways/parallel paths, disables editing during sim |
| Camunda (Platform 7 / Camunda 8 + Operate/Cockpit) | unknown | proprietary core with source-available components; bpmn-js tooling itself MIT | https://camunda.com | no | BPMN process engine with live process-instance visualization (token/incident overlay on the BPMN diagram) via Operate/Cockpit |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Ports / named connection handles per node

- **Category:** data model · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** bpmn-js; XState/Stately
- **What they offer:** BPMN elements expose multiple distinct connection points (sequence-flow source/target anchors per side); Stately's editor and most flowchart-style tools let an edge terminate at a specific side/handle rather than 'the node' generically.
- **Why it matters here:** Pipeline/process diagrams often need branch-specific visual anchoring (e.g. a gateway's yes/no outputs leaving from clearly different points) for readability, especially with parallel/exclusive gateways.
- **How it could fit:** Could extend EdgeSpec with an optional {sourcePort, targetPort} hint consumed only by rendering (anchor offset), without touching the layout solver's node-to-node routing.
- **Survey evidence:** from memory (bpmn-js sequence flow docking) + search results on bpmn-js palette/connect (from memory / unverified)
- **Repo check:** No 'port', 'handle', or 'anchor' concept in layout.js, engine.js, or types/index.d.ts. EdgeSpec (types/index.d.ts:37) only references node ids (source/target node), not a side/handle. Grep for 'handle|port|anchor' across src and types returns no relevant matches beyond incidental words like 'defensively handled'. Layout (src/layout.js) computes edges between node boxes generically with bend-point sampling (sampleCubic), not fixed per-side anchors.

### 2. Interactive node dragging / manual repositioning

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** bpmn-js; Kiali; Grafana Node Graph; Stately editor
- **What they offer:** All of these let a user drag a node to a new position (bpmn-js as its core modeling interaction; Kiali/Node Graph as a manual override on top of auto-layout).
- **Why it matters here:** sparkle-motion's knownLimits explicitly says layout is entirely computed with no manual adjustment — for narration/authoring workflows, letting an author nudge a node and pin it would materially improve authorability of hand-tuned diagrams.
- **How it could fit:** Would need a per-node 'pinned' position override respected by the engine's ordering pass (fits the existing componentOrder-style pinning story) plus a drag interaction handler.
- **Survey evidence:** https://github.com/bpmn-io/bpmn-js ; https://kiali.io/docs/features/topology/ (verified)
- **Repo check:** src/interact.js and src/viewport.js implement only whole-canvas pan/zoom and tap-to-expand/collapse via svg-level pointerdown/pointermove/pointerup (viewport.js:184-257, interact.js:7-61). No per-node pointerdown handler or drag-to-reposition code exists anywhere in src/. README.md:118 confirms interaction model is 'pan... zoom only on ctrl/cmd+scroll, fitView() when you ask' plus tap-toggle for expand/collapse (README.md:130-132) — no mention of node dragging.

### 3. Minimap / navigator overview

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Jaeger UI; Perfetto
- **What they offer:** Jaeger's trace timeline has a persistent minimap strip showing the whole trace with a draggable viewport window for coarse navigation; Perfetto has an analogous overview timeline.
- **Why it matters here:** On large graphs/long token runs, sparkle-motion currently only offers pan/zoom + fitView; a minimap gives at-a-glance orientation especially once viewport culling kicks in above 150 elements.
- **How it could fit:** Could be a small opt-in overlay reading g.bounds()/viewport.worldToScreen, rendered as a secondary mini-SVG synced to the main viewport transform.
- **Survey evidence:** https://github.com/jaegertracing/jaeger-ui/pull/93 (minimap UX) (verified)
- **Repo check:** grep -i 'minimap|navigator|overview' across src/, bin/, README.md returns hits only in docs/research/* (PLAN.md, ux.md, critique.md, landscape.md) which are pre-implementation research/planning notes, not shipped features. No minimap component, secondary SVG, or viewport-overview code exists in src/viewport.js or elsewhere.

### 4. Search / find-and-highlight across nodes

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Kiali; Datadog Service Map; Jaeger UI
- **What they offer:** Kiali has dedicated 'Find and Hide' controls (search by name/health/traffic and highlight or hide matches); Datadog Service Map supports fuzzy string search plus facet filters; Jaeger highlights spans matching a text search.
- **Why it matters here:** sparkle-motion has query sugar (g.nodes(filter)) and a highlight/dim director op, but no built-in text-search-to-highlight UX wired together — every consumer has to build their own search box + highlight() calls.
- **How it could fit:** A thin convenience helper, e.g. g.find(text) returning matches plus a one-call g.highlight({query:text, dim:true}), layered entirely on existing primitives.
- **Survey evidence:** https://kiali.io/docs/features/topology/ ; https://docs.datadoghq.com/tracing/services/services_map/ (verified)
- **Repo check:** src/query.js (81 lines) implements makeQuery(store) with nodes(filter)/edges(filter)/children/descendants/roots — a programmatic filter/predicate API for reading graph data, but it is a pure data-query surface (no DOM interaction, comment at query.js:1 says 'PURE — no DOM, no animation, just reads'). There is no built-in UI search box, text-match highlighting, or hide-non-matching-nodes feature. grep for 'search|highlight|find' in README.md/docs turns up only unrelated prose and research-doc mentions, not a shipped find/highlight control.

## Borrowable ideas

- Kiali's edge-health color grammar driven purely by traffic-derived thresholds (green/orange/red bands on edges, not just nodes) — sparkle-motion could add a built-in data-health/data-severity vocabulary alongside its existing data-status so consumers don't have to invent their own CSS classes for the extremely common 'ok/degraded/failing' 3-band case.
- Jaeger/Perfetto minimap: a small always-visible condensed overview strip with a draggable viewport window, distinct from ctrl+wheel zoom — cheap to add given the library already tracks viewport/world bounds.
- XState/Stately inspector's 'one line of code' opt-in inspector (createBrowserInspector()) that attaches to a running machine with zero app-code changes — sparkle-motion's Mode B live event feed could offer a similarly trivial 'inspect this EventTarget/WebSocket' adapter helper instead of requiring the consumer to hand-call start/finish/fail.
- bpmn-js's context pad (small radial/toolbar of contextual actions that appears next to a selected node) — a lightweight, opt-in decoration surface for common per-node actions (expand, focus, mute) would fit the existing preset-plugin contract.
- Perfetto's SQL/query console over trace data for ad-hoc analysis — even a tiny predicate-based query surface beyond g.nodes(filter) (e.g. aggregate durations, group-by) could reuse the existing token/run data without a new dependency.
- Datadog Service Map's fuzzy-search-to-spotlight pattern (type a name, matching nodes brighten, rest dim) maps almost directly onto the library's existing highlight(dim:true) primitive — just needs a text-input-driven convenience wrapper.
- Camunda/bpmn-js token simulation's 'disable modeling interaction during simulation' toggle — sparkle-motion could similarly auto-suspend tapToggle/expand-collapse while a Mode A/B run is actively playing, to prevent structural edits from desyncing a live narration.
- Grafana Node Graph's per-field arc-section legend (ring segments around a node encoding a breakdown, e.g. error % vs success %) is a compact multi-metric badge idea that could sit alongside the existing occupancy/loop badges without a new rendering backend.
