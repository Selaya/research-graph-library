// Token engine — Mode B "live" (D4). PURE: no DOM, no imports from render/index/scene.
//
// Mode A compiles a whole schedule up front because durations are declared truth. Mode B
// has no declared truth — only an append-only event log a real pipeline writes as it runs
// (`start`/`finish`/`spawn`) — so there is nothing to compile: `replayLive` deterministically
// REPLAYS the log up to a queried instant `t` and returns the exact same `stateAt(t)` shape
// compileRun produces, so run-render.js (and everything downstream) needs no mode branch.
//
// Simplification vs compileRun (explicitly sanctioned, M2 contract): no container remap.
// compileRun re-attaches edges incident to a container to its entry/exit child because a
// container is never itself an executable step in Mode A's auto-seeded, auto-fanned-out
// world. Live mode has no auto-anything — every activation is an explicit start(id)/finish(id)
// call naming a real id — so a container node just replays like any other flat node; whether
// it reads as "collapsed" is entirely a rendering/viewstate concern, not this engine's.

import { parseDuration } from "./run.js";
import { breakCycles } from "./cycles.js";

const DEFAULT_HOP_MS = 300;
const PROGRESS_CAP = 0.95;
/** Bounds the land()-cascade the same way compileRun bounds its queue (defensive, not
 *  reachable in practice: live mode never auto-cascades past one hop without a real event). */
const MAX_STEPS = 100000;

const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** Queue priority at an identical timestamp. A derived hop landing is CAUSED by an earlier
 *  finish, so it is causally prior to any independent log entry stamped at the same instant
 *  (typically the target's own `start`) — ordering it after them made the start miss its
 *  arrival, fabricate a second token, and misfire joins on the doubled branch. */
const PRI_LAND = 0;
const PRI_LOG = 1;

/** Total order matching the old sortedInsert's tie-break: earlier t first, PRI_LAND before
 *  PRI_LOG at an identical t, then insertion order. */
const queueLess = (a, b) => a.t < b.t
  || (a.t === b.t && (a.pri < b.pri || (a.pri === b.pri && a.seq < b.seq)));

/** Minimal array-based binary min-heap, `less(a,b)` supplying the order. Used both for the
 *  log/derived-event queue and for each node's in-flight hop tracking below — replaces the
 *  O(n) splice (sortedInsert) and O(n) indexOf scans that made a full replay superlinear in
 *  the log size; push/pop here are O(log n). */
function heapPush(heap, item, less) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!less(heap[i], heap[p])) break;
    const tmp = heap[i]; heap[i] = heap[p]; heap[p] = tmp;
    i = p;
  }
}
function heapPop(heap, less) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    const n = heap.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let sm = i;
      if (l < n && less(heap[l], heap[sm])) sm = l;
      if (r < n && less(heap[r], heap[sm])) sm = r;
      if (sm === i) break;
      const tmp = heap[i]; heap[i] = heap[sm]; heap[sm] = tmp;
      i = sm;
    }
  }
  return top;
}

/** In-flight hops toward one node, ordered by landAt only. dropHop always removes the
 *  currently-firing hop's node-heap entry, and takeInFlight always wants the earliest one —
 *  both are exactly the heap root, so ties (equal landAt) never need identity to break. */
const flightLess = (a, b) => a.landAt < b.landAt;

/** Elapsed/estimate while dwelling, capped short of 1 so "active" never visually reads as
 *  "done" before the real finish() lands (mirrors compileRun's dwell fill intent) — 0 when
 *  no duration parses (status pulse alone carries it, per the M2 contract). */
function activeProgress(seg, t, sec) {
  if (t < seg.t0) return 0;
  if (sec == null || !(sec > 0)) return 0;
  return Math.min(PROGRESS_CAP, clamp01((t - seg.t0) / 1000 / sec));
}

/** Fixed-span progress for an edge hop; saturates to 1 and stays there (persistent fill). */
function edgeProgress(seg, t) {
  if (t <= seg.t0) return 0;
  if (!(seg.t1 > seg.t0)) return 1;
  return clamp01((t - seg.t0) / (seg.t1 - seg.t0));
}

/** Same half-open "which segment covers t" scan compileRun's segAt uses. */
function findCurrent(tk, t) {
  let degenerate = null;
  for (const seg of tk.segments) {
    if (t >= seg.t0 && t < seg.t1) return seg;
    if (!degenerate && seg.t1 === seg.t0 && t === seg.t0) degenerate = seg;
  }
  return degenerate;
}

/**
 * replayLive(spec, events, t, opts) -> state   (same shape as compileRun(...).stateAt(t))
 *   spec   = a store.spec() snapshot (flat: no container remap, see header note)
 *   events = append-only log, sorted defensively on entry:
 *            {t, type: 'start'|'finish'|'spawn', id, n?}
 *   opts   = { hopMs = 300, bornAt }
 *            `bornAt` (optional Map edgeId -> live ms) is when an edge ENTERED the run.
 *            The log is history: a finish stamped before an edge existed must not be
 *            re-resolved over it (the transport fills this in from the host's add events).
 * Deterministic: same (spec, events, t) -> same state. No wall clock read in here — the
 * caller (run-transport's frontier) owns time.
 */
export function replayLive(spec = {}, events = [], t = 0, opts = {}) {
  const T = Math.max(0, Number.isFinite(+t) ? +t : 0);
  const hopMs = Number.isFinite(opts.hopMs) && opts.hopMs >= 0 ? opts.hopMs : DEFAULT_HOP_MS;
  const bornAt = opts.bornAt instanceof Map && opts.bornAt.size ? opts.bornAt : null;

  const nodes = new Map();
  for (const n of spec.nodes || []) if (n && n.id != null) nodes.set(n.id, n);
  const edges = (spec.edges || []).filter((e) => e && nodes.has(e.source) && nodes.has(e.target));

  // Untagged cycles read as zero-iteration loops here too (D3/D4), exactly as compileRun
  // treats them — a plain back edge must not inflate a node's implicit join arity.
  const back = new Set();
  for (const id of breakCycles([...nodes.values()], edges)) {
    const e = edges.find((x) => x.id === id);
    if (e && !e.loop) back.add(id);
  }
  for (const e of edges) if (!e.loop && e.source === e.target) back.add(e.id);

  const outNormal = new Map();   // nodeId -> non-loop out-edges (loop edges never auto-fan-out)
  const inNonLoop = new Map();   // nodeId -> non-loop in-edges (join arity)
  const loopInOf = new Map();    // nodeId -> the (first) loop edge id targeting it
  const loopMaxOf = new Map();   // loop edge id -> maxIterations
  for (const id of nodes.keys()) { outNormal.set(id, []); inNonLoop.set(id, []); }
  for (const e of edges) {
    if (e.loop) {
      if (!loopInOf.has(e.target)) loopInOf.set(e.target, e.id);
      loopMaxOf.set(e.id, e.maxIterations || 0);
      continue;
    }
    if (back.has(e.id)) continue;
    outNormal.get(e.source).push(e);
    inNonLoop.get(e.target).push(e);
  }

  const secOf = new Map();
  for (const n of nodes.values()) secOf.set(n.id, parseDuration(n.data && n.data.duration));

  // ---- join policies: identical rule to Mode A, arrival-counted only (D4 M2: "an explicit
  // start(id) ALWAYS activates — the real log outranks the declared policy"). ----
  const joinNeeded = new Map();
  for (const id of nodes.keys()) {
    const expected = inNonLoop.get(id).length;
    const declared = nodes.get(id).join;
    if (declared == null && expected < 2) continue;
    let needed;
    if (declared === "any") needed = 1;
    else if (declared && typeof declared === "object" && Number.isFinite(declared.count)) {
      needed = Math.max(1, Math.min(Math.floor(declared.count), Math.max(expected, 1)));
    } else needed = Math.max(1, expected);
    joinNeeded.set(id, needed);
  }

  // ---- normalize + time-sort the log (defensively — callers may hand it in any order) ----
  const clean = (events || [])
    .filter((e) => e && e.id != null && (e.type === "start" || e.type === "finish" || e.type === "spawn")
      && nodes.has(e.id) && Number.isFinite(+e.t) && +e.t <= T)
    .map((e, i) => ({ t: +e.t, type: e.type, id: e.id, n: e.n, seq: i, pri: PRI_LOG }))
    .sort((a, b) => a.t - b.t || a.seq - b.seq);

  const queue = clean.slice();
  let seq = 0;
  let tokenSeq = 0;

  const tokens = new Map();      // id -> {id, segments:[{kind,id,t0,t1,wait?}]}
  const nodeQueue = new Map();   // nodeId -> [{tokenId, arrivedAt, state:'waiting'|'active', seg}] (arrival order)
  const nodeStatus = new Map();  // nodeId -> 'pending'|'active'|'done'
  const edgeSegs = new Map();    // edgeId -> segments (persistent traversal fill)
  const joinArrivals = new Map();
  const loopIteration = new Map();
  const inFlight = new Map();    // nodeId -> [{landAt, tk, eseg, wseg, item}] hops still traveling
  for (const id of nodes.keys()) { nodeQueue.set(id, []); nodeStatus.set(id, "pending"); inFlight.set(id, []); }
  for (const e of edges) edgeSegs.set(e.id, []);
  for (const id of joinNeeded.keys()) joinArrivals.set(id, []);

  function newToken() {
    const tk = { id: `lt${tokenSeq++}`, segments: [] };
    tokens.set(tk.id, tk);
    return tk;
  }
  function closeSeg(seg, t1) { if (seg && seg.t1 === Infinity) seg.t1 = t1; }

  /** A token lands (waiting, not yet started) on `nodeId` — via a hop arrival or spawn().
   *  A landing on a node that had gone 'done' un-does that (D4 M2: "target stays pending
   *  until its own start" — a fresh arrival is not a re-activation by itself). */
  /** Mode A stops recording a join's arrivals once the policy has fired (run.js's
   *  drop-before-push), so `arrived` saturates at `needed` there; mirror it here. */
  function noteArrival(nodeId, arrivedAt) {
    const arr = joinArrivals.get(nodeId);
    if (!arr) return;
    if (arr.length >= (joinNeeded.get(nodeId) || 0)) return;
    arr.push(arrivedAt);
  }

  function land(nodeId, arrivedAt, tk, seg) {
    if (nodeStatus.get(nodeId) === "done") nodeStatus.set(nodeId, "pending");
    nodeQueue.get(nodeId).push({ tokenId: tk.id, arrivedAt, state: "waiting", seg });
    noteArrival(nodeId, arrivedAt);
  }

  /** Removes the hop that is landing right now — always the node's earliest in-flight hop
   *  (anything queued at an earlier landAt for this node would already have fired and been
   *  dropped, since land events at t' <= t sort ahead of everything at t), so this is always
   *  exactly the heap root: no identity lookup needed. */
  function dropHop(nodeId) {
    const list = inFlight.get(nodeId);
    if (!list || !list.length) return;
    heapPop(list, flightLess);
  }

  /** The earliest hop still traveling toward `nodeId` at `at`, unqueued and removed.
   *  hopMs is a rendering travel time, not a gate: a token cannot still be in the air when
   *  its target has demonstrably started, so an inbound start CONSUMES the flight. */
  function takeInFlight(nodeId, at) {
    const list = inFlight.get(nodeId);
    if (!list || !list.length || !(list[0].landAt > at)) return null;
    const hop = heapPop(list, flightLess);
    if (hop.item) hop.item.cancelled = true; // lazy delete: the main loop skips it on pop
    return hop;
  }

  function doStart(nodeId, at) {
    const q = nodeQueue.get(nodeId);
    const idx = q.findIndex((o) => o.state === "waiting");
    if (idx >= 0) {
      const occ = q[idx];
      closeSeg(occ.seg, at);
      occ.state = "active";
      const tk = tokens.get(occ.tokenId);
      occ.seg = { kind: "node", id: nodeId, t0: at, t1: Infinity };
      tk.segments.push(occ.seg);
      nodeStatus.set(nodeId, "active");
      return;
    }
    const hop = takeInFlight(nodeId, at);
    if (hop) {
      // Land it early: the edge fill truncates to the start instant and the wait collapses.
      hop.eseg.t1 = Math.max(hop.eseg.t0, at);
      hop.wseg.t0 = at;
      hop.wseg.t1 = at;
      noteArrival(nodeId, at);
      const seg = { kind: "node", id: nodeId, t0: at, t1: Infinity };
      hop.tk.segments.push(seg);
      q.push({ tokenId: hop.tk.id, arrivedAt: at, state: "active", seg });
      nodeStatus.set(nodeId, "active");
      return;
    }
    // "if none is present" (source/entry node, or an already-done node being restarted —
    // that restart IS the live loop iteration, D4 M2).
    const wasDone = nodeStatus.get(nodeId) === "done";
    const tk = newToken();
    const seg = { kind: "node", id: nodeId, t0: at, t1: Infinity };
    tk.segments.push(seg);
    q.push({ tokenId: tk.id, arrivedAt: at, state: "active", seg });
    if (wasDone) {
      const eid = loopInOf.get(nodeId);
      if (eid) loopIteration.set(eid, (loopIteration.get(eid) || 0) + 1);
    }
    nodeStatus.set(nodeId, "active");
  }

  function doFinish(nodeId, at, n) {
    const q = nodeQueue.get(nodeId);
    const k = Number.isFinite(n) ? Math.max(0, Math.min(Math.floor(n), q.length)) : q.length;
    const finished = q.splice(0, k);
    for (const occ of finished) {
      closeSeg(occ.seg, at);
      for (const e of outNormal.get(nodeId)) {
        // The log is history: an edge that did not exist yet when this finish was written
        // never carried anything out of it (D4 — Mode B replays a real event log "as things
        // actually happened", so a later addEdge must not fabricate a past traversal).
        if (bornAt) { const b = bornAt.get(e.id); if (b != null && b > at) continue; }
        const child = newToken();
        const eseg = { kind: "edge", id: e.id, t0: at, t1: at + hopMs };
        child.segments.push(eseg);
        edgeSegs.get(e.id).push(eseg);
        const landAt = at + hopMs;
        const wseg = { kind: "node", id: e.target, t0: landAt, t1: Infinity, wait: true };
        child.segments.push(wseg);
        const hop = { landAt, tk: child, eseg, wseg, item: null };
        heapPush(inFlight.get(e.target), hop, flightLess);
        // Only materialize the landing into the target's queue if it has actually happened
        // by T — a hop still in flight at T stays represented purely by `eseg` above (and
        // by `inFlight`, so an early start(target) can still claim it).
        if (landAt <= T) {
          hop.item = { t: landAt, seq: seq++, pri: PRI_LAND, type: "__land", id: e.target, tk: child, seg: wseg };
          heapPush(queue, hop.item, queueLess);
        }
      }
    }
    // A finish() that found nothing occupying the node (never started, or already fully
    // drained by an earlier finish) fans nothing out above and must not flip the status —
    // a phantom "done" with zero tokens ever created is not the same thing as a real finish.
    if (finished.length) nodeStatus.set(nodeId, q.length === 0 ? "done" : "active");
  }

  function doSpawn(nodeId, at, n) {
    const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    for (let i = 0; i < count; i++) {
      const tk = newToken();
      const seg = { kind: "node", id: nodeId, t0: at, t1: Infinity, wait: true };
      tk.segments.push(seg);
      land(nodeId, at, tk, seg);
    }
  }

  let steps = 0;
  while (queue.length && steps++ < MAX_STEPS) {
    const ev = heapPop(queue, queueLess);
    if (ev.cancelled) continue; // takeInFlight consumed this landing early — lazy delete
    if (ev.type === "__land") { dropHop(ev.id); land(ev.id, ev.t, ev.tk, ev.seg); continue; }
    if (ev.type === "start") doStart(ev.id, ev.t);
    else if (ev.type === "finish") doFinish(ev.id, ev.t, ev.n);
    else if (ev.type === "spawn") doSpawn(ev.id, ev.t, ev.n);
  }

  // ---- sample at T ----
  const tokensOut = [];
  for (const tk of tokens.values()) {
    const seg = findCurrent(tk, T);
    if (!seg) continue;
    const progress = seg.kind === "edge" ? edgeProgress(seg, T)
      : seg.wait ? 0
      : activeProgress(seg, T, secOf.get(seg.id));
    tokensOut.push({ id: tk.id, rate: 1, at: { kind: seg.kind, id: seg.id, progress } });
  }

  const nodesOut = {};
  for (const id of nodes.keys()) {
    const status = nodeStatus.get(id) || "pending";
    const occ = nodeQueue.get(id);
    let progress = 0;
    if (status === "done") progress = 1;
    else for (const o of occ) {
      if (o.state !== "active") continue;
      const p = activeProgress(o.seg, T, secOf.get(id));
      if (p > progress) progress = p;
    }
    nodesOut[id] = { status, progress, occupancy: occ.length };
  }

  const edgesOut = {};
  for (const [id, segs] of edgeSegs) {
    let traversed = 0;
    for (const s of segs) { const p = edgeProgress(s, T); if (p > traversed) traversed = p; }
    edgesOut[id] = { traversed };
  }

  const joinsOut = {};
  for (const [id, needed] of joinNeeded) {
    const arrived = (joinArrivals.get(id) || []).length;
    joinsOut[id] = { arrived, needed, fired: arrived >= needed };
  }

  const loopsOut = {};
  for (const [eid, max] of loopMaxOf) loopsOut[eid] = { iteration: loopIteration.get(eid) || 0, max };

  // Nothing pending/active/in-flight anywhere as of T — tokensOut already covers every
  // shape of "still around" (waiting, active, or mid-hop), so this needs no separate scan.
  return {
    tokens: tokensOut, nodes: nodesOut, edges: edgesOut,
    joins: joinsOut, loops: loopsOut,
    done: tokensOut.length === 0,
  };
}

/** Sorted distinct event times — what step() walks in live mode. Just the log's own
 *  timestamps (hop-landing instants are not observable inputs to this pure function; the
 *  transport, which knows hopMs, is free to fold them in before calling step-adjacent code). */
export function liveBoundaries(events = []) {
  const set = new Set();
  for (const e of events || []) if (e && Number.isFinite(+e.t)) set.add(+e.t);
  return [...set].sort((a, b) => a - b);
}

export default { replayLive, liveBoundaries };
