// D2 — the frozen layout seam. M0–M2 delegate to @dagrejs/dagre; M3 swaps in the
// in-house layered engine behind this exact signature:
//
//   layout(view, opts) -> {
//     nodes:  { [id]: {x, y, w, h} }          // x,y = center
//     edges:  { [id]: { points, reversed? } } // points always run source -> target (true direction)
//     bounds: { x, y, w, h }
//   }
//
// Cycle handling (D3) lives HERE, not in dagre: we break cycles ourselves (with
// pinning via opts.pinnedReversals) so the caller knows exactly which edges are
// loop-backs, then feed dagre an acyclic graph. Back edges and self-loops get
// deterministic consistent-side arc routing — by construction they can never
// flip sides across re-layouts.

import * as dagre from "@dagrejs/dagre";
import { breakCycles } from "./cycles.js";
import { sampleCubic } from "./path.js";

const DEFAULTS = { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };

export function layout(view, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const nodes = view.nodes || [];
  const edges = view.edges || [];

  const selfLoops = edges.filter((e) => e.source === e.target);
  const realEdges = edges.filter((e) => e.source !== e.target);
  const reversed = breakCycles(nodes, realEdges, o.pinnedReversals);

  const hasParents = nodes.some((n) => n.parent !== undefined);
  const g = new dagre.graphlib.Graph({ compound: hasParents, multigraph: true });
  g.setGraph({
    rankdir: o.dir,
    nodesep: o.nodesep,
    ranksep: o.ranksep,
    marginx: o.marginx,
    marginy: o.marginy,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h });
  if (hasParents) {
    for (const n of nodes) if (n.parent !== undefined) g.setParent(n.id, n.parent);
  }
  for (const e of realEdges) {
    // Back edges are excluded from dagre entirely: we route them ourselves as
    // consistent-side arcs, and feeding them (even flipped) would let dagre pull
    // ranks around as the graph grows, jiggling the loop's shape.
    if (reversed.has(e.id)) continue;
    g.setEdge(e.source, e.target, {}, e.id);
  }

  dagre.layout(g);

  const outNodes = {};
  for (const n of nodes) {
    const d = g.node(n.id);
    outNodes[n.id] = { x: d.x, y: d.y, w: d.width, h: d.height };
  }

  const outEdges = {};
  for (const e of realEdges) {
    if (reversed.has(e.id)) continue;
    const d = g.edge(e.source, e.target, e.id);
    outEdges[e.id] = { points: (d.points || []).map((p) => ({ x: p.x, y: p.y })) };
  }
  for (const e of realEdges) {
    if (!reversed.has(e.id)) continue;
    outEdges[e.id] = {
      points: backEdgeArc(outNodes[e.source], outNodes[e.target], outNodes, o.dir),
      reversed: true,
    };
  }
  for (const e of selfLoops) {
    outEdges[e.id] = { points: selfLoopArc(outNodes[e.source], o.dir), reversed: true };
  }

  const bounds = computeBounds(outNodes, outEdges);
  return { nodes: outNodes, edges: outEdges, bounds, reversedEdgeIds: reversed };
}

/**
 * Multi-node back edge: an arc on ONE consistent side of the flow (below for
 * LR/RL, right for TB/BT) — VEIL finding: consistent-side grouping keeps nested
 * loops legible. Runs source -> target in TRUE direction (backwards vs. flow).
 */
function backEdgeArc(src, tgt, allNodes, dir) {
  const horizontal = dir === "LR" || dir === "RL";
  if (horizontal) {
    const lo = Math.min(src.x, tgt.x), hi = Math.max(src.x, tgt.x);
    let clear = -Infinity;
    for (const n of Object.values(allNodes)) {
      if (n.x + n.w / 2 < lo - 1 || n.x - n.w / 2 > hi + 1) continue;
      clear = Math.max(clear, n.y + n.h / 2);
    }
    const dip = clear + 36;
    const p0 = { x: src.x, y: src.y + src.h / 2 };
    const p3 = { x: tgt.x, y: tgt.y + tgt.h / 2 };
    return sampleCubic(p0, { x: src.x, y: dip }, { x: tgt.x, y: dip }, p3, 32);
  }
  const lo = Math.min(src.y, tgt.y), hi = Math.max(src.y, tgt.y);
  let clear = -Infinity;
  for (const n of Object.values(allNodes)) {
    if (n.y + n.h / 2 < lo - 1 || n.y - n.h / 2 > hi + 1) continue;
    clear = Math.max(clear, n.x + n.w / 2);
  }
  const out = clear + 36;
  const p0 = { x: src.x + src.w / 2, y: src.y };
  const p3 = { x: tgt.x + tgt.w / 2, y: tgt.y };
  return sampleCubic(p0, { x: out, y: src.y }, { x: out, y: tgt.y }, p3, 32);
}

/** Self-loop: side-arcing spline bowing out of the node (never through it). */
function selfLoopArc(n, dir) {
  const horizontal = dir === "LR" || dir === "RL";
  if (horizontal) {
    const b = n.y + n.h / 2, drop = 30;
    return sampleCubic(
      { x: n.x + n.w * 0.22, y: b },
      { x: n.x + n.w * 0.55, y: b + drop },
      { x: n.x - n.w * 0.55, y: b + drop },
      { x: n.x - n.w * 0.22, y: b },
      24
    );
  }
  const r = n.x + n.w / 2, out = 30;
  return sampleCubic(
    { x: r, y: n.y + n.h * 0.22 },
    { x: r + out, y: n.y + n.h * 0.55 },
    { x: r + out, y: n.y - n.h * 0.55 },
    { x: r, y: n.y - n.h * 0.22 },
    24
  );
}

function computeBounds(nodes, edges) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of Object.values(nodes)) {
    x0 = Math.min(x0, n.x - n.w / 2); y0 = Math.min(y0, n.y - n.h / 2);
    x1 = Math.max(x1, n.x + n.w / 2); y1 = Math.max(y1, n.y + n.h / 2);
  }
  for (const e of Object.values(edges)) {
    for (const p of e.points) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 0; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
