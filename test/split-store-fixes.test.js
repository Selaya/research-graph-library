// M2 verify findings — store.split() edge redirection + the choreographies' phase-2
// teardown guard. Every test here failed against the code as first written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitter } from "../src/events.js";
import { Store, GraphError } from "../src/store.js";
import { createTicker, EASE } from "../src/anim.js";
import { createScene } from "../src/scene.js";
import { createViewState } from "../src/viewstate.js";
import { layout } from "../src/layout.js";
import { runSplit, SPLIT_PHASES } from "../src/split-anim.js";
import { runCondense, CONDENSE_PHASES } from "../src/condense-anim.js";

const isCode = (code) => (err) => err instanceof GraphError && err.code === code;

// ---------------------------------------------------------------------------
// Finding 5 — split() must not silently drop the split node's external edges when the
// caller's internal wiring leaves no entry (or no exit) node to redirect them onto.
// ---------------------------------------------------------------------------

const cyclicParts = () => ({
  nodes: [{ id: "n1" }, { id: "n2" }],
  edges: [{ id: "i1", source: "n1", target: "n2" }, { id: "i2", source: "n2", target: "n1" }],
});

test("split: an all-nodes-in-a-cycle wiring with incoming edges is rejected, not silently dropped", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "M" }, { id: "B" }],
    edges: [{ id: "e_in", source: "A", target: "M" }, { id: "e_out", source: "M", target: "B" }],
  });
  assert.throws(() => s.split("M", cyclicParts()), isCode("split-no-entry"));
  // all guards run BEFORE any mutation — the store is untouched
  assert.equal(s.hasNode("M"), true);
  assert.equal(s.hasNode("n1"), false);
  assert.equal(s.edges.has("e_in"), true);
  assert.equal(s.edges.has("e_out"), true);
});

test("split: no-exit is reported separately from no-entry", () => {
  const s = new Store({
    nodes: [{ id: "M" }, { id: "B" }],
    edges: [{ id: "e_out", source: "M", target: "B" }],
  });
  // no incoming edges to redirect, so the empty entry set is fine; the empty exit set is not
  assert.throws(() => s.split("M", cyclicParts()), isCode("split-no-exit"));
  assert.equal(s.edges.has("e_out"), true);
});

test("split: a cyclic wiring is still legal when there is nothing to redirect", () => {
  const s = new Store({ nodes: [{ id: "M" }], edges: [] });
  assert.doesNotThrow(() => s.split("M", cyclicParts()));
  assert.deepEqual([...s.nodes.keys()].sort(), ["n1", "n2"]);
  assert.deepEqual([...s.edges.keys()].sort(), ["i1", "i2"]);
});

// ---------------------------------------------------------------------------
// Finding 11 — phase 2 (diverge/converge) must register ticker.onDestroy itself, so a
// clock teardown that does not also tear the scene down cannot strand the promise.
// ---------------------------------------------------------------------------

function host(spec) {
  const ticker = createTicker({ manual: true });
  const store = new Store(spec);
  const vs = createViewState(store);
  const scene = createScene(ticker);
  const bus = emitter();
  const marks = [];
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
    return { then: (a, b) => tr.promise.then(a, b), cancel: () => tr.cancel() };
  }

  const internals = {
    ticker, store, scene, bus, reduced: false,
    lastLayout: () => last,
    relayout,
    mark(ids, value) { marks.push({ ids: [...ids], value }); },
  };
  const g = { node: (id) => store.node(id) };
  relayout({ duration: 0 });
  ticker.tick(1);
  return { ticker, store, scene, bus, internals, g, marks };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function advance(ticker, ms) { ticker.tick(ms); await flush(); }
const within = (p, ms = 50) => Promise.race([p, new Promise((r) => setTimeout(() => r("PENDING"), ms))]);

const splitSpec = () => ({
  nodes: [{ id: "A" }, { id: "M" }, { id: "Z" }],
  edges: [{ id: "e1", source: "A", target: "M" }, { id: "e2", source: "M", target: "Z" }],
});

test("split: tearing the clock down MID-DIVERGE settles the run instead of stranding it", async () => {
  const h = host(splitSpec());
  const run = runSplit(h.g, h.internals, "M", {
    nodes: [{ id: "m1" }, { id: "m2" }], edges: [{ id: "internal", source: "m1", target: "m2" }],
  });
  await advance(h.ticker, SPLIT_PHASES.highlight + 1);
  assert.equal(h.store.hasNode("m1"), true, "phase 2 has already split the store");
  h.ticker.destroy(); // g.ticker is public — this can happen without scene.destroy()
  assert.deepEqual(await within(run.promise), { canceled: true });
});

test("condense: tearing the clock down MID-CONVERGE settles the run instead of stranding it", async () => {
  const h = host({
    nodes: [{ id: "A" }, { id: "B" }, { id: "Z" }],
    edges: [{ id: "e1", source: "A", target: "B" }, { id: "e2", source: "B", target: "Z" }],
  });
  const run = runCondense(h.g, h.internals, ["A", "B"], { id: "M" });
  await advance(h.ticker, CONDENSE_PHASES.highlight + 1);
  assert.equal(h.store.hasNode("M"), true, "phase 2 has already merged the store");
  h.ticker.destroy();
  assert.deepEqual(await within(run.promise), { canceled: true });
});

test("split: the normal phase-2 completion still resolves {canceled:false}", async () => {
  const h = host(splitSpec());
  const run = runSplit(h.g, h.internals, "M", {
    nodes: [{ id: "m1" }, { id: "m2" }], edges: [{ id: "internal", source: "m1", target: "m2" }],
  });
  await advance(h.ticker, SPLIT_PHASES.highlight + 1);
  await advance(h.ticker, SPLIT_PHASES.diverge + 1);
  await advance(h.ticker, SPLIT_PHASES.reveal + 1);
  assert.deepEqual(await within(run.promise, 200), { canceled: false });
});

// The same guard must fire at the g.split() call site, synchronously — index.js's stated
// discipline (a bad call throws where it was made, not out of runSplit's async phase 2).
test("g.split(): the no-entry guard fires synchronously at the call site", async () => {
  const { mount } = await import("../src/index.js");
  const doc = {
    head: { appendChild() {}, children: [] },
    querySelector: () => null,
    createElement: () => stub("style"),
    createElementNS: (_ns, tag) => stub(tag),
  };
  function stub(tag) {
    const el = {
      tagName: tag, children: [], attrs: {}, textContent: "",
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
      classList: { add() {}, remove() {}, contains: () => false },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c) { this.children.push(c); return c; },
      removeChild() {}, remove() {},
      addEventListener() {}, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
      clientWidth: 800, clientHeight: 400,
      getContext: () => ({ font: "", measureText: (s) => ({ width: String(s).length * 7 }) }),
    };
    el.ownerDocument = doc;
    return el;
  }
  const root = stub("div");
  const g = mount(root, {
    nodes: [{ id: "A" }, { id: "M" }, { id: "B" }],
    edges: [{ id: "e_in", source: "A", target: "M" }, { id: "e_out", source: "M", target: "B" }],
  }, { a11y: false, animation: { duration: 0 } });

  assert.throws(() => g.split("M", cyclicParts()), isCode("split-no-entry"));
  assert.equal(g.node("M") !== undefined, true, "nothing was mutated by the rejected split");
  g.destroy();
});
