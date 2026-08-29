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

/** Latest timestamp an event log reaches (0 for an empty one). */
function logFloor(log) {
  let max = 0;
  for (const e of log || []) { const et = +e.t; if (Number.isFinite(et) && et > max) max = et; }
  return max;
}

/** A private copy of a replayed state: the live transport memoizes its last replay, and
 *  consumers (run-render's progress floors, callers generally) write into what they get. */
const cloneEntries = (o) => { const out = {}; for (const k of Object.keys(o)) out[k] = { ...o[k] }; return out; };
function cloneState(s) {
  return {
    tokens: s.tokens.map((tk) => ({ ...tk, at: { ...tk.at } })),
    nodes: cloneEntries(s.nodes),
    edges: cloneEntries(s.edges),
    joins: cloneEntries(s.joins),
    loops: cloneEntries(s.loops),
    done: s.done,
  };
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
  const hostBus = internals.bus || null;
  const bus = emitter();

  const hopMs = Number.isFinite(opts.hopMs) && opts.hopMs >= 0 ? opts.hopMs : undefined;
  /** Edge id -> the live instant it entered the run. The log is HISTORY (D4: "time-travel
   *  into history"), so a finish written before an edge existed must not be re-resolved
   *  over it — without this, adding an edge retroactively fans a token out of a node that
   *  completed seconds ago, visible both live and when scrubbing back. */
  const edgeBornAt = new Map();
  const liveOpts = () => {
    const o = hopMs == null ? {} : { hopMs };
    if (edgeBornAt.size) o.bornAt = edgeBornAt;
    return o;
  };

  let log = (opts.log || []).map((e) => ({ ...e }));
  let logRev = 0;
  /** The frontier is how far this run's history reaches: real elapsed ms since creation,
   *  floored by any log it was seeded with (`opts.log`/`reset`) — otherwise seeded events
   *  are unreachable, since `t` is clamped to the frontier and nothing past 0 could be
   *  sampled. With no seed this is exactly the pinned "starts at 0". */
  let frontier = logFloor(log);
  let t = frontier;
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

  // ---- memoized replay --------------------------------------------------------------
  // state() is sampled on EVERY frame (the decoration layer draws off the "tick" this
  // transport emits unconditionally) and replayLive is a from-scratch O(events)
  // re-simulation. Nothing but the view time, the log and the spec can change the answer,
  // so key the last result on exactly those three and an idle live graph costs a
  // comparison per frame instead of a full replay.
  const revOf = () => (typeof store.rev === "number" ? store.rev : NaN); // NaN => never cache
  let cache = null;
  function stateAt(tt) {
    const rev = revOf();
    if (cache && cache.t === tt && cache.rev === rev && cache.logRev === logRev) return cloneState(cache.state);
    const st = replayLive(store.spec(), log, tt, liveOpts());
    cache = { t: tt, rev, logRev, state: st };
    return cloneState(st);
  }
  const touchLog = () => { logRev++; };

  /** `until` is a node's status, not a timestamp — and in live mode `t` is glued to the
   *  frontier by default, so consulting the frontier FIRST made every `play({until})` from
   *  the (normal) following state resolve on the spot with the target still pending. Mode A
   *  waits for the node; the shared surface has to mean the same thing in both modes. */
  function satisfied() {
    if (until != null) {
      const n = stateAt(t).nodes[until];
      return !n || n.status === "done"; // an unknown node can never fire — never hang on it
    }
    return t >= frontier;
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
    touchLog();
    bus.emit("start", { id, t: at });
    return at;
  }

  function finishNode(id, o) {
    if (destroyed) return t;
    const at = stampAt(o);
    const ev = { t: at, type: "finish", id };
    if (o && Number.isFinite(o.n)) ev.n = o.n;
    log.push(ev);
    touchLog();
    bus.emit("finish", { id, t: at, n: ev.n });
    return at;
  }

  function spawn(id, n, o) {
    if (destroyed) return t;
    const at = stampAt(o);
    log.push({ t: at, type: "spawn", id, n });
    touchLog();
    bus.emit("spawn", { id, t: at, n });
    return at;
  }

  function timeOf(nodeId) {
    for (const ev of log) if (ev.type === "finish" && ev.id === nodeId) return ev.t;
    return frontier;
  }

  /** Re-seeds the log (opts.log) under the same transport identity/listeners. The frontier
   *  restarts from the re-seeded log's own span, so a storyboard restore (`reset(options(),
   *  time)`, G2) round-trips losslessly instead of deleting the run's history — `time` is
   *  clamped against that NEW frontier. */
  function reset(o = {}, time = 0) {
    if (destroyed) return t;
    playing = false;
    until = null;
    const p = pending;
    pending = null;
    if (p) p.resolve({ canceled: true });
    log = (o.log || []).map((e) => ({ ...e }));
    touchLog();
    edgeBornAt.clear();
    frontier = logFloor(log);
    lastNow = ticker.now();
    t = Math.max(0, Math.min(frontier, Number.isFinite(+time) ? +time : 0));
    following = t >= frontier;
    bus.emit("seek", { time: t, duration: frontier });
    return t;
  }

  // ---- token <-> morph rule (D4) in Mode B ---------------------------------------------
  // Mode A answers a condense by recompiling; there is nothing to compile here, so the
  // equivalent is to rewrite HISTORY. The log names only nodes, so mapping every entry on a
  // removed source onto the surviving node is total: the survivor inherits its sources'
  // active/done instants and re-fans them out over the redirected edges. Leaving the log
  // alone instead means replayLive's `nodes.has(e.id)` filter silently drops all of it —
  // tokens vanish with no ghost-fade and `done` flips true mid-run.
  function remapLog(sources, target) {
    if (destroyed || !Array.isArray(sources) || target == null) return;
    const set = new Set(sources);
    let touched = false;
    for (const e of log) if (set.has(e.id)) { e.id = target; touched = true; }
    if (!touched) return;
    touchLog();
    const after = stateAt(t).nodes[target];
    bus.emit("remap", { sources, target, progress: after ? after.progress : 0, ghosts: [], time: t });
  }

  /** A split's history belongs on the ENTRY part (the one no sibling feeds), so it re-fans
   *  forward through the new internal wiring exactly as the source would have. */
  function entryOf(targets) {
    if (!targets || !targets.length) return null;
    const set = new Set(targets);
    const fed = new Set();
    for (const e of store.spec().edges || []) if (set.has(e.source) && set.has(e.target)) fed.add(e.target);
    return targets.find((id) => !fed.has(id)) ?? targets[0];
  }

  // There is no compiled artifact to invalidate here, but the host bus still carries two
  // things this transport alone can act on: id-remapping morphs, and when an edge was born.
  const offs = [];
  if (hostBus) {
    offs.push(hostBus.on("condense", (ev) => { if (ev) remapLog(ev.sources, ev.target); }));
    offs.push(hostBus.on("split", (ev) => { if (ev) remapLog([ev.source], entryOf(ev.targets)); }));
    // `bornAt` is a replay input like the log itself, so changing it invalidates the memo.
    offs.push(hostBus.on("add", (ev) => {
      if (ev && ev.kind === "edge" && ev.id != null) { edgeBornAt.set(ev.id, frontier); touchLog(); }
    }));
    offs.push(hostBus.on("remove", (ev) => {
      if (ev && ev.kind === "edge" && ev.id != null && edgeBornAt.delete(ev.id)) touchLog();
    }));
  }

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
    state: () => stateAt(t),
    sim: () => ({ duration: frontier, events: log.map((e) => ({ ...e })), stateAt }),
    /** Carries the LOG, not just the compile inputs: a storyboard snapshot/restore pair
     *  (`reset(options(), time)`) would otherwise silently delete a live run's history. */
    options: () => ({ hopMs, mode: "live", log: log.map((e) => ({ ...e })) }),
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
