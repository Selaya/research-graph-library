import { test } from "node:test";
import assert from "node:assert/strict";
import { emitter } from "../src/events.js";
import { Store } from "../src/store.js";
import { createTicker, EASE } from "../src/anim.js";
import { createScene } from "../src/scene.js";
import { createViewState } from "../src/viewstate.js";
import { layout } from "../src/layout.js";
import { runCondense, CONDENSE_PHASES } from "../src/condense-anim.js";

/** Manual clock + no DOM: the same relayout shape index.js uses, minus the renderer. */
function host({ reduced = false } = {}) {
  const ticker = createTicker({ manual: true });
  const store = new Store({
    nodes: [{ id: "A" }, { id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "Z" }],
    edges: [
      { id: "eA1", source: "A", target: "m1" },
      { id: "e12", source: "m1", target: "m2" },
      { id: "e23", source: "m2", target: "m3" },
      { id: "e3Z", source: "m3", target: "Z" },
    ],
  });
  const vs = createViewState(store);
  const scene = createScene(ticker);
  const bus = emitter();
  const marks = [];
  const commits = [];
  let last = null;

  function relayout(o = {}) {
    const v = vs.view();
    const res = layout(v, { dir: "LR" });
    const prev = last;
    const map = (m) => (typeof m === "function" ? m(res, prev) : m);
    const tr = scene.commit({ nodes: res.nodes, edges: res.edges }, {
      duration: o.duration ?? 0,
      easing: EASE.linear,
      enterFrom: map(o.enterFrom),
      exitTo: map(o.exitTo),
      easeOverride: o.easeOverride,
    });
    last = res;
    commits.push({ duration: o.duration ?? 0, focal: o.focal, easeOverride: o.easeOverride, transition: tr });
    return { then: (a, b) => tr.promise.then(a, b), cancel: () => tr.cancel() };
  }

  const internals = {
    ticker, store, scene, bus, reduced,
    lastLayout: () => last,
    relayout,
    mark(ids, value) { marks.push({ ids: [...ids], value }); },
  };
  const g = { node: (id) => store.node(id) };

  relayout({ duration: 0 });
  ticker.tick(1);
  commits.length = 0;
  return { ticker, store, scene, bus, vs, internals, g, marks, commits, relayout };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function advance(ticker, ms) {
  ticker.tick(ms);
  await flush();
}

const MERGED = { id: "auto", label: "Automated cleaning" };

test("phases run in order: highlight -> converge -> reveal, on the shared ticker", async () => {
  const h = host();
  const events = [];
  h.bus.on("condense", (p) => events.push(p));

  const run = runCondense(h.g, h.internals, ["m1", "m2", "m3"], MERGED);

  // 1 — highlight: the sources are marked and NOTHING has moved yet.
  assert.deepEqual(h.marks, [{ ids: ["m1", "m2", "m3"], value: "src" }]);
  assert.equal(h.commits.length, 0, "no relayout during highlight");
  assert.equal(h.store.hasNode("auto"), false, "the store is untouched during highlight");
  assert.equal(events.length, 0);

  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);

  // 2 — converge: one commit, at the converge duration, overshooting the merged node.
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].duration, CONDENSE_PHASES.converge);
  assert.equal(h.commits[0].focal, "auto");
  assert.equal(h.commits[0].easeOverride.auto, EASE.overshoot);
  assert.equal(h.store.hasNode("auto"), true);
  assert.equal(events.length, 1, "the condense event fires at phase 2 start");
  assert.equal(h.marks.length, 1, "reveal has not started yet");

  // The sources are still on screen, flying toward the merged node's new centre.
  const target = h.internals.lastLayout().nodes.auto;
  const before = { ...h.scene.visual.nodes.get("m1") };
  await advance(h.ticker, CONDENSE_PHASES.converge / 2);
  const mid = h.scene.visual.nodes.get("m1");
  assert.ok(Math.abs(mid.x - target.x) < Math.abs(before.x - target.x), "m1 converges on the merged centre");
  assert.ok(mid.w < before.w, "and shrinks on the way (exitTo)");
  assert.ok(mid.opacity > 0 && mid.opacity < 1);

  await advance(h.ticker, CONDENSE_PHASES.converge);
  assert.equal(h.scene.visual.nodes.has("m1"), false, "sources are gone once converge lands");

  // 3 — reveal: the merged node is marked, then unmarked when the phase ends.
  assert.deepEqual(h.marks.slice(1), [
    { ids: ["m1", "m2", "m3"], value: null },
    { ids: ["auto"], value: "reveal" },
  ]);
  await advance(h.ticker, CONDENSE_PHASES.reveal + 1);
  assert.deepEqual(h.marks.at(-1), { ids: ["auto"], value: null });
  assert.deepEqual(await run.promise, { canceled: false });
});

test("the condense event payload carries sources, target and both spec sides (C12)", async () => {
  const h = host();
  h.store.update("m1", { data: { duration: "2h" } });
  let payload = null;
  h.bus.on("condense", (p) => { payload = p; });

  const run = runCondense(h.g, h.internals, ["m1", "m2", "m3"], { ...MERGED, data: { duration: "8s" } });
  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);

  assert.deepEqual(payload.sources, ["m1", "m2", "m3"]);
  assert.equal(payload.target, "auto");
  assert.equal(payload.sourceData.length, 3);
  assert.equal(payload.sourceData[0].data.duration, "2h", "source specs are captured before they are removed");
  assert.equal(payload.targetData.data.duration, "8s");

  await advance(h.ticker, CONDENSE_PHASES.converge + 1);
  await advance(h.ticker, CONDENSE_PHASES.reveal + 1);
  await run.promise;
});

test("store state after: N nodes become 1, edges redirect, the graph still lays out", async () => {
  const h = host();
  const run = runCondense(h.g, h.internals, ["m1", "m2", "m3"], MERGED);
  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);
  await advance(h.ticker, CONDENSE_PHASES.converge + 1);
  await advance(h.ticker, CONDENSE_PHASES.reveal + 1);
  assert.deepEqual(await run.promise, { canceled: false });

  assert.deepEqual([...h.store.nodes.keys()], ["A", "Z", "auto"]);
  const edges = [...h.store.edges.values()].map((e) => `${e.source}->${e.target}`).sort();
  assert.deepEqual(edges, ["A->auto", "auto->Z"], "interior edges vanish, boundary edges redirect");
  assert.deepEqual([...h.scene.visual.nodes.keys()].sort(), ["A", "Z", "auto"]);
  for (const n of h.scene.visual.nodes.values()) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && n.w > 0, "no NaN geometry survives");
  }
});

test("reduced motion keeps every phase and its ordering, just ~1ms each (G9)", async () => {
  const h = host({ reduced: true });
  const seen = [];
  h.bus.on("condense", () => seen.push("condense"));

  const run = runCondense(h.g, h.internals, ["m1", "m2"], { id: "auto2" });
  assert.deepEqual(h.marks, [{ ids: ["m1", "m2"], value: "src" }]);
  await advance(h.ticker, 1);
  assert.equal(h.commits[0].duration, 1, "converge is shrunk, not skipped");
  assert.deepEqual(seen, ["condense"]);
  await advance(h.ticker, 1);
  await advance(h.ticker, 1);
  assert.deepEqual(await run.promise, { canceled: false });
  assert.deepEqual(h.marks.map((m) => m.value), ["src", null, "reveal", null], "the full sequence still ran");
  assert.equal(h.store.hasNode("auto2"), true);
});

test("a mutation mid-converge cancels the run cleanly (D9), leaving the merge in place", async () => {
  const h = host();
  const run = runCondense(h.g, h.internals, ["m1", "m2", "m3"], MERGED);
  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);
  await advance(h.ticker, CONDENSE_PHASES.converge / 2);

  // An unrelated mutation retargets the scene: the converge transition is canceled.
  h.store.addNode({ id: "N" });
  h.relayout({ duration: 100 });
  await flush();

  assert.deepEqual(await run.promise, { canceled: true });
  assert.deepEqual(h.marks.map((m) => m.value), ["src", null], "no reveal after a cancel");
  assert.equal(h.store.hasNode("auto"), true, "the structural merge already happened and stands");

  await advance(h.ticker, 200);
  assert.equal(h.scene.transition, null, "nothing keeps writing");
});

/** Resolve to "PENDING" instead of hanging, so a stranded promise fails an assertion. */
const within = (p, ms = 50) => Promise.race([p, new Promise((r) => setTimeout(() => r("PENDING"), ms))]);

test("an overlapping condense is canceled at phase 2, never thrown into the void", async () => {
  const h = host();
  // The double-clicked "automate" button: both calls pass g.condense()'s synchronous
  // guards because neither has touched the store yet.
  const first = runCondense(h.g, h.internals, ["m1", "m2"], { id: "auto" });
  const second = runCondense(h.g, h.internals, ["m1", "m2"], { id: "auto" });

  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);
  assert.deepEqual(await within(second.promise), { canceled: true }, "the loser is canceled, not rejected");

  await advance(h.ticker, CONDENSE_PHASES.converge + 1);
  await advance(h.ticker, CONDENSE_PHASES.reveal + 1);
  assert.deepEqual(await within(first.promise), { canceled: false }, "the winner still finishes");
  assert.equal(h.store.hasNode("auto"), true);
  assert.deepEqual([...h.store.nodes.keys()].sort(), ["A", "Z", "auto", "m3"], "merged exactly once");
});

test("tearing the clock down mid-phase settles the run instead of stranding it", async () => {
  const h = host();
  const run = runCondense(h.g, h.internals, ["m1", "m2"], { id: "auto5" });
  await advance(h.ticker, 32); // inside the highlight phase
  h.ticker.destroy();          // what g.destroy() does under a live condense
  assert.deepEqual(await within(run.promise), { canceled: true });
});

test("cancel() mid-converge lands the merged state instead of freezing it half-entered", async () => {
  const h = host();
  const run = runCondense(h.g, h.internals, ["m1", "m2", "m3"], MERGED);
  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);
  await advance(h.ticker, CONDENSE_PHASES.converge / 2);

  assert.equal(h.store.hasNode("auto"), true, "phase 2 already merged the store");
  const midway = h.scene.visual.nodes.get("auto").opacity;
  assert.ok(midway > 0 && midway < 1, "the merged node is halfway into its entrance");

  // An explicit cancel (§5.3's handle) — unlike a D9 retarget there is NO follow-up commit.
  run.cancel();
  assert.deepEqual(await run.promise, { canceled: true });
  await advance(h.ticker, 200);

  assert.deepEqual(
    [...h.scene.visual.nodes.keys()].sort(), ["A", "Z", "auto"],
    "the merged-away sources are gone from the picture, not stranded",
  );
  const m = h.scene.visual.nodes.get("auto");
  assert.equal(m.opacity, 1, "…and the node the store DOES have is visible, not stuck at 11%");
  assert.equal(m.w, h.internals.lastLayout().nodes.auto.w, "…at its real size, not 60%");
  assert.equal(h.scene.transition, null, "nothing keeps writing");
});

test("cancel() before converge stops the run and clears the highlight", async () => {
  const h = host();
  const run = runCondense(h.g, h.internals, ["m1", "m2"], { id: "auto3" });
  run.cancel();
  assert.deepEqual(await run.promise, { canceled: true });
  assert.deepEqual(h.marks.map((m) => m.value), ["src", null]);
  assert.equal(h.store.hasNode("auto3"), false, "canceling during highlight never touches the store");
  assert.equal(h.commits.length, 0);
});
