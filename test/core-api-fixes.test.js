// Regression tests for the M2 "core API" usability findings:
//   1. g.node()/g.edge() now return copies, like every plural query method.
//   2. g.batch(fn) refuses a Promise-returning fn (GraphError "batch-async").
//   3. GraphError is a real export off the public entry.
//   4. Every mutation awaitable resolves {canceled, applied[, ids]}, not {canceled} alone.
//
// Same hand-rolled DOM shim + manual-ticker mounting idiom as test/m4-integration.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

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

const { mount } = await import("../src/index.js");
const { GraphError } = await import("../src/index.js");

/** Drive the manual clock until `promise` settles (opts.ticker:"manual", D1). */
async function settle(promise, g, maxTicks = 800, ms = 16) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
  return out;
}

const spec = () => ({
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "c" }],
});

function mountCore(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec(), { ticker: "manual", layout: { dir: "LR" }, animation: { duration: 40 }, ...opts });
  return { root, g };
}

// ---------------------------------------------------------------------------
// Finding 1 — g.node()/g.edge() return copies, not live store refs.
// ---------------------------------------------------------------------------

test("g.node() returns a plain copy: mutating it does not corrupt the store", () => {
  const { g } = mountCore();
  const n = g.node("a");
  n.label = "TAMPERED";
  n.data = { hacked: true };
  assert.equal(g.node("a").label, "A", "the store's own record is untouched");
  assert.equal(g.node("a").data, undefined);
  g.destroy();
});

test("g.edge() returns a plain copy: mutating it does not corrupt the store", () => {
  const { g } = mountCore();
  const e = g.edge("e1");
  e.source = "TAMPERED";
  assert.equal(g.edge("e1").source, "a", "the store's own record is untouched");
  g.destroy();
});

test("g.node()/g.edge() still return undefined for an unknown id", () => {
  const { g } = mountCore();
  assert.equal(g.node("nope"), undefined);
  assert.equal(g.edge("nope"), undefined);
  g.destroy();
});

test("g.node()/g.edge() clone data the same way the plural query methods do", () => {
  const { g } = mountCore();
  g.update("a", { data: { status: "done" } });
  const n = g.node("a");
  n.data.status = "TAMPERED";
  assert.equal(g.node("a").data.status, "done", "data is a shallow copy too, not shared by reference");
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 2 — g.batch(fn) refuses an async/Promise-returning fn.
// ---------------------------------------------------------------------------

test("g.batch(fn) throws GraphError('batch-async') for a Promise-returning fn", () => {
  const { g } = mountCore();
  assert.throws(
    () => g.batch(async (inner) => { inner.addNode({ id: "z" }); }),
    (err) => err instanceof GraphError && err.code === "batch-async",
  );
  g.destroy();
});

test("g.batch(fn) async detection: ops before the returned promise still land (batch is not transactional)", () => {
  const { g } = mountCore();
  let ran = false;
  assert.throws(
    () => g.batch(async (inner) => {
      inner.addNode({ id: "before-await" }); // runs synchronously before fn's first await
      ran = true;
      await Promise.resolve();
      inner.addNode({ id: "after-await" });   // never runs: this synchronous call throws first
    }),
    (err) => err instanceof GraphError && err.code === "batch-async",
  );
  assert.ok(ran, "fn's synchronous prefix (up to the first await) already executed");
  assert.equal(g.node("before-await") !== undefined, true, "and its ops already landed in the store");
  assert.equal(g.node("after-await"), undefined, "the continuation past the first await never got a chance to run");
  g.destroy();
});

test("g.batch(fn) with an ordinary synchronous fn is unaffected", async () => {
  const { g } = mountCore();
  const tr = g.batch((inner) => { inner.addNode({ id: "z" }); });
  const r = await settle(tr, g);
  assert.equal(r.canceled, false);
  assert.equal(r.applied, true);
  assert.equal(g.node("z") !== undefined, true);
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 3 — GraphError is exported from the public entry.
// ---------------------------------------------------------------------------

test("GraphError is exported from src/index.js and every thrown mutation error is an instance of it", () => {
  assert.equal(typeof GraphError, "function");
  const { g } = mountCore();
  assert.throws(() => g.addNode({ id: "" }), (err) => {
    assert.ok(err instanceof GraphError, "instanceof works on the re-exported class");
    assert.equal(err.code, "node-id");
    assert.ok(err instanceof Error);
    return true;
  });
  g.destroy();
});

test("the default export also carries GraphError, riding into the IIFE global the way mount/presetPipeline do", async () => {
  const mod = await import("../src/index.js");
  assert.equal(mod.default.GraphError, GraphError);
});

// ---------------------------------------------------------------------------
// Finding 4 — mutation awaitables resolve {canceled, applied[, ids]}.
// ---------------------------------------------------------------------------

test("addNode()/addEdge()/update() resolve {canceled:false, applied:true}", async () => {
  const { g } = mountCore();
  const addN = await settle(g.addNode({ id: "z" }), g);
  assert.deepEqual(addN, { canceled: false, applied: true });
  const addE = await settle(g.addEdge({ id: "e3", source: "z", target: "a" }), g);
  assert.deepEqual(addE, { canceled: false, applied: true });
  const upd = await settle(g.update("a", { label: "A2" }), g);
  assert.deepEqual(upd, { canceled: false, applied: true });
  g.destroy();
});

test("removeNode() resolves the full doomed cascade of removed node/edge ids", async () => {
  const { g } = mountCore(); // a -> b -> c, and b has no children
  const r = await settle(g.removeNode("b"), g);
  assert.equal(r.canceled, false);
  assert.equal(r.applied, true);
  assert.deepEqual(r.ids.nodes, ["b"]);
  assert.deepEqual(r.ids.edges.sort(), ["e1", "e2"], "both edges incident to b are in the cascade");
  g.destroy();
});

test("removeNode() cascade includes swallowed descendants, not just the named id", async () => {
  const { g } = mountCore();
  await settle(g.addNode({ id: "p" }), g);
  await settle(g.addNode({ id: "p.kid", parent: "p" }), g);
  const r = await settle(g.removeNode("p"), g);
  assert.deepEqual(r.ids.nodes.sort(), ["p", "p.kid"]);
  g.destroy();
});

test("expand()/collapse() resolve applied:false when there was nothing to do", async () => {
  const spec2 = {
    nodes: [{ id: "box" }, { id: "box.kid", parent: "box" }],
    edges: [],
  };
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec2, { ticker: "manual", layout: { dir: "LR" } });

  // Already expanded (default): collapse() applies, a second collapse() does not.
  const first = await settle(g.collapse("box"), g);
  assert.deepEqual(first, { canceled: false, applied: true });
  const noop = await g.collapse("box"); // synchronous no-op path, no ticks needed
  assert.deepEqual(noop, { canceled: false, applied: false });

  const reopened = await settle(g.expand("box"), g);
  assert.deepEqual(reopened, { canceled: false, applied: true });
  const noop2 = await g.expand("box");
  assert.deepEqual(noop2, { canceled: false, applied: false });
  g.destroy();
});

test("g.batch()'s own returned awaitable resolves {canceled:false, applied:true} too", async () => {
  const { g } = mountCore();
  const tr = g.batch((inner) => {
    inner.addNode({ id: "z1" });
    inner.addNode({ id: "z2" });
  });
  const r = await settle(tr, g);
  assert.equal(r.canceled, false);
  assert.equal(r.applied, true);
  g.destroy();
});

test("g.condense()/g.split() resolve created/removed ids once the merge/split lands", async () => {
  const { g } = mountCore();
  const condR = await settle(g.condense(["a", "b"], { id: "ab" }), g);
  assert.equal(condR.canceled, false);
  assert.equal(condR.applied, true);
  assert.deepEqual(condR.ids.created, ["ab"]);
  assert.deepEqual(condR.ids.removed.sort(), ["a", "b"]);

  const splitR = await settle(g.split("ab", { nodes: [{ id: "s1" }, { id: "s2" }] }), g);
  assert.equal(splitR.canceled, false);
  assert.equal(splitR.applied, true);
  assert.deepEqual(splitR.ids.created.sort(), ["s1", "s2"]);
  assert.deepEqual(splitR.ids.removed, ["ab"]);
  g.destroy();
});
