// M2 verify findings — a live run surviving the mutations and the storyboard machinery
// that index.js can point at it, driven through the fully public API (mount / g.run
// {mode:'live'} / g.condense / g.split / g.storyboard) rather than the transport alone.
// Same hand-rolled DOM shim + manual rAF pump as test/m2-integration.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

function matchesSel(el, sel) {
  if (sel[0] === ".") return (el.attrs.class || "").split(/\s+/).includes(sel.slice(1));
  const m = /^([a-zA-Z0-9-]*)(?:\[([^\]]+)\])?$/.exec(sel);
  if (m && m[2]) {
    const [k, v] = m[2].split("=");
    if (m[1] && el.tagName !== m[1]) return false;
    const want = v == null ? null : v.replace(/^["']|["']$/g, "");
    return want == null ? el.attrs[k] !== undefined : el.attrs[k] === want;
  }
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
async function settle(promise, maxFrames = 4000) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxFrames && !done; i++) await pump(1);
  assert.ok(done, "awaited work settled within the frame budget");
  return out;
}


const { mount } = await import("../src/index.js");

function mountSpec(spec, opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  doc.activeElement = null;
  const g = mount(root, spec, { layout: { dir: "LR" }, animation: { duration: 60 }, ...opts });
  return { root, g };
}

const chain = () => ({
  nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }, { id: "C", label: "C" }],
  edges: [{ id: "ab", source: "A", target: "B" }, { id: "bc", source: "B", target: "C" }],
});

// ---------------------------------------------------------------------------
// Findings 3 + 4 — g.condense()/g.split() during a live run keep the run's history.
// ---------------------------------------------------------------------------

test("g.condense() during a live run keeps the tokens and the history it had earned", async () => {
  const { g } = mountSpec(chain());
  const run = g.run({ mode: "live", hopMs: 100 });
  const remaps = [];
  run.on("remap", (e) => remaps.push(e));

  await pump(2);
  run.start("A");
  await pump(2);
  run.finish("A");
  await pump(20); // the hop lands on B
  const before = run.state();
  assert.equal(before.nodes.B.occupancy, 1);
  assert.equal(before.tokens.length, 1);
  assert.equal(before.done, false);

  await settle(g.condense(["A"], { id: "A2", label: "A2" }));

  const after = run.state();
  assert.equal(after.nodes.B.occupancy, 1, "the token that had landed on B is still there");
  assert.equal(after.tokens.length, 1, "…and it is still a token, not a silent deletion");
  assert.equal(after.nodes.A2.status, "done", "the merged node inherited A's history");
  assert.equal(after.done, false, "the run did not flip to done mid-pipeline");
  assert.equal(remaps.length, 1, "…and the remap was announced, as in Mode A");
  assert.equal(remaps[0].target, "A2");
  g.destroy();
});

test("g.split() during a live run hands the history to the entry part", async () => {
  const { g } = mountSpec(chain());
  const run = g.run({ mode: "live", hopMs: 100 });
  await pump(2);
  run.start("B");
  await pump(2);
  assert.equal(run.state().nodes.B.status, "active");

  await settle(g.split("B", {
    nodes: [{ id: "b1", label: "b1" }, { id: "b2", label: "b2" }],
    edges: [{ id: "b1b2", source: "b1", target: "b2" }],
  }));

  const st = run.state();
  assert.equal(st.nodes.b1.status, "active", "the entry part is where B's history landed");
  assert.equal(st.nodes.b2.status, "pending");
  assert.equal(st.done, false);
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 9 — a storyboard snapshot/restore must not delete a live run's log.
// ---------------------------------------------------------------------------

test("a storyboard restore leaves a coexisting live run's history intact", async () => {
  const { g } = mountSpec(chain());
  const run = g.run({ mode: "live" });
  await pump(2);
  run.start("A", { at: 0 });
  run.finish("A", { at: 10 });
  await pump(4);
  assert.equal(run.log().length, 2);

  const sb = g.storyboard([
    { op: "update", args: ["A", { label: "A1" }] },
    { op: "update", args: ["A", { label: "A2" }] },
  ]);
  await settle(sb.next());
  await settle(sb.next());
  await settle(sb.seek(0)); // host.restore() -> runCtl.reset(runOpts, runTime)

  assert.equal(g.run(), run, "the same transport object survived the restore (G2)");
  assert.equal(run.log().length, 2, "the live run's event log survived the round trip");
  assert.ok(run.now() >= 10, "…and so did enough frontier to reach it");
  g.destroy();
});
