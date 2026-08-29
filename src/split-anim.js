// D6 inverse — the split choreography: highlight -> diverge -> reveal, on the shared
// ticker (D1), total <= 900ms. Mirrors condense-anim.js's phase/ticker/onDestroy
// discipline exactly (see that file for the interruption commentary this follows
// verbatim) — DOM-free, every visual effect goes through `internals.mark()` /
// `internals.relayout()`, so this runs against a fake host in tests.

import { EASE } from "./anim.js";

export const SPLIT_PHASES = { highlight: 150, diverge: 450, reveal: 300 };

/** A cancelable sleep on the shared clock. Resolves true when canceled — including when
 *  the clock itself is torn down, so g.destroy() mid-phase never strands the awaitable. */
function wait(ticker, ms) {
  let settle, done = false, offDestroy = null;
  const promise = new Promise((r) => { settle = r; });
  const t0 = ticker.now();
  const finish = (canceled) => {
    if (done) return;
    done = true;
    ticker.remove(step);
    if (offDestroy) { offDestroy(); offDestroy = null; }
    settle(canceled);
  };
  function step(now) { if (now - t0 >= ms) finish(false); }
  ticker.add(step);
  if (typeof ticker.onDestroy === "function") offDestroy = ticker.onDestroy(() => finish(true));
  return { promise, cancel: () => finish(true) };
}

/** Phase 2 awaits a scene transition rather than a sleep, but it suspends on the same
 *  clock and owes the same guarantee: a torn-down ticker settles it. Relying on
 *  scene.destroy() running first is an accident of g.destroy()'s call order, not something
 *  this module controls — `g.ticker` is public, so `g.ticker.destroy()` alone would
 *  otherwise strand this promise with the store already split. */
function awaitTransition(ticker, tr) {
  let settle, done = false, offDestroy = null;
  const promise = new Promise((r) => { settle = r; });
  const finish = (canceled) => {
    if (done) return;
    done = true;
    if (offDestroy) { offDestroy(); offDestroy = null; }
    settle(canceled);
  };
  Promise.resolve(tr).then((r) => finish(!!(r && r.canceled)), () => finish(true));
  if (typeof ticker.onDestroy === "function") offDestroy = ticker.onDestroy(() => finish(true));
  return { promise, cancel: () => { if (tr && tr.cancel) tr.cancel(); finish(true); } };
}

/**
 * @param {object} g          public instance (used for node lookups in the event payload)
 * @param {object} internals  { ticker, store, bus, relayout, mark, reduced }
 * @param {string} id         the node being split
 * @param {object} parts      { nodes, edges? } — store.split()'s second argument
 * @returns {{promise: Promise<{canceled:boolean}>, cancel: () => void}}
 */
export function runSplit(g, internals, id, parts) {
  const { ticker, store, bus, relayout } = internals;
  const ms = (n) => (internals.reduced ? 1 : n); // G9 — phases shrink, sequencing survives
  const mark = (list, value) => internals.mark && internals.mark(list, value);

  /** The same guard g.split() ran synchronously, re-asked at phase-2 time (the graph
   *  may have moved under this run — an overlapping mutation, a rival removeNode). */
  const stillValid = () => store.hasNode(id) && store.children(id).length === 0;

  let inFlight = null;
  let settled = false;
  let diverging = false; // phase 2 has split the store and its commit is still live
  let settleOuter, rejectOuter;
  const promise = new Promise((res, rej) => { settleOuter = res; rejectOuter = rej; });
  const done = (canceled) => {
    if (settled) return;
    settled = true;
    settleOuter({ canceled: !!canceled });
  };

  (async () => {
    // 1 — highlight: nothing moves; the eye registers WHAT is about to divide.
    mark([id], "src");
    const sourceData = g.node(id);
    inFlight = wait(ticker, ms(SPLIT_PHASES.highlight));
    if (await inFlight.promise) { mark([id], null); return done(true); }

    // 2 — diverge: the new nodes bloom out of the source's old centre.
    if (!stillValid()) { mark([id], null); return done(true); }
    const { added } = store.split(id, parts);
    diverging = true;
    const targets = [...added];
    // Same as condense: the parts inherit the slot the node they came out of held.
    if (internals.reseat) internals.reseat(targets, [id]);
    const tr = relayout({
      focal: targets[0],
      duration: ms(SPLIT_PHASES.diverge),
      enterFrom: (res, prev) => {
        const c = prev && prev.nodes && prev.nodes[id];
        if (!c) return {};
        const map = {};
        for (const tid of targets) map[tid] = { x: c.x, y: c.y };
        return map;
      },
      easeOverride: Object.fromEntries(targets.map((tid) => [tid, EASE.overshoot])),
    });
    // Mirrors C12: the core announces the split and stops; it never reads durations.
    bus.emit("split", { source: id, targets, sourceData });
    inFlight = awaitTransition(ticker, tr);
    const cut = await inFlight.promise;
    diverging = false;
    mark([id], null);
    if (cut) return done(true);

    // 3 — reveal: a held emphasis class on every added node, then back to normal.
    mark(targets, "reveal");
    inFlight = wait(ticker, ms(SPLIT_PHASES.reveal));
    const canceled = await inFlight.promise;
    mark(targets, null);
    done(canceled);
  })().catch((err) => {
    mark([id], null);
    if (!settled) { settled = true; rejectOuter(err); }
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      const midDiverge = diverging;
      if (inFlight) inFlight.cancel();
      // An EXPLICIT cancel has no follow-up commit to re-diff (unlike a D9 retarget,
      // which IS one). Phase 2 has already split the store, so without one final
      // zero-duration diff the new nodes stay frozen wherever their entrance had got
      // to — invisible and at 60% size — over a graph that structurally contains them.
      if (midDiverge) relayout({ duration: 0 });
    },
  };
}
