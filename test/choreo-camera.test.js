// F39 — `{camera}` on condense/split: the F37/F38 shot, riding the choreography's own
// converge/diverge relayout. The merged id does not exist until phase 2, so a camera step
// BEFORE the condense cannot name it, and one AFTER it starts 900ms late over a graph the
// converge already moved under an anchored viewport. Same DOM shim + manual-ticker idiom
// as test/toggle-camera.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NODES_MAX_K } from "../src/director.js";
import { CONDENSE_PHASES } from "../src/condense-anim.js";
import { SPLIT_PHASES } from "../src/split-anim.js";

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

/** a → x → y → z → b: x, y, z are the condense set. */
const spec = () => ({
  nodes: [
    { id: "a", label: "Ingest" },
    { id: "x", label: "Dedupe" },
    { id: "y", label: "Validate" },
    { id: "z", label: "Normalize" },
    { id: "b", label: "Build" },
  ],
  edges: [
    { id: "e1", source: "a", target: "x" },
    { id: "e2", source: "x", target: "y" },
    { id: "e3", source: "y", target: "z" },
    { id: "e4", source: "z", target: "b" },
  ],
});

function mountT(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec(), { ticker: "manual", layout: { dir: "LR" }, animation: { duration: 120 }, ...opts });
  return { root, g };
}

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: got ${a}, expected ${b}`);

function shotFor(box, pad = 24, maxK = NODES_MAX_K) {
  const k = Math.min(maxK, (900 - 2 * pad) / box.w, (480 - 2 * pad) / box.h);
  return { k, x: 450 - box.x * k, y: 240 - box.y * k };
}
function unionOf(res, ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const r = res.nodes[id];
    x0 = Math.min(x0, r.x - r.w / 2); y0 = Math.min(y0, r.y - r.h / 2);
    x1 = Math.max(x1, r.x + r.w / 2); y1 = Math.max(y1, r.y + r.h / 2);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
const assertAt = (g, want, msg) => {
  close(g.viewport.transform.k, want.k, `${msg} k`);
  close(g.viewport.transform.x, want.x, `${msg} x`);
  close(g.viewport.transform.y, want.y, `${msg} y`);
};
const MERGED = { id: "clean", label: "Clean (automated)" };
const PARTS = { nodes: [{ id: "c1", label: "Dedupe" }, { id: "c2", label: "Validate" }], edges: [{ id: "p", source: "c1", target: "c2" }] };

// ---------------------------------------------------------------------------

test("condense(ids, node, {camera:true}) frames the MERGED node where it lands, on the converge's own clock", async () => {
  const { g } = mountT();
  const t0 = g.viewport.transform;
  const h = g.condense(["x", "y", "z"], MERGED, { camera: true });
  // Phase 1 (highlight): nothing has merged, nothing has moved — the camera included.
  g.ticker.tick(CONDENSE_PHASES.highlight - 1); await flush();
  assert.deepEqual(g.viewport.transform, t0, "the shot waits for the id to exist");
  assert.equal(g.viewport.userMoved, false);
  // Phase 2 (converge): the store has merged, the commit is heading to a layout with `clean`.
  g.ticker.tick(2); await flush();
  assert.ok(g.layoutResult().nodes.clean, "merged node is in the layout the converge is heading to");
  assert.equal(g.viewport.userMoved, true, "taking the shot takes the camera (D13)");
  const want = shotFor(g.layoutResult().nodes.clean);
  g.ticker.tick(CONDENSE_PHASES.converge / 2); await flush();
  assert.ok(Math.abs(g.viewport.transform.x - want.x) > 1e-3, "mid-flight halfway through the converge");
  g.ticker.tick(CONDENSE_PHASES.converge / 2 + 1); await flush();
  assertAt(g, want, "landed with the converge — before the reveal phase runs");
  const r = await settle(h, g);
  assert.equal(r.applied, true);
  assert.deepEqual(r.ids.created, ["clean"]);
  assertAt(g, want, "still there after the reveal");
  g.destroy();
});

test("split(id, parts, {camera:true}) frames the UNION of the parts on the diverge's clock; {fit:true} is fitView", async () => {
  const { g } = mountT();
  const h = g.split("y", PARTS, { camera: true });
  g.ticker.tick(SPLIT_PHASES.highlight + 1); await flush();
  const want = shotFor(unionOf(g.layoutResult(), ["c1", "c2"]));
  g.ticker.tick(SPLIT_PHASES.diverge); await flush();
  assertAt(g, want, "parts union framed as the diverge lands");
  await settle(h, g);

  await settle(g.condense(["c1", "c2"], { id: "y2" }, { camera: { fit: true } }), g);
  const got = g.viewport.transform;
  g.fitView({ animate: false });
  assertAt(g, got, "the condense's fit and fitView agree");
  g.destroy();
});

test("a target that names no box frames the merged node with those options; k on the target is never lidded", async () => {
  const { g } = mountT();
  await settle(g.condense(["x", "y"], { id: "xy" }, { camera: { pad: 100 } }), g);
  assertAt(g, shotFor(g.layoutResult().nodes.xy, 100), "pad honoured, subject defaulted");
  await settle(g.condense(["xy", "z"], { id: "xyz" }, { camera: { k: 1.1 } }), g);
  close(g.viewport.transform.k, 1.1, "explicit k");
  g.destroy();
});

test("storyboard: the option rides {op:'condense'} / {op:'split'}; D13 ownership is read off args[2] at build time", async () => {
  const steps = [
    { label: "start" },
    { op: "condense", args: [["x", "y", "z"], MERGED, { camera: true }] },
    { label: "merged" },
    { op: "split", args: ["clean", PARTS, { camera: true }] },
  ];
  const { g } = mountT({ storyboard: steps });
  const sb = g.storyboard();
  const t0 = g.viewport.transform;
  await settle(sb.next(), g);
  await settle(sb.next(), g);
  const shot = g.viewport.transform;
  assertAt(g, shotFor(g.layoutResult().nodes.clean), "merged node framed");
  await settle(sb.play(), g);
  assertAt(g, shotFor(unionOf(g.layoutResult(), ["c1", "c2"])), "then the parts");
  await settle(sb.seek("merged"), g);
  g.ticker.tick(16); await flush();
  assertAt(g, shot, "seek restores the condense's shot — the viewport was in the snapshots");
  await settle(sb.seek("start"), g);
  g.ticker.tick(16); await flush();
  assertAt(g, t0, "…and the mount-time fit");
  assert.equal(g.viewport.userMoved, false);
  g.destroy();
});

test("validate() accepts the third argument; camera:false / absent keeps the anchored choreography byte-for-byte", async () => {
  const { g } = mountT();
  const { ok, errors } = g.validate([
    { op: "condense", args: [["x", "y"], { id: "xy" }, { camera: true }] },
    { op: "split", args: ["z", PARTS, { camera: { fit: true } }] },
  ]);
  assert.equal(ok, true, errors.map((e) => e.message).join("; "));
  g.destroy();

  const { g: g1 } = mountT();
  const { g: g2 } = mountT();
  await settle(g1.condense(["x", "y", "z"], MERGED), g1);
  await settle(g2.condense(["x", "y", "z"], MERGED, { camera: false }), g2);
  assert.deepEqual(g2.viewport.transform, g1.viewport.transform);
  assert.equal(g2.viewport.userMoved, false, "no shot, no ownership");
  g1.destroy(); g2.destroy();
});
