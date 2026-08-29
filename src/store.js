// Graph store: flat spec, validation, structural snapshots.
// Cycles are ALLOWED (tagged later by the cycle-breaking pass, never rejected).

export class GraphError extends Error {
  constructor(code, message) {
    super(`[smv:${code}] ${message}`);
    this.code = code;
  }
}

const NODE_FIELDS = [
  "id", "label", "parent", "data", "collapsed", "join", "type",
  "iterate", "children", "durationAgg", "w", "h", "groups",
];
const EDGE_FIELDS = ["id", "source", "target", "loop", "maxIterations", "label", "data", "weight"];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

export function normalizeSpec(spec) {
  const nodes = (spec.nodes || []).map((n) => pick(n, NODE_FIELDS));
  const edges = (spec.edges || []).map((e) => pick(e, EDGE_FIELDS));
  return { nodes, edges };
}

export function validateSpec(spec) {
  const seen = new Set();
  for (const n of spec.nodes) {
    if (n.id == null || n.id === "") throw new GraphError("node-id", "every node needs a non-empty id");
    if (seen.has(n.id)) throw new GraphError("dup-id", `duplicate node id "${n.id}"`);
    seen.add(n.id);
  }
  const edgeIds = new Set();
  for (const e of spec.edges) {
    if (e.id == null || e.id === "") throw new GraphError("edge-id", "every edge needs a non-empty id");
    if (edgeIds.has(e.id)) throw new GraphError("dup-id", `duplicate edge id "${e.id}"`);
    edgeIds.add(e.id);
    if (!seen.has(e.source)) throw new GraphError("dangling", `edge "${e.id}" source "${e.source}" does not exist`);
    if (!seen.has(e.target)) throw new GraphError("dangling", `edge "${e.id}" target "${e.target}" does not exist`);
    if (e.loop && !(e.maxIterations > 0)) {
      throw new GraphError("unbounded-loop", `loop edge "${e.id}" requires maxIterations > 0`);
    }
  }
  for (const n of spec.nodes) {
    if (n.parent !== undefined && !seen.has(n.parent)) {
      throw new GraphError("dangling", `node "${n.id}" parent "${n.parent}" does not exist`);
    }
  }
  // Parent chains must not cycle (a->parent->...->a).
  const parentOf = new Map(spec.nodes.map((n) => [n.id, n.parent]));
  for (const n of spec.nodes) {
    const trail = new Set([n.id]);
    let p = parentOf.get(n.id);
    while (p !== undefined) {
      if (trail.has(p)) throw new GraphError("parent-cycle", `containment cycle through "${n.id}"`);
      trail.add(p);
      p = parentOf.get(p);
    }
  }
  return spec;
}

export class Store {
  constructor(spec = {}) {
    const s = validateSpec(normalizeSpec(spec));
    this.nodes = new Map(s.nodes.map((n) => [n.id, n]));
    this.edges = new Map(s.edges.map((e) => [e.id, e]));
    /** Bumped by every successful mutation. Lets a reader memoize derived work against
     *  "has the graph changed since I last looked?" without diffing spec() (Mode B's
     *  per-frame replay is the caller this exists for). */
    this.rev = 0;
  }

  node(id) { return this.nodes.get(id); }
  edge(id) { return this.edges.get(id); }
  hasNode(id) { return this.nodes.has(id); }

  children(id) {
    const out = [];
    for (const n of this.nodes.values()) if (n.parent === id) out.push(n);
    return out;
  }

  spec() {
    // Only add a `data` key when one exists — an explicit `data: undefined` would
    // survive here but not a JSON round-trip (snapshot()), breaking round-trip equality.
    return {
      nodes: [...this.nodes.values()].map((n) => (n.data ? { ...n, data: { ...n.data } } : { ...n })),
      edges: [...this.edges.values()].map((e) => (e.data ? { ...e, data: { ...e.data } } : { ...e })),
    };
  }

  /** Structural clone for snapshot-per-step seek (D8/G2). */
  snapshot() { return JSON.parse(JSON.stringify(this.spec())); }

  restore(snap) {
    const s = validateSpec(normalizeSpec(snap));
    this.nodes = new Map(s.nodes.map((n) => [n.id, n]));
    this.edges = new Map(s.edges.map((e) => [e.id, e]));
    this.rev++;
  }

  // ---- mutations (validated against the *resulting* spec) ----

  addNode(node) {
    const n = pick(node, NODE_FIELDS);
    if (this.nodes.has(n.id)) throw new GraphError("dup-id", `duplicate node id "${n.id}"`);
    if (n.parent !== undefined && !this.nodes.has(n.parent)) {
      throw new GraphError("dangling", `node "${n.id}" parent "${n.parent}" does not exist`);
    }
    if (n.id == null || n.id === "") throw new GraphError("node-id", "every node needs a non-empty id");
    this.nodes.set(n.id, n);
    this.rev++;
    return n;
  }

  addEdge(edge) {
    const e = pick(edge, EDGE_FIELDS);
    if (this.edges.has(e.id)) throw new GraphError("dup-id", `duplicate edge id "${e.id}"`);
    if (!this.nodes.has(e.source)) throw new GraphError("dangling", `edge "${e.id}" source "${e.source}" does not exist`);
    if (!this.nodes.has(e.target)) throw new GraphError("dangling", `edge "${e.id}" target "${e.target}" does not exist`);
    if (e.loop && !(e.maxIterations > 0)) throw new GraphError("unbounded-loop", `loop edge "${e.id}" requires maxIterations > 0`);
    this.edges.set(e.id, e);
    this.rev++;
    return e;
  }

  removeNode(id) {
    if (!this.nodes.has(id)) throw new GraphError("missing", `node "${id}" does not exist`);
    const doomed = new Set([id]);
    let grew = true; // remove descendants transitively
    while (grew) {
      grew = false;
      for (const n of this.nodes.values()) {
        if (n.parent !== undefined && doomed.has(n.parent) && !doomed.has(n.id)) { doomed.add(n.id); grew = true; }
      }
    }
    for (const e of [...this.edges.values()]) {
      if (doomed.has(e.source) || doomed.has(e.target)) this.edges.delete(e.id);
    }
    for (const d of doomed) this.nodes.delete(d);
    this.rev++;
    return doomed;
  }

  removeEdge(id) {
    if (!this.edges.has(id)) throw new GraphError("missing", `edge "${id}" does not exist`);
    this.edges.delete(id);
    this.rev++;
  }

  update(id, patch) {
    const n = this.nodes.get(id);
    const e = this.edges.get(id);
    const t = n || e;
    if (!t) throw new GraphError("missing", `"${id}" does not exist`);
    const p = pick(patch, n ? NODE_FIELDS : EDGE_FIELDS);
    // Reference fields get the same guards the other mutations apply, checked against the
    // RESULTING record and BEFORE anything is written, so a rejected patch leaves the
    // store untouched. Without this an update could plant a dangling endpoint (the edge
    // silently vanishes from the view and any later restore() throws) or a containment
    // cycle (which the view's parent walks blow up on).
    if (n && p.parent !== undefined) {
      if (!this.nodes.has(p.parent)) {
        throw new GraphError("dangling", `node "${id}" parent "${p.parent}" does not exist`);
      }
      const trail = new Set([id]);
      for (let cur = p.parent; cur !== undefined; cur = this.nodes.get(cur)?.parent) {
        if (trail.has(cur)) throw new GraphError("parent-cycle", `containment cycle through "${id}"`);
        trail.add(cur);
      }
    }
    if (e) {
      for (const k of ["source", "target"]) {
        if (p[k] !== undefined && !this.nodes.has(p[k])) {
          throw new GraphError("dangling", `edge "${id}" ${k} "${p[k]}" does not exist`);
        }
      }
    }
    for (const [k, v] of Object.entries(p)) {
      if (k === "id") continue;
      if (k === "data") t.data = { ...t.data, ...v };
      else t[k] = v;
    }
    this.rev++;
    return t;
  }

  /**
   * condense(ids, newNodeSpec) — merge N nodes into one (D6).
   * Guards: convexity (no path may leave the set and re-enter) — G4.
   * Redirected edges dedupe with weights.
   */
  condense(ids, newNode) {
    const S = new Set(ids);
    for (const id of S) if (!this.nodes.has(id)) throw new GraphError("missing", `node "${id}" does not exist`);
    if (this.nodes.has(newNode.id)) throw new GraphError("dup-id", `duplicate node id "${newNode.id}"`);
    // Children of condensed nodes are removed with them (a condensed container swallows
    // its substeps), so the set that actually disappears is the containment closure of
    // `ids`. Convexity and edge redirection must both work off THAT set: a boundary edge
    // landing on a swallowed child is as much a boundary edge as one landing on the
    // container, and would otherwise be deleted without a replacement.
    const closure = containmentClosure(this, S);
    if (!isConvex(this, closure)) {
      throw new GraphError("non-convex", `condense set [${ids.join(", ")}] is not convex: a path leaves the set and re-enters`);
    }
    // The merged node inherits the common parent of the nodes as *named* (a swallowed
    // child's parent is inside the set and would only ever read as "mixed").
    const parents = new Set([...S].map((id) => this.nodes.get(id).parent));
    const parent = parents.size === 1 ? [...parents][0] : undefined;

    const doomedEdges = [];
    const redirected = new Map(); // key source->target => {edge, weight}
    for (const e of this.edges.values()) {
      const sIn = closure.has(e.source), tIn = closure.has(e.target);
      if (!sIn && !tIn) continue;
      doomedEdges.push(e.id);
      if (sIn && tIn) continue; // internal edge disappears
      const src = sIn ? newNode.id : e.source;
      const tgt = tIn ? newNode.id : e.target;
      const key = `${src} ${tgt}`;
      const prev = redirected.get(key);
      if (prev) prev.weight += e.weight || 1;
      else redirected.set(key, { proto: e, src, tgt, weight: e.weight || 1 });
    }
    // Everything below here mutates. Check the adds' preconditions FIRST — a throw between
    // the deletes and the adds would leave the store permanently half-condensed (the
    // caller's promise rejects, but the graph is already gone).
    const mergedSpec = { parent, ...newNode };
    if (mergedSpec.id == null || mergedSpec.id === "") throw new GraphError("node-id", "every node needs a non-empty id");
    if (mergedSpec.parent !== undefined && (!this.nodes.has(mergedSpec.parent) || closure.has(mergedSpec.parent))) {
      throw new GraphError("dangling", `node "${mergedSpec.id}" parent "${mergedSpec.parent}" does not exist`);
    }
    const doomedEdgeIds = new Set(doomedEdges);
    for (const { proto } of redirected.values()) {
      const id = `${proto.id}~${newNode.id}`;
      if (this.edges.has(id) && !doomedEdgeIds.has(id)) throw new GraphError("dup-id", `duplicate edge id "${id}"`);
    }

    for (const id of doomedEdges) this.edges.delete(id);
    const removedNodes = new Set();
    for (const id of S) {
      if (!this.nodes.has(id)) { removedNodes.add(id); continue; } // already gone as a descendant
      for (const d of this.removeNode(id)) removedNodes.add(d);
    }

    const merged = this.addNode(mergedSpec);
    const newEdges = [];
    for (const { proto, src, tgt, weight } of redirected.values()) {
      const e = this.addEdge({
        ...proto,
        id: `${proto.id}~${newNode.id}`,
        source: src,
        target: tgt,
        weight: weight > 1 ? weight : undefined,
      });
      newEdges.push(e);
    }
    return { merged, removedNodes: [...removedNodes], newEdges };
  }

  /**
   * split(id, { nodes, edges = [] }) — D6 inverse: one node becomes N (M2).
   * `id` is removed; `nodes` are the replacement specs (parent inherited from `id`
   * unless a node names its own); `edges` are internal wiring among ONLY those new
   * nodes. Entry nodes (no internal in-edge) inherit every former incoming edge of
   * `id`; exit nodes (no internal out-edge) inherit every former outgoing edge —
   * fan-out/fan-in when there's more than one, by the "first keeps the id, clones
   * get `id:targetId`" rule below. Weights pass through unchanged (no aggregation —
   * unlike condense, nothing is merging). Self-loops on `id` are dropped: there's no
   * single sensible new endpoint for them to redirect to on both sides at once.
   * All guards run BEFORE any mutation (dup-id / split-edge can't half-delete `id`).
   */
  split(id, parts = {}) {
    const { nodes: newNodes = [], edges: internalEdges = [] } = parts;
    if (!this.nodes.has(id)) throw new GraphError("missing", `node "${id}" does not exist`);
    if (this.children(id).length > 0) {
      throw new GraphError("split-container", `node "${id}" is a container (has children) and cannot be split`);
    }
    if (!newNodes.length) throw new GraphError("missing", "split requires at least one new node");
    const splitNode = this.nodes.get(id);

    // ---- validate the replacement node specs ----
    const specs = newNodes.map((n) => pick(n, NODE_FIELDS));
    const newIds = new Set();
    for (const n of specs) {
      if (n.id == null || n.id === "") throw new GraphError("node-id", "every node needs a non-empty id");
      if (newIds.has(n.id)) throw new GraphError("dup-id", `duplicate node id "${n.id}" in split`);
      if (this.nodes.has(n.id) && n.id !== id) throw new GraphError("dup-id", `duplicate node id "${n.id}"`);
      newIds.add(n.id);
    }
    for (const n of specs) {
      if (n.parent === undefined) n.parent = splitNode.parent;
      if (n.parent === id) throw new GraphError("dangling", `node "${n.id}" parent "${id}" is being removed by split`);
      if (n.parent !== undefined && !this.nodes.has(n.parent) && !newIds.has(n.parent)) {
        throw new GraphError("dangling", `node "${n.id}" parent "${n.parent}" does not exist`);
      }
    }

    // ---- validate internal edges: both endpoints must be among the new nodes ----
    const edgeSpecs = internalEdges.map((e) => pick(e, EDGE_FIELDS));
    const internalIds = new Set();
    for (const e of edgeSpecs) {
      if (e.id == null || e.id === "") throw new GraphError("edge-id", "every edge needs a non-empty id");
      if (internalIds.has(e.id)) throw new GraphError("dup-id", `duplicate edge id "${e.id}" in split`);
      internalIds.add(e.id);
      if (!newIds.has(e.source) || !newIds.has(e.target)) {
        throw new GraphError("split-edge", `split edge "${e.id}" must connect two of the split's new nodes`);
      }
    }

    // Entry = no internal in-edge; exit = no internal out-edge. A node with neither
    // (no internal edges at all) is both.
    const hasIncoming = new Set(edgeSpecs.map((e) => e.target));
    const hasOutgoing = new Set(edgeSpecs.map((e) => e.source));
    const allIds = specs.map((n) => n.id);
    const entryIds = allIds.filter((nid) => !hasIncoming.has(nid));
    const exitIds = allIds.filter((nid) => !hasOutgoing.has(nid));

    // ---- classify id's current incident edges (before anything is removed) ----
    const incoming = [], outgoing = [];
    const removedEdgeIds = [];
    for (const e of this.edges.values()) {
      const sHit = e.source === id, tHit = e.target === id;
      if (!sHit && !tHit) continue;
      removedEdgeIds.push(e.id);
      if (sHit && tHit) continue; // self-loop: dropped, not redirected either way
      if (tHit) incoming.push(e); else outgoing.push(e);
    }

    // ---- build the redirected clones (fan-out on the entry/exit side) ----
    const toAdd = []; // { id, proto, source, target }
    for (const e of incoming) {
      entryIds.forEach((tid, i) => {
        toAdd.push({ id: i === 0 ? e.id : `${e.id}:${tid}`, proto: e, source: e.source, target: tid });
      });
    }
    for (const e of outgoing) {
      exitIds.forEach((sid, i) => {
        toAdd.push({ id: i === 0 ? e.id : `${e.id}:${sid}`, proto: e, source: sid, target: e.target });
      });
    }

    // Every id that will exist in the store once this lands — checked BEFORE any
    // mutation runs, same discipline as condense(): a rejected split must not have
    // touched the store.
    const removedEdgeSet = new Set(removedEdgeIds);
    const finalIds = new Set(internalIds);
    for (const spec of toAdd) {
      if (finalIds.has(spec.id)) throw new GraphError("dup-id", `duplicate edge id "${spec.id}" produced by split`);
      finalIds.add(spec.id);
      if (this.edges.has(spec.id) && !removedEdgeSet.has(spec.id)) {
        throw new GraphError("dup-id", `duplicate edge id "${spec.id}"`);
      }
    }
    for (const e of edgeSpecs) {
      if (this.edges.has(e.id) && !removedEdgeSet.has(e.id)) {
        throw new GraphError("dup-id", `duplicate edge id "${e.id}"`);
      }
    }

    // ---- mutate: remove the split node (and its incident edges), add the rest ----
    this.removeNode(id);
    const added = specs.map((n) => this.addNode(n).id);
    const addedEdges = [];
    for (const e of edgeSpecs) addedEdges.push(this.addEdge(e));
    for (const spec of toAdd) {
      addedEdges.push(this.addEdge({ ...spec.proto, id: spec.id, source: spec.source, target: spec.target }));
    }
    return { added, addedEdges, removedEdges: removedEdgeIds };
  }
}

/**
 * The set of nodes a `condense(ids, …)` actually removes: `ids` plus every transitive
 * descendant, because removeNode() swallows children. condense() judges convexity and
 * redirects boundary edges on THIS set, so every caller that pre-flights those guards
 * (index.js's synchronous guard, condense-anim's phase-2 re-check) has to ask the same
 * question — asking it about the literal ids instead lets a container condense sail past
 * a guard and throw out of the choreography's async phase 2 later.
 */
export function containmentClosure(store, ids) {
  const closure = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of store.nodes.values()) {
      if (n.parent !== undefined && closure.has(n.parent) && !closure.has(n.id)) { closure.add(n.id); grew = true; }
    }
  }
  return closure;
}

/** Convexity check (G4): no path from inside S may leave S and come back. ~DFS from outside-successors of S. */
export function isConvex(store, S) {
  const out = new Map(); // adjacency
  for (const e of store.edges.values()) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
  }
  // Start from every node outside S reachable directly from S; if any walk re-enters S, not convex.
  const starts = [];
  for (const e of store.edges.values()) {
    if (S.has(e.source) && !S.has(e.target)) starts.push(e.target);
  }
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const v = stack.pop();
    if (S.has(v)) return false;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const w of out.get(v) || []) stack.push(w);
  }
  return true;
}
