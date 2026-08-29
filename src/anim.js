// Easing table + the single rAF clock (D1). Browser APIs are all feature-detected so
// this imports cleanly under Node; `createTicker({manual:true})` drives tests.

export const EASE = {
  linear: (t) => t,
  cubicOut: (t) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // easeOutBack — slight >1 excursion, used by condense reveal.
  overshoot: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    const u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  },
};

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const hasRAF = typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
function scheduleFrame(fn) {
  return hasRAF ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16);
}
function cancelFrame(id) {
  if (hasRAF) cancelAnimationFrame(id);
  else clearTimeout(id);
}

/** WAAPI Animation on a detached element used purely as a clock source (D1):
 *  gives a monotonic currentTime independent of any single tween's lifecycle. */
function makeWaapiClock() {
  if (typeof document === "undefined" || typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return null;
  try {
    const el = document.createElement("div"); // never appended — detached on purpose
    const anim = el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 2_147_483_647, iterations: Infinity });
    anim.play?.();
    return anim;
  } catch {
    return null;
  }
}

function readCurrentTime(anim) {
  const ct = anim.currentTime;
  if (ct == null) return null;
  // WAAPI L2 may hand back a CSSNumericValue instead of a plain ms number.
  return typeof ct === "object" ? ct.value ?? null : ct;
}

/** createTicker(opts) -> {now, add, remove, destroy, tick}. One rAF loop for ALL
 *  choreographed motion (D1): starts on first add(), stops on last remove(). */
export function createTicker(opts = {}) {
  const manual = !!opts.manual;
  const callbacks = new Set();
  const destroyCbs = new Set(); // teardown waiters: everything suspended on the clock
  let frameId = null;
  let manualTime = 0;
  let clock = null;
  let destroyed = false;

  function now() {
    if (manual) return manualTime;
    if (clock) {
      const t = readCurrentTime(clock);
      if (t != null) return t;
    }
    return nowMs();
  }

  function loop(t) {
    if (destroyed) return;
    const time = now();
    for (const fn of [...callbacks]) fn(time);
    frameId = callbacks.size > 0 ? scheduleFrame(loop) : null;
  }

  function start() {
    if (manual || destroyed || frameId != null) return;
    if (!clock) clock = makeWaapiClock();
    frameId = scheduleFrame(loop);
  }

  return {
    now,
    add(fn) {
      callbacks.add(fn);
      start();
    },
    remove(fn) {
      callbacks.delete(fn);
      if (callbacks.size === 0 && frameId != null) {
        cancelFrame(frameId);
        frameId = null;
      }
    },
    /** Teardown notification: a callback that only ever settles from inside a tick would
     *  otherwise be stranded forever by destroy() (its promise never resolving). Returns an
     *  off() so a normally-completing waiter can unsubscribe. */
    onDestroy(fn) {
      if (destroyed) { fn(); return () => {}; }
      destroyCbs.add(fn);
      return () => destroyCbs.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const waiters = [...destroyCbs];
      destroyCbs.clear();
      callbacks.clear();
      if (frameId != null) { cancelFrame(frameId); frameId = null; }
      if (clock) { try { clock.cancel(); } catch {} clock = null; }
      for (const fn of waiters) { try { fn(); } catch {} }
    },
    /** Manual-mode only: advance the clock and fire callbacks once (for tests). */
    tick(ms) {
      if (!manual) return;
      manualTime += ms;
      for (const fn of [...callbacks]) fn(manualTime);
    },
  };
}

/** false under Node (no matchMedia) — callers shrink durations, never skip sequencing (G9). */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
