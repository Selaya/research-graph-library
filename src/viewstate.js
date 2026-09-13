// D5 — expand/collapse + meta-edges. Pure (no DOM): turns the flat store spec into the
// `view` that the frozen layout() seam consumes, hiding collapsed subtrees and
// re-attaching boundary edges as deduped meta-edges.
//
// Two remaps happen here, and they are NOT the same thing:
//   1. hidden endpoint -> nearest visible ancestor. The edge loses its identity and is
//      aggregated into `meta:<src>-><tgt>` with a weight.
//   2. endpoint that IS an expanded container -> that container's interior entry/exit
//      child. The edge KEEPS its id (so it just tweens across an expand), and it is what
//      makes dagre usable at all: dagre throws on any edge incident to a cluster node.

import { sizeNode, textWidth } from "./measure.js";

const BADGE_PAD = 10; // gutter reserved next to a collapsed container's ×N badge

/**
 * `measureOf` (F22/F23) is a live getter for `opts.layout.measure` — the hook that lets a
 * preset reserve room for the chrome it parks on a node. Absent (every call before this
 * existed) it measures exactly as it always did.
 */
export function createViewState(store, measureOf) {
  const collapsed = new Set();
  const pendingCollapse = new Set(); // spec said collapsed:true before children existed
  const seen = new Set();

  const parentOf = (id) => {
    const n = store.nodes.get(id);
    return n ? n.parent : undefined;
  };

  function childIndex() {
    const kids = new Map();
    for (const n of store.nodes.values()) {
      if (n.parent === undefined || !store.nodes.has(n.parent)) continue;
      if (!kids.has(n.parent)) kids.set(n.parent, []);
      kids.get(n.parent).push(n.id);
    }
    return kids;
  }

  /** Fold spec-level `collapsed:true` in once per node, and forget dead ids. */
  function sync() {
    for (const n of store.nodes.values()) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.collapsed === true) pendingCollapse.add(n.id);
    }
    for (const id of [...seen]) {
      if (store.nodes.has(id)) continue;
      seen.delete(id); pendingCollapse.delete(id); collapsed.delete(id);
    }
    if (pendingCollapse.size) {
      const kids = childIndex();
      for (const id of [...pendingCollapse]) {
        if (!kids.has(id)) continue; // children may still be on their way in
        collapsed.add(id);
        pendingCollapse.delete(id);
      }
    }
  }

  function hasChildren(id) {
    for (const n of store.nodes.values()) if (n.parent === id) return true;
    return false;
  }

  /** Containment depth, 0 for a root node. Guarded the same way as every other
   *  parent-chain walk here in case a store gets mutilated past validateSpec (see the
   *  attach() comment below). */
  function depthOf(id) {
    let d = 0, p = parentOf(id);
    const seenUp = new Set([id]);
    while (p !== undefined && store.nodes.has(p) && !seenUp.has(p)) { d++; seenUp.add(p); p = parentOf(p); }
    return d;
  }

  function visibleWith(id) {
    if (!store.nodes.has(id)) return false;
    const seenUp = new Set([id]);
    let p = parentOf(id);
    while (p !== undefined && store.nodes.has(p) && !seenUp.has(p)) {
      if (collapsed.has(p)) return false;
      seenUp.add(p);
      p = parentOf(p);
    }
    return true;
  }

  function visibleAncestor(id) {
    const seenUp = new Set();
    let cur = id;
    while (cur !== undefined && store.nodes.has(cur) && !seenUp.has(cur)) {
      if (visibleWith(cur)) return cur;
      seenUp.add(cur);
      cur = parentOf(cur);
    }
    return null;
  }

  function view() {
    sync();
    const kids = childIndex();
    const vset = new Set();
    const visible = [];
    for (const n of store.nodes.values()) {
      if (!visibleWith(n.id)) continue;
      visible.push(n);
      vset.add(n.id);
    }

    const descendants = (id) => {
      let c = 0;
      const stack = [...(kids.get(id) || [])];
      while (stack.length) {
        const x = stack.pop();
        c++;
        for (const k of kids.get(x) || []) stack.push(k);
      }
      return c;
    };

    const nodes = [];
    const sizes = {};
    // F22/F23 — the measure hooks see the whole node set (a rollup chip's text is not on
    // the node itself), with one cache shared across the pass.
    const measure = typeof measureOf === "function" ? measureOf() : null;
    const mctx = { nodes: store.nodes, cache: new Map() };
    for (const n of visible) {
      // F33 — `container: true` on the spec makes a node a container BEFORE its first
      // child exists: it draws as a header-only box and reaches the solver flagged, instead
      // of masquerading as a plain leaf until something parents to it.
      const hasKids = kids.has(n.id);
      const container = hasKids || n.container === true;
      const isCollapsed = hasKids && collapsed.has(n.id);
      const base = sizeNode(n, measure, measure && mctx);
      const count = isCollapsed ? descendants(n.id) : 0;
      // A collapsed container is a plain node that also has to carry its ×N badge.
      const w = isCollapsed ? base.w + Math.ceil(textWidth(`×${count}`)) + BADGE_PAD : base.w;
      sizes[n.id] = { w, h: base.h, reserve: base.reserve || 0 };
      nodes.push({
        ...n,
        id: n.id, w, h: base.h,
        parent: n.parent !== undefined && vset.has(n.parent) ? n.parent : undefined,
        container: container || undefined,
        empty: (container && !hasKids) || undefined,
        collapsed: isCollapsed || undefined,
        count: isCollapsed ? count : undefined,
        depth: depthOf(n.id),
      });
    }

    // --- attachment points: an expanded container hands its edges to a real child ---
    const attachCache = new Map();
    /** The direct child of `cid` that `x` lives under, or undefined if x is outside. */
    const branchOf = (x, cid) => {
      const seenUp = new Set();
      let c = x;
      while (c !== undefined && store.nodes.has(c) && !seenUp.has(c)) {
        if (parentOf(c) === cid) return c;
        seenUp.add(c);
        c = parentOf(c);
      }
      return undefined;
    };
    function attach(id, kind) {
      const key = `${id}\0${kind}`;
      if (attachCache.has(key)) return attachCache.get(key);
      // Seed the cache BEFORE recursing. Every other walk in this file (visibleWith,
      // visibleAncestor, depthOf, branchOf) carries a `seen` guard; this is the one that
      // recurses through `kids`, so a malformed containment cycle would otherwise recurse
      // until the stack blows — an unrecoverable crash for the whole instance instead of a
      // degraded picture. run.js's twin of this function guards it the same way.
      attachCache.set(key, id);
      let out = id;
      const list = (kids.get(id) || []).filter((c) => vset.has(c));
      if (list.length && !collapsed.has(id)) {
        // entry = a branch nothing inside points at; exit = a branch that points at nothing inside.
        const blocked = new Set();
        for (const e of store.edges.values()) {
          const bs = branchOf(e.source, id), bt = branchOf(e.target, id);
          if (bs === undefined || bt === undefined || bs === bt) continue;
          blocked.add(kind === "entry" ? bt : bs);
        }
        const pick = list.find((c) => !blocked.has(c));
        out = attach(pick !== undefined ? pick : (kind === "entry" ? list[0] : list[list.length - 1]), kind);
      }
      attachCache.set(key, out);
      return out;
    }

    const edges = [];
    const metaEdges = new Map();  // metaId -> {sources, weight}
    const metaView = new Map();   // metaId -> the view edge object
    const loopMax = new Map();    // containerId -> deepest maxIterations swallowed

    for (const e of store.edges.values()) {
      const s0 = visibleAncestor(e.source);
      const t0 = visibleAncestor(e.target);
      if (s0 == null || t0 == null) continue;
      const hidden = s0 !== e.source || t0 !== e.target;
      if (hidden && s0 === t0) {
        // Interior edge: it vanishes with the collapse. A bounded loop leaves a badge (D3).
        if (e.loop && e.maxIterations > 0) loopMax.set(s0, Math.max(loopMax.get(s0) ?? 0, e.maxIterations));
        continue;
      }
      const source = attach(s0, "exit");
      const target = attach(t0, "entry");
      if (!hidden) {
        edges.push({ ...e, source, target });
        continue;
      }
      const id = `meta:${s0}->${t0}`;
      let rec = metaEdges.get(id);
      if (!rec) {
        rec = { sources: [], weight: 0 };
        metaEdges.set(id, rec);
        const ve = { id, source, target, meta: true, from: s0, to: t0, weight: 0 };
        metaView.set(id, ve);
        edges.push(ve);
      }
      rec.sources.push(e.id);
      rec.weight = rec.sources.length;
      const ve = metaView.get(id);
      ve.weight = rec.weight;
      if (e.loop) {
        ve.loop = true;
        ve.maxIterations = Math.max(ve.maxIterations || 0, e.maxIterations || 0);
      }
      if (e.data && !ve.data) ve.data = e.data;
      // A meta-edge standing in for a single hidden edge keeps its label; at weight>1
      // the renderer drops it (the weight badge carries the story instead).
      if (e.label != null && ve.label == null) ve.label = e.label;
    }

    const loopBadges = [...loopMax.entries()].map(([id, max]) => ({ id, max }));
    return { nodes, edges, sizes, meta: { metaEdges, loopBadges } };
  }

  /** Mutate the collapsed set only — index.js owns the relayout. Returns true if it changed.
   *  Both also settle the "spec said collapsed:true before its children existed" intent:
   *  expand() drops it (so the stale spec flag can't snap the container shut when the
   *  children finally land), collapse() takes it on when there is nothing to fold yet. */
  function expand(id) {
    pendingCollapse.delete(id);
    if (!collapsed.has(id)) return false;
    collapsed.delete(id);
    return true;
  }
  function collapse(id) {
    if (collapsed.has(id)) return false;
    if (!hasChildren(id)) {
      if (store.nodes.has(id)) pendingCollapse.add(id);
      return false;
    }
    collapsed.add(id);
    return true;
  }

  /** All container ids (irrespective of visibility/collapsed state), containment-depth
   *  order — parents before their own nested containers. Stable-sorted, so siblings keep
   *  spec order (Array#sort is a stable sort in every engine we run on). */
  function containers() {
    const kids = childIndex();
    return [...store.nodes.keys()]
      .filter((id) => kids.has(id))
      .sort((a, b) => depthOf(a) - depthOf(b));
  }

  sync(); // seed `collapsed` from the spec before anyone reads the set

  return {
    collapsed,
    isContainer(id) { sync(); return hasChildren(id); },
    isVisible(id) { sync(); return visibleWith(id); },
    visibleAncestor(id) { sync(); return visibleAncestor(id); },
    expand(id) { sync(); return expand(id); },
    collapse(id) { sync(); return collapse(id); },
    containers() { sync(); return containers(); },
    /** Expand/collapse every container in one pass, parents-first; returns the ids that
     *  actually changed so index.js can drive a single relayout with the right set. */
    expandAll() {
      sync();
      const changed = [];
      for (const id of containers()) if (expand(id)) changed.push(id);
      return changed;
    },
    collapseAll() {
      sync();
      const changed = [];
      for (const id of containers()) if (collapse(id)) changed.push(id);
      return changed;
    },
    view,
  };
}
