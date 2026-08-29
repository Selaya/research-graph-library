// Public API. One-way data flow, once per mutation:
//   store -> view -> sizeNode -> layout(pinnedReversals) -> styleCommit -> scene.commit
//   -> anchored viewport correction (D10)
// Everything animated goes through the single scene/ticker, so an overlapping mutation
// cancels-and-retargets instead of queueing or double-writing (D9).

import { emitter } from "./events.js";
import { Store, GraphError } from "./store.js";
import { sizeNode } from "./measure.js";
import { layout } from "./layout.js";
import { createTicker, EASE, prefersReducedMotion } from "./anim.js";
import { createScene } from "./scene.js";
import { createRenderer } from "./render.js";
import { createViewport } from "./viewport.js";
import { injectStyles } from "./styles.js";

export const version = "0.1.0";

const EASINGS = {
  "linear": EASE.linear,
  "cubic-out": EASE.cubicOut,
  "cubic-in-out": EASE.cubicInOut,
  "overshoot": EASE.overshoot,
};

/** Awaitable + cancelable handle handed back by every mutation (§5.3). */
function thenable(promise, cancel) {
  const p = Promise.resolve(promise);
  return {
    then: (a, b) => p.then(a, b),
    catch: (b) => p.catch(b),
    finally: (f) => p.finally(f),
    cancel,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function resolveEl(el, doc) {
  if (typeof el === "string") {
    const found = doc && doc.querySelector ? doc.querySelector(el) : null;
    if (!found) throw new GraphError("no-mount", `mount target "${el}" not found`);
    return found;
  }
  if (!el || typeof el.appendChild !== "function") throw new GraphError("no-mount", "mount needs an element or selector");
  return el;
}

export function mount(el, spec = {}, opts = {}) {
  const doc = (el && el.ownerDocument) || (typeof document !== "undefined" ? document : null);
  const root = resolveEl(el, doc);
  injectStyles(root.ownerDocument || doc);

  const store = new Store(spec);
  const bus = emitter();
  const ticker = createTicker();
  const scene = createScene(ticker);
  const renderer = createRenderer(root, root.ownerDocument || doc);
  const viewport = createViewport(renderer.svg, renderer.viewportG, ticker);

  root.classList.add("smv-root");
  root.setAttribute("data-smv-theme", opts.theme || "auto");

  const layoutOpts = { dir: "LR", ...(opts.layout || {}) };
  const anim = opts.animation || {};
  const reduced = prefersReducedMotion();
  // G9: reduced motion shrinks durations, it never removes steps.
  const baseDuration = reduced ? 1 : (anim.duration ?? 350);
  const easing = (typeof anim.easing === "function" ? anim.easing : EASINGS[anim.easing]) || EASE.cubicOut;

  let styleFn = null;
  let pinnedReversals = new Set();   // FAS pinning persisted across layouts (D3)
  let last = null;                   // previous layout result
  let transition = null;
  let batching = 0;
  let batchDefer = null;
  let batchFocal = null;
  let destroyed = false;

  scene.onFrame((visual) => renderer.frame(visual));

  function view() {
    const sizes = {};
    const nodes = [];
    for (const n of store.nodes.values()) {
      const s = sizeNode(n);
      sizes[n.id] = s;
      nodes.push({ id: n.id, w: s.w, h: s.h, parent: n.parent });
    }
    const edges = [];
    for (const e of store.edges.values()) {
      edges.push({ id: e.id, source: e.source, target: e.target, loop: e.loop, maxIterations: e.maxIterations });
    }
    return { nodes, edges, sizes };
  }

  /** Entering nodes bloom from a neighbour's previous position rather than popping in. */
  function enterFromFor(res) {
    if (!last) return undefined;
    const out = {};
    for (const id of Object.keys(res.nodes)) {
      if (last.nodes[id]) continue;
      for (const e of store.edges.values()) {
        const other = e.target === id ? e.source : e.source === id ? e.target : null;
        if (other && last.nodes[other]) { out[id] = { x: last.nodes[other].x, y: last.nodes[other].y }; break; }
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  function relayout({ focal = null, duration } = {}) {
    if (destroyed) return thenable(Promise.resolve({ canceled: true }), () => {});
    const v = view();
    const res = layout(v, { ...layoutOpts, pinnedReversals });
    pinnedReversals = res.reversedEdgeIds || new Set();

    renderer.styleCommit({
      nodes: store.nodes, edges: store.edges,
      reversed: pinnedReversals, style: styleFn, sizes: v.sizes,
    });

    const dur = reduced ? 1 : (duration ?? baseDuration);
    const prev = last;
    transition = scene.commit({ nodes: res.nodes, edges: res.edges }, {
      duration: dur, easing, enterFrom: enterFromFor(res),
    });
    last = res;

    // D10 — anchored, not auto-fit: hold the focal point still in screen space; only
    // refit when the user has never moved AND the new content lands outside the pane.
    if (prev) {
      const before = focal && prev.nodes[focal] ? prev.nodes[focal] : centerOf(prev.bounds);
      const after = focal && res.nodes[focal] && prev.nodes[focal] ? res.nodes[focal] : centerOf(res.bounds);
      viewport.anchor(before, after, dur);
      if (!viewport.userMoved && !viewport.contains(res.bounds)) viewport.fit(res.bounds, 24, dur > 1);
    }

    bus.emit("commit", {
      nodes: res.nodes, edges: res.edges, bounds: res.bounds,
      reversedEdgeIds: pinnedReversals, focal, duration: dur, transition,
    });
    return handle(transition);
  }

  function handle(tr) {
    return thenable(tr.promise, () => tr.cancel());
  }

  /** Inside batch(): one relayout for many ops, one shared awaitable. */
  function commitOrDefer(focal) {
    if (batching > 0) {
      if (!batchDefer) batchDefer = deferred();
      if (focal && !batchFocal) batchFocal = focal;
      const d = batchDefer;
      return thenable(d.promise, () => transition && transition.cancel());
    }
    return relayout({ focal });
  }

  const g = {
    version,
    el: root,
    ticker,
    scene,
    renderer,
    viewport,

    on(type, fn) { return bus.on(type, fn); },
    off(type, fn) { bus.off(type, fn); },

    node(id) { return store.node(id); },
    edge(id) { return store.edge(id); },
    spec() { return store.spec(); },
    bounds() { return last && last.bounds; },
    layoutResult() { return last; },

    addNode(node, o = {}) {
      const n = store.addNode(node);
      bus.emit("add", { kind: "node", id: n.id, item: n });
      if (o.after != null) {
        const e = store.addEdge({ id: `e:${o.after}->${n.id}`, source: o.after, target: n.id });
        bus.emit("add", { kind: "edge", id: e.id, item: e });
      }
      return commitOrDefer(n.id);
    },

    addEdge(edge) {
      const e = store.addEdge(edge);
      bus.emit("add", { kind: "edge", id: e.id, item: e });
      return commitOrDefer(e.target);
    },

    removeNode(id) {
      const edgesBefore = new Set(store.edges.keys());
      const removed = store.removeNode(id);
      for (const r of removed) bus.emit("remove", { kind: "node", id: r });
      for (const eid of edgesBefore) {
        if (store.edges.has(eid)) continue;
        pinnedReversals.delete(eid);
        bus.emit("remove", { kind: "edge", id: eid });
      }
      return commitOrDefer(null);
    },

    removeEdge(id) {
      store.removeEdge(id);
      pinnedReversals.delete(id);
      bus.emit("remove", { kind: "edge", id });
      return commitOrDefer(null);
    },

    update(id, patch) {
      const item = store.update(id, patch);
      bus.emit("update", { id, patch, item });
      return commitOrDefer(store.hasNode(id) ? id : null);
    },

    batch(fn) {
      batching++;
      try { fn(g); } finally { batching--; }
      if (batching > 0) return thenable(Promise.resolve({ canceled: false }), () => {});
      const d = batchDefer, focal = batchFocal;
      batchDefer = null; batchFocal = null;
      const tr = relayout({ focal });
      if (d) d.resolve(tr);
      return tr;
    },

    /** User style functions set --smv-* custom properties only (D7). */
    style(fn) {
      styleFn = typeof fn === "function" ? fn : null;
      const v = view();
      renderer.styleCommit({ nodes: store.nodes, edges: store.edges, reversed: pinnedReversals, style: styleFn, sizes: v.sizes });
      return g;
    },

    theme(t) { root.setAttribute("data-smv-theme", t); return g; },

    layout(o) {
      if (o) Object.assign(layoutOpts, o);
      return relayout({});
    },

    fitView(o = {}) {
      if (last) viewport.fit(last.bounds, o.pad ?? 24, o.animate !== false);
      viewport.userMoved = false;
      return g;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      scene.destroy();
      viewport.destroy();
      renderer.destroy();
      ticker.destroy();
      root.classList.remove("smv-root");
      root.removeAttribute("data-smv-theme");
    },
  };

  // Initial paint: land immediately (nothing to tween from), then fit once (D10).
  relayout({ duration: 0 });
  viewport.fit(last.bounds, 24, false);

  return g;
}

export default { mount, version };
