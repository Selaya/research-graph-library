// Storyboard: pure JSON-op sequencer (D8). No DOM, no ticker — the host owns everything
// stateful (mutation dispatch, snapshotting, restoring, run/wait timing). This module only
// walks the step array, snapshotting before each step (G2) and awaiting whatever
// host.apply() hands back.

import { GraphError } from "./store.js";
import { emitter } from "./events.js";

const OPS = new Set([
  "addNode", "addEdge", "removeNode", "removeEdge", "update",
  "expand", "collapse", "condense", "batch",
  "run.play", "run.step", "run.seek", "wait",
]);

function validate(steps) {
  steps.forEach((step, i) => {
    if (step.op === undefined) {
      if (step.label === undefined) throw new GraphError("storyboard-step", `step ${i} needs an "op" or a "label"`);
      return;
    }
    if (!OPS.has(step.op)) throw new GraphError("storyboard-op", `unknown storyboard op "${step.op}" at step ${i}`);
  });
}

/**
 * createStoryboard(host, steps) — host = { apply(step)→{promise?|run?}, snapshot()→any,
 * restore(snap)→promise }. `label`-only entries are zero-duration markers: no apply, no
 * await, just a named position for seek()/labels().
 */
export function createStoryboard(host, steps) {
  validate(steps);
  const bus = emitter();
  const snapshots = new Map(); // index -> snapshot taken BEFORE that step ran (G2)
  let cursor = 0;              // index of the next step to run
  let playing = false;
  let playPromise = null;
  let activeRun = null;        // the {run} a live run.play step handed back, for pause/resume

  const isLabelOnly = (step) => step.op === undefined;
  const labelAt = (idx) => (steps[idx] && steps[idx].label !== undefined ? steps[idx].label : null);

  async function advanceOne() {
    if (cursor >= steps.length) return { canceled: false };
    const idx = cursor;
    const step = steps[idx];
    if (!snapshots.has(idx)) snapshots.set(idx, host.snapshot());
    let result;
    if (!isLabelOnly(step)) {
      result = host.apply(step);
      // A run.play step may hand back {run}; the sequencer awaits its completion but
      // leaves play/pause/seek semantics to the run itself (D4/run-transport owns those).
      if (result && result.run) {
        activeRun = result;
        await result.run.promise;
      } else if (result && typeof result.then === "function") {
        await result;
      }
      activeRun = null;
    }
    cursor = idx + 1;
    bus.emit("step", { index: idx, step, result });
    if (cursor >= steps.length) bus.emit("done", { index: cursor });
    return { canceled: false };
  }

  async function loop() {
    while (playing && cursor < steps.length) await advanceOne();
    playing = false;
    playPromise = null;
  }

  function resolveIndex(indexOrLabel) {
    if (typeof indexOrLabel === "number") return Math.max(0, Math.min(steps.length, indexOrLabel));
    const i = steps.findIndex((s) => s.label === indexOrLabel);
    if (i === -1) throw new GraphError("storyboard-label", `unknown storyboard label "${indexOrLabel}"`);
    return i;
  }

  async function seek(indexOrLabel) {
    const idx = resolveIndex(indexOrLabel);
    if (snapshots.has(idx)) {
      // Backward (or revisited) seek: restore the pre-step snapshot and let the host's
      // own keyed diff animate from the current visual state (D8) — no replay needed.
      await host.restore(snapshots.get(idx));
      cursor = idx;
    } else {
      // Forward seek past ground never covered: there is no snapshot to restore *to*
      // yet, so reach it the only way ops are valid — apply steps in order.
      while (cursor < idx) await advanceOne();
    }
    bus.emit("seek", { index: idx, label: labelAt(idx) });
  }

  function play() {
    if (playing) return playPromise;
    playing = true;
    if (activeRun && typeof activeRun.run.play === "function") activeRun.run.play();
    playPromise = loop();
    return playPromise;
  }

  function pause() {
    playing = false;
    if (activeRun && typeof activeRun.run.pause === "function") activeRun.run.pause();
  }

  return {
    play, pause,
    next: () => advanceOne(),
    prev: () => seek(Math.max(0, cursor - 1)),
    seek,
    labels: () => steps.map((s, index) => ({ label: s.label, index })).filter((e) => e.label !== undefined),
    position() {
      // The label at cursor itself counts (a fresh seek(label) lands exactly there,
      // before that zero-duration entry has been "executed"), else the nearest one passed.
      let label = null;
      for (let i = Math.min(cursor, steps.length - 1); i >= 0; i--) {
        if (steps[i].label !== undefined) { label = steps[i].label; break; }
      }
      return { index: cursor, total: steps.length, done: cursor >= steps.length, label };
    },
    on: (type, fn) => bus.on(type, fn),
    off: (type, fn) => bus.off(type, fn),
  };
}

/** D8 sugar: one dispatch table. `timeline(g).addNode(...).label(...).build()` — the
 * array it returns is the ONLY primitive; `g` is accepted for API symmetry (unused here,
 * matches the sync signature `mount`/`g` use elsewhere) and reserved for future validation. */
const NAMED = {
  addNode: "addNode", addEdge: "addEdge", removeNode: "removeNode", removeEdge: "removeEdge",
  update: "update", expand: "expand", collapse: "collapse", condense: "condense", batch: "batch",
  run: "run.play", runStep: "run.step", runSeek: "run.seek",
};

export function timeline(_g) {
  const steps = [];
  const t = {
    to(op, ...args) {
      if (!OPS.has(op)) throw new GraphError("storyboard-op", `unknown storyboard op "${op}"`);
      steps.push(args.length ? { op, args } : { op });
      return t;
    },
    label(name) { steps.push({ label: name }); return t; },
    wait(ms) { steps.push({ op: "wait", ms }); return t; },
    build: () => steps,
  };
  for (const [name, op] of Object.entries(NAMED)) t[name] = (...args) => t.to(op, ...args);
  return t;
}
