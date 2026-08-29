// Pan/zoom/fit + the anchored-viewport correction (D10).
// Zoom is ctrl/cmd+wheel or pinch ONLY — plain wheel is never intercepted, so the page
// keeps scrolling. Viewport motion runs on the SHARED ticker so it can never tear away
// from the FLIP tween it is correcting.
//
// Point coordinates for screenToWorld/worldToScreen/anchor are LOCAL to the svg element
// (0,0 = its top-left), not client coordinates.

import { EASE } from "./anim.js";

const MIN_K = 0.1;
const MAX_K = 4;
const FIT_MAX_K = 1.5; // never blow a tiny graph up to fill the pane

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

  const round = (n) => Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000;
  function apply() {
    viewportG.setAttribute("transform", `translate(${round(state.x)},${round(state.y)}) scale(${round(state.k)})`);
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

  function stopTween() {
    if (tween) { ticker.remove(tick); tween = null; }
  }

  function tick(now) {
    if (!tween) return;
    const p = tween.duration > 0 ? Math.min(1, Math.max(0, (now - tween.t0) / tween.duration)) : 1;
    const e = EASE.cubicOut(p);
    state.x = tween.from.x + (tween.to.x - tween.from.x) * e;
    state.y = tween.from.y + (tween.to.y - tween.from.y) * e;
    state.k = tween.from.k + (tween.to.k - tween.from.k) * e;
    apply();
    if (p >= 1) { stopTween(); }
  }

  function setTo(x, y, k, duration) {
    target.x = x; target.y = y; target.k = clampK(k);
    stopTween();
    if (!(duration > 0)) {
      state.x = target.x; state.y = target.y; state.k = target.k;
      apply();
      return;
    }
    tween = { t0: ticker.now(), duration, from: { ...state }, to: { ...target } };
    ticker.add(tick);
  }

  function setNow(x, y, k) {
    stopTween();
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

  function fit(bounds, pad = 24, animate = false) {
    if (!bounds) return;
    const { w: W, h: H } = size();
    const bw = Math.max(bounds.w, 1), bh = Math.max(bounds.h, 1);
    let k = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    if (!Number.isFinite(k) || k <= 0) k = 1;
    k = Math.max(MIN_K, Math.min(FIT_MAX_K, k));
    const x = W / 2 - (bounds.x + bounds.w / 2) * k;
    const y = H / 2 - (bounds.y + bounds.h / 2) * k;
    setTo(x, y, k, animate ? 350 : 0);
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
  if (canListen) {
    svgEl.addEventListener("pointerdown", onPointerDown);
    svgEl.addEventListener("pointermove", onPointerMove);
    svgEl.addEventListener("pointerup", onPointerUp);
    svgEl.addEventListener("pointercancel", onPointerUp);
    svgEl.addEventListener("wheel", onWheel, { passive: false });
  }
  apply();

  return {
    get transform() { return { x: state.x, y: state.y, k: state.k }; },
    get userMoved() { return userMoved; },
    set userMoved(v) { userMoved = !!v; },
    fit,
    screenToWorld,
    worldToScreen: (pt) => worldToScreen(pt),
    anchor,
    contains,
    visibleWorldRect,
    zoomBy(factor, at) { zoomAbout(at || { x: size().w / 2, y: size().h / 2 }, factor); userMoved = true; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopTween();
      if (canListen) {
        svgEl.removeEventListener("pointerdown", onPointerDown);
        svgEl.removeEventListener("pointermove", onPointerMove);
        svgEl.removeEventListener("pointerup", onPointerUp);
        svgEl.removeEventListener("pointercancel", onPointerUp);
        svgEl.removeEventListener("wheel", onWheel);
      }
      pointers.clear();
    },
  };
}
