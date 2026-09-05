// D2 — the frozen layout seam. M0–M2 delegated to @dagrejs/dagre; M3 swaps in the
// in-house layered engine (src/engine.js) behind this exact signature:
//
//   layout(view, opts) -> {
//     nodes:  { [id]: {x, y, w, h} }          // x,y = center
//     edges:  { [id]: { points, reversed? } } // points always run source -> target (true direction)
//     bounds: { x, y, w, h }
//     reversedEdgeIds: Set<string>            // persist -> opts.pinnedReversals (D3)
//     order:  string[][]                      // persist -> opts.prevOrder (order stability)
//     layers: string[][]                      // persist -> opts.prevLayers (bend stability)
//     slots?: { [id]: number }                // componentOrder only — the slot each id landed in
//   }
//
// This file is the SHELL around a pluggable solver: `opts.solver` (default `engineSolve`)
// is handed an acyclic, cluster-edge-free graph and returns node rects, edge bend chains
// and the per-rank order. `src/adapters/dagre.js` supplies the same contract on top of
// @dagrejs/dagre for anyone who wants the old engine back — the default path (and every
// bundle) imports no dagre at all.
//
// Cycle handling (D3) lives HERE, not in the solver: we break cycles ourselves (with
// pinning via opts.pinnedReversals) so the caller knows exactly which edges are
// loop-backs, then feed the solver an acyclic graph. Back edges and self-loops get
// deterministic consistent-side arc routing — by construction they can never
// flip sides across re-layouts.

import { engineSolve } from "./engine.js";
import { breakCycles } from "./cycles.js";
import { sampleCubic } from "./path.js";

const DEFAULTS = { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };

/** Container chrome (D5): a 28px header strip on top, plus 12px of breathing room on
 *  every side — including between the header strip and the first child, which used to
 *  get none (children sat flush under the header, unlike the 12px they clear on the
 *  other three edges). top = header height (render.js/preset-pipeline.js's HEADER_H)
 *  + that same 12px gap. */
export const CONTAINER_PAD = { top: 40, side: 12, bottom: 12 };

export function layout(view, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const solver = typeof o.solver === "function" ? o.solver : engineSolve;
  const nodes = view.nodes || [];
  const edges = view.edges || [];

  const selfLoops = edges.filter((e) => e.source === e.target);
  const realEdges = edges.filter((e) => e.source !== e.target);
  const reversed = breakCycles(nodes, realEdges, o.pinnedReversals);

  const hasParents = nodes.some((n) => n.parent !== undefined);
  // padContainers below grows every container rect past the solver's own idea of it, so the
  // solver has to reserve that chrome up front or the grown rect lands on a neighbouring
  // rank's nodes at small ranksep. One conservative scalar (the largest side) keeps the
  // solver out of the business of knowing which screen axis a dir maps a rank onto.
  const cpad = { ...CONTAINER_PAD, ...(o.containerPad || {}) };
  o.chromePad = Math.max(cpad.top, cpad.side, cpad.bottom);
  // INVARIANT (solver contract): the edge set handed down is acyclic, and no edge touches
  // a node that has children — viewstate.js re-attaches those to the interior entry/exit
  // child before we ever get here (D5). Back edges are withheld entirely: we route them
  // ourselves as consistent-side arcs, and feeding them (even flipped) would let the
  // solver pull ranks around as the graph grows, jiggling the loop's shape.

  // componentOrder groups a drawing by CONNECTED COMPONENT, and the edge set handed down is
  // the acyclic one — every cycle-broken edge is withheld, which would tear a cyclic
  // pipeline into two components the solver then orders independently. Hand the withheld
  // pairs down separately so connectivity is judged on the real graph. `o` is this
  // function's own merged copy of the opts, so writing to it cannot leak into the caller's.
  if (Array.isArray(o.componentOrder)) {
    o.backLinks = realEdges.filter((e) => reversed.has(e.id)).map((e) => [e.source, e.target]);
  }
  const solved = solver(
    {
      nodes: nodes.map((n) => (hasParents ? { id: n.id, w: n.w, h: n.h, parent: n.parent } : { id: n.id, w: n.w, h: n.h })),
      edges: realEdges.filter((e) => !reversed.has(e.id)).map((e) => ({ id: e.id, source: e.source, target: e.target })),
    },
    o
  );

  const outNodes = {};
  for (const n of nodes) {
    const d = (solved.nodes && solved.nodes[n.id]) || null;
    outNodes[n.id] = d ? { x: d.x, y: d.y, w: d.w, h: d.h } : { x: 0, y: 0, w: n.w || 0, h: n.h || 0 };
  }
  if (hasParents) padContainers(nodes, outNodes, { ...CONTAINER_PAD, ...(o.containerPad || {}) });

  const outEdges = {};
  for (const e of realEdges) {
    if (reversed.has(e.id)) continue;
    const d = (solved.edges && solved.edges[e.id]) || null;
    const pts = d && d.points && d.points.length >= 2
      ? d.points.map((p) => ({ x: p.x, y: p.y }))
      // A solver that dropped the edge (dangling endpoint) still has to render as
      // something: a straight centre-to-centre segment, which is what clipEnds expects.
      : [
          { x: outNodes[e.source].x, y: outNodes[e.source].y },
          { x: outNodes[e.target].x, y: outNodes[e.target].y },
        ];
    outEdges[e.id] = { points: pts };
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
  return {
    nodes: outNodes,
    edges: outEdges,
    bounds,
    reversedEdgeIds: reversed,
    // Persisted by the caller and handed back as opts.prevOrder next time — the solver's
    // order-stability channel (the role dagre's `useDynamic` played).
    order: Array.isArray(solved.order) ? solved.order : [],
    // `order` names only the real nodes, and a drawing is not determined by those alone:
    // the bends of every multi-rank edge sit between them. `layers` is the same per-rank
    // sequence WITH the bends, and persisting it is what makes a re-layout of an unchanged
    // graph land on the identical picture instead of re-deriving the bends, scoring the
    // arrangement differently, and reshuffling ranks nobody touched. Solvers that do not
    // produce it (the dagre adapter) simply return nothing here.
    layers: Array.isArray(solved.layers) ? solved.layers : [],
    // componentOrder only: which slot each id's component landed in, for the caller to
    // remember (index.js keeps a component's slot alive after every id the spec named for
    // it is gone). The key is absent whenever the solver did not produce one, so a result
    // built without the option has exactly the shape it always had.
    ...(solved.slots && typeof solved.slots === "object" ? { slots: solved.slots } : null),
  };
}

/**
 * D5 step 4 — give every cluster its exact chrome. A solver computes a cluster rect from
 * invisible border nodes, so its padding is a side effect of nodesep/ranksep; we grow
 * that rect to the union with (children bbox + containerPad) so the header strip always
 * clears the topmost child while siblings still never overlap what the solver reserved.
 * Deepest containers first, so a nested container is already padded when its parent
 * measures it.
 */
function padContainers(nodes, out, pad) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of nodes) {
    if (n.parent === undefined || !byId.has(n.parent)) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n.id);
  }
  const depthOf = (id) => {
    let d = 0, p = byId.get(id).parent, seen = new Set([id]);
    while (p !== undefined && byId.has(p) && !seen.has(p)) { d++; seen.add(p); p = byId.get(p).parent; }
    return d;
  };
  for (const id of [...kids.keys()].sort((a, b) => depthOf(b) - depthOf(a))) {
    const r = out[id];
    if (!r) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of kids.get(id)) {
      const k = out[c];
      if (!k) continue;
      x0 = Math.min(x0, k.x - k.w / 2); y0 = Math.min(y0, k.y - k.h / 2);
      x1 = Math.max(x1, k.x + k.w / 2); y1 = Math.max(y1, k.y + k.h / 2);
    }
    if (x0 === Infinity) continue;
    const l = Math.min(r.x - r.w / 2, x0 - pad.side);
    const t = Math.min(r.y - r.h / 2, y0 - pad.top);
    const rt = Math.max(r.x + r.w / 2, x1 + pad.side);
    const b = Math.max(r.y + r.h / 2, y1 + pad.bottom);
    out[id] = { x: (l + rt) / 2, y: (t + b) / 2, w: rt - l, h: b - t };
  }
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
