// `componentOrder` — pinning the vertical (LR/RL) or horizontal (TB/BT) order of the
// DISCONNECTED components of a drawing.
//
// Several parallel pipelines in one graph have no edges between them, so crossing
// minimization has nothing to say about their relative order: `pref` (the previous drawing,
// read rank-major) is the only thing holding them apart, and a rank shift in one pipeline
// hands the whole pipeline keys smaller than its new rank-mates' — it falls to the bottom,
// and so does anything added afterwards. The reproduction is the third test below.
//
// Everything here also guards the other direction: with the option absent (or not an
// array) the drawing must be identical to one built without the feature at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/layout.js";

// -------------------------------------------------------------------- fixtures + helpers

const WH = { w: 100, h: 36 };
const N = (id, extra) => ({ id, ...WH, ...extra });

/** `{ a: 3, b: 3 }` -> two disconnected chains a0->a1->a2, b0->b1->b2. */
function pipelines(spec) {
  const nodes = [], edges = [];
  for (const [p, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) nodes.push(N(`${p}${i}`));
    for (let i = 1; i < n; i++) edges.push({ id: `e${p}${i}`, source: `${p}${i - 1}`, target: `${p}${i}` });
  }
  return { nodes, edges };
}

const FOUR = () => pipelines({ a: 3, b: 3, c: 3, d: 3 });

/** Mean centre of every live node whose id starts with `p`, on the in-rank axis. */
function centroid(res, p, axis = "y") {
  let sum = 0, n = 0;
  for (const [id, r] of Object.entries(res.nodes)) {
    if (!id.startsWith(p)) continue;
    sum += r[axis]; n++;
  }
  return n ? sum / n : NaN;
}

const bandOrder = (res, prefixes, axis = "y") =>
  prefixes.slice().sort((a, b) => centroid(res, a, axis) - centroid(res, b, axis));

/** Every rank is grouped by component: no prefix appears in two separate runs. */
function assertGrouped(rows, label) {
  for (const row of rows) {
    const bands = row.map((tok) => tok[0]);
    const runs = bands.filter((b, i) => b !== bands[i - 1]);
    assert.equal(new Set(runs).size, runs.length, `${label}: ${JSON.stringify(row)} interleaves components`);
  }
}

/** The whole drawing, for the "an absent option changes nothing" comparisons. */
const shape = (r) => ({
  nodes: r.nodes, edges: r.edges, bounds: r.bounds,
  order: r.order, layers: r.layers, reversed: [...r.reversedEdgeIds].sort(),
});

/** The mutation from the bug report: pipeline b loses its head, pipeline d grows a tail. */
function mutate(view) {
  return {
    nodes: view.nodes.filter((n) => n.id !== "b0").concat([N("d3")]),
    edges: view.edges.filter((e) => e.source !== "b0" && e.target !== "b0")
      .concat([{ id: "ed3", source: "d2", target: "d3" }]),
  };
}

// --------------------------------------------------------------------------- layout()

test("componentOrder puts the components in the listed order, on every rank", () => {
  const res = layout(FOUR(), { dir: "LR", componentOrder: ["d0", "c0", "b0", "a0"] });
  assert.deepEqual(res.order, [
    ["d0", "c0", "b0", "a0"],
    ["d1", "c1", "b1", "a1"],
    ["d2", "c2", "b2", "a2"],
  ]);
  assertGrouped(res.order, "listed order");
  assert.deepEqual(bandOrder(res, ["a", "b", "c", "d"]), ["d", "c", "b", "a"]);
});

test("componentOrder holds the components in place across a mutation that used to reorder them", () => {
  // The entry for pipeline b lists ALIASES: its head is about to be removed, and an entry
  // whose every id is gone names no component at all (it falls in with the unlisted ones).
  const spec = ["d0", "c0", ["b0", "b1"], "a0"];
  const first = layout(FOUR(), { dir: "LR", componentOrder: spec });
  const before = bandOrder(first, ["a", "b", "c", "d"]);

  const after = layout(mutate(FOUR()), {
    dir: "LR", componentOrder: spec, prevOrder: first.order, prevLayers: first.layers,
  });
  assert.deepEqual(before, ["d", "c", "b", "a"]);
  assert.deepEqual(bandOrder(after, ["a", "b", "c", "d"]), before);
  assertGrouped(after.order, "after the mutation");
});

test("without componentOrder that same mutation DOES reorder the components", () => {
  // The bug, verbatim: b falls from slot 2 to last, because its rank shift hands every b
  // node a `pref` smaller than its new rank-mates'.
  const first = layout(FOUR(), { dir: "LR" });
  assert.deepEqual(bandOrder(first, ["a", "b", "c", "d"]), ["a", "b", "c", "d"]);
  const after = layout(mutate(FOUR()), { dir: "LR", prevOrder: first.order, prevLayers: first.layers });
  assert.notDeepEqual(bandOrder(after, ["a", "b", "c", "d"]), ["a", "b", "c", "d"]);
});

test("a componentOrder that is not a usable array changes nothing at all", () => {
  const base = shape(layout(FOUR(), { dir: "LR" }));
  for (const value of [undefined, null, [], "a0", { a0: 0 }, 7, () => {}]) {
    const got = shape(layout(FOUR(), { dir: "LR", componentOrder: value }));
    assert.deepEqual(got, base, `componentOrder: ${String(value)}`);
  }
});

test("unknown ids are ignored, and an alias entry names the same slot as any one of its ids", () => {
  const withUnknown = layout(FOUR(), { dir: "LR", componentOrder: ["nope", "d0", "zzz", "c0"] });
  const plain = layout(FOUR(), { dir: "LR", componentOrder: ["d0", "c0"] });
  assert.deepEqual(withUnknown.order, plain.order);

  const alias = layout(FOUR(), { dir: "LR", componentOrder: [["b0", "b2"]] });
  const single = layout(FOUR(), { dir: "LR", componentOrder: ["b0"] });
  assert.deepEqual(alias.order, single.order);
  assert.equal(alias.order[0][0], "b0", "the aliased component leads");
});

test("components nobody listed all share one slot after the listed ones, keeping their order", () => {
  const res = layout(FOUR(), { dir: "LR", componentOrder: ["c0", "a0"] });
  assert.deepEqual(res.order[0], ["c0", "a0", "b0", "d0"]);
  // b and d were never named: they keep the relative order the un-pinned solve gives them.
  const free = layout(FOUR(), { dir: "LR" }).order[0].filter((id) => id[0] === "b" || id[0] === "d");
  assert.deepEqual(res.order[0].filter((id) => id[0] === "b" || id[0] === "d"), free);
});

test("containment counts as connectivity: a container and its children are one component", () => {
  const view = () => ({
    nodes: [
      N("a0"), N("a1"),
      { id: "C" }, N("c0", { parent: "C" }), N("c1", { parent: "C" }),
      N("b0"), N("b1"),
    ],
    edges: [
      { id: "ea", source: "a0", target: "a1" },
      { id: "ec", source: "c0", target: "c1" },
      { id: "eb", source: "b0", target: "b1" },
    ],
  });
  for (const [label, spec] of [["the container id", ["C"]], ["one child id", ["c0"]]]) {
    const res = layout(view(), { dir: "LR", componentOrder: spec });
    assert.deepEqual(res.order, [["c0", "a0", "b0"], ["c1", "a1", "b1"]], `listed by ${label}`);
    assert.ok(centroid(res, "c0") < centroid(res, "a"), `listed by ${label}: the children lead`);
    assert.ok(res.nodes.C.y + res.nodes.C.h / 2 < res.nodes.a0.y, `listed by ${label}: the rect leads too`);
  }
});

test("dir TB orders the components along x instead of y", () => {
  const res = layout(FOUR(), { dir: "TB", componentOrder: ["d0", "c0", "b0", "a0"] });
  assert.deepEqual(bandOrder(res, ["a", "b", "c", "d"], "x"), ["d", "c", "b", "a"]);
  assertGrouped(res.order, "TB");
});

test("a long edge's bends stay inside their own component's band", () => {
  const view = {
    nodes: [N("a0"), N("a1"), N("a2"), N("a3"), N("b0"), N("b1"), N("b2"), N("b3")],
    edges: [
      { id: "a01", source: "a0", target: "a1" }, { id: "a12", source: "a1", target: "a2" },
      { id: "a23", source: "a2", target: "a3" }, { id: "along", source: "a0", target: "a3" },
      { id: "b01", source: "b0", target: "b1" }, { id: "b12", source: "b1", target: "b2" },
      { id: "b23", source: "b2", target: "b3" },
    ],
  };
  const res = layout(view, { dir: "LR", componentOrder: ["b0", "a0"] });
  assertGrouped(res.order, "long edge (order)");
  // `layers` is the same per-rank sequence WITH the bends, whose tokens are built off the
  // edge id — every id here starts with its own component's letter, so the same grouping
  // check catches a bend of a that slipped between b's nodes.
  assertGrouped(res.layers, "long edge (layers)");
  const count = (rows) => rows.reduce((n, row) => n + row.length, 0);
  assert.ok(count(res.layers) > count(res.order), "the long edge really did produce bends");
});

test("a cycle-broken edge still counts as connectivity (opts.backLinks)", () => {
  // A pipeline with a back edge: the shell withholds the reversed edge from the solver.
  const cyclic = pipelines({ a: 3, b: 3 });
  cyclic.edges.push({ id: "aback", source: "a2", target: "a0" });
  const res = layout(cyclic, { dir: "LR", componentOrder: ["b0", "a0"] });
  assert.ok(res.reversedEdgeIds.size > 0, "the back edge really was broken");
  assertGrouped(res.order, "cyclic pipeline");
  assert.deepEqual(res.order[0], ["b0", "a0"]);

  // …and the case where the withheld edge is a component's ONLY link: a `loop:true` edge is
  // reversed (and withheld) whether or not it closes a cycle. Without backLinks k0 and k1
  // would be two components, and the unlisted one lands last — splitting the pair.
  const cut = {
    nodes: [N("k0"), N("k1"), N("a0"), N("a1"), N("a2")],
    edges: [
      { id: "ek", source: "k0", target: "k1", loop: true },
      { id: "ea1", source: "a0", target: "a1" }, { id: "ea2", source: "a1", target: "a2" },
    ],
  };
  const r2 = layout(cut, { dir: "LR", componentOrder: ["k0", "a0"] });
  assert.ok(r2.reversedEdgeIds.has("ek"), "the loop edge was withheld");
  assert.deepEqual(r2.order[0], ["k0", "k1", "a0"]);
});

// ----------------------------------------------------------------------------- mount()
//
// The layout()-level tests above cannot see index.js's own share of the feature: that
// `layoutOpts` persists a componentOrder set at runtime, and that ids naming a COLLAPSED
// child are resolved to the leaf standing in for them. Same fake-DOM + manual rAF pump
// harness as test/mental-map.test.js.

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "",
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, contains(c) { return this._s.has(c); } },
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return this.attrs[k] !== undefined; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove(); c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) { if (c.parent === this) c.remove(); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 480 }; },
    clientWidth: 900, clientHeight: 480,
    setPointerCapture() {}, releasePointerCapture() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return { font: "", measureText: (s) => ({ width: String(s).length * 7.2 }) }; },
  };
  Object.defineProperty(el, "parentNode", { get() { return this.parent; } });
  el.ownerDocument = null;
  return el;
}

const head = makeEl("head");
const doc = {
  head, documentElement: head,
  createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; },
  createElementNS(ns, t) { const e = makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector() { return null; },
};
globalThis.document = doc;

let clock = 0;
const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => clock };
const flush = () => new Promise((r) => setTimeout(r, 0));
async function pump(frames, ms = 16) {
  for (let i = 0; i < frames; i++) {
    clock += ms;
    for (const fn of rafQueue.splice(0, rafQueue.length)) fn(clock);
    await flush();
  }
}

const { mount } = await import("../src/index.js");

function mountGraph(spec, layoutOpts) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  return mount(root, spec, {
    animation: { duration: 0 }, a11y: false, interaction: { tapToggle: false },
    ...(layoutOpts ? { layout: layoutOpts } : {}),
  });
}

/** Live y-centroid per pipeline, read off the mounted graph's last layout. */
function liveBands(g, prefixes) {
  const nodes = g.layoutResult().nodes;
  const mean = (p) => {
    let s = 0, n = 0;
    for (const [id, r] of Object.entries(nodes)) if (id.startsWith(p)) { s += r.y; n++; }
    return n ? s / n : NaN;
  };
  return prefixes.slice().sort((a, b) => mean(a) - mean(b));
}

const PIPE_SPEC = () => pipelines({ a: 3, b: 3, c: 3, d: 3 });
const ORDER = ["d0", "c0", ["b0", "b1"], "a0"];

test("mount: componentOrder survives a removal in one pipeline and an append in another", async () => {
  const g = mountGraph(PIPE_SPEC(), { dir: "LR", componentOrder: ORDER });
  await pump(3);
  const before = liveBands(g, ["a", "b", "c", "d"]);
  assert.deepEqual(before, ["d", "c", "b", "a"]);

  const rm = g.removeNode("b0");
  await pump(10);
  await rm;
  const add = g.addNode({ id: "d3", w: 100, h: 36 }, { after: "d2" });
  await pump(10);
  await add;

  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before);
  g.destroy();
});

test("mount: g.layout({componentOrder}) persists across later mutations, and null clears it", async () => {
  const g = mountGraph(PIPE_SPEC());
  await pump(3);
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["a", "b", "c", "d"]);

  const set = g.layout({ componentOrder: ORDER });
  await pump(10);
  await set;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["d", "c", "b", "a"]);

  // Nothing re-states the option here: layoutOpts is holding it.
  const add = g.addNode({ id: "d3", w: 100, h: 36 }, { after: "d2" });
  await pump(10);
  await add;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["d", "c", "b", "a"]);

  const off = g.layout({ componentOrder: null });
  await pump(10);
  await off;
  const res = g.layoutResult();
  assert.ok(res && res.nodes.a0 && Number.isFinite(res.nodes.a0.y), "the drawing is still valid");
  assert.equal(Object.keys(res.nodes).length, 13, "every node is still placed");
  g.destroy();
});

test("mount: a listed child id keeps its slot once its container is collapsed", async () => {
  const spec = {
    nodes: [
      { id: "a0", w: 100, h: 36 }, { id: "a1", w: 100, h: 36 },
      { id: "C" }, { id: "c0", parent: "C", w: 100, h: 36 }, { id: "c1", parent: "C", w: 100, h: 36 },
      { id: "b0", w: 100, h: 36 }, { id: "b1", w: 100, h: 36 },
    ],
    edges: [
      { id: "ea", source: "a0", target: "a1" },
      { id: "ec", source: "c0", target: "c1" },
      { id: "eb", source: "b0", target: "b1" },
    ],
  };
  // Listed by CHILD id — the id the caller knows, not the container it happens to live in.
  const g = mountGraph(spec, { dir: "LR", componentOrder: ["c0"] });
  await pump(3);
  const open = g.layoutResult().nodes;
  assert.ok(open.c0.y < open.a0.y && open.c0.y < open.b0.y, "the container band leads while expanded");

  const shrink = g.collapse("C");
  await pump(10);
  await shrink;
  const shut = g.layoutResult().nodes;
  assert.ok(!shut.c0, "c0 is collapsed away");
  assert.ok(shut.C.y < shut.a0.y && shut.C.y < shut.b0.y,
    `the collapsed leaf kept the slot (C at ${shut.C.y}, a0 ${shut.a0.y}, b0 ${shut.b0.y})`);
  g.destroy();
});
