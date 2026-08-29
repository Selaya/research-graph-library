// M3 — the in-house layered layout solver (plan D2), taking over dagre's role behind the
// frozen layout() seam. Pure, deterministic, zero dependencies, no DOM.
//
//   engineSolve(input, opts) -> {
//     nodes: { [id]: {x, y, w, h} },          // x,y = center; a container covers its children
//     edges: { [id]: { points: [{x,y}, …] } },// source -> target, bend chain included
//     order: string[][]                       // final per-rank real-node order
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
//   4 ordering     median sweeps + transpose, previous-order tie-breaks (opts.prevOrder)
//   5 coordinates  median relaxation + isotonic (PAVA) separation repair
//   6 margins
//
// Everything solves in TB space — rank axis = y, in-rank axis = x — and LR/RL/BT are a
// transposition/flip applied on the way out (§transform).

const DEFAULTS = { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };
const DIRS = ["LR", "RL", "TB", "BT"];

const ITERATIONS = 8; // ordering sweeps, and relaxation sweeps
const ALIGN_PASSES = 3; // cluster border alignment rounds
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
  };
  const g = indexInput(input, o);
  if (!g.leaves.length) return { nodes: {}, edges: {}, order: [] };
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
  const mk = (kind, rank, cluster, rw, rh, pref) => {
    const v = { i: V.length, kind, rank, cluster, rw, rh, pref, pos: 0, x: 0, in: [], out: [] };
    V.push(v);
    return v;
  };

  for (const id of g.leaves) {
    const n = g.nodes.get(id);
    const v = mk(0, g.rank.get(id), n.parent, horiz ? n.h : n.w, horiz ? n.w : n.h, g.pref.get(id));
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
  const borders = new Map(); // cluster -> { lo, l: [], r: [] }
  for (const c of g.clusters) {
    const s = span.get(c);
    if (!s) continue;
    const rec = { lo: s[0], hi: s[1], l: [], r: [] };
    const parent = g.nodes.get(c).parent;
    for (let r = s[0]; r <= s[1]; r++) {
      for (const side of [0, 1]) {
        const b = mk(2, r, parent, o.nodesep, 0, 0);
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
  const chains = new Map();
  for (const e of g.rankEdges) {
    const a = byNode.get(e.source), b = byNode.get(e.target);
    if (a.rank >= b.rank) continue; // only possible on malformed input; routed straight
    const cluster = lca(g, g.nodes.get(e.source).parent, g.nodes.get(e.target).parent);
    const pref = (a.pref + b.pref) / 2;
    const chain = [];
    let prev = a;
    for (let r = a.rank + 1; r < b.rank; r++) {
      const d = mk(1, r, cluster, DUMMY_W, 0, pref);
      link(prev, d);
      chain.push(d);
      prev = d;
    }
    link(prev, b);
    chains.set(e.id, chain);
  }

  const ranks = [];
  for (let r = 0; r <= g.maxRank; r++) ranks.push([]);
  for (const v of V) ranks[v.rank].push(v);

  return { g, V, ranks, byNode, borders, spanClusters, chains, maxRank: g.maxRank, y: [] };
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

function orderLayers(L) {
  sortAll(L, (v) => v.pref); // init: previous order (or DFS) drives everything
  let best = snapshot(L);
  let bestCross = countCrossings(L);
  for (let it = 0; it < ITERATIONS && bestCross > 0; it++) {
    const down = it % 2 === 0;
    sweep(L, down);
    transpose(L, it % 4 >= 2);
    const c = countCrossings(L);
    // Strictly fewer crossings only: an equal-crossing reshuffle loses to the order we
    // already have, which is the previous layout's (stability beats one crossing).
    if (c < bestCross) { bestCross = c; best = snapshot(L); }
  }
  restore(L, best);
}

function sweep(L, down) {
  const ranks = down ? ranksAsc(1, L.maxRank) : ranksDesc(L.maxRank - 1, 0);
  for (const r of ranks) {
    sortRank(L, r, (v) => medianOf(down ? v.in : v.out, v.pos));
  }
}

function sortAll(L, keyOf) {
  for (let r = 0; r <= L.maxRank; r++) sortRank(L, r, keyOf);
}

/**
 * Reorder one rank. Nodes are grouped into the (nested) cluster blocks they belong to;
 * a block sorts by the mean key of its members and always keeps its border pair at the
 * two ends, so cluster children stay contiguous within the rank.
 */
function sortRank(L, r, keyOf) {
  const direct = new Map();
  for (const v of L.ranks[r]) if (v.kind !== 2) push(direct, v.cluster === undefined ? ROOT : v.cluster, v);
  const subs = L.spanClusters[r];

  const build = (key) => {
    const items = [];
    for (const v of direct.get(key) || []) items.push({ node: v, key: keyOf(v) });
    for (const c of subs.get(key) || []) {
      const kids = build(c);
      let sum = 0, n = 0;
      for (const it of kids) { sum += it.key; n++; }
      const rec = L.borders.get(c);
      items.push({ cluster: c, items: kids, key: n ? sum / n : rec.l[r - rec.lo].pos });
    }
    items.sort((a, b) => a.key - b.key); // stable: equal keys keep the previous order
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
        if (v.kind === 2 || w.kind === 2 || v.cluster !== w.cluster) continue;
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
  let acc = 0;
  for (let r = 0; r <= L.maxRank; r++) { L.y[r] = acc + ext[r] / 2; acc += ext[r] + o.ranksep; }

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
    for (let p = 0; p < ALIGN_PASSES; p++) {
      const boxes = clusterBoxes(L, g);
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
  return v.side ? b.x1 + o.nodesep / 2 : b.x0 - o.nodesep / 2;
}

function medianX(neighbors, fallback) {
  const n = neighbors.length;
  if (!n) return fallback;
  const p = neighbors.map((v) => v.x).sort((a, b) => a - b);
  const m = n >> 1;
  return n % 2 ? p[m] : (p[m - 1] + p[m]) / 2;
}

function sepBetween(a, b, o) {
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
  for (let r = 0; r <= L.maxRank; r++) order.push(L.ranks[r].filter((v) => v.kind === 0).map((v) => v.node));
  return { nodes, edges, order };
}
