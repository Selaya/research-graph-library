// F38 — `{camera}` on every relayout-producing mutation (addNode/addEdge/removeNode/
// removeEdge/update/layout): the F37 shape, generalised. "Add this and show me it" was a
// batch(addNode, addEdge) step followed by a separate camera({nodes:[prev, id]}) step —
// two tweens, the second of which could only start once the node had already bloomed
// wherever the anchored viewport left it. Same DOM shim + manual-ticker idiom as
// test/toggle-camera.test.js.

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

/** a → b → c, plus a collapsed container k: [k.x, k.y] hanging off c. */
const spec = () => ({
  nodes: [
    { id: "a", label: "Ingest" },
    { id: "b", label: "Build" },
    { id: "c", label: "Test" },
    { id: "k", label: "Ship", collapsed: true },
    { id: "k.x", parent: "k", label: "Stage" },
    { id: "k.y", parent: "k", label: "Prod" },
  ],
  edges: [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "c" },
    { id: "e3", source: "c", target: "k" },
    { id: "e4", source: "k.x", target: "k.y" },
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
/** The union box of `ids` in a layout result, centre-origin like the nodes themselves. */
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
const assertFit = (g, msg) => {
  const got = g.viewport.transform;
  g.fitView({ animate: false });
  assertAt(g, got, msg);
};

// ---------------------------------------------------------------------------

test("addNode(node, {camera:true}) frames the NEW node against the post-add layout, on the add's own clock", async () => {
  const { g } = mountT();
  assert.equal(g.viewport.userMoved, false);
  const h = g.addNode({ id: "d", label: "Deploy" }, { camera: true });
  // Resolved against the layout the commit is heading to — `d` exists there already.
  const want = shotFor(g.layoutResult().nodes.d);
  assert.equal(g.viewport.userMoved, true, "a mutation that composes a shot takes the camera (D13)");
  g.ticker.tick(DUR / 2); await flush();
  assert.ok(Math.abs(g.viewport.transform.x - want.x) > 1e-3, "still moving halfway through the add");
  g.ticker.tick(DUR / 2); await flush();
  const r = await settle(h, g, 2);
  assert.deepEqual(r, { canceled: false, applied: true });
  assertAt(g, want, "new node centred + fitted, lidded at the union lid");
  g.destroy();
});

test("addNode with {after} frames the new node AND the one it hangs off", async () => {
  const { g } = mountT();
  await settle(g.addNode({ id: "d", label: "Deploy" }, { after: "c", camera: true }), g);
  assertAt(g, shotFor(unionOf(g.layoutResult(), ["c", "d"])), "[after, id] union");
  g.destroy();
});

test("addEdge(edge, {camera:true}) frames the two endpoints; a collapsed endpoint resolves to its drawn ancestor (F16)", async () => {
  const { g } = mountT();
  await settle(g.addEdge({ id: "e5", source: "a", target: "k.y" }, { camera: true }), g);
  // k.y is hidden inside k, so the union is a ∪ k.
  assertAt(g, shotFor(unionOf(g.layoutResult(), ["a", "k"])), "endpoint union through the container");
  g.destroy();
});

test("removeNode / removeEdge with {camera:true} fit what is LEFT, in the remove's own tween", async () => {
  const { g } = mountT();
  g.viewport.moveTo({ x: 5, y: 5, k: 0.5 }, { duration: 0 });
  const r = await settle(g.removeNode("k", { camera: true }), g);
  assert.deepEqual(r.ids.nodes.sort(), ["k", "k.x", "k.y"]);
  assertFit(g, "removeNode's shot is the fit of the remaining graph");

  g.viewport.moveTo({ x: 5, y: 5, k: 0.5 }, { duration: 0 });
  await settle(g.removeEdge("e2", { camera: true }), g);
  assertFit(g, "removeEdge's shot is the fit too");
  g.destroy();
});

test("update(id, patch, {camera:true}) frames the node at the width it is HEADING to", async () => {
  const { g } = mountT();
  const before = g.layoutResult().nodes.b.w;
  await settle(g.update("b", { label: "Build every platform in the matrix" }, { camera: true }), g);
  const after = g.layoutResult().nodes.b;
  assert.ok(after.w > before + 1, `the relabel widened the box (${before} → ${after.w})`);
  assertAt(g, shotFor(after), "framed at the new width, not the old");
  g.destroy();
});

test("a target that names no box frames the subject; {node}/{nodes}/{fit} are shots of their own", async () => {
  const { g } = mountT();
  await settle(g.addNode({ id: "d" }, { camera: { pad: 60 } }), g);
  assertAt(g, shotFor(g.layoutResult().nodes.d, 60), "pad honoured, subject defaulted");
  await settle(g.addNode({ id: "f" }, { camera: { node: "a" } }), g);
  assertAt(g, shotFor(g.layoutResult().nodes.a), "an explicit node wins over the subject");
  await settle(g.removeNode("f", { camera: { nodes: ["a", "b"] } }), g);
  assertAt(g, shotFor(unionOf(g.layoutResult(), ["a", "b"])), "nodes[] on a remove");
  g.destroy();
});

test("layout(o, {camera:true}) fits the re-laid graph; without it a script-owned camera is left stale", async () => {
  const { g: g1 } = mountT();
  // The script owns the camera (D13) — from here on relayout never auto-refits.
  await settle(g1.camera({ node: "a", dur: 50 }), g1);
  const k = g1.viewport.transform.k;
  await settle(g1.layout({ dir: "TB" }), g1);
  // The friction: D10 anchors the old centroid and never refits over an owned camera, so
  // the direction change re-flows the drawing under a close-up composed for LR.
  close(g1.viewport.transform.k, k, "no refit: the scale is the close-up's");
  assert.equal(g1.viewport.contains(g1.bounds()), false, "…and the TB drawing runs off the pane");
  g1.destroy();

  const { g: g2 } = mountT();
  await settle(g2.camera({ node: "a", dur: 50 }), g2);
  await settle(g2.layout({ dir: "TB" }, { camera: true }), g2);
  assert.equal(g2.layoutResult().nodes.b.x, g2.layoutResult().nodes.a.x, "TB: a and b share a column");
  assertFit(g2, "the relayout's own shot is the fit of the TB drawing");
  g2.destroy();
});

test("inside batch(): a child's shot is composed against the batch's ONE commit — the seq-diagram idiom", async () => {
  const { g } = mountT();
  const commits = [];
  g.on("commit", (e) => commits.push(e));
  const h = g.batch((b) => {
    b.addNode({ id: "d", label: "Deploy" }, { camera: { nodes: ["c", "d"] } });
    b.addEdge({ id: "e5", source: "c", target: "d" });
  });
  assert.equal(commits.length, 1, "one relayout for both ops");
  await settle(h, g);
  assertAt(g, shotFor(unionOf(g.layoutResult(), ["c", "d"])), "[prev, new] framed where the batch's layout put them");
  g.destroy();
});

test("the shot rides a storyboard step's `dur`; D13 ownership is detected off an addNode's args at build time", async () => {
  const steps = [
    { label: "start" },
    { op: "batch", steps: [
      { op: "addNode", args: [{ id: "d", label: "Deploy" }, { camera: { nodes: ["c", "d"] } }] },
      { op: "addEdge", args: [{ id: "e5", source: "c", target: "d" }] },
    ], dur: 400 },
    { label: "added" },
    { op: "removeEdge", args: ["e1"] },
  ];
  const { g } = mountT({ storyboard: steps });
  const sb = g.storyboard();
  const t0 = g.viewport.transform;
  await settle(sb.next(), g);       // start
  const p = sb.next();              // the batch
  await flush();
  const want = shotFor(unionOf(g.layoutResult(), ["c", "d"]));
  g.ticker.tick(200); await flush();
  assert.ok(Math.abs(g.viewport.transform.x - want.x) > 1e-3, "mid-flight at 200 of 400");
  g.ticker.tick(200); await flush();
  await settle(p, g, 3);
  assertAt(g, want, "landed with the 400ms step");
  await settle(sb.play(), g);       // removeEdge — the camera stays where the script put it
  await settle(sb.seek("start"), g);
  g.ticker.tick(16); await flush();
  assertAt(g, t0, "seek to 'start' restores the mount-time fit — the viewport was in the snapshots");
  assert.equal(g.viewport.userMoved, false);
  g.destroy();
});

test("validate() accepts the option on every op; camera:false / absent keeps the anchored D10 path byte-for-byte", async () => {
  const { g } = mountT();
  const { ok, errors } = g.validate([
    { op: "addNode", args: [{ id: "d" }, { after: "c", camera: true }] },
    { op: "addEdge", args: [{ id: "e5", source: "a", target: "d" }, { camera: true }] },
    { op: "update", args: ["a", { label: "In" }, { camera: { pad: 40 } }] },
    { op: "removeEdge", args: ["e5", { camera: true }] },
    { op: "removeNode", args: ["d", { camera: { fit: true } }] },
    { op: "layout", args: [{ dir: "TB" }, { camera: true }] },
  ]);
  assert.equal(ok, true, errors.map((e) => e.message).join("; "));
  g.destroy();

  const { g: g1 } = mountT();
  const { g: g2 } = mountT();
  await settle(g1.addNode({ id: "d" }), g1);
  await settle(g2.addNode({ id: "d" }, { camera: false }), g2);
  assert.deepEqual(g2.viewport.transform, g1.viewport.transform);
  assert.equal(g2.viewport.userMoved, false, "no shot, no ownership");
  g1.destroy(); g2.destroy();
});
