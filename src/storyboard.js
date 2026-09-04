// Storyboard: pure JSON-op sequencer (D8). No DOM, no ticker — the host owns everything
// stateful (mutation dispatch, snapshotting, restoring, run/wait timing). This module only
// walks the step array, snapshotting before each step (G2) and awaiting whatever
// host.apply() hands back.

import { GraphError } from "./store.js";
import { emitter } from "./events.js";

const OPS = new Set([
  "addNode", "addEdge", "removeNode", "removeEdge", "update",
  "expand", "collapse", "condense", "split", "batch",
  "run.play", "run.step", "run.seek", "wait",
  // M4 director ops — method-shaped like the mutations, so applyStep's default branch
  // dispatches them straight to g.camera/g.highlight/g.clearHighlight/g.caption.
  "camera", "highlight", "clearHighlight", "caption",
  // M4d — the per-step --smv-* override layer (D16); method-shaped like the rest.
  "props",
]);

/** The same --smv-* key-shape check director.setPropsMap() runs at commit time (D16), run
 *  again here so a malformed props step fails at build time like every other op does,
 *  instead of only once the storyboard reaches it mid-playback. `where` is the step's
 *  (possibly dotted, for a nested step) index, so the error still names its location. */
function validateProps(step, where) {
  const map = (step.args && step.args[0]) || null;
  for (const [id, p] of Object.entries(map || {})) {
    if (!p) continue;
    for (const k of Object.keys(p)) {
      if (!k.startsWith("--smv-")) {
        throw new GraphError(
          "props-key",
          `props only sets --smv-* properties (D7): "${k}" on "${id}" is not one (step ${where})`,
        );
      }
    }
  }
}

/** `where` prefixes a nested step's index with its parent's (batch children read "1.2"), so
 *  a typo anywhere in the tree still throws the library's own GraphError, step-indexed,
 *  instead of surfacing as a raw TypeError once playback reaches it. */
function validate(steps, where = "") {
  steps.forEach((step, i) => {
    const at = where ? `${where}.${i}` : `${i}`;
    if (step.op === undefined) {
      if (step.label === undefined) throw new GraphError("storyboard-step", `step ${at} needs an "op" or a "label"`);
      return;
    }
    if (!OPS.has(step.op)) throw new GraphError("storyboard-op", `unknown storyboard op "${step.op}" at step ${at}`);
    if (step.op === "props") validateProps(step, at);
    if (step.op === "batch") {
      // Same extraction applyOp's batch case uses: raw JSON gives `steps`, the fluent
      // builder gives `args[0]`.
      const list = Array.isArray(step.steps) ? step.steps : Array.isArray(step.args && step.args[0]) ? step.args[0] : [];
      validate(list, at);
    }
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
  // Two generation counters keep the single-writer invariant across suspension points.
  // `stepGen` invalidates an in-flight advanceOne() (a seek moved the ground under it, so
  // its cursor write and its "step" event are void). `loopGen` retires a play loop, so a
  // pause()+play() can never leave two loops walking one `cursor`.
  let stepGen = 0;
  let loopGen = 0;
  let inFlight = null;         // the advanceOne() currently owning `cursor`, if any

  const isLabelOnly = (step) => step.op === undefined;
  const labelAt = (idx) => (steps[idx] && steps[idx].label !== undefined ? steps[idx].label : null);

  async function advanceOne() {
    if (cursor >= steps.length) return { canceled: false };
    const myGen = stepGen;
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
      // A seek landed while this step was suspended: the restored snapshot is the truth
      // now, so this step must not advance the cursor or announce itself.
      if (myGen !== stepGen) return { canceled: true };
      activeRun = null;
    }
    cursor = idx + 1;
    bus.emit("step", { index: idx, step, result });
    if (cursor >= steps.length) bus.emit("done", { index: cursor });
    return { canceled: false };
  }

  /** At most ONE advanceOne() is ever in flight: a resumed play joins the suspended step
   *  instead of applying it a second time. */
  function runOne() {
    if (inFlight) return inFlight;
    const p = advanceOne().then(
      (r) => { if (inFlight === p) inFlight = null; return r; },
      (e) => { if (inFlight === p) inFlight = null; throw e; },
    );
    inFlight = p;
    return p;
  }

  async function loop() {
    const myGen = ++loopGen;
    while (playing && loopGen === myGen && cursor < steps.length) await runOne();
    if (loopGen !== myGen) return;   // retired by pause()/seek(); the live loop owns the flags
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
    // A seek is a state restore, not a nudge to the play head: stop the loop and void the
    // step that is still in flight FIRST, so nothing writes `cursor` behind the restore.
    // The storyboard stays paused afterwards — the caller (or the transport) resumes.
    const wasPlaying = playing;
    playing = false;
    loopGen++;
    playPromise = null;
    if (wasPlaying || inFlight) {
      stepGen++;
      inFlight = null;
      if (activeRun && typeof activeRun.run.pause === "function") activeRun.run.pause();
      activeRun = null;
    }
    if (snapshots.has(idx)) {
      // Backward (or revisited) seek: restore the pre-step snapshot and let the host's
      // own keyed diff animate from the current visual state (D8) — no replay needed.
      await host.restore(snapshots.get(idx));
      cursor = idx;
    } else {
      // Forward seek past ground never covered: there is no snapshot to restore *to*
      // yet, so reach it the only way ops are valid — apply steps in order.
      const myGen = stepGen;
      while (cursor < idx && stepGen === myGen) await runOne();
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
    // Retire the loop coroutine too: it may be suspended inside a step, and a later play()
    // must not leave it walking `cursor` alongside the loop it starts (the in-flight step
    // itself survives — play() rejoins it rather than applying it twice).
    loopGen++;
    playPromise = null;
    if (activeRun && typeof activeRun.run.pause === "function") activeRun.run.pause();
  }

  return {
    play, pause,
    next: () => runOne(),
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
  update: "update", expand: "expand", collapse: "collapse", condense: "condense", split: "split",
  batch: "batch",
  run: "run.play", runStep: "run.step", runSeek: "run.seek",
  camera: "camera", highlight: "highlight", clearHighlight: "clearHighlight", caption: "caption",
  props: "props",
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
    // A copy, not the live array: build() then chaining more steps onto `t` must not mutate
    // an array the caller already has in hand.
    build: () => [...steps],
  };
  for (const [name, op] of Object.entries(NAMED)) t[name] = (...args) => t.to(op, ...args);
  return t;
}
