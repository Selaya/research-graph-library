// F37 — `{camera}` on expand/collapse/expandAll/collapseAll (and update's `collapsed` route):
// a shot resolved against the layout the toggle PRODUCES, flown on the toggle's own clock.
// The pattern this replaces — camera({node}) at the collapsed stub, expand(), then a second
// camera to fit the overflow — is what every script-writing agent reached for, and it reads
// as a zoom-in / spill / zoom-out stutter. Same DOM shim + manual-ticker idiom as
// test/m4-integration.test.js.

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

/** The transform that frames `box` (a layout node) centred in the 900×480 pane at `pad`,
 *  lidded at `maxK` — what resolveCameraTarget computes for a box target. */
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

test("expand(id, {camera:true}) frames the OPENED container, on the expand's own clock", async () => {
  const { g } = mountT();
  const stub = g.layoutResult().nodes.c;
  assert.equal(g.viewport.userMoved, false);

  const h = g.expand("c", { camera: true });
  // Resolved against the layout the commit is heading to — the opened box is wider than
  // the stub the camera could see a moment ago.
  const opened = g.layoutResult().nodes.c;
  assert.ok(opened.w > stub.w + 1, `opened box (${opened.w}) is wider than the stub (${stub.w})`);
  assert.equal(g.viewport.userMoved, true, "a toggle that composes a shot takes the camera (D13)");

  const want = shotFor(opened);
  assert.ok(Math.abs(want.x - g.viewport.transform.x) > 1, "the shot is somewhere else than the mount fit");

  // Mid-flight at half the MUTATION's duration: neither where it started nor where it ends.
  g.ticker.tick(DUR / 2); await flush();
  assert.ok(Math.abs(g.viewport.transform.x - want.x) > 1e-3, "still moving halfway through the expand");
  // Landed exactly when the expand lands — a g.camera() default (600ms) would still be in flight.
  g.ticker.tick(DUR / 2); await flush();
  const r = await settle(h, g, 2);
  assert.deepEqual(r, { canceled: false, applied: true });
  assertAt(g, want, "opened box centred + fitted");
  g.destroy();
});

test("the shot rides a storyboard step's `dur`, not the camera default", async () => {
  const steps = [{ op: "expand", args: ["c", { camera: true }], dur: 400 }];
  const { g } = mountT({ storyboard: steps });
  const sb = g.storyboard();
  const p = sb.play();
  await flush();
  const want = shotFor(g.layoutResult().nodes.c);
  g.ticker.tick(200); await flush();
  assert.ok(Math.abs(g.viewport.transform.x - want.x) > 1e-3, "mid-flight at 200 of 400");
  g.ticker.tick(200); await flush();
  await settle(p, g, 3);
  assertAt(g, want, "landed with the 400ms step");
  g.destroy();
});

test("camera:{fit:true} frames the whole opened graph — exactly what fitView() would", async () => {
  const { g } = mountT();
  await settle(g.expand("c", { camera: { fit: true } }), g);
  const got = g.viewport.transform;
  g.fitView({ animate: false });
  assertAt(g, got, "the toggle's fit and fitView agree");
  g.destroy();
});

test("a target that names no box frames the toggled id: camera:{pad:60}", async () => {
  const { g } = mountT();
  await settle(g.expand("c", { camera: { pad: 60 } }), g);
  assertAt(g, shotFor(g.layoutResult().nodes.c, 60), "pad honoured, node defaulted");
  g.destroy();
});

test("camera:{node} / {nodes} / explicit k on the option are targets in their own right", async () => {
  const { g } = mountT();
  await settle(g.expand("c", { camera: { nodes: ["c.x", "b"] } }), g);
  const n = g.layoutResult().nodes;
  const x0 = Math.min(n["c.x"].x - n["c.x"].w / 2, n.b.x - n.b.w / 2);
  const x1 = Math.max(n["c.x"].x + n["c.x"].w / 2, n.b.x + n.b.w / 2);
  const y0 = Math.min(n["c.x"].y - n["c.x"].h / 2, n.b.y - n.b.h / 2);
  const y1 = Math.max(n["c.x"].y + n["c.x"].h / 2, n.b.y + n.b.h / 2);
  assertAt(g, shotFor({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }), "union box");

  await settle(g.collapse("c", { camera: { k: 3 } }), g);
  close(g.viewport.transform.k, 3, "an explicit k is a scale request, never lidded");
  g.destroy();
});

test("collapse(id, {camera:true}) frames the CLOSED box, lidded at NODES_MAX_K like a nodes[] union", async () => {
  const { g } = mountT();
  await settle(g.expand("c"), g);
  await settle(g.collapse("c", { camera: true }), g);
  const stub = g.layoutResult().nodes.c;
  const raw = Math.min((900 - 48) / stub.w, (480 - 48) / stub.h);
  assert.ok(raw > NODES_MAX_K, "a lone stub would fit far past the lid…");
  assertAt(g, shotFor(stub), "…and is framed at the lid instead of as a close-up");
  g.destroy();
});

test("a no-op toggle that carries a shot still flies the camera and resolves applied:false", async () => {
  const { g } = mountT();
  await settle(g.expand("c"), g);
  const before = g.viewport.transform;
  const r = await settle(g.expand("c", { camera: true }), g);
  assert.deepEqual(r, { canceled: false, applied: false });
  assertAt(g, shotFor(g.layoutResult().nodes.c), "framed anyway — 'show me this open' is idempotent");
  assert.notDeepEqual(g.viewport.transform, before);

  // …and without a shot, the no-op stays a no-op for the camera too.
  const still = g.viewport.transform;
  assert.deepEqual(await settle(g.expand("c"), g), { canceled: false, applied: false });
  assert.deepEqual(g.viewport.transform, still);
  g.destroy();
});

test("update(id, {collapsed}, {camera}) routes the shot through expand()/collapse()", async () => {
  const { g } = mountT();
  const r = await settle(g.update("c", { collapsed: false }, { camera: true }), g);
  assert.equal(r.applied, true);
  assertAt(g, shotFor(g.layoutResult().nodes.c), "opened via update, framed");
  g.destroy();
});

test("expandAll({camera:true}) fits the whole opened graph; collapseAll likewise", async () => {
  const { g } = mountT();
  await settle(g.expandAll({ camera: true }), g);
  assert.ok(g.layoutResult().nodes["c.x"], "c is open");
  let got = g.viewport.transform;
  g.fitView({ animate: false });
  assertAt(g, got, "expandAll's shot is the fit");

  g.viewport.moveTo({ x: 5, y: 5, k: 0.5 }, { duration: 0 });
  await settle(g.collapseAll({ camera: true }), g);
  got = g.viewport.transform;
  g.fitView({ animate: false });
  assertAt(g, got, "collapseAll's shot is the fit of the closed graph");
  g.destroy();
});

test("inside batch(): the shot is composed against the batch's ONE commit, not the toggle alone", async () => {
  const { g } = mountT();
  const commits = [];
  g.on("commit", (e) => commits.push(e));
  const h = g.batch((b) => {
    b.expand("c", { camera: true });
    b.addNode({ id: "d", label: "Deploy" });
    b.addEdge({ id: "e5", source: "b", target: "d" });
  });
  assert.equal(commits.length, 1, "one relayout for the three ops");
  await settle(h, g);
  assert.ok(g.layoutResult().nodes.d, "d landed in the same commit");
  assertAt(g, shotFor(g.layoutResult().nodes.c), "c framed where the post-batch layout put it");
  g.destroy();
});

test("D13: a storyboard whose only camera work is a toggle's {camera} owns the viewport — a backward seek restores the shot", async () => {
  const steps = [
    { label: "start" },
    { op: "expand", args: ["c", { camera: true }] },
    { label: "open" },
    { op: "collapse", args: ["c"] },
    { op: "addNode", args: [{ id: "d" }] },
  ];
  const { g } = mountT({ storyboard: steps });
  const sb = g.storyboard();
  const t0 = g.viewport.transform;

  await settle(sb.next(), g);       // start (label)
  await settle(sb.next(), g);       // expand + shot
  const shot = g.viewport.transform;
  assertAt(g, shotFor(g.layoutResult().nodes.c), "shot landed");
  await settle(sb.play(), g);       // collapse, addNode — the camera stays where the script put it
  assert.equal(g.viewport.userMoved, true);

  await settle(sb.seek("open"), g);
  g.ticker.tick(16); await flush();
  assertAt(g, shot, "seek to 'open' restores the shot the expand composed");

  await settle(sb.seek("start"), g);
  g.ticker.tick(16); await flush();
  assertAt(g, t0, "seek to 'start' restores the mount-time fit");
  assert.equal(g.viewport.userMoved, false, "…and hands the camera back");
  g.destroy();
});

test("validate() accepts the option, and a bad key on the target only warns, as g.camera() does", async () => {
  const { g } = mountT();
  const { ok, errors } = g.validate([
    { op: "expand", args: ["c", { camera: true }] },
    { op: "expandAll", args: [{ camera: { fit: true } }] },
    { op: "update", args: ["c", { collapsed: true }, { camera: true }] },
  ]);
  assert.equal(ok, true, errors.map((e) => e.message).join("; "));

  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try { await settle(g.expand("c", { camera: { nod: "b" } }), g); }
  finally { console.warn = orig; }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[smv:camera\].*unrecognized key "nod"/);
  assertAt(g, shotFor(g.layoutResult().nodes.c), "the typo is ignored and the toggled id is framed");
  g.destroy();
});

test("camera:false / absent keeps the anchored D10 behaviour byte-for-byte", async () => {
  const { g: g1 } = mountT();
  const { g: g2 } = mountT();
  await settle(g1.expand("c"), g1);
  await settle(g2.expand("c", { camera: false }), g2);
  assert.deepEqual(g2.viewport.transform, g1.viewport.transform);
  assert.equal(g2.viewport.userMoved, false, "no shot, no ownership");
  g1.destroy(); g2.destroy();
});
