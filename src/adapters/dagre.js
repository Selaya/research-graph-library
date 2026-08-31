// Optional ESM adapter: the M0–M2 layout engine, kept alive behind the M3 solver seam.
//
//   import { dagreLayout } from "sparkle-motion-visualizer/adapters/dagre";
//   const result = dagreLayout(view, { dir: "LR" });
//   // or, through mount():  mount(el, spec, { layout: { solver: dagreSolver } })
//
// `@dagrejs/dagre` is an OPTIONAL peer dependency: nothing on the default path imports
// this file, so neither the IIFE nor the default ESM bundle pulls dagre in (that is what
// the M3 size budget buys). Installing it is the caller's job.
//
// The dagre invocation below is the M2-era `layout.js` body verbatim — compound graph
// when there are parents, multigraph so multi-edges keep their ids, rankdir/sep/margin
// mapping — so switching solvers reproduces the old drawings exactly.

import * as dagre from "@dagrejs/dagre";
import { layout } from "../layout.js";

/**
 * The solver contract (INTERNALS §M3), implemented on dagre.
 *
 * @param {{nodes: Array<{id:string,w?:number,h?:number,parent?:string}>,
 *          edges: Array<{id:string,source:string,target:string}>}} input
 *        acyclic, and no edge incident to a node that has children (the shell guarantees both)
 * @param {{dir?:string, nodesep?:number, ranksep?:number, marginx?:number, marginy?:number}} opts
 * @returns {{nodes: Object, edges: Object, order: string[][]}}
 */
export function dagreSolver(input = {}, opts = {}) {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const hasParents = nodes.some((n) => n && n.parent !== undefined);

  const g = new dagre.graphlib.Graph({ compound: hasParents, multigraph: true });
  g.setGraph({
    rankdir: opts.dir || "LR",
    nodesep: opts.nodesep,
    ranksep: opts.ranksep,
    marginx: opts.marginx,
    marginy: opts.marginy,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h });
  if (hasParents) for (const n of nodes) if (n.parent !== undefined) g.setParent(n.id, n.parent);
  for (const e of edges) g.setEdge(e.source, e.target, {}, e.id);

  dagre.layout(g);

  const outNodes = {};
  for (const n of nodes) {
    const d = g.node(n.id);
    if (d) outNodes[n.id] = { x: d.x, y: d.y, w: d.width, h: d.height };
  }
  const outEdges = {};
  for (const e of edges) {
    const d = g.edge(e.source, e.target, e.id);
    if (d && d.points) outEdges[e.id] = { points: d.points.map((p) => ({ x: p.x, y: p.y })) };
  }

  return { nodes: outNodes, edges: outEdges, order: orderOf(g, nodes) };
}

/** Per-rank id sequences of the REAL (non-container) nodes, from dagre's own rank/order
 *  bookkeeping — dagre doubles ranks to make room for edge labels, so the rank keys are
 *  compacted to consecutive indices, matching engine.js's `order` shape. */
function orderOf(g, nodes) {
  const containers = new Set();
  for (const n of nodes) if (n && n.parent !== undefined) containers.add(n.parent);
  const byRank = new Map();
  for (const n of nodes) {
    if (containers.has(n.id)) continue;
    const d = g.node(n.id);
    if (!d || typeof d.rank !== "number") continue;
    const list = byRank.get(d.rank) || [];
    list.push({ id: n.id, order: typeof d.order === "number" ? d.order : 0 });
    byRank.set(d.rank, list);
  }
  return [...byRank.keys()]
    .sort((a, b) => a - b)
    .map((r) => byRank.get(r).sort((a, b) => a.order - b.order).map((x) => x.id));
}

/** `layout()` with dagre in the solver slot — same result shape, same shell behaviour
 *  (cycle breaking + pinning, back-edge/self-loop arcs, container padding, bounds). */
export function dagreLayout(view, opts = {}) {
  return layout(view, { ...opts, solver: dagreSolver });
}

export default { dagreSolver, dagreLayout };
