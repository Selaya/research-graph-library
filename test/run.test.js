import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, compileRun } from "../src/run.js";
import { Store } from "../src/store.js";

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

const evs = (sim, type) => sim.events.filter((e) => e.type === type);
const firstEv = (sim, type, pred = () => true) => sim.events.find((e) => e.type === type && pred(e));
const tokenAt = (state, id) => state.tokens.find((tk) => tk.id === id);

// ---- fixtures ------------------------------------------------------------

/** collect fans out to 3 branches at different declared durations, joining on `report`. */
function fanoutSpec(join = "all") {
  return {
    nodes: [
      { id: "a" },
      { id: "b", data: { duration: "1s" } },
      { id: "c", data: { duration: "2s" } },
      { id: "d", data: { duration: "4s" } },
      { id: "j", join },
    ],
    edges: [
      { id: "a-b", source: "a", target: "b" },
      { id: "a-c", source: "a", target: "c" },
      { id: "a-d", source: "a", target: "d" },
      { id: "b-j", source: "b", target: "j" },
      { id: "c-j", source: "c", target: "j" },
      { id: "d-j", source: "d", target: "j" },
    ],
  };
}

/** The §5.1 pipeline: 3-way fan-out at different dwells, join:"all", retry loop. */
function pipelineSpec() {
  return {
    nodes: [
      { id: "collect" },
      { id: "lint", data: { duration: "8s" } },
      { id: "unit", data: { duration: "40s" } },
      { id: "e2e", data: { duration: "3m" } },
      { id: "report", join: "all" },
      { id: "deploy.push" },
      { id: "deploy.check" },
      { id: "monitor" },
    ],
    edges: [
      { id: "c-l", source: "collect", target: "lint" },
      { id: "c-u", source: "collect", target: "unit" },
      { id: "c-e", source: "collect", target: "e2e" },
      { id: "l-r", source: "lint", target: "report" },
      { id: "u-r", source: "unit", target: "report" },
      { id: "e-r", source: "e2e", target: "report" },
      { id: "r-p", source: "report", target: "deploy.push" },
      { id: "p-c", source: "deploy.push", target: "deploy.check" },
      { id: "retry", source: "deploy.check", target: "deploy.push", loop: true, maxIterations: 5 },
      { id: "c-m", source: "deploy.check", target: "monitor" },
    ],
  };
}

/** `b` is BOTH a 2-way fan-in AND the body of the c->b retry loop. */
function joinLoopSpec() {
  return {
    nodes: [
      { id: "x", data: { duration: "1s" } },
      { id: "y", data: { duration: "2s" } },
      { id: "b" },
      { id: "c" },
      { id: "z" },
    ],
    edges: [
      { id: "x-b", source: "x", target: "b" },
      { id: "y-b", source: "y", target: "b" },
      { id: "b-c", source: "b", target: "c" },
      { id: "loop", source: "c", target: "b", loop: true, maxIterations: 4 },
      { id: "c-z", source: "c", target: "z" },
    ],
  };
}

const chainSpec = () => ({
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
    { id: "cd", source: "c", target: "d" },
  ],
});

// ---- parseDuration -------------------------------------------------------

test("parseDuration: unit table, numbers, and rejects", () => {
  const table = [
    ["2h", 7200], ["45m", 2700], ["8s", 8], ["300ms", 0.3], ["3m", 180],
    ["1.5h", 5400], ["0.5s", 0.5], [".25s", 0.25], ["1d", 86400],
    ["12", 12], [" 40s ", 40], ["8S", 8], ["2H", 7200], ["-5s", -5],
    [12, 12], [0, 0], [0.5, 0.5],
  ];
  for (const [input, expected] of table) near(parseDuration(input), expected);

  for (const bad of [null, undefined, "", "  ", "abc", "8x", "s", "1 2s", {}, [], true, false, NaN, Infinity, "NaN"]) {
    assert.equal(parseDuration(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("parseDuration: drives the default pacing curve (300 + 1200·sec/maxSec, 600 with none)", () => {
  const sim = compileRun({
    nodes: [{ id: "slow", data: { duration: "4s" } }, { id: "fast", data: { duration: "1s" } }, { id: "bare" }],
    edges: [{ id: "s-f", source: "slow", target: "fast" }, { id: "f-b", source: "fast", target: "bare" }],
  });
  near(firstEv(sim, "start", (e) => e.nodeId === "slow").dwellMs, 1500);
  near(firstEv(sim, "start", (e) => e.nodeId === "fast").dwellMs, 600);
  near(firstEv(sim, "start", (e) => e.nodeId === "bare").dwellMs, 600);
});

// ---- fan-out -------------------------------------------------------------

test("fan-out: k out-edges spawn k tokens with distinct branch progress mid-run", () => {
  const sim = compileRun(fanoutSpec());
  // a: dwell 600, hop 300 -> all three branches enter their node at t=900.
  const s = sim.stateAt(1200);
  assert.equal(s.tokens.length, 3);
  const on = (nodeId) => s.tokens.find((tk) => tk.at.kind === "node" && tk.at.id === nodeId);
  assert.ok(on("b") && on("c") && on("d"));
  near(on("b").at.progress, 300 / 600);
  near(on("c").at.progress, 300 / 900);
  near(on("d").at.progress, 300 / 1500);
  const progs = [on("b"), on("c"), on("d")].map((tk) => tk.at.progress);
  assert.equal(new Set(progs).size, 3, "branches must read at visibly different rates");
  assert.equal(s.nodes.a.status, "done");
  assert.equal(s.nodes.a.occupancy, 0);
  for (const id of ["b", "c", "d"]) assert.equal(s.nodes[id].occupancy, 1);

  // Two of the three tokens are freshly spawned; the first continues the parent identity.
  assert.equal(evs(sim, "spawn").length, 2);
  for (const e of evs(sim, "spawn")) assert.equal(e.parentId, "t0");

  // Mid-hop all three sit on their own edge.
  const hop = sim.stateAt(750);
  assert.deepEqual(hop.tokens.map((tk) => tk.at.id).sort(), ["a-b", "a-c", "a-d"]);
  for (const tk of hop.tokens) { assert.equal(tk.at.kind, "edge"); near(tk.at.progress, 0.5); }
});

// ---- joins ---------------------------------------------------------------

test("join 'all': fires only once the slowest branch arrives", () => {
  const sim = compileRun(fanoutSpec("all"));
  const arrivals = evs(sim, "enter").filter((e) => e.nodeId === "j").map((e) => e.t);
  assert.deepEqual(arrivals, [1800, 2100, 2700]);

  const fired = evs(sim, "join");
  assert.equal(fired.length, 1);
  near(fired[0].t, 2700);
  assert.equal(fired[0].nodeId, "j");
  assert.equal(fired[0].arrived, 3);
  assert.equal(fired[0].needed, 3);
  assert.equal(evs(sim, "drop").length, 0, "'all' merges, it never drops");

  // Dwell starts at the fire, not at the first arrival.
  const start = firstEv(sim, "start", (e) => e.nodeId === "j");
  near(start.t, 2700);

  const waiting = sim.stateAt(2200);
  assert.deepEqual(waiting.joins.j, { arrived: 2, needed: 3, fired: false });
  assert.equal(waiting.nodes.j.status, "active");
  assert.equal(waiting.nodes.j.progress, 0, "waiting at a join is not dwell progress");
  assert.equal(waiting.nodes.j.occupancy, 2);
  for (const tk of waiting.tokens.filter((k) => k.at.id === "j")) assert.equal(tk.at.progress, 0);

  const after = sim.stateAt(2700 + 300);
  assert.deepEqual(after.joins.j, { arrived: 3, needed: 3, fired: true });
  assert.equal(after.nodes.j.occupancy, 1, "merged branches collapse into one token");
  near(after.nodes.j.progress, 0.5);
});

test("join {count:2}: fires early and drops the straggler", () => {
  const sim = compileRun(fanoutSpec({ count: 2 }));
  const fired = evs(sim, "join");
  assert.equal(fired.length, 1);
  near(fired[0].t, 2100);
  assert.equal(fired[0].arrived, 2);
  assert.equal(fired[0].needed, 2);

  const dropped = evs(sim, "drop");
  assert.equal(dropped.length, 1);
  near(dropped[0].t, 2700);
  assert.equal(dropped[0].nodeId, "j");
  assert.equal(dropped[0].edgeId, "d-j", "the slow branch is the one made moot");
  assert.equal(dropped[0].tokenId, "t2");

  assert.deepEqual(sim.stateAt(2000).joins.j, { arrived: 1, needed: 2, fired: false });
  assert.deepEqual(sim.stateAt(2150).joins.j, { arrived: 2, needed: 2, fired: true });
  // A drop never inflates `arrived`.
  assert.deepEqual(sim.stateAt(2800).joins.j, { arrived: 2, needed: 2, fired: true });
  assert.equal(sim.stateAt(2800).tokens.length, 0);
  near(sim.duration, 2700);
  assert.equal(sim.stateAt(2700).done, true);
});

test("join 'any': first arrival wins, both later ones drop", () => {
  const sim = compileRun(fanoutSpec("any"));
  const fired = evs(sim, "join");
  assert.equal(fired.length, 1);
  near(fired[0].t, 1800);
  assert.equal(fired[0].needed, 1);
  assert.deepEqual(evs(sim, "drop").map((e) => e.edgeId), ["c-j", "d-j"]);
});

test("join: expected counts non-loop in-edges only", () => {
  // `b` has 2 real in-edges plus a loop-back; the loop must not raise `needed` to 3.
  const sim = compileRun(joinLoopSpec());
  assert.equal(sim.stateAt(0).joins.b.needed, 2);
  assert.equal(evs(sim, "join").length, 1);
});

// ---- loops ---------------------------------------------------------------

test("loop: iteration 1 flies the arc, 2..n tick in place, then the token exits forward", () => {
  const sim = compileRun(pipelineSpec(), { iterations: { retry: 3 } });
  const loops = evs(sim, "loop");
  assert.deepEqual(loops.map((e) => e.iteration), [1, 2, 3]);
  for (const e of loops) { assert.equal(e.edgeId, "retry"); assert.equal(e.max, 5); }

  // Only the first iteration is a real edge traversal (D4 — no re-fly).
  near(loops[0].t, 5100);
  assert.equal(loops[0].nodeId, "deploy.check");
  near(loops[1].t, 5400);
  near(loops[2].t, 5650);
  assert.equal(loops[1].nodeId, "deploy.push", "further iterations tick on the arc's landing node");
  near(loops[2].t - loops[1].t, 250, 1e-9);

  const flying = sim.stateAt(5250);
  assert.equal(flying.tokens[0].at.kind, "edge");
  assert.equal(flying.tokens[0].at.id, "retry");
  near(flying.tokens[0].at.progress, 0.5);

  assert.deepEqual(sim.stateAt(5000).loops.retry, { iteration: 0, max: 5 });
  assert.deepEqual(sim.stateAt(5150).loops.retry, { iteration: 1, max: 5 });
  assert.deepEqual(sim.stateAt(5500).loops.retry, { iteration: 2, max: 5 });
  assert.deepEqual(sim.stateAt(6000).loops.retry, { iteration: 3, max: 5 });
  assert.deepEqual(sim.stateAt(sim.duration).loops.retry, { iteration: 3, max: 5 });

  // ...and then the token proceeds through the loop source's normal out-edges.
  const onward = sim.stateAt(6300);
  assert.equal(onward.tokens.length, 1);
  assert.deepEqual(onward.tokens[0].at, { kind: "node", id: "monitor", progress: (6300 - 6200) / 600 });
  near(sim.duration, 6800);
  assert.equal(sim.stateAt(6800).done, true);
});

test("loop: opts.iterations is capped at maxIterations, and 0 skips the loop entirely", () => {
  const capped = compileRun(pipelineSpec(), { iterations: { retry: 99 } });
  assert.deepEqual(evs(capped, "loop").map((e) => e.iteration), [1, 2, 3, 4, 5]);

  const none = compileRun(pipelineSpec(), { iterations: { retry: 0 } });
  assert.equal(evs(none, "loop").length, 0);
  assert.deepEqual(none.stateAt(none.duration).loops.retry, { iteration: 0, max: 5 });
  // deploy.check finishes at 5100 and goes straight on to monitor.
  near(firstEv(none, "enter", (e) => e.nodeId === "monitor").t, 5400);

  const dflt = compileRun(pipelineSpec());
  assert.deepEqual(evs(dflt, "loop").map((e) => e.iteration), [1, 2, 3, 4, 5]);
});

test("loop: a node that is both fan-in and loop body neither re-joins nor drops", () => {
  const sim = compileRun(joinLoopSpec());
  assert.equal(evs(sim, "drop").length, 0, "the loop-back arrival must bypass the join");
  assert.equal(evs(sim, "join").length, 1, "the join fires exactly once");
  near(firstEv(sim, "join").t, 1800);
  assert.deepEqual(sim.stateAt(1500).joins.b, { arrived: 1, needed: 2, fired: false });
  assert.deepEqual(sim.stateAt(1900).joins.b, { arrived: 2, needed: 2, fired: true });

  assert.deepEqual(evs(sim, "loop").map((e) => e.iteration), [1, 2, 3, 4]);
  // Ticking in place on `b` keeps exactly one token resident there.
  const ticking = sim.stateAt(3700);
  assert.equal(ticking.nodes.b.occupancy, 1);
  assert.equal(ticking.tokens.length, 1);
  assert.equal(ticking.tokens[0].at.id, "b");
  assert.deepEqual(ticking.loops.loop, { iteration: 2, max: 4 });

  // Exit is via the loop SOURCE's forward edge.
  near(firstEv(sim, "enter", (e) => e.nodeId === "z").t, 4650);
  near(sim.duration, 5250);
  assert.equal(sim.stateAt(5250).done, true);
});

// ---- rates ---------------------------------------------------------------

test("rate: factor 2 halves one branch's dwell AND hop, so it arrives early", () => {
  const base = compileRun(fanoutSpec());
  const fast = compileRun(fanoutSpec(), { rates: [{ t: 0, scope: "d", factor: 2 }] });

  const arrival = (sim, edgeId) => firstEv(sim, "enter", (e) => e.edgeId === edgeId).t;
  near(arrival(base, "d-j"), 2700);
  // d: enter 900, dwell 1500/2 = 750, hop 300/2 = 150 -> 1800.
  near(arrival(fast, "d-j"), 1800);
  near(firstEv(fast, "start", (e) => e.nodeId === "d").dwellMs, 750);
  assert.equal(fast.stateAt(1000).tokens.find((tk) => tk.at.id === "d").rate, 2);

  // Untouched branches keep rate 1 and their original timings.
  near(arrival(fast, "b-j"), arrival(base, "b-j"));
  assert.equal(fast.stateAt(1000).tokens.find((tk) => tk.at.id === "b").rate, 1);
});

test("rate: '*' applies once per token lineage (children inherit, no compounding)", () => {
  const sim = compileRun(chainSpec(), { rates: [{ t: 0, scope: "*", factor: 2 }] });
  // Every dwell 600/2 = 300 and every hop 300/2 = 150 — not 1/4, 1/8, ...
  for (const e of evs(sim, "start")) near(e.dwellMs, 300);
  near(sim.duration, 300 + 150 + 300 + 150 + 300 + 150 + 300);
  for (const tk of sim.stateAt(100).tokens) assert.equal(tk.rate, 2);
});

test("rate: an event mid-branch only reshapes the hops after it", () => {
  const sim = compileRun(chainSpec(), { rates: [{ t: 1000, scope: "*", factor: 2 }] });
  const startOf = (id) => firstEv(sim, "start", (e) => e.nodeId === id);
  near(startOf("a").dwellMs, 600);
  near(startOf("b").dwellMs, 600);   // entered at 900, before the rate event
  near(startOf("c").dwellMs, 300);   // entered at 1800, after it
  near(startOf("d").dwellMs, 300);
  near(startOf("c").t, 1800);
  near(startOf("d").t, 2250);        // 2100 + halved hop
  near(sim.duration, 2550);
  assert.equal(sim.stateAt(1200).tokens[0].rate, 1);
  assert.equal(sim.stateAt(1900).tokens[0].rate, 2);
});

test("rate: factor 0 freezes one token in place while the others advance", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [{ id: "a-b", source: "a", target: "b" }, { id: "a-c", source: "a", target: "c" }],
  };
  const sim = compileRun(spec, { rates: [{ t: 0, scope: "c", factor: 0 }] });
  near(sim.duration, 1500); // only branch b can finish

  const held = sim.stateAt(1200);
  const frozen = held.tokens.find((tk) => tk.at.id === "c");
  assert.equal(frozen.rate, 0);
  assert.equal(frozen.at.progress, 0);
  near(held.tokens.find((tk) => tk.at.id === "b").at.progress, 0.5);
  assert.equal(held.nodes.c.progress, 0);
  assert.equal(held.nodes.b.status, "active");

  const later = sim.stateAt(50000);
  assert.equal(later.nodes.b.status, "done");
  assert.equal(later.nodes.c.status, "active", "a frozen node never completes");
  assert.equal(later.nodes.c.occupancy, 1);
  assert.equal(later.tokens.length, 1);
  assert.equal(later.tokens[0].at.progress, 0);
  assert.equal(later.done, false, "a stalled run is never done");
  assert.equal(Number.isFinite(sim.duration), true);
  for (const e of sim.events) assert.ok(Number.isFinite(e.t), "no event may land at t=Infinity");
});

// ---- nextBoundary / step -------------------------------------------------

test("nextBoundary: global stepping walks every event boundary, then returns null", () => {
  const sim = compileRun(pipelineSpec(), { iterations: { retry: 3 } });
  assert.equal(sim.nextBoundary(-100), 0);
  assert.equal(sim.nextBoundary(0), 600);
  assert.equal(sim.nextBoundary(600), 900);
  assert.equal(sim.nextBoundary(899.9), 900);
  assert.equal(sim.nextBoundary(sim.duration), null);
  assert.equal(sim.nextBoundary(sim.duration + 1000), null);

  // Walking from 0 visits exactly the boundary list, in order.
  const walked = [];
  for (let t = sim.nextBoundary(-1); t != null; t = sim.nextBoundary(t)) walked.push(t);
  assert.deepEqual(walked, sim.boundaries);
  assert.ok(sim.boundaries.every((b, i) => i === 0 || b > sim.boundaries[i - 1]), "boundaries are sorted+unique");
  assert.equal(sim.boundaries[sim.boundaries.length - 1], sim.duration);
});

test("nextBoundary(t, tokenId): steps one branch while the others hold", () => {
  const sim = compileRun(fanoutSpec("all"));
  // t2 is the slow `d` branch: spawn 600, enter/start 900, finish 2400, arrive+join 2700.
  assert.equal(sim.nextBoundary(0, "t2"), 600);
  assert.equal(sim.nextBoundary(900, "t2"), 2400);
  assert.equal(sim.nextBoundary(2400, "t2"), 2700);
  // The global clock has boundaries in between that the branch step skips over.
  assert.equal(sim.nextBoundary(900), 1500);

  // A token waiting at the join still steps to the fire that consumes it.
  assert.equal(sim.nextBoundary(1800, "t0"), 2700);
  assert.equal(sim.nextBoundary(2700, "t0"), null, "t0 is merged away at the join");
  assert.equal(sim.nextBoundary(0, "nope"), null);
});

// ---- stateAt shape, seeking, monotonicity --------------------------------

test("stateAt: exact contract shape", () => {
  const sim = compileRun(pipelineSpec(), { iterations: { retry: 3 } });
  const s = sim.stateAt(1000);
  assert.deepEqual(Object.keys(s).sort(), ["done", "edges", "joins", "loops", "nodes", "tokens"]);
  for (const tk of s.tokens) {
    assert.deepEqual(Object.keys(tk).sort(), ["at", "id", "rate"]);
    assert.deepEqual(Object.keys(tk.at).sort(), ["id", "kind", "progress"]);
    assert.ok(tk.at.kind === "node" || tk.at.kind === "edge");
    assert.ok(Number.isFinite(tk.at.progress) && tk.at.progress >= 0 && tk.at.progress <= 1);
  }
  for (const spec of pipelineSpec().nodes) {
    const n = s.nodes[spec.id];
    assert.deepEqual(Object.keys(n).sort(), ["occupancy", "progress", "status"]);
    assert.ok(["pending", "active", "done"].includes(n.status));
  }
  for (const e of pipelineSpec().edges) assert.deepEqual(Object.keys(s.edges[e.id]), ["traversed"]);
  assert.deepEqual(Object.keys(s.joins.report).sort(), ["arrived", "fired", "needed"]);
  assert.deepEqual(Object.keys(s.loops.retry).sort(), ["iteration", "max"]);
  assert.equal(typeof s.done, "boolean");
});

test("stateAt: t=0 puts one token on every source, t>duration is fully done", () => {
  const sim = compileRun(pipelineSpec(), { iterations: { retry: 3 } });
  const zero = sim.stateAt(0);
  assert.equal(zero.tokens.length, 1);
  assert.deepEqual(zero.tokens[0].at, { kind: "node", id: "collect", progress: 0 });
  assert.equal(zero.nodes.collect.status, "active");
  assert.equal(zero.nodes.collect.occupancy, 1);
  assert.equal(zero.nodes.lint.status, "pending");
  assert.equal(zero.done, false);
  for (const e of Object.values(zero.edges)) assert.equal(e.traversed, 0);
  assert.deepEqual(zero.joins.report, { arrived: 0, needed: 3, fired: false });
  assert.deepEqual(zero.loops.retry, { iteration: 0, max: 5 });
  assert.deepEqual(sim.stateAt(-500), zero, "negative seeks clamp to 0");
  assert.deepEqual(sim.stateAt("nope"), zero, "a non-numeric seek clamps to 0");

  const past = sim.stateAt(sim.duration + 10000);
  assert.deepEqual(past.tokens, []);
  assert.equal(past.done, true);
  for (const n of Object.values(past.nodes)) { assert.equal(n.status, "done"); assert.equal(n.progress, 1); assert.equal(n.occupancy, 0); }
  for (const e of Object.values(past.edges)) assert.equal(e.traversed, 1);
  assert.deepEqual(past.joins.report, { arrived: 3, needed: 3, fired: true });
  assert.deepEqual(sim.stateAt(sim.duration + 10000), past, "sampling past the end is stable");
});

test("stateAt: statuses, node progress, edge traversal and joins are monotone in t", () => {
  const RANK = { pending: 0, active: 1, done: 2 };
  for (const [spec, opts] of [
    [pipelineSpec(), { iterations: { retry: 3 } }],
    [joinLoopSpec(), {}],
    [fanoutSpec({ count: 2 }), {}],
    [chainSpec(), { rates: [{ t: 1000, scope: "*", factor: 2 }] }],
  ]) {
    const sim = compileRun(spec, opts);
    let prev = sim.stateAt(0);
    const stepMs = sim.duration / 120;
    for (let i = 1; i <= 150; i++) {
      const t = i * stepMs;
      const now = sim.stateAt(t);
      for (const id of Object.keys(now.nodes)) {
        assert.ok(RANK[now.nodes[id].status] >= RANK[prev.nodes[id].status],
          `${id} went ${prev.nodes[id].status} -> ${now.nodes[id].status} at t=${t}`);
        assert.ok(now.nodes[id].progress >= prev.nodes[id].progress - 1e-9, `${id} progress regressed at t=${t}`);
        assert.ok(Number.isFinite(now.nodes[id].progress));
      }
      for (const id of Object.keys(now.edges)) {
        assert.ok(now.edges[id].traversed >= prev.edges[id].traversed - 1e-9, `${id} un-traversed at t=${t}`);
      }
      for (const id of Object.keys(now.joins)) {
        assert.ok(now.joins[id].arrived >= prev.joins[id].arrived);
        assert.ok(now.joins[id].fired || !prev.joins[id].fired);
      }
      for (const id of Object.keys(now.loops)) {
        assert.ok(now.loops[id].iteration >= prev.loops[id].iteration);
      }
      prev = now;
    }
    assert.equal(prev.done, true);
  }
});

test("stateAt: a node is 'done' exactly when its progress reaches 1", () => {
  const sim = compileRun(chainSpec());
  near(sim.stateAt(600).nodes.a.progress, 1);
  assert.equal(sim.stateAt(600).nodes.a.status, "done");
  assert.equal(sim.stateAt(599).nodes.a.status, "active");
  assert.ok(sim.stateAt(599).nodes.a.progress < 1);
  assert.equal(sim.stateAt(599).nodes.b.status, "pending");
  near(sim.stateAt(750).edges.ab.traversed, 0.5);
  assert.equal(sim.stateAt(900).edges.ab.traversed, 1);
});

// ---- degenerate graphs ---------------------------------------------------

test("no durations anywhere: every node dwells the 600ms default", () => {
  const sim = compileRun(chainSpec());
  for (const e of evs(sim, "start")) near(e.dwellMs, 600);
  near(sim.duration, 3300); // 4 × 600 dwell + 3 × 300 hop
  assert.equal(sim.stateAt(3300).done, true);
  assert.equal(Object.keys(sim.stateAt(0).joins).length, 0, "no fan-in, no join state");
  assert.deepEqual(sim.stateAt(0).loops, {});
});

test("degenerate specs compile to an inert sim rather than throwing", () => {
  const empty = compileRun({});
  assert.equal(empty.duration, 0);
  assert.deepEqual(empty.boundaries, [0]);
  assert.deepEqual(empty.stateAt(0).tokens, []);
  assert.equal(empty.stateAt(0).done, true);

  const lone = compileRun({ nodes: [{ id: "only" }], edges: [] });
  near(lone.duration, 600);
  assert.equal(lone.stateAt(300).nodes.only.status, "active");

  // A pure cycle has no source node: nothing to start, so nothing runs.
  const cyclic = compileRun({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "ab", source: "a", target: "b" }, { id: "ba", source: "b", target: "a" }],
  });
  assert.equal(cyclic.duration, 0);
  assert.deepEqual(cyclic.stateAt(0).tokens, []);
  assert.equal(cyclic.stateAt(0).nodes.a.status, "pending");
});

test("a self-loop is a loop edge, not an in-edge: the node still starts as a source", () => {
  const sim = compileRun({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [
      { id: "self", source: "a", target: "a", loop: true, maxIterations: 2 },
      { id: "ab", source: "a", target: "b" },
    ],
  });
  near(firstEv(sim, "start", (e) => e.nodeId === "a").t, 0);
  assert.deepEqual(evs(sim, "loop").map((e) => e.iteration), [1, 2]);
  assert.equal(sim.stateAt(sim.duration).done, true);
});

// ---- opts ----------------------------------------------------------------

test("opts.hopMs and opts.dwell override the default pacing", () => {
  const sim = compileRun(chainSpec(), { hopMs: 100, dwell: (sec, ctx) => (ctx.id === "b" ? 50 : 200) });
  near(firstEv(sim, "start", (e) => e.nodeId === "a").dwellMs, 200);
  near(firstEv(sim, "start", (e) => e.nodeId === "b").dwellMs, 50);
  near(firstEv(sim, "start", (e) => e.nodeId === "b").t, 300); // 200 dwell + 100 hop
  near(sim.duration, 200 + 100 + 50 + 100 + 200 + 100 + 200);

  const ctxSeen = [];
  compileRun({ nodes: [{ id: "n", data: { duration: "2h" } }], edges: [] }, {
    dwell: (sec, ctx) => { ctxSeen.push([sec, ctx.id, ctx.maxSec, ctx.default]); return null; },
  });
  assert.deepEqual(ctxSeen, [[7200, "n", 7200, 1500]]);
});

// ---- determinism & integration ------------------------------------------

test("compileRun is deterministic given (spec, opts)", () => {
  const opts = { iterations: { retry: 3 }, rates: [{ t: 1200, scope: "*", factor: 1.5 }] };
  const a = compileRun(pipelineSpec(), opts);
  const b = compileRun(pipelineSpec(), opts);
  assert.equal(a.duration, b.duration);
  assert.deepEqual(a.boundaries, b.boundaries);
  assert.deepEqual(JSON.parse(JSON.stringify(a.events)), JSON.parse(JSON.stringify(b.events)));
  for (const t of [0, 137, 900, 2700, 5555, 99999]) assert.deepEqual(a.stateAt(t), b.stateAt(t));
});

test("the §5.1 pipeline runs fan-out -> join:'all' -> retry 3/5 -> exit, off a real Store spec", () => {
  const sim = compileRun(new Store(pipelineSpec()).spec(), { iterations: { retry: 3 } });

  // 3-way fan-out at visibly different rates (8s / 40s / 3m -> 353 / 567 / 1500ms dwells).
  const mid = sim.stateAt(1200);
  assert.equal(mid.tokens.length, 3);
  near(mid.nodes.lint.progress, 300 / (300 + 1200 * (8 / 180)));
  near(mid.nodes.unit.progress, 300 / (300 + 1200 * (40 / 180)));
  near(mid.nodes.e2e.progress, 300 / 1500);
  assert.ok(mid.nodes.lint.progress > mid.nodes.unit.progress);
  assert.ok(mid.nodes.unit.progress > mid.nodes.e2e.progress);
  // lint sprints, e2e crawls: by 1500 the fast branch is already done and waiting.
  const later = sim.stateAt(1500);
  assert.equal(later.nodes.lint.status, "done");
  assert.equal(later.nodes.e2e.status, "active");
  assert.equal(later.joins.report.arrived, 0, "lint is still mid-hop to the join");

  // join:"all" waits for e2e, the slowest.
  near(firstEv(sim, "join", (e) => e.nodeId === "report").t, 2700);
  assert.equal(sim.stateAt(1600).joins.report.arrived, 1);
  assert.equal(sim.stateAt(2000).joins.report.arrived, 2);
  assert.equal(sim.stateAt(2699).joins.report.fired, false);
  assert.equal(sim.stateAt(2701).joins.report.fired, true);

  // retry loop ticks to 3 of 5, then the pipeline finishes at `monitor`.
  assert.deepEqual(sim.stateAt(sim.duration).loops.retry, { iteration: 3, max: 5 });
  assert.equal(sim.stateAt(sim.duration).nodes.monitor.status, "done");
  assert.equal(sim.stateAt(sim.duration).done, true);

  // Nothing anywhere is NaN.
  for (let t = 0; t <= sim.duration + 500; t += 97) {
    const s = sim.stateAt(t);
    for (const tk of s.tokens) assert.ok(Number.isFinite(tk.at.progress) && Number.isFinite(tk.rate));
    for (const n of Object.values(s.nodes)) assert.ok(Number.isFinite(n.progress) && Number.isFinite(n.occupancy));
    for (const e of Object.values(s.edges)) assert.ok(Number.isFinite(e.traversed));
  }
});
