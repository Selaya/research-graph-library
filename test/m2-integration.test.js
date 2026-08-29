// M2 integration: the surface index.js added on top of the builders' modules —
// g.split(), g.expandAll()/g.collapseAll(), the query sugar spread onto g, ARIA attached
// at mount, and g.run({mode:'live'}) driven through the shared (manually pumped) ticker.
//
// Same technique as test/integration.test.js: a hand-rolled minimal DOM plus a manual rAF
// pump, so the single clock (D1) is deterministic. This shim adds real class-selector
// querySelector/querySelectorAll + focus(), which test/integration.test.js's shim does not
// have — a11y.js needs both, and without them it (correctly) no-ops.

import { test } from "node:test";
import assert from "node:assert/strict";

function matchesSel(el, sel) {
  if (sel[0] === ".") return (el.attrs.class || "").split(/\s+/).includes(sel.slice(1));
  return el.tagName === sel;
}
function queryAll(node, sel, out = []) {
  for (const c of node.children) { if (matchesSel(c, sel)) out.push(c); queryAll(c, sel, out); }
  return out;
}

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "", value: "",
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
      getPropertyValue(k) { return this._p[k] ?? ""; },
    },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
    },
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return this.attrs[k] !== undefined; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove();
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) { if (c.parent === this) c.remove(); return c; },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 480 }; },
    clientWidth: 900, clientHeight: 480,
    setPointerCapture() {}, releasePointerCapture() {},
    querySelectorAll(sel) { return queryAll(this, sel); },
    querySelector(sel) { return queryAll(this, sel)[0] || null; },
    focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; },
    getContext() { return { font: "", measureText: (s) => ({ width: String(s).length * 7.2 }) }; },
  };
  Object.defineProperty(el, "parentNode", { get() { return this.parent; } });
  el.ownerDocument = null;
  return el;
}

const head = makeEl("head");
const doc = {
  head,
  documentElement: head,
  activeElement: null,
  createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; },
  createElementNS(ns, t) { const e = makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector(sel) {
    return head.children.find((c) => c.tagName === "style" && Object.keys(c.attrs).some((k) => sel.includes(k))) || null;
  },
};
head.ownerDocument = doc;
globalThis.document = doc;

let clock = 0;
const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => clock };

const flush = () => new Promise((r) => setTimeout(r, 0));

async function pump(frames = 1, ms = 16) {
  for (let i = 0; i < frames; i++) {
    clock += ms;
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const fn of batch) fn(clock);
    await flush();
  }
}

async function pumpUntil(fn, maxFrames = 2000) {
  for (let i = 0; i < maxFrames; i++) {
    if (fn()) return true;
    await pump(1);
  }
  return !!fn();
}

async function settle(promise, maxFrames = 4000) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  const ok = await pumpUntil(() => done, maxFrames);
  assert.ok(ok, "awaited work settled within the frame budget");
  return out;
}

const { mount } = await import("../src/index.js");

function mountSpec(spec, opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec, { layout: { dir: "LR" }, animation: { duration: 60 }, ...opts });
  return { root, g };
}

const chain = () => ({
  nodes: [
    { id: "A", label: "A", data: { duration: "10s", status: "done" } },
    { id: "M", label: "M", data: { duration: "2h" } },
    { id: "Z", label: "Z" },
  ],
  edges: [
    { id: "a->m", source: "A", target: "M", weight: 3 },
    { id: "m->z", source: "M", target: "Z", label: "then" },
  ],
});

const nested = () => ({
  nodes: [
    { id: "in", label: "Ingest" },
    { id: "box", label: "Box", collapsed: true },
    { id: "box.a", parent: "box", label: "A" },
    { id: "box.b", parent: "box", label: "B" },
    { id: "inner", parent: "box", label: "Inner" },
    { id: "inner.x", parent: "inner", label: "X" },
    { id: "out", label: "Out" },
  ],
  edges: [
    { id: "e1", source: "in", target: "box.a" },
    { id: "e2", source: "box.a", target: "box.b" },
    { id: "e3", source: "box.b", target: "inner.x" },
    { id: "e4", source: "inner.x", target: "out" },
    { id: "loop", source: "out", target: "in", loop: true, maxIterations: 3 },
  ],
});

// ---------------------------------------------------------------------------
// g.split()
// ---------------------------------------------------------------------------

test("g.split() runs the choreography and redirects the split node's edges", async () => {
  const { g } = mountSpec(chain());
  const events = [];
  g.on("split", (e) => events.push(e));

  const res = await settle(g.split("M", {
    nodes: [{ id: "m1", label: "One" }, { id: "m2", label: "Two" }],
    edges: [{ id: "m1->m2", source: "m1", target: "m2" }],
  }));
  assert.equal(res.canceled, false);

  const spec = g.spec();
  const ids = spec.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["A", "Z", "m1", "m2"]);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, "M");
  assert.deepEqual([...events[0].targets].sort(), ["m1", "m2"]);
  assert.equal(events[0].sourceData.label, "M");

  // entry m1 inherits the incoming edge (keeping its id + weight), exit m2 the outgoing one
  const inEdge = spec.edges.find((e) => e.id === "a->m");
  assert.equal(inEdge.target, "m1");
  assert.equal(inEdge.weight, 3);
  assert.equal(spec.edges.find((e) => e.id === "m->z").source, "m2");

  // and the layout actually placed the new nodes
  const lay = g.layoutResult();
  assert.ok(lay.nodes.m1 && lay.nodes.m2, "both halves are laid out");
  assert.ok(!lay.nodes.M, "the split node is gone from the layout");
});

test("g.split() guards fire synchronously, before any store mutation", () => {
  const { g } = mountSpec(nested());
  const before = g.spec().nodes.length;

  assert.throws(() => g.split("nope", { nodes: [{ id: "x" }] }), /does not exist/);
  assert.throws(() => g.split("box", { nodes: [{ id: "x" }] }), /container/);
  assert.throws(() => g.split("out", { nodes: [] }), /at least one/);
  assert.throws(() => g.split("out", { nodes: [{ id: "" }] }), /non-empty id/);
  assert.throws(() => g.split("out", { nodes: [{ id: "p" }, { id: "p" }] }), /duplicate node id/);
  assert.throws(() => g.split("out", { nodes: [{ id: "in" }] }), /duplicate node id/);

  assert.equal(g.spec().nodes.length, before, "nothing was mutated by a rejected split");
  // reusing the split node's own id is legal — it is going away
  assert.doesNotThrow(() => g.split("out", { nodes: [{ id: "out" }, { id: "out2" }] }).cancel());
});

test("g.split() awaitable is cancelable and leaves the graph rendered", async () => {
  const { g } = mountSpec(chain());
  const h = g.split("M", { nodes: [{ id: "m1" }, { id: "m2" }] });
  await pump(20); // land inside the diverge phase
  h.cancel();
  const res = await settle(h);
  assert.equal(res.canceled, true);
  const lay = g.layoutResult();
  assert.ok(lay.nodes.m1 && lay.nodes.m2, "the canceled run still committed the new topology");
});

// ---------------------------------------------------------------------------
// expandAll / collapseAll
// ---------------------------------------------------------------------------

test("g.expandAll() opens every container in one commit, children blooming from their own box", async () => {
  const { g } = mountSpec(nested());
  const commits = [];
  g.on("commit", (c) => commits.push(c));
  const seen = [];
  g.on("expandAll", (e) => seen.push(e.ids));

  const boxBefore = { ...g.layoutResult().nodes.box };
  assert.ok(!g.layoutResult().nodes["box.a"], "collapsed to start with");

  await settle(g.expandAll());
  assert.equal(commits.length, 1, "exactly one relayout for the whole flip");
  assert.deepEqual(seen.length, 1);
  // only `box` was collapsed in the spec — `inner` was already open, so it is not "changed"
  assert.deepEqual(seen[0], ["box"]);

  const lay = g.layoutResult();
  for (const id of ["box.a", "box.b", "inner", "inner.x"]) assert.ok(lay.nodes[id], `${id} is visible`);
  assert.equal(g.viewstate.collapsed.size, 0);

  // enterFrom used the container's PREVIOUS centre, so nothing popped in from the origin
  const enter = commits[0].transition;
  assert.ok(enter, "commit carried a transition");
  assert.ok(Number.isFinite(boxBefore.x) && Number.isFinite(boxBefore.y));

  // idempotent: nothing left to expand, no second commit
  const n = commits.length;
  await settle(g.expandAll());
  assert.equal(commits.length, n, "a no-op expandAll does not relayout");
});

test("g.collapseAll() closes every container in one commit and round-trips with expandAll", async () => {
  const { g } = mountSpec(nested());
  await settle(g.expandAll());

  const commits = [];
  g.on("commit", (c) => commits.push(c));
  const seen = [];
  g.on("collapseAll", (e) => seen.push(e.ids));

  await settle(g.collapseAll());
  assert.equal(commits.length, 1);
  assert.deepEqual([...seen[0]].sort(), ["box", "inner"]);

  const lay = g.layoutResult();
  assert.ok(lay.nodes.box, "the outermost container is still on screen");
  for (const id of ["box.a", "box.b", "inner", "inner.x"]) assert.ok(!lay.nodes[id], `${id} is hidden`);

  await settle(g.expandAll());
  assert.ok(g.layoutResult().nodes["inner.x"], "expandAll re-opens nested containers too");
});

// ---------------------------------------------------------------------------
// query sugar
// ---------------------------------------------------------------------------

test("query sugar is spread onto g without clobbering the singular node()/edge()", () => {
  const { g } = mountSpec(nested());

  assert.equal(typeof g.node, "function");
  assert.equal(g.node("in").label, "Ingest");
  assert.equal(g.edge("e1").source, "in");

  assert.equal(g.nodes().length, 7);
  assert.deepEqual(g.edges({ loop: true }).map((e) => e.id), ["loop"]);
  assert.deepEqual(g.children("box").map((n) => n.id).sort(), ["box.a", "box.b", "inner"]);
  assert.deepEqual(g.descendants("box").map((n) => n.id).sort(), ["box.a", "box.b", "inner", "inner.x"]);
  assert.deepEqual(g.roots().map((n) => n.id).sort(), ["box", "in", "out"]);

  const { g: g2 } = mountSpec(chain());
  assert.deepEqual(g2.nodes({ data: { status: "done" } }).map((n) => n.id), ["A"]);
  assert.deepEqual(g2.nodes((n) => n.id > "M").map((n) => n.id), ["Z"]);
  // copies, not live refs
  g2.nodes()[0].label = "MUTATED";
  assert.equal(g2.node("A").label, "A");
});

// ---------------------------------------------------------------------------
// a11y attached at mount
// ---------------------------------------------------------------------------

test("mount() attaches ARIA by default and g.destroy() strips it", async () => {
  const { g, root } = mountSpec(nested());
  const svg = g.renderer.svg;
  assert.equal(svg.getAttribute("role"), "application");
  assert.equal(svg.getAttribute("aria-roledescription"), "graph");
  assert.equal(svg.querySelector(".smv-nodes").getAttribute("role"), "tree");

  const nodeEls = svg.querySelectorAll(".smv-node");
  assert.ok(nodeEls.length >= 3);
  for (const el of nodeEls) assert.equal(el.getAttribute("role"), "treeitem");
  const box = nodeEls.find((el) => el.getAttribute("data-id") === "box");
  assert.equal(box.getAttribute("aria-expanded"), "false");

  // ARIA survives a structural commit (the renderer re-keys elements)
  await settle(g.expandAll());
  const after = svg.querySelectorAll(".smv-node").find((el) => el.getAttribute("data-id") === "box");
  assert.equal(after.getAttribute("aria-expanded"), "true");
  assert.equal(
    svg.querySelectorAll(".smv-node").find((el) => el.getAttribute("data-id") === "inner.x").getAttribute("aria-level"),
    "3",
  );

  g.destroy();
  assert.equal(svg.getAttribute("role"), null);
  for (const el of svg.querySelectorAll(".smv-node")) assert.equal(el.getAttribute("role"), null);
  assert.ok(!root.classList.contains("smv-root"));
});

test("opts.a11y === false opts out entirely", () => {
  const { g } = mountSpec(chain(), { a11y: false });
  assert.equal(g.renderer.svg.getAttribute("role"), null);
  g.destroy();
});

// ---------------------------------------------------------------------------
// Mode B — live run through g.run({mode:'live'})
// ---------------------------------------------------------------------------

test("g.run({mode:'live'}) passes the mode through and drives tokens from a manual feed", async () => {
  const { g } = mountSpec(chain());
  const run = g.run({ mode: "live" });

  assert.equal(typeof run.start, "function", "the live surface is what came back");
  assert.equal(typeof run.spawn, "function");
  assert.equal(run.following, true);
  assert.equal(g.run(), run, "a bare g.run() returns the same live transport");

  await pump(3);
  assert.ok(run.now() > 0, "the frontier advances on the shared ticker");

  run.start("A");
  await pump(2);
  assert.equal(run.state().nodes.A.status, "active");

  run.finish("A");
  await pump(30); // > hopMs so the token lands on M
  const landed = run.state();
  assert.equal(landed.nodes.A.status, "done");
  assert.equal(landed.nodes.M.occupancy, 1);
  assert.equal(landed.nodes.M.status, "pending", "arriving does not start a node in live mode");

  const midT = run.time();
  await pump(2); // so the spawn below is stamped strictly after midT

  run.spawn("M", 3);
  await pump(2);
  assert.equal(run.state().nodes.M.occupancy, 4, "spawn() adds runtime fan-out occupancy");

  // time travel: back before the spawn, then before anything happened at all
  run.seek(midT);
  assert.equal(run.following, false, "seek detaches from the frontier");
  assert.equal(run.state().nodes.M.occupancy, 1);
  run.seek(0);
  assert.equal(run.state().nodes.A.status, "pending");

  // you can never scrub past now
  run.seek(1e9);
  assert.equal(run.time(), run.now());

  run.follow();
  assert.equal(run.following, true);
  await pump(2);
  assert.equal(run.state().nodes.M.occupancy, 4, "following again shows the newest state");

  assert.equal(run.log().length, 3);
  assert.equal(run.duration, run.now(), "duration is the growing frontier in live mode");

  g.destroy();
});

test("live mode reflects graph mutations with no recompile step", async () => {
  const { g } = mountSpec(chain());
  const run = g.run({ mode: "live" });
  run.start("A");
  run.finish("A");
  await pump(30);
  assert.equal(run.state().nodes.M.occupancy, 1);

  await settle(g.addNode({ id: "Q", label: "Q" }, { after: "M" }));
  assert.ok("Q" in run.state().nodes, "the new node is in live state immediately");
  g.destroy();
});
