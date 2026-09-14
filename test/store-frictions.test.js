// Regression tests for the store / structural-op frictions F28-F31 (docs/API-FRICTIONS.md):
//   F28 — condense() takes `parent: null` as "inherit", and loop edges are not paths
//         through the condensed set (store-level coverage lives in test/store.test.js).
//   F29 — g.update() can unset a data key, and a `collapsed` patch routes to
//         expand()/collapse() instead of being a no-op.
//   F30 — g.validate(ops|fn) dry-runs the structural guards against a throwaway clone.
//   F31 — `statusAgg` on a container picks how a descendant's failure rolls up.
//
// Same hand-rolled DOM shim + manual-ticker mounting idiom as test/core-api-fixes.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRun } from "../src/run.js";

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
    querySelector() { return null; },
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
  createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; },
  createElementNS(ns, t) { const e = makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector(sel) {
    return head.children.find((c) => c.tagName === "style" && Object.keys(c.attrs).some((k) => sel.includes(k))) || null;
  },
};
globalThis.document = doc;
globalThis.window = { matchMedia: () => ({ matches: false }) };

const flush = () => new Promise((r) => setTimeout(r, 0));

const { mount, GraphError } = await import("../src/index.js");

/** Drive the manual clock until `promise` settles (opts.ticker:"manual", D1). */
async function settle(promise, g, maxTicks = 800, ms = 16) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
  return out;
}

const boxSpec = () => ({
  nodes: [
    { id: "box", label: "Box" },
    { id: "b1", label: "One", parent: "box" },
    { id: "b2", label: "Two", parent: "box" },
    { id: "out", label: "Out" },
  ],
  edges: [{ id: "e1", source: "b1", target: "b2" }, { id: "e2", source: "b2", target: "out" }],
});

function mountG(spec = boxSpec(), opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  return mount(root, spec, { ticker: "manual", layout: { dir: "LR" }, animation: { duration: 40 }, ...opts });
}

const drawn = (g) => Object.keys(g.layoutResult().nodes).sort();

// ---------------------------------------------------------------------------
// F29 — update() unsets data keys and routes `collapsed`.
// ---------------------------------------------------------------------------

test("g.update(): `data: {key: undefined}` removes the key through the public API", async () => {
  const g = mountG();
  await settle(g.update("b1", { data: { fail: "boom", duration: "2s" } }), g);
  assert.deepEqual(g.node("b1").data, { fail: "boom", duration: "2s" });
  await settle(g.update("b1", { data: { fail: undefined } }), g);
  assert.deepEqual(g.node("b1").data, { duration: "2s" });
  g.destroy();
});

test("g.update(id, patch, {replace: true}) swaps the whole data payload", async () => {
  const g = mountG();
  await settle(g.update("b1", { data: { fail: true, note: "x" } }), g);
  await settle(g.update("b1", { data: { note: "y" } }, { replace: true }), g);
  assert.deepEqual(g.node("b1").data, { note: "y" });
  g.destroy();
});

test("g.update(id, {collapsed: true}) actually collapses, and `false` expands again", async () => {
  const g = mountG();
  const seen = [];
  g.on("collapse", ({ id }) => seen.push(`collapse:${id}`));
  g.on("expand", ({ id }) => seen.push(`expand:${id}`));
  assert.deepEqual(drawn(g), ["b1", "b2", "box", "out"]);

  await settle(g.update("box", { collapsed: true }), g);
  assert.deepEqual(drawn(g), ["box", "out"], "the children are folded away");
  assert.equal(g.node("box").collapsed, true, "…and the spec records it");

  await settle(g.update("box", { collapsed: false }), g);
  assert.deepEqual(drawn(g), ["b1", "b2", "box", "out"]);
  assert.deepEqual(seen, ["collapse:box", "expand:box"]);
  g.destroy();
});

test("a `collapsed` patch on a container with no children yet applies when they arrive", async () => {
  const g = mountG({ nodes: [{ id: "svc" }, { id: "out" }], edges: [] });
  await settle(g.update("svc", { collapsed: true }), g);
  assert.deepEqual(drawn(g), ["out", "svc"], "nothing to fold yet");
  await settle(g.addNode({ id: "k1", parent: "svc" }), g);
  assert.deepEqual(drawn(g), ["out", "svc"], "the child lands already folded away");

  await settle(g.update("svc", { collapsed: false }), g);
  assert.deepEqual(drawn(g), ["k1", "out", "svc"]);
  // …and a later child does not re-collapse it off the stale spec flag.
  await settle(g.addNode({ id: "k2", parent: "svc" }), g);
  assert.deepEqual(drawn(g), ["k1", "k2", "out", "svc"]);
  g.destroy();
});

const allText = (el, out = []) => {
  if (el.textContent) out.push(el.textContent);
  for (const c of el.children) allText(c, out);
  return out;
};

test("a patch carrying `collapsed` still commits everything else in it", async () => {
  const g = mountG();
  let commits = 0;
  g.on("commit", () => { commits++; });

  // `collapsed: false` on an already-expanded container: the view route is a no-op, so the
  // label in the SAME patch has to reach the screen anyway (it used to be dropped).
  const r = await settle(g.update("box", { label: "RENAMED", data: { k: 1 }, collapsed: false }), g);
  assert.equal(r.applied, true);
  assert.equal(commits > 0, true, "the patch was committed");
  assert.equal(g.node("box").label, "RENAMED");
  assert.ok(allText(g.el).includes("RENAMED"), "…and rendered");

  // And when the view half DOES move, one relayout still carries the rest of the patch.
  await settle(g.update("box", { label: "FOLDED", collapsed: true }), g);
  assert.deepEqual(drawn(g), ["box", "out"]);
  assert.ok(allText(g.el).includes("FOLDED"));
  g.destroy();
});

test("a `collapsed` patch that matches the current state is still a no-op awaitable", async () => {
  const g = mountG();
  const r = await settle(g.update("box", { collapsed: false }), g);
  assert.deepEqual(r, { canceled: false, applied: false }, "already expanded: nothing to do");
  g.destroy();
});

test("…but a `collapsed` patch carrying other keys resolves applied:true, even in-state", async () => {
  // The contract README/`update()`'s .d.ts state: only a collapsed-ONLY patch can report
  // `applied:false`, because a patch with other keys always commits something.
  const g = mountG();
  await settle(g.update("box", { collapsed: true }), g);
  const r = await settle(g.update("box", { collapsed: true, label: "STILL FOLDED" }), g);
  assert.deepEqual(r, { canceled: false, applied: true }, "the fold did not move, but the label did");
  assert.equal(g.node("box").label, "STILL FOLDED");
  assert.ok(allText(g.el).includes("STILL FOLDED"), "…and it is on screen");
  assert.deepEqual(
    await settle(g.update("box", { collapsed: true }), g),
    { canceled: false, applied: false },
    "collapsed-only, already folded: the no-op awaitable",
  );
  g.destroy();
});

// ---------------------------------------------------------------------------
// F30 — g.validate(ops | fn).
// ---------------------------------------------------------------------------

test("g.validate(ops): a clean op list reports ok and commits nothing", async () => {
  const g = mountG();
  let commits = 0;
  g.on("commit", () => commits++);
  const before = JSON.stringify(g.spec());
  const res = g.validate([
    { op: "addNode", args: [{ id: "n1" }] },
    { op: "addEdge", args: [{ id: "e9", source: "out", target: "n1" }] },
    { op: "removeNode", args: ["b1"] },
  ]);
  assert.deepEqual(res, { ok: true, errors: [] });
  assert.equal(JSON.stringify(g.spec()), before, "the real store is untouched");
  assert.equal(g.node("n1"), undefined);
  assert.equal(commits, 0, "and nothing was rendered");
  g.destroy();
});

test("g.validate(ops): every structural error comes back as a GraphError, none of them thrown", () => {
  const g = mountG();
  const res = g.validate([
    { op: "addNode", args: [{ id: "b1" }] },                                  // dup-id
    { op: "addEdge", args: [{ id: "e9", source: "nope", target: "out" }] },   // dangling
    { op: "removeNode", args: ["ghost"] },                                    // missing
    { op: "update", args: ["box", { parent: "b1" }] },                        // parent-cycle
  ]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map((e) => e.code), ["dup-id", "dangling", "missing", "parent-cycle"]);
  assert.ok(res.errors[0] instanceof GraphError);
  assert.ok(g.node("b1"), "the real store never saw any of it");
  g.destroy();
});

test("g.validate(fn) mirrors batch(fn), against a clone", () => {
  const g = mountG();
  const res = g.validate((probe) => {
    probe.removeNode("b1");
    // b1 is gone in the clone, so this edge is now dangling — the ops compose.
    probe.addEdge({ id: "e9", source: "b1", target: "out" });
    probe.addNode({ id: "n1", parent: "box" });
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map((e) => e.code), ["dangling"]);
  assert.ok(g.node("b1"));
  g.destroy();
});

test("g.validate(): the probe can be read like the graph, and knows the same condense guards", () => {
  const g = mountG({
    nodes: [{ id: "a" }, { id: "b" }, { id: "mid" }],
    edges: [
      { id: "e1", source: "a", target: "mid" },
      { id: "e2", source: "mid", target: "b" },
    ],
  });
  const res = g.validate((probe) => {
    assert.equal(probe.node("a").id, "a");
    assert.equal(probe.children("a").length, 0);
    probe.condense(["a", "b"], { id: "ab" });  // a -> mid -> b leaves the set and re-enters
    probe.condense(["a"], {});                 // no id on the merged spec
  });
  assert.deepEqual(res.errors.map((e) => e.code), ["non-convex", "node-id"]);
  g.destroy();
});

test("g.validate(): batch children are checked, director/transport steps are not, unknown ops are", () => {
  const g = mountG();
  const res = g.validate([
    { label: "a marker" },
    { op: "wait", ms: 100 },
    { op: "run.play" },
    { op: "camera", args: [{ node: "box" }] },
    { op: "batch", steps: [{ op: "addNode", args: [{ id: "b2" }] }] },  // dup-id, inside a batch
    { op: "teleport", args: [] },
  ]);
  assert.deepEqual(res.errors.map((e) => e.code), ["dup-id", "validate-op"]);
  g.destroy();
});

test("g.validate(): expand/collapse steps are checked for a live id, like the real methods", () => {
  const g = mountG();
  assert.equal(g.validate([{ op: "collapse", args: ["box"] }, { op: "expand", args: ["box"] }]).ok, true);

  const res = g.validate([
    { op: "removeNode", args: ["box"] },
    { op: "expand", args: ["box"] },   // gone by now — g.expand() would throw "missing"
    { op: "collapse", args: ["nope"] },
  ]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map((e) => e.code), ["missing", "missing"]);
  assert.throws(() => g.expand("nope"), (e) => e instanceof GraphError && e.code === "missing");
  g.destroy();
});

test("g.validate(): only ops storyboard() accepts are ops — a method name is not enough", () => {
  const g = mountG();
  const res = g.validate([{ op: "fitView" }, { op: "destroy" }]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map((e) => e.code), ["validate-op", "validate-op"]);
  assert.equal(g.validate([{ op: "camera", args: [{ to: "box" }] }, { op: "wait", args: [10] }]).ok, true);
  g.destroy();
});

test("g.validate(): addNode's `{after}` sugar is checked too, implicit edge and all", async () => {
  const g = mountG();

  // The op mints `e:nope->n1` as well as the node, so the real call throws "dangling" —
  // AFTER the node has already landed, which is exactly the half-applied patch validate()
  // exists to catch. The probe used to drop the second argument and report ok.
  const bad = g.validate([{ op: "addNode", args: [{ id: "n1" }, { after: "nope" }] }]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.code), ["dangling"]);
  assert.match(bad.errors[0].message, /e:nope->n1/);
  assert.throws(
    () => g.addNode({ id: "n1" }, { after: "nope" }),
    (e) => e instanceof GraphError && e.code === "dangling",
    "…which is what the real op does",
  );
  g.destroy();

  // And the other direction: the implicit edge exists in the clone, so a later op that
  // names it is legal rather than a phantom "missing".
  const g2 = mountG();
  assert.deepEqual(g2.validate([
    { op: "addNode", args: [{ id: "n1" }, { after: "out" }] },
    { op: "removeEdge", args: ["e:out->n1"] },
  ]), { ok: true, errors: [] });
  await settle(g2.addNode({ id: "n1" }, { after: "out" }), g2);
  assert.ok(g2.edge("e:out->n1"), "the real op did mint the edge validate() counted on");
  await settle(g2.removeEdge("e:out->n1"), g2);
  assert.equal(g2.edge("e:out->n1"), undefined, "…and running the pair for real does succeed");

  // The fn form goes through the same probe method.
  assert.deepEqual(
    g2.validate((probe) => probe.addNode({ id: "n2" }, { after: "ghost" })).errors.map((e) => e.code),
    ["dangling"],
  );
  g2.destroy();
});

test("g.validate(): a valid list can be handed straight to batch() afterwards", async () => {
  const g = mountG();
  const ops = [
    { op: "addNode", args: [{ id: "n1" }] },
    { op: "addEdge", args: [{ id: "e9", source: "out", target: "n1" }] },
  ];
  assert.equal(g.validate(ops).ok, true);
  await settle(g.batch((inner) => { for (const o of ops) inner[o.op](...o.args); }), g);
  assert.ok(g.node("n1"));
  assert.ok(g.edge("e9"));
  g.destroy();
});

// ---------------------------------------------------------------------------
// F31 — statusAgg on a container.
// ---------------------------------------------------------------------------

/** Two independent roots into one container: `hit` fails, `retry` succeeds later. */
const lifeline = (statusAgg) => ({
  nodes: [
    { id: "svc", label: "auth service", ...(statusAgg ? { statusAgg } : {}) },
    { id: "hit", parent: "svc", data: { duration: 1, fail: "401" } },
    { id: "retry", parent: "svc", data: { duration: 5 } },
    { id: "r1" }, { id: "r2" },
  ],
  edges: [
    { id: "e1", source: "r1", target: "hit" },
    { id: "e2", source: "r2", target: "retry" },
  ],
});

function marks(spec) {
  const sim = compileRun(spec);
  const failT = sim.events.find((e) => e.type === "fail").t;
  return {
    atFail: sim.stateAt(failT).nodes.svc.status,
    atEnd: sim.stateAt(sim.duration).nodes.svc.status,
  };
}

test("statusAgg: the default rolls the earliest descendant failure up, forever", () => {
  assert.deepEqual(marks(lifeline()), { atFail: "failed", atEnd: "failed" });
  assert.deepEqual(marks(lifeline("earliest-fail")), { atFail: "failed", atEnd: "failed" });
});

test("statusAgg: 'latest' lets a later success clear the container again", () => {
  assert.deepEqual(marks(lifeline("latest")), { atFail: "failed", atEnd: "done" });
});

test("statusAgg: 'none' never tints the container at all", () => {
  assert.deepEqual(marks(lifeline("none")), { atFail: "active", atEnd: "done" });
});

test("statusAgg: the failing child itself is unaffected by the container's policy", () => {
  for (const agg of [undefined, "earliest-fail", "latest", "none"]) {
    const sim = compileRun(lifeline(agg));
    assert.equal(sim.stateAt(sim.duration).nodes.hit.status, "failed", `hit stays failed under ${agg}`);
    assert.equal(sim.stateAt(sim.duration).nodes.retry.status, "done");
  }
});

test("statusAgg: an unknown value warns once and falls back to 'earliest-fail'", () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  let out;
  try { out = marks(lifeline("whenever")); } finally { console.warn = orig; }
  assert.deepEqual(out, { atFail: "failed", atEnd: "failed" });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[smv:run\].*statusAgg/);
});

test("statusAgg: nested containers each follow their own policy", () => {
  const sim = compileRun({
    nodes: [
      { id: "outer" },
      { id: "inner", parent: "outer", statusAgg: "none" },
      { id: "hit", parent: "inner", data: { duration: 1, fail: true } },
      { id: "r1" },
    ],
    edges: [{ id: "e1", source: "r1", target: "hit" }],
  });
  const end = sim.stateAt(sim.duration).nodes;
  assert.equal(end.inner.status, "done", "'none' stops the inner box going red");
  assert.equal(end.outer.status, "failed", "…while the outer box keeps the default rollup");
});
