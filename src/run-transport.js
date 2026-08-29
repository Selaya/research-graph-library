// g.run(opts) — the transport that drives a token schedule on the shared ticker (D1).
// Two engines, one transport surface: Mode A (src/run.js, compiled/declared) and Mode B
// (src/run-live.js, event-log/replayed). The engine is pure and stateless in both cases;
// everything time-shaped lives here: play/pause/seek, per-branch speed, step, and
// re-emission of the event stream.
//
// speed()/step() are NOT engine features (D4): in Mode A, speed() appends a rate event and
// recompiles against the same spec preserving the current virtual time — cheap at tens of
// nodes, and the past is provably unchanged because the engine only folds a rate in when a
// token ENTERS a node at t >= the event's t. step() walks the engine's own boundary index.
// In Mode B there is nothing to compile — see createLiveTransport below.

import { compileRun } from "./run.js";
import { replayLive, liveBoundaries } from "./run-live.js";
import { emitter } from "./events.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * createRunTransport(internals, opts) -> run
 *   internals = { ticker, store, bus }   (bus = the instance event bus, optional)
 *   opts      = compileRun opts ({ iterations, rates, hopMs, dwell }) + { mode, log }
 *   opts.mode: 'simulate' (default, Mode A) | 'live' (Mode B). opts.log seeds the live
 *   event log (re-seeding/tests).
 */
export function createRunTransport(internals, opts = {}) {
  return opts.mode === "live" ? createLiveTransport(internals, opts) : createSimTransport(internals, opts);
}

// =====================================================================================
// Mode A — simulate (unchanged behavior; only the outer function name/wrapper moved)
// =====================================================================================
function createSimTransport(internals, opts = {}) {
  const { ticker, store } = internals;
  const hostBus = internals.bus || null;
  const bus = emitter();

  // The compile inputs, kept live: speed() appends to `rates`, everything else is fixed.
  const base = {};
  if (opts.iterations) base.iterations = { ...opts.iterations };
  if (Number.isFinite(opts.hopMs)) base.hopMs = opts.hopMs;
  if (typeof opts.dwell === "function") base.dwell = opts.dwell;
  let rates = (opts.rates || []).map((r) => ({ ...r }));

  let sim = compileRun(store.spec(), { ...base, rates });
  let t = 0;              // virtual pipeline time, ms
  let cursor = 0;         // # of events at/below t already re-emitted
  let playing = false;
  let until = null;
  let pending = null;
  let lastNow = 0;
  let dirty = false;      // the spec changed under us; recompile on next read
  let destroyed = false;

  function syncCursor() {
    const evs = sim.events;
    cursor = 0;
    while (cursor < evs.length && evs[cursor].t <= t) cursor++;
  }

  function recompile() {
    sim = compileRun(store.spec(), { ...base, rates });
    dirty = false;
    if (t > sim.duration) t = sim.duration;
    syncCursor();
    bus.emit("recompile", { time: t, duration: sim.duration });
  }

  /** Lazy: a graph mutation only costs a recompile when someone actually samples. */
  function current() {
    if (dirty && !destroyed) recompile();
    return sim;
  }

  /** Forward moves replay the event stream; a backward scrub resyncs silently (D8 — a
   *  scrub is a state restore, not a re-run, so nothing double-fires). */
  function advanceTo(target, emit = true) {
    const s = current();
    const next = Math.max(0, Math.min(s.duration, Number.isFinite(+target) ? +target : 0));
    if (next < t || !emit) { t = next; syncCursor(); return t; }
    t = next;
    const evs = s.events;
    while (cursor < evs.length && evs[cursor].t <= t) {
      const ev = evs[cursor++];
      bus.emit(ev.type, ev);
    }
    return t;
  }

  /** play({until}) stops on a node's status, not a timestamp, so it survives a recompile. */
  function satisfied() {
    const s = current();
    if (t >= s.duration) return true;
    if (until == null) return false;
    const n = s.stateAt(t).nodes[until];
    return !n || n.status === "done"; // an unknown node can never fire — never hang on it
  }

  function endPlay(canceled = false) {
    if (playing) { playing = false; ticker.remove(frame); }
    until = null;
    const p = pending;
    pending = null;
    bus.emit(canceled ? "cancel" : "end", { time: t });
    if (p) p.resolve({ canceled });
  }

  function frame(now) {
    if (!playing) return;
    const dt = now - lastNow;
    lastNow = now;
    advanceTo(t + (dt > 0 ? dt : 0));
    bus.emit("tick", { time: t, duration: current().duration });
    if (satisfied()) endPlay();
  }

  function play(o = {}) {
    if (destroyed) return Promise.resolve({ canceled: true });
    until = o && o.until != null ? o.until : null;
    if (!pending) pending = deferred();
    const p = pending.promise;
    if (satisfied()) { endPlay(); return p; }
    if (!playing) {
      playing = true;
      lastNow = ticker.now();
      ticker.add(frame);
      bus.emit("play", { time: t, until });
    }
    return p;
  }

  function pause() {
    if (!playing) return t;
    playing = false;
    ticker.remove(frame);
    bus.emit("pause", { time: t }); // `pending` survives: play() resumes the same await
    return t;
  }

  function seek(ms) {
    advanceTo(ms, false);
    bus.emit("seek", { time: t, duration: current().duration });
    if (playing && satisfied()) endPlay();
    return t;
  }

  function speed(factor, o = {}) {
    if (!(Number.isFinite(factor) && factor >= 0)) return t;
    rates.push({ t, scope: o && o.branch != null ? o.branch : "*", factor });
    recompile();
    bus.emit("speed", { factor, branch: (o && o.branch) ?? null, time: t });
    if (playing && satisfied()) endPlay();
    return t;
  }

  /** step() = next boundary across all tokens; step({token}) = that branch's next boundary.
   *  Other branches share the one clock (D1) — freezing them would need a permanent rate 0. */
  function step(o = {}) {
    const s = current();
    const token = o && o.token != null ? o.token : undefined;
    const b = s.nextBoundary(t, token);
    advanceTo(b == null ? s.duration : b);
    bus.emit("step", { time: t, token: token ?? null });
    if (playing && satisfied()) endPlay();
    return t;
  }

  /** Re-seat the compile inputs and the clock IN PLACE (a storyboard restore, G2). Same
   *  transport object, same event bus — so `g.run()` identity and every listener a page
   *  registered on it survive a backward seek, which tearing the transport down and
   *  building a new one silently broke. */
  function reset(o = {}, time = 0) {
    if (destroyed) return t;
    if (playing) { playing = false; ticker.remove(frame); }
    until = null;
    const p = pending;
    pending = null;
    if (p) p.resolve({ canceled: true }); // whatever was awaiting the old position is void
    for (const k of Object.keys(base)) delete base[k];
    if (o.iterations) base.iterations = { ...o.iterations };
    if (Number.isFinite(o.hopMs)) base.hopMs = o.hopMs;
    if (typeof o.dwell === "function") base.dwell = o.dwell;
    rates = (o.rates || []).map((r) => ({ ...r }));
    t = 0;
    recompile();
    advanceTo(time, false); // silent: a restore is a state jump, not a re-run (D8)
    bus.emit("seek", { time: t, duration: current().duration });
    return t;
  }

  /** First moment `nodeId` is finished — what a `play({until})` step is worth on a
   *  storyboard's cumulative timeline. Falls back to the whole run. */
  function timeOf(nodeId) {
    const s = current();
    for (const ev of s.events) if (ev.type === "finish" && ev.nodeId === nodeId) return ev.t;
    return s.duration;
  }

  // --- Token <-> morph rule (D4) --------------------------------------------------
  // The store is already merged when `condense` fires (condense-anim phase 2), so sample
  // the OLD schedule first, then recompile against the new spec. Tokens sitting on the
  // removed sources hand the merged node their max(progress); the renderer ghost-fades them.
  function onCondense({ sources, target }) {
    if (destroyed || !Array.isArray(sources)) return;
    const before = current().stateAt(t);
    const set = new Set(sources);
    let progress = 0;
    for (const id of sources) {
      const n = before.nodes[id];
      if (n && n.progress > progress) progress = n.progress;
    }
    const ghosts = [];
    for (const tk of before.tokens) {
      if (tk.at.kind === "node" && set.has(tk.at.id)) ghosts.push({ id: tk.id, nodeId: tk.at.id });
    }
    dirty = true;
    recompile();
    bus.emit("remap", { sources, target, progress, ghosts, time: t });
  }

  const offs = [];
  if (hostBus) {
    offs.push(hostBus.on("condense", onCondense));
    for (const type of ["add", "remove", "update", "expand", "collapse"]) {
      offs.push(hostBus.on(type, () => { dirty = true; }));
    }
  }

  return {
    play, pause, seek, speed, step, timeOf, reset,
    /** Force a recompile against the live spec (used after a storyboard restore). */
    reload() { dirty = true; return current().duration; },
    get playing() { return playing; },
    get duration() { return current().duration; },
    /** The awaitable for the CURRENT play target — pause never resolves it (D8/storyboard). */
    get promise() { return pending ? pending.promise : Promise.resolve({ canceled: false }); },
    time: () => t,
    state: () => current().stateAt(t),
    sim: () => current(),
    /** The live compile inputs, for a storyboard snapshot's `runOpts` (G2). */
    options: () => ({ ...base, rates: rates.map((r) => ({ ...r })) }),
    on: (type, fn) => bus.on(type, fn),
    off: (type, fn) => bus.off(type, fn),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (playing) { playing = false; ticker.remove(frame); }
      for (const off of offs) if (typeof off === "function") off();
      offs.length = 0;
      const p = pending;
      pending = null;
      bus.emit("destroy", { time: t });
      if (p) p.resolve({ canceled: true });
    },
  };
}

// =====================================================================================
// Mode B — live (event-log replay, D4/M2)
// =====================================================================================
/**
 * The live transport owns two clocks:
 *   - `frontier`: real elapsed ms since the run was created. Advances on EVERY tick,
 *     unconditionally — paused, scrubbed, or idle, live time keeps flowing, because a real
 *     pipeline does not wait for a viewer.
 *   - `t`: the VIEW time being replayed. While `following` (the default) it is glued to
 *     `frontier` every tick — a live run just watches itself happen. `seek()` detaches
 *     (time-travel into history); `play()` catches the view back up to the frontier at 1×
 *     (× speed()) and re-attaches on arrival; `follow()` snaps back immediately. `t` can
 *     never exceed `frontier` — there is nothing to show past "now".
 * `start`/`finish`/`spawn` append to an event log; `state()` replays it fresh every call
 * (src/run-live.js is O(events), cheap at this scale) — there is no compiled artifact to
 * invalidate, so graph mutations need no dirty-tracking here: store.spec() is read live.
 */
function createLiveTransport(internals, opts = {}) {
  const { ticker, store } = internals;
  // internals.bus (the host's commit/mutation bus) needs no subscription here — see the
  // note by `offs` below.
  const bus = emitter();

  const hopMs = Number.isFinite(opts.hopMs) && opts.hopMs >= 0 ? opts.hopMs : undefined;
  const liveOpts = () => (hopMs == null ? {} : { hopMs });

  let log = (opts.log || []).map((e) => ({ ...e }));
  let frontier = 0;
  let t = 0;
  let following = true;
  let playing = false;
  let until = null;
  let pending = null;
  let viewSpeed = 1;
  let lastNow = ticker.now(); // seeded now, not at the first tick — otherwise the elapsed
                               // time between creation and that first callback is lost.
  let destroyed = false;

  function endPlay(canceled = false) {
    if (playing) playing = false;
    until = null;
    const p = pending;
    pending = null;
    bus.emit(canceled ? "cancel" : "end", { time: t });
    if (p) p.resolve({ canceled });
  }

  function satisfied() {
    if (t >= frontier) return true;
    if (until == null) return false;
    const n = replayLive(store.spec(), log, t, liveOpts()).nodes[until];
    return !n || n.status === "done";
  }

  /** The one always-on ticker callback (added at creation, removed at destroy): advances
   *  the frontier every frame regardless of playing/following, then moves the view clock. */
  function tick(now) {
    const dt = now - lastNow;
    lastNow = now;
    if (dt > 0) frontier += dt;
    if (following) {
      t = frontier;
    } else if (playing && dt > 0) {
      t = Math.min(frontier, t + dt * viewSpeed);
      if (t >= frontier) following = true;
    }
    bus.emit("tick", { time: t, duration: frontier });
    if (playing && satisfied()) endPlay();
  }
  ticker.add(tick);

  function play(o = {}) {
    if (destroyed) return Promise.resolve({ canceled: true });
    until = o && o.until != null ? o.until : null;
    if (!pending) pending = deferred();
    const p = pending.promise;
    if (satisfied()) { endPlay(); return p; }
    playing = true;
    bus.emit("play", { time: t, until });
    return p;
  }

  function pause() {
    playing = false;
    following = false; // freeze: stop tracking "now" until follow()/play() resumes
    bus.emit("pause", { time: t });
    return t;
  }

  /** Clamped to [0, frontier] — you can never scrub past "now" (D4/M2). Detaches. */
  function seek(ms) {
    following = false;
    t = Math.max(0, Math.min(frontier, Number.isFinite(+ms) ? +ms : 0));
    bus.emit("seek", { time: t, duration: frontier });
    if (playing && satisfied()) endPlay();
    return t;
  }

  /** Re-attach immediately (a "jump to live" snap, distinct from play()'s catch-up ramp). */
  function follow() {
    following = true;
    t = frontier;
    bus.emit("seek", { time: t, duration: frontier });
    if (playing && satisfied()) endPlay();
    return t;
  }

  /** Global only in live mode: scales the catch-up/playback rate of the VIEW clock. The
   *  frontier is real time and cannot be sped up; a `branch` scope is a documented no-op —
   *  live mode has no per-token rate concept (§5.4). */
  function speed(factor, o = {}) {
    if (!(Number.isFinite(factor) && factor >= 0)) return t;
    if (!o || o.branch == null) viewSpeed = factor;
    bus.emit("speed", { factor, branch: (o && o.branch) ?? null, time: t });
    return t;
  }

  /** Next logged event boundary after `t` (across the whole log — live mode has no
   *  per-token branch stepping); falls back to the frontier ("now") when there is none. */
  function step() {
    const bs = liveBoundaries(log);
    let next = frontier;
    for (const b of bs) { if (b > t && b <= frontier) { next = b; break; } }
    following = false;
    t = Math.min(frontier, next);
    if (t >= frontier) following = true;
    bus.emit("step", { time: t, token: null });
    if (playing && satisfied()) endPlay();
    return t;
  }

  function stampAt(o) {
    const at = o && Number.isFinite(+o.at) ? +o.at : frontier;
    return Math.max(0, Math.min(frontier, at));
  }

  function start(id, o) {
    if (destroyed) return t;
    const at = stampAt(o);
    log.push({ t: at, type: "start", id });
    bus.emit("start", { id, t: at });
    return at;
  }

  function finishNode(id, o) {
    if (destroyed) return t;
    const at = stampAt(o);
    const ev = { t: at, type: "finish", id };
    if (o && Number.isFinite(o.n)) ev.n = o.n;
    log.push(ev);
    bus.emit("finish", { id, t: at, n: ev.n });
    return at;
  }

  function spawn(id, n, o) {
    if (destroyed) return t;
    const at = stampAt(o);
    log.push({ t: at, type: "spawn", id, n });
    bus.emit("spawn", { id, t: at, n });
    return at;
  }

  function timeOf(nodeId) {
    for (const ev of log) if (ev.type === "finish" && ev.id === nodeId) return ev.t;
    return frontier;
  }

  /** Re-seeds the log (opts.log) and restarts the frontier from 0 — a fresh live session
   *  under the same transport identity/listeners. `time` is clamped against the NEW
   *  (just-reset) frontier, so it only has effect once the caller advances the ticker. */
  function reset(o = {}, time = 0) {
    if (destroyed) return t;
    playing = false;
    until = null;
    const p = pending;
    pending = null;
    if (p) p.resolve({ canceled: true });
    log = (o.log || []).map((e) => ({ ...e }));
    frontier = 0;
    lastNow = ticker.now();
    following = true;
    t = Math.max(0, Math.min(frontier, Number.isFinite(+time) ? +time : 0));
    bus.emit("seek", { time: t, duration: frontier });
    return t;
  }

  // No compiled artifact to invalidate in live mode (state() reads store.spec() fresh every
  // call) — mutations just need the decoration layer to re-index on the next "commit", which
  // internals.bus already delivers independent of the run transport, so there is nothing for
  // this transport itself to subscribe to on hostBus.
  const offs = [];

  return {
    play, pause, seek, speed, step, timeOf, reset,
    start, finish: finishNode, spawn, follow,
    get following() { return following; },
    reload() { return frontier; },
    get playing() { return playing; },
    get duration() { return frontier; },
    get promise() { return pending ? pending.promise : Promise.resolve({ canceled: false }); },
    time: () => t,
    now: () => frontier,
    log: () => log.map((e) => ({ ...e })),
    state: () => replayLive(store.spec(), log, t, liveOpts()),
    sim: () => ({ duration: frontier, events: log.map((e) => ({ ...e })), stateAt: (tt) => replayLive(store.spec(), log, tt, liveOpts()) }),
    options: () => ({ hopMs, mode: "live" }),
    on: (type, fn) => bus.on(type, fn),
    off: (type, fn) => bus.off(type, fn),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      playing = false;
      ticker.remove(tick);
      for (const off of offs) if (typeof off === "function") off();
      offs.length = 0;
      const p = pending;
      pending = null;
      bus.emit("destroy", { time: t });
      if (p) p.resolve({ canceled: true });
    },
  };
}

export default { createRunTransport };
