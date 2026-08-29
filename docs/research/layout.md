# Research: Layout algorithms

> One of 7 parallel research passes behind docs/PLAN.md · 2026-08-29

## Summary

Layered/Sugiyama layout is the right default; dagre (via @dagrejs/dagre) is small enough to embed (17.1KB gzip / 48.9KB min, measured directly), MIT, and as of its very recent v3.0/3.1 releases (Aug 2026, weeks old) has genuinely gained native incremental-stability hooks (`useDynamic`) and native per-cluster recursive nested layout — both of which map almost exactly onto our stability and compound-layout requirements. ELK (elkjs) is categorically disqualified: its GWT-compiled worker is 464.6KB gzip (measured), ~27x our entire size budget, and it's EPL-2.0/GPL-3.0 dual-licensed rather than MIT. cytoscape.js core alone is 136.8KB gzip (measured) — its expand-collapse extension's *design* (meta-edges, relayout-with-randomize:false, animate/fisheye options) is worth copying conceptually but the library itself is unusable at our budget. No layout library (dagre, ELK, cytoscape, d3-dag) computes animation frames — FLIP-style position tweening, expand/collapse orchestration, and node-merge/morph choreography are 100% bespoke work regardless of which (if any) layout engine is chosen. A from-scratch minimal layered engine tailored to acyclic pipeline DAGs (skip network-simplex ranking and full Brandes-Köpf, keep median/barycenter ordering + compound border nodes) is realistically ~1000-1500 LOC and, extrapolated from dagre's own measured code-to-bytes ratio, should land around 4-8KB min+gzip — leaving the bulk of a 50KB budget for rendering/animation.

## Recommendation

Build a small, purpose-built layered-layout core from scratch rather than depending on dagre or ELK, but explicitly reuse the *algorithmic recipe* validated by dagre/Brandes-Köpf/Sugiyama and the *interaction recipe* validated by cytoscape-expand-collapse. Concretely:

1. **Core layered algorithm (own code, ~1000-1500 LOC est., ~4-8KB min+gzip est.):**
   - Rank assignment: longest-path from sources + a cheap "tightening" pass (pull nodes down toward the median rank of neighbors when it doesn't violate edge direction) instead of full network-simplex (dagre's network-simplex.ts is 255 LOC and its main value — minimizing total edge length exactly — matters less for pipeline DAGs than speed/simplicity/predictability). Dagre itself exposes `ranker: 'longest-path'` as a cheaper built-in alternative to its default, confirming this is a recognized, acceptable simplification.
   - Ordering: DFS-based initial order + median/barycenter heuristic with 4-8 alternating up/down sweeps and a transpose step to fix adjacent-swap crossings (mirrors dagre's `order/` module: init-order.ts 45 LOC, barycenter.ts 31 LOC, sort.ts 104 LOC, cross-count.ts 70 LOC ≈ 250-350 LOC combined once trimmed of dagre's full constraint-graph generality).
   - Coordinate assignment: skip full Brandes-Köpf (dagre's bk.ts is 564 LOC, the single largest and most bug-prone module, and even the original 2001 paper had two flaws only found and published as an erratum in 2020 — arXiv:2008.01252). Use a simpler median-of-neighbors averaging heuristic with 2-4 passes plus a linear overlap-resolution sweep (~150-250 LOC). Slightly less optimal edge straightness, much lower implementation/maintenance risk.
   - Compound nodes: bake in "virtual border node" containment (dagre's nesting-graph.ts 139 + add-border-segments.ts 47 + parent-dummy-chains.ts 106 ≈ 292 LOC combined) from day one rather than bolting it on, since compound layout is core to this library's primary use case, not an edge case.
   - Cycle handling: pipelines are DAGs by construction; ship a cheap DFS cycle detector that throws/warns rather than dagre's full greedy feedback-arc-set (greedy-fas.ts 150 + acyclic.ts 112 = 262 LOC) — saves ~250 LOC by not solving a problem the primary use case doesn't have. (Keep it pluggable so a future general-graph mode can add FAS back.)

2. **Stability on append — steal dagre v3.1's exact mechanism, don't reinvent:** dagre's `@dagrejs/dagre` 3.1.0 (published 2026, per npm registry) shipped "Dynamic Graph Layout Support" (PR #512, per its own changelog) that keeps a `WeakMap<graph, {rawNodes}>` of the previous layout run and threads those old per-node rank/order values into the next `order()` call as a tie-breaker (`compareByOldOrder` in util.ts, consumed by init-order.ts's DFS-successor sort and sort.ts). This is a proven, working, MIT-licensed reference implementation of exactly requirement (b) — replicate the same shape: on every layout() call, diff against the previous node-id set, and when the median/barycenter ordering heuristic has a tie among nodes that existed before, break it by their previous order index rather than arbitrarily. New nodes appended at the end get inserted into the order pass with no old-order preference, so they naturally settle after their neighbors without perturbing existing relative order. Important caveat found in dagre's source: this only stabilizes *ordering* (which rank-slot a node occupies), not absolute (x,y) — coordinate assignment (Brandes-Köpf-style) is a global pass recomputed every call, so pixel positions of unrelated existing nodes can still drift on append (e.g., re-centering). That means FLIP-style tweening (item 4) is mandatory in all cases, not an optional nicety layered on top of a "stable" layout.

3. **Compound expand/collapse — copy cytoscape-expand-collapse's interaction model, not its code:** cytoscape.js-expand-collapse (iVis-at-Bilkent, MIT, based on Dogrusoz et al., PLoS ONE 2018) collapses a compound node by hiding its children and redirecting boundary edges into synthetic "meta-edges" (CSS class `cy-expand-collapse-meta-edge`, tagged unidirectional/bidirectional), then re-runs a caller-supplied layout (`layoutBy`, typically cose-bilkent with `randomize:false` to preserve the mental map) and animates via `animate`/`animationDuration` (default 1000ms) plus an optional `fisheye` viewport step. Reuse: (a) the meta-edge concept for cross-boundary edges while collapsed, (b) `randomize:false`-equivalent behavior (never let the layout re-seed randomly — a non-issue for a deterministic Sugiyama layout anyway), (c) the animate+duration API shape. For the "expand in place" requirement specifically, mirror dagre v3.1's own new `recursiveClusterLayout` pattern (found live in its layout.ts): lay out the child subgraph independently/locally (own rank/order/coordinate pass scoped to just that subtree), compute its bounding box, then translate/offset every child position into the parent node's former on-screen rect. Collapse is the literal inverse: snapshot children's positions, animate them converging into the parent's centroid while shrinking/fading, then swap in the compact compound node.

4. **Animated interpolation — implement FLIP directly, no dependency needed:** on any graph mutation (append, expand, collapse, merge), snapshot each visible node's current (x,y,w,h) before recomputing layout ("First"), run the layout synchronously to get target positions ("Last"), then for each node whose id existed in both snapshots set a CSS/canvas transform delta and animate it to identity over a chosen duration/easing ("Invert"+"Play"); nodes present only in the target snapshot ("new") tween in from a natural anchor point (their layout parent's or nearest predecessor's old position, or the compound container's centroid), nodes present only in the source snapshot ("removed") tween out toward the same kind of anchor before removal. This is ~150-300 LOC of glue and works identically whether positions come from the layered engine or the force-directed fallback.

5. **Node merge/condense morph — bespoke staged transition, following Heer & Robertson's "Animated Transitions in Statistical Data Graphics" (2007) staged-transition pattern and cytoscape's meta-edge concept:** (a) compute the merged node's target position (e.g. centroid or new-layout position after removing the N sources and inserting the 1 target into the graph model), (b) Stage 1: animate the N source nodes translating/scaling toward that point while fading, and simultaneously fade/scale in the merged node there; (c) Stage 2: redirect/collapse their incident edges into meta-edges pointing at the merged node; (d) Stage 3: re-run the layered layout on the now-smaller graph and FLIP-tween every other node/edge that shifted as a result of the compaction; (e) encode the "speed improvement" explicitly in the visual (e.g. a duration-proportional bar/width or a small "2h → 5min" badge animating on the merged node) since geometric compaction alone under-communicates a semantic time savings.

6. **Force-directed fallback:** don't depend on `d3-force` at API-shape level necessarily, but note it is extremely cheap — measured 8.3KB min / 3.0KB gzip standalone, including many-body (quadtree Barnes-Hut), link, center and collision forces. Either vendor a trimmed subset of d3-force or write an equivalent from scratch (a basic O(n²) repulsion + spring-link + centering force sim for the small graphs typical of pipeline visualizations is well under 100 LOC). Either choice fits the budget trivially; this is a minor, low-risk piece of the overall design compared to the layered engine.

Net sizing picture (all measured directly except the from-scratch estimate): dagre 17.1KB gzip / ELK 464.6KB gzip / cytoscape core 136.8KB gzip / d3-dag 45.9KB gzip / d3-force 3.0KB gzip / own minimal layered engine ≈ 4-8KB gzip (estimated). Recommended own-engine path leaves ~40KB+ of the 50KB budget for rendering, the declarative spec parser, mutation API, and all animation/orchestration code.

## Details


## Bundle sizes (measured directly via `npm install` + `gzip -c | wc -c`, not estimated)

| Package | Version (as of 2026-08-29) | min size | min+gzip | License | Last publish |
|---|---|---|---|---|---|
| `@dagrejs/dagre` (dagre.min.js) | 3.1.1 | 48,956 B | **17,119 B** | MIT | 2026-08-08 |
| `elkjs` (elk-worker.min.js, GWT-compiled) | 0.12.0 | 1,595,334 B | **464,625 B** | EPL-2.0 OR GPL-3.0-or-later | 2026-07-17 |
| `elkjs` (elk.bundled.js, unminified UMD) | 0.12.0 | 1,609,707 B | 469,661 B | same | same |
| `cytoscape` core (cytoscape.min.js) | latest | 435,503 B | **136,809 B** | MIT | — |
| `d3-dag` (whole package, iife.min) | 1.2.2 | 143,370 B | **45,920 B** | MIT/ISC (mixed, d3-family) | — |
| `d3-force` (standalone, min) | latest | 8,300 B | **3,009 B** | ISC | — |

The old `dagre` npm package (0.8.5, unscoped) is stale — search results confirm "only the one in the DagreJs org is receiving updates right now" — so all analysis here is against `@dagrejs/dagre`, which is under very active 2026 development (3.0.0 → 3.1.0 → 3.1.1 released Mar 22, Aug 2, and Aug 8 2026 respectively, per npm registry timestamps).

**ELK is disqualified on both axes that matter most**: it's a GWT (Java→JS) cross-compile, not native JS, which explains the ~27x size penalty versus dagre for conceptually similar layered-layout math, and its dual EPL-2.0/GPL-3.0 license is a meaningfully worse fit for an embeddable single-script library than dagre's MIT. Even elkjs's non-worker API wrapper alone (`main.js`) is small (5,069 B / gzip 1,865 B measured), but it's useless without the worker payload that does the actual layout.

**cytoscape.js core is disqualified purely on size** (136.8KB gzip is ~2.7x the entire 50KB target by itself), which also disqualifies depending on `cytoscape.js-expand-collapse` directly, since it requires cytoscape core as a peer dependency.

**d3-dag** (sugiyama + zherebko + grid layouts bundled) at 45.9KB gzip would consume ~92% of the entire size budget for layout alone, leaving nothing for rendering/animation — not viable as a whole-package dependency, though its source (TypeScript, MIT/ISC) could be mined for algorithm reference the same way dagre's is here.

## dagre's real source-code shape (cloned github.com/dagrejs/dagre, tag matching 3.1.1)

Core `lib/` TypeScript, excluding tests and the `@dagrejs/graphlib` dependency (4064 total LOC):

```
772  layout.ts                (pipeline orchestration, self-loops, multi-edges, compound clusters)
564  position/bk.ts           (Brandes-Köpf coordinate assignment)
387  util.ts
255  rank/network-simplex.ts  (optimal rank assignment)
171  types.ts
150  greedy-fas.ts            (cycle-breaking heuristic)
141  order/resolve-conflicts.ts
139  nesting-graph.ts         (compound/cluster rank containment)
138  order/sort-subgraph.ts
119  order/index.ts
116  rank/feasible-tree.ts
112  acyclic.ts
106  parent-dummy-chains.ts
104  order/sort.ts
 92  coordinate-system.ts / normalize.ts (each)
 90  order/build-layer-graph.ts
 70  order/cross-count.ts
 69  data/list.ts
 64  rank/util.ts
 61  rank/index.ts
 51  order/add-subgraph-constraints.ts
 47  add-border-segments.ts
 45  order/init-order.ts
 42  position/index.ts
 31  order/barycenter.ts
```
This 4064-LOC (TypeScript, post type-erasure) core compiles to 48,956 B minified / 17,119 B gzipped — roughly **12.0 bytes-min and 4.2 bytes-gzip per source line**, which is the density figure used to extrapolate the from-scratch estimate below.

## Genuinely new finding: dagre 3.1.x already ships native incremental-stability and native nested-cluster layout (both dated 2026, i.e. current)

From `changelog.md` (top of file, "## [3.1.0] - 2026"):
> **Dynamic Graph Layout Support (PR #512):** Added support for dynamic graph layouts via `useDynamic` and `corePath` configuration options in `LayoutConfig`. Enables persistent node ordering and layout stability when modifying graph structures.
> **Per-Cluster Direction Support (PR #511):** Each cluster/subgraph can now specify its own `rankdir`, `ranksep`, `nodesep`, and `align` settings. The layout engine recursively applies these settings, enabling complex nested cluster hierarchies with independent flow directions.

Mechanism traced directly in source (`lib/layout.ts`):
- `const previousLayouts = new WeakMap<Graph, PreviousLayout>()` keyed by the graph *object itself* — call `dagre.layout(g, opts)` again on the same mutated graph instance and it looks up `previousLayouts.get(g)`.
- `runLayout(g, time, opts, previous)`: `const dynamic = opts?.useDynamic !== false` (on by default); `rawOldNodes = dynamic ? previous?.rawNodes ?? null : null`; this is threaded into `order(g, opts, rawOldNodes)`.
- `order/index.ts` passes `oldNodes` into `initOrder(graph, oldNodes)` (DFS successor ordering) and into `sortSubgraph`/`sort` for tie-breaking during the median/barycenter sweeps.
- `util.ts`'s `compareByOldOrder(oldNodes, nodeA, nodeB)` is the actual tie-break: when two candidate orderings are equally good by barycenter score, prefer whichever matches the previous run's relative order.
- Separately, `corePath` (an array of node ids marking an important path) biases Brandes-Köpf's `verticalAlignment` (`bk.ts`, `isInCorePath`) to keep that path visually straight — useful for keeping a pipeline's "main line" visually stable/prioritized, but it's a caller-supplied hint, not automatic pinning.
- **Caveat (load-bearing for the design)**: this stabilizes *rank/order* (which slot in a layer a node occupies), not literal (x,y). Coordinate assignment is recomputed globally every call, so even with perfect order stability, absolute pixel positions of untouched nodes can still shift on append (e.g. everything re-centers when the graph's bounding box changes). **FLIP-style position tweening is therefore required in all cases**, layout-stability techniques only reduce how large/jarring the deltas are, they don't eliminate the need to animate them.
- `recursiveClusterLayout` (also in `layout.ts`): finds nodes with children (`g.nodes().filter(v => g.children(v).length)`); for any such cluster with a `rankdir` set, builds an independent sub-`Graph`, lays it out standalone, computes its bounding box, then offsets every child's `(x,y)` by `(parentX + dx, parentY + dy)` where `dx,dy` are relative to the subgraph's own center — i.e., **lay out the subtree independently, then translate it into the parent's slot**. This is precisely the "expanded node becomes a container laid out inside/in-place" mechanism requested, already validated as a working pattern in a real, current, MIT-licensed codebase.

These are very recent (weeks old relative to 2026-08-29) additions to an actively-maintained project, which is a double-edged signal: it's a validated, working reference design to copy, but also new enough that it hasn't accumulated multi-year battle-testing the way dagre's core rank/order/BK code has (5.8k GitHub stars, 172 open issues even on the mature parts).

## cytoscape.js-expand-collapse — interaction model (from README, iVis-at-Bilkent, MIT, built on Dogrusoz et al. PLoS ONE 2018 "Efficient methods and readily customizable libraries for managing complexity of large networks")
- `cy.expandCollapse(options)` / `cy.expandCollapse('get')` API shape.
- On collapse: children hidden, boundary edges become synthetic **meta-edges** (`cy-expand-collapse-meta-edge` class), tagged `directionType: 'unidirection'|'bidirection'`; collapsed-away originals get `cy-expand-collapse-collapsed-edge`.
- `layoutBy` option: "just layout options or whole layout function," run after every expand/collapse — docs recommend `cose-bilkent` with `randomize:false` specifically to preserve the mental map (i.e., never let position recomputation restart from a random seed — directly analogous to our need for a deterministic, order-stable layout).
- `animate` (bool or function), `animationDuration` (default 1000ms), and an optional `fisheye` (bool/function) viewport focus-and-context step after the operation completes.
- Net takeaway: the extension's value is almost entirely in its *event/state orchestration and meta-edge bookkeeping*, not in novel layout math — it delegates the actual relayout to whatever general-purpose layout algorithm is configured. This validates the plan to build our own orchestration layer around our own layered engine rather than needing a "compound layout algorithm" as a separate dependency.

## From-scratch minimal layered-layout LOC estimate (grounded in dagre's own module boundaries, above)

Target: acyclic pipeline DAGs with compound (nested) nodes, sacrificing dagre's generalized network-simplex ranking, full Brandes-Köpf coordinate assignment, and general feedback-arc-set cycle breaking (none of which are needed for the primary use case) in exchange for simplicity/size/risk:

| Component | Dagre's LOC (reference) | Minimal-version estimate | Simplification |
|---|---|---|---|
| Graph data structure | (external: graphlib) | 100-150 | plain adjacency maps, no separate dependency |
| Cycle handling | 262 (greedy-fas + acyclic) | 20-40 | detect-and-warn only; pipelines assumed acyclic |
| Rank assignment | 255+116+64+61 = 496 (network-simplex path) | 80-120 | longest-path + median-tightening pass only |
| Normalize (dummy nodes for multi-rank edges) | 92 | 60-90 | same idea, less generality |
| Compound/nesting containment | 139+106+47 = 292 | 200-280 | keep close to full — this is core to our use case |
| Ordering (median/barycenter, sweeps, old-order tie-break) | ~250-390 (init-order+barycenter+sort+cross-count+sort-subgraph, trimmed of dagre's generalized constraint graph) | 250-350 | add old-order stability tie-break per dagre v3.1's proven pattern |
| Coordinate assignment | 564 (Brandes-Köpf) | 150-250 | median-of-neighbors heuristic + overlap resolution, 2-4 passes, no formal 4-alignment averaging |
| Orchestration/glue | 772 (dagre's layout.ts, includes far more generality than needed) | 100-150 | |
| **Total** | ~4064 (full dagre core) | **~960-1430 LOC** | |

Applying dagre's own measured density (≈12.0 B/line minified, ≈4.2 B/line gzipped) to this range gives a rough estimate of **11.5-17.2KB minified, 4.0-6.0KB gzipped** for the algorithmic core alone — though a hand-written minimal implementation without dagre's TypeScript-generality overhead (generic type params, multigraph support, self-loop/label edge cases, per-cluster-direction generality) would plausibly compress somewhat better than that ratio suggests, since a large fraction of dagre's LOC is defensive/general-purpose branching not needed here. A working estimate of **4-8KB gzip** for the core layered+compound engine is reasonable and well within budget alongside rendering/animation code.

**Risk grounding for "how hard is this really"**: Brandes-Köpf ("Fast and Simple Horizontal Coordinate Assignment," Brandes & Köpf, GD'01/LNCS 2265, 2002) is the standard reference algorithm for the coordinate-assignment phase, is linear-time, and is "easy to implement" per its own abstract — yet an erratum (Brandes, Walter, Zink, arXiv:2008.01252, 2020) documented two real flaws in the original algorithm, one first published 18 years after the original paper. This is concrete evidence that even the "simple" published version of the hardest phase (coordinate assignment) has non-obvious correctness pitfalls, supporting the recommendation to use a deliberately simpler (if less edge-straight) heuristic for coordinate assignment rather than attempting a full from-scratch Brandes-Köpf implementation.

## Animation/morph technique grounding
- **FLIP** (First-Last-Invert-Play): standard web-animation technique for animating layout changes cheaply via CSS/canvas transforms; not layout-library-specific, applies identically on top of any position source (layered engine or force fallback). No dedicated citation needed beyond noting it's the mechanical pattern to implement (snapshot before, compute after, invert via transform, animate to identity).
- **Object constancy / mental-map preservation**: established HCI concept — "successive display of two display features that are close in time and space appear to be the same display feature" — the guiding principle behind both dagre's old-order tie-breaking and cytoscape-expand-collapse's `randomize:false` recommendation. "Staging" (splitting a transition into ordered phases — e.g., fade out, then collapse space, then reflow) is called out specifically as a technique for maintaining object constancy across representation changes, directly applicable to the merge/condense animation.
- **Staged transitions for merge/aggregation**: general pattern (Heer & Robertson, "Animated Transitions in Statistical Data Graphics," InfoVis 2007, well-established in the visualization literature) — split a compound transition into sequential stages (e.g., fade+converge, then re-route edges, then reflow remainder) rather than one simultaneous tween, specifically to keep the change legible. NodeTrix (arXiv:0705.0599) is cited in visualization literature as an example system that "continuously animate[s] the aggregation of nodes into" a merged representation, validating that node-merge animation is a known, previously-solved problem class, not something novel to design from zero.

## Scratch environment used
All package installs/measurements performed in `/tmp/claude-0/.../scratchpad/sizecheck` via `npm install` + direct `gzip -c file | wc -c` (not third-party bundle-size services, which were blocked by egress proxy: bundlephobia.com, pkg-size.dev, bundlejs.com all returned `EGRESS_BLOCKED`). dagre source cloned via `git clone https://github.com/dagrejs/dagre.git` for LOC counts.


## Risks & caveats


- **Coordinate-assignment correctness risk**: the coordinate-assignment phase (whether full Brandes-Köpf or a simplified heuristic) is the most bug-prone part of any layered-layout implementation — even the canonical published Brandes-Köpf algorithm had two real flaws surface only in a 2020 erratum, 18 years after its 2002 publication. Choosing a simpler heuristic (as recommended) reduces implementation surface area but may produce visibly less-straight edges / more crossing dummy-chains than dagre's full BK; this is a legitimate aesthetic trade for lower risk and smaller code, but should be validated against real pipeline-shaped test graphs (wide fan-out/fan-in, deep chains, many compound nodes) before committing.
- **Order-stability ≠ position-stability**: dagre v3.1's `useDynamic` mechanism (and any equivalent we build) only stabilizes relative ordering within ranks, not absolute (x,y) coordinates — coordinate assignment is a global recomputation every call. This means FLIP-style tweening cannot be treated as a secondary nice-to-have; it is load-bearing for requirement (b) regardless of how good the ordering-stability logic is. Underestimating this could lead to a design where "stability" is assumed to be solved by the layout layer alone.
- **Freshness of the dagre reference design**: the specific features being used as a design template (`useDynamic`, `corePath`, per-cluster recursive layout) shipped in @dagrejs/dagre 3.1.0/3.1.1 within the last few weeks of "today" (2026-08-29) — real, working, and MIT-licensed, but not yet battle-tested over years the way dagre's core algorithm is (which itself still carries 172 open issues on a 5.8k-star repo). Treat this as a validated *design pattern* to reimplement, not as a dependency whose own edge cases (e.g., interaction between `useDynamic` and compound clusters, or between per-cluster `rankdir` and dynamic stability) have long-run community exposure.
- **From-scratch LOC/size estimate is an extrapolation, not a build-and-measure result**: the 4-8KB gzip core-engine estimate is derived by proportionally scaling down dagre's real, measured LOC-to-bytes ratio for a proposed reduced feature set; it was not validated by actually writing and minifying the code. Actual results could run higher if compound-layout edge cases (deeply nested containers, cross-boundary edges during partial expand states) require more defensive code than estimated, or lower if the simplified coordinate assignment turns out simpler than dagre's BK-based module suggests.
- **General-graph fitness of the simplified approach**: dropping full feedback-arc-set cycle-breaking and network-simplex ranking is justified for the stated primary use case (acyclic pipelines) but weakens the "generalized... should fit many graph use cases" requirement — if the library needs to gracefully lay out arbitrary (possibly cyclic) graphs as a first-class case rather than an edge case, the cut corners (cycle handling especially) would need to be added back, eroding some of the size/complexity savings. Recommend keeping the cycle-breaking and ranking strategies pluggable so a "general DAG/graph mode" can opt into more sophisticated (heavier) algorithms without destabilizing the pipeline-optimized default path.
- **ELK exclusion is size/license-driven, not capability-driven**: ELK's layered algorithm is more feature-complete than dagre or a minimal custom engine (native port-aware routing, more edge-routing styles, more layout algorithm families in one system) — if a future requirement needs those specific ELK capabilities (e.g. precise port constraints), this recommendation would need revisiting; for the stated <50KB single-file embeddable constraint, though, ELK is not a close call (464.6KB gzip measured vs. a ~50KB total budget).
- **Third-party bundle-size verification tools were unreachable** (bundlephobia.com, pkg-size.dev, bundlejs.com all blocked by the sandbox's egress proxy), so all size figures here come from directly installing packages and gzip-measuring the actual shipped `dist` files in this sandbox rather than cross-checking against a second independent source — the numbers should be internally consistent and are the same artifacts developers would actually ship, but a final pre-launch check against bundlephobia/pkg-size from an unrestricted environment is cheap insurance.

