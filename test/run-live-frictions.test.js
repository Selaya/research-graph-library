// docs/API-FRICTIONS.md F10–F14 — Mode B (live) engine + transport.
//
//   F10  joins are honoured in live mode: N arrivals release ONE token, not N.
//   F11  start() on a non-root with nothing waiting warns ([smv:live]); waiting/active counts.
//   F12  reset({ log, now, replay }) — explicit epoch, and the seeded log re-emitted.
//   F13  data.duration is an expectation in live mode: a dwell past it reads over-budget.
//   F14  minHopMs — a start() stamped at the upstream finish still shows the crossing.
//
// Same fake-host technique as test/run-live-transport.test.js (real ticker in manual mode,
// real Store, real emitter).

import { test } from "node:test";
import assert from "node:assert/strict";
import { replayLive } from "../src/run-live.js";
import { createRunTransport } from "../src/run-transport.js";
import { createTicker } from "../src/anim.js";
import { Store } from "../src/store.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

/** Captures console.warn calls made inside `fn`, restoring the real console.warn after. */
function captureWarnings(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return calls;
}

function liveHost(spec, opts = {}) {
  const ticker = createTicker({ manual: true });
  const store = new Store(spec);
  const run = createRunTransport({ ticker, store }, { mode: "live", ...opts });
  return { ticker, store, run };
}

/** A -> J <- B, J also feeding Z: the smallest implicit AND-join. */
const joinSpec = (join) => ({
  nodes: [{ id: "A" }, { id: "B" }, join ? { id: "J", join } : { id: "J" }, { id: "Z" }],
  edges: [
    { id: "aj", source: "A", target: "J" },
    { id: "bj", source: "B", target: "J" },
    { id: "jz", source: "J", target: "Z" },
  ],
});

// ===========================================================================
// F10 — joins in live mode
// ===========================================================================

test("F10: two arrivals at an implicit AND-join merge into ONE occupant", () => {
  const events = [
    { t: 0, type: "start", id: "A" }, { t: 0, type: "finish", id: "A" },   // lands on J at 300
    { t: 0, type: "start", id: "B" }, { t: 100, type: "finish", id: "B" }, // lands on J at 400
  ];
  // first arrival only: held at the join, occupying it but not released
  let st = replayLive(joinSpec(), events, 350);
  assert.equal(st.nodes.J.occupancy, 1);
  assert.equal(st.nodes.J.waiting, 1);
  assert.equal(st.nodes.J.active, 0);
  assert.deepEqual(st.joins.J, { arrived: 1, needed: 2, fired: false });

  // both arrived: the policy fires and exactly one token is left standing on J
  st = replayLive(joinSpec(), events, 400);
  assert.equal(st.nodes.J.occupancy, 1, "N arrivals do not stay N occupants (F10)");
  assert.equal(st.nodes.J.waiting, 1);
  assert.deepEqual(st.joins.J, { arrived: 2, needed: 2, fired: true });
  assert.equal(st.tokens.filter((tk) => tk.at.kind === "node" && tk.at.id === "J").length, 1);
});

test("F10: a bare finish() on a join node mints ONE downstream token, not one per arrival", () => {
  const events = [
    { t: 0, type: "start", id: "A" }, { t: 0, type: "finish", id: "A" },
    { t: 0, type: "start", id: "B" }, { t: 0, type: "finish", id: "B" },
    { t: 310, type: "start", id: "J" },
    { t: 320, type: "finish", id: "J" },                                   // no { n } at all
  ];
  const st = replayLive(joinSpec(), events, 400);
  assert.equal(st.nodes.J.status, "done");
  assert.equal(st.nodes.J.occupancy, 0);
  const onJz = st.tokens.filter((tk) => tk.at.kind === "edge" && tk.at.id === "jz");
  assert.equal(onJz.length, 1, "one release, one token — no ×N badge propagating downstream");
});

test("F10: the join re-arms — a second batch of arrivals releases a second token", () => {
  const events = [
    { t: 0, type: "start", id: "A" }, { t: 0, type: "finish", id: "A" },
    { t: 0, type: "start", id: "B" }, { t: 0, type: "finish", id: "B" },   // both land at 300
    { t: 310, type: "start", id: "J" }, { t: 320, type: "finish", id: "J" },
    { t: 400, type: "start", id: "A" }, { t: 400, type: "finish", id: "A" },
    { t: 400, type: "start", id: "B" }, { t: 400, type: "finish", id: "B" }, // both land at 700
  ];
  const st = replayLive(joinSpec(), events, 750);
  assert.equal(st.nodes.J.occupancy, 1, "the second batch released exactly one token again");
  assert.equal(st.nodes.J.waiting, 1);
  assert.equal(st.nodes.J.status, "pending", "a fresh arrival un-does 'done' but does not start it");
});

test("F10: join {count:k} releases one token per k arrivals; the surplus is held for the next", () => {
  const spec = {
    nodes: [{ id: "x" }, { id: "y" }, { id: "z" }, { id: "j", join: { count: 2 } }],
    edges: [
      { id: "xj", source: "x", target: "j" },
      { id: "yj", source: "y", target: "j" },
      { id: "zj", source: "z", target: "j" },
    ],
  };
  const events = [];
  for (const id of ["x", "y", "z"]) events.push({ t: 0, type: "start", id }, { t: 0, type: "finish", id });
  const st = replayLive(spec, events, 400);
  assert.equal(st.nodes.j.occupancy, 2, "one released token + one arrival still held");
  assert.equal(st.nodes.j.waiting, 2);
  assert.equal(st.nodes.j.active, 0);
  assert.deepEqual(st.joins.j, { arrived: 2, needed: 2, fired: true });
});

test("F10: an explicit start() still activates a join that has not fired (the log outranks the policy)", () => {
  const events = [
    { t: 0, type: "start", id: "A" }, { t: 0, type: "finish", id: "A" },   // one arrival only
    { t: 320, type: "start", id: "J" },
  ];
  const st = replayLive(joinSpec("all"), events, 330);
  assert.equal(st.nodes.J.status, "active");
  assert.equal(st.nodes.J.active, 1);
  assert.equal(st.nodes.J.waiting, 0);
  assert.equal(st.joins.J.fired, false, "…and the join map still reports the truth");
});

test("F10: spawn() is an explicit injection — never held by, never counted into, a join", () => {
  const st = replayLive(joinSpec("all"), [{ t: 0, type: "spawn", id: "J", n: 3 }], 0);
  assert.equal(st.nodes.J.occupancy, 3, "three spawned tokens, not one merged one");
  assert.equal(st.nodes.J.waiting, 3);
  assert.deepEqual(st.joins.J, { arrived: 0, needed: 2, fired: false });
});

test("F10: join:'any' is unchanged — every arrival is released on the spot", () => {
  const events = [
    { t: 0, type: "start", id: "A" }, { t: 0, type: "finish", id: "A" },
    { t: 0, type: "start", id: "B" }, { t: 0, type: "finish", id: "B" },
  ];
  const st = replayLive(joinSpec("any"), events, 400);
  assert.equal(st.nodes.J.occupancy, 2, "an OR-join queues its arrivals, it does not merge them");
  assert.deepEqual(st.joins.J, { arrived: 1, needed: 1, fired: true });
});

test("F10: through the transport — fan-in, then one finish, then one token downstream", () => {
  const { ticker, run } = liveHost(joinSpec(), { hopMs: 100 });
  ticker.tick(10);
  run.start("A", { at: 0 }); run.finish("A", { at: 0 });
  run.start("B", { at: 0 }); run.finish("B", { at: 0 });
  ticker.tick(200);                      // both hops have landed on J
  assert.equal(run.state().nodes.J.occupancy, 1);
  run.start("J");
  run.finish("J");
  ticker.tick(50);
  const st = run.state();
  assert.equal(st.tokens.length, 1, "exactly one token left J");
  assert.equal(st.tokens[0].at.id, "jz");
  run.destroy();
});

// ===========================================================================
// F11 — phantom start()s and the waiting/active split
// ===========================================================================

const chain = () => ({
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }],
});

test("F11: start() on a non-root with nothing waiting warns [smv:live] (and still mints, by default)", () => {
  const { ticker, run } = liveHost(chain());
  ticker.tick(10);
  const warns = captureWarnings(() => run.start("b"));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /^\[smv:live\] start\("b"\)/);
  assert.match(warns[0], /\{ spawn: true \}/);
  assert.equal(run.state().nodes.b.status, "active", "default stays backward compatible");
  run.destroy();
});

test("F11: { spawn: true } says it was deliberate — no warning, token minted", () => {
  const { ticker, run } = liveHost(chain());
  ticker.tick(10);
  const warns = captureWarnings(() => run.start("b", { spawn: true }));
  assert.deepEqual(warns, []);
  assert.equal(run.state().nodes.b.status, "active");
  run.destroy();
});

test("F11: spawnOnStart:false makes the phantom start a no-op — nothing is even logged", () => {
  const { ticker, run } = liveHost(chain(), { spawnOnStart: false });
  ticker.tick(10);
  const warns = captureWarnings(() => run.start("b"));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /ignored/);
  assert.equal(run.log().length, 0, "no phantom entry in the log");
  assert.equal(run.state().nodes.b.status, "pending");
  // …and { spawn: true } still gets through
  run.start("b", { spawn: true });
  assert.equal(run.state().nodes.b.status, "active");
  run.destroy();
});

test("F11: the legitimate starts never warn — root, queued arrival, hop in flight, retry", () => {
  const { ticker, run } = liveHost(chain(), { hopMs: 100 });
  ticker.tick(10);
  const warns = captureWarnings(() => {
    run.start("a", { at: 0 });          // a root seeds itself
    run.finish("a", { at: 0 });
    run.start("b", { at: 5 });          // the hop toward b is still crossing: start claims it
    run.finish("b", { at: 6 });
    run.start("b", { at: 7 });          // b is 'done': a restart IS the live loop iteration
    run.fail("b", { at: 8 });
    run.start("b", { at: 9 });          // …and the retry of a 'failed' node is the same thing
  });
  assert.deepEqual(warns, []);
  ticker.tick(400);
  const queued = captureWarnings(() => {
    run.finish("b");                    // hands a token on to c, which then has one waiting
    ticker.tick(400);
    run.start("c");
  });
  assert.deepEqual(queued, []);
  run.destroy();
});

test("F11: state().nodes carries waiting/active alongside occupancy", () => {
  const { ticker, run } = liveHost({ nodes: [{ id: "w" }], edges: [] });
  ticker.tick(10);
  run.spawn("w", 3);
  run.start("w");
  const n = run.state().nodes.w;
  assert.equal(n.occupancy, 3);
  assert.equal(n.active, 1);
  assert.equal(n.waiting, 2);
  assert.equal(n.waiting + n.active, n.occupancy);
  run.destroy();
});

// ===========================================================================
// F12 — reset({ log, now, replay })
// ===========================================================================

test("F12: reset({ log, now }) sets the frontier from the epoch, so later { at } stamps are not clamped", () => {
  const { ticker, run } = liveHost(chain());
  ticker.tick(10);
  run.reset({ log: [{ t: 0, type: "start", id: "a" }], now: 60000 });
  assert.equal(run.now(), 60000, "the frontier is the declared epoch, not the seeded log's span");
  const at = run.finish("a", { at: 45000 });
  assert.equal(at, 45000, "a server stamp inside the epoch lands where it says");
  assert.equal(run.log()[1].t, 45000);
  run.destroy();
});

test("F12: without `now` the frontier still floors on the seeded log (unchanged default)", () => {
  const { ticker, run } = liveHost(chain());
  ticker.tick(10);
  run.reset({ log: [{ t: 800, type: "start", id: "a" }] });
  assert.equal(run.now(), 800);
  run.destroy();
});

test("F12: replay:true re-emits the seeded entries through the handle's own emitter", () => {
  const { ticker, run } = liveHost(chain());
  ticker.tick(10);
  const seen = [];
  for (const type of ["start", "finish", "fail", "spawn"]) run.on(type, (e) => seen.push({ type, ...e }));

  run.reset({
    log: [
      { t: 0, type: "start", id: "a" },
      { t: 10, type: "finish", id: "a", n: 1 },
      { t: 20, type: "spawn", id: "b", n: 2 },
      { t: 30, type: "fail", id: "b", reason: "boom" },
    ],
    now: 500,
    replay: true,
  });

  assert.deepEqual(seen.map((e) => e.type), ["start", "finish", "spawn", "fail"],
    "re-emitted in log order");
  assert.deepEqual(seen[1], { type: "finish", id: "a", t: 10, replay: true, n: 1 });
  assert.deepEqual(seen[3], { type: "fail", id: "b", t: 30, replay: true, reason: "boom" });
  assert.ok(seen.every((e) => e.replay === true), "every re-emitted beat is marked as history");
  run.destroy();
});

test("F12: reset() without replay stays silent (the old behaviour)", () => {
  const { ticker, run } = liveHost(chain());
  ticker.tick(10);
  const seen = [];
  run.on("start", () => seen.push("start"));
  run.reset({ log: [{ t: 0, type: "start", id: "a" }] });
  assert.deepEqual(seen, []);
  run.destroy();
});

test("F12: options() carries the epoch, so a snapshot/restore keeps the frontier", () => {
  const { ticker, run } = liveHost(chain());
  run.start("a", { at: 0 });
  ticker.tick(4000);
  const snap = run.options();
  assert.equal(snap.now, 4000);
  run.reset(snap, run.time());
  assert.equal(run.now(), 4000, "the restored run did not rewind its frontier to the log's span");
  run.destroy();
});

// ===========================================================================
// F13 — data.duration as an expectation
// ===========================================================================

const budgetSpec = () => ({
  nodes: [{ id: "step", data: { duration: "1s" } }, { id: "next" }],
  edges: [{ id: "sn", source: "step", target: "next" }],
});

test("F13: a live dwell past the declared duration reads over-budget; inside it does not", () => {
  const events = [{ t: 0, type: "start", id: "step" }];
  assert.equal(replayLive(budgetSpec(), events, 500).nodes.step.overBudget, false);
  near(replayLive(budgetSpec(), events, 500).nodes.step.progress, 0.5);
  assert.equal(replayLive(budgetSpec(), events, 1500).nodes.step.overBudget, true);
  // the fill itself still caps short of 1 — the flag is the only new signal
  assert.ok(replayLive(budgetSpec(), events, 1500).nodes.step.progress < 1);
});

test("F13: the flag survives the finish that closed the over-long dwell, and a retry clears it", () => {
  const events = [
    { t: 0, type: "start", id: "step" },
    { t: 4000, type: "finish", id: "step" },
    { t: 5000, type: "start", id: "step" },
  ];
  assert.equal(replayLive(budgetSpec(), events, 4500).nodes.step.overBudget, true);
  assert.equal(replayLive(budgetSpec(), events, 5100).nodes.step.overBudget, false,
    "a fresh activation is judged against its own dwell");
});

test("F13: a node with no declared duration is never over budget", () => {
  const st = replayLive(budgetSpec(), [{ t: 0, type: "start", id: "next" }], 1e6);
  assert.equal(st.nodes.next.overBudget, false);
});

// ===========================================================================
// F14 — minHopMs
// ===========================================================================

test("F14: a start() stamped at the upstream finish still shows the crossing", () => {
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 100, type: "finish", id: "a" },
    { t: 100, type: "start", id: "b" },   // a real trace: dispatch instant IS the start instant
  ];
  const opts = { hopMs: 300, minHopMs: 120 };

  // mid-crossing: the token is on the wire, b has not taken it yet
  let st = replayLive(chain(), events, 160, opts);
  assert.equal(st.tokens.length, 1);
  assert.equal(st.tokens[0].at.kind, "edge");
  assert.equal(st.tokens[0].at.id, "ab");
  near(st.tokens[0].at.progress, 0.5);
  assert.equal(st.nodes.b.status, "pending");
  assert.equal(st.nodes.b.occupancy, 0);

  // the minimum crossing done, b is working
  st = replayLive(chain(), events, 220, opts);
  assert.equal(st.nodes.b.status, "active");
  assert.equal(st.nodes.b.active, 1);
  near(st.edges.ab.traversed, 1);

  // and with the default (no minHopMs) the same log teleports, exactly as before
  const bare = replayLive(chain(), events, 101, { hopMs: 300 });
  assert.equal(bare.nodes.b.status, "active");
  assert.equal(bare.tokens[0].at.kind, "node");
});

test("F14: minHopMs can never outlast the hop it shortens (clamped to hopMs)", () => {
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 100, type: "finish", id: "a" },
    { t: 100, type: "start", id: "b" },
  ];
  const st = replayLive(chain(), events, 400, { hopMs: 300, minHopMs: 5000 });
  assert.equal(st.nodes.b.status, "active", "b starts when the full hop lands, never later");
  near(st.edges.ab.traversed, 1);
});

test("F14: a start() after the hop has already landed is not delayed", () => {
  const events = [
    { t: 0, type: "start", id: "a" },
    { t: 0, type: "finish", id: "a" },   // lands on b at 300
    { t: 500, type: "start", id: "b" },
  ];
  const st = replayLive(chain(), events, 500, { hopMs: 300, minHopMs: 200 });
  assert.equal(st.nodes.b.status, "active");
  assert.equal(st.nodes.b.active, 1);
});

test("F14: the transport passes minHopMs through and keeps it in options()", () => {
  const { ticker, run } = liveHost(chain(), { hopMs: 300, minHopMs: 150 });
  ticker.tick(10);
  run.start("a", { at: 0 });
  run.finish("a", { at: 0 });
  run.start("b", { at: 0 });
  ticker.tick(60);                       // frontier 70, inside the 150ms minimum crossing
  const st = run.state();
  assert.equal(st.tokens[0].at.kind, "edge");
  assert.equal(st.nodes.b.status, "pending");
  assert.equal(run.options().minHopMs, 150);
  ticker.tick(200);
  assert.equal(run.state().nodes.b.status, "active");
  run.destroy();
});
