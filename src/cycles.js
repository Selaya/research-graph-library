// Cycle breaking (D3): DFS back-edge detection with prefer-previous-reversal pinning.
// Reversal is bookkeeping for the ranking pass only — rendering restores true direction.

/**
 * Decide which edges to reverse so the graph is acyclic for layered ranking.
 * Explicit `loop: true` edges and previously-reversed (pinned) edges are reversed
 * up front — pinning stops an unrelated append from flipping a loop's side (D3);
 * a DFS then reverses any remaining back edges. Self-loops are ignored (the
 * renderer draws them as side arcs; they never enter ranking).
 *
 * @param {Array<{id:string}>} nodes
 * @param {Array<{id:string, source:string, target:string, loop?:boolean}>} edges
 * @param {Set<string>} pinned edge ids reversed by the previous layout pass
 * @returns {Set<string>} edge ids to reverse
 */
export function breakCycles(nodes, edges, pinned = new Set()) {
  const real = edges.filter((e) => e.source !== e.target);
  const preferred = new Set();
  for (const e of real) if (e.loop || pinned.has(e.id)) preferred.add(e.id);

  const attempt = (pre) => {
    const reversed = new Set(pre);
    const adj = new Map(nodes.map((n) => [n.id, []]));
    for (const e of real) {
      const [s, t] = reversed.has(e.id) ? [e.target, e.source] : [e.source, e.target];
      adj.get(s)?.push({ id: e.id, to: t, pre: reversed.has(e.id) });
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map(nodes.map((n) => [n.id, WHITE]));
    const cut = new Set(); // edges dropped from traversal (found as back edges)
    const visit = (u) => {
      color.set(u, GRAY);
      for (const a of adj.get(u) || []) {
        if (cut.has(a.id)) continue;
        const c = color.get(a.to);
        if (c === GRAY) {
          cut.add(a.id);
          // A back edge in its *effective* direction: if it was pre-reversed we
          // un-reverse it (double reversal = original direction, still a cut);
          // otherwise reverse it.
          if (a.pre) reversed.delete(a.id); else reversed.add(a.id);
        } else if (c === WHITE) visit(a.to);
      }
      color.set(u, BLACK);
    };
    for (const n of nodes) if (color.get(n.id) === WHITE) visit(n.id);
    return reversed;
  };

  let reversed = attempt(preferred);
  if (!isAcyclic(nodes, real, reversed)) reversed = attempt(new Set()); // pins conflicted; fall back to pure DFS
  // loop:true edges must stay tagged for styling/token semantics even if the
  // un-reverse path above touched them — force them reversed unless that breaks acyclicity.
  for (const e of real) {
    if (e.loop && !reversed.has(e.id)) {
      const withLoop = new Set(reversed).add(e.id);
      if (isAcyclic(nodes, real, withLoop)) reversed = withLoop;
    }
  }
  return reversed;
}

export function isAcyclic(nodes, edges, reversed = new Set()) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.source === e.target) continue;
    const [s, t] = reversed.has(e.id) ? [e.target, e.source] : [e.source, e.target];
    adj.get(s)?.push(t);
  }
  const state = new Map();
  const stack = [];
  const iter = (start) => {
    stack.push([start, 0]);
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, i] = top;
      const next = (adj.get(u) || [])[i];
      if (next === undefined) { state.set(u, 2); stack.pop(); continue; }
      top[1]++;
      const c = state.get(next);
      if (c === 1) return false;
      if (c === undefined) { state.set(next, 1); stack.push([next, 0]); }
    }
    return true;
  };
  for (const n of nodes) {
    if (state.get(n.id) === undefined && !iter(n.id)) return false;
  }
  return true;
}
