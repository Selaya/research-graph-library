// Token engine — Mode A "simulate" (D4). PURE: no DOM, no imports from render/index/scene.
//
// Durations are declared, so a discrete-event compile pass runs ONCE up front (pop the
// soonest pending token event, push its successors) and produces a flat time-sorted
// schedule. Everything downstream — seek, scrub, per-branch speed, step() — is then just
// sampling that artifact, which is the whole reason Mode A exists (D4).
//
// The engine never mutates the graph: it decorates it from stateAt(t).

import { breakCycles } from "./cycles.js";

/** Loop iterations after the first are compressed in-place ticks, not re-flights (D4). */
const LOOP_TICK_MS = 250;
const DEFAULT_HOP_MS = 300;
const DWELL_BASE = 300;
const DWELL_SPAN = 1200;
const DWELL_NO_DURATION = 600;
/** Compile is bounded so a pathological spec can never hang the page. */
const MAX_STEPS = 100000;

const UNIT_SEC = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };
const DURATION_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(ms|s|m|h|d)?$/;

/** "2h" | "45m" | "8s" | "300ms" | 12 (already seconds) -> seconds; null when absent/bad.
 *  Negative values are rejected (null), not clamped: a leading '-' is almost always a typo
 *  or a unit mixup, and a negative dwell would give a segment t1 < t0, corrupting the
 *  time-sorted event order. The caller turns that null into a warning (see compileRun). */
export function parseDuration(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const m = DURATION_RE.exec(v.trim().toLowerCase());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * (m[2] ? UNIT_SEC[m[2]] : 1);
}

const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** Fraction of [t0,t1] elapsed at t. Infinite spans (rate 0 = frozen) never progress. */
function spanProgress(seg, t) {
  if (t <= seg.t0) return 0;
  if (!Number.isFinite(seg.t1)) return 0;
  if (!(seg.t1 > seg.t0)) return 1;
  return clamp01((t - seg.t0) / (seg.t1 - seg.t0));
}

function holds(seg, t) {
  return t >= seg.t0 && (t < seg.t1 || (seg.t1 === seg.t0 && t === seg.t0));
}

/**
 * compileRun(spec, opts) -> sim
 *   spec = a store.spec() snapshot
 *   opts = { iterations?: {[edgeId]: n}, rates?: [{t, scope: nodeId|'*', factor}],
 *            hopMs = 300, dwell?: (sec|null, ctx) => ms,
 *            entries?: [{ id, at }]  // extra seeds minted at `at` ms (run.inject, F3) }
 * Deterministic given (spec, opts).
 */
export function compileRun(spec = {}, opts = {}) {
  const nodes = new Map();
  for (const n of spec.nodes || []) if (n && n.id != null) nodes.set(n.id, n);
  const rawEdges = (spec.edges || []).filter((e) => e && nodes.has(e.source) && nodes.has(e.target));

  // D5 — a container is not an executable step: its activation IS its children's. It never
  // seeds a source token (otherwise every compound node fabricates a phantom one), and its
  // status window is the union of its descendants' below, so `play({until: container})`
  // means "until everything inside it has finished".
  const childrenOf = new Map();
  for (const n of nodes.values()) {
    if (n.parent == null || !nodes.has(n.parent)) continue;
    if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
    childrenOf.get(n.parent).push(n.id);
  }

  // ---- container attachment ----
  // An edge incident to a container means, here, exactly what it means for layout: it
  // gates (target) or is fed by (source) that container's interior entry/exit child.
  // viewstate.js does this remap for the picture; without the same remap the engine would
  // read the raw spec, never token a container, and silently strand everything downstream
  // of it. This is a deliberate local copy of viewstate.js's `attach()` semantics —
  // run.js is the pure engine and imports nothing from the view layer (D4), and the two
  // must be kept in step by hand. Only the collapse notion is dropped: run.js has no
  // collapsed set, and a container is never executable, so it always resolves to a leaf.
  const attachCache = new Map();
  /** The direct child of `cid` that `x` lives under, or undefined if x is outside. */
  const branchOf = (x, cid) => {
    const seenUp = new Set();
    let c = x;
    while (c !== undefined && nodes.has(c) && !seenUp.has(c)) {
      const p = nodes.get(c).parent;
      if (p === cid) return c;
      seenUp.add(c);
      c = p;
    }
    return undefined;
  };
  /** F9 — declared ports: `entry: [ids]` / `exit: [ids]` on a container spec name the
   *  children an incoming/outgoing edge attaches to, instead of the single inferred one.
   *  Any descendant is accepted (not just a direct child); an id from outside the
   *  container is a spec mistake, so it warns and is dropped. */
  function declaredPorts(id, kind) {
    const raw = nodes.get(id)[kind];
    if (!Array.isArray(raw) || !raw.length) return null;
    const out = [];
    for (const pid of raw) {
      if (nodes.has(pid) && branchOf(pid, id) !== undefined) { if (!out.includes(pid)) out.push(pid); }
      else console.warn(`[smv:run] container "${id}" declares ${kind} "${pid}", which is not inside it — ignored`);
    }
    return out.length ? out : null;
  }
  /** Every leaf an edge incident to `id` attaches to. One entry/exit unless the container
   *  declares several, so the historical single-port behaviour is exactly the default. */
  function attachAll(id, kind) {
    const key = `${id} ${kind}`;
    if (attachCache.has(key)) return attachCache.get(key);
    attachCache.set(key, [id]); // also stops a malformed containment cycle recursing forever
    const list = childrenOf.get(id) || [];
    let out = [id];
    if (list.length) {
      let picks = declaredPorts(id, kind);
      if (!picks) {
        // entry = a branch nothing inside points at; exit = a branch that points at nothing inside.
        const blocked = new Set();
        for (const e of rawEdges) {
          const bs = branchOf(e.source, id), bt = branchOf(e.target, id);
          if (bs === undefined || bt === undefined || bs === bt) continue;
          blocked.add(kind === "entry" ? bt : bs);
        }
        const pick = list.find((c) => !blocked.has(c));
        picks = [pick !== undefined ? pick : (kind === "entry" ? list[0] : list[list.length - 1])];
      }
      out = [];
      for (const p of picks) for (const r of attachAll(p, kind)) if (!out.includes(r)) out.push(r);
      if (!out.length) out = [id];
    }
    attachCache.set(key, out);
    return out;
  }
  // One spec edge can now become SEVERAL engine edges (a fan-out into a multi-entry
  // container, a join out of a multi-exit one). They keep the spec's `id` — so segments,
  // `loop` events and `opts.iterations` still name the arc the reader drew — and carry a
  // unique `key` for the structural bookkeeping (cycle cutting, consumed-loop tracking).
  let edgeSeq = 0;
  const edges = [];
  for (const e of rawEdges) {
    const srcs = attachAll(e.source, "exit");
    const tgts = attachAll(e.target, "entry");
    const one = srcs.length === 1 && tgts.length === 1;
    for (const source of srcs) {
      for (const target of tgts) edges.push({ ...e, source, target, key: one ? e.id : `${e.id}#${edgeSeq++}` });
    }
  }

  // ---- untagged cycles ----
  // The store accepts a cycle that carries no `loop: true` (cycles.js renders one as a
  // loop-back arc), so the engine must not read its back edge as an ordinary in-edge:
  // that would inflate the target's implicit AND-join arity into a permanent deadlock and
  // suppress the seeding of every node on the cycle. Break the cycle the same way the
  // layout does and treat the back edge as a zero-iteration loop — out of `inNonLoop`, and
  // out of the token flow. Explicit `loop: true` edges keep their own (iterating) path.
  const back = new Set();
  const byKey = new Map(edges.map((e) => [e.key, e]));
  for (const key of breakCycles([...nodes.values()], edges.map((e) => ({ id: e.key, source: e.source, target: e.target, loop: e.loop })))) {
    const e = byKey.get(key);
    if (e && !e.loop) back.add(key);
  }
  for (const e of edges) if (!e.loop && e.source === e.target) back.add(e.key); // cycles.js ignores self-loops

  const outNormal = new Map();
  const outLoop = new Map();
  const inNonLoop = new Map();
  for (const id of nodes.keys()) { outNormal.set(id, []); outLoop.set(id, []); inNonLoop.set(id, []); }
  for (const e of edges) {
    if (back.has(e.key)) continue;
    (e.loop ? outLoop : outNormal).get(e.source).push(e);
    if (!e.loop) inNonLoop.get(e.target).push(e);
  }

  // ---- events (declared early: bad-duration warnings below are emitted at compile time,
  // before the discrete-event queue that produces the rest of the schedule even exists) ----
  const events = [];
  const emit = (ev) => { events.push(ev); };
  /** A duration was given but didn't parse (bad string, negative, wrong type): that's
   *  silent data loss otherwise. Say so once per compile, both to the console and as a
   *  'warn' event a caller on the run bus can act on (run-transport.js forwards every sim
   *  event by its `type`, so this needs no extra plumbing there). */
  function badDuration(kind, id, raw, fallback) {
    console.warn(`compileRun: ${kind} "${id}" has an unparseable duration (${JSON.stringify(raw)}); falling back to ${fallback}`);
    emit({ t: 0, type: "warn", [kind === "node" ? "nodeId" : "edgeId"]: id, message: "unparseable duration", value: raw });
  }

  // ---- pacing ----
  const hopMs = Number.isFinite(opts.hopMs) && opts.hopMs >= 0 ? opts.hopMs : DEFAULT_HOP_MS;
  const secOf = new Map();
  let maxSec = 0;
  for (const n of nodes.values()) {
    const raw = n.data && n.data.duration;
    const s = parseDuration(raw);
    if (s == null && raw != null) badDuration("node", n.id, raw, `the ${DWELL_NO_DURATION}ms default`);
    secOf.set(n.id, s);
    if (s != null && s > maxSec) maxSec = s;
  }
  // F8 — an edge may declare its own crossing time in the SAME grammar, paced by the same
  // formula as a node dwell, so a 1ms local call and a 400ms cross-region call read
  // differently. `hopMs` stays the default for an edge that declares nothing; declared edge
  // times count towards maxSec, so a five-minute wire compresses the boxes, not vice versa.
  const hopSecOf = new Map();
  for (const e of rawEdges) {
    const raw = e.data && e.data.duration;
    const s = parseDuration(raw);
    if (s == null && raw != null) badDuration("edge", e.id, raw, "the hopMs default");
    hopSecOf.set(e.id, s);
    if (s != null && s > maxSec) maxSec = s;
  }
  // ---- declared failure (Mode A's counterpart to live mode's run.fail(id)) ----
  // `data.fail` sits next to `data.duration` and reads the same way: it is part of the
  // declared truth this mode compiles. Truthy = this step runs its dwell and then fails;
  // a string is carried through as the `reason` on the emitted event (nothing else reads
  // it — a reason is annotation, not state).
  // The object form `{ reason, retries, recover }` (F1) adds the retry budget: `retries: n`
  // means n more attempts after the first, and 'failed' only becomes terminal once they are
  // spent. `recover: true` makes that last attempt succeed instead ("fail, retry, pass").
  // `fail: true` / `fail: "reason"` keep exactly today's behaviour: one attempt, terminal.
  const failSpec = new Map(); // nodeId -> {reason, retries, declared, recover}
  for (const n of nodes.values()) {
    const f = n.data && n.data.fail;
    if (!f) continue;
    if (typeof f === "object") {
      const r = Number(f.retries);
      const declared = Number.isFinite(r) && r >= 0;
      failSpec.set(n.id, {
        reason: typeof f.reason === "string" ? f.reason : undefined,
        retries: declared ? Math.floor(r) : 0, declared, recover: !!f.recover,
      });
    } else failSpec.set(n.id, { reason: typeof f === "string" ? f : undefined, retries: 0, declared: false, recover: false });
  }
  /** F4 — when a seed's token appears on the compiled clock. A number is ms; a string goes
   *  through the duration grammar (seconds), so `startAt: "2s"` reads like everything else. */
  function startAtOf(n) {
    const raw = n.data && n.data.startAt;
    if (raw == null) return 0;
    const sec = typeof raw === "number" ? raw / 1000 : parseDuration(raw);
    if (sec == null || !(sec >= 0)) {
      console.warn(`[smv:run] node "${n.id}" has an unparseable startAt (${JSON.stringify(raw)}); seeding at 0`);
      emit({ t: 0, type: "warn", nodeId: n.id, message: "unparseable startAt", value: raw });
      return 0;
    }
    return sec * 1000;
  }

  const dwellFn = typeof opts.dwell === "function" ? opts.dwell : null;
  const dwellOf = new Map();
  for (const id of nodes.keys()) {
    const sec = secOf.get(id);
    let ms = sec == null ? DWELL_NO_DURATION : DWELL_BASE + DWELL_SPAN * (maxSec > 0 ? sec / maxSec : 0);
    if (dwellFn) {
      const o = dwellFn(sec, { id, node: nodes.get(id), maxSec, default: ms });
      if (Number.isFinite(o) && o >= 0) ms = o;
    }
    dwellOf.set(id, ms);
  }
  const paced = (sec) => DWELL_BASE + DWELL_SPAN * (maxSec > 0 ? sec / maxSec : 0);
  const hopMsOf = new Map();
  for (const e of rawEdges) {
    const sec = hopSecOf.get(e.id);
    hopMsOf.set(e.id, sec == null ? hopMs : paced(sec));
  }
  /** This edge's crossing time in ms: its own declared duration, else the global hopMs. */
  const hopFor = (e) => { const v = hopMsOf.get(e.id); return v == null ? hopMs : v; };

  // ---- rates ----
  // A rate event folds into a token's multiplier ONCE (tracked per token, inherited by
  // children): a '*' event lands the next time the token enters any node, a node-scoped
  // one when it enters that node. Re-applying per hop would compound it, which is not
  // what "children inherit" means.
  const rates = (opts.rates || [])
    .filter((r) => r && Number.isFinite(r.factor) && r.factor >= 0)
    .map((r) => ({ t: Number.isFinite(r.t) ? r.t : 0, scope: r.scope == null ? "*" : r.scope, factor: r.factor }));

  function iterationsFor(e) {
    const max = e.maxIterations > 0 ? Math.floor(e.maxIterations) : 0;
    const want = opts.iterations && opts.iterations[e.id] != null ? Number(opts.iterations[e.id]) : max;
    if (!Number.isFinite(want) || want < 0) return max;
    return Math.min(Math.floor(want), max);
  }

  // ---- join policies (expected = # non-loop in-edges) ----
  const joinStates = new Map();
  for (const id of nodes.keys()) {
    const expected = inNonLoop.get(id).length;
    const declared = nodes.get(id).join;
    // Implicit fan-out is an AND-split, so an unannotated fan-in is its AND-join mirror.
    if (declared == null && expected < 2) continue;
    const policy = declared == null ? "all" : declared;
    let needed;
    if (policy === "any") needed = 1;
    else if (policy && typeof policy === "object" && Number.isFinite(policy.count)) {
      needed = Math.max(1, Math.min(Math.floor(policy.count), Math.max(expected, 1)));
    } else needed = Math.max(1, expected);
    joinStates.set(id, { policy, needed, expected, arrivals: [], waiting: [], fireT: null, dropped: 0 });
  }

  // ---- discrete-event machinery ----
  const tokens = [];
  /** nodeId -> the EARLIEST instant it failed. A node can be entered by several tokens
   *  (fan-in, loop), so the first failure is what the status window turns on. */
  const failedAt = new Map();
  const noteFail = (id, t) => { const p = failedAt.get(id); if (p == null || t < p) failedAt.set(id, t); };
  const loopTimeline = new Map(); // edgeId -> [{iteration, t}]
  const loopMax = new Map();
  for (const e of edges) if (e.loop) { loopTimeline.set(e.id, []); loopMax.set(e.id, e.maxIterations || 0); }
  let tokenSeq = 0;
  let qSeq = 0;
  const queue = [];

  function push(t, fn) {
    const item = { t, seq: qSeq++, fn };
    let lo = 0, hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = queue[mid];
      if (q.t < t || (q.t === t && q.seq < item.seq)) lo = mid + 1; else hi = mid;
    }
    queue.splice(lo, 0, item);
  }

  function newToken(rate, applied, loopsUsed, parentId) {
    const tk = { id: `t${tokenSeq++}`, rate, applied, loopsUsed, parentId, segments: [], endT: Infinity, attempts: new Map() };
    tokens.push(tk);
    return tk;
  }
  /** An `onFail: true` loop edge is the failing node's retry arc: it fires ONLY out of a
   *  failure (exitNode skips it), and its iteration budget is that node's retry budget. */
  const onFailEdge = (id) => { for (const e of outLoop.get(id) || []) if (e.onFail) return e; return null; };
  function retriesFor(nodeId, fs) {
    let n;
    if (fs.declared) n = fs.retries;
    else { const e = onFailEdge(nodeId); n = e ? iterationsFor(e) : 0; }
    // `recover` describes a failure that is survived, so it implies at least one real
    // failing attempt — otherwise a declared failure would produce no `fail` event at all.
    return fs.recover && n < 1 ? 1 : n;
  }

  function applyRates(tk, nodeId, t) {
    for (let i = 0; i < rates.length; i++) {
      if (tk.applied.has(i)) continue;
      const r = rates[i];
      if (r.t > t) continue;
      if (r.scope !== "*" && r.scope !== nodeId) continue;
      tk.applied.add(i);
      tk.rate *= r.factor;
    }
    if (!(tk.rate > 0)) tk.rate = 0; // factor 0 freezes this branch for good
  }

  const scale = (ms, rate) => (rate > 0 ? ms / rate : Infinity);

  function segment(tk, seg) { seg.rate = tk.rate; tk.segments.push(seg); return seg; }
  function endToken(tk, t) { tk.endT = t; }

  function arrive(tk, nodeId, t, viaEdgeId, seed) {
    applyRates(tk, nodeId, t);
    emit({ t, type: "enter", tokenId: tk.id, nodeId, edgeId: viaEdgeId });
    // A seed does not come through an in-edge, so it must not fill one of the join's slots
    // (that would fire an AND-join an arrival early and drop a genuine upstream token).
    // It simply starts working alongside whatever the join is still waiting for.
    const st = seed ? null : joinStates.get(nodeId);
    if (!st) return startDwell(tk, nodeId, t);
    if (st.fireT != null) {
      // The policy already fired: this branch's work is moot (ghost-fade in the renderer).
      st.dropped++;
      emit({ t, type: "drop", tokenId: tk.id, nodeId, edgeId: viaEdgeId });
      endToken(tk, t);
      return;
    }
    st.arrivals.push({ t, tokenId: tk.id });
    if (st.arrivals.length >= st.needed) {
      st.fireT = t;
      emit({
        t, type: "join", nodeId, tokenId: tk.id,
        arrived: st.arrivals.length, needed: st.needed,
        merged: st.waiting.map((w) => w.tk.id),
      });
      for (const w of st.waiting) { w.seg.t1 = t; endToken(w.tk, t); }
      st.waiting.length = 0;
      startDwell(tk, nodeId, t);
    } else {
      // Held at the join with no dwell progress until the policy fires.
      st.waiting.push({ tk, seg: segment(tk, { kind: "node", id: nodeId, t0: t, t1: Infinity, wait: true }) });
    }
  }

  function startDwell(tk, nodeId, t) {
    const d = scale(dwellOf.get(nodeId), tk.rate);
    emit({ t, type: "start", tokenId: tk.id, nodeId, dwellMs: d });
    segment(tk, { kind: "node", id: nodeId, t0: t, t1: t + d });
    if (!Number.isFinite(d)) return;
    push(t + d, () => {
      // A declared failure runs the dwell in full and then ends here: no 'finish', no
      // loop, no fan-out. The token is closed rather than stranded, so a failing branch
      // reports the run 'done' instead of 'stalled' — nothing is still moving.
      // With a retry budget (F1) the attempt is NOT terminal: nothing is noted on the
      // node's status, the token goes round the retry arc (or straight back into its own
      // dwell) and tries again. 'failed' only sticks once the budget is spent.
      const fs = failSpec.get(nodeId);
      if (fs) { failAttempt(tk, nodeId, t + d, fs); return; }
      emit({ t: t + d, type: "finish", tokenId: tk.id, nodeId });
      exitNode(tk, nodeId, t + d);
    });
  }

  function failAttempt(tk, nodeId, t, fs) {
    const attempt = (tk.attempts.get(nodeId) || 0) + 1;
    tk.attempts.set(nodeId, attempt);
    const retries = retriesFor(nodeId, fs);
    const ev = { t, type: "fail", tokenId: tk.id, nodeId, attempt, retries, terminal: attempt > retries };
    if (fs.reason !== undefined) ev.reason = fs.reason;
    if (attempt > retries) {
      // Out of retries. `recover: true` says the last attempt is the one that works, so it
      // finishes and fans out normally instead — the "fail, retry, pass" story, declared.
      if (fs.recover) {
        emit({ t, type: "finish", tokenId: tk.id, nodeId, attempt });
        exitNode(tk, nodeId, t);
        return;
      }
      emit(ev);
      noteFail(nodeId, t);
      endToken(tk, t);
      return;
    }
    emit(ev);
    const e = onFailEdge(nodeId);
    const hop = e ? scale(hopFor(e), tk.rate) : 0;
    const to = e ? e.target : nodeId;
    if (e) {
      // The budget — not the arc's raw maxIterations, which `data.fail.retries` overrides —
      // is what a `iter 2/3` badge must read, so the event and loops[id].max carry it.
      loopMax.set(e.id, retries);
      emit({ t, type: "loop", tokenId: tk.id, edgeId: e.id, nodeId: to, iteration: attempt, max: retries });
      loopTimeline.get(e.id).push({ iteration: attempt, t });
      segment(tk, { kind: "edge", id: e.id, t0: t, t1: t + hop });
    } else {
      // No arc to hang it on: the retry still gets a `loop` event so narration has one
      // vocabulary for "attempt i of n", with a null edgeId.
      emit({ t, type: "loop", tokenId: tk.id, edgeId: null, nodeId, iteration: attempt, max: retries });
    }
    if (!Number.isFinite(hop)) return;
    push(t + hop, () => {
      // Deliberately not arrive(): a retry must not be gated by (or counted into) the
      // target's join, which has already fired for the attempt that just failed. It does
      // fold in rate events, exactly as every other node entry does.
      applyRates(tk, to, t + hop);
      emit({ t: t + hop, type: "enter", tokenId: tk.id, nodeId: to, edgeId: e ? e.id : undefined });
      startDwell(tk, to, t + hop);
    });
  }

  /** Leaving node `nodeId`: an unconsumed loop out-edge wins, otherwise implicit fan-out. */
  function exitNode(tk, nodeId, t) {
    for (const e of outLoop.get(nodeId)) {
      if (e.onFail) continue; // a retry arc fires out of a failure, never out of a finish
      if (tk.loopsUsed.has(e.key)) continue;
      tk.loopsUsed.add(e.key);
      const n = iterationsFor(e);
      if (n <= 0) continue; // capped to zero: behave as if the loop were not there
      emit({ t, type: "loop", tokenId: tk.id, edgeId: e.id, nodeId, iteration: 1, max: e.maxIterations });
      loopTimeline.get(e.id).push({ iteration: 1, t });
      const hop = scale(hopFor(e), tk.rate);
      segment(tk, { kind: "edge", id: e.id, t0: t, t1: t + hop });
      if (Number.isFinite(hop)) push(t + hop, () => loopTicks(tk, e, nodeId, 2, n, t + hop));
      return;
    }
    fanOut(tk, nodeId, t);
  }

  /**
   * Iteration 1 flew the arc; 2..n are in-place ticks hosted on the arc's landing node
   * (D4 — no re-fly), after which the token proceeds through the loop SOURCE's normal
   * out-edges, which is where the loop's exit path hangs.
   */
  function loopTicks(tk, e, sourceNodeId, i, n, t) {
    if (i > n) { exitNode(tk, sourceNodeId, t); return; }
    const d = scale(LOOP_TICK_MS, tk.rate);
    emit({ t, type: "loop", tokenId: tk.id, edgeId: e.id, nodeId: e.target, iteration: i, max: e.maxIterations });
    loopTimeline.get(e.id).push({ iteration: i, t });
    segment(tk, { kind: "node", id: e.target, t0: t, t1: t + d, loop: { edgeId: e.id, iteration: i } });
    if (Number.isFinite(d)) push(t + d, () => loopTicks(tk, e, sourceNodeId, i + 1, n, t + d));
  }

  /** k non-loop out-edges -> k tokens. The first continues this token's identity. */
  function fanOut(tk, nodeId, t) {
    const outs = outNormal.get(nodeId);
    if (!outs.length) { endToken(tk, t); return; }
    for (let k = 0; k < outs.length; k++) {
      const e = outs[k];
      const child = k === 0 ? tk : newToken(tk.rate, new Set(tk.applied), new Set(tk.loopsUsed), tk.id);
      if (child !== tk) emit({ t, type: "spawn", tokenId: child.id, parentId: tk.id, nodeId, edgeId: e.id });
      const hop = scale(hopFor(e), child.rate);
      segment(child, { kind: "edge", id: e.id, t0: t, t1: t + hop });
      if (Number.isFinite(hop)) push(t + hop, () => arrive(child, e.target, t + hop, e.id));
    }
  }

  // ---- seeds ----
  // A root (no non-loop in-edges) still seeds itself, now at its declared `data.startAt`
  // rather than unconditionally at 0 (F4). `data.entry: true` declares an EXTRA seed on a
  // node that is not a root (F3) — the compensation branch of a saga, a token refresh —
  // and `opts.entries` is the same thing minted imperatively by `run.inject()`.
  const seeds = [];
  for (const n of nodes.values()) {
    if (childrenOf.has(n.id)) continue; // containers run through their children (D5)
    if (inNonLoop.get(n.id).length === 0 || (n.data && n.data.entry)) seeds.push({ id: n.id, at: startAtOf(n) });
  }
  for (const inj of opts.entries || []) {
    if (!inj || !nodes.has(inj.id)) continue;
    const at = Number.isFinite(+inj.at) && +inj.at >= 0 ? +inj.at : 0;
    for (const id of attachAll(inj.id, "entry")) seeds.push({ id, at });
  }
  // A start instant only means something for a token that is MINTED, not one that arrives:
  // say so rather than dropping it silently (add `entry: true` to seed the node).
  for (const n of nodes.values()) {
    if (!(n.data && n.data.startAt != null) || seeds.some((sd) => sd.id === n.id)) continue;
    console.warn(`[smv:run] node "${n.id}" declares startAt but is not a seed; ignored`);
    emit({ t: 0, type: "warn", nodeId: n.id, message: "startAt on a non-seed", value: n.data.startAt });
  }
  seeds.sort((a, b) => a.at - b.at);
  // Queued rather than called: a seed with a later `at` must not record its join arrival
  // before an earlier token's. At the all-zero default this is byte-identical to before.
  for (const sd of seeds) {
    const tk = newToken(1, new Set(), new Set(), null);
    push(sd.at, () => arrive(tk, sd.id, sd.at, undefined, true));
  }
  let steps = 0;
  while (queue.length && steps++ < MAX_STEPS) queue.shift().fn();

  // ---- index the schedule for sampling ----
  events.sort((a, b) => a.t - b.t); // emission order is already non-decreasing; sort is stable

  const nodeSegs = new Map();
  const edgeSegs = new Map();
  for (const id of nodes.keys()) nodeSegs.set(id, []);
  for (const e of edges) if (!edgeSegs.has(e.id)) edgeSegs.set(e.id, []);
  let duration = 0;
  for (const tk of tokens) {
    for (const seg of tk.segments) {
      const bucket = seg.kind === "node" ? nodeSegs.get(seg.id) : edgeSegs.get(seg.id);
      if (bucket) bucket.push(seg);
      if (Number.isFinite(seg.t1) && seg.t1 > duration) duration = seg.t1;
    }
  }
  for (const ev of events) if (Number.isFinite(ev.t) && ev.t > duration) duration = ev.t;

  // Node status is derived from a first/last window so it can only ever move
  // pending -> active -> done, including across a loop's in-place ticks.
  const nodeWindow = new Map();
  for (const [id, segs] of nodeSegs) {
    if (!segs.length) { nodeWindow.set(id, null); continue; }
    let from = Infinity, to = 0;
    for (const s of segs) { if (s.t0 < from) from = s.t0; if (s.t1 > to) to = s.t1; }
    nodeWindow.set(id, { from, to });
  }
  // …and a container's window is the union of its descendants' (D5, see above). Bottom-up
  // by recursion; `rolled` also stops a malformed parent cycle from recursing forever.
  const rolled = new Set();
  function rollUp(id) {
    if (rolled.has(id)) return nodeWindow.get(id);
    rolled.add(id);
    let win = nodeWindow.get(id);
    for (const c of childrenOf.get(id) || []) {
      const cw = rollUp(c);
      if (!cw) continue;
      win = win ? { from: Math.min(win.from, cw.from), to: Math.max(win.to, cw.to) } : { from: cw.from, to: cw.to };
    }
    nodeWindow.set(id, win || null);
    return win || null;
  }
  for (const id of childrenOf.keys()) rollUp(id);
  // A container is not an executable step, so it can never carry `data.fail` itself — but it
  // must not report 'done' when the work inside it did not succeed. HOW a descendant's
  // failure rolls up is a per-container policy, `statusAgg`, mirroring `durationAgg`:
  //   'earliest-fail' (default) — failed from the earliest descendant failure onward.
  //   'latest'                  — the most recent descendant outcome wins, so a retried
  //                               call that succeeds later clears the container again.
  //   'none'                    — a descendant's failure never tints the container.
  // Each container reads its own leaf descendants (nested containers roll up through the
  // same leaves), so the policies never have to agree with each other.
  const statusMarks = new Map(); // container id -> ascending [{t, fail}], 'latest' only
  for (const id of childrenOf.keys()) {
    let agg = nodes.get(id) && nodes.get(id).statusAgg;
    if (agg != null && agg !== "earliest-fail" && agg !== "latest" && agg !== "none") {
      // `[smv:<area>]` is the library-wide misuse-warning prefix; the older unparseable-
      // duration warning above predates it and keeps its `compileRun:` form.
      console.warn(`[smv:run] node "${id}" has an unknown statusAgg (${JSON.stringify(agg)}); using 'earliest-fail'`);
      agg = null;
    }
    if (agg === "none") continue;
    const marks = [];
    const stack = [...childrenOf.get(id)];
    const walked = new Set();
    while (stack.length) {
      const c = stack.pop();
      if (walked.has(c)) continue;
      walked.add(c);
      if (childrenOf.has(c)) { for (const k of childrenOf.get(c)) stack.push(k); continue; }
      const f = failedAt.get(c), win = nodeWindow.get(c);
      if (f != null) marks.push({ t: f, fail: true });
      else if (win) marks.push({ t: win.to, fail: false });
    }
    if (agg === "latest") {
      // Ties sort failure last so a success landing on the same instant never hides it.
      marks.sort((a, b) => a.t - b.t || (a.fail ? 1 : 0) - (b.fail ? 1 : 0));
      if (marks.length) statusMarks.set(id, marks);
      continue;
    }
    let at = null;
    for (const m of marks) if (m.fail && (at == null || m.t < at)) at = m.t;
    if (at != null) failedAt.set(id, at);
  }

  const stalled = tokens.some((tk) => !Number.isFinite(tk.endT));
  events.push({ t: duration, type: "done", stalled });

  const boundaries = [];
  const perToken = new Map();
  for (const ev of events) {
    if (!Number.isFinite(ev.t)) continue;
    if (boundaries[boundaries.length - 1] !== ev.t) boundaries.push(ev.t);
    // A join's fire time is a boundary for every token it consumed, so step({token})
    // on a token waiting at a join lands on the fire rather than running out of events.
    for (const key of [ev.tokenId, ev.parentId, ...(ev.merged || [])]) {
      if (key == null) continue;
      let list = perToken.get(key);
      if (!list) perToken.set(key, (list = []));
      if (list[list.length - 1] !== ev.t) list.push(ev.t);
    }
  }

  function segAt(tk, t) {
    let degenerate = null;
    for (const seg of tk.segments) {
      if (t >= seg.t0 && t < seg.t1) return seg;
      if (!degenerate && seg.t1 === seg.t0 && t === seg.t0) degenerate = seg;
    }
    return degenerate;
  }

  function stateAt(tIn) {
    const t = Math.max(0, Number.isFinite(+tIn) ? +tIn : 0);

    const tokensOut = [];
    for (const tk of tokens) {
      const seg = segAt(tk, t);
      if (!seg) continue;
      tokensOut.push({
        id: tk.id,
        rate: seg.rate,
        at: { kind: seg.kind, id: seg.id, progress: seg.wait ? 0 : spanProgress(seg, t) },
      });
    }

    const nodesOut = {};
    for (const [id, segs] of nodeSegs) {
      const win = nodeWindow.get(id);
      let status = "pending", progress = 0, occupancy = 0;
      if (win) {
        const fAt = failedAt.get(id);
        // 'failed' outranks 'done' from the failure instant on: both are terminal, and the
        // window's `to` for a failing node IS that instant.
        let failed = fAt != null && t >= fAt;
        const marks = statusMarks.get(id);
        // statusAgg:'latest' — whichever descendant finished most recently is the story.
        if (marks) { failed = false; for (const m of marks) { if (m.t > t) break; failed = m.fail; } }
        status = failed ? "failed"
          : t >= win.to ? "done" : t >= win.from ? "active" : "pending";
        for (const s of segs) {
          if (holds(s, t)) occupancy++;
          if (s.wait) continue; // waiting at a join is not dwell progress
          const p = spanProgress(s, t);
          if (p > progress) progress = p;
        }
        // A container dwells for nothing itself: its fill is how far through its children's
        // combined span it has come, so a collapsed one still reads as working (D5).
        if (!segs.length) progress = win.to > win.from ? clamp01((t - win.from) / (win.to - win.from)) : (t >= win.to ? 1 : 0);
      }
      nodesOut[id] = { status, progress, occupancy };
    }

    const edgesOut = {};
    for (const [id, segs] of edgeSegs) {
      let traversed = 0;
      for (const s of segs) { const p = spanProgress(s, t); if (p > traversed) traversed = p; }
      edgesOut[id] = { traversed };
    }

    const joinsOut = {};
    for (const [id, st] of joinStates) {
      let arrived = 0;
      for (const a of st.arrivals) if (a.t <= t) arrived++;
      joinsOut[id] = { arrived, needed: st.needed, fired: st.fireT != null && t >= st.fireT };
    }

    const loopsOut = {};
    for (const [id, marks] of loopTimeline) {
      let iteration = 0;
      for (const m of marks) if (m.t <= t && m.iteration > iteration) iteration = m.iteration;
      loopsOut[id] = { iteration, max: loopMax.get(id) };
    }

    return {
      tokens: tokensOut, nodes: nodesOut, edges: edgesOut,
      joins: joinsOut, loops: loopsOut,
      done: t >= duration && !stalled,
    };
  }

  /** Next event boundary strictly after t — across all tokens, or one branch (step()). */
  function nextBoundary(t, tokenId) {
    const list = tokenId == null ? boundaries : perToken.get(tokenId);
    if (!list) return null;
    const from = Number.isFinite(+t) ? +t : 0;
    for (const b of list) if (b > from) return b;
    return null;
  }

  // `declared` is `duration` under its intent-revealing name: the length of the DECLARED
  // timeline, which playback speed never moves (F7 — see run-transport's sim().playback).
  return { duration, declared: duration, events, boundaries, stateAt, nextBoundary };
}

export default { parseDuration, compileRun };
