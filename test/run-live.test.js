import { test } from "node:test";
import assert from "node:assert/strict";
import { replayLive, liveBoundaries } from "../src/run-live.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

const chainSpec = () => ({
  nodes: [{ id: "a" }, { id: "b", data: { duration: "2s" } }, { id: "c" }],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
  ],
});

// ---- determinism -----------------------------------------------------------------

test("replayLive: deterministic — same (spec, events, t) gives the same state, order-independent", () => {
  const spec = chainSpec();
  const events = [
    { t: 100, type: "finish", id: "a" },
    { t: 0, type: "start", id: "a" },
  ];
  const shuffled = [...events].reverse();
  const a = replayLive(spec, events, 250);
  const b = replayLive(spec, shuffled, 250);
  assert.deepEqual(a, b);
  // calling again from scratch (no shared mutable state) reproduces exactly
  const c = replayLive(spec, events, 250);
  assert.deepEqual(a, c);
});

test("replayLive: an unrecognized event type or unknown node id is ignored, not thrown", () => {
  const spec = chainSpec();
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 5, type: "bogus", id: "a" },
    { t: 5, type: "start", id: "nope" },
  ];
  const st = replayLive(spec, events, 10);
  assert.equal(st.nodes.a.status, "active");
});

test("replayLive: finish() before any start() is a no-op — no phantom 'done' with zero tokens ever created", () => {
  const spec = chainSpec();
  const events = [{ t: 5, type: "finish", id: "a" }];
  const st = replayLive(spec, events, 10);
  assert.equal(st.nodes.a.status, "pending"); // NOT "done" — nothing ever occupied it
  assert.equal(st.nodes.a.occupancy, 0);
  assert.equal(st.tokens.length, 0); // no phantom token, no fan-out onto "ab"
  assert.equal(st.edges.ab.traversed, 0);
});

test("replayLive: a second finish() past a node's occupancy is a no-op, not a second 'done'", () => {
  const spec = chainSpec();
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 5, type: "finish", id: "a" },   // legitimately drains a's one occupant -> done
    { t: 8, type: "finish", id: "a" },   // a already has zero occupants now
  ];
  const st = replayLive(spec, events, 1000);
  assert.equal(st.nodes.a.status, "done"); // still done from the real finish, not re-derived
  assert.equal(st.tokens.length, 1); // exactly the one real fan-out, not a second phantom
  near(st.edges.ab.traversed, 1);
});

// ---- start/finish/hop travel -------------------------------------------------------

test("replayLive: start activates, finish travels the hop, then waits at the target", () => {
  const spec = chainSpec();
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 100, type: "finish", id: "a" },
  ];
  // mid-dwell on a
  let st = replayLive(spec, events, 50);
  assert.equal(st.nodes.a.status, "active");
  assert.equal(st.tokens[0].at.kind, "node");
  assert.equal(st.tokens[0].at.id, "a");

  // right after finish: a is done, one token is mid-hop on "ab"
  st = replayLive(spec, events, 100);
  assert.equal(st.nodes.a.status, "done");
  near(st.nodes.a.progress, 1);
  assert.equal(st.tokens.length, 1);
  assert.equal(st.tokens[0].at.kind, "edge");
  assert.equal(st.tokens[0].at.id, "ab");
  near(st.tokens[0].at.progress, 0);

  // mid-hop (default hopMs = 300)
  st = replayLive(spec, events, 250);
  near(st.tokens[0].at.progress, 150 / 300);
  near(st.edges.ab.traversed, 150 / 300);

  // landed: b is pending (not yet started) but occupied
  st = replayLive(spec, events, 400);
  assert.equal(st.nodes.b.status, "pending");
  assert.equal(st.nodes.b.occupancy, 1);
  assert.equal(st.tokens[0].at.kind, "node");
  assert.equal(st.tokens[0].at.id, "b");
  near(st.tokens[0].at.progress, 0); // waiting: no dwell progress
  near(st.edges.ab.traversed, 1); // persists once fully crossed

  // b never got its own start() -> stays pending forever, done stays false (occupied)
  st = replayLive(spec, events, 100000);
  assert.equal(st.nodes.b.status, "pending");
  assert.equal(st.done, false);
});

test("replayLive: a custom hopMs changes travel time", () => {
  const spec = chainSpec();
  const events = [{ t: 0, type: "start", id: "a" }, { t: 0, type: "finish", id: "a" }];
  const st = replayLive(spec, events, 50, { hopMs: 100 });
  near(st.tokens[0].at.progress, 0.5);
  const landed = replayLive(spec, events, 100, { hopMs: 100 });
  assert.equal(landed.nodes.b.occupancy, 1);
});

test("replayLive: an explicit start on the target picks up the waiting token and dwells", () => {
  const spec = chainSpec();
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 0, type: "finish", id: "a" },     // lands on b at hopMs (300)
    { t: 400, type: "start", id: "b" },    // b's own duration is 2s
    { t: 900, type: "finish", id: "b" },
  ];
  let st = replayLive(spec, events, 700);
  assert.equal(st.nodes.b.status, "active");
  near(st.nodes.b.progress, 300 / 2000); // 300ms elapsed of a 2s estimate

  st = replayLive(spec, events, 900);
  assert.equal(st.nodes.b.status, "done");
  near(st.nodes.b.progress, 1);
  // b has one non-loop out-edge (bc) -> exactly one child token traveling
  assert.equal(st.tokens.length, 1);
  assert.equal(st.tokens[0].at.id, "bc");
});

// ---- fan-out on finish -------------------------------------------------------------

test("replayLive: finish fans out one traveling token per non-loop out-edge", () => {
  const spec = {
    nodes: [{ id: "collect" }, { id: "x" }, { id: "y" }, { id: "z" }],
    edges: [
      { id: "cx", source: "collect", target: "x" },
      { id: "cy", source: "collect", target: "y" },
      { id: "cz", source: "collect", target: "z" },
    ],
  };
  const events = [{ t: 0, type: "start", id: "collect" }, { t: 0, type: "finish", id: "collect" }];
  const st = replayLive(spec, events, 150);
  assert.equal(st.tokens.length, 3);
  const edgeIds = st.tokens.map((tk) => tk.at.id).sort();
  assert.deepEqual(edgeIds, ["cx", "cy", "cz"]);
  for (const tk of st.tokens) near(tk.at.progress, 0.5);
});

test("replayLive: finish({n}) finishes only k occupants — node stays active with the rest", () => {
  const spec = { nodes: [{ id: "w" }], edges: [] };
  const events = [
    { t: 0, type: "spawn", id: "w", n: 3 },
    { t: 0, type: "start", id: "w" },
    { t: 0, type: "start", id: "w" },
    { t: 10, type: "finish", id: "w", n: 2 },
  ];
  const st = replayLive(spec, events, 10);
  assert.equal(st.nodes.w.status, "active"); // 1 of 3 remains
  assert.equal(st.nodes.w.occupancy, 1);
});

// ---- spawn occupancy ----------------------------------------------------------------

test("replayLive: spawn(id, n) places n waiting tokens — occupancy badge, still pending", () => {
  const spec = { nodes: [{ id: "process_files" }], edges: [] };
  const events = [{ t: 0, type: "spawn", id: "process_files", n: 12 }];
  const st = replayLive(spec, events, 0);
  assert.equal(st.nodes.process_files.status, "pending");
  assert.equal(st.nodes.process_files.occupancy, 12);
  assert.equal(st.tokens.length, 12);
  for (const tk of st.tokens) near(tk.at.progress, 0);
});

// ---- joins: arrival counting vs explicit start override -----------------------------

function joinSpec(join = "all") {
  return {
    nodes: [{ id: "x" }, { id: "y" }, { id: "j", join }],
    edges: [
      { id: "xj", source: "x", target: "j" },
      { id: "yj", source: "y", target: "j" },
    ],
  };
}

test("replayLive: join arrivals counted like Mode A; fires once `needed` have landed", () => {
  const spec = joinSpec("all");
  const events = [
    { t: 0, type: "start", id: "x" }, { t: 0, type: "finish", id: "x" },  // lands on j at 300
    { t: 0, type: "start", id: "y" }, { t: 50, type: "finish", id: "y" }, // lands on j at 350
  ];
  let st = replayLive(spec, events, 320);
  assert.deepEqual(st.joins.j, { arrived: 1, needed: 2, fired: false });
  st = replayLive(spec, events, 350);
  assert.deepEqual(st.joins.j, { arrived: 2, needed: 2, fired: true });
});

test("replayLive: an explicit start() ALWAYS activates the node, even if the join hasn't fired", () => {
  const spec = joinSpec("all");
  const events = [
    { t: 0, type: "start", id: "x" }, { t: 0, type: "finish", id: "x" }, // lands on j at 300
    // y never arrives — the join's "needed: 2" would never fire on its own
    { t: 310, type: "start", id: "j" },
  ];
  const st = replayLive(spec, events, 310);
  assert.equal(st.nodes.j.status, "active"); // the log outranks the declared policy
  assert.equal(st.joins.j.fired, false);     // the join map still reports the truth
  assert.equal(st.joins.j.arrived, 1);
});

test("replayLive: join policy 'any' needs 1; {count:k} needs k", () => {
  const any = replayLive(joinSpec("any"),
    [{ t: 0, type: "start", id: "x" }, { t: 0, type: "finish", id: "x" }], 310);
  assert.deepEqual(any.joins.j, { arrived: 1, needed: 1, fired: true });

  const counted = replayLive(joinSpec({ count: 2 }),
    [{ t: 0, type: "start", id: "x" }, { t: 0, type: "finish", id: "x" }], 310);
  assert.deepEqual(counted.joins.j, { arrived: 1, needed: 2, fired: false });
});

// ---- loop re-activation --------------------------------------------------------------

function loopSpec() {
  return {
    nodes: [{ id: "push" }, { id: "check" }],
    edges: [
      { id: "pc", source: "push", target: "check" },
      { id: "retry", source: "check", target: "push", loop: true, maxIterations: 5 },
    ],
  };
}

test("replayLive: repeated start of an already-done node is the live loop iteration", () => {
  const spec = loopSpec();
  const events = [
    { t: 0, type: "start", id: "push" }, { t: 10, type: "finish", id: "push" },   // -> check at 310
    { t: 310, type: "start", id: "check" }, { t: 320, type: "finish", id: "check" },
    // "check" has no non-loop out-edges here, so it just ends; a real retry loop is driven
    // by the operator re-starting "push" directly (loop edges never auto-fan-out, D4/M2).
    { t: 330, type: "start", id: "push" },  // push was done -> this IS iteration 1
    { t: 340, type: "finish", id: "push" },
    { t: 640, type: "start", id: "check" },
    { t: 650, type: "finish", id: "check" },
    { t: 660, type: "start", id: "push" },  // iteration 2
  ];
  let st = replayLive(spec, events, 340);
  assert.equal(st.loops.retry.iteration, 1);
  assert.equal(st.loops.retry.max, 5);
  st = replayLive(spec, events, 660);
  assert.equal(st.loops.retry.iteration, 2);
  assert.equal(st.nodes.push.status, "active");
});

test("replayLive: the FIRST start of a node is never counted as a loop iteration", () => {
  const spec = loopSpec();
  const st = replayLive(spec, [{ t: 0, type: "start", id: "push" }], 0);
  assert.equal(st.loops.retry.iteration, 0);
});

test("replayLive: loop out-edges never auto-fan-out on finish", () => {
  const spec = loopSpec();
  const events = [{ t: 0, type: "start", id: "check" }, { t: 10, type: "finish", id: "check" }];
  const st = replayLive(spec, events, 10);
  // "check"'s only out-edge is the loop edge "retry" — finishing it must NOT spawn a
  // traveling token onto it (that would be Mode A's implicit fan-out, not live mode's rule).
  assert.equal(st.tokens.length, 0);
  assert.equal(st.done, true);
});

// ---- liveBoundaries -------------------------------------------------------------------

test("liveBoundaries: sorted, distinct event times", () => {
  const events = [{ t: 30, type: "start", id: "a" }, { t: 10, type: "finish", id: "a" }, { t: 10, type: "spawn", id: "a", n: 1 }];
  assert.deepEqual(liveBoundaries(events), [10, 30]);
  assert.deepEqual(liveBoundaries([]), []);
  assert.deepEqual(liveBoundaries(undefined), []);
});

// ---- misc guards ------------------------------------------------------------------------

test("replayLive: negative/garbage t clamps to 0; missing spec/events default cleanly", () => {
  assert.doesNotThrow(() => replayLive());
  const spec = chainSpec();
  // t clamps to 0, so an event stamped after that (t=10) is not yet visible.
  const st = replayLive(spec, [{ t: 10, type: "start", id: "a" }], -50);
  assert.equal(st.nodes.a.status, "pending");
  // an event AT t=0 is visible once t clamps to 0.
  const st0 = replayLive(spec, [{ t: 0, type: "start", id: "a" }], -50);
  assert.equal(st0.nodes.a.status, "active");
});

test("replayLive: an untagged cycle is excluded from join arity (mirrors compileRun)", () => {
  const spec = {
    nodes: [{ id: "b" }, { id: "c" }],
    edges: [
      { id: "bc", source: "b", target: "c" },
      { id: "cb", source: "c", target: "b" }, // cycle, no loop:true — breakCycles tags it back
    ],
  };
  // b has one non-loop in-edge once the cycle is broken (not two) -> no implicit join
  const st = replayLive(spec, [{ t: 0, type: "start", id: "b" }], 0);
  assert.deepEqual(st.joins, {});
});
