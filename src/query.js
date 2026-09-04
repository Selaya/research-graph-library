// Query sugar over a Store (M2). PURE — no DOM, no animation, just reads.

/** Same cloning discipline as store.spec(): callers never get a live ref they can
 *  mutate to corrupt the store. Exported so index.js's singular g.node()/g.edge() can
 *  return copies too — the same contract the README already promises for the whole
 *  query surface (M2 finding: they used to hand back the live store record). */
export function cloneItem(item) {
  return item.data ? { ...item, data: { ...item.data } } : { ...item };
}

function matchesObject(item, obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (k === "data") {
      const d = item.data || {};
      for (const [dk, dv] of Object.entries(v || {})) {
        if (d[dk] !== dv) return false;
      }
      continue;
    }
    if (item[k] !== v) return false;
  }
  return true;
}

function toPredicate(filter) {
  if (filter == null) return () => true;
  if (typeof filter === "function") return filter;
  return (item) => matchesObject(item, filter);
}

/**
 * makeQuery(store) -> { nodes(filter?), edges(filter?), children(id), descendants(id), roots() }
 * `filter` is a predicate `(item) => bool` OR a match object: top-level keys compare
 * `===` against the spec item, a `data` key matches shallowly against `item.data`.
 */
export function makeQuery(store) {
  function nodes(filter) {
    const pred = toPredicate(filter);
    const out = [];
    for (const n of store.nodes.values()) if (pred(n)) out.push(cloneItem(n));
    return out;
  }

  function edges(filter) {
    const pred = toPredicate(filter);
    const out = [];
    for (const e of store.edges.values()) if (pred(e)) out.push(cloneItem(e));
    return out;
  }

  function children(id) {
    const out = [];
    for (const n of store.nodes.values()) if (n.parent === id) out.push(cloneItem(n));
    return out;
  }

  /** Every nested descendant (grandchildren included), never `id` itself. */
  function descendants(id) {
    const out = [];
    const stack = [];
    for (const n of store.nodes.values()) if (n.parent === id) stack.push(n.id);
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = store.node(cur);
      if (n) out.push(cloneItem(n));
      for (const c of store.nodes.values()) if (c.parent === cur) stack.push(c.id);
    }
    return out;
  }

  function roots() {
    const out = [];
    for (const n of store.nodes.values()) if (n.parent === undefined) out.push(cloneItem(n));
    return out;
  }

  return { nodes, edges, children, descendants, roots };
}
