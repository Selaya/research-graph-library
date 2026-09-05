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
  // A bare `layout()` call has no memory of the previous drawing's slots — mount() keeps
  // one and makes the slot sticky (the mount tests below pin pipeline b by its head alone),
  // but the pure seam only ever knows the list it was handed.
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

test("RL and BT order the components the same way LR and TB do", () => {
  // The dirs are one transposition/flip apart, and the flip must not reverse the bands:
  // slot 0 leads whichever axis the dir puts the ranks on.
  for (const [dir, axis] of [["RL", "y"], ["BT", "x"]]) {
    const res = layout(FOUR(), { dir, componentOrder: ["d0", "c0", "b0", "a0"] });
    assert.deepEqual(bandOrder(res, ["a", "b", "c", "d"], axis), ["d", "c", "b", "a"], dir);
    assert.deepEqual(res.order[0], ["d0", "c0", "b0", "a0"], `${dir} order`);
  }
});

test("the result carries `slots` only when the option was in play", () => {
  assert.equal("slots" in layout(FOUR(), { dir: "LR" }), false, "absent without the option");
  const on = layout(FOUR(), { dir: "LR", componentOrder: ["b0"] });
  assert.deepEqual(on.slots.b0, 0);
  assert.deepEqual(on.slots.a0, 1, "unlisted components share the trailing slot");
  // An EMPTY drawing still answers with the key: its presence tracks the option, not the
  // graph, so a caller persisting it sees an empty memory rather than "no memory at all".
  const empty = layout({ nodes: [], edges: [] }, { dir: "LR", componentOrder: ["x"] });
  assert.deepEqual(empty.slots, {});
  assert.equal("slots" in layout({ nodes: [], edges: [] }, { dir: "LR" }), false);
});

test("componentOrderMemory places only the components the list does not claim", () => {
  // The list is the authority. A memory entry naming a component the list also names is
  // ignored outright — otherwise a re-slot after two components split apart never takes.
  const memory = { a0: 0, a1: 0, a2: 0, b0: 0, b1: 0, b2: 0, c0: 2, c1: 2, c2: 2 };
  const view = pipelines({ a: 3, b: 3, c: 3, d: 3 });
  const res = layout(view, {
    dir: "LR", componentOrder: ["a0", "b0", "c0"], componentOrderMemory: memory,
  });
  assert.deepEqual(res.order[0], ["a0", "b0", "c0", "d0"]);
  assert.equal(res.slots.b0, 1, "the explicit entry wins over the remembered slot 0");
  assert.equal(res.slots.d0, 3, "and an unremembered, unlisted component still goes last");

  // With the same memory but b unlisted, memory is what places it.
  const fallback = layout(view, { dir: "LR", componentOrder: ["c0", "a0"], componentOrderMemory: { b0: 0 } });
  assert.equal(fallback.slots.b0, 0, "memory places a component the list is silent about");
  assert.equal(fallback.order[0][0], "b0");

  // Junk memory never displaces anything: out-of-range, non-integer and unknown ids.
  const junk = layout(view, {
    dir: "LR", componentOrder: ["c0"],
    componentOrderMemory: { a0: 9, b0: -1, d0: 0.5, nope: 0, c0: 1 },
  });
  assert.deepEqual(junk.order, layout(view, { dir: "LR", componentOrder: ["c0"] }).order);
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
const ORDER = ["d0", "c0", "b0", "a0"];

test("mount: a slot outlives the id that named it, and every id after that", async () => {
  const g = mountGraph(PIPE_SPEC(), { dir: "LR", componentOrder: ORDER });
  await pump(3);
  const before = liveBands(g, ["a", "b", "c", "d"]);
  assert.deepEqual(before, ["d", "c", "b", "a"]);

  // b0 is the ONLY id the spec named for pipeline b, and it is the first thing to go: the
  // slot has to survive on the strength of the drawing's own memory from here on.
  const rm = g.removeNode("b0");
  await pump(10);
  await rm;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "after losing the named head");

  const add = g.addNode({ id: "d3", w: 100, h: 36 }, { after: "d2" });
  await pump(10);
  await add;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "after a sibling pipeline grew");

  // …and again, one id further: only b2 is left of the component the spec ever named.
  const rm2 = g.removeNode("b1");
  await pump(10);
  await rm2;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "after losing the second node too");

  const grow = g.addNode({ id: "b3", w: 100, h: 36 }, { after: "b2" });
  await pump(10);
  await grow;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "after regrowing from the remnant");
  assert.ok(g.layoutResult().nodes.b3, "the new node really is there");
  g.destroy();
});

test("mount: a new componentOrder re-resolves from scratch — the old memory cannot leak in", async () => {
  const g = mountGraph(PIPE_SPEC(), { dir: "LR", componentOrder: ORDER });
  await pump(3);
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["d", "c", "b", "a"]);

  // Reversed list. Every id of pipeline d is remembered in slot 0, which is now a0's slot:
  // replaying that memory over the new list would fuse a and d into one band.
  const flip = g.layout({ componentOrder: ["a0", "b0", "c0", "d0"] });
  await pump(10);
  await flip;
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["a", "b", "c", "d"]);
  assertGrouped(g.layoutResult().order, "after the list changed");

  // Off, then on again with a list that names only one component: a, c and d must fall
  // into the trailing unlisted band, not back into the slots they used to hold.
  const off = g.layout({ componentOrder: null });
  await pump(10);
  await off;
  const on = g.layout({ componentOrder: ["b0"] });
  await pump(10);
  await on;
  // Only b's slot is promised. a, c and d all share the trailing unlisted slot, and
  // nothing says components inside THAT band do not interleave — so do not assert it.
  assert.equal(liveBands(g, ["a", "b", "c", "d"])[0], "b", "the only listed component leads");
  const first = g.layoutResult().order[0];
  assert.equal(first[0], "b0", "b leads its rank");
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

test("mount: when a component splits at runtime, the list re-slots it — memory does not pin it", async () => {
  // a and b start JOINED, so both live in slot 0 (a0's). Cutting the join makes them two
  // components, and the list has always said b belongs in slot 1: the remembered slot 0
  // must not outvote that, nor let b drift ahead of a once a's named head is removed.
  const spec = {
    nodes: ["a0", "a1", "a2", "b0", "b1", "b2", "c0", "c1", "c2"].map((id) => ({ id, w: 100, h: 36 })),
    edges: [
      { id: "ea1", source: "a0", target: "a1" }, { id: "ea2", source: "a1", target: "a2" },
      { id: "eb1", source: "b0", target: "b1" }, { id: "eb2", source: "b1", target: "b2" },
      { id: "ec1", source: "c0", target: "c1" }, { id: "ec2", source: "c1", target: "c2" },
      { id: "join", source: "a2", target: "b0" },
    ],
  };
  const g = mountGraph(spec, { dir: "LR", componentOrder: ["a0", "b0", "c0"] });
  await pump(3);
  assert.equal(g.layoutResult().slots.b0, 0, "joined to a, b IS a's component");

  const cut = g.removeEdge("join");
  await pump(10);
  await cut;
  assert.equal(g.layoutResult().slots.b0, 1, "split apart, b takes the slot the list gives it");
  assert.deepEqual(liveBands(g, ["a", "b", "c"]), ["a", "b", "c"]);

  // …and it stays there when a loses the id that named ITS slot.
  const rm = g.removeNode("a0");
  await pump(10);
  await rm;
  assert.deepEqual(liveBands(g, ["a", "b", "c"]), ["a", "b", "c"], "a still leads b");
  g.destroy();
});

test("mount: condense and split hand the slot on to the ids they mint", async () => {
  const g = mountGraph(PIPE_SPEC(), { dir: "LR", componentOrder: ORDER });
  await pump(3);
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["d", "c", "b", "a"]);

  // Every id pipeline b was ever remembered by is consumed in ONE commit: without the
  // memory following the id change, B is a brand-new component nobody remembers and lands
  // in the trailing band.
  const merge = g.condense(["b0", "b1", "b2"], { id: "B", w: 100, h: 36 });
  await pump(140);
  await merge;
  assert.equal(g.layoutResult().slots.B, 2, "the merged node inherits its sources' slot");
  assert.ok(!g.layoutResult().nodes.b0, "the sources really are gone");
  assert.deepEqual(liveBands(g, ["a", "B", "c", "d"]), ["d", "c", "B", "a"]);

  // …and back out again: the parts inherit the slot the node they came from held.
  const undo = g.split("B", { nodes: [{ id: "b9", w: 100, h: 36 }, { id: "b8", w: 100, h: 36 }] });
  await pump(140);
  await undo;
  const slots = g.layoutResult().slots;
  assert.equal(slots.b9, 2, "b9 kept B's slot");
  assert.equal(slots.b8, 2, "b8 kept B's slot");
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), ["d", "c", "b", "a"]);
  g.destroy();
});

test("mount: a storyboard scrub replays the band order it is seeking back to", async () => {
  const steps = [
    { label: "start" },
    { label: "cut", op: "removeNode", args: ["b0"] },
    { label: "cut2", op: "removeNode", args: ["b1"] },
  ];
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, PIPE_SPEC(), {
    animation: { duration: 0 }, a11y: false, interaction: { tapToggle: false },
    layout: { dir: "LR", componentOrder: ORDER }, storyboard: steps,
  });
  await pump(3);
  const before = liveBands(g, ["a", "b", "c", "d"]);
  assert.deepEqual(before, ["d", "c", "b", "a"]);

  const sb = g.storyboard();
  const play = sb.play();
  await pump(60);
  await play;
  assert.ok(!g.layoutResult().nodes.b0 && !g.layoutResult().nodes.b1, "the steps ran");
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "forward: b holds its band");

  // Backward, to a state where b0 — the ONLY id the list names for b — is already gone.
  // Only the memory the snapshot carries can hold b's band there, exactly the way the
  // snapshot carries order/layers: the restored drawing has to be the one being replayed,
  // not one seeded from a future assignment.
  // seek(label) restores the state the step was about to run FROM, so "cut2" is the state
  // in which b0 is already gone and b1 has not gone yet.
  const mid = sb.seek("cut2");
  await pump(60);
  await mid;
  const atCut = g.layoutResult().nodes;
  assert.ok(!atCut.b0 && atCut.b1, "seeked to the state right after b0 went");
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "backward: same bands");
  assertGrouped(g.layoutResult().order, "after the scrub");

  const back = sb.seek("start");
  await pump(60);
  await back;
  assert.ok(g.layoutResult().nodes.b0, "b0 is back");
  assert.deepEqual(liveBands(g, ["a", "b", "c", "d"]), before, "and at the start too");
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
