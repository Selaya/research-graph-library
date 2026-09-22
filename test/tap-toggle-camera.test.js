// F41 — `interaction: {tapToggle: {camera}}`: the reader's tap (and, through the same
// readerToggle, Enter/Space) frames what it opens, with the F37 option a script would
// give expand(). The keyboard path is covered in test/a11y.test.js (the shim's svg has no
// querySelectorAll, so attachA11y is a no-op under a real mount here). Same DOM shim +
// manual-ticker idiom as test/toggle-camera.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NODES_MAX_K } from "../src/director.js";

// ---------------------------------------------------------------------------
// DOM shim (integration.test.js's makeEl, verbatim).
// ---------------------------------------------------------------------------

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

async function settle(promise, g, maxTicks = 800, ms = 16) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
  return out;
}
const run = async (g, ticks = 12) => { for (let i = 0; i < ticks; i++) { g.ticker.tick(16); await flush(); } };

const fire = (el, type, ev = {}) => { for (const fn of el.listeners[type] || []) fn(ev); };
function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));
/** A clean tap on the box of node `id` — pointerdown on the element, pointerup on the svg
 *  (the viewport's pointer capture retargets it there), no travel. */
function tap(g, id) {
  const el = byClass(g.renderer.node(id), "smv-node-box")[0];
  fire(g.renderer.svg, "pointerdown", { target: el, clientX: 100, clientY: 100, pointerId: 7 });
  fire(g.renderer.svg, "pointerup", { target: g.renderer.svg, clientX: 100, clientY: 100, pointerId: 7 });
}

/** a → [c: x, y, z] → b, with c collapsed at mount. */
const spec = () => ({
  nodes: [
    { id: "a", label: "Ingest" },
    { id: "c", label: "Clean", collapsed: true },
    { id: "c.x", parent: "c", label: "Dedupe" },
    { id: "c.y", parent: "c", label: "Validate" },
    { id: "c.z", parent: "c", label: "Normalize" },
    { id: "b", label: "Build" },
  ],
  edges: [
    { id: "e1", source: "a", target: "c" },
    { id: "e2", source: "c", target: "b" },
    { id: "e3", source: "c.x", target: "c.y" },
    { id: "e4", source: "c.y", target: "c.z" },
  ],
});

const DUR = 120;
function mountT(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec(), { ticker: "manual", layout: { dir: "LR" }, animation: { duration: DUR }, ...opts });
  return { root, g };
}

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: got ${a}, expected ${b}`);
function shotFor(box, pad = 24, maxK = NODES_MAX_K) {
  const k = Math.min(maxK, (900 - 2 * pad) / box.w, (480 - 2 * pad) / box.h);
  return { k, x: 450 - box.x * k, y: 240 - box.y * k };
}
const assertAt = (g, want, msg) => {
  close(g.viewport.transform.k, want.k, `${msg} k`);
  close(g.viewport.transform.x, want.x, `${msg} x`);
  close(g.viewport.transform.y, want.y, `${msg} y`);
};

// ---------------------------------------------------------------------------

test("tapToggle:{camera:true} — a tap opens the container AND frames the opened box, on the toggle's clock", async () => {
  const { g } = mountT({ interaction: { tapToggle: { camera: true } } });
  assert.equal(g.viewport.userMoved, false);
  tap(g, "c");
  assert.ok(g.layoutResult().nodes["c.x"], "opened");
  const want = shotFor(g.layoutResult().nodes.c);
  assert.equal(g.viewport.userMoved, true, "the reader moved the camera: auto-refit is off from here, as after a pan");
  g.ticker.tick(DUR / 2); await flush();
  assert.ok(Math.abs(g.viewport.transform.x - want.x) > 1e-3, "mid-flight halfway through the expand");
  await run(g);
  assertAt(g, want, "framed where the opened box landed");

  tap(g, "c");
  await run(g);
  assert.equal(g.layoutResult().nodes["c.x"], undefined, "closed again");
  assertAt(g, shotFor(g.layoutResult().nodes.c), "the second tap frames the closed box, lidded like a nodes[] union");
  g.destroy();
});

test("the object form is a target of its own: {camera:{pad:60}} frames the container at that pad; {fit:true} is fitView", async () => {
  const { g } = mountT({ interaction: { tapToggle: { camera: { pad: 60 } } } });
  tap(g, "c"); await run(g);
  assertAt(g, shotFor(g.layoutResult().nodes.c, 60), "pad honoured");
  g.destroy();

  const { g: g2 } = mountT({ interaction: { tapToggle: { camera: { fit: true } } } });
  tap(g2, "c"); await run(g2);
  const got = g2.viewport.transform;
  g2.fitView({ animate: false });
  assertAt(g2, got, "the tap's fit and fitView agree");
  g2.destroy();
});

test("D13: a tap's shot never takes the camera from a storyboard — a later pan survives a backward seek; a scripted shot would not", async () => {
  const steps = [{ label: "s" }, { op: "addNode", args: [{ id: "d" }] }, { op: "removeNode", args: ["d"] }];
  const { g } = mountT({ interaction: { tapToggle: { camera: true } }, storyboard: steps });
  const sb = g.storyboard();
  tap(g, "c"); await run(g);
  await settle(sb.next(), g); await settle(sb.next(), g);
  g.viewport.moveTo({ x: 7, y: 7, k: 0.5 }, { duration: 0 });     // the reader pans between two steps
  await settle(sb.seek("s"), g);
  g.ticker.tick(16); await flush();
  close(g.viewport.transform.k, 0.5, "the pan is still there: the viewport was never in the snapshots");
  g.destroy();

  // Same story, but the container is opened by the SCRIPT with the same option.
  const { g: g2 } = mountT({ storyboard: steps });
  const sb2 = g2.storyboard();
  await settle(g2.expand("c", { camera: true }), g2);
  await settle(sb2.next(), g2); await settle(sb2.next(), g2);
  g2.viewport.moveTo({ x: 7, y: 7, k: 0.5 }, { duration: 0 });
  await settle(sb2.seek("s"), g2);
  g2.ticker.tick(16); await flush();
  assert.ok(Math.abs(g2.viewport.transform.k - 0.5) > 1e-3, "the script owns the camera, so the seek restores its shot");
  g2.destroy();
});

test("tapToggle:true (the default) is unchanged: a tap is byte-for-byte a bare g.expand(id)", async () => {
  const { g: g1 } = mountT();
  const { g: g2 } = mountT({ interaction: { tapToggle: true } });
  await settle(g1.expand("c"), g1);
  tap(g2, "c"); await run(g2, 20);
  assert.deepEqual(g2.viewport.transform, g1.viewport.transform);
  assert.equal(g2.viewport.userMoved, false, "no shot, no move");
  assert.ok(g2.layoutResult().nodes["c.x"], "…but it did open");
  g1.destroy(); g2.destroy();
});

test("a tap on a leaf never frames — the container check stays in interact.js", async () => {
  const { g } = mountT({ interaction: { tapToggle: { camera: true } } });
  const t0 = g.viewport.transform;
  tap(g, "a"); await run(g);
  assert.deepEqual(g.viewport.transform, t0);
  assert.equal(g.viewport.userMoved, false);
  g.destroy();
});
