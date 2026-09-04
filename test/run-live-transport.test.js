import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunTransport } from "../src/run-transport.js";
import { createTicker } from "../src/anim.js";
import { Store } from "../src/store.js";
import { emitter } from "../src/events.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

/** Captures console.warn calls made inside `fn`, restoring the real console.warn after. */
function captureWarnings(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return calls;
}

function makeInternals() {
  const ticker = createTicker({ manual: true });
  const store = new Store({
    nodes: [{ id: "a" }, { id: "b", data: { duration: "2s" } }, { id: "c" }],
    edges: [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }],
  });
  const bus = emitter();
  return { ticker, store, bus };
}

// ---- frontier advances unconditionally ---------------------------------------------

test("live transport: the frontier advances on every tick, even before any events land", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  assert.equal(run.duration, 0);
  ticker.tick(40);
  assert.equal(run.duration, 40);
  ticker.tick(60);
  assert.equal(run.duration, 100);
  // following by default: view time tracks the frontier with no play() call at all
  assert.equal(run.time(), 100);
  assert.equal(run.following, true);
  run.destroy();
});

test("live transport: frontier keeps advancing while paused/detached", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(50);
  run.pause();
  assert.equal(run.following, false);
  const tBefore = run.time();
  ticker.tick(200);
  assert.equal(run.duration, 250); // frontier grew regardless
  assert.equal(run.time(), tBefore); // view time held where pause() left it
  run.destroy();
});

// ---- start/finish/spawn stamping -----------------------------------------------------

test("live transport: start/finish/spawn append to the log stamped at min(at, frontier)", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(100); // frontier=100
  const at1 = run.start("a"); // defaults to frontier
  assert.equal(at1, 100);
  const at2 = run.finish("a", { at: 1e9 }); // clamped to frontier
  assert.equal(at2, 100);
  const log = run.log();
  assert.equal(log.length, 2);
  assert.equal(log[0].type, "start");
  assert.equal(log[1].type, "finish");
  run.spawn("b", 3, { at: 50 }); // an explicit earlier timestamp is honored (still <= frontier)
  assert.equal(run.log()[2].t, 50);
  run.destroy();
});

test("live transport: state() reflects the log immediately (no recompile step)", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  run.start("a");
  assert.equal(run.state().nodes.a.status, "active");
  run.finish("a");
  assert.equal(run.state().nodes.a.status, "done");
  run.destroy();
});

// ---- seek clamp at frontier ------------------------------------------------------------

test("live transport: seek clamps to the frontier — you can never scrub past now", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(150);
  run.seek(1e9);
  assert.equal(run.time(), 150); // clamped, not 1e9
  assert.equal(run.following, false); // seek() always detaches, even landing exactly on "now"
  run.seek(-100);
  assert.equal(run.time(), 0);
  run.destroy();
});

test("live transport: seek into the past shows earlier state (fewer done nodes) than now", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  run.start("a", { at: 0 });
  ticker.tick(10);
  run.finish("a", { at: 10 });
  ticker.tick(90); // frontier=100
  assert.equal(run.state().nodes.a.status, "done");
  run.seek(5);
  assert.equal(run.state().nodes.a.status, "active"); // before the finish landed
  run.destroy();
});

// ---- follow/detach ------------------------------------------------------------------

test("live transport: seek detaches; follow() re-attaches immediately", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(200);
  run.seek(0);
  assert.equal(run.following, false);
  assert.equal(run.time(), 0);
  run.follow();
  assert.equal(run.following, true);
  assert.equal(run.time(), 200);
  // once re-attached, further ticks keep tracking the frontier with no extra call
  ticker.tick(30);
  assert.equal(run.time(), 230);
  run.destroy();
});

// ---- play catches up and re-attaches ------------------------------------------------

test("live transport: play() catches the view clock up to the frontier and re-attaches", async () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(150);
  run.seek(0);
  run.speed(4); // catch up faster than the frontier's own 1x growth, or the gap never closes
  const p = run.play();
  assert.equal(run.playing, true);
  for (let i = 0; i < 10; i++) ticker.tick(20);
  const res = await p;
  assert.equal(res.canceled, false);
  assert.equal(run.following, true);
  assert.equal(run.playing, false);
  near(run.time(), run.duration);
  run.destroy();
});

test("live transport: play({until}) stops once that node reaches done, even before the frontier", async () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(50);
  run.start("a", { at: 0 });
  run.finish("a", { at: 10 });
  run.seek(0);
  run.speed(1);
  const p = run.play({ until: "a" });
  for (let i = 0; i < 5; i++) ticker.tick(5); // t sweeps past the finish at t=10
  await p;
  assert.ok(run.time() >= 10);
  run.destroy();
});

// ---- log()/reset() round-trip --------------------------------------------------------

test("live transport: log() returns a copy; reset(opts,time) re-seeds it and restarts the frontier", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  run.start("a");
  const snap = run.log();
  snap.push({ t: 999, type: "start", id: "b" }); // mutating the copy must not affect the run
  assert.equal(run.log().length, 1);

  run.reset({ log: [{ t: 0, type: "start", id: "b" }] }, 0);
  assert.equal(run.duration, 0);
  assert.equal(run.time(), 0);
  assert.deepEqual(run.log(), [{ t: 0, type: "start", id: "b" }]);
  assert.equal(run.state().nodes.b.status, "active");
  ticker.tick(5); // frontier grows again post-reset
  assert.equal(run.duration, 5);
  run.destroy();
});

test("live transport: destroy() stops the frontier ticker and settles the pending awaitable", async () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(200);
  run.seek(0);
  const p = run.play();
  run.destroy();
  const res = await p;
  assert.equal(res.canceled, true);
  const before = run.duration;
  ticker.tick(50);
  assert.equal(run.duration, before); // no longer subscribed to the ticker
});

// ---- start/finish/spawn validation warnings (unknown ids still heal, they just now warn) ---

test("live transport: start()/finish()/spawn() on an unknown id still logs the event (self-heals) but warns", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);

  const startWarns = captureWarnings(() => run.start("nope"));
  assert.equal(startWarns.length, 1);
  assert.match(startWarns[0], /nope/);

  const finishWarns = captureWarnings(() => run.finish("nope"));
  assert.equal(finishWarns.length, 1);
  assert.match(finishWarns[0], /nope/);

  const spawnWarns = captureWarnings(() => run.spawn("nope", 2));
  assert.equal(spawnWarns.length, 1);
  assert.match(spawnWarns[0], /nope/);

  // still logged — an unknown id today can self-heal if the node is added later (D4 M2)
  assert.equal(run.log().length, 3);
  run.destroy();
});

test("live transport: start()/finish()/spawn() on a real node id never warns", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  const warns = captureWarnings(() => {
    run.start("a");
    run.finish("a");
    run.spawn("b", 1);
  });
  assert.deepEqual(warns, []);
  run.destroy();
});

test("live transport: finish() on a node with zero current occupancy warns (and stays pending, not done)", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  const warns = captureWarnings(() => run.finish("a")); // "a" was never start()'d
  assert.equal(warns.length, 1);
  assert.match(warns[0], /zero current occupancy/);
  assert.equal(run.state().nodes.a.status, "pending"); // finding 2: no phantom "done"
  run.destroy();
});

test("live transport: a second finish() past occupancy warns again but stays a no-op", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  run.start("a");
  run.finish("a"); // legitimately drains a's one occupant
  const warns = captureWarnings(() => run.finish("a")); // a already has zero occupants
  assert.equal(warns.length, 1);
  assert.match(warns[0], /zero current occupancy/);
  assert.equal(run.state().nodes.a.status, "done"); // unchanged, not re-derived
  run.destroy();
});

test("live transport: a non-numeric n passed to finish()/spawn() warns", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  run.start("a");
  const finishWarns = captureWarnings(() => run.finish("a", { n: "oops" }));
  assert.ok(finishWarns.some((w) => /non-numeric n/.test(w)));

  const spawnWarns = captureWarnings(() => run.spawn("b", "oops"));
  assert.ok(spawnWarns.some((w) => /non-numeric n/.test(w)));
  run.destroy();
});

test("live transport: finish() with no n at all does not warn about n", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "live" });
  ticker.tick(10);
  run.start("a");
  const warns = captureWarnings(() => run.finish("a"));
  assert.deepEqual(warns, []);
  run.destroy();
});

// ---- mode A untouched sanity ----------------------------------------------------------

test("mode A sanity: createRunTransport defaults to simulate and compiles a schedule", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, {});
  assert.ok(run.duration > 0); // compiled from the chain's default pacing
  assert.equal(run.time(), 0);
  assert.equal(typeof run.start, "undefined"); // live-only method, absent in Mode A
  run.seek(run.duration);
  assert.equal(run.state().done, true);
  run.destroy();
});

test("mode A sanity: explicit mode:'simulate' behaves identically to omitting mode", () => {
  const { ticker, store } = makeInternals();
  const run = createRunTransport({ ticker, store }, { mode: "simulate" });
  assert.ok(run.duration > 0);
  run.destroy();
});
