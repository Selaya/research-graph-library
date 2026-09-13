// Director fixes through mount() — the public half of F15/F16/F17/F18, which the unit
// tests in test/director.test.js and test/viewport.test.js cannot see: the chrome the
// library itself mounts is measured and subtracted, a hidden target resolves through the
// live viewstate, `camera({nodes})` carries its own maxK default, and `props(patch,
// {merge:true})` lands on the real renderer.
//
// Same hand-rolled DOM shim as test/m4-integration.test.js, plus a per-element client rect
// so the mounted transport bar can actually be measured. Every mount uses
// opts.ticker:"manual" — the one shared clock (D1) is stepped by hand.

import { test } from "node:test";
import assert from "node:assert/strict";

const PANE = { left: 0, top: 0, width: 900, height: 480 };

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "", value: "",
    rect: null,   // null = "the whole pane", which is what the shim's svg reports
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
    getBoundingClientRect() { return this.rect || PANE; },
    clientWidth: PANE.width, clientHeight: PANE.height,
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

const { mount } = await import("../src/index.js");
const { MAX_K } = await import("../src/viewport.js");

const byClass = (node, cls, out = []) => {
  if ((node.attrs.class || "").split(/\s+/).includes(cls)) out.push(node);
  for (const c of node.children) byClass(c, cls, out);
  return out;
};
const nodeEl = (root, id) => byClass(root, "smv-node").find((n) => n.attrs["data-id"] === id);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, expected ${b}`);

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Drive the manual clock until `promise` settles (the D1 idiom for opts.ticker:"manual"). */
async function settle(promise, g, maxTicks = 400, ms = 16) {
  let done = false;
  Promise.resolve(promise).then(() => { done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
}

function captureWarn(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return calls;
}

const chain = () => ({
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "c" }],
});

function mountG(spec = chain(), opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec, { ticker: "manual", animation: { duration: 120 }, ...opts });
  return { root, g };
}

/** Give the mounted transport the rect the stylesheet gives it: a 34px bar on the bottom. */
function sizeTransport(root, h = 34) {
  const bar = byClass(root, "smv-transport")[0];
  assert.ok(bar, "controls:true mounted a transport bar");
  bar.rect = { left: 0, top: PANE.height - h, width: PANE.width, height: h };
  return bar;
}

// ---------------------------------------------------------------------------
// F15 — fits dodge the chrome the library mounted over the pane.
// ---------------------------------------------------------------------------

test("g.fitView(): subtracts the mounted transport bar, so the last rank is not under it (F15)", () => {
  const { root, g } = mountG(chain(), { controls: true });
  sizeTransport(root);

  g.fitView({ animate: false });
  const withBar = g.viewport.transform;
  const b = g.layoutResult().bounds;
  // Centred in the pane MINUS the 34px bar: cy = 34/2 short of the pane centre.
  close(withBar.y, (PANE.height - 34) / 2 - (b.y + b.h / 2) * withBar.k, "fit centres above the bar");

  g.fitView({ animate: false, inset: 0 });
  const plain = g.viewport.transform;
  close(plain.y, PANE.height / 2 - (b.y + b.h / 2) * plain.k, "inset:0 is the old pane-centred fit");
  assert.ok(withBar.y < plain.y, "the shot moved UP out of the chrome");
  g.destroy();
});

test("g.fitView(): an explicit inset replaces the measurement (a host-page overlay) (F15)", () => {
  const { g } = mountG();
  g.fitView({ animate: false, inset: { top: 120 } });
  const b = g.layoutResult().bounds;
  const t = g.viewport.transform;
  close(t.y, 120 + (PANE.height - 120) / 2 - (b.y + b.h / 2) * t.k, "centred below the overlay");
  g.destroy();
});

test("g.camera({fit}) dodges the same chrome, with no per-page dy nudge (F15)", () => {
  const { root, g } = mountG(chain(), { controls: true });
  sizeTransport(root);
  const b = g.layoutResult().bounds;

  g.camera({ fit: true, dur: 0 });
  const framed = g.viewport.transform;
  close(framed.y, (PANE.height - 34) / 2 - (b.y + b.h / 2) * framed.k, "camera fit is inset too");

  g.camera({ fit: true, dur: 0, inset: 0 });
  const raw = g.viewport.transform;
  close(raw.y, PANE.height / 2 - (b.y + b.h / 2) * raw.k, "…and opts out on request");
  g.destroy();
});

test("a mount with no measurable chrome fits exactly where it always did (F15)", () => {
  const { g } = mountG();
  const b = g.layoutResult().bounds;
  const t = g.viewport.transform;   // the one auto-fit at mount
  close(t.y, PANE.height / 2 - (b.y + b.h / 2) * t.k, "pane-centred");
  close(t.x, PANE.width / 2 - (b.x + b.w / 2) * t.k, "…in x too");
  g.destroy();
});

// ---------------------------------------------------------------------------
// F16 — a collapsed descendant resolves to the ancestor drawn in its place.
// ---------------------------------------------------------------------------

const nested = () => ({
  nodes: [
    { id: "p", label: "Parent", collapsed: true },
    { id: "k1", label: "Kid 1", parent: "p" },
    { id: "k2", label: "Kid 2", parent: "p" },
    { id: "out", label: "Out" },
  ],
  edges: [{ id: "e1", source: "k2", target: "out" }],
});

test("g.camera({node}) on a collapsed child frames the container, without warning (F16)", () => {
  const { g } = mountG(nested());
  assert.equal(g.layoutResult().nodes.k1, undefined, "precondition: the child is not drawn");

  const warns = captureWarn(() => g.camera({ node: "k1", dur: 0 }));
  const viaChild = g.viewport.transform;
  assert.deepEqual(warns, [], "resolving a hidden child is documented behaviour, not misuse");

  g.camera({ node: "out", dur: 0 });
  g.camera({ node: "p", dur: 0 });
  assert.deepEqual(g.viewport.transform, viaChild, "the shot is the container's own");
  g.destroy();
});

test("g.highlight() on a collapsed child emphasises the container (F16)", () => {
  const { root, g } = mountG(nested());
  const warns = captureWarn(() => g.highlight({ nodes: ["k1"], variant: "warn" }));
  assert.deepEqual(warns, []);
  assert.equal(nodeEl(root, "p").attrs["data-emph"], "warn");

  // Expanding puts the child back on screen, and it is then targeted directly.
  g.expand("p");
  g.highlight({ nodes: ["k1"], variant: "focus" });
  assert.equal(nodeEl(root, "k1").attrs["data-emph"], "focus");
  assert.equal(nodeEl(root, "p").attrs["data-emph"], undefined, "…and the container is released");
  g.destroy();
});

test("a genuinely unknown id still warns on both channels (F16)", () => {
  const { g } = mountG(nested());
  const cam = captureWarn(() => g.camera({ node: "nope", dur: 0 }));
  assert.equal(cam.length, 1);
  assert.match(cam[0], /\[smv:camera\].*"nope"/);
  const hi = captureWarn(() => g.highlight({ nodes: ["nope"] }));
  assert.equal(hi.length, 1);
  assert.match(hi[0], /\[smv:highlight\].*"nope"/);
  g.destroy();
});

// ---------------------------------------------------------------------------
// F17 — framing two nodes is not an extreme close-up.
// ---------------------------------------------------------------------------

test("g.camera({nodes}) lids the fit at 1.5 by default; k and maxK both override it (F17)", () => {
  const { g } = mountG();
  g.camera({ nodes: ["a", "b"], dur: 0 });
  assert.equal(g.viewport.transform.k, 1.5, "the default lid");

  g.camera({ nodes: ["a", "b"], k: 2.5, dur: 0 });
  assert.equal(g.viewport.transform.k, 2.5, "an explicit k still wins");

  g.camera({ nodes: ["a", "b"], maxK: 3, dur: 0 });
  assert.ok(g.viewport.transform.k > 1.5, "…and so does an explicit maxK");

  // The union is still centred, at whatever scale survived.
  const r = g.layoutResult().nodes;
  g.camera({ nodes: ["a", "b"], dur: 0 });
  const t = g.viewport.transform;
  const cx = (Math.min(r.a.x - r.a.w / 2, r.b.x - r.b.w / 2) + Math.max(r.a.x + r.a.w / 2, r.b.x + r.b.w / 2)) / 2;
  close(t.x, PANE.width / 2 - cx * t.k, "union centred");
  g.destroy();
});

test("g.camera({node}) singular is still allowed to lean all the way in (F17)", () => {
  const { g } = mountG();
  g.camera({ node: "a", dur: 0 });
  assert.equal(g.viewport.transform.k, MAX_K, "framing ONE node is the case that wants the close-up");
  g.destroy();
});

// ---------------------------------------------------------------------------
// F18 — props merges on request.
// ---------------------------------------------------------------------------

test("g.props(patch, {merge:true}) keeps every other node's override (F18)", () => {
  const { root, g } = mountG();
  g.props({ a: { "--smv-fill": "#7c5cff" }, b: { "--smv-fill": "#0aa" } });
  assert.equal(nodeEl(root, "a").style._p["--smv-fill"], "#7c5cff");

  g.props({ c: { "--smv-fill": "#f50" } }, { merge: true });
  assert.equal(nodeEl(root, "a").style._p["--smv-fill"], "#7c5cff", "a kept its colour");
  assert.equal(nodeEl(root, "b").style._p["--smv-fill"], "#0aa", "b too");
  assert.equal(nodeEl(root, "c").style._p["--smv-fill"], "#f50", "and c joined them");

  // Default is unchanged: a bare call IS the layer.
  g.props({ c: { "--smv-fill": "#f50" } });
  assert.equal(nodeEl(root, "a").style._p["--smv-fill"], undefined, "replace still wipes the rest");
  assert.equal(nodeEl(root, "c").style._p["--smv-fill"], "#f50");

  // …and null still clears everything, merge or not.
  g.props(null);
  assert.equal(nodeEl(root, "c").style._p["--smv-fill"], undefined);
  g.destroy();
});

test("g.props(patch, {merge:true}) drops one key with null and one id with a null entry (F18)", () => {
  const { root, g } = mountG();
  g.props({ a: { "--smv-fill": "#7c5cff", "--smv-stroke": "#111" }, b: { "--smv-fill": "#0aa" } });
  g.props({ a: { "--smv-stroke": null }, b: null }, { merge: true });
  assert.equal(nodeEl(root, "a").style._p["--smv-fill"], "#7c5cff");
  assert.equal(nodeEl(root, "a").style._p["--smv-stroke"], undefined, "the key was removed from the element too");
  assert.equal(nodeEl(root, "b").style._p["--smv-fill"], undefined, "the whole entry went");
  g.destroy();
});

test("a merged layer is snapshotted state like any other (F18)", async () => {
  const { root, g } = mountG(chain(), {
    storyboard: [
      { label: "start" },
      { op: "props", args: [{ a: { "--smv-fill": "#7c5cff" } }] },
      { op: "props", args: [{ b: { "--smv-fill": "#0aa" } }, { merge: true }] },
    ],
  });
  const sb = g.storyboard();
  await settle(sb.next(), g);
  await settle(sb.next(), g);
  await settle(sb.next(), g);
  assert.equal(nodeEl(root, "a").style._p["--smv-fill"], "#7c5cff");
  assert.equal(nodeEl(root, "b").style._p["--smv-fill"], "#0aa", "the storyboard op takes the same options");
  await settle(sb.seek(2), g);
  assert.equal(nodeEl(root, "b").style._p["--smv-fill"], undefined, "a backward scrub restores the layer before it");
  assert.equal(nodeEl(root, "a").style._p["--smv-fill"], "#7c5cff");
  g.destroy();
});
