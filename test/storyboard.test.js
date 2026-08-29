import { test } from "node:test";
import assert from "node:assert/strict";
import { createStoryboard, timeline } from "../src/storyboard.js";
import { GraphError } from "../src/store.js";

/** Fake host: state is just a counter bumped by one per real (non-label) step, so every
 * assertion can check "how many ops have actually landed" without a real Store/scene. */
function fakeHost() {
  const calls = [];
  let state = { v: 0 };
  return {
    calls,
    state: () => state,
    apply(step) {
      calls.push({ type: "apply", step });
      state = { v: state.v + 1, from: step };
      return Promise.resolve({ v: state.v });
    },
    snapshot() {
      calls.push({ type: "snapshot", snap: state });
      return state;
    },
    restore(snap) {
      calls.push({ type: "restore", snap });
      state = snap;
      return Promise.resolve();
    },
  };
}

const step = (tag) => ({ op: "addNode", args: [{ id: tag }] });

test("snapshot is taken before each step, in order (G2)", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a"), step("b"), step("c")]);
  await sb.play();
  assert.deepEqual(host.calls.map((c) => c.type), ["snapshot", "apply", "snapshot", "apply", "snapshot", "apply"]);
  assert.equal(host.calls[0].snap.v, 0, "before step 0, nothing has run yet");
  assert.equal(host.calls[2].snap.v, 1, "before step 1, only step 0 has run");
  assert.equal(host.calls[4].snap.v, 2, "before step 2, steps 0 and 1 have run");
});

test("label entries are zero-duration: no apply, no snapshot skipped for later ops", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a"), { label: "mid" }, step("b")]);
  await sb.play();
  assert.equal(host.calls.filter((c) => c.type === "apply").length, 2, "the label never calls host.apply");
  assert.deepEqual(sb.labels(), [{ label: "mid", index: 1 }]);
  assert.equal(sb.position().done, true);
});

test("seek(label) restores the right snapshot, and play() re-applies forward from there", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a"), { label: "mid" }, step("b"), step("c")]);
  await sb.play();
  assert.equal(host.state().v, 3, "three real ops landed");

  await sb.seek("mid");
  assert.equal(host.state().v, 1, "restored to the snapshot captured right before the label (after step a only)");
  assert.equal(sb.position().index, 1);
  assert.equal(sb.position().label, "mid");
  assert.equal(host.calls.at(-1).type, "restore");

  await sb.play();
  assert.equal(host.state().v, 3, "b and c re-ran forward from the restored point");
  assert.equal(sb.position().done, true);
});

test("seeking forward past ground never covered plays through instead of restoring", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a"), step("b"), step("c")]);
  await sb.seek(2);
  assert.equal(sb.position().index, 2);
  assert.equal(host.state().v, 2, "steps 0 and 1 ran to reach index 2");
  assert.ok(!host.calls.some((c) => c.type === "restore"), "nothing to restore — this ground is new");
});

test("next/prev move one step at a time; prev restores the pre-step snapshot", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a"), step("b")]);

  await sb.next();
  assert.equal(host.state().v, 1);
  assert.equal(sb.position().index, 1);

  await sb.next();
  assert.equal(host.state().v, 2);
  assert.equal(sb.position().done, true);

  await sb.prev();
  assert.equal(host.state().v, 1, "prev undoes the last step via its pre-step snapshot");
  assert.equal(sb.position().index, 1);

  await sb.prev();
  assert.equal(host.state().v, 0);
  assert.equal(sb.position().index, 0);

  await sb.prev(); // already at the start
  assert.equal(sb.position().index, 0);
  assert.equal(host.state().v, 0);
});

test("interleaved async steps settle strictly in order, never overlapping", async () => {
  const order = [];
  const pending = {};
  const host = {
    snapshot: () => ({}),
    restore: () => Promise.resolve(),
    apply(s) {
      return new Promise((resolve) => {
        pending[s.tag] = () => { order.push(s.tag); resolve(); };
      });
    },
  };
  const sb = createStoryboard(host, [
    { op: "run.play", tag: "x" },
    { op: "run.play", tag: "y" },
  ]);

  const done = sb.play();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(pending.x, "first step's apply started");
  assert.ok(!pending.y, "second step must not start before the first settles");

  pending.x();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(pending.y, "second step only starts once the first resolved");
  assert.ok(!order.includes("y"));

  pending.y();
  await done;
  assert.deepEqual(order, ["x", "y"]);
});

test("a run.play step's {run} completion is awaited before advancing", async () => {
  const host = fakeHost();
  let resolveRun;
  const runPromise = new Promise((r) => { resolveRun = r; });
  let calledApply = 0;
  host.apply = (s) => {
    calledApply++;
    if (s.op === "run.play") return { run: { promise: runPromise } };
    return Promise.resolve();
  };
  const sb = createStoryboard(host, [{ op: "run.play" }, step("after")]);

  const done = sb.play();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calledApply, 1, "the second step has not been applied yet");
  resolveRun({ canceled: false });
  await done;
  assert.equal(calledApply, 2);
});

test("events: on('step'|'seek'|'done') fire as the sequencer moves", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a"), step("b")]);
  const events = [];
  sb.on("step", (e) => events.push(["step", e.index]));
  sb.on("seek", (e) => events.push(["seek", e.index]));
  sb.on("done", () => events.push(["done"]));
  await sb.play();
  await sb.seek(0);
  assert.deepEqual(events, [["step", 0], ["step", 1], ["done"], ["seek", 0]]);
});

test("unknown op throws a GraphError at construction time", () => {
  const host = fakeHost();
  assert.throws(
    () => createStoryboard(host, [{ op: "explode" }]),
    (err) => err instanceof GraphError && err.code === "storyboard-op"
  );
});

test("a step with neither op nor label is rejected", () => {
  const host = fakeHost();
  assert.throws(() => createStoryboard(host, [{ foo: 1 }]), (err) => err instanceof GraphError);
});

test("seek() to an unknown label rejects with a GraphError", async () => {
  const host = fakeHost();
  const sb = createStoryboard(host, [step("a")]);
  await assert.rejects(() => sb.seek("nope"), (err) => err instanceof GraphError && err.code === "storyboard-label");
});

test("timeline() builder emits exactly the same op array as hand-written JSON", () => {
  const built = timeline()
    .addNode({ id: "monitor" }, { after: "deploy" })
    .addEdge({ id: "e9", source: "deploy", target: "monitor" })
    .label("expand")
    .expand("clean")
    .run({ until: "deploy" })
    .condense(["clean.dedupe", "clean.validate"], { id: "clean.auto" })
    .wait(500)
    .build();

  const handWritten = [
    { op: "addNode", args: [{ id: "monitor" }, { after: "deploy" }] },
    { op: "addEdge", args: [{ id: "e9", source: "deploy", target: "monitor" }] },
    { label: "expand" },
    { op: "expand", args: ["clean"] },
    { op: "run.play", args: [{ until: "deploy" }] },
    { op: "condense", args: [["clean.dedupe", "clean.validate"], { id: "clean.auto" }] },
    { op: "wait", ms: 500 },
  ];
  assert.deepEqual(built, handWritten);
  // The builder's own output must itself be a valid storyboard.
  assert.doesNotThrow(() => createStoryboard(fakeHost(), built));
});

test("timeline().to() rejects an unknown op immediately", () => {
  assert.throws(() => timeline().to("nope"), (err) => err instanceof GraphError);
});
