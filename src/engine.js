// M3 — the in-house layered layout solver (plan D2), taking over dagre's role behind the
// frozen layout() seam. Pure, deterministic, zero dependencies, no DOM.
//
//   engineSolve(input, opts) -> {
//     nodes: { [id]: {x, y, w, h} },          // x,y = center; a container covers its children
//     edges: { [id]: { points: [{x,y}, …] } },// source -> target, bend chain included
//     order: string[][],                      // final per-rank real-node order
//     layers: string[][]                      // …the same, with edge bends interleaved
//   }
//
// Caller invariants (layout.js shell): the edge set is acyclic (back edges withheld) and
// no edge touches a node that has children. Both are handled defensively anyway — a
// violating edge degrades to a straight centre-to-centre segment instead of throwing.
//
// Pipeline (Sugiyama, deliberately the *simple* heuristic — plan §9.1 ships a heuristic
// coordinate pass on purpose, no Brandes-Köpf):
//   1 nesting      cluster tree, spans, border dummies
//   2 ranking      longest path + one tightening pass
//   3 dummies      unit-span chains for multi-rank edges
//   4 ordering     median sweeps + transpose, previous-drawing tie-breaks
//                  (opts.prevOrder + opts.prevLayers)
//   5 coordinates  median relaxation + isotonic (PAVA) separation repair
//   6 margins
//
// Everything solves in TB space — rank axis = y, in-rank axis = x — and LR/RL/BT are a
// transposition/flip applied on the way out (§transform).

const DEFAULTS = { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };
const DIRS = ["LR", "RL", "TB", "BT"];

const ITERATIONS = 8; // relaxation sweeps, and ordering sweeps without improvement
const MAX_ORDER_SWEEPS = 32; // hard cap on one descent
const ORDER_ROUNDS = 8; // hard cap on restarted descents (the loop exits when idempotent)
const ALIGN_PASSES = 24; // cluster border alignment rounds (cap; the loop exits when settled)
const CLUSTER_PAD = 8; // engine-side breathing room inside a container rect
const DUMMY_W = 1; // edge dummies are thin, not zero-width (keeps bends separable)
const BORDER_W = 500; // relaxation weight pinning a cluster border to the cluster rect
const DUMMY_PRIO = 4; // dummies straighten first (plan D2 M3 pass 5)
const UNRANKED = 1e6; // pref base for ids absent from prevOrder
const ROOT = Symbol("root"); // cluster key standing in for "no parent"

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
// Output is quantized to 1e-4 px: the isotonic repair leaves nanopixel residue that would
// otherwise make a straight chain "almost" straight and golden files unreadable. The
// renderer rounds paths to 2 decimals anyway (path.js pathString).
const q = (n) => Math.round(n * 1e4) / 1e4;
const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

/**
 * @param {{nodes?: Array<{id:string,w?:number,h?:number,parent?:string}>,
 *          edges?: Array<{id:string,source:string,target:string}>}} input
 * @param {{dir?:string, nodesep?:number, ranksep?:number, marginx?:number, marginy?:number,
 *          prevOrder?: string[][]}} opts
 */
export function engineSolve(input = {}, opts = {}) {
  const o = {
    dir: DIRS.indexOf(opts.dir) >= 0 ? opts.dir : DEFAULTS.dir,
    nodesep: Math.max(0, num(opts.nodesep, DEFAULTS.nodesep)),
    ranksep: Math.max(0, num(opts.ranksep, DEFAULTS.ranksep)),
    marginx: num(opts.marginx, DEFAULTS.marginx),
    marginy: num(opts.marginy, DEFAULTS.marginy),
    prevOrder: Array.isArray(opts.prevOrder) ? opts.prevOrder : null,
    prevLayers: Array.isArray(opts.prevLayers) ? opts.prevLayers : null,
    // Disconnected components have no edges between them, so crossing minimization has
    // nothing to say about their relative order and a re-solve is free to shuffle them.
    // `componentOrder` pins that order down; anything but an array switches it off.
    componentOrder: Array.isArray(opts.componentOrder) ? opts.componentOrder : null,
    // The shell withholds cycle-broken edges from us (layout.js), which would split a
    // cyclic pipeline into two components — these name them so connectivity survives.
    backLinks: Array.isArray(opts.backLinks) ? opts.backLinks : null,
  };
  // Container chrome has to be *reserved*, not assumed: a border dummy is the only thing
  // standing between a foreign node and the CLUSTER_PAD the rect grows by, so it is at
  // least that wide, and its distance from the rect edge is exactly what the separation
  // rule will demand of the first member inside. Both were fixed fractions of nodesep
  // before, which made the alignment targets infeasible (the borders pooled, the corridor
  // collapsed) whenever nodesep was small or the nesting more than one level deep.
  o.borderW = Math.max(o.nodesep, CLUSTER_PAD);
  o.borderGap = Math.max(o.nodesep / 2, CLUSTER_PAD);
  // How far past its outermost member the container rect the CALLER finally draws reaches
  // (layout.js grows it again for the header strip). Reserved in the rank axis below —
  // ranksep alone never accounted for it, so a small ranksep let a rect eat the next rank.
  o.chromePad = Math.max(CLUSTER_PAD, num(opts.chromePad, 0));
  const g = indexInput(input, o);
  assignSlots(g);
  if (!g.leaves.length) return { nodes: {}, edges: {}, order: [], layers: [] };
  rankLeaves(g);
  const L = buildLayers(g, o);
  orderLayers(L);
  assignCoords(L, g, o);
  return emit(L, g, o);
}

// ---------------------------------------------------------------------------- 1 nesting

/** Index nodes/edges, sanitize the parent forest, split leaves from clusters. */
function indexInput(input, o) {
  const rawNodes = Array.isArray(input && input.nodes) ? input.nodes : [];
  const rawEdges = Array.isArray(input && input.edges) ? input.edges : [];
  const nodes = new Map();
  const ids = [];
  for (const n of rawNodes) {
    if (!n || n.id === undefined || n.id === null || nodes.has(n.id)) continue;
    nodes.set(n.id, {
      id: n.id,
      w: Math.max(0, num(n.w, 0)),
      h: Math.max(0, num(n.h, 0)),
      raw: n.parent,
      parent: undefined,
      index: ids.length,
    });
    ids.push(n.id);
  }
  // A parent must exist, not be the node itself, and not close a cycle — a malformed
  // forest degrades to "no parent" rather than hanging the walk below.
  for (const id of ids) {
    const n = nodes.get(id);
    const p = n.raw;
    if (p === undefined || p === null || p === id || !nodes.has(p)) continue;
    let cur = p, steps = 0, ok = true;
    while (cur !== undefined && cur !== null && nodes.has(cur)) {
      if (cur === id || steps++ > ids.length) { ok = false; break; }
      cur = nodes.get(cur).raw;
    }
    if (ok) n.parent = p;
  }

  const childrenOf = new Map();
  for (const id of ids) {
    const p = nodes.get(id).parent;
    if (p !== undefined) push(childrenOf, p, id);
  }
  const leaves = ids.filter((id) => !childrenOf.has(id));
  const clusters = ids.filter((id) => childrenOf.has(id));
  const isLeaf = new Set(leaves);

  const depthOf = (id) => { let d = 0, p = nodes.get(id).parent; while (p !== undefined) { d++; p = nodes.get(p).parent; } return d; };
  const depth = new Map(ids.map((id) => [id, depthOf(id)]));
  const clustersDeepFirst = clusters.slice().sort((a, b) => depth.get(b) - depth.get(a));

  // Edges: only leaf->leaf, non-self edges take part in ranking. Anything else (a
  // dangling endpoint, a self-loop, an edge on a container) is routed straight at emit.
  const rankEdges = [];
  const allEdges = [];
  for (const e of rawEdges) {
    if (!e || e.id === undefined || !nodes.has(e.source) || !nodes.has(e.target)) continue;
    allEdges.push(e);
    if (e.source !== e.target && isLeaf.has(e.source) && isLeaf.has(e.target)) rankEdges.push(e);
  }

  const g = {
    o, nodes, ids, leaves, clusters, clustersDeepFirst, childrenOf, depth, rankEdges, allEdges,
    rank: new Map(), pref: new Map(), out: new Map(), in: new Map(),
  };
  for (const e of rankEdges) { push(g.out, e.source, e.target); push(g.in, e.target, e.source); }
  return g;
}

/**
 * `slot` is the PRIMARY in-rank ordering key (ahead of `pref`): every id in one connected
 * component carries the same one, so a component can never be split or leapfrogged by a
 * neighbour, whatever the median sweeps make of it. Absent `opts.componentOrder` there are
 * no slots at all (`g.slot === null`) and every layout node takes slot 0 — the comparisons
 * downstream are then uniformly inert and the drawing is bit-identical to before.
 *
 * Components are the connected components of: every edge (including the cycle-broken ones
 * the shell withholds, named by `opts.backLinks`) PLUS containment, because a container and
 * its children are one thing on screen and have to move as one.
 *
 * Each spec entry is one slot: an id, or an array of ids that are aliases for the same
 * slot. A component holding ids from several entries takes the smallest. Unknown ids are
 * ignored. Every component nobody named shares ONE slot after all of them, so their
 * relative order stays whatever the ordering pass would have made of it.
 */
function assignSlots(g) {
  const spec = Array.isArray(g.o.componentOrder) ? g.o.componentOrder : null;
  if (!spec) { g.slot = null; return; }

  // Union-find over ALL ids (leaves and clusters), indexed by the input index.
  const uf = new Int32Array(g.ids.length);
  for (let i = 0; i < uf.length; i++) uf[i] = i;
  const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) uf[rb] = ra; else uf[ra] = rb; // lowest index wins: deterministic roots
  };
  const idx = (id) => (g.nodes.has(id) ? g.nodes.get(id).index : -1);

  for (const e of g.allEdges) union(idx(e.source), idx(e.target)); // both endpoints exist
  for (const id of g.ids) {
    const p = g.nodes.get(id).parent;
    if (p !== undefined) union(idx(id), idx(p));
  }
  for (const pair of g.o.backLinks || []) {
    if (!Array.isArray(pair)) continue;
    const a = idx(pair[0]), b = idx(pair[1]);
    if (a >= 0 && b >= 0) union(a, b);
  }

  const entry = new Map(); // listed id -> spec index (first occurrence wins)
  for (let i = 0; i < spec.length; i++) {
    const ids = Array.isArray(spec[i]) ? spec[i] : [spec[i]];
    for (const id of ids) if (g.nodes.has(id) && !entry.has(id)) entry.set(id, i);
  }
  const rootSlot = new Map();
  for (const [id, i] of entry) {
    const r = find(idx(id));
    const cur = rootSlot.get(r);
    if (cur === undefined || i < cur) rootSlot.set(r, i);
  }

  const slot = new Map();
  for (const id of g.ids) {
    const s = rootSlot.get(find(idx(id)));
    slot.set(id, s === undefined ? spec.length : s); // unlisted components all go last
  }
  g.slot = slot;
}

// ---------------------------------------------------------------------------- 2 ranking

/** Longest-path ranking + one tightening pass, then empty-rank compaction. */
function rankLeaves(g) {
  const rank = g.rank;
  for (const id of g.leaves) rank.set(id, 0);

  const deg = new Map(g.leaves.map((id) => [id, 0]));
  for (const e of g.rankEdges) deg.set(e.target, deg.get(e.target) + 1);
  const topo = g.leaves.filter((id) => deg.get(id) === 0);
  const seen = new Set(topo);
  for (let i = 0; i < topo.length; i++) {
    for (const v of g.out.get(topo[i]) || []) {
      const d = deg.get(v) - 1;
      deg.set(v, d);
      if (d === 0) { topo.push(v); seen.add(v); }
    }
  }
  // Defensive: a cycle the caller promised wasn't there. Its nodes rank in input order
  // and the offending edges fall out as `loose` in buildLayers.
  for (const id of g.leaves) if (!seen.has(id)) topo.push(id);

  for (const u of topo) {
    for (const v of g.out.get(u) || []) rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
  }
  // Tighten: pull a node toward its tightest successor when that shortens more edges
  // than it lengthens, so tail chains don't left-pack against rank 0.
  for (let i = topo.length - 1; i >= 0; i--) {
    const u = topo[i];
    const outs = g.out.get(u), ins = g.in.get(u);
    const od = outs ? outs.length : 0;
    if (!od || od <= (ins ? ins.length : 0)) continue;
    let m = Infinity;
    for (const v of outs) m = Math.min(m, rank.get(v));
    if (m - 1 > rank.get(u)) rank.set(u, m - 1);
  }

  // Compact: normalize to 0 and drop ranks the tightening pass emptied.
  const used = [...new Set(g.leaves.map((id) => rank.get(id)))].sort((a, b) => a - b);
  const remap = new Map(used.map((r, i) => [r, i]));
  for (const id of g.leaves) rank.set(id, remap.get(rank.get(id)));
  g.maxRank = used.length - 1;

  assignPrefs(g);
}

/**
 * `pref` is the stability key: the position an id held in the previous layout
 * (opts.prevOrder, read rank-major), or a DFS discovery index when there is none.
 * Unknown ids sort after everything known, in input order (plan D2 M3 pass 4).
 */
function assignPrefs(g) {
  const prev = g.o.prevOrder;
  if (prev) {
    let k = 0;
    for (const rankIds of prev) {
      if (!Array.isArray(rankIds)) continue;
      for (const id of rankIds) if (g.rank.has(id) && !g.pref.has(id)) g.pref.set(id, k++);
    }
    for (const id of g.leaves) if (!g.pref.has(id)) g.pref.set(id, UNRANKED + g.nodes.get(id).index);
    normalizePrefs(g);
    return;
  }
  let k = 0;
  const visit = (start) => {
    const stack = [start];
    while (stack.length) {
      const u = stack.pop();
      if (g.pref.has(u)) continue;
      g.pref.set(u, k++);
      const outs = g.out.get(u) || [];
      for (let i = outs.length - 1; i >= 0; i--) stack.push(outs[i]);
    }
  };
  for (const id of g.leaves) if (!g.in.has(id)) visit(id);
  for (const id of g.leaves) if (!g.pref.has(id)) visit(id);
  normalizePrefs(g);
}

/**
 * Collapse `pref` onto a per-rank 0..n-1 index, keeping the order the raw keys gave.
 * An edge dummy's pref is interpolated between its endpoints' (buildLayers), and it is
 * then compared against the prefs of the rank it lands on — so the two have to live on
 * the same scale. They did not: the prevOrder branch counts rank-major across the whole
 * drawing while the DFS branch counts visit order, and a dummy's midpoint therefore fell
 * in a completely different slot depending on which branch ran. That is what stopped
 * `order` from being a fixed point (INTERNALS §M3) on any graph with a multi-rank edge.
 */
function normalizePrefs(g) {
  const byRank = new Map();
  for (const id of g.leaves) push(byRank, g.rank.get(id), id);
  for (const ids of byRank.values()) {
    ids.sort((a, b) => g.pref.get(a) - g.pref.get(b));
    for (let i = 0; i < ids.length; i++) g.pref.set(ids[i], i);
  }
}

// ------------------------------------------------------- 3 dummies + border dummies

/**
 * The layer graph: one layout node per real leaf, per edge bend, and two per
 * (cluster, spanned rank) — the border pair that keeps foreign nodes out of a
 * cluster's in-rank interval and defines the container rect.
 */
function buildLayers(g, o) {
  const horiz = o.dir === "LR" || o.dir === "RL";
  const V = [];
  const byNode = new Map();
  // slotOf: 0 everywhere unless componentOrder is in play (assignSlots), which makes every
  // slot comparison below a no-op and the drawing identical to a build without the feature.
  const slotOf = (id) => (g.slot ? g.slot.get(id) ?? 0 : 0);
  const mk = (kind, rank, cluster, rw, rh, pref, slot) => {
    const v = { i: V.length, kind, rank, cluster, rw, rh, pref, slot, pos: 0, x: 0, in: [], out: [] };
    V.push(v);
    return v;
  };

  for (const id of g.leaves) {
    const n = g.nodes.get(id);
    const v = mk(0, g.rank.get(id), n.parent, horiz ? n.h : n.w, horiz ? n.w : n.h, g.pref.get(id), slotOf(id));
    v.node = id;
    byNode.set(id, v);
  }

  // Cluster spans over their whole subtree of leaves.
  const span = new Map();
  for (const id of g.leaves) {
    const r = g.rank.get(id);
    let p = g.nodes.get(id).parent;
    while (p !== undefined) {
      const s = span.get(p);
      if (!s) span.set(p, [r, r]);
      else { s[0] = Math.min(s[0], r); s[1] = Math.max(s[1], r); }
      p = g.nodes.get(p).parent;
    }
  }
  // A container's rect is the union of its members' cells over EVERY rank it spans, so two
  // siblings whose spans merely touch still need disjoint in-rank bands across the union of
  // both spans: a member sitting on a rank the sibling does not span otherwise stretches the
  // union rect straight through it, and the alignment pass below is then asked for something
  // geometrically impossible (it pools the borders instead, and the rects overlap). Grow each
  // group of span-overlapping siblings to their common window so the border pairs — and the
  // separation they buy — exist on every rank that matters. A group's window is always inside
  // the parent's own span, so a child block never outlives the block that has to contain it.
  const groups = new Map();
  for (const c of g.clusters) {
    if (!span.has(c)) continue;
    push(groups, g.nodes.get(c).parent === undefined ? ROOT : g.nodes.get(c).parent, c);
  }
  for (const sibs of groups.values()) {
    const sorted = sibs.slice().sort((a, b) => span.get(a)[0] - span.get(b)[0]);
    let run = [], hi = -Infinity;
    const close = () => { for (const c of run) { span.get(c)[0] = span.get(run[0])[0]; span.get(c)[1] = hi; } };
    for (const c of sorted) {
      const s = span.get(c);
      if (run.length && s[0] <= hi) { hi = Math.max(hi, s[1]); run.push(c); continue; }
      if (run.length) close();
      run = [c]; hi = s[1];
    }
    if (run.length) close();
  }

  const borders = new Map(); // cluster -> { lo, l: [], r: [] }
  for (const c of g.clusters) {
    const s = span.get(c);
    if (!s) continue;
    const rec = { lo: s[0], hi: s[1], l: [], r: [] };
    const parent = g.nodes.get(c).parent;
    for (let r = s[0]; r <= s[1]; r++) {
      for (const side of [0, 1]) {
        const b = mk(2, r, parent, o.borderW, 0, 0, slotOf(c));
        b.of = c;
        b.side = side;
        (side ? rec.r : rec.l).push(b);
      }
    }
    // Chain the borders so a foreign edge crossing the cluster's corridor is counted
    // as a crossing by the ordering pass.
    for (let i = 1; i < rec.l.length; i++) {
      link(rec.l[i - 1], rec.l[i]);
      link(rec.r[i - 1], rec.r[i]);
    }
    borders.set(c, rec);
  }

  // Which clusters span each rank, grouped by their own parent cluster (input order).
  const spanClusters = [];
  for (let r = 0; r <= g.maxRank; r++) spanClusters.push(new Map());
  for (const c of g.clusters) {
    const rec = borders.get(c);
    if (!rec) continue;
    const key = g.nodes.get(c).parent === undefined ? ROOT : g.nodes.get(c).parent;
    for (let r = rec.lo; r <= rec.hi; r++) push(spanClusters[r], key, c);
  }

  // Edge chains. A dummy belongs to the deepest cluster containing both endpoints, so
  // block-contiguity ordering routes it around clusters it does not belong to.
  const seeds = prevKeys(o.prevLayers, g);
  const chains = new Map();
  for (const e of g.rankEdges) {
    const a = byNode.get(e.source), b = byNode.get(e.target);
    if (a.rank >= b.rank) continue; // only possible on malformed input; routed straight
    const cluster = lca(g, g.nodes.get(e.source).parent, g.nodes.get(e.target).parent);
    const chain = [];
    const steps = b.rank - a.rank;
    let prev = a;
    for (let r = a.rank + 1; r < b.rank; r++) {
      const tok = `${e.id}\u0000${chain.length}`;
      // Where this bend sat in the previous drawing if we were told (opts.prevLayers), else
      // interpolated along the edge — not a flat midpoint, so a long chain leans toward the
      // end it is nearer instead of parking every bend in the same slot.
      const seeded = seeds.bends.get(tok);
      const pref = seeded === undefined ? a.pref + ((b.pref - a.pref) * (r - a.rank)) / steps : seeded;
      const d = mk(1, r, cluster, DUMMY_W, 0, pref, slotOf(e.source));
      d.tok = tok;
      link(prev, d);
      chain.push(d);
      prev = d;
    }
    link(prev, b);
    chains.set(e.id, chain);
  }

  // Every layout node (leaf or edge bend) inside a cluster's subtree, at any rank. This is
  // the population a cluster's *global* block key averages over — see clusterSeq.
  const members = new Map();
  for (const v of V) {
    if (v.kind === 2) continue;
    let c = v.cluster;
    while (c !== undefined) { push(members, c, v); c = g.nodes.get(c).parent; }
  }

  const ranks = [];
  for (let r = 0; r <= g.maxRank; r++) ranks.push([]);
  for (const v of V) ranks[v.rank].push(v);

  return { g, V, ranks, byNode, borders, spanClusters, chains, members, blockKeys: seeds.blocks, seq: new Map(), maxRank: g.maxRank, y: [] };
}

const BLOCK_TOK = "\u0000c"; // layers marker for a container that spans a rank with nothing on it

/**
 * Everything in the previous drawing that `order` does NOT name — every edge bend, and every
 * container block that spans a rank without holding anything there — read back out of
 * `layers` on the SAME per-rank real-index scale assignPrefs puts the real nodes on (an item
 * that sat between real #2 and real #3 comes back as 2.x).
 *
 * Without this those items are re-derived from scratch on every solve while the real nodes
 * are not; the re-solve then starts from a differently scored arrangement than the one it is
 * supposed to reproduce, some sweep looks "strictly better", and a relayout that changed
 * nothing reshuffles ranks and moves every node.
 */
function prevKeys(prev, g) {
  const bends = new Map(), blocks = new Map();
  if (!Array.isArray(prev)) return { bends, blocks };
  for (let r = 0; r < prev.length; r++) {
    const layer = prev[r];
    if (!Array.isArray(layer)) continue;
    let reals = 0;
    let run = [];
    const flush = () => {
      for (let j = 0; j < run.length; j++) {
        const key = reals - 1 + (j + 1) / (run.length + 1);
        const tok = run[j];
        if (tok.startsWith(BLOCK_TOK)) blocks.set(`${r}\u0000${tok.slice(BLOCK_TOK.length)}`, key);
        else bends.set(tok, key);
      }
      run = [];
    };
    for (const tok of layer) {
      // Ignore anything that is neither a live real node nor one of our own markers: a
      // `layers` handed back after a removal still names ids that are gone, and counting
      // those as items would slide every key in the rank.
      if (g.rank.has(tok)) { flush(); reals++; }
      else if (typeof tok === "string" && tok.indexOf("\u0000") >= 0) run.push(tok);
    }
    flush();
  }
  return { bends, blocks };
}

function link(a, b) { a.out.push(b); b.in.push(a); }

/** Deepest cluster containing both `a` and `b` (either may be undefined = root). */
function lca(g, a, b) {
  if (a === undefined || b === undefined) return undefined;
  if (a === b) return a;
  const chain = (c) => { const out = []; let x = c; while (x !== undefined) { out.unshift(x); x = g.nodes.get(x).parent; } return out; };
  const A = chain(a), B = chain(b);
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  return i === 0 ? undefined : A[i - 1];
}

// --------------------------------------------------------------------------- 4 ordering

/**
 * One ordering key per cluster, shared by every rank that cluster spans. `pref` is a single
 * global rank-major counter, so a mean over the whole subtree is comparable between
 * clusters — which is the point: sortRank uses this (not each rank's own local mean) to
 * order sibling blocks, so a cluster cannot sit left of a sibling on one rank and right of
 * it on the next. It used to be able to, and clusterBoxes' union-across-ranks then handed
 * BOTH siblings a rect spanning the whole drawing, each swallowing the other's children.
 */
function clusterSeq(L) {
  const seq = L.seq;
  seq.clear();
  for (const c of L.g.clusters) {
    const ms = L.members.get(c);
    let s = 0;
    if (ms && ms.length) { for (const v of ms) s += v.pref; s /= ms.length; }
    seq.set(c, s);
  }
}

function orderLayers(L) {
  clusterSeq(L);
  // Init: the previous drawing (or DFS) drives everything — including which side of a
  // passing bend a container that spans this rank empty-handed sat on.
  sortAll(L, (v) => v.pref, (c, r) => L.blockKeys.get(`${r}\u0000${c}`) ?? L.seq.get(c));
  let best = snapshot(L);
  let bestCross = countCrossings(L);
  // The search has to be idempotent, not merely bounded: it ends only once a full run of
  // sweeps STARTED FROM `best` fails to improve on it. A loop that just stops after a fixed
  // number of sweeps wanders away from `best` and stops there, leaving an arrangement the
  // next solve — which starts from `best` — can still beat. Beating it is exactly what made
  // a relayout of an unchanged graph reshuffle ranks nobody had touched.
  for (let round = 0; round < ORDER_ROUNDS && bestCross > 0; round++) {
    const before = bestCross;
    let stale = 0;
    for (let it = 0; it < MAX_ORDER_SWEEPS && bestCross > 0 && stale < ITERATIONS; it++) {
      const down = it % 2 === 0;
      sweep(L, down);
      transpose(L, it % 4 >= 2);
      const c = countCrossings(L);
      stale = c < bestCross ? 0 : stale + 1;
      // Strictly fewer crossings only: an equal-crossing reshuffle loses to the order we
      // already have, which is the previous layout's (stability beats one crossing).
      if (c < bestCross) { bestCross = c; best = snapshot(L); }
    }
    if (bestCross >= before) break;
    restore(L, best); // improved: re-run the descent from where it actually got to
  }
  restore(L, best);
}

function sweep(L, down) {
  const ranks = down ? ranksAsc(1, L.maxRank) : ranksDesc(L.maxRank - 1, 0);
  for (const r of ranks) {
    sortRank(L, r, (v) => medianOf(down ? v.in : v.out, v.pos));
  }
}

function sortAll(L, keyOf, emptyKey) {
  for (let r = 0; r <= L.maxRank; r++) sortRank(L, r, keyOf, emptyKey);
}

/**
 * Reorder one rank. Nodes are grouped into the (nested) cluster blocks they belong to; a
 * block takes the slot the mean key of its members earns and always keeps its border pair
 * at the two ends, so cluster children stay contiguous within the rank. WHICH sibling block
 * lands in which of those slots is not this rank's business — see clusterSeq.
 */
function sortRank(L, r, keyOf, emptyKey) {
  const direct = new Map();
  for (const v of L.ranks[r]) if (v.kind !== 2) push(direct, v.cluster === undefined ? ROOT : v.cluster, v);
  const subs = L.spanClusters[r];

  const build = (key) => {
    const items = [];
    for (const v of direct.get(key) || []) items.push({ node: v, key: keyOf(v), slot: v.slot });
    for (const c of subs.get(key) || []) {
      const kids = build(c);
      let sum = 0, n = 0;
      for (const it of kids) { sum += it.key; n++; }
      const rec = L.borders.get(c);
      // A block with no members on this rank (a container whose span was grown to cover a
      // sibling's) has no local key. The initial sort supplies one on the pref scale; a
      // median sweep keeps it where it is, which is the only value on the right scale there.
      // Its slot comes off the CLUSTER id, not its members, for the same reason.
      items.push({
        cluster: c, items: kids,
        key: n ? sum / n : (emptyKey ? emptyKey(c, r) : rec.l[r - rec.lo].pos),
        slot: L.g.slot ? L.g.slot.get(c) ?? 0 : 0,
      });
    }
    // `slot` (componentOrder) outranks every other key: a component is a band, and no
    // median can move an item out of its own band. All-zero without the option, so the
    // comparison collapses back to the plain key sort.
    items.sort((a, b) => (a.slot - b.slot) || (a.key - b.key)); // stable: equal keys keep the previous order
    // Sibling cluster blocks keep the slots this rank's keys gave them, but which block
    // lands in which slot is decided ONCE, globally (clusterSeq) — never per rank.
    const at = [];
    for (let i = 0; i < items.length; i++) if (items[i].cluster !== undefined) at.push(i);
    if (at.length > 1) {
      const blocks = at.map((i) => items[i]);
      blocks.sort((a, b) => (a.slot - b.slot)
        || (L.seq.get(a.cluster) - L.seq.get(b.cluster))
        || (L.g.nodes.get(a.cluster).index - L.g.nodes.get(b.cluster).index));
      for (let i = 0; i < at.length; i++) items[at[i]] = blocks[i];
    }
    return items;
  };

  const out = [];
  const flat = (items) => {
    for (const it of items) {
      if (it.node) { out.push(it.node); continue; }
      const rec = L.borders.get(it.cluster);
      const i = r - rec.lo;
      out.push(rec.l[i]);
      flat(it.items);
      out.push(rec.r[i]);
    }
  };
  flat(build(ROOT));
  L.ranks[r] = out;
  for (let i = 0; i < out.length; i++) out[i].pos = i;
}

function medianOf(neighbors, fallback) {
  const n = neighbors.length;
  if (!n) return fallback;
  const p = neighbors.map((v) => v.pos).sort((a, b) => a - b);
  const m = n >> 1;
  return n % 2 ? p[m] : (p[m - 1] + p[m]) / 2;
}

/**
 * Adjacent-swap pass, within one cluster block only. A swap needs a strict win, except on
 * the `reverse` rounds where equal-crossing swaps are taken too — the classic dot
 * diversification that walks the ordering out of a local minimum. It is safe for
 * stability because orderLayers only keeps a sweep that strictly beats what came before.
 */
function transpose(L, reverse) {
  for (let guard = 0; guard < 4; guard++) {
    let improved = false;
    for (let r = 0; r <= L.maxRank; r++) {
      const arr = L.ranks[r];
      for (let i = 0; i < arr.length - 1; i++) {
        const v = arr[i], w = arr[i + 1];
        // …and never across two componentOrder bands (v.slot === w.slot always without it).
        if (v.kind === 2 || w.kind === 2 || v.cluster !== w.cluster || v.slot !== w.slot) continue;
        const cur = pairCross(v.out, w.out) + pairCross(v.in, w.in);
        const swapped = pairCross(w.out, v.out) + pairCross(w.in, v.in);
        if (swapped < cur || (reverse && swapped === cur && swapped > 0)) {
          arr[i] = w; arr[i + 1] = v;
          w.pos = i; v.pos = i + 1;
          improved = true;
        }
      }
    }
    if (!improved) return;
  }
}

function pairCross(a, b) {
  let c = 0;
  for (const p of a) for (const q of b) if (p.pos > q.pos) c++;
  return c;
}

function countCrossings(L) {
  let total = 0;
  for (let r = 0; r < L.maxRank; r++) {
    const lower = L.ranks[r + 1];
    if (!lower.length) continue;
    const seq = [];
    for (const u of L.ranks[r]) {
      const ps = u.out.map((v) => v.pos).sort((a, b) => a - b);
      for (const p of ps) seq.push(p);
    }
    total += inversions(seq, lower.length);
  }
  return total;
}

/** Inversion count via a Fenwick tree — the standard bilayer crossing number. */
function inversions(seq, size) {
  const tree = new Int32Array(size + 2);
  let inv = 0, seen = 0;
  for (const p of seq) {
    let cnt = 0;
    for (let i = p + 1; i > 0; i -= i & -i) cnt += tree[i];
    inv += seen - cnt;
    seen++;
    for (let i = p + 1; i <= size; i += i & -i) tree[i]++;
  }
  return inv;
}

const snapshot = (L) => L.ranks.map((a) => a.slice());
function restore(L, snap) {
  L.ranks = snap.map((a) => a.slice());
  for (const arr of L.ranks) for (let i = 0; i < arr.length; i++) arr[i].pos = i;
}
function ranksAsc(lo, hi) { const out = []; for (let r = lo; r <= hi; r++) out.push(r); return out; }
function ranksDesc(hi, lo) { const out = []; for (let r = hi; r >= lo; r--) out.push(r); return out; }

// ------------------------------------------------------------------------ 5 coordinates

function assignCoords(L, g, o) {
  // Rank axis: cumulative max extent + ranksep.
  const ext = new Array(L.maxRank + 1).fill(0);
  for (const v of L.V) ext[v.rank] = Math.max(ext[v.rank], v.rh);
  // Container chrome is reserved where it is actually claimed: the first and last rank a
  // container spans. Nested rects stack, so a container pays for its deepest chain.
  const opens = new Array(L.maxRank + 2).fill(0);
  const closes = new Array(L.maxRank + 2).fill(0);
  const nesting = new Map(); // deepest-first, so a child is measured before its parent
  for (const c of g.clustersDeepFirst) {
    let d = 1;
    for (const kid of g.childrenOf.get(c) || []) if (nesting.has(kid)) d = Math.max(d, nesting.get(kid) + 1);
    nesting.set(c, d);
  }
  for (const c of g.clusters) {
    const rec = L.borders.get(c);
    if (!rec) continue;
    const claim = o.chromePad * nesting.get(c);
    opens[rec.lo] = Math.max(opens[rec.lo], claim);
    closes[rec.hi] = Math.max(closes[rec.hi], claim);
  }
  let acc = 0;
  for (let r = 0; r <= L.maxRank; r++) {
    L.y[r] = acc + ext[r] / 2;
    acc += ext[r] + Math.max(o.ranksep, closes[r] + opens[r + 1]);
  }

  // In-rank axis: pack by order, then relax toward neighbour medians, re-imposing the
  // separation constraints after every move.
  for (const arr of L.ranks) {
    let x = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i) x += sepBetween(arr[i - 1], arr[i], o);
      arr[i].x = x;
    }
  }
  const weights = (arr) => arr.map((v) => (v.kind === 1 ? DUMMY_PRIO : 1));
  for (let it = 0; it < ITERATIONS; it++) {
    const down = it % 2 === 0;
    for (const r of down ? ranksAsc(1, L.maxRank) : ranksDesc(L.maxRank - 1, 0)) {
      const arr = L.ranks[r];
      const desired = arr.map((v) => medianX(down ? v.in : v.out, v.x));
      separate(arr, desired, weights(arr), o);
    }
  }

  // Cluster borders are one variable per rank but must line up, or the container rect
  // (children bbox + pad) would cut into a neighbour at some rank. Pin every border of a
  // cluster to that cluster's *global* rect and let the separation pass push foreign
  // nodes out of the way; the rect widens, so repeat until it settles.
  if (g.clusters.length) {
    // Each pass pushes members away from the borders, which grows the boxes, which moves
    // the borders again: three passes was an arbitrary stop in the middle of that, and it
    // left rects that no pass had ever been separated against. Run until the boxes stop
    // moving (they do, quickly) and only then emit them.
    let prev = null;
    for (let p = 0; p < ALIGN_PASSES; p++) {
      const boxes = clusterBoxes(L, g);
      if (settled(prev, boxes)) break;
      prev = boxes;
      for (let r = 0; r <= L.maxRank; r++) {
        const arr = L.ranks[r];
        const desired = arr.map((v) => borderTarget(v, boxes, o));
        const w = arr.map((v) => (v.kind === 2 ? BORDER_W : v.kind === 1 ? DUMMY_PRIO : 1));
        separate(arr, desired, w, o);
      }
    }
  }
  L.boxes = clusterBoxes(L, g);
}

function borderTarget(v, boxes, o) {
  if (v.kind !== 2) return v.x;
  const b = boxes.get(v.of);
  if (!b) return v.x;
  return v.side ? b.x1 + o.borderGap : b.x0 - o.borderGap;
}

function medianX(neighbors, fallback) {
  const n = neighbors.length;
  if (!n) return fallback;
  const p = neighbors.map((v) => v.x).sort((a, b) => a - b);
  const m = n >> 1;
  return n % 2 ? p[m] : (p[m - 1] + p[m]) / 2;
}

function sepBetween(a, b, o) {
  // Two borders are markers, not nodes. A nested pair (an outer container's border beside
  // its child's) is exactly CLUSTER_PAD apart — that IS the step clusterBoxes puts between
  // a parent rect and a child rect — so charging them a full node's gap makes the targets
  // borderTarget asks for unreachable at two or more nesting levels: PAVA pools them and
  // the corridor collapses onto itself. Only the facing pair of two disjoint blocks
  // (a closing border meeting an opening one) has to keep real distance.
  if (a.kind === 2 && b.kind === 2 && !(a.side === 1 && b.side === 0)) return CLUSTER_PAD;
  const gap = a.kind || b.kind ? o.nodesep / 2 : o.nodesep;
  return (a.rw + b.rw) / 2 + gap;
}

/**
 * Place one rank as close as possible to `desired` while honouring the ordering and the
 * minimum separations: weighted isotonic regression by pool-adjacent-violators. Exact,
 * O(n), and it guarantees the no-overlap invariant no matter what the relaxation asked
 * for — which is why no later pass can reintroduce an overlap.
 */
function separate(arr, desired, weights, o) {
  const n = arr.length;
  if (!n) return;
  const off = new Array(n);
  off[0] = 0;
  for (let i = 1; i < n; i++) off[i] = off[i - 1] + sepBetween(arr[i - 1], arr[i], o);
  const bv = [], bw = [], bn = [];
  for (let i = 0; i < n; i++) {
    let v = desired[i] - off[i], w = Math.max(1e-6, weights[i]), c = 1;
    while (bv.length && bv[bv.length - 1] > v) {
      const pw = bw.pop();
      v = (bv.pop() * pw + v * w) / (pw + w);
      w += pw;
      c += bn.pop();
    }
    bv.push(v); bw.push(w); bn.push(c);
  }
  let i = 0;
  for (let b = 0; b < bv.length; b++) for (let k = 0; k < bn[b]; k++, i++) arr[i].x = bv[b] + off[i];
}

/** Have the container rects stopped moving between two alignment passes? */
function settled(a, b) {
  if (!a || a.size !== b.size) return false;
  for (const [c, r] of b) {
    const p = a.get(c);
    if (!p || Math.abs(p.x0 - r.x0) > 1e-3 || Math.abs(p.x1 - r.x1) > 1e-3) return false;
  }
  return true;
}

/** Container rects in internal coordinates, deepest cluster first. */
function clusterBoxes(L, g) {
  const boxes = new Map();
  for (const c of g.clustersDeepFirst) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const kid of g.childrenOf.get(c) || []) {
      const b = boxes.get(kid);
      if (b) {
        x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1);
        y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1);
        continue;
      }
      const v = L.byNode.get(kid);
      if (!v) continue;
      const y = L.y[v.rank];
      x0 = Math.min(x0, v.x - v.rw / 2); x1 = Math.max(x1, v.x + v.rw / 2);
      y0 = Math.min(y0, y - v.rh / 2); y1 = Math.max(y1, y + v.rh / 2);
    }
    if (x0 === Infinity) continue;
    boxes.set(c, { x0: x0 - CLUSTER_PAD, x1: x1 + CLUSTER_PAD, y0: y0 - CLUSTER_PAD, y1: y1 + CLUSTER_PAD });
  }
  return boxes;
}

// ------------------------------------------------------------- 6 transform + margins

function emit(L, g, o) {
  const horiz = o.dir === "LR" || o.dir === "RL";
  const flip = o.dir === "RL" || o.dir === "BT" ? -1 : 1;
  const pt = (x, y) => (horiz ? { x: q(flip * y), y: q(x) } : { x: q(x), y: q(flip * y) });

  const nodes = {};
  for (const id of g.ids) {
    const n = g.nodes.get(id);
    const v = L.byNode.get(id);
    if (v) {
      const c = pt(v.x, L.y[v.rank]);
      nodes[id] = { x: c.x, y: c.y, w: n.w, h: n.h };
      continue;
    }
    const b = L.boxes.get(id); // a container: its rect is its children's, not its own w/h
    if (!b) { nodes[id] = { x: 0, y: 0, w: n.w, h: n.h }; continue; }
    const mid = pt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const inRank = b.x1 - b.x0, alongRank = b.y1 - b.y0;
    nodes[id] = { x: mid.x, y: mid.y, w: q(horiz ? alongRank : inRank), h: q(horiz ? inRank : alongRank) };
  }

  const edges = {};
  for (const e of g.allEdges) {
    const chain = L.chains.get(e.id);
    if (!chain) {
      // self-loop, an edge on a container, or a contract-violating back edge: the shell
      // routes these itself, so a straight centre-to-centre segment is the honest answer.
      const s = nodes[e.source], t = nodes[e.target];
      edges[e.id] = { points: [{ x: s.x, y: s.y }, { x: t.x, y: t.y }] };
      continue;
    }
    const a = L.byNode.get(e.source), b = L.byNode.get(e.target);
    const pts = [pt(a.x, L.y[a.rank])];
    for (const d of chain) pts.push(pt(d.x, L.y[d.rank]));
    pts.push(pt(b.x, L.y[b.rank]));
    edges[e.id] = { points: pts };
  }

  // Margins last: shift so the tightest bound sits exactly on (marginx, marginy).
  let minX = Infinity, minY = Infinity;
  for (const n of Object.values(nodes)) { minX = Math.min(minX, n.x - n.w / 2); minY = Math.min(minY, n.y - n.h / 2); }
  for (const e of Object.values(edges)) for (const p of e.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  const dx = (Number.isFinite(minX) ? -minX : 0) + o.marginx;
  const dy = (Number.isFinite(minY) ? -minY : 0) + o.marginy;
  for (const n of Object.values(nodes)) { n.x = q(n.x + dx); n.y = q(n.y + dy); }
  for (const e of Object.values(edges)) for (const p of e.points) { p.x = q(p.x + dx); p.y = q(p.y + dy); }

  const order = [];
  const layers = [];
  for (let r = 0; r <= L.maxRank; r++) {
    const row = [], full = [];
    const arr = L.ranks[r];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v.kind === 0) { row.push(v.node); full.push(v.node); continue; }
      if (v.kind === 1) { full.push(v.tok); continue; }
      // A block that spans this rank holding nothing: its own pair, back to back. Record it,
      // or the next solve has no idea which side of a passing bend the container sat on.
      const next = arr[i + 1];
      if (!v.side && next && next.kind === 2 && next.side === 1 && next.of === v.of) full.push(BLOCK_TOK + v.of);
    }
    order.push(row);
    layers.push(full);
  }
  return { nodes, edges, order, layers };
}
