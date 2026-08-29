# Adversarial critique — cross-dimension conflicts, gaps, MVP cut

> Opus critic pass over the five primary research reports · 2026-08-29
> (The loops/parallelism reports arrived after this pass; their reconciliation lives in docs/PLAN.md.)

# CRITIC REPORT — cross-dimension conflicts, gaps, cuts, MVP

## 0. Numbers audit first (the reports disagree with each other; resolve before anything cites them)

| Artifact | landscape (unmeasured) | rendering (measured, npm tarball + gzip -9) | layout (measured, npm + gzip) | api (from repo file) | **Verdict** |
|---|---|---|---|---|---|
| cytoscape core, gzip | "~80–100KB" | **136.4KB** | **136.8KB** | 112.3–112.5KB (`.size-snapshot.json`) | Two independent direct measurements of `dist/cytoscape.min.js` agree at ~136KB. The 112KB figure is almost certainly the **ESM/module** entry in the repo's own snapshot, not the UMD dist. Publish **~136KB (UMD dist)**, note ~112KB ESM. landscape was **35–70% low**. |
| elkjs, gzip | "likely 250–350KB" | — | **464.6KB** (elk-worker.min.js) | — | landscape **under by ~40%**. Use 464.6KB. |
| dagre, gzip | "~30KB-ish" | — | **17.1KB** (48.9KB min, `@dagrejs/dagre` 3.1.1) | — | landscape **over by ~75%**. Use 17.1KB. **This number changes a strategic decision** — see Conflict 1. |
| mermaid, min | "2–2.8MB" | **953KB** (11.17.2 UMD); 10.8KB ESM loader | — | — | landscape cited a 2023 figure for v10.3.0. **Do not publish 2.8MB.** |
| vis-network, gzip | "~130–150KB" | **62KB** esnext / **150KB** standalone | — | — | landscape conflated the standalone bundle with core. |
| GSAP core, gzip | — | **28.3KB** | — | "~23KB" (search snippet) | Use 28.3KB. |
| sigma+graphology, gzip | "~60–80KB" | **46.0 + 13.9 = 60.9KB** | — | — | landscape happened to be right. |

**Adversarial conclusion:** every number in the landscape report is an unmeasured community figure and **every single one is off by 25–75%**. Its *conclusions* (build, don't adopt; ELK is disqualified) survive because the errors don't cross any decision boundary — **except for dagre**, where the error is decision-relevant. Treat the landscape report as a qualitative survey only; take all sizes from the rendering and layout reports, which independently measured real shipped artifacts and agree with each other where they overlap.

**Unverified and load-bearing:** does the measured `@dagrejs/dagre` `dist/dagre.min.js` (48.9KB min / 17.1KB gzip) **bundle `@dagrejs/graphlib`**, or is graphlib an external peer? The layout report lists graphlib as "(external: graphlib)" in its LOC table but measured only `dagre.min.js`. If graphlib is external, add ~8–12KB gzip and dagre-as-a-dependency becomes ~25–29KB — which flips Conflict 1. **This is the single highest-value 10-minute check before any milestone planning.**

---

## 1. CONFLICTS AND VERDICTS

### C1 — "Hand-write the layered layout" vs. "dagre is 17KB and does compound + order-stability natively"
- **landscape:** hand-write Sugiyama-lite as the zero-dep default; dagre optional adapter. Justification includes: *"it stays synchronous (critical for computing intermediate frames during a layout-change animation — async/worker-based elkjs make it much harder to interpolate positions frame-by-frame)."*
- **layout:** also hand-write (~960–1430 LOC, est. 4–8KB gzip), using dagre only as an algorithmic reference — while simultaneously documenting that dagre 3.1 already ships `useDynamic` order-stability and `recursiveClusterLayout` compound layout, MIT, 17.1KB.

**VERDICT: both reports are right about the endpoint and wrong about the sequencing. Build M0/M1 on `@dagrejs/dagre` behind a one-function internal interface; write the in-house engine in M2 against golden-file parity tests.**

Reasoning:
- **landscape's synchronicity argument is a false premise.** You never run layout per frame. You run it *once per mutation* and tween between two static layout results. Sync-vs-async only matters for ergonomics (`await`), not for animation fidelity. This argument should not carry weight in the decision. (It *is* a valid argument against elkjs on other grounds — 464KB and worker-only — but not this one.)
- The layout report's own evidence is the strongest case *against* its own recommendation: dagre already solved the two hardest sub-problems (cluster space reservation, ordering stability across appends) in a battle-tested MIT codebase at 17.1KB. Hand-writing them is the project's #1 schedule risk (see C2).
- Budget math works either way: dagre 17.1 + ~25KB core = ~42KB gzip, under target. If graphlib is external (+~10KB) it becomes ~52KB and the in-house engine moves from "M2 nice-to-have" to "M1 requirement."
- The de-risking value is disproportionate: with dagre you get a *working animated pipeline demo* — the thing that proves the whole design — weeks earlier, and the animation/morph/expand-collapse layer (the actually novel work, per landscape's own "no library has a node-condensation primitive" finding) gets exercised against real layout output including dummy-node bend points.

**Internal interface to freeze at M0** (makes the swap a 40-line change, and is the *only* plugin seam v1 should have):
```
layout(graphView, opts) -> {
  nodes: { [id]: {x, y, w, h} },
  edges: { [id]: { points: [{x,y}, ...] } },   // includes dummy-node bends
  bounds: {x, y, w, h}
}
```

### C2 — "~1000–1500 LOC / 4–8KB" in-house layout estimate
**This estimate is too optimistic and its derivation is unsound.** The layout report divides dagre's *TypeScript* LOC (including type declarations, `types.ts` at 171 LOC, comments) by its *minified JS* bytes to get "12.0 B/line," then applies that ratio to a hypothetical LOC count. That double-counts the simplification: you can't both remove type-only lines from the numerator *and* keep the bytes-per-line ratio derived from a corpus containing them.

Also, the proposed cut list keeps precisely the expensive parts (compound nesting, 200–280 LOC "keep close to full") and cuts the parts that are cheap to keep or genuinely optional (cycle detection at 20–40 LOC is fine; network-simplex genuinely is droppable). **Realistic: 2000–2800 LOC, 7–12KB gzip, and 3–5 weeks with a competent implementer plus a long tail of "why do these two edges cross" bugs.** The layout report's own Brandes–Köpf erratum citation (a flaw in the canonical algorithm found 18 years post-publication) is the strongest available evidence for this. **Plan for 10KB and M2.**

### C3 — Two animation clocks (WAAPI compositor vs. rAF main thread)
- **rendering:** WAAPI on transform/opacity (compositor thread, immune to main-thread jank) *and* a custom rAF loop for edge `d` geometry, run "with the *same* progress clock as the transform tweens."
- **This is self-contradicting.** The stated benefit of WAAPI is that it *does not share a clock with the main thread*. Under jank, node transforms advance on the compositor while edges lag on rAF — edges visibly detach from nodes, which is worse than uniform slowness. The rendering report simultaneously praises the decoupling and requires the coupling.

**VERDICT: one clock, driven by rAF, for everything that is part of a choreographed transition.**
- At M0/M1: **rAF-only.** The "SVG janks at 300–400 nodes" figure the rendering report cites is for a *continuous force simulation writing 4 attributes on every edge every frame indefinitely*. Our case is a bounded 400ms transition over ≤200 elements, ~20 frames of work total. This is not close to the threshold.
- WAAPI's actual value here is not the compositor — it's `currentTime` / `playbackRate` / `reverse()` as a **free seekable transport**. Use one `Animation` on a dummy element **purely as a clock source**: read `conductor.currentTime` inside rAF, derive `t`, write everything. That gives play/pause/scrub/speed for free *and* keeps one clock.
- Compositor offload is a **profiling-driven optimization for M2**, applied only to non-choreographed motion (hover, idle pulse), never to storyboard steps.
- **Corollary: nothing that participates in a scrubbable storyboard may be a CSS transition.** CSS transitions are not seekable or reversible mid-flight. The API report's "SVG + CSS transitions for simple property tweens, near-zero JS" and the rendering report's "state recolor is a plain CSS transition" both violate the scrub requirement the API report itself specifies (`story.seek('automate')`, `stepBack()`). CSS transitions are for hover/focus affordances only.

### C4 — "WAAPI cannot animate SVG attributes" is too strong, and it hides a real trap
The rendering report's blanket claim is inaccurate in a way that matters. In SVG2, `x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry` are **CSS geometry properties** with broad engine support and *are* WAAPI/CSS-animatable. `x1/y1/x2/y2` on `<line>` are not; `d` is the notorious outlier (Chrome-only historically). **Verify before relying on it**, but the practical consequences are:

**The real trap nobody caught:** if you animate a compound node growing during expand by putting `scale()` on its `<g>`, you scale the **stroke width and the label text** with it — the node visibly "zooms" rather than "grows." Container-transform expand must animate `width`/`height` on the `<rect>` (geometry properties) with the label repositioned per frame, **not** a group scale. This is a visible-quality bug that will look wrong in the flagship demo. The UX report's "container transform" and rendering's "FLIP scale" gloss over it.

### C5 — Edge path interpolation is materially harder than "~1KB of simple lerp"
rendering: *"each geometry tween stores endpoint/control-point pairs and lerps them... ~1KB of code."* This assumes the before and after paths have the same number of control points. **In a layered layout they routinely do not**: long edges are routed through *dummy nodes*, and a relayout after an append/collapse/condense can change an edge from 2 bends to 5. You cannot lerp a 4-point polyline into a 7-point polyline pointwise.

**VERDICT: resample both paths to a fixed N (24 is plenty) by arc length, then lerp pointwise.** Implementation: build a detached `<path>`, use `getTotalLength()` + `getPointAtLength()` at N uniform steps — ~25 LOC, no dependency, and it makes *every* edge transition (reroute, condense redirect, expand) use one code path. This is the right answer and it is genuinely cheaper than flubber (18.2KB measured) because rect/polyline edges don't need topological path matching. But budget **~2KB, not ~1KB**, and treat it as core infrastructure, not an edge case.

### C6 — Three competing styling mechanisms
- **landscape:** borrow sigma's "reducers" (pure per-frame functions computing display attributes).
- **api:** `g.style(node => ({fill, width}))` emitting **inline style attributes that always win over class-based CSS**.
- **rendering / ux:** `data-status` attributes + CSS classes + CSS custom properties for themeable, devtools-inspectable styling.

These are mutually undermining. Inline `fill` from a style function clobbers `data-status` CSS themes and fights any CSS transition. Reducers are an artifact of *immediate-mode* renderers (sigma redraws every frame in WebGL); in a retained-mode SVG tree they are pure waste — you'd recompute all node styles every frame to change nothing.

**VERDICT: one mechanism. Style resolution runs at commit time (on mutation), not per frame, and its output is written as (a) `data-*` attributes and (b) CSS custom properties on the element** — e.g. `--fg-fill`, `--fg-w`. Then:
- Default theme = a stylesheet consuming those custom properties → fully themeable with zero JS, devtools-inspectable (the ergonomic loss the API report flagged is recovered).
- User style functions set custom properties, so they compose with CSS instead of overriding it, and the "which wins" precedence problem the API report raised **dissolves** rather than needing a documented rule.
- **Cut reducers entirely.** Cut the cytoscape-style selector-string stylesheet engine (the API report was right to reject it — a selector parser is real KB for no requirement).

### C7 — Compound expand layout: "sublayout then translate" does not reflow siblings
The layout report recommends dagre's `recursiveClusterLayout` pattern: *"lay out the child subgraph independently, compute its bbox, then translate every child into the parent node's former on-screen rect."* **This only works because dagre reserves cluster area in the parent pass via nesting/border nodes.** Taken standalone as described, an expanded subgraph either overflows its parent's old rect or overlaps siblings — precisely the "expand in place" requirement failing.

**VERDICT — the correct four-step pipeline, which none of the reports states cleanly:**
1. Lay out the expanded child subgraph in isolation → child bbox.
2. Set the compound node's `w`/`h` = child bbox + padding (+ header strip for the label).
3. Run the **parent** layout with that node at its new size (this is what reflows siblings and grows the canvas).
4. Translate children into the compound's final rect.

Then FLIP the whole result: every node that existed before tweens from its old to new position, children enter from the parent's collapsed centroid. Collapse is the exact inverse. Also required and unspecified anywhere: **while expanded, boundary edges must attach to the specific child node, not the container**; while collapsed, they aggregate into meta-edges — and **meta-edge aggregation needs a dedupe rule** (N children → same external target collapses to 1 meta-edge; carry a `weight`/count so the collapsed view can badge it).

### C8 — `exportHTML()` cannot inline its own source
The API report's `FlowGraph.exportHTML(spec, storyboard)` "string-concatenates the IIFE source + spec + storyboard into one downloadable .html." **The runtime cannot emit its own source without embedding a second copy of itself in the bundle — doubling the shipped size.** The alternatives are all bad: reference a CDN URL (violates "self-contained"), or `fetch(document.currentScript.src)` (async, CORS-dependent, fails on `file://`).

**VERDICT: cut from the library.** Ship a documented copy-paste HTML template plus, optionally, a tiny `npx` CLI that concatenates at build time. The single-file requirement is satisfied by "paste the 150KB min bundle into a `<script>` tag" — a docs recipe, not a runtime feature.

### C9 — Auto-`fitView` after every topology change vs. user viewport control and FLIP
The UX report recommends animated re-fit (300–500ms) after *any* topology-changing operation. This conflicts with FLIP: if the viewport transform animates while node transforms animate, every element gets two superimposed motions and the "object constancy" the UX report is trying to protect is destroyed. It also steals the viewport from a user who has deliberately panned/zoomed, and re-zooming the entire canvas because one node expanded is disproportionate.

**VERDICT:** fit on mount and on explicit `fitView()` only. After a mutation, apply an **anchored viewport**: keep the operation's focal node stationary in screen space and let the graph move around it (translate-only correction, no zoom change) — computed on the same clock as the content tween. Auto-refit only when new content lands fully outside the viewport, and never after a manual user pan/zoom in the same session unless `fitView()` is called.

### C10 — landscape contradicts itself on plugins
It recommends borrowing `cytoscape.use()`'s extension-registration pattern "for keeping core lean," and in the same breath lists cytoscape's extension fragmentation as mistake (e) — *"bake expand/collapse, layered layout, and morph animation into our core so they can't drift out of sync."* **VERDICT: no plugin registry in v1.** One internal `layout()` seam (C1). Optional modules exist only in the ESM build; the IIFE is a monolith. A registry is an API commitment you cannot walk back, made before you have a second implementation of anything.

### C11 — Dual imperative + declarative storyboard API
The API report proposes both a fluent `g.timeline().to().label()` builder and a JSON `[{op, args, at}]` array, and flags the drift risk itself. **VERDICT: the JSON op array is the only primitive.** The fluent builder is ~20 lines of sugar that *produces* that array. One dispatch table, one test surface, one thing to serialize. This also makes seek/replay (see G2) trivially implementable.

### C12 — `condense`'s `annotate: (oldTotal, newDuration) => ...` puts pipeline semantics in core
The API report's core mutation API takes a duration-aware annotation callback, while claiming domain-agnosticism; the UX report correctly places duration chips, odometers, and delta badges in a `preset-pipeline` layer. **VERDICT: UX is right.** Core `condense(ids, newNodeSpec, {duration, easing, stagger})` emits a `condense` event with `{sources, target, sourceData[], targetData}`; the pipeline preset subscribes and renders the odometer/delta. Core knows nothing about `duration`.

### C13 — Playhead pacing
UX proposes 600–900ms per edge hop. A 12-step pipeline then takes **8–11 seconds** to play through, which is too slow for the flagship demo and for a scrubber. **VERDICT: 250–350ms/hop default, `playbackRate` exposed, and a `speed` control in the transport bar.** UX's condense choreography timings (150 / 400–600 / 300ms) are reasonable as authored; keep them but make the total ≤900ms.

---

## 2. GAPS — things a real implementation hits that no report covered

| # | Gap | Why it bites | Fix |
|---|---|---|---|
| **G1** | **Text measurement before layout.** Layout needs node w/h; SVG text width is only knowable after DOM insertion via `getComputedTextLength()`, which forces sync reflow — per node, per layout, per mutation. | This is the first wall you hit in M0 and it silently makes every animation janky if solved naively. | Offscreen `CanvasRenderingContext2D.measureText()` with a font string matched to the CSS. Zero bytes of dependency, no reflow, works before mount. Add label truncation (`…`) and an optional 2-line wrap rule. |
| **G2** | **Structural mutations are not reversible, but the API promises `seek()` / `stepBack()`.** A tween can be reversed; a `condense()` that deleted 3 nodes cannot. | The storyboard/scrubber — a headline feature — is unimplementable as specified. | **Snapshot-per-step.** Graphs are tens of nodes; store a structural clone of the spec after each storyboard op (kilobytes). `seek(k)` = restore snapshot *k*, then run the standard keyed diff → animated transition from the *current* visual state. This also delivers the GoJS/yFiles-style "reconciler auto-generates enter/update/exit" that the landscape report named its single highest-leverage idea — for free, from the same machinery. |
| **G3** | **Interruption / re-entrancy policy.** `expand()` called mid-`condense()`; user scrubs backward mid-tween; two `addNode` calls 50ms apart. | This is the #1 source of visual corruption in real graph-animation libraries, and **not one of the five reports mentions it.** | Single animation queue with **cancel-and-retarget**: on a new op, sample every element's *current interpolated* position (not its last committed layout position), use that as the new FLIP "First," cancel outstanding tweens, start one new transition. Never queue-and-play-sequentially (looks laggy) and never let two transitions write the same element. |
| **G4** | **`condense()` legality.** Merging a non-convex node set creates a cycle: if `A→B→C` and you condense `{A,C}`, the result has `M→B→M`. | Silent graph corruption → layout infinite-loops or throws deep in the ranker. | Validate that the set *S* is **convex** (no path leaves *S* and re-enters) before mutating; throw a named error. ~15 LOC DFS. Also define edge-ID synthesis and dedupe for redirected edges (two sources → same target ⇒ one edge, `weight: 2`). |
| **G5** | **Duration aggregation semantics for compound nodes.** Is a collapsed parent's duration the *sum* (sequential children) or *max* (parallel children)? | The expand/collapse and condense readouts must stay numerically consistent or the flagship "2h → 8s" claim is wrong on screen. | Spec-level `durationAgg: 'sum' | 'max' | number` per compound node, default `sum`, recomputed on expand/collapse. Pipeline preset only. |
| **G6** | **Arrowheads.** Nobody mentioned them. SVG `marker-end` does **not** inherit the path's stroke color (needs `context-stroke`, uneven support) and markers don't animate well. | Every edge needs one; per-status edge coloring multiplies marker `<defs>`. | Draw the arrowhead as a small `<path>` positioned/rotated at the clipped endpoint, sharing the edge's `--fg-stroke` custom property. Animates on the same clock, no `<defs>` combinatorics. |
| **G7** | **Edge–node clipping.** Paths must terminate at the node *border*, not the center. | Arrowheads buried under nodes; universally missed in v1s. | Ray–rounded-rect intersection on the final segment. ~20 LOC. Must run *per frame during transitions* since node sizes animate. |
| **G8** | **Multiple instances / injected `<style>` collisions.** `mount()` injecting a `<style>` per instance means N copies and cross-instance theme bleed. | Two graphs on one page is a day-one user scenario. | One deduped global sheet (guard on a `data-fg-styles` marker), all instance-specific values as custom properties on the mount root. |
| **G9** | **Reduced-motion × storyboard.** If motion is disabled, do storyboard `wait`s still elapse? | Otherwise the whole narrative fires instantly and reads as broken. | `prefers-reduced-motion` ⇒ tween durations → 0 (or 100ms crossfade), **step sequencing and waits preserved**. |
| **G10** | **Layout regression testing.** No report addresses how you know a layout change didn't wreck 40 fixtures. | Layered layout is exactly the kind of code where a "small" ordering tweak silently adds crossings. | Golden-file JSON snapshots of `{id: {x,y,w,h}}` per fixture graph + a crossing-count assertion. This is also the acceptance gate for the C1 dagre→in-house swap. |
| **G11** | **Naming / npm availability.** `FlowGraph` is used throughout the API report; the `flowgraph` / `flow-graph` / `force-graph` namespace is crowded. | Cheap now, expensive after launch. | Check npm + GitHub before writing docs. |
| **G12** | **Single-file size is measured in *min*, not *min+gzip*.** A `file://` HTML page gets no transport compression. | The "<50KB gzip" target maps to a **~150–200KB raw HTML file** for the self-contained case. | Fine, but state both numbers in the README so the target isn't accidentally misrepresented. Also: CDNs serve **brotli**, typically 10–15% below gzip — that's real, unclaimed headroom in the budget below. |

---

## 3. OVER-ENGINEERING — cut or defer

**Cut outright (do not build):**
- **Force-directed fallback layout** (layout report). Serves no stated requirement, undermines the determinism/mental-map property that the UX report identifies as the most-cited failure mode in prior art, and adds a second layout paradigm to test. "Generalized" is served by layered + user-supplied fixed positions.
- **`exportHTML()`** — see C8. Docs recipe instead.
- **Reducers / per-frame style recomputation** — see C6.
- **CSS-selector-string stylesheet engine** — the API report already rejected it; confirming.
- **Plugin registry (`FlowGraph.use()`)** — see C10.
- **Renderer abstraction layer for a future Canvas backend.** Do not build the indirection before the second implementation exists. The rendering report's own numbers say Canvas2D doesn't become necessary until *tens of thousands of edges*.
- **Small-multiples / static diff view** (UX #6). This is an application built *on* the library. Ship `exportSVG()` and a docs example.
- **Minimap.**

**Defer to M2+:**
- **Gantt / temporal layout mode + scrubber snapping** (UX). Doubles the "expand/collapse/condense must also animate correctly here" surface. Ship only if users ask.
- **`groups` / swimlanes as an orthogonal containment system** (API). A second containment model imposes rank/order *constraints* on the layout (lane membership must partition ranks) — genuinely hard, and it interacts with compound nesting. Reserve the field name in the spec; ignore it in v1.
- **`split()` (1→N).** Reserve the API; the animation is a distinct choreography and the use case is speculative.
- **`updateOnly` strict mode**, `getCollapsedChildren`-style query sugar, `collapseAll`/`expandAll`.
- **ARIA tree pattern + keyboard nav + linearized table fallback.** Cheap and correct to add, but not on the critical path to proving the design. M2, and non-negotiable before 1.0.
- **Viewport culling.** The rendering report already scoped it as v-next; agreed.
- **dagre-as-optional-adapter** — inverted by C1: dagre is the *default* early, the in-house engine is the later swap.

**Keep despite the temptation to cut:** `batch()` (needed for one relayout per multi-op mutation), `prefers-reduced-motion`, the transport-control bar (it's what makes the shareable HTML file useful to non-programmers — the whole point of the embed story).

---

## 4. MILESTONES

### M0 — Walking skeleton *(goal: a static graph renders, and one mutation animates correctly)*
1. **Graph store**: `{nodes:[{id, label, parent?, data?}], edges:[{id, source, target}]}`. Validation: duplicate ids, dangling endpoints, cycle detect → warn. No `groups`.
2. **Text measurement** via offscreen canvas `measureText` (G1) → node sizing.
3. **SVG renderer**: `<svg><g id=viewport>`; node = `<g><rect><text>`; edge = `<path>` + arrowhead `<path>` (G6), clipped to node borders (G7). Styles as custom properties + `data-*` (C6).
4. **Layout via `@dagrejs/dagre`** behind the frozen `layout()` interface (C1). *Precondition: confirm graphlib bundling.*
5. **Diff-and-animate core**: keyed diff (old spec vs new spec) → enter/update/exit; single rAF loop, one WAAPI dummy `Animation` as clock source (C3); FLIP for moves; **arc-length path resampling + lerp** for edges (C5).
6. **Mutations**: `addNode`, `addEdge`, `removeNode`, `removeEdge`, `update`, `batch()`. Events emitter.
7. **Interruption policy** implemented from day one (G3) — retrofitting this is painful.
8. Pan / zoom / `fitView()`. Anchored-viewport policy (C9).
9. One demo page; golden-file layout snapshots (G10).

**Exit criterion:** append 5 nodes one at a time to a 10-node DAG; every existing node smoothly reflows, no edge detaches, no visual glitch when appends overlap mid-animation.

### M1 — Pipeline demo end to end *(the thing that proves the library)*
1. **Compound nodes + per-node expand/collapse**, via the four-step pipeline in C7. Container transform animates `rect` width/height, **not** group scale (C4). Meta-edge aggregation with dedupe/weight while collapsed.
2. **`condense(ids, newNode)`** — convexity validation (G4), edge redirect + dedupe, three-phase choreography (highlight 150ms → converge 400–600ms → reveal 300ms), reverse-motion fallback under reduced-motion (G9).
3. **Playhead**: ordered cursor, `moveTo(id)`, traversed-edge progress fill, arrival pulse → status settle. **300ms/hop** (C13), `playbackRate` exposed.
4. **Status styling**: `status` field → custom properties + `data-status`; default 5-state palette.
5. **Storyboard**: JSON op array as the sole primitive (C11); `play/pause/next/prev/seek(label)/speed`; **seek via snapshot-restore + animated diff** (G2). Transport-control bar (`controls: true`).
6. **`preset-pipeline`** (separate ESM entry, bundled into the IIFE): duration chip, duration→node-width, manual/automated badge, `durationAgg` (G5), odometer + `−99.9%` delta badge driven by the core `condense` event (C12).
7. Deduped global stylesheet, multi-instance safe (G8).

**Exit criterion:** a single static HTML file, one `<script>` tag, plays: 6 manual steps appear → playhead advances through 3 → step 4 expands into 3 substeps → those 3 condense into 1 automated step with `2h → 8s` odometer → playhead completes. Scrub backward to any label and forward again with no corruption.

### M2 — Generalization & polish
- **In-house layered layout** replacing dagre (C1/C2), gated on golden-file parity + crossing-count non-regression. Budget 10KB, 3–5 weeks. Ship dagre as an optional ESM adapter afterward.
- `split()`, edge labels, `groups`/swimlanes.
- ARIA tree pattern (`role=treeitem`/`aria-expanded`), keyboard nav, linearized table fallback.
- `exportSVG()` / `exportPNG()`.
- Selective compositor offload for non-choreographed motion, profiled (C3).
- Viewport culling; canvas-renderer *investigation* only.
- Theming docs, TypeScript types, Gantt mode *if demanded*.

---

## 5. BUNDLE SANITY CHECK, END TO END

The three size-measuring reports each validated "no existing library fits," but **none of them added up our own library**. Doing that:

| Module | gzip est. | Notes |
|---|---:|---|
| Graph store + spec validation + keyed diff | 3.5 | |
| SVG renderer (nodes, edges, arrowheads, clipping, labels, text measure) | 6.0 | G1/G6/G7 all live here |
| Animation core (clock, tween registry, FLIP, easings, interrupt queue) | 4.5 | |
| Path resample + lerp | 2.0 | C5 — not 1KB |
| Compound expand/collapse + meta-edges | 2.5 | |
| Condense choreography + convexity check | 2.5 | |
| Playhead | 1.5 | |
| Storyboard + snapshot/seek | 2.5 | G2 |
| Pan/zoom/fit + anchored viewport | 2.0 | |
| Transport controls UI | 2.5 | |
| Theme + style resolution + injected CSS | 2.5 | |
| **Core subtotal** | **32.0** | |
| `preset-pipeline` | 3.5 | |
| **Layout — dagre (M0/M1)** | **17.1** | measured; **+~10 if graphlib is external** |
| **Layout — in-house (M2)** | **~10** | realistic, not 4–8 (C2) |

- **M1 shipping bundle (core + preset + dagre): ~52.6KB gzip** — *over* the 50KB target, and ~62KB if graphlib is external. **≈45KB brotli**, which is how a CDN actually serves it (G12).
- **M2 shipping bundle (core + preset + in-house layout): ~45.5KB gzip / ~39KB brotli.** Comfortably under.
- Raw min for the single-file case: **~150–190KB** for either configuration.

**Verdict on the size story:** the 50KB gzip target is **achievable but has zero slack**, and it is *not* achievable at M1 with dagre unless one of these is true: (a) graphlib is bundled *and* you drop the transport controls from the default IIFE (→ ~50.1KB, borderline), or (b) you accept a slightly-over-target M1 and hit the number at M2 with the in-house engine, or (c) you state the target in **brotli** (~45KB at M1), which is honest for a CDN-delivered library but is a weaker claim than the reports imply.

**Recommendation:** publicly commit to **"core under 35KB gzip, full pipeline preset under 50KB gzip"** and hold the line by keeping export, ARIA fallback, minimap, Gantt mode, and the dagre adapter as **ESM-only optional entries** — the IIFE contains exactly what the pipeline demo needs. Set a **CI size budget with a hard fail** at M0, before there's anything to cut; every one of the five reports independently identified size discipline as the top execution risk, and none of them proposed a mechanism to enforce it.

**Two claims to re-verify before publishing anything:**
1. Whether `@dagrejs/dagre`'s dist bundles graphlib (decision-relevant for C1 and the budget above).
2. WAAPI/CSS animatability of SVG2 geometry properties (`width`/`height`/`x`/`y`/`r`) across Chrome/Firefox/Safari — the rendering report's blanket "WAAPI cannot animate SVG attributes" is too strong (C4), and the answer determines whether compound-node growth is a compositor animation or a per-frame rAF write.
