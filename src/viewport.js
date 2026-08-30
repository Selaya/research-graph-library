// Pan/zoom/fit + the anchored-viewport correction (D10).
// Zoom is ctrl/cmd+wheel or pinch ONLY — plain wheel is never intercepted, so the page
// keeps scrolling. Viewport motion runs on the SHARED ticker so it can never tear away
// from the FLIP tween it is correcting.
//
// Point coordinates for screenToWorld/worldToScreen/anchor are LOCAL to the svg element
// (0,0 = its top-left), not client coordinates.

import { EASE } from "./anim.js";

export const MIN_K = 0.1;
export const MAX_K = 4;
export const FIT_MAX_K = 1.5; // never blow a tiny graph up to fill the pane
const FIT_MS = 350;           // the legacy `fit(bounds, pad, true)` spelling's duration

const clampK = (k) => Math.max(MIN_K, Math.min(MAX_K, Number.isFinite(k) ? k : 1));

export function createViewport(svgEl, viewportG, ticker) {
  const state = { x: 0, y: 0, k: 1 };
  const target = { x: 0, y: 0, k: 1 };
  let userMoved = false;
  let tween = null;
  let destroyed = false;

  const pointers = new Map();
  let panning = null;   // {x, y} last client point
  let pinch = null;     // {dist, mid}

  // Anything that wants to know the visible world rect just moved — culling, above all.
  // Fired from apply(), so it covers every route the transform can change by: a drag, a
  // pinch, a wheel zoom, fit()/zoomBy()/anchor(), and each tick of their tweens. Watching
  // the svg's pointer events instead (which is what culling did) misses every programmatic
  // move: g.fitView() left everything the last zoom had hidden hidden.
  const changed = new Set();
  const round = (n) => Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000;
  function apply() {
    viewportG.setAttribute("transform", `translate(${round(state.x)},${round(state.y)}) scale(${round(state.k)})`);
    for (const cb of changed) cb();
  }

  function size() {
    const r = typeof svgEl.getBoundingClientRect === "function" ? svgEl.getBoundingClientRect() : null;
    const w = (r && r.width) || svgEl.clientWidth || 800;
    const h = (r && r.height) || svgEl.clientHeight || 600;
    return { w, h };
  }

  function localPt(ev) {
    const r = typeof svgEl.getBoundingClientRect === "function" ? svgEl.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  /** D9 — a tween is cancel-and-retarget, so it owes an answer either way: whoever started
   *  it may be awaiting `moveTo().promise`, and dropping it silently (what this did through
   *  M3) strands that awaitable forever. Every exit from a tween goes through here. */
  function stopTween(canceled) {
    if (!tween) return;
    const t = tween;
    tween = null;
    ticker.remove(tick);
    if (t.settle) t.settle({ canceled: !!canceled });
  }

  function tick(now) {
    if (!tween) return;
    const p = tween.duration > 0 ? Math.min(1, Math.max(0, (now - tween.t0) / tween.duration)) : 1;
    const e = (tween.ease || EASE.cubicOut)(p);
    state.x = tween.from.x + (tween.to.x - tween.from.x) * e;
    state.y = tween.from.y + (tween.to.y - tween.from.y) * e;
    state.k = tween.from.k + (tween.to.k - tween.from.k) * e;
    apply();
    if (p >= 1) { stopTween(false); }
  }

  /** Returns the promise for THIS move: `{canceled:false}` when it lands, `{canceled:true}`
   *  when a later move (or destroy/teardown) retargets it out from under. */
  function setTo(x, y, k, duration, ease) {
    target.x = x; target.y = y; target.k = clampK(k);
    stopTween(true);
    if (!(duration > 0)) {
      state.x = target.x; state.y = target.y; state.k = target.k;
      apply();
      return Promise.resolve({ canceled: false });
    }
    let settle;
    const promise = new Promise((r) => { settle = r; });
    tween = { t0: ticker.now(), duration, ease, from: { ...state }, to: { ...target }, settle };
    ticker.add(tick);
    return promise;
  }

  function setNow(x, y, k) {
    stopTween(true);
    state.x = x; state.y = y; state.k = clampK(k);
    target.x = state.x; target.y = state.y; target.k = state.k;
    apply();
  }

  function screenToWorld(pt) {
    return { x: (pt.x - state.x) / state.k, y: (pt.y - state.y) / state.k };
  }
  function worldToScreen(pt, t = state) {
    return { x: pt.x * t.k + t.x, y: pt.y * t.k + t.y };
  }

  function zoomAbout(pt, factor) {
    const world = screenToWorld(pt);
    const k = clampK(state.k * factor);
    setNow(pt.x - world.x * k, pt.y - world.y * k, k);
  }

  /** World-space rect currently on screen, padded (M3 culling). Returns null when the svg
   *  has no usable client size (Node / fake DOM in tests) — callers must then cull nothing. */
  function visibleWorldRect(pad = 200) {
    const r = typeof svgEl.getBoundingClientRect === "function" ? svgEl.getBoundingClientRect() : null;
    const w = (r && r.width) || svgEl.clientWidth;
    const h = (r && r.height) || svgEl.clientHeight;
    if (!(w > 0) || !(h > 0)) return null;
    const tl = screenToWorld({ x: 0, y: 0 });
    const br = screenToWorld({ x: w, y: h });
    return { x: tl.x - pad, y: tl.y - pad, w: br.x - tl.x + 2 * pad, h: br.y - tl.y + 2 * pad };
  }

  /** fit(bounds, {pad, duration, ease, maxK}) — and still the M0 spelling
   *  `fit(bounds, pad, animate)`, which every existing caller and the public d.ts use.
   *  Reduced motion is NOT consulted here: index.js owns `reduced` and passes duration=1. */
  function fit(bounds, o = 24, animate = false) {
    if (!bounds) return Promise.resolve({ canceled: false });
    const opts = o && typeof o === "object" ? o : { pad: o, duration: animate ? FIT_MS : 0 };
    const pad = opts.pad ?? 24;
    // FIT_MAX_K exists so the initial auto-fit never blows a two-node graph up to fill the
    // pane. A director camera framing ONE node wants the opposite, so it passes maxK.
    const lid = opts.maxK ?? FIT_MAX_K;
    const { w: W, h: H } = size();
    const bw = Math.max(bounds.w, 1), bh = Math.max(bounds.h, 1);
    let k = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    if (!Number.isFinite(k) || k <= 0) k = 1;
    k = Math.max(MIN_K, Math.min(lid, k));
    const x = W / 2 - (bounds.x + bounds.w / 2) * k;
    const y = H / 2 - (bounds.y + bounds.h / 2) * k;
    return setTo(x, y, k, opts.duration ?? 0, opts.ease);
  }

  /** Drive the camera to an absolute transform (M4). D9: starting one cancels whatever was
   *  in flight, resolving ITS promise `{canceled:true}` — moves retarget, they never queue. */
  function moveTo(to, opts = {}) {
    const t = to || {};
    const promise = setTo(
      Number.isFinite(t.x) ? t.x : target.x,
      Number.isFinite(t.y) ? t.y : target.y,
      Number.isFinite(t.k) ? t.k : target.k,
      opts.duration ?? 0,
      opts.ease,
    );
    const mine = tween;
    return { promise, cancel() { if (mine && tween === mine) stopTween(true); } };
  }

  /** Translate-only correction on the same clock: keep `before` where it was on screen
   *  now that the same thing lives at `after` in world space (D10). */
  function anchor(before, after, duration = 0) {
    if (!before || !after) return;
    // Scale by the frame this correction is actually written into (setTo() below bases the
    // new position on `target`, not on wherever `state` sits mid-tween) — using `state.k`
    // here would mix the current, possibly mid-tween, scale with the destination frame.
    const dx = (before.x - after.x) * target.k;
    const dy = (before.y - after.y) * target.k;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    setTo(target.x + dx, target.y + dy, target.k, duration);
  }

  /** Would `bounds` be fully visible at the transform we are heading to? */
  function contains(bounds) {
    if (!bounds) return true;
    const { w: W, h: H } = size();
    const a = worldToScreen({ x: bounds.x, y: bounds.y }, target);
    const b = worldToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h }, target);
    return a.x >= 0 && a.y >= 0 && b.x <= W && b.y <= H;
  }

  // ---- input ----

  function onPointerDown(ev) {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) {
      panning = { x: ev.clientX, y: ev.clientY };
      svgEl.classList.add("smv-grabbing");
      if (typeof svgEl.setPointerCapture === "function") { try { svgEl.setPointerCapture(ev.pointerId); } catch {} }
    } else if (pointers.size === 2) {
      panning = null;
      pinch = gesture();
    }
  }

  function gesture() {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function onPointerMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2) {
      const g = gesture();
      if (pinch) {
        const r = typeof svgEl.getBoundingClientRect === "function" ? svgEl.getBoundingClientRect() : { left: 0, top: 0 };
        zoomAbout({ x: g.mid.x - r.left, y: g.mid.y - r.top }, g.dist / pinch.dist);
        userMoved = true;
      }
      pinch = g;
      ev.preventDefault?.();
      return;
    }
    if (!panning) return;
    const dx = ev.clientX - panning.x, dy = ev.clientY - panning.y;
    if (dx === 0 && dy === 0) return;
    panning = { x: ev.clientX, y: ev.clientY };
    setNow(state.x + dx, state.y + dy, state.k);
    userMoved = true;
    ev.preventDefault?.();
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      panning = null;
      svgEl.classList.remove("smv-grabbing");
      if (typeof svgEl.releasePointerCapture === "function") { try { svgEl.releasePointerCapture(ev.pointerId); } catch {} }
    }
  }

  function onWheel(ev) {
    if (!(ev.ctrlKey || ev.metaKey)) return; // never hijack plain page scroll (D10)
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    zoomAbout(localPt(ev), Math.exp(-ev.deltaY * unit * 0.0025));
    userMoved = true;
  }

  const canListen = typeof svgEl.addEventListener === "function";
  let listening = false;

  /** Detach/attach every pointer+wheel listener in one flip. The frame renderer (M4b) turns
   *  interaction off so a stray pointer can never move the camera mid-capture. */
  function setInteractive(on) {
    const want = !!on && !destroyed;
    if (!canListen || listening === want) return;
    listening = want;
    const bind = want ? "addEventListener" : "removeEventListener";
    svgEl[bind]("pointerdown", onPointerDown);
    svgEl[bind]("pointermove", onPointerMove);
    svgEl[bind]("pointerup", onPointerUp);
    svgEl[bind]("pointercancel", onPointerUp);
    svgEl[bind]("wheel", onWheel, { passive: false });
    if (!want) { pointers.clear(); panning = null; pinch = null; }
  }
  setInteractive(true);

  // A tween suspended on the clock owes its awaiter an answer even when the clock itself is
  // torn down: `g.ticker` is public, so ticker.destroy() alone would otherwise strand one.
  const offClock = typeof ticker.onDestroy === "function" ? ticker.onDestroy(() => stopTween(true)) : null;
  apply();

  return {
    get transform() { return { x: state.x, y: state.y, k: state.k }; },
    /** Where the camera is HEADING — the live tween's destination, else the current state.
     *  Relative camera moves compose onto this, never onto a mid-tween sample (see anchor). */
    get target() { return { x: target.x, y: target.y, k: target.k }; },
    get userMoved() { return userMoved; },
    set userMoved(v) { userMoved = !!v; },
    fit,
    moveTo,
    setInteractive,
    size,
    screenToWorld,
    worldToScreen: (pt) => worldToScreen(pt),
    anchor,
    contains,
    visibleWorldRect,
    zoomBy(factor, at) { zoomAbout(at || { x: size().w / 2, y: size().h / 2 }, factor); userMoved = true; },
    /** Subscribe to "the transform just changed". Returns an unsubscribe. */
    onChange(cb) { if (typeof cb === "function") changed.add(cb); return () => changed.delete(cb); },
    destroy() {
      if (destroyed) return;
      changed.clear();
      stopTween(true);
      if (offClock) offClock();
      setInteractive(false);
      destroyed = true;
      pointers.clear();
    },
  };
}
