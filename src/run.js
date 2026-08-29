// Token engine — Mode A "simulate" (D4). PURE: no DOM, no imports from render/index/scene.
//
// Durations are declared, so a discrete-event compile pass runs ONCE up front (pop the
// soonest pending token event, push its successors) and produces a flat time-sorted
// schedule. Everything downstream — seek, scrub, per-branch speed, step() — is then just
// sampling that artifact, which is the whole reason Mode A exists (D4).
//
// The engine never mutates the graph: it decorates it from stateAt(t).

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

/** "2h" | "45m" | "8s" | "300ms" | 12 (already seconds) -> seconds; null when absent/bad. */
export function parseDuration(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = DURATION_RE.exec(v.trim().toLowerCase());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
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
 *            hopMs = 300, dwell?: (sec|null, ctx) => ms }
 * Deterministic given (spec, opts).
 */
export function compileRun(spec = {}, opts = {}) {
  const nodes = new Map();
  for (const n of spec.nodes || []) if (n && n.id != null) nodes.set(n.id, n);
  const edges = (spec.edges || []).filter((e) => e && nodes.has(e.source) && nodes.has(e.target));

  const outNormal = new Map();
  const outLoop = new Map();
  const inNonLoop = new Map();
  for (const id of nodes.keys()) { outNormal.set(id, []); outLoop.set(id, []); inNonLoop.set(id, []); }
  for (const e of edges) {
    (e.loop ? outLoop : outNormal).get(e.source).push(e);
    if (!e.loop) inNonLoop.get(e.target).push(e);
  }

  // ---- pacing ----
  const hopMs = Number.isFinite(opts.hopMs) && opts.hopMs >= 0 ? opts.hopMs : DEFAULT_HOP_MS;
  const secOf = new Map();
  let maxSec = 0;
  for (const n of nodes.values()) {
    const s = parseDuration(n.data && n.data.duration);
    secOf.set(n.id, s);
    if (s != null && s > maxSec) maxSec = s;
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
  const events = [];
  const tokens = [];
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

  const emit = (ev) => { events.push(ev); };

  function newToken(rate, applied, loopsUsed, parentId) {
    const tk = { id: `t${tokenSeq++}`, rate, applied, loopsUsed, parentId, segments: [], endT: Infinity };
    tokens.push(tk);
    return tk;
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

  function arrive(tk, nodeId, t, viaEdgeId) {
    applyRates(tk, nodeId, t);
    emit({ t, type: "enter", tokenId: tk.id, nodeId, edgeId: viaEdgeId });
    const st = joinStates.get(nodeId);
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
      emit({ t: t + d, type: "finish", tokenId: tk.id, nodeId });
      exitNode(tk, nodeId, t + d);
    });
  }

  /** Leaving node `nodeId`: an unconsumed loop out-edge wins, otherwise implicit fan-out. */
  function exitNode(tk, nodeId, t) {
    for (const e of outLoop.get(nodeId)) {
      if (tk.loopsUsed.has(e.id)) continue;
      tk.loopsUsed.add(e.id);
      const n = iterationsFor(e);
      if (n <= 0) continue; // capped to zero: behave as if the loop were not there
      emit({ t, type: "loop", tokenId: tk.id, edgeId: e.id, nodeId, iteration: 1, max: e.maxIterations });
      loopTimeline.get(e.id).push({ iteration: 1, t });
      const hop = scale(hopMs, tk.rate);
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
      const hop = scale(hopMs, child.rate);
      segment(child, { kind: "edge", id: e.id, t0: t, t1: t + hop });
      if (Number.isFinite(hop)) push(t + hop, () => arrive(child, e.target, t + hop, e.id));
    }
  }

  // ---- run the queue ----
  for (const n of nodes.values()) {
    if (inNonLoop.get(n.id).length === 0) {
      const tk = newToken(1, new Set(), new Set(), null);
      arrive(tk, n.id, 0, undefined);
    }
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
        status = t >= win.to ? "done" : t >= win.from ? "active" : "pending";
        for (const s of segs) {
          if (holds(s, t)) occupancy++;
          if (s.wait) continue; // waiting at a join is not dwell progress
          const p = spanProgress(s, t);
          if (p > progress) progress = p;
        }
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

  return { duration, events, boundaries, stateAt, nextBoundary };
}

export default { parseDuration, compileRun };
