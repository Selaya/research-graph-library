// The failure primitive (D4) across both run engines: Mode B's run.fail(id) event and
// Mode A's declared `data.fail`. Both mean the same thing — the step stops, its occupants
// are consumed, and NOTHING is handed on to its successors: the branch dies there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { replayLive } from "../src/run-live.js";
import { compileRun } from "../src/run.js";
import { createRunTransport } from "../src/run-transport.js";
import { createTicker } from "../src/anim.js";
import { Store } from "../src/store.js";
import { emitter } from "../src/events.js";
import { CSS } from "../src/styles.js";

const chainSpec = () => ({
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
  ],
});

/** Captures console.warn calls made inside `fn`, restoring the real console.warn after. */
function captureWarnings(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return calls;
}

function makeInternals(spec = chainSpec()) {
  return { ticker: createTicker({ manual: true }), store: new Store(spec), bus: emitter() };
}

// ---------------------------------------------------------------------------
// Mode B — replayLive
// ---------------------------------------------------------------------------

test("replayLive: fail() consumes the node's occupants and fans NOTHING out — the branch dies", () => {
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 100, type: "fail", id: "a" },
  ];
  const st = replayLive(chainSpec(), events, 1000);
  assert.equal(st.nodes.a.status, "failed");
  assert.equal(st.nodes.a.occupancy, 0, "the occupant was consumed, exactly as finish() consumes it");
  assert.equal(st.nodes.a.progress, 1, "terminal, so the fill reads full — never a stuck half-bar");
  assert.equal(st.edges.ab.traversed, 0, "no hop was ever emitted");
  assert.equal(st.nodes.b.status, "pending", "the successor is never told to run");
  assert.equal(st.nodes.c.status, "pending");
  assert.equal(st.tokens.length, 0, "the token is closed, not left hanging on the edge");
  assert.equal(st.done, true, "a dead branch ends the run rather than stalling it");
});

test("replayLive: fail() on a node with no occupants is a no-op — no phantom 'failed'", () => {
  // Same rule as finish()-before-start(): a status flip with no token ever created is a lie.
  const st = replayLive(chainSpec(), [{ t: 5, type: "fail", id: "a" }], 100);
  assert.equal(st.nodes.a.status, "pending");
  assert.equal(st.nodes.a.progress, 0);
  assert.equal(st.tokens.length, 0);

  // …and once a real finish has already drained it, a trailing fail() cannot re-flag it.
  const drained = replayLive(chainSpec(), [
    { t: 0, type: "start", id: "a" },
    { t: 5, type: "finish", id: "a" },
    { t: 8, type: "fail", id: "a" },
  ], 1000);
  assert.equal(drained.nodes.a.status, "done", "the real finish stands");
  assert.equal(drained.edges.ab.traversed, 1, "and its fan-out is untouched");
});

test("replayLive: a fail is time-travel safe — scrubbing across it is deterministic in both directions", () => {
  const spec = chainSpec();
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 100, type: "finish", id: "a" },   // hops a -> b, landing at 400
    { t: 500, type: "start", id: "b" },
    { t: 900, type: "fail", id: "b", reason: "OOM" },
  ];
  const before = replayLive(spec, events, 700);
  assert.equal(before.nodes.b.status, "active", "mid-dwell, the failure has not happened yet");

  const after = replayLive(spec, events, 1200);
  assert.equal(after.nodes.b.status, "failed");
  assert.equal(after.nodes.c.status, "pending", "c never received anything");
  assert.equal(after.edges.bc.traversed, 0);

  // scrub back: the past is unchanged, and re-sampling reproduces it exactly
  assert.deepEqual(replayLive(spec, events, 700), before);
  assert.deepEqual(replayLive(spec, events, 1200), after);
  // order of delivery is irrelevant — the log is sorted on entry
  assert.deepEqual(replayLive(spec, [...events].reverse(), 1200), after);
});

test("replayLive: a fail for a not-yet-existing node self-heals once the node is added", () => {
  const events = [
    { t: 0, type: "start", id: "d" },
    { t: 50, type: "fail", id: "d" },
  ];
  const before = replayLive(chainSpec(), events, 200);
  assert.equal(before.nodes.d, undefined, "filtered out while the node is unknown");

  const grown = chainSpec();
  grown.nodes.push({ id: "d" });
  assert.equal(replayLive(grown, events, 200).nodes.d.status, "failed");
});

test("replayLive: an explicit start() after a fail IS the retry — and counts a loop iteration", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "retry", source: "b", target: "b", loop: true, maxIterations: 3 },
    ],
  };
  const events = [
    { t: 0, type: "start", id: "b" },
    { t: 10, type: "fail", id: "b" },
    { t: 20, type: "start", id: "b" },   // the retry
  ];
  const mid = replayLive(spec, events, 15);
  assert.equal(mid.nodes.b.status, "failed");
  assert.equal(mid.loops.retry.iteration, 0);

  const st = replayLive(spec, events, 30);
  assert.equal(st.nodes.b.status, "active", "restarting a failed node re-activates it");
  assert.equal(st.nodes.b.occupancy, 1);
  assert.equal(st.loops.retry.iteration, 1, "a retry over a bounded loop edge is that loop's iteration");
  assert.equal(st.loops.retry.max, 3);
});

test("replayLive: a token merely ARRIVING at a failed node does not un-fail it (only a start does)", () => {
  const events = [
    { t: 0, type: "start", id: "b" },
    { t: 10, type: "fail", id: "b" },
    { t: 20, type: "start", id: "a" },
    { t: 30, type: "finish", id: "a" },  // hops a -> b, landing at 330
  ];
  const st = replayLive(chainSpec(), events, 500);
  assert.equal(st.nodes.b.status, "failed", "the failure is what happened; an arrival is not a retry");
  assert.equal(st.nodes.b.occupancy, 1, "the arrival is still queued, waiting for its own start()");
});

// ---------------------------------------------------------------------------
// Mode A — compileRun / data.fail
// ---------------------------------------------------------------------------

test("compileRun: data.fail runs the node's dwell and then fails it — no fan-out, no 'finish'", () => {
  const spec = chainSpec();
  spec.nodes[1].data = { fail: true }; // b
  const sim = compileRun(spec);

  const fail = sim.events.find((e) => e.type === "fail");
  assert.ok(fail, "a 'fail' event is emitted into the sim's event array");
  assert.equal(fail.nodeId, "b");
  assert.equal(fail.reason, undefined, "fail:true carries no reason");
  assert.ok(!sim.events.some((e) => e.type === "finish" && e.nodeId === "b"), "it never finished");
  assert.ok(sim.events.some((e) => e.type === "start" && e.nodeId === "b"), "but it did start and dwell");

  const start = sim.events.find((e) => e.type === "start" && e.nodeId === "b");
  assert.ok(fail.t > start.t, "the dwell ran in full before the failure");

  const mid = sim.stateAt((start.t + fail.t) / 2);
  assert.equal(mid.nodes.b.status, "active", "still working right up to the failure instant");

  const end = sim.stateAt(sim.duration);
  assert.equal(end.nodes.b.status, "failed");
  assert.equal(end.nodes.b.progress, 1);
  assert.equal(end.nodes.c.status, "pending", "the successor is never seeded");
  assert.equal(end.edges.bc.traversed, 0);
  assert.equal(end.done, true, "the dead branch's token is closed, so the run is done, not stalled");
});

test("compileRun: a string data.fail is carried through as the event's reason", () => {
  const spec = chainSpec();
  spec.nodes[1].data = { fail: "exit code 137" };
  const sim = compileRun(spec);
  assert.equal(sim.events.find((e) => e.type === "fail").reason, "exit code 137");
  assert.equal(sim.stateAt(sim.duration).nodes.b.status, "failed");
});

test("compileRun: only the failing branch dies — a sibling branch still completes, and a join below never fires", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "x", data: { fail: true } }, { id: "y" }, { id: "j" }],
    edges: [
      { id: "ax", source: "a", target: "x" },
      { id: "ay", source: "a", target: "y" },
      { id: "xj", source: "x", target: "j" },
      { id: "yj", source: "y", target: "j" },
    ],
  };
  const sim = compileRun(spec);
  const end = sim.stateAt(sim.duration);
  assert.equal(end.nodes.x.status, "failed");
  assert.equal(end.nodes.y.status, "done", "the healthy sibling is unaffected");
  assert.equal(end.edges.xj.traversed, 0, "nothing left the failed step");
  // The AND-join below never fires: only the healthy branch ever arrives. j is left holding
  // that one token at the join — pre-existing behavior for any unsatisfiable join (the
  // waiting token is what makes the run report itself stalled), not something fail() changes.
  assert.equal(end.joins.j.arrived, 1);
  assert.equal(end.joins.j.needed, 2);
  assert.equal(end.joins.j.fired, false);
  assert.equal(end.nodes.j.status, "active");
  assert.equal(end.nodes.j.progress, 0, "waiting at a join is not dwell progress");
  assert.equal(end.done, false, "a token still parked at a join stalls the run, as it always did");
});

test("compileRun: a container reports 'failed' when the work inside it failed, not 'done'", () => {
  const spec = {
    nodes: [
      { id: "a" },
      { id: "grp" },
      { id: "g1", parent: "grp", data: { fail: true } },
      { id: "z" },
    ],
    edges: [
      { id: "ag", source: "a", target: "grp" },
      { id: "gz", source: "grp", target: "z" },
    ],
  };
  const sim = compileRun(spec);
  const end = sim.stateAt(sim.duration);
  assert.equal(end.nodes.g1.status, "failed");
  assert.equal(end.nodes.grp.status, "failed", "the container rolls its descendants' failure up");
  assert.equal(end.nodes.z.status, "pending");
  // …and before the failure instant it still reads as working, not pre-emptively failed.
  const fail = sim.events.find((e) => e.type === "fail");
  assert.equal(sim.stateAt(fail.t - 1).nodes.grp.status, "active");
});

// ---------------------------------------------------------------------------
// The transport surface (both modes)
// ---------------------------------------------------------------------------

test("live transport: run.fail(id) logs a 'fail' entry, emits a 'fail' bus event, and drives the state", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  const seen = [];
  run.on("fail", (ev) => seen.push(ev));

  ticker.tick(100);
  run.start("a");
  ticker.tick(100); // frontier 200
  const at = run.fail("a", { reason: "OOM" });

  assert.equal(at, 200, "stamped at the frontier like every other entry");
  assert.deepEqual(run.log()[1], { t: 200, type: "fail", id: "a", reason: "OOM" });
  assert.deepEqual(seen, [{ id: "a", t: 200, reason: "OOM" }]);
  assert.equal(run.state().nodes.a.status, "failed");
  assert.equal(run.state().nodes.b.status, "pending");

  // time travel: scrub back before the fail and the node is active again
  run.seek(150);
  assert.equal(run.state().nodes.a.status, "active");
  run.follow();
  assert.equal(run.state().nodes.a.status, "failed");
  run.destroy();
});

test("live transport: a fail survives an options()/reset() round trip (reconnect/persistence)", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(100);
  run.start("a");
  run.fail("a", { reason: "boom" });
  const snapshot = run.options();
  assert.equal(snapshot.log.filter((e) => e.type === "fail").length, 1);

  run.reset(snapshot, 100);
  assert.equal(run.state().nodes.a.status, "failed", "the re-seeded log replays the failure");
  assert.equal(run.log()[1].reason, "boom");
  run.destroy();
});

test("live transport: fail() warns on an unknown id and on a node with zero occupancy", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(50);

  const unknown = captureWarnings(() => run.fail("nope"));
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /fail\("nope"\)/);
  assert.match(unknown[0], /no node "nope"/);

  const empty = captureWarnings(() => run.fail("b"));
  assert.equal(empty.length, 1);
  assert.match(empty[0], /zero current occupancy/, "same diagnostic finish() gives — no phantom flip");

  const clean = captureWarnings(() => { run.start("a"); run.fail("a"); });
  assert.deepEqual(clean, [], "a legitimate fail is silent");
  run.destroy();
});

test("live transport: play({until}) resolves on a failed node instead of hanging forever", async () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(100);
  run.start("a");
  run.fail("a");

  let settled = false;
  const p = run.play({ until: "a" }).then((r) => { settled = true; return r; });
  ticker.tick(16);
  assert.equal((await p).canceled, false);
  assert.equal(settled, true);
  assert.equal(run.timeOf("a"), 100, "timeOf() reports the fail instant, not the frontier");
  run.destroy();
});

test("sim transport: a 'fail' event is re-emitted on the run bus, and timeOf() stops at it", () => {
  const spec = chainSpec();
  spec.nodes[1].data = { fail: true };
  const { ticker, store } = makeInternals(spec);
  const run = createRunTransport({ ticker, store }, {});
  const seen = [];
  run.on("fail", (ev) => seen.push(ev));

  const failT = run.sim().events.find((e) => e.type === "fail").t;
  assert.equal(run.timeOf("b"), failT, "a failed node's 'until' time is when it failed");

  for (let i = 0; i < 20 && run.time() < run.duration; i++) run.step();
  assert.equal(seen.length, 1, "forward playback re-emits it exactly once");
  assert.equal(seen[0].nodeId, "b");
  assert.equal(run.state().nodes.b.status, "failed");
  run.destroy();
});

test("sim transport: play({until}) on a node that fails resolves rather than waiting for a 'done' that never comes", async () => {
  const spec = chainSpec();
  spec.nodes[1].data = { fail: true };
  const { ticker, store } = makeInternals(spec);
  const run = createRunTransport({ ticker, store }, {});
  let settled = false;
  const p = run.play({ until: "b" }).then((r) => { settled = true; return r; });
  for (let i = 0; i < 200 && !settled; i++) ticker.tick(50);
  assert.equal((await p).canceled, false);
  assert.equal(run.state().nodes.b.status, "failed");
  run.destroy();
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

test("styles: a failed node is visually distinct through the --smv-fail token in BOTH themes", () => {
  assert.match(CSS, /\.smv-node\[data-run="failed"\]\{--smv-fill:var\(--smv-fail\); --smv-stroke:var\(--smv-fail-stroke\)\}/);
  // Declared once for light and once for each dark entry point (explicit + prefers-color-scheme),
  // exactly like every other status token, so a theme swap never leaves it undefined.
  assert.equal((CSS.match(/--smv-fail:/g) || []).length, 3);
  assert.equal((CSS.match(/--smv-fail-stroke:/g) || []).length, 3);
  const dark = CSS.slice(CSS.indexOf('.smv-root[data-smv-theme="dark"]'));
  assert.match(dark, /--smv-fail:#2a1a1d/);
});
