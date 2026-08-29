// Public API. One-way data flow, once per mutation:
//   store -> viewstate.view() -> layout(pinnedReversals) -> styleCommit -> scene.commit
//   -> anchored viewport correction (D10)
// Everything animated goes through the single scene/ticker, so an overlapping mutation
// cancels-and-retargets instead of queueing or double-writing (D9).

import { emitter } from "./events.js";
import { Store, GraphError, isConvex } from "./store.js";
import { layout } from "./layout.js";
import { createTicker, EASE, prefersReducedMotion } from "./anim.js";
import { createScene } from "./scene.js";
import { createRenderer } from "./render.js";
import { createViewport } from "./viewport.js";
import { injectStyles } from "./styles.js";
import { createViewState } from "./viewstate.js";
import { runCondense } from "./condense-anim.js";
import { createRunTransport } from "./run-transport.js";
import { createRunRender } from "./run-render.js";
import { createStoryboard } from "./storyboard.js";
import { createTransport } from "./transport.js";
import { applyPipelinePreset } from "./preset-pipeline.js";

export const version = "0.1.0";

/** What a non-run storyboard step is worth on the transport's cumulative timeline. */
const NOMINAL_STEP_MS = 400;

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
  const vs = createViewState(store);
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
  let batchExtra = null;
  let destroyed = false;

  scene.onFrame((visual) => renderer.frame(visual));

  /** Entering nodes bloom from a neighbour's previous position rather than popping in. */
  function enterFromFor(res, v) {
    if (!last) return {};
    const out = {};
    for (const id of Object.keys(res.nodes)) {
      if (last.nodes[id]) continue;
      for (const e of v.edges) {
        const other = e.target === id ? e.source : e.source === id ? e.target : null;
        if (other && last.nodes[other]) { out[id] = { x: last.nodes[other].x, y: last.nodes[other].y }; break; }
      }
    }
    return out;
  }

  /** enterFrom/exitTo may be objects or (layout, prevLayout) => object, and stack in a batch. */
  const asList = (m) => (m == null ? [] : Array.isArray(m) ? m : [m]);
  function resolveMaps(list, res, prev) {
    const out = {};
    for (const m of list) Object.assign(out, (typeof m === "function" ? m(res, prev) : m) || {});
    return out;
  }
  const orUndef = (o) => (Object.keys(o).length ? o : undefined);

  function relayout({ focal = null, duration, enterFrom, exitTo, easeOverride } = {}) {
    if (destroyed) return thenable(Promise.resolve({ canceled: true }), () => {});
    const v = vs.view();
    const res = layout(v, { ...layoutOpts, pinnedReversals });
    pinnedReversals = res.reversedEdgeIds || new Set();

    // Containers get their real (dagre-computed) box here, so labels truncate to it.
    const sizes = { ...v.sizes };
    for (const [id, r] of Object.entries(res.nodes)) sizes[id] = { w: r.w, h: r.h };
    renderer.styleCommit({
      nodes: v.nodes, edges: v.edges,
      reversed: pinnedReversals, style: styleFn, sizes,
    });

    const dur = reduced ? 1 : (duration ?? baseDuration);
    const prev = last;
    transition = scene.commit({ nodes: res.nodes, edges: res.edges }, {
      duration: dur, easing,
      enterFrom: orUndef({ ...enterFromFor(res, v), ...resolveMaps(asList(enterFrom), res, prev) }),
      exitTo: orUndef(resolveMaps(asList(exitTo), res, prev)),
      easeOverride,
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
      reversedEdgeIds: pinnedReversals, meta: v.meta, focal, duration: dur, transition,
    });
    return handle(transition);
  }

  function handle(tr) {
    return thenable(tr.promise, () => tr.cancel());
  }

  /** Inside batch(): one relayout for many ops, one shared awaitable. */
  function commitOrDefer(focal, extra) {
    if (batching > 0) {
      if (!batchDefer) batchDefer = deferred();
      if (focal && !batchFocal) batchFocal = focal;
      if (extra) {
        if (!batchExtra) batchExtra = { enterFrom: [], exitTo: [], easeOverride: {} };
        batchExtra.enterFrom.push(...asList(extra.enterFrom));
        batchExtra.exitTo.push(...asList(extra.exitTo));
        Object.assign(batchExtra.easeOverride, extra.easeOverride);
      }
      const d = batchDefer;
      return thenable(d.promise, () => transition && transition.cancel());
    }
    return relayout({ focal, ...extra });
  }

  const settled = () => thenable(Promise.resolve({ canceled: false }), () => {});

  // ---- M1: token run + storyboard + transport (D4/D8) --------------------------
  let runCtl = null;      // the run-transport driving compileRun on the shared ticker
  let runRender = null;   // the g.smv-tokens decoration layer
  let runOpts = {};
  let sb = null;          // the storyboard sequencer
  let sbSteps = null;
  let sbPlaying = false;
  let transport = null;
  let preset = null;
  const tbus = emitter(); // transport-facing "something moved" channel
  const notify = () => tbus.emit("change", null);

  function disposeRun() {
    if (runRender) { runRender.destroy(); runRender = null; }
    if (runCtl) { runCtl.destroy(); runCtl = null; }
  }

  function createRun(o) {
    disposeRun();
    runOpts = o || {};
    runCtl = createRunTransport(internals, runOpts);
    runRender = createRunRender(internals, runCtl);
    runCtl.on("*", notify);
    notify();
    return runCtl;
  }

  const ensureRun = () => runCtl || createRun(runOpts);

  /** A storyboard `wait` on the shared clock — never a setTimeout racing the ticker (D1). */
  function waitMs(ms) {
    const d = reduced ? 1 : Math.max(0, ms || 0);
    return new Promise((res) => {
      const t0 = ticker.now();
      const tickWait = (now) => {
        if (now - t0 < d) return;
        ticker.remove(tickWait);
        res({ canceled: false });
      };
      ticker.add(tickWait);
    });
  }

  /** The storyboard's op dispatch (§5.5). Mutation ops are just the public API. */
  function applyStep(step) {
    const args = step.args || [];
    switch (step.op) {
      case "wait":
        return waitMs(step.ms ?? args[0] ?? 0);
      case "run.play": {
        const r = ensureRun();
        r.play(step.until != null ? { until: step.until } : (args[0] || {}));
        return { run: r }; // the sequencer awaits r.promise; play/pause stay the run's job
      }
      case "run.step": {
        ensureRun().step(step.token != null ? { token: step.token } : (args[0] || {}));
        return null; // instantaneous: nothing to await
      }
      case "run.seek": {
        ensureRun().seek(step.ms ?? args[0] ?? 0);
        return null;
      }
      case "batch": {
        const list = Array.isArray(step.steps) ? step.steps : Array.isArray(args[0]) ? args[0] : [];
        return g.batch(() => { for (const s of list) applyStep(s); });
      }
      default:
        return g[step.op](...args);
    }
  }

  // G2 — the snapshot taken before every step is spec + view state + run position, which is
  // the complete set of things a step can move. Restoring animates from the CURRENT visual
  // state through the ordinary keyed diff (D8), so a backward seek is just another commit.
  const host = {
    apply: applyStep,
    snapshot() {
      return {
        spec: store.snapshot(),
        collapsed: [...vs.collapsed],
        runTime: runCtl ? runCtl.time() : 0,
        runOpts: runCtl ? runCtl.options() : null,
      };
    },
    restore(snap) {
      if (!snap) return settled();
      store.restore(snap.spec);
      vs.collapsed.clear();
      for (const id of snap.collapsed || []) vs.collapsed.add(id);
      const tr = relayout({});
      if (snap.runOpts) createRun(snap.runOpts).seek(snap.runTime || 0);
      else disposeRun();
      notify();
      return tr;
    },
  };

  function buildStoryboard(steps) {
    sbSteps = [...steps];
    sb = createStoryboard(host, sbSteps);
    sb.on("step", notify);
    sb.on("seek", notify);
    sb.on("done", () => { sbPlaying = false; notify(); });
    return sb;
  }

  /** Every step's share of the transport's cumulative timeline. A `run.play {until}` is
   *  worth exactly the time that node finishes at, so the scrubber tracks the story. */
  function stepDurations() {
    return (sbSteps || []).map((s) => {
      if (s.op === undefined) return 0; // label markers are zero-duration positions
      if (s.op === "wait") return Math.max(0, s.ms ?? (s.args && s.args[0]) ?? 0);
      if (s.op === "run.play") {
        if (!runCtl) return NOMINAL_STEP_MS;
        return s.until != null ? runCtl.timeOf(s.until) : runCtl.duration;
      }
      return NOMINAL_STEP_MS;
    });
  }

  function timeline() {
    if (!sb) {
      const d = runCtl ? runCtl.duration : 0;
      return {
        total: d || 1, time: runCtl ? runCtl.time() : 0,
        label: null, index: 0, steps: 0, playing: !!(runCtl && runCtl.playing),
      };
    }
    const durs = stepDurations();
    let acc = 0;
    const offsets = durs.map((d) => { const o = acc; acc += d; return o; });
    const pos = sb.position();
    const i = Math.min(pos.index, Math.max(0, durs.length - 1));
    const step = sbSteps[i];
    const inRun = !!(step && step.op === "run.play" && runCtl);
    const time = pos.done ? acc : (offsets[i] || 0) + (inRun ? Math.min(runCtl.time(), durs[i]) : 0);
    return {
      total: acc || 1, time, label: pos.label, index: pos.index, steps: durs.length,
      playing: sbPlaying || !!(runCtl && runCtl.playing),
    };
  }

  /** Cumulative-timeline seek: land on the owning step, then run.seek inside it (§5.5). */
  function seekTimeline(ms) {
    if (!sb) {
      if (runCtl) runCtl.seek(ms);
      notify();
      return Promise.resolve();
    }
    const durs = stepDurations();
    if (!durs.length) return Promise.resolve();
    let acc = 0;
    const offsets = durs.map((d) => { const o = acc; acc += d; return o; });
    // A zero-duration label sitting exactly on `ms` wins over the step that follows it,
    // so scrubbing onto a marker lands on the marker (that is what labels are for).
    let idx = durs.length - 1;
    for (let i = 0; i < durs.length; i++) {
      if (ms <= offsets[i] || ms < offsets[i] + durs[i]) { idx = i; break; }
    }
    const off = Math.max(0, ms - offsets[idx]);
    return Promise.resolve(sb.seek(idx)).then(() => {
      const step = sbSteps[idx];
      if (step && step.op === "run.play" && runCtl) runCtl.seek(Math.max(0, off));
      notify();
    });
  }

  const controller = {
    play() { if (sb) { sbPlaying = true; sb.play(); } else ensureRun().play(); notify(); },
    pause() { sbPlaying = false; if (sb) sb.pause(); if (runCtl) runCtl.pause(); notify(); },
    next() { if (sb) return Promise.resolve(sb.next()).then(notify); if (runCtl) runCtl.step(); notify(); },
    prev() { if (sb) return Promise.resolve(sb.prev()).then(notify); if (runCtl) runCtl.seek(0); notify(); },
    seek: seekTimeline,
    speed(f) { ensureRun().speed(f); notify(); },
    timeline,
    on: (type, fn) => tbus.on(type, fn),
  };

  // Handed to the choreography modules: everything they need, nothing DOM-shaped, so
  // they stay testable against a fake host (D6).
  const internals = {
    ticker, store, scene, renderer, bus, viewstate: vs,
    get reduced() { return reduced; },
    lastLayout: () => last,
    relayout,
    mark(ids, value) { for (const id of ids) renderer.mark(id, value); },
  };

  const g = {
    version,
    el: root,
    ticker,
    scene,
    renderer,
    viewport,
    viewstate: vs,

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

    /** D5 — children bloom out of the container's *previous* centre. */
    expand(id) {
      if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      const at = last && last.nodes[id] ? { x: last.nodes[id].x, y: last.nodes[id].y } : null;
      if (!vs.expand(id)) return settled();
      bus.emit("expand", { id });
      return commitOrDefer(id, at && {
        enterFrom: (res, prev) => {
          const out = {};
          for (const k of Object.keys(res.nodes)) if (!prev || !prev.nodes[k]) out[k] = at;
          return out;
        },
      });
    },

    /** The exact inverse: everything that just went away flies into the container's new centre. */
    collapse(id) {
      if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      if (!vs.collapse(id)) return settled();
      bus.emit("collapse", { id });
      return commitOrDefer(id, {
        exitTo: (res, prev) => {
          const c = res.nodes[id];
          const out = {};
          if (c && prev) for (const k of Object.keys(prev.nodes)) if (!res.nodes[k]) out[k] = { x: c.x, y: c.y };
          return out;
        },
      });
    },

    /** D6 — merge N nodes into one over the 3-phase choreography. Guards fire synchronously. */
    condense(ids, node) {
      const list = [...ids];
      for (const id of list) if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      if (!node || node.id == null || node.id === "") throw new GraphError("node-id", "condense needs a new node with a non-empty id");
      if (store.hasNode(node.id)) throw new GraphError("dup-id", `duplicate node id "${node.id}"`);
      if (!isConvex(store, new Set(list))) {
        throw new GraphError("non-convex", `condense set [${list.join(", ")}] is not convex: a path leaves the set and re-enters`);
      }
      const run = runCondense(g, internals, list, node);
      return thenable(run.promise, run.cancel);
    },

    /** D4 — the token run. Called with opts it (re)compiles; bare it returns the live one. */
    run(o) { return o || !runCtl ? createRun(o || runOpts) : runCtl; },

    /** D8 — the JSON-op sequencer. Called with steps it (re)builds; bare it returns it. */
    storyboard(steps) { return steps ? buildStoryboard(steps) : sb; },

    /** The transport-facing view of where the story is (also what the bar renders from). */
    timeline,

    batch(fn) {
      batching++;
      try { fn(g); } finally { batching--; }
      if (batching > 0) return settled();
      const d = batchDefer, focal = batchFocal, extra = batchExtra;
      batchDefer = null; batchFocal = null; batchExtra = null;
      const tr = relayout({ focal, ...extra });
      if (d) d.resolve(tr);
      return tr;
    },

    /** User style functions set --smv-* custom properties only (D7). */
    style(fn) {
      styleFn = typeof fn === "function" ? fn : null;
      const v = vs.view();
      renderer.styleCommit({ nodes: v.nodes, edges: v.edges, reversed: pinnedReversals, style: styleFn, sizes: v.sizes });
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
      if (transport) { transport.destroy(); transport = null; }
      if (preset) { preset.destroy(); preset = null; }
      if (sb) { sb.pause(); sb = null; }
      disposeRun();
      scene.destroy();
      viewport.destroy();
      renderer.destroy();
      ticker.destroy();
      root.classList.remove("smv-root");
      root.classList.remove("smv-has-transport");
      root.removeAttribute("data-smv-theme");
    },
  };

  // The preset subscribes to "commit", so it has to exist before the first one.
  if (opts.preset === "pipeline") preset = applyPipelinePreset(g);

  // Initial paint: land immediately (nothing to tween from), then fit once (D10).
  relayout({ duration: 0 });
  viewport.fit(last.bounds, 24, false);

  if (opts.storyboard) buildStoryboard(opts.storyboard);
  if (opts.controls) {
    root.classList.add("smv-has-transport"); // the preset's total bar steps up out of the way
    transport = createTransport(root, controller);
  }
  if (opts.autoplay && sb) { sbPlaying = true; sb.play(); }

  return g;
}

/** `opts.preset: 'pipeline'` inline, or `SparkleMotion.presetPipeline(g)` after the fact. */
export const presetPipeline = applyPipelinePreset;

export default { mount, version, presetPipeline };
