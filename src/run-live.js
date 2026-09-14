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
/** The log's whole vocabulary. `fail` is the terminal sibling of `finish`: same "consume
 *  this node's occupants" shape, minus the fan-out — the branch dies here (D4). */
const LOG_TYPES = new Set(["start", "finish", "spawn", "fail"]);
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

/** The edges live mode refuses to treat as feeding their target: an untagged back edge
 *  (which reads as a zero-iteration loop, D3/D4) or a plain self-edge. `loop: true` edges
 *  are excluded by the callers instead — they are never back edges, they are loops. */
function backEdgeIds(nodeList, edgeList) {
  const back = new Set();
  for (const id of breakCycles(nodeList, edgeList)) {
    const e = edgeList.find((x) => x.id === id);
    if (e && !e.loop) back.add(id);
  }
  for (const e of edgeList) if (!e.loop && e.source === e.target) back.add(e.id);
  return back;
}

/**
 * The node ids something actually feeds in live mode — i.e. the ids that are NOT roots.
 * Exactly `inNonLoop` non-empty inside replayLive: loop edges, self-edges and the back
 * edges `breakCycles` cuts are all excluded, so a node whose only in-edges are untagged
 * back edges IS a root here. Exported so the transport's phantom-start guard tests
 * rootness with the engine's own definition instead of a second, looser one (a graph with
 * an untagged cycle otherwise has no root at all and can never be seeded).
 * Pure: takes plain node/edge arrays (a spec, or a store's `.values()`), returns a Set.
 */
export function liveFedTargets(nodeList = [], edgeList = []) {
  const ids = new Set();
  for (const n of nodeList || []) if (n && n.id != null) ids.add(n.id);
  const es = (edgeList || []).filter((e) => e && ids.has(e.source) && ids.has(e.target));
  const back = backEdgeIds([...ids].map((id) => ({ id })), es);
  const fed = new Set();
  for (const e of es) if (!e.loop && !back.has(e.id)) fed.add(e.target);
  return fed;
}

/**
 * replayLive(spec, events, t, opts) -> state   (same shape as compileRun(...).stateAt(t))
 *   spec   = a store.spec() snapshot (flat: no container remap, see header note)
 *   events = append-only log, sorted defensively on entry:
 *            {t, type: 'start'|'finish'|'spawn'|'fail', id, n?}
 *   opts   = { hopMs = 300, minHopMs = 0, bornAt }
 *            `minHopMs` (F14) is the shortest crossing a hop may be squashed to when a
 *            start() claims it mid-flight: real trace timestamps make a parent's dispatch
 *            instant the child's start instant, which otherwise teleports the token. The
 *            claimed start is pushed out to `hop.t0 + minHopMs` so the wire is still drawn.
 *            Clamped to `hopMs` — a minimum can never outlast the hop it shortens.
 *            `bornAt` (optional Map edgeId -> live ms) is when an edge ENTERED the run.
 *            The log is history: a finish stamped before an edge existed must not be
 *            re-resolved over it (the transport fills this in from the host's add events).
 * Deterministic: same (spec, events, t) -> same state. No wall clock read in here — the
 * caller (run-transport's frontier) owns time.
 */
export function replayLive(spec = {}, events = [], t = 0, opts = {}) {
  const T = Math.max(0, Number.isFinite(+t) ? +t : 0);
  const hopMs = Number.isFinite(opts.hopMs) && opts.hopMs >= 0 ? opts.hopMs : DEFAULT_HOP_MS;
  const minHop = Number.isFinite(opts.minHopMs) && opts.minHopMs > 0 ? Math.min(opts.minHopMs, hopMs) : 0;
  const bornAt = opts.bornAt instanceof Map && opts.bornAt.size ? opts.bornAt : null;

  const nodes = new Map();
  for (const n of spec.nodes || []) if (n && n.id != null) nodes.set(n.id, n);
  const edges = (spec.edges || []).filter((e) => e && nodes.has(e.source) && nodes.has(e.target));

  // Untagged cycles read as zero-iteration loops here too (D3/D4), exactly as compileRun
  // treats them — a plain back edge must not inflate a node's implicit join arity.
  const back = backEdgeIds([...nodes.values()], edges);

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

  // ---- join policies: identical rule to Mode A (F10) — arrivals are counted and ONE token
  // is released per group of `needed`, so a fan-in does not turn N arrivals into N occupants
  // and N downstream tokens. Unlike Mode A the join re-arms: a live fan-in fires as often as
  // its arrivals allow. D4 M2 still holds over it — "an explicit start(id) ALWAYS activates,
  // the real log outranks the declared policy" — and so does spawn(), which injects. ----
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
    .filter((e) => e && e.id != null && LOG_TYPES.has(e.type)
      && nodes.has(e.id) && Number.isFinite(+e.t) && +e.t <= T)
    .map((e, i) => ({ t: +e.t, type: e.type, id: e.id, n: e.n, seq: i, pri: PRI_LOG }))
    .sort((a, b) => a.t - b.t || a.seq - b.seq);

  const queue = clean.slice();
  let seq = 0;
  let tokenSeq = 0;

  const tokens = new Map();      // id -> {id, segments:[{kind,id,t0,t1,wait?}]}
  const nodeQueue = new Map();   // nodeId -> [{tokenId, arrivedAt, state:'waiting'|'active', seg}] (arrival order)
  const nodeStatus = new Map();  // nodeId -> 'pending'|'active'|'done'|'failed'
  const edgeSegs = new Map();    // edgeId -> segments (persistent traversal fill)
  const joinArrivals = new Map();
  const joinClaimed = new Map(); // nodeId -> arrivals of the group still forming that an explicit start() already took
  const loopIteration = new Map();
  const inFlight = new Map();    // nodeId -> [{landAt, tk, eseg, wseg, item}] hops still traveling
  const overBudget = new Map();  // nodeId -> WHEN a live dwell of its ran past the declared data.duration
  for (const id of nodes.keys()) { nodeQueue.set(id, []); nodeStatus.set(id, "pending"); inFlight.set(id, []); }
  for (const e of edges) edgeSegs.set(e.id, []);
  for (const id of joinNeeded.keys()) joinArrivals.set(id, []);

  function newToken() {
    const tk = { id: `lt${tokenSeq++}`, segments: [] };
    tokens.set(tk.id, tk);
    return tk;
  }
  function closeSeg(seg, t1) { if (seg && seg.t1 === Infinity) seg.t1 = t1; }

  /** Mode A stops recording a join's arrivals once the policy has fired (run.js's
   *  drop-before-push), so `arrived` saturates at `needed` there; mirror it here. */
  function noteArrival(nodeId, arrivedAt) {
    const arr = joinArrivals.get(nodeId);
    if (!arr) return;
    if (arr.length >= (joinNeeded.get(nodeId) || 0)) return;
    arr.push(arrivedAt);
  }

  /** An arrival that was counted into the group a join is still forming, but that an
   *  explicit start() has already pulled out of the held pool and put to work (D4 M2 — the
   *  log outranks the policy). Without this the group could never complete: its partners
   *  would wait forever for a member that is standing right there, `active`, and a later
   *  finish() would fan each of them out on its own — the ×N propagation F10 removed. */
  function claimArrival(nodeId) {
    if ((joinNeeded.get(nodeId) || 0) < 2) return;
    joinClaimed.set(nodeId, (joinClaimed.get(nodeId) || 0) + 1);
  }

  /** Merges the arrivals waiting at a join into one releasable occupant, `needed` at a
   *  time — Mode A's rule (F10): the last of the group carries on, its partners end there
   *  (the renderer simply stops drawing them, as compileRun's merged tokens do). Surplus
   *  arrivals stay `held` and form the next group, which is what makes a live fan-in able
   *  to fire again and again instead of once. Arrivals already claimed by a start() count
   *  towards the group they belonged to: the group completes on `needed - claimed` further
   *  held arrivals, and since the work it stands for is already on the node (or has already
   *  left it), those partners merge into it rather than releasing a second token. */
  function releaseJoin(nodeId, at) {
    const needed = joinNeeded.get(nodeId) || 0;
    if (needed < 2) return;
    const q = nodeQueue.get(nodeId);
    let claimed = joinClaimed.get(nodeId) || 0;
    const held = q.filter((o) => o.state === "held");
    while (held.length + claimed >= needed) {
      const group = held.splice(0, Math.max(0, needed - claimed));
      // A claimed group is already represented; an unclaimed one keeps its last arrival.
      const keep = claimed > 0 ? null : group[group.length - 1];
      claimed = 0;
      for (const o of group) {
        if (o === keep) continue;
        closeSeg(o.seg, at);
        const i = q.indexOf(o);
        if (i >= 0) q.splice(i, 1);
      }
      if (keep) keep.state = "waiting";
    }
    joinClaimed.set(nodeId, claimed);
  }

  /** A token lands (waiting, not yet started) on `nodeId` — via a hop arrival or spawn().
   *  A landing on a node that had gone 'done' un-does that (D4 M2: "target stays pending
   *  until its own start" — a fresh arrival is not a re-activation by itself). 'failed' is
   *  deliberately NOT un-done here: the failure is what happened, and an arrival is not a
   *  retry. The retry is the explicit start() in doStart, which activates as it always did.
   *  `joined = false` (spawn) injects the token outright: an explicit injection is never
   *  held by, and never counts towards, a declared join policy. */
  function land(nodeId, arrivedAt, tk, seg, joined = true) {
    if (nodeStatus.get(nodeId) === "done") nodeStatus.set(nodeId, "pending");
    const needed = joined ? (joinNeeded.get(nodeId) || 0) : 0;
    nodeQueue.get(nodeId).push({ tokenId: tk.id, arrivedAt, state: needed > 1 ? "held" : "waiting", seg });
    if (!joined) return;
    noteArrival(nodeId, arrivedAt);
    releaseJoin(nodeId, arrivedAt);
  }

  /** F13 — a live dwell that outran the node's declared `data.duration`. The duration is
   *  an expectation in Mode B, never a schedule, so this is the only thing it can say. */
  function noteDwell(nodeId, t0, t1) {
    const sec = secOf.get(nodeId);
    if (sec == null || !(sec > 0) || (t1 - t0) / 1000 <= sec) return;
    // Remember WHEN the verdict was earned: a unit of work that was already on the node
    // while the over-long dwell ran is concurrent with it and must not erase it, while one
    // that turned up afterwards is the fresh attempt doStart() judges on its own.
    const prev = overBudget.get(nodeId);
    if (prev == null || t1 > prev) overBudget.set(nodeId, t1);
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

  /** F13 — a fresh activation is judged against its own dwell, so it clears the node's
   *  over-budget verdict. "Fresh" is about the unit of work, not about the node being
   *  empty: a unit that only turned up at or after the moment the verdict was earned
   *  cannot be the concurrent work that earned it (that is the case test F13 guards — one
   *  of several occupants overran and the next one must not erase it), and in the ordinary
   *  pipeline shape the next pass is ALWAYS an arrival sitting on the node before its
   *  start() is stamped, which is why "empty node" latched the verdict forever there. */
  function freshAttempt(nodeId, arrivedAt) {
    const earned = overBudget.get(nodeId);
    if (earned != null && arrivedAt >= earned) overBudget.delete(nodeId);
  }

  function doStart(nodeId, at) {
    const q = nodeQueue.get(nodeId);
    // An explicit start() ALWAYS activates (D4 M2: the real log outranks the declared
    // policy), so it picks up an arrival still held by an unfired join as readily as a
    // released one — it just takes the released ones first.
    let idx = q.findIndex((o) => o.state === "waiting");
    if (idx < 0) {
      idx = q.findIndex((o) => o.state === "held");
      if (idx >= 0) claimArrival(nodeId); // it still counts towards its group (F10)
    }
    if (idx >= 0) {
      const occ = q[idx];
      freshAttempt(nodeId, occ.arrivedAt);
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
      // With minHopMs (F14) the truncation stops short of zero, so a start() stamped at the
      // upstream finish's own instant still draws the token crossing the wire.
      const t0 = Math.min(hop.landAt, minHop > 0 ? Math.max(at, hop.eseg.t0 + minHop) : at);
      hop.eseg.t1 = Math.max(hop.eseg.t0, t0);
      hop.wseg.t0 = t0;
      hop.wseg.t1 = t0;
      freshAttempt(nodeId, t0);
      noteArrival(nodeId, t0);
      claimArrival(nodeId); // a claimed hop is an arrival too: it counts towards the group
      const seg = { kind: "node", id: nodeId, t0, t1: Infinity };
      hop.tk.segments.push(seg);
      q.push({ tokenId: hop.tk.id, arrivedAt: t0, state: "active", seg });
      // A minHop-delayed start is still crossing at T: it is not occupying the node yet.
      if (t0 <= T) nodeStatus.set(nodeId, "active");
      return;
    }
    // "if none is present" (source/entry node, or an already-terminal node being restarted —
    // that restart IS the live loop iteration, D4 M2). A restart after a `fail` counts the
    // same way: retrying a failed step over a bounded loop edge is exactly what that edge
    // is for, so 'failed' is terminal for iteration-counting just like 'done'.
    const wasDone = nodeStatus.get(nodeId) === "done" || nodeStatus.get(nodeId) === "failed";
    freshAttempt(nodeId, at); // a minted token is as fresh as an activation gets
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

  /** One unit of work leaving `nodeId`: a token onto each of its non-loop out-edges. */
  function fanOut(nodeId, at) {
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

  function doFinish(nodeId, at, n) {
    const q = nodeQueue.get(nodeId);
    const k = Number.isFinite(n) ? Math.max(0, Math.min(Math.floor(n), q.length)) : q.length;
    const finished = q.splice(0, k);
    let heldFanned = false;
    for (const occ of finished) {
      if (occ.state === "active" && occ.seg) noteDwell(nodeId, occ.seg.t0, at);
      closeSeg(occ.seg, at);
      // F10 — the arrivals an UNFIRED join is still holding are one piece of work, not N.
      // A bare finish() consuming them releases a single token downstream, exactly as the
      // satisfied join would, instead of minting one per arrival (the ×N badge that then
      // propagates forever). Released/active occupants keep fanning out one each.
      if (occ.state === "held") { if (heldFanned) continue; heldFanned = true; }
      fanOut(nodeId, at);
    }
    // A finish() that found nothing occupying the node (never started, or already fully
    // drained by an earlier finish) fans nothing out above and must not flip the status —
    // a phantom "done" with zero tokens ever created is not the same thing as a real finish.
    if (finished.length) nodeStatus.set(nodeId, q.length === 0 ? "done" : "active");
  }

  /** `fail` is `finish` minus the fan-out: it consumes every current occupant (a failure is
   *  not partial — the step did not produce the output its successors were waiting for), it
   *  never emits a hop, and it parks the node on the terminal status 'failed'. Everything
   *  downstream simply never receives a token, which is the whole point: the branch dies.
   *  Like finish(), a fail() that found nothing occupying the node must not flip the status —
   *  a phantom 'failed' with no token ever created is not a failure that happened. */
  function doFail(nodeId, at) {
    const q = nodeQueue.get(nodeId);
    if (!q.length) return;
    for (const occ of q.splice(0, q.length)) {
      if (occ.state === "active" && occ.seg) noteDwell(nodeId, occ.seg.t0, at);
      closeSeg(occ.seg, at);
    }
    nodeStatus.set(nodeId, "failed");
  }

  function doSpawn(nodeId, at, n) {
    const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    for (let i = 0; i < count; i++) {
      const tk = newToken();
      const seg = { kind: "node", id: nodeId, t0: at, t1: Infinity, wait: true };
      tk.segments.push(seg);
      land(nodeId, at, tk, seg, false);
    }
  }

  /** F14 — the landing instant a minHop-delayed start() booked on `nodeId` but has not
   *  reached yet at `at`. A terminal event stamped inside that window would close the
   *  occupant's node segment BEFORE its own t0: the node would paint 'done' while its token
   *  is still drawn crossing the wire, and the segment would vanish (negative length). Real
   *  spans are routinely shorter than a 100-200ms minimum hop, so this is the normal case,
   *  not a corner: the terminal event waits for the landing instead. */
  function landingOf(nodeId, at, k) {
    const q = nodeQueue.get(nodeId);
    let m = at;
    const n = Math.min(k, q.length);
    for (let i = 0; i < n; i++) { const o = q[i]; if (o.seg && o.seg.t0 > m) m = o.seg.t0; }
    return m;
  }

  let steps = 0;
  while (queue.length && steps++ < MAX_STEPS) {
    const ev = heapPop(queue, queueLess);
    if (ev.cancelled) continue; // takeInFlight consumed this landing early — lazy delete
    if (ev.type === "__land") { dropHop(ev.id); land(ev.id, ev.t, ev.tk, ev.seg); continue; }
    if (minHop > 0 && (ev.type === "finish" || ev.type === "fail")) {
      const k = ev.type === "finish" && Number.isFinite(ev.n) ? Math.max(0, Math.floor(ev.n)) : Infinity;
      const landAt = landingOf(ev.id, ev.t, k);
      if (landAt > ev.t) {
        // Re-queue at the landing (it is in the future, so the heap order still holds).
        // Past T it simply has not happened yet in this sample — a later T replays it.
        if (landAt <= T) heapPush(queue, { ...ev, t: landAt, seq: seq++, pri: PRI_LOG }, queueLess);
        continue;
      }
    }
    if (ev.type === "start") doStart(ev.id, ev.t);
    else if (ev.type === "finish") doFinish(ev.id, ev.t, ev.n);
    else if (ev.type === "fail") doFail(ev.id, ev.t);
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
    // A minHop-delayed start is booked on the node but has not landed at T yet; nothing
    // else can sit in the future, so only a live minHopMs makes the filter worth running.
    const q = nodeQueue.get(id);
    const occ = minHop > 0 ? q.filter((o) => !(o.seg && o.seg.t0 > T)) : q;
    const sec = secOf.get(id);
    let progress = 0;
    let active = 0;
    let over = overBudget.has(id);
    // Both terminal statuses read as a full bar: the node is no longer working, and a
    // half-drawn fill on a failed step reads as "still going" (Mode A agrees — a failing
    // node's dwell segment is closed, so its span is fully elapsed).
    if (status === "done" || status === "failed") progress = 1;
    for (const o of occ) {
      if (o.state !== "active") continue;
      active++;
      if (sec != null && sec > 0 && (T - o.seg.t0) / 1000 > sec) over = true;
      if (status === "done" || status === "failed") continue;
      const p = activeProgress(o.seg, T, sec);
      if (p > progress) progress = p;
    }
    // `waiting` counts every occupant that is not working yet — a landed arrival AND one
    // still held by an unfired join: both are things an explicit start() would pick up.
    nodesOut[id] = { status, progress, occupancy: occ.length, waiting: occ.length - active, active, overBudget: over };
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
