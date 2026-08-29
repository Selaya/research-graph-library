import { test } from "node:test";
import assert from "node:assert/strict";
import { emitter } from "../src/events.js";
import { Store, GraphError } from "../src/store.js";
import { createTicker, EASE } from "../src/anim.js";
import { createScene } from "../src/scene.js";
import { createViewState } from "../src/viewstate.js";
import { layout } from "../src/layout.js";
import { runSplit, SPLIT_PHASES } from "../src/split-anim.js";

function isCode(code) {
  return (err) => err instanceof GraphError && err.code === code;
}

// ============================================================
// store-level: split()
// ============================================================

test("split: single entry/exit chain redirects in/out edges and keeps their ids", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "M" }, { id: "e2", source: "M", target: "Z" }],
  });
  const { added, addedEdges, removedEdges } = s.split("M", {
    nodes: [{ id: "m1" }, { id: "m2" }],
    edges: [{ id: "internal", source: "m1", target: "m2" }],
  });
  assert.deepEqual(added, ["m1", "m2"]);
  assert.equal(s.hasNode("M"), false);
  assert.deepEqual(new Set(removedEdges), new Set(["e1", "e2"]));
  assert.equal(addedEdges.length, 3); // internal + e1(->m1) + e2(m2->)

  assert.equal(s.edge("e1").source, "A");
  assert.equal(s.edge("e1").target, "m1", "single entry keeps the original edge id");
  assert.equal(s.edge("e2").source, "m2", "single exit keeps the original edge id");
  assert.equal(s.edge("e2").target, "Z");
  assert.equal(s.edge("internal").source, "m1");
  assert.equal(s.edge("internal").target, "m2");

  const pairs = [...s.edges.values()].map((e) => `${e.source}->${e.target}`).sort();
  assert.deepEqual(pairs, ["A->m1", "m1->m2", "m2->Z"]);
});

test("split: no internal edges -> every new node is both entry and exit (fan-out/fan-in, clone ids)", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "M" }, { id: "e2", source: "M", target: "Z" }],
  });
  const { added, addedEdges } = s.split("M", { nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }] });
  assert.deepEqual(added, ["n1", "n2", "n3"]);
  assert.equal(addedEdges.length, 6); // 3 clones of e1 + 3 clones of e2, no internal edges

  // incoming: first entry keeps "e1", the rest are "e1:<id>"
  const fromA = [...s.edges.values()].filter((e) => e.source === "A").sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(fromA.map((e) => e.id).sort(), ["e1", "e1:n2", "e1:n3"]);
  assert.deepEqual(fromA.map((e) => e.target).sort(), ["n1", "n2", "n3"]);

  // outgoing: first exit keeps "e2", the rest are "e2:<id>"
  const toZ = [...s.edges.values()].filter((e) => e.target === "Z");
  assert.deepEqual(toZ.map((e) => e.id).sort(), ["e2", "e2:n2", "e2:n3"]);
  assert.deepEqual(toZ.map((e) => e.source).sort(), ["n1", "n2", "n3"]);
});

test("split: multi-entry AND multi-exit at once produces the full cross product of clones", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "M" }, { id: "e2", source: "M", target: "Z" }],
  });
  // two entries (n1,n2 both have no internal in-edge), two exits (n2,n3 both have no
  // internal out-edge) — n1->n2->n3 chain gives entry={n1}, exit={n3} only... so instead
  // wire a fan-in/fan-out shape explicitly: n1,n2 are entries; n2,n3 are exits.
  const { addedEdges } = s.split("M", {
    nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }],
    edges: [{ id: "x", source: "n1", target: "n3" }], // n1 has out, n3 has in -> entries={n2,n3}? recompute below
  });
  // entries = nodes with no internal IN-edge = {n1, n2} (n3 has one, from x)
  // exits   = nodes with no internal OUT-edge = {n2, n3} (n1 has one, to n3)
  const fromA = [...s.edges.values()].filter((e) => e.source === "A");
  assert.deepEqual(fromA.map((e) => e.target).sort(), ["n1", "n2"]);
  const toZ = [...s.edges.values()].filter((e) => e.target === "Z");
  assert.deepEqual(toZ.map((e) => e.source).sort(), ["n2", "n3"]);
  assert.equal(addedEdges.length, 1 + 2 + 2);
});

test("split: weight on a redirected edge is preserved verbatim (no aggregation)", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "M", weight: 5 }],
  });
  s.split("M", { nodes: [{ id: "n1" }, { id: "n2" }] }); // both entries -> two clones of e1
  const clones = [...s.edges.values()].filter((e) => e.source === "A");
  assert.equal(clones.length, 2);
  for (const e of clones) assert.equal(e.weight, 5);
});

test("split: a self-loop on the split node is dropped, not redirected", () => {
  const s = new Store({
    nodes: [{ id: "M" }, { id: "Z" }],
    edges: [{ id: "loop", source: "M", target: "M" }, { id: "e1", source: "M", target: "Z" }],
  });
  const { removedEdges } = s.split("M", { nodes: [{ id: "n1" }] });
  assert.ok(removedEdges.includes("loop"));
  assert.equal([...s.edges.values()].some((e) => e.source === e.target), false, "no self-loop reappeared on the replacement");
});

test("split: new nodes inherit the split node's parent unless they name their own", () => {
  const s = new Store({
    nodes: [{ id: "P" }, { id: "M", parent: "P" }, { id: "Q" }],
    edges: [],
  });
  const { added } = s.split("M", { nodes: [{ id: "n1" }, { id: "n2", parent: "Q" }] });
  assert.equal(s.node("n1").parent, "P", "inherits the split node's parent");
  assert.equal(s.node("n2").parent, "Q", "an explicit parent wins");
  assert.equal(added.length, 2);
});

// ---- guards ----

test("split: missing id throws 'missing'", () => {
  const s = new Store({ nodes: [{ id: "A" }], edges: [] });
  assert.throws(() => s.split("nope", { nodes: [{ id: "x" }] }), isCode("missing"));
});

test("split: a container with children throws 'split-container'", () => {
  const s = new Store({
    nodes: [{ id: "C" }, { id: "c1", parent: "C" }],
    edges: [],
  });
  assert.throws(() => s.split("C", { nodes: [{ id: "x" }] }), isCode("split-container"));
  assert.equal(s.hasNode("C"), true, "a rejected split must not mutate");
});

test("split: a new node id colliding with an existing node throws 'dup-id'", () => {
  const s = new Store({ nodes: [{ id: "M" }, { id: "Q" }], edges: [] });
  assert.throws(() => s.split("M", { nodes: [{ id: "Q" }] }), isCode("dup-id"));
  assert.throws(() => s.split("M", { nodes: [{ id: "x" }, { id: "x" }] }), isCode("dup-id"), "dup among the new nodes themselves");
  assert.equal(s.hasNode("M"), true);
});

test("split: an internal edge touching a node outside the new set throws 'split-edge'", () => {
  const s = new Store({ nodes: [{ id: "M" }, { id: "Outside" }], edges: [] });
  assert.throws(() => s.split("M", {
    nodes: [{ id: "n1" }],
    edges: [{ id: "e", source: "n1", target: "Outside" }],
  }), isCode("split-edge"));
  assert.equal(s.hasNode("M"), true, "a rejected split must not mutate");
});

test("split: requires at least one new node", () => {
  const s = new Store({ nodes: [{ id: "M" }], edges: [] });
  assert.throws(() => s.split("M", { nodes: [] }));
  assert.throws(() => s.split("M", {}));
});

// ---- round trip ----

test("split: composes from existing primitives, so snapshot/restore round-trips it", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "M", data: { x: 1 } }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "M" }, { id: "e2", source: "M", target: "Z" }],
  });
  const before = s.snapshot();
  s.split("M", {
    nodes: [{ id: "m1" }, { id: "m2" }],
    edges: [{ id: "internal", source: "m1", target: "m2" }],
  });
  const after = s.snapshot();
  assert.notDeepEqual(after, before);

  // round-trips the POST-split state
  s.restore(after);
  assert.deepEqual(s.snapshot(), after);
  assert.equal(s.hasNode("m1"), true);
  assert.equal(s.hasNode("M"), false);

  // ...and restoring the pre-split snapshot undoes it cleanly
  s.restore(before);
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.hasNode("M"), true);
  assert.equal(s.hasNode("m1"), false);
});

// ============================================================
// anim-level: runSplit (fake host mirroring test/condense.test.js)
// ============================================================

function host({ reduced = false } = {}) {
  const ticker = createTicker({ manual: true });
  const store = new Store({
    nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "M" }, { id: "e2", source: "M", target: "Z" }],
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

const PARTS = { nodes: [{ id: "m1" }, { id: "m2" }], edges: [{ id: "internal", source: "m1", target: "m2" }] };

test("split phases run in order: highlight -> diverge -> reveal, on the shared ticker", async () => {
  const h = host();
  const events = [];
  h.bus.on("split", (p) => events.push(p));

  const run = runSplit(h.g, h.internals, "M", PARTS);

  // 1 — highlight: the source is marked, nothing has moved yet.
  assert.deepEqual(h.marks, [{ ids: ["M"], value: "src" }]);
  assert.equal(h.commits.length, 0, "no relayout during highlight");
  assert.equal(h.store.hasNode("m1"), false, "the store is untouched during highlight");
  assert.equal(events.length, 0);

  await advance(h.ticker, SPLIT_PHASES.highlight + 1);

  // 2 — diverge: one commit, at the diverge duration, overshooting the new nodes.
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].duration, SPLIT_PHASES.diverge);
  assert.equal(h.commits[0].easeOverride.m1, EASE.overshoot);
  assert.equal(h.commits[0].easeOverride.m2, EASE.overshoot);
  assert.equal(h.store.hasNode("m1"), true);
  assert.equal(h.store.hasNode("M"), false);
  assert.equal(events.length, 1, "the split event fires at phase 2 start");
  assert.deepEqual(events[0].targets, ["m1", "m2"]);
  assert.equal(events[0].source, "M");
  assert.equal(h.marks.length, 1, "reveal has not started yet");

  await advance(h.ticker, SPLIT_PHASES.diverge + 1);

  // 3 — reveal: the new nodes are marked, then unmarked when the phase ends.
  assert.deepEqual(h.marks.slice(1), [
    { ids: ["M"], value: null },
    { ids: ["m1", "m2"], value: "reveal" },
  ]);
  await advance(h.ticker, SPLIT_PHASES.reveal + 1);
  assert.deepEqual(h.marks.at(-1), { ids: ["m1", "m2"], value: null });
  assert.deepEqual(await run.promise, { canceled: false });
});

test("split event payload carries source, targets and the pre-split source data", async () => {
  const h = host();
  h.store.update("M", { data: { duration: "2h" } });
  let payload = null;
  h.bus.on("split", (p) => { payload = p; });

  const run = runSplit(h.g, h.internals, "M", PARTS);
  await advance(h.ticker, SPLIT_PHASES.highlight + 1);

  assert.equal(payload.source, "M");
  assert.deepEqual(payload.targets, ["m1", "m2"]);
  assert.equal(payload.sourceData.data.duration, "2h", "captured before the node was removed");

  await advance(h.ticker, SPLIT_PHASES.diverge + 1);
  await advance(h.ticker, SPLIT_PHASES.reveal + 1);
  await run.promise;
});

test("split enters new nodes from the source's previous centre and they bloom outward", async () => {
  const h = host();
  const before = { ...h.internals.lastLayout().nodes.M };
  const run = runSplit(h.g, h.internals, "M", PARTS);
  await advance(h.ticker, SPLIT_PHASES.highlight + 1);

  const m1Start = { ...h.scene.visual.nodes.get("m1") }; // clone: the Map entry mutates in place
  assert.ok(Math.abs(m1Start.x - before.x) < 1 && Math.abs(m1Start.y - before.y) < 1, "enters at the source's old centre");
  assert.ok(m1Start.w < h.internals.lastLayout().nodes.m1.w, "and at reduced size (60%->100% enter)");

  await advance(h.ticker, SPLIT_PHASES.diverge / 2);
  const mid = h.scene.visual.nodes.get("m1");
  assert.ok(mid.w > m1Start.w, "grows from its 60% entrance size (overshoot may carry it past 100%)");
  const mid2 = h.scene.visual.nodes.get("m2");
  assert.ok(Math.abs(mid2.x - before.x) > 0 || Math.abs(mid2.y - before.y) > 0, "m2 has moved away from the bloom point");

  await advance(h.ticker, SPLIT_PHASES.diverge);
  await advance(h.ticker, SPLIT_PHASES.reveal + 1);
  await run.promise;
});

test("split reduced motion keeps every phase and its ordering, just ~1ms each (G9)", async () => {
  const h = host({ reduced: true });
  const seen = [];
  h.bus.on("split", () => seen.push("split"));

  const run = runSplit(h.g, h.internals, "M", { nodes: [{ id: "n1" }] });
  assert.deepEqual(h.marks, [{ ids: ["M"], value: "src" }]);
  await advance(h.ticker, 1);
  assert.equal(h.commits[0].duration, 1, "diverge is shrunk, not skipped");
  assert.deepEqual(seen, ["split"]);
  await advance(h.ticker, 1);
  await advance(h.ticker, 1);
  assert.deepEqual(await run.promise, { canceled: false });
  assert.deepEqual(h.marks.map((m) => m.value), ["src", null, "reveal", null], "the full sequence still ran");
  assert.equal(h.store.hasNode("n1"), true);
});

test("a mutation mid-diverge cancels the run cleanly (D9), leaving the split in place", async () => {
  const h = host();
  const run = runSplit(h.g, h.internals, "M", PARTS);
  await advance(h.ticker, SPLIT_PHASES.highlight + 1);
  await advance(h.ticker, SPLIT_PHASES.diverge / 2);

  h.store.addNode({ id: "N" });
  h.relayout({ duration: 100 });
  await flush();

  assert.deepEqual(await run.promise, { canceled: true });
  assert.deepEqual(h.marks.map((m) => m.value), ["src", null], "no reveal after a cancel");
  assert.equal(h.store.hasNode("m1"), true, "the structural split already happened and stands");

  await advance(h.ticker, 200);
  assert.equal(h.scene.transition, null, "nothing keeps writing");
});

const within = (p, ms = 50) => Promise.race([p, new Promise((r) => setTimeout(() => r("PENDING"), ms))]);

test("tearing the clock down mid-phase settles the run instead of stranding it", async () => {
  const h = host();
  const run = runSplit(h.g, h.internals, "M", PARTS);
  await advance(h.ticker, 32); // inside the highlight phase
  h.ticker.destroy();
  assert.deepEqual(await within(run.promise), { canceled: true });
});

test("cancel() mid-diverge lands the split state instead of freezing it half-entered", async () => {
  const h = host();
  const run = runSplit(h.g, h.internals, "M", PARTS);
  await advance(h.ticker, SPLIT_PHASES.highlight + 1);
  await advance(h.ticker, SPLIT_PHASES.diverge / 2);

  assert.equal(h.store.hasNode("m1"), true, "phase 2 already split the store");
  const midway = h.scene.visual.nodes.get("m1").opacity;
  assert.ok(midway > 0 && midway < 1, "m1 is halfway into its entrance");

  run.cancel();
  assert.deepEqual(await run.promise, { canceled: true });
  await advance(h.ticker, 200);

  assert.deepEqual(
    [...h.scene.visual.nodes.keys()].sort(), ["A", "Z", "m1", "m2"],
    "the split-away source is gone from the picture, not stranded",
  );
  const m = h.scene.visual.nodes.get("m1");
  assert.equal(m.opacity, 1, "…and the nodes the store DOES have are visible, not stuck mid-entrance");
  assert.equal(m.w, h.internals.lastLayout().nodes.m1.w, "…at real size, not 60%");
  assert.equal(h.scene.transition, null, "nothing keeps writing");
});

test("cancel() before diverge stops the run and clears the highlight", async () => {
  const h = host();
  const run = runSplit(h.g, h.internals, "M", PARTS);
  run.cancel();
  assert.deepEqual(await run.promise, { canceled: true });
  assert.deepEqual(h.marks.map((m) => m.value), ["src", null]);
  assert.equal(h.store.hasNode("m1"), false, "canceling during highlight never touches the store");
  assert.equal(h.commits.length, 0);
});
