// M2 verify findings — Mode B (live) engine + transport.
//
// Every test here failed against the code as first written; each one pins the fix for one
// confirmed finding, named in its title. Same fake-host technique as
// test/run-live-transport.test.js (real ticker in manual mode, real Store, real emitter).

import { test } from "node:test";
import assert from "node:assert/strict";
import { replayLive } from "../src/run-live.js";
import { createRunTransport } from "../src/run-transport.js";
import { createTicker } from "../src/anim.js";
import { Store } from "../src/store.js";
import { emitter } from "../src/events.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
const flush = () => new Promise((r) => setTimeout(r, 0));

const chain = () => ({
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }],
});

// ---------------------------------------------------------------------------
// Finding 1 — a start() sooner than hopMs after the upstream finish() must consume the
// in-flight hop, not fabricate a second token and strand the real one.
// ---------------------------------------------------------------------------

test("replayLive: a start() that beats the in-flight hop consumes it instead of stranding it", () => {
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 50, type: "finish", id: "a" },   // default hopMs 300 => would land on b at 350
    { t: 55, type: "start", id: "b" },    // ...but b starts 5ms later, a normal fast pipeline
    { t: 105, type: "finish", id: "b" },
  ];
  const st = replayLive(chain(), events, 5000);
  assert.equal(st.nodes.b.status, "done", "b is done, not un-done by a late arrival");
  assert.equal(st.nodes.b.occupancy, 0, "no stranded token left waiting on b");
  assert.equal(st.nodes.c.occupancy, 1, "the ONE real token carried on to c");
  assert.equal(st.tokens.length, 1, "exactly one token exists, not a phantom plus a stranded one");
  near(st.edges.ab.traversed, 1);
});

test("replayLive: the consumed hop's edge fill truncates to the start instant", () => {
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 0, type: "finish", id: "a" },
    { t: 50, type: "start", id: "b" },
  ];
  const st = replayLive(chain(), events, 60, { hopMs: 300 });
  near(st.edges.ab.traversed, 1); // the token demonstrably arrived, so its edge reads full
  assert.equal(st.tokens.length, 1);
  assert.equal(st.tokens[0].at.kind, "node");
  assert.equal(st.tokens[0].at.id, "b");
  assert.equal(st.nodes.b.status, "active");
});

test("live transport: a fast hand-off (start before hopMs elapses) does not strand tokens", () => {
  const ticker = createTicker({ manual: true });
  const store = new Store(chain());
  const run = createRunTransport({ ticker, store }, { mode: "live", hopMs: 300 });
  ticker.tick(10);
  run.start("a", { at: 0 });
  run.finish("a", { at: 5 });
  run.start("b", { at: 8 });
  run.finish("b", { at: 10 });
  ticker.tick(2000);
  const st = run.state();
  assert.equal(st.nodes.b.status, "done");
  assert.equal(st.nodes.b.occupancy, 0);
  assert.equal(st.nodes.c.occupancy, 1);
  run.destroy();
});

// ---------------------------------------------------------------------------
// Finding 2 — a derived hop landing is causally prior to any log event stamped at the
// same instant, so it must sort BEFORE them.
// ---------------------------------------------------------------------------

test("replayLive: a landing coincident with the target's start is the token that starts", () => {
  const spec = {
    nodes: [{ id: "A" }, { id: "B" }, { id: "D" }, { id: "J", join: "all" }],
    edges: [
      { id: "ab", source: "A", target: "B" },
      { id: "bj", source: "B", target: "J" },
      { id: "dj", source: "D", target: "J" },
    ],
  };
  const events = [
    { t: 0, type: "start", id: "A" }, { t: 0, type: "finish", id: "A" }, // lands on B at 100
    { t: 100, type: "start", id: "B" },                                  // exactly coincident
    { t: 200, type: "finish", id: "B" },
  ];
  const st = replayLive(spec, events, 400, { hopMs: 100 });
  assert.deepEqual(st.joins.J, { arrived: 1, needed: 2, fired: false },
    "an AND-join must not fire off one doubled branch while D never ran");
  assert.equal(st.nodes.J.occupancy, 1);
  assert.equal(st.nodes.B.occupancy, 0, "no orphaned waiting token left on B");
  near(st.edges.dj.traversed, 0);
});

test("replayLive: a coincident chain (hopMs 0) carries exactly one token end to end", () => {
  const ids = ["n1", "n2", "n3", "n4", "n5"];
  const spec = {
    nodes: ids.map((id) => ({ id })),
    edges: ids.slice(1).map((id, i) => ({ id: `e${i}`, source: ids[i], target: id })),
  };
  // every hand-off coincident: each start lands on the same instant as its inbound hop
  const events = [];
  for (const id of ids) {
    events.push({ t: 0, type: "start", id });
    events.push({ t: 0, type: "finish", id });
  }
  const st = replayLive(spec, events, 1000, { hopMs: 0 });
  for (const id of ids) {
    assert.equal(st.nodes[id].occupancy, 0, `${id} holds no stray token`);
    assert.equal(st.nodes[id].status, "done", `${id} stayed done`);
  }
  assert.equal(st.tokens.length, 0);
  assert.equal(st.done, true);
});

// ---------------------------------------------------------------------------
// Finding 16 — joins[id].arrived saturates at `needed`, exactly as Mode A.
// ---------------------------------------------------------------------------

test("replayLive: join arrivals saturate at `needed` (Mode A drops post-fire arrivals)", () => {
  const spec = {
    nodes: [{ id: "x" }, { id: "y" }, { id: "j", join: "any" }],
    edges: [{ id: "xj", source: "x", target: "j" }, { id: "yj", source: "y", target: "j" }],
  };
  const events = [
    { t: 0, type: "start", id: "x" }, { t: 0, type: "finish", id: "x" },
    { t: 0, type: "start", id: "y" }, { t: 10, type: "finish", id: "y" },
  ];
  assert.deepEqual(replayLive(spec, events, 1000).joins.j, { arrived: 1, needed: 1, fired: true });

  // ...and it does not keep climbing across live loop iterations either.
  const many = [];
  for (let i = 0; i < 20; i++) {
    many.push({ t: i * 10, type: "start", id: "x" }, { t: i * 10 + 1, type: "finish", id: "x" });
  }
  assert.equal(replayLive(spec, many, 10000).joins.j.arrived, 1);
});

// ---------------------------------------------------------------------------
// Finding 10 — an edge that did not exist when a node finished must not retroactively
// fan a token out of that finish.
// ---------------------------------------------------------------------------

test("live transport: an edge added after a node finished does not fabricate history", () => {
  const ticker = createTicker({ manual: true });
  const store = new Store({
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [{ id: "ab", source: "A", target: "B" }],
  });
  const bus = emitter();
  const run = createRunTransport({ ticker, store, bus }, { mode: "live", hopMs: 100 });
  run.start("A", { at: 0 });
  ticker.tick(10);
  run.finish("A", { at: 10 });
  ticker.tick(500);
  assert.equal(run.state().nodes.C.occupancy, 0);

  store.addEdge({ id: "ac", source: "A", target: "C" });
  bus.emit("add", { kind: "edge", id: "ac", item: store.edge("ac") });
  ticker.tick(16);

  const st = run.state();
  assert.equal(st.nodes.C.occupancy, 0, "a finish that predates the edge does not travel it");
  near(st.edges.ac.traversed, 0);
  // scrubbing back to before the edge existed must not show a token on it either
  run.seek(150);
  assert.equal(run.state().tokens.filter((tk) => tk.at.id === "ac" || tk.at.id === "C").length, 0);
  run.destroy();
});

test("live transport: an edge added BEFORE the finish still fans out normally", () => {
  const ticker = createTicker({ manual: true });
  const store = new Store({ nodes: [{ id: "A" }, { id: "C" }], edges: [] });
  const bus = emitter();
  const run = createRunTransport({ ticker, store, bus }, { mode: "live", hopMs: 100 });
  ticker.tick(10);
  store.addEdge({ id: "ac", source: "A", target: "C" });
  bus.emit("add", { kind: "edge", id: "ac", item: store.edge("ac") });
  run.start("A");
  ticker.tick(10);
  run.finish("A");
  ticker.tick(500);
  assert.equal(run.state().nodes.C.occupancy, 1);
  run.destroy();
});

// ---------------------------------------------------------------------------
// Findings 3 + 4 — condense/split during a live run must remap the log, not erase it.
// ---------------------------------------------------------------------------

function liveHost(spec, opts = {}) {
  const ticker = createTicker({ manual: true });
  const store = new Store(spec);
  const bus = emitter();
  const run = createRunTransport({ ticker, store, bus }, { mode: "live", hopMs: 100, ...opts });
  return { ticker, store, bus, run };
}

test("live transport: condense remaps the log onto the merged node instead of dropping it", () => {
  const { ticker, store, bus, run } = liveHost({
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [{ id: "ab", source: "A", target: "B" }, { id: "bc", source: "B", target: "C" }],
  });
  run.start("A", { at: 0 });
  ticker.tick(10);
  run.finish("A", { at: 10 });
  ticker.tick(500);
  const before = run.state();
  assert.equal(before.nodes.B.occupancy, 1);
  assert.equal(before.done, false);

  const remaps = [];
  run.on("remap", (e) => remaps.push(e));
  store.condense(["A"], { id: "A2" });
  bus.emit("condense", { sources: ["A"], target: "A2" });

  const st = run.state();
  assert.equal(st.nodes.A2.status, "done", "the merged node inherited its source's history");
  assert.equal(st.nodes.B.occupancy, 1, "the token that had already landed survived the merge");
  near(st.edges["ab~A2"].traversed, 1); // the redirected edge carries the traversal fill
  assert.equal(st.done, false, "a run mid-pipeline does not flip to done");
  assert.equal(remaps.length, 1, "the live transport announces the remap like Mode A does");
  assert.equal(remaps[0].target, "A2");
  assert.deepEqual(remaps[0].sources, ["A"]);
  run.destroy();
});

test("live transport: condensing two nodes keeps the merged node's progress and history", () => {
  const { ticker, store, bus, run } = liveHost({
    nodes: [{ id: "A" }, { id: "B", data: { duration: "10s" } }, { id: "C" }],
    edges: [{ id: "ab", source: "A", target: "B" }, { id: "bc", source: "B", target: "C" }],
  });
  run.start("A", { at: 0 });
  ticker.tick(10);
  run.finish("A", { at: 10 });
  ticker.tick(200);
  run.start("B", { at: 200 });
  ticker.tick(300);
  assert.equal(run.state().nodes.B.status, "active");

  store.condense(["A", "B"], { id: "M", data: { duration: "10s" } });
  bus.emit("condense", { sources: ["A", "B"], target: "M" });

  const st = run.state();
  assert.equal(st.nodes.M.status, "active", "the merged node is still working, not reset to pending");
  assert.ok(st.nodes.M.progress > 0, "and it kept the dwell its sources had earned");
  assert.equal(st.done, false);
  assert.equal(run.log().some((e) => e.id === "A" || e.id === "B"), false, "the log names the merged node now");
  run.destroy();
});

test("live transport: split remaps the log onto the entry part", () => {
  const { ticker, store, bus, run } = liveHost({
    nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
    edges: [{ id: "am", source: "A", target: "M" }, { id: "mz", source: "M", target: "Z" }],
  });
  run.start("M", { at: 0 });
  ticker.tick(10);
  assert.equal(run.state().nodes.M.status, "active");

  const { added } = store.split("M", {
    nodes: [{ id: "m1" }, { id: "m2" }],
    edges: [{ id: "m1m2", source: "m1", target: "m2" }],
  });
  bus.emit("split", { source: "M", targets: added });
  ticker.tick(10);

  const st = run.state();
  assert.equal(st.nodes.m1.status, "active", "the entry part inherited the split node's history");
  assert.equal(st.done, false);
  run.destroy();
});

// ---------------------------------------------------------------------------
// Finding 8 — play({until}) must wait on the node, not resolve on the frontier.
// ---------------------------------------------------------------------------

test("live transport: play({until}) in the default following state waits for that node", async () => {
  const ticker = createTicker({ manual: true });
  const store = new Store(chain());
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  const seen = [];
  run.on("play", () => seen.push("play"));
  run.on("end", () => seen.push("end"));

  ticker.tick(30); // following: t === frontier === 30
  let res = null;
  run.play({ until: "b" }).then((r) => { res = r; });
  ticker.tick(10);
  await flush();
  assert.equal(res, null, "does not resolve while b is still pending");
  assert.deepEqual(seen, ["play"], "and it really did emit play");
  assert.equal(run.playing, true);

  run.start("b");
  run.finish("b");
  ticker.tick(10);
  await flush();
  assert.deepEqual(res, { canceled: false });
  assert.deepEqual(seen, ["play", "end"]);
  run.destroy();
});

test("live transport: play({until}) on an unknown node still resolves immediately", async () => {
  const ticker = createTicker({ manual: true });
  const run = createRunTransport({ ticker, store: new Store(chain()) }, { mode: "live" });
  ticker.tick(20);
  let res = null;
  run.play({ until: "nope" }).then((r) => { res = r; });
  await flush();
  assert.deepEqual(res, { canceled: false });
  run.destroy();
});

// ---------------------------------------------------------------------------
// Finding 9 — options()/reset() must round-trip a live run losslessly.
// ---------------------------------------------------------------------------

test("live transport: reset(options()) preserves the log and the frontier", () => {
  const ticker = createTicker({ manual: true });
  const store = new Store(chain());
  const run = createRunTransport({ ticker, store }, { mode: "live", hopMs: 50 });
  run.start("a", { at: 0 });
  ticker.tick(10);
  run.finish("a", { at: 10 });
  ticker.tick(90); // frontier = 100
  const snapOpts = run.options();
  const snapTime = run.time();
  assert.equal(run.log().length, 2);

  run.reset(snapOpts, snapTime);
  assert.equal(run.log().length, 2, "the round trip did not delete the run's history");
  assert.ok(run.now() >= 10, "the frontier covers the log it was re-seeded with");
  assert.equal(run.state().nodes.a.status, "done");
  run.destroy();
});

test("live transport: a log seeded through opts.log is reachable without waiting out its span", () => {
  const ticker = createTicker({ manual: true });
  const store = new Store(chain());
  const run = createRunTransport({ ticker, store }, {
    mode: "live",
    log: [{ t: 0, type: "start", id: "a" }, { t: 3000, type: "finish", id: "a" }],
  });
  assert.equal(run.now(), 3000, "the frontier covers the seeded log");
  assert.equal(run.state().nodes.a.status, "done");
  assert.equal(run.seek(3000), 3000);
  run.destroy();
});

// ---------------------------------------------------------------------------
// Finding 15 — state() must not re-replay the whole log on every idle frame.
// ---------------------------------------------------------------------------

test("live transport: state() is memoized per (view time, spec revision, log length)", () => {
  const ticker = createTicker({ manual: true });
  const store = new Store(chain());
  let specCalls = 0;
  const realSpec = store.spec.bind(store);
  store.spec = () => { specCalls++; return realSpec(); };

  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(16);
  run.state();
  const base = specCalls;
  run.state(); run.state(); run.state();
  assert.equal(specCalls, base, "repeat samples at the same instant reuse the last replay");

  ticker.tick(16); // t moved
  run.state();
  assert.ok(specCalls > base, "a new view time re-replays");

  const afterTick = specCalls;
  run.start("a");
  run.state();
  assert.ok(specCalls > afterTick, "a new event re-replays");

  const afterEvent = specCalls;
  store.addNode({ id: "zzz" });
  const st = run.state();
  assert.ok(specCalls > afterEvent, "a spec mutation re-replays");
  assert.ok("zzz" in st.nodes);
  run.destroy();
});

test("live transport: a memoized state() hands out fresh objects each call", () => {
  const ticker = createTicker({ manual: true });
  const run = createRunTransport({ ticker, store: new Store(chain()) }, { mode: "live" });
  ticker.tick(16);
  run.start("a", { at: 0 });
  const a = run.state();
  a.nodes.a.status = "MUTATED";
  a.tokens.length = 0;
  const b = run.state();
  assert.equal(b.nodes.a.status, "active", "the cache is not corrupted by a consumer's edits");
  assert.equal(b.tokens.length, 1);
  run.destroy();
});
