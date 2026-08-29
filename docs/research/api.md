# Research: Public API & data model

> One of 7 parallel research passes behind docs/PLAN.md · 2026-08-29

## Summary

Studied cytoscape.js (element JSON + compound nodes + expand-collapse extension), ECharts (setOption diffing + universalTransition groupId/childGroupId morphing), vis-network (DataSet mutation/event model), D3 (enter/update/exit join semantics), GSAP (timeline/label/play-pause-seek control surface), and Mermaid (declarative text DSL) as precedents. Key grounded fact: none of the full-featured graph libraries fit the <50KB budget — cytoscape.js core alone is ~112KB gzip (github.com/cytoscape/cytoscape.js .size-snapshot.json), ECharts is ~258-300KB gzip — so the recommendation is a from-scratch minimal core that borrows API *shapes* (not code) from these precedents: cytoscape's flat node/edge JSON with implicit `parent`-based compound nodes, ECharts' groupId/childGroupId pattern adapted into a `condense()`/`split()` morph API, vis-network's DataSet-style add/update/remove + event-emitter mutation API, D3's declarative diffing philosophy applied internally to a virtual-DOM-free SVG renderer, and GSAP's timeline/label/play/pause/seek surface repurposed so timeline steps are graph *operations* (each an awaitable animated Transition) rather than raw CSS tweens. A JSON/object-literal spec (not a Mermaid-style text DSL) is recommended as the primary authoring format because the library is animation- and mutation-heavy, not static-diagram-heavy, and a JSON object needs no parser to ship.

## Recommendation

Adopt a 5-part API surface:

1. **Graph spec** = flat `{nodes, edges, groups}` JSON, cytoscape-style: any node can be another node's parent (implicit compound/hierarchy) via `parent: "id"`; a node opts into starting collapsed via a plain `collapsed: true` flag on itself (no separate registry needed); `groups` is a SEPARATE, non-hierarchical concept (swimlanes/visual regions) so hierarchy and cross-cutting grouping don't get conflated — this is what makes it generalize beyond pipelines.
2. **Instantiation**: one `<script>` tag (IIFE/UMD global `FlowGraph`) + one call `FlowGraph.mount(selector, spec, opts)`; no required external CSS (styles injected as a `<style>` tag at mount time) so it is truly single-tag-embeddable; theming via a small token object (`opts.theme`) plus CSS custom properties and CSS classes on the rendered SVG nodes for power users.
3. **Mutation API**: vis-network-DataSet-flavored verbs — `addNode`, `addEdge` (append, fly-in animation), `update(id, patch)` (property tween), `expand(id)` / `collapse(id)` (per-node animated compound unfold, cytoscape-expand-collapse-style), and a new `condense(idArray, newNodeSpec)` / `split(id, newNodesArray)` pair modeled directly on ECharts' universalTransition groupId→childGroupId morph so N→1 (and 1→N) reads as "merging," not "delete+add." Every mutator returns a thenable `Transition` (`{promise, cancel()}`) and mutations can be `g.batch(fn)`-wrapped for one relayout pass, mirroring `cy.batch()`.
4. **Timeline/Scene API**: a GSAP-shaped timeline (`.to()`, `.label()`, `.wait()`, `.play/.pause/.seek/.stepForward/.stepBack`) whose "tweens" are the graph mutators above (each awaited before/overlapped with the next per a GSAP-like position parameter), PLUS a pure-JSON storyboard array (`{op, args, at}`) so a shared static HTML file can replay a narrative with zero authored JS, and a built-in optional transport-control UI bar (`controls: true`) so non-technical viewers get play/pause/scrub for free.
5. **Styling**: primary hook is a data-driven style FUNCTION (`g.style(node => ({...}))`, `g.edgeStyle(...)`), not a cytoscape-style CSS-selector-string stylesheet engine — this avoids shipping a selector parser/matcher (real KB cost) while staying fully generalizable (arbitrary JS predicates > selector strings for compound/status-driven pipelines). Secondary hook: rendered SVG nodes/edges carry stable CSS classes and `data-*` attributes (`.fg-node[data-status="done"]`) so simple theming needs no JS at all.
Distribution: publish ESM (tree-shakeable) + one self-contained IIFE min file to npm/jsdelivr/unpkg; ship a `FlowGraph.exportHTML(spec, storyboard)` helper that string-concatenates the IIFE source + spec + storyboard into one downloadable `.html` — trivial because the runtime already has zero external CSS/font/asset dependencies. Render via SVG + CSS transitions for simple property tweens (free GPU accel, near-zero JS tween code needed) and a small custom rAF tween engine (~2-4KB, GSAP-timeline-shaped API) only for things CSS can't do: path morphing during condense/split and playhead movement along arbitrary edge paths.

## Details


## Precedents studied (grounded)

**cytoscape.js** — element JSON model (github.com/cytoscape/cytoscape.js, iVis-at-Bilkent/cytoscape.js-expand-collapse):
```js
{ group: 'nodes', data: { id: 'n1', parent: 'nparent' }, position: {x,y}, classes: ['foo'] }
{ group: 'edges', data: { id: 'e1', source: 'n1', target: 'n2' } }
```
Compound nodes are just nodes referenced as `parent`, no special "group" type needed. The `cytoscape.js-expand-collapse` extension's API: `api.collapse(nodes, {animate:true, animationDuration:1000})`, `api.expand(nodes, opts)`, `.collapseAll()/.expandAll()`, `.getCollapsedChildren(node)`, and it tags collapsed compound nodes with a CSS class (`cy-expand-collapse-collapsed-node`) for styling — i.e. collapse state is exposed via classes/queries, not a side-channel data structure. **Size finding**: cytoscape.js core UMD/ESM min+gzip is ~112.3–112.5KB per its own `.size-snapshot.json` (github.com/cytoscape/cytoscape.js/blob/unstable/.size-snapshot.json) — over 2x our entire budget before any layout extension or app code, ruling it out as a dependency even though its data model is worth copying.

**Apache ECharts universalTransition** (apache/echarts src/animation/universalTransition.ts + PR #15208): series with the same `id` across two `setOption()` calls animate automatically (diff-based, no manual enter/exit bookkeeping from the app). For N→1 / 1→N morphs specifically, ECharts introduces `groupId` / `childGroupId` on data items (or via `encode.itemGroupId` / `encode.itemChildGroupId`) to declare parent-child correspondence between the old and new data so the renderer can compute a shape-divide/merge animation (`divideShape` option) instead of a generic cross-fade. This is the single most directly transferable idea for our `condense()`/`split()` requirement — it's exactly "several nodes merge into one, animate it, and the direction (up=condense, down=split) is inferred from which side has the group id vs the child group id." **Size finding**: ECharts min+gzip is ~258–300KB depending on minifier (community reports, minification-benchmarks repo) — confirms it's a UI/animation *pattern* to borrow, not a dependency to ship.

**vis-network / vis-data DataSet** (visjs/vis-data, visjs/vis-network): mutation is `dataset.add(items)`, `.update(items)` (merges by id), `.updateOnly(items)` (errors if id missing, useful for "must already exist" semantics — nice precedent for a strict-update mode), `.remove(ids)`, `.get(...)`, plus a pub/sub layer: `dataset.on('add'|'update'|'remove'|'*', (event, properties, senderId) => {})`. This event-emitter-over-a-plain-collection model is exactly the shape for our `g.on('nodeAdded', ...)` etc., and cleanly separates "what changed" (data event) from "how it animated" (the Transition object returned by the imperative call).

**D3 join/enter/update/exit** (d3js.org/d3-selection/joining, d3-transition): `selection.join(enter => ..., update => ..., exit => ...)` — each of the three callbacks can return a `.transition()`, and D3 merges their results. The generalizable lesson (not the API itself — D3 is DOM-selection-centric and awkward for compound/hierarchical SVG group nesting) is: internally render via a **keyed diff** (by node/edge id) so our own `update()` implementation doesn't need the caller to distinguish "this is new" vs "this changed" — the library diffs old-vs-new render state and animates accordingly, same spirit as ECharts' id-based `setOption` diffing.

**GSAP timeline** (gsap.com docs via search): `gsap.timeline()`, `.to(target, vars, position)`, `.addLabel(name, position)`, position strings like `"+=0.5"` or `"<"` for overlap, and transport controls `tl.play()/.pause()/.seek(t)/.progress(p)/.reverse()/.restart()`. **Size finding**: GSAP core (no plugins) is reported ~23KB min+gzip — small enough to fit our whole budget alone, which is why we borrow its *timeline API surface* for our storyboard scripting even if we hand-roll a much smaller (~3KB) internal tween engine rather than taking GSAP as a hard dependency (keeps headroom for the graph engine itself).

**Mermaid** (mermaid.js.org/syntax/flowchart.html): text DSL, e.g. `flowchart TD; subgraph Backend; API-->DB; end`. Rejected as the *primary* spec format for this library: Mermaid's value is terse authoring of a static diagram checked into markdown; it has no natural extension for imperative mutation (`addNode` mid-session), per-node animated collapse state, or morph operations — you'd be writing a DSL-to-JSON compiler and then building the exact same imperative API underneath anyway. JSON/object-literal is what cytoscape.js and vis-network both converged on for this reason. (Optionally, a thin textual sugar syntax for the *storyboard* — not the graph — could be added later without affecting the core.)

## 1. Graph spec

```js
const spec = {
  nodes: [
    { id: "ingest", label: "Ingest Data",  data: { duration: 7200,  status: "done"   } },
    { id: "clean",  label: "Clean Data",   data: { duration: 10800, status: "active" }, collapsed: true },
    { id: "clean.dedupe",   parent: "clean", label: "Dedupe",   data: { duration: 1800 } },
    { id: "clean.validate", parent: "clean", label: "Validate", data: { duration: 3600 } },
    { id: "clean.normalize",parent: "clean", label: "Normalize",data: { duration: 5400 } },
    { id: "deploy", label: "Deploy", data: { duration: 0, status: "pending" } },
  ],
  edges: [
    { id: "e1", source: "ingest", target: "clean" },
    { id: "e2", source: "clean.dedupe",   target: "clean.validate" },
    { id: "e3", source: "clean.validate", target: "clean.normalize" },
    { id: "e4", source: "clean", target: "deploy" },
  ],
  // Cross-cutting, NON-hierarchical grouping (swimlanes / phases) — distinct from parent/child:
  groups: [
    { id: "phase-1", label: "Manual Phase", nodeIds: ["ingest", "clean"], style: "lane" }
  ]
};
```
Rules: (a) any node referenced by another node's `parent` automatically renders as a compound/container node — no separate "type: group" needed, matching cytoscape.js; (b) `collapsed: true` on a parent node is purely a *declared initial render state*, expand/collapse afterward is imperative (`g.expand/collapse`), consistent with expand-collapse extension semantics; (c) `groups[]` is orthogonal — a node can be both inside a hierarchy parent and inside a visual group/lane simultaneously, which real pipeline diagrams need (e.g. "these 3 steps, across 2 different compound parents, are all part of the manual phase").

## 2. Instantiation in a plain HTML page

```html
<div id="pipeline" style="width:100%;height:480px"></div>
<script src="https://cdn.jsdelivr.net/npm/flowgraph@1/dist/flowgraph.iife.min.js"></script>
<script>
  const g = FlowGraph.mount("#pipeline", spec, {
    theme: "light",            // "light" | "dark" | { bg, nodeFill, edgeStroke, ... }
    layout: "layered-lr",      // built-in layered DAG layout, pluggable
    animation: { duration: 350, easing: "cubic-out" },
    controls: false            // set true to render a play/pause/scrub bar (storyboard mode)
  });
</script>
```
No build step, no separate CSS `<link>` required — default styles are injected as an inline `<style>` scoped to the mount container at `mount()` time. ESM form for bundler users: `import { mount } from "flowgraph";`.

## 3. Mutation API

```js
// Append at end — animates a fly-in / fade-in from the graph's trailing edge
await g.addNode({ id: "monitor", label: "Monitor", data: { duration: 0, status: "pending" } }, { after: "deploy" });
await g.addEdge({ id: "e5", source: "deploy", target: "monitor" });

// Per-node animated hierarchical expand/collapse
await g.expand("clean");     // unfolds clean.dedupe/validate/normalize in place
await g.collapse("clean");   // reverse

// Data update -> property tween (e.g. status color swap, duration label change)
await g.update("clean", { data: { status: "done", duration: 8200 } });

// Condense N -> 1 (ECharts groupId/childGroupId-style morph), communicates speed-up
await g.condense(
  ["clean.dedupe", "clean.validate", "clean.normalize"],
  { id: "clean.auto", label: "Automated Cleaning", data: { duration: 90, status: "automated" } },
  { annotate: (oldTotal, newDuration) => `${Math.round(oldTotal / newDuration)}x faster` }
);

// Inverse, for generality beyond the pipeline case
await g.split("clean.auto", [
  { id: "clean.dedupe",   data: { duration: 900 } },
  { id: "clean.validate", data: { duration: 900 } },
]);

// Batch multiple ops into one relayout+animation pass (cy.batch()-style)
g.batch(() => {
  g.addNode({ id: "x", ... });
  g.addEdge({ id: "ex", source: "deploy", target: "x" });
});
```
Every mutator returns a `Transition`: `{ then(...), cancel(), duration }` (thenable so `await`/`.then()` both work); `condense`/`split` compute the merge direction the same way ECharts infers it from which node carries `groupId` vs `childGroupId` — here expressed directly as "sources array" vs "target spec" rather than a generic id-matching field, since our API is imperative (not a `setOption` diff) and can be more explicit.

Events (vis-network DataSet-flavored):
```js
g.on("nodeAdded",  ({ node }) => {});
g.on("expand",     ({ nodeId }) => {});
g.on("condense",   ({ sources, target }) => {});
g.on("update",     ({ id, patch }) => {});
g.on("transitionEnd", ({ op, ids }) => {});
```

## 4. Timeline / storyboard API

Imperative (JS) form, GSAP-shaped:
```js
const story = g.timeline();
story
  .to(() => g.addNode({ id: "ingest", ... }))
  .label("step-1")
  .to(() => g.update("ingest", { data: { status: "active" } }))
  .wait(600)
  .to(() => g.update("ingest", { data: { status: "done" } }))
  .label("step-2")
  .to(() => g.expand("clean"))
  .to(() => g.playhead.moveTo("clean.validate"), "+=200")   // GSAP-style position offset
  .label("automate")
  .to(() => g.condense(["clean.dedupe","clean.validate","clean.normalize"],
                        { id: "clean.auto", label: "Automated Cleaning", data: { duration: 90 } }));

story.play();
story.pause();
story.seek("automate");     // jump to a label
story.stepForward();        // advance exactly one .to() unit — for manual "click to advance" demos
story.stepBack();
story.on("stepchange", ({ label, index }) => {});
```
Declarative (pure JSON) form — for the "shared HTML file replays a narrative with zero authored JS" requirement:
```js
FlowGraph.mount("#pipeline", spec, {
  storyboard: [
    { op: "addNode", args: [{ id: "ingest", ... }] },
    { label: "step-1" },
    { op: "update", args: ["ingest", { data: { status: "active" } }] },
    { wait: 600 },
    { op: "expand", args: ["clean"] },
    { label: "automate", at: "+=200" },
    { op: "condense", args: [["clean.dedupe","clean.validate","clean.normalize"],
                              { id: "clean.auto", label: "Automated Cleaning", data: { duration: 90 } }] }
  ],
  autoplay: false,
  controls: true   // renders a built-in play/pause/prev/next/scrubber bar — no extra script needed
});
```
The declarative form is what `FlowGraph.exportHTML()` embeds when generating a shareable static file.

## 5. Styling hooks, events, distribution

Styling — function-based primary hook (avoids shipping a CSS-selector matcher, stays generalizable via arbitrary predicates):
```js
g.style(node => ({
  fill: { done: "#22c55e", active: "#3b82f6", pending: "#94a3b8", automated: "#a855f7" }[node.data.status],
  width: 60 + Math.sqrt(node.data.duration || 0),
}));
g.edgeStyle(edge => ({ stroke: "#cbd5e1", dashed: edge.data?.pending }));
```
Secondary hook — rendered SVG carries stable classes/attributes for CSS-only theming with no JS:
```css
.fg-node[data-status="done"]  { --fg-fill: #22c55e; }
.fg-node.fg-collapsed         { stroke-dasharray: 4 2; }
.fg-edge.fg-active            { stroke-width: 2; }
```
Distribution:
- npm package with dual output: `dist/flowgraph.esm.js` (tree-shakeable, for bundler users) and `dist/flowgraph.iife.min.js` (single `<script src>` global `FlowGraph`, for the no-build-step static-HTML use case) — same split cytoscape.js and vis-network both ship today.
- CDN via jsdelivr/unpkg automatically once published to npm (`https://cdn.jsdelivr.net/npm/flowgraph@1`).
- Zero required external assets (no separate CSS file, no web font, no icon sprite) — default look is pure inline SVG + injected `<style>` — which is what makes a true "self-contained HTML export" possible: `FlowGraph.exportHTML(spec, storyboardOpts)` returns a string with the IIFE bundle inlined in a `<script>` tag, the spec/storyboard inlined as JSON, and a `mount()` call — one `.html` file, no CDN dependency, safe to email or drop in a wiki.

## Bundle budget sanity-check (grounded numbers)
| Library | min+gzip | Source |
|---|---|---|
| cytoscape.js core | ~112.3–112.5 KB | github.com/cytoscape/cytoscape.js `.size-snapshot.json` |
| Apache ECharts | ~258–300 KB (minifier-dependent) | community bundlephobia reports / minification-benchmarks repo |
| GSAP core (no plugins) | ~23 KB | GSAP forums / bundlephobia (search-derived, not independently refetched) |
| Framer Motion (`motion`) full | ~30–34 KB; LazyMotion `m` variant ~4.6 KB | motion.dev/docs/react-reduce-bundle-size, pkgpulse.com |
| Preact | ~3–4 KB | preactjs/preact discussions |

None of the full graph libraries fit under our ~50KB target even alone, before layout/animation/hierarchy app code — confirming the recommendation to hand-roll a minimal core rather than depend on cytoscape/ECharts/vis-network, while explicitly reusing their *API vocabulary* (element JSON, groupId/childGroupId morphing, DataSet events, timeline labels) since that vocabulary is what developers already have muscle memory for.

## Sources
- https://github.com/cytoscape/cytoscape.js/blob/unstable/.size-snapshot.json
- https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse
- https://github.com/cytoscape/cytoscape.js/issues/2201 (elements JSON notation)
- https://github.com/apache/echarts/blob/master/src/animation/universalTransition.ts
- https://github.com/apache/echarts/pull/15208
- https://github.com/visjs/vis-data (DataSet add/update/remove/on)
- https://d3js.org/d3-selection/joining
- https://observablehq.com/@d3/selection-join
- GSAP timeline docs (gsap.com, greensock/gsap-skills SKILL.md) — timeline/.addLabel/.play/.pause/.seek
- https://mermaid.js.org/syntax/flowchart.html (subgraph text DSL, rejected as primary spec)
- https://motion.dev/docs/react-reduce-bundle-size ; https://www.pkgpulse.com/compare/framer-motion-vs-gsap


## Risks & caveats


- **Bundle size discipline is the biggest execution risk, not a design risk.** The API surface above (compound hierarchy + condense/split morphing + timeline scripting + built-in playback controls + SVG renderer) is more feature-dense than a typical "under 50KB" library; every one of the precedent libraries that does a subset of this is 5-10x over budget. Hitting the target requires NOT shipping a general layout engine (dagre-style layered DAG layout alone is nontrivial KB) as part of the core — likely needs the layout algorithm to be a separate lazy-loaded/optional module, or a deliberately simple built-in layout (e.g. rank-by-BFS-depth) with pluggable override, which is a decision for the "rendering/layout" dimension, not this one, but it directly constrains what "sensible defaults" in `mount()` can afford to include.
- **`condense`/`split` visual semantics are genuinely hard**, independent of API shape: morphing 3 separate SVG node shapes into 1 (with correct in-flight edge re-routing for all edges that touched the 3 sources) is a nontrivial rendering problem even once the API call is trivial to write. ECharts solves this only within its own scene-graph/shape-morph renderer (`divideShape`); replicating that cheaply in a hand-rolled ~small SVG renderer needs a design spike (e.g., approximate via layered fades + a converging-lines animation rather than true shape-divide geometry) before committing to the API's implied visual fidelity.
- **Numbers for GSAP core (~23KB) and D3-selection/d3-transition sizes came from WebSearch snippets, not a direct bundlephobia fetch** (bundlephobia.com and js.cytoscape.org were blocked by the environment's egress proxy for direct WebFetch). The cytoscape `.size-snapshot.json` and ECharts community numbers are more directly sourced (raw GitHub file / repo issue discussion) and should be trusted more than the GSAP/d3 figures, which are directionally right but worth re-verifying before publishing exact numbers externally.
- **Declarative JSON storyboard vs imperative timeline dual-API doubles the surface to maintain and test** — every operation (`condense`, `expand`, etc.) needs both a direct method and a serializable `{op, args}` form kept in sync; a naive implementation (reflect methods into the op table via a small dispatch map) mitigates this but must be designed in from day one or the two forms will drift.
- **Function-based styling (`g.style(node => ...)`) sacrifices the "inspect via CSS devtools" ergonomics** that cytoscape's selector stylesheets and plain CSS classes give for free; the CSS-class secondary hook is proposed specifically to cover that gap, but it means two independent styling systems that can conflict (a style function setting `fill` while a CSS rule also targets `fill`) — needs a clear precedence rule (e.g., function output becomes inline `style=` attrs, always winning over class-based CSS, with documented escape hatch to omit properties from the function to let CSS through).

