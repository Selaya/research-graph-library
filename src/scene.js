// The diff-and-animate core (DOM-free). Keyed diff of the current *visual* state vs a
// layout result, then one tween on the shared clock (D1).
//
// D9 — cancel-and-retarget: a commit() during a live transition samples the current
// interpolated state as the new "from", cancels the old transition (its promise resolves
// {canceled:true}) and starts exactly ONE new transition. Two transitions never write the
// same element, and nothing is queued behind anything.

import { EASE } from "./anim.js";
import { diffKeys } from "./diff.js";
import { catmullRom, resample, lerpPoints } from "./path.js";

/** Every edge is carried as this many arc-length-uniform points so any two geometries
 *  (different bend counts from the layered layout) lerp pointwise. */
export const EDGE_POINTS = 24;

const ENTER_SCALE = 0.6;

function normalizePoints(points) {
  return resample(catmullRom(points || [], 8), EDGE_POINTS);
}

function toPoints(points) {
  return points && points.length === EDGE_POINTS ? points.map((p) => ({ x: p.x, y: p.y })) : resample(points || [], EDGE_POINTS);
}

const lerp = (a, b, t) => a + (b - a) * t;

export function createScene(ticker) {
  const visual = { nodes: new Map(), edges: new Map() };
  const frameCbs = new Set();
  let live = null; // at most one transition is ever live (D9)

  function fire() {
    for (const cb of [...frameCbs]) cb(visual);
  }

  function progress(tr, now) {
    if (!(tr.duration > 0)) return 1;
    const raw = (now - tr.t0) / tr.duration;
    return raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
  }

  function apply(tr, p) {
    const e = tr.easing(p);
    for (const op of tr.nodes) {
      const cur = visual.nodes.get(op.id);
      if (!cur) continue;
      cur.x = lerp(op.from.x, op.to.x, e);
      cur.y = lerp(op.from.y, op.to.y, e);
      cur.w = lerp(op.from.w, op.to.w, e);
      cur.h = lerp(op.from.h, op.to.h, e);
      cur.opacity = lerp(op.from.opacity, op.to.opacity, p);
    }
    for (const op of tr.edges) {
      const cur = visual.edges.get(op.id);
      if (!cur) continue;
      cur.points = p >= 1 ? op.to.points.map((q) => ({ x: q.x, y: q.y })) : lerpPoints(op.from.points, op.to.points, e);
      cur.opacity = lerp(op.from.opacity, op.to.opacity, p);
    }
  }

  function settle(tr) {
    for (const op of tr.nodes) if (op.exit) visual.nodes.delete(op.id);
    for (const op of tr.edges) if (op.exit) visual.edges.delete(op.id);
  }

  function step(now) {
    const tr = live;
    if (!tr) return;
    const p = progress(tr, now);
    apply(tr, p);
    if (p < 1) { fire(); return; }
    settle(tr);
    ticker.remove(step);
    live = null;
    tr.done = true;
    fire();
    tr.resolve({ canceled: false });
  }

  /** Sample the live transition's *current* interpolated state into `visual` and drop it. */
  function interrupt() {
    const tr = live;
    if (!tr) return;
    apply(tr, progress(tr, ticker.now()));
    ticker.remove(step);
    live = null;
    tr.done = true;
    tr.resolve({ canceled: true });
  }

  function commit(target, opts = {}) {
    interrupt();

    const duration = opts.duration ?? 350;
    const easing = opts.easing || EASE.cubicOut;
    const enterFrom = opts.enterFrom || {};
    const hold = opts.holdOpacity;
    const held = (id) => !!(hold && hold.has(id));
    const tNodes = target?.nodes || {};
    const tEdges = target?.edges || {};

    const nodeOps = [];
    const dn = diffKeys(visual.nodes.keys(), Object.keys(tNodes));
    for (const id of dn.update) {
      const cur = visual.nodes.get(id);
      const to = tNodes[id];
      nodeOps.push({
        id, exit: false,
        from: { x: cur.x, y: cur.y, w: cur.w, h: cur.h, opacity: cur.opacity },
        to: { x: to.x, y: to.y, w: to.w, h: to.h, opacity: held(id) ? cur.opacity : 1 },
      });
    }
    for (const id of dn.enter) {
      const to = tNodes[id];
      const at = enterFrom[id];
      const from = {
        x: at && Number.isFinite(at.x) ? at.x : to.x,
        y: at && Number.isFinite(at.y) ? at.y : to.y,
        w: to.w * ENTER_SCALE, h: to.h * ENTER_SCALE,
        opacity: held(id) ? 1 : 0,
      };
      visual.nodes.set(id, { ...from });
      nodeOps.push({ id, exit: false, from, to: { x: to.x, y: to.y, w: to.w, h: to.h, opacity: 1 } });
    }
    for (const id of dn.exit) {
      const cur = visual.nodes.get(id);
      const from = { x: cur.x, y: cur.y, w: cur.w, h: cur.h, opacity: cur.opacity };
      nodeOps.push({ id, exit: true, from, to: { ...from, opacity: 0 } });
    }

    const edgeOps = [];
    const de = diffKeys(visual.edges.keys(), Object.keys(tEdges));
    for (const id of de.update) {
      const cur = visual.edges.get(id);
      const to = tEdges[id];
      cur.reversed = !!to.reversed; // styling flag lands at commit time (D7), not per frame
      edgeOps.push({
        id, exit: false,
        from: { points: toPoints(cur.points), opacity: cur.opacity },
        to: { points: normalizePoints(to.points), opacity: held(id) ? cur.opacity : 1 },
      });
    }
    for (const id of de.enter) {
      const to = tEdges[id];
      const pts = normalizePoints(to.points);
      const opacity = held(id) ? 1 : 0;
      visual.edges.set(id, { points: pts.map((p) => ({ x: p.x, y: p.y })), opacity, reversed: !!to.reversed });
      edgeOps.push({ id, exit: false, from: { points: pts, opacity }, to: { points: pts, opacity: 1 } });
    }
    for (const id of de.exit) {
      const cur = visual.edges.get(id);
      const pts = toPoints(cur.points);
      edgeOps.push({ id, exit: true, from: { points: pts, opacity: cur.opacity }, to: { points: pts, opacity: 0 } });
    }

    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const tr = {
      t0: ticker.now(), duration, easing, nodes: nodeOps, edges: edgeOps,
      resolve, promise, done: false,
      cancel() { if (live === tr) interrupt(); },
    };
    live = tr;

    apply(tr, 0);
    fire();                 // onFrame fires once per commit, before any tick
    ticker.add(step);       // zero/short durations land on the NEXT tick, never re-entrantly
    return tr;
  }

  return {
    visual,
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    offFrame(cb) { frameCbs.delete(cb); },
    commit,
    /** The live transition, or null. */
    get transition() { return live; },
    destroy() {
      interrupt();
      frameCbs.clear();
      visual.nodes.clear();
      visual.edges.clear();
    },
  };
}
