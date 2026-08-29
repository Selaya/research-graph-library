// D6 — the condense choreography: highlight -> converge -> reveal, sequenced on the
// shared ticker (D1), total <= 900ms.
//
// DOM-free on purpose: every visual effect goes through `internals.mark()` /
// `internals.relayout()`, so this runs against a fake host in tests and never imports
// the renderer. Interruption is the existing D9 machinery — a mutation mid-flight cancels
// the converge transition, which cancels the whole run (`{canceled:true}`).

import { EASE } from "./anim.js";

export const CONDENSE_PHASES = { highlight: 150, converge: 450, reveal: 300 };

/** A cancelable sleep on the shared clock. Resolves true when canceled. */
function wait(ticker, ms) {
  let settle, done = false;
  const promise = new Promise((r) => { settle = r; });
  const t0 = ticker.now();
  const finish = (canceled) => {
    if (done) return;
    done = true;
    ticker.remove(step);
    settle(canceled);
  };
  function step(now) { if (now - t0 >= ms) finish(false); }
  ticker.add(step);
  return { promise, cancel: () => finish(true) };
}

function centroid(nodes, ids) {
  let x = 0, y = 0, n = 0;
  for (const id of ids) {
    const r = nodes && nodes[id];
    if (!r) continue;
    x += r.x; y += r.y; n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/**
 * @param {object} g         public instance (used for node lookups in the event payload)
 * @param {object} internals { ticker, store, bus, relayout, mark, reduced }
 * @param {string[]} ids     the source nodes to merge
 * @param {object} newNodeSpec the merged node
 * @returns {{promise: Promise<{canceled:boolean}>, cancel: () => void}}
 */
export function runCondense(g, internals, ids, newNodeSpec) {
  const { ticker, store, bus, relayout } = internals;
  const ms = (n) => (internals.reduced ? 1 : n); // G9 — phases shrink, sequencing survives
  const sources = [...ids];
  const mark = (list, value) => internals.mark && internals.mark(list, value);

  let inFlight = null;
  let settled = false;
  let settleOuter, rejectOuter;
  const promise = new Promise((res, rej) => { settleOuter = res; rejectOuter = rej; });
  const done = (canceled) => {
    if (settled) return;
    settled = true;
    settleOuter({ canceled: !!canceled });
  };

  (async () => {
    // 1 — highlight: nothing moves; the eye registers WHAT is about to merge.
    mark(sources, "src");
    const sourceData = sources.map((id) => g.node(id));
    inFlight = wait(ticker, ms(CONDENSE_PHASES.highlight));
    if (await inFlight.promise) { mark(sources, null); return done(true); }

    // 2 — converge: sources fly into the merged node's new centre while it blooms out of
    // their old centroid with an overshoot of its own.
    const { merged, removedNodes } = store.condense(sources, newNodeSpec);
    const target = merged.id;
    const gone = removedNodes.filter((id) => id !== target);
    const tr = relayout({
      focal: target,
      duration: ms(CONDENSE_PHASES.converge),
      enterFrom: (res, prev) => {
        const c = prev && centroid(prev.nodes, sources);
        return c ? { [target]: c } : {};
      },
      exitTo: (res) => {
        const c = res.nodes[target];
        const map = {};
        if (c) for (const id of gone) map[id] = { x: c.x, y: c.y };
        return map;
      },
      easeOverride: { [target]: EASE.overshoot },
    });
    // C12 — the core announces the merge and stops; it never reads durations.
    bus.emit("condense", { sources, target, sourceData, targetData: g.node(target) });
    inFlight = { promise: Promise.resolve(tr).then((r) => !!(r && r.canceled)), cancel: () => tr.cancel && tr.cancel() };
    const cut = await inFlight.promise;
    mark(sources, null);
    if (cut) return done(true);

    // 3 — reveal: a held emphasis class on the merged node, then back to normal.
    mark([target], "reveal");
    inFlight = wait(ticker, ms(CONDENSE_PHASES.reveal));
    const canceled = await inFlight.promise;
    mark([target], null);
    done(canceled);
  })().catch((err) => {
    mark(sources, null);
    if (!settled) { settled = true; rejectOuter(err); }
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      if (inFlight) inFlight.cancel();
    },
  };
}
