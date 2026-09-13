// Mode A frictions F1/F3/F4/F7/F8/F9 (docs/API-FRICTIONS.md §1): retry budgets on a
// declared failure, mid-graph seeds, a declared start instant, playback vs the declared
// timeline, per-edge hop times, and multi-port containers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRun } from "../src/run.js";
import { createRunTransport } from "../src/run-transport.js";
import { createTicker } from "../src/anim.js";
import { Store } from "../src/store.js";
import { emitter } from "../src/events.js";

const evs = (sim, type) => sim.events.filter((e) => e.type === type);
const chain = () => ({
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }],
});

function captureWarnings(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return calls;
}

function internals(spec = chain()) {
  return { ticker: createTicker({ manual: true }), store: new Store(spec), bus: emitter() };
}

// ---------------------------------------------------------------------------
// F1 — a failed step takes its own retry loop
// ---------------------------------------------------------------------------

test("F1: data.fail {retries} re-runs the dwell, and 'failed' is terminal only once the budget is spent", () => {
  const spec = chain();
  spec.nodes[1].data = { fail: { reason: "503", retries: 2 } };
  const sim = compileRun(spec);

  const fails = evs(sim, "fail");
  assert.equal(fails.length, 3, "one 'fail' per attempt — narration hangs off real events");
  assert.deepEqual(fails.map((e) => e.attempt), [1, 2, 3]);
  assert.deepEqual(fails.map((e) => e.terminal), [false, false, true]);
  assert.deepEqual(fails.map((e) => e.reason), ["503", "503", "503"]);
  assert.deepEqual(fails.map((e) => e.retries), [2, 2, 2]);

  const loops = evs(sim, "loop");
  assert.equal(loops.length, 2, "one 'loop' per retry");
  assert.deepEqual(loops.map((e) => e.iteration), [1, 2]);
  assert.equal(loops[0].edgeId, null, "no arc was declared, so the retry has no edge to name");

  // Status: still working through the retries, terminal only at the last attempt.
  assert.equal(sim.stateAt(fails[0].t).nodes.b.status, "active");
  assert.equal(sim.stateAt(fails[1].t).nodes.b.status, "active");
  assert.equal(sim.stateAt(fails[2].t).nodes.b.status, "failed");
  assert.equal(sim.stateAt(sim.duration).nodes.c.status, "pending", "nothing is ever handed on");
  assert.equal(sim.stateAt(sim.duration).done, true);
  // Each attempt really re-ran the dwell: three starts, evenly spaced.
  assert.equal(evs(sim, "start").filter((e) => e.nodeId === "b").length, 3);
});

test("F1: fail: true and a string are unchanged — one attempt, terminal, no retry", () => {
  for (const f of [true, "exit 137"]) {
    const spec = chain();
    spec.nodes[1].data = { fail: f };
    const sim = compileRun(spec);
    assert.equal(evs(sim, "fail").length, 1);
    assert.equal(evs(sim, "fail")[0].terminal, true);
    assert.equal(evs(sim, "loop").length, 0);
    assert.equal(sim.stateAt(sim.duration).nodes.b.status, "failed");
  }
});

test("F1: a loop edge with onFail:true supplies the budget, owns the arc, and never fires on success", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "b", data: { fail: "timeout" } }, { id: "c" }],
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "retry", source: "b", target: "b", loop: true, onFail: true, maxIterations: 3 },
      { id: "bc", source: "b", target: "c" },
    ],
  };
  const sim = compileRun(spec);
  assert.deepEqual(evs(sim, "fail").map((e) => e.attempt), [1, 2, 3, 4], "3 retries after the first attempt");
  assert.deepEqual(evs(sim, "loop").map((e) => [e.edgeId, e.iteration]), [["retry", 1], ["retry", 2], ["retry", 3]]);
  const end = sim.stateAt(sim.duration);
  assert.deepEqual(end.loops.retry, { iteration: 3, max: 3 }, "the badge ticks off the real loop state");
  assert.equal(end.nodes.b.status, "failed");
  assert.equal(end.nodes.c.status, "pending");
  assert.equal(end.edges.retry.traversed, 1, "the retry arc was really crossed");

  // opts.iterations caps it, exactly as it caps an ordinary loop.
  assert.equal(evs(compileRun(spec, { iterations: { retry: 1 } }), "fail").length, 2);

  // …and with the failure removed the arc is inert: it only ever fires out of a failure.
  const healthy = JSON.parse(JSON.stringify(spec));
  delete healthy.nodes[1].data;
  const ok = compileRun(healthy);
  assert.equal(evs(ok, "loop").length, 0, "an onFail arc is not an ordinary retry loop");
  assert.equal(ok.stateAt(ok.duration).nodes.c.status, "done");
});

test("F1: recover:true lets the last attempt succeed — fail, retry, pass", () => {
  const spec = chain();
  spec.nodes[1].data = { fail: { reason: "flaky", retries: 1, recover: true } };
  const sim = compileRun(spec);
  const fails = evs(sim, "fail");
  assert.equal(fails.length, 1, "only the attempts that actually failed emit 'fail'");
  assert.equal(fails[0].terminal, false);
  assert.equal(evs(sim, "loop").length, 1);
  const finish = evs(sim, "finish").find((e) => e.nodeId === "b");
  assert.equal(finish.attempt, 2, "the second attempt is the one that worked");
  const end = sim.stateAt(sim.duration);
  assert.equal(end.nodes.b.status, "done");
  assert.equal(end.nodes.c.status, "done", "and the branch continues downstream");
});

test("F1: a retry arc into another node re-enters THAT node", () => {
  const spec = {
    nodes: [{ id: "plan" }, { id: "apply", data: { fail: { reason: "429", retries: 1 } } }],
    edges: [
      { id: "pa", source: "plan", target: "apply" },
      { id: "back", source: "apply", target: "plan", loop: true, onFail: true, maxIterations: 2 },
    ],
  };
  const sim = compileRun(spec);
  const starts = evs(sim, "start").map((e) => e.nodeId);
  assert.deepEqual(starts, ["plan", "apply", "plan", "apply"], "the retry replays the loop edge's target");
  assert.equal(sim.stateAt(sim.duration).nodes.apply.status, "failed");
});

// ---------------------------------------------------------------------------
// F3 — mid-graph seeds
// ---------------------------------------------------------------------------

test("F3: data.entry:true mints a token at a node that is not a root", () => {
  const spec = chain();
  spec.nodes[1].data = { entry: true };          // b is fed by a AND seeded itself
  const sim = compileRun(spec);
  const enters = evs(sim, "enter").filter((e) => e.nodeId === "b");
  assert.equal(enters.length, 2, "one from the seed, one from a's fan-out");
  assert.equal(enters[0].t, 0, "the declared seed appears at t = 0");
  assert.equal(enters[0].edgeId, undefined, "…and it came from nowhere, like a root's");
  assert.equal(sim.stateAt(sim.duration).nodes.c.status, "done");
});

test("F3: run.inject(id, {at}) mints a token on the compiled clock and extends the schedule", () => {
  const { ticker, store, bus } = internals();
  const run = createRunTransport({ ticker, store, bus }, {});
  const before = run.duration;
  run.seek(before);

  const seen = [];
  run.on("enter", (e) => seen.push(e.nodeId));
  const at = run.inject("c", { at: before + 1000 });
  assert.equal(at, before + 1000);
  assert.ok(run.duration > before, "the schedule grew around the injected token");
  assert.deepEqual(run.options().entries, [{ id: "c", at }], "the seed is a compile input, so it survives recompiles");

  run.seek(run.duration);
  assert.equal(run.state().nodes.c.status, "done");
  // A speed()/mutation recompile does not lose it.
  run.speed(0.5, { branch: "b" });
  assert.deepEqual(run.options().entries, [{ id: "c", at }]);
  run.destroy();
});

test("F3: inject() warns on an unknown id but keeps the seed for when the node arrives", () => {
  const { ticker, store, bus } = internals();
  const run = createRunTransport({ ticker, store, bus }, {});
  const warns = captureWarnings(() => run.inject("later", { at: 0 }));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[smv:run\] inject\("later"\)/);

  store.addNode({ id: "later" });
  bus.emit("add", { kind: "node", id: "later" });
  run.seek(run.duration);
  assert.equal(run.state().nodes.later.status, "done", "the seed self-heals onto the node");
  run.destroy();
});

// ---------------------------------------------------------------------------
// F4 — a declared start instant, and a node that joins the run late
// ---------------------------------------------------------------------------

test("F4: data.startAt parks a root's token until its declared instant", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "late", data: { startAt: 5000 } }],
    edges: [],
  };
  const sim = compileRun(spec);
  assert.equal(evs(sim, "enter").find((e) => e.nodeId === "late").t, 5000);
  assert.equal(sim.stateAt(4000).nodes.late.status, "pending", "nothing has happened to it yet");
  assert.equal(sim.stateAt(5100).nodes.late.status, "active");
  assert.ok(sim.duration >= 5600);

  // The duration grammar works too: a string is read as seconds.
  const str = compileRun({ nodes: [{ id: "late", data: { startAt: "2s" } }], edges: [] });
  assert.equal(evs(str, "enter")[0].t, 2000);

  const warns = captureWarnings(() => compileRun({ nodes: [{ id: "x", data: { startAt: "soon" } }], edges: [] }));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[smv:run\].*unparseable startAt/);
});

test("F4: a node added while the run is past its compiled start still emits enter/start", () => {
  const { ticker, store, bus } = internals();
  const run = createRunTransport({ ticker, store, bus }, {});
  run.seek(run.duration);                 // the whole chain has already played
  const seen = [];
  for (const type of ["enter", "start", "finish"]) run.on(type, (e) => seen.push(`${type}:${e.nodeId}`));

  store.addNode({ id: "compensate", data: { entry: true } });
  bus.emit("add", { kind: "node", id: "compensate" });
  run.reload();                           // sample -> recompile

  assert.deepEqual(seen, ["enter:compensate", "start:compensate", "finish:compensate"],
    "its events are behind the cursor, so the transport replays them once");
  assert.equal(run.state().nodes.compensate.status, "done");

  // A second recompile must not re-fire them.
  seen.length = 0;
  run.speed(0.5, { branch: "a" });
  assert.deepEqual(seen, []);
  run.destroy();
});

// ---------------------------------------------------------------------------
// F7 — declared timeline vs playback
// ---------------------------------------------------------------------------

test("F7: a bare speed() is playback only — the declared duration never moves", () => {
  const { ticker, store, bus } = internals();
  const run = createRunTransport({ ticker, store, bus }, {});
  const declared = run.duration;

  run.speed(2);
  assert.equal(run.duration, declared, "the compiled timeline a page reports is untouched");
  assert.equal(run.sim().declared, declared);
  assert.equal(run.sim().playback, declared / 2, "…but it plays back in half the wall-clock time");
  assert.equal(run.playbackSpeed(), 2);

  // …and it really does move the clock twice as fast.
  run.seek(0);
  run.play();
  ticker.tick(100);
  assert.equal(run.time(), 200);

  run.speed(0);
  assert.equal(run.sim().playback, Infinity, "speed 0 is a freeze");
  ticker.tick(100);
  assert.equal(run.time(), 200);
  run.destroy();
});

test("F7: a per-branch speed() is still a compile input and still re-times the schedule", () => {
  const { ticker, store, bus } = internals();
  const run = createRunTransport({ ticker, store, bus }, {});
  const declared = run.duration;
  run.speed(0.5, { branch: "b" });
  assert.ok(run.duration > declared, "slowing one branch lengthens the declared timeline");
  assert.equal(run.options().rates.length, 1);
  assert.equal(run.playbackSpeed(), 1, "playback is a separate axis");
  run.destroy();
});

test("F7: the playback multiplier round-trips through options()/reset()", () => {
  const { ticker, store, bus } = internals();
  const run = createRunTransport({ ticker, store, bus }, {});
  run.speed(4);
  const snap = run.options();
  assert.equal(snap.playbackSpeed, 4);
  run.reset(snap, 0);
  assert.equal(run.playbackSpeed(), 4);
  run.reset({}, 0);
  assert.equal(run.playbackSpeed(), 1, "an opts-less reset returns to real declared time");
  run.destroy();
});

// ---------------------------------------------------------------------------
// F8 — per-edge hop times
// ---------------------------------------------------------------------------

test("F8: edge.data.duration is the hop time for that edge, hopMs is the default", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "near" }, { id: "far" }],
    edges: [
      { id: "local", source: "a", target: "near", data: { duration: "1ms" } },
      { id: "region", source: "a", target: "far", data: { duration: "400ms" } },
    ],
  };
  const sim = compileRun(spec);
  const arrive = (id) => evs(sim, "enter").find((e) => e.nodeId === id).t;
  const left = evs(sim, "finish").find((e) => e.nodeId === "a").t;
  assert.ok(arrive("far") - left > arrive("near") - left,
    "the cross-region wire visibly takes longer than the local call");

  // No declared duration -> hopMs, and hopMs still moves it.
  const bare = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ id: "ab", source: "a", target: "b" }] };
  const d = compileRun(bare);
  const fast = compileRun(bare, { hopMs: 30 });
  assert.equal(evs(d, "enter").find((e) => e.nodeId === "b").t - evs(d, "finish")[0].t, 300);
  assert.equal(evs(fast, "enter").find((e) => e.nodeId === "b").t - evs(fast, "finish")[0].t, 30);

  // An unparseable edge duration warns and falls back, exactly as a node's does.
  const warns = captureWarnings(() => {
    const bad = compileRun({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ id: "ab", source: "a", target: "b", data: { duration: "45mins" } }] });
    assert.ok(bad.events.some((e) => e.type === "warn" && e.edgeId === "ab"));
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /edge "ab" has an unparseable duration/);
});

// ---------------------------------------------------------------------------
// F9 — container entry/exit ports
// ---------------------------------------------------------------------------

const toolbox = (ports = {}) => ({
  nodes: [
    { id: "agent" },
    { id: "tools", ...ports },
    { id: "search", parent: "tools" }, { id: "calc", parent: "tools" }, { id: "sql", parent: "tools" },
    { id: "answer" },
  ],
  edges: [
    { id: "at", source: "agent", target: "tools" },
    { id: "ta", source: "tools", target: "answer" },
  ],
});

test("F9: entry:[ids] fans an edge into a container out to every entry child", () => {
  const sim = compileRun(toolbox({ entry: ["search", "calc", "sql"], exit: ["search", "calc", "sql"] }));
  const end = sim.stateAt(sim.duration);
  for (const id of ["search", "calc", "sql"]) assert.equal(end.nodes[id].status, "done", `${id} saw a token`);
  assert.equal(evs(sim, "spawn").length, 2, "a fan-out into 3 entries is a 3-way split, like any other");
  assert.deepEqual(end.joins.answer, { arrived: 3, needed: 3, fired: true }, "the exits join below the container");
  assert.equal(end.nodes.answer.status, "done");
  assert.equal(end.nodes.tools.status, "done", "the container still rolls its children up");
});

test("F9: with no ports declared a container still routes to ONE child (unchanged default)", () => {
  const sim = compileRun(toolbox());
  const enters = evs(sim, "enter");
  const via = (id) => enters.filter((e) => e.nodeId === id && e.edgeId === "at").length;
  assert.equal(via("search"), 1, "the inferred single entry child takes the edge");
  assert.equal(via("calc"), 0, "…and the siblings never see the agent's token (the F9 complaint)");
  assert.equal(via("sql"), 0);
  assert.equal(evs(sim, "spawn").length, 0, "one in-edge, one token");
  assert.equal(sim.stateAt(sim.duration).joins.answer, undefined, "and one exit, so no join below");
});

test("F9: exits alone join below; entries alone fan out above", () => {
  const exits = compileRun(toolbox({ exit: ["search", "calc"] }));
  const e = exits.stateAt(exits.duration);
  assert.equal(e.joins.answer.needed, 2, "two exits means an implicit AND-join at the target");
  assert.equal(e.nodes.answer.status, "done");

  const entries = compileRun(toolbox({ entry: ["search", "calc"] }));
  const via = evs(entries, "enter").filter((ev) => ev.edgeId === "at").map((ev) => ev.nodeId);
  assert.deepEqual(via.sort(), ["calc", "search"], "both declared entries take the incoming edge");
  assert.equal(entries.stateAt(entries.duration).joins.answer, undefined, "but the exit is still single");
});

test("F9: a port that is not inside the container warns and is ignored", () => {
  const warns = captureWarnings(() => compileRun(toolbox({ entry: ["search", "answer"] })));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[smv:run\] container "tools" declares entry "answer"/);
});

test("F9: run.inject() into a container seeds every entry child", () => {
  const { ticker, store, bus } = internals(toolbox({ entry: ["search", "calc"] }));
  const run = createRunTransport({ ticker, store, bus }, {});
  run.inject("tools", { at: 0 });
  run.seek(run.duration);
  const st = run.state();
  assert.equal(st.nodes.search.occupancy, 0);
  assert.equal(st.nodes.search.status, "done");
  assert.equal(st.nodes.calc.status, "done");
  run.destroy();
});
