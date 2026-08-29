// M2 verify findings — a11y focus tracking, live-run announcement, decoration hiding, and
// tree/table coordination. Driven through the real mount() against the same hand-rolled
// DOM shim test/m2-integration.test.js uses (it models focus()/activeElement, which is
// exactly what these findings turn on).

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

const fire = (el, type, ev) => { for (const fn of [...(el.listeners[type] || [])]) fn(ev); };

const { mount } = await import("../src/index.js");
const { attachA11yTable } = await import("../src/a11y-table.js");
const { readingOrder } = await import("../src/a11y.js");

function mountSpec(spec, opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  doc.activeElement = null;
  const g = mount(root, spec, { layout: { dir: "LR" }, animation: { duration: 60 }, ...opts });
  return { root, g };
}

const nested = () => ({
  nodes: [
    { id: "in", label: "Ingest" },
    { id: "box", label: "Box", collapsed: true },
    { id: "box.a", parent: "box", label: "A" },
    { id: "box.b", parent: "box", label: "B" },
    { id: "out", label: "Out" },
  ],
  edges: [
    { id: "e1", source: "in", target: "box.a", label: "feed" },
    { id: "e2", source: "box.a", target: "box.b" },
    { id: "e3", source: "box.b", target: "out" },
  ],
});

const nodeEl = (g, id) => g.renderer.svg.querySelectorAll(".smv-node").find((el) => el.getAttribute("data-id") === id);
const rovingId = (g) => {
  const el = g.renderer.svg.querySelectorAll(".smv-node").find((e) => e.getAttribute("tabindex") === "0");
  return el ? el.getAttribute("data-id") : null;
};

// ---------------------------------------------------------------------------
// Finding 6 — focus arriving by any route other than a11y.js's own key handler must
// still be what Enter/Space and the arrows act on.
// ---------------------------------------------------------------------------

test("a11y: focus arriving from outside (click/.focus()) syncs the roving current item", async () => {
  const { g } = mountSpec(nested());
  const svg = g.renderer.svg;
  const ids = readingOrder(g.layoutResult());
  assert.ok(ids.length >= 3);
  const target = ids[ids.length - 1]; // deliberately NOT the initial roving stop
  assert.notEqual(target, ids[0]);

  const el = nodeEl(g, target);
  el.focus(); // what a mouse click does in a real browser
  fire(svg, "focusin", { target: el });

  assert.equal(rovingId(g), target, "the roving tabindex followed the real focus");

  fire(svg, "keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(doc.activeElement.getAttribute("data-id"), ids[ids.length - 2],
    "ArrowLeft moved from where focus actually was, not from a stale id");
  g.destroy();
});

test("a11y: Enter toggles the container the user actually focused", async () => {
  const { g } = mountSpec(nested());
  const svg = g.renderer.svg;
  const ids = readingOrder(g.layoutResult());
  assert.notEqual(ids[0], "box", "the container is not already the default roving stop");

  const el = nodeEl(g, "box");
  el.focus();
  fire(svg, "focusin", { target: el });
  fire(svg, "keydown", { key: "Enter", preventDefault() {} });
  await settle(Promise.resolve());

  assert.equal(g.viewstate.collapsed.has("box"), false, "Enter expanded the focused container");
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 7 — a structural commit that removes the focused node must re-home focus
// inside the widget instead of dropping it on <body>.
// ---------------------------------------------------------------------------

test("a11y: focus is re-homed when the focused node is removed by a commit", async () => {
  const { g } = mountSpec(nested());
  const svg = g.renderer.svg;
  await settle(g.expandAll());

  const child = nodeEl(g, "box.b");
  assert.ok(child, "the child is on screen while expanded");
  child.focus();
  fire(svg, "focusin", { target: child });
  assert.equal(doc.activeElement, child);

  await settle(g.collapseAll()); // box.b is no longer a visible node

  const active = doc.activeElement;
  assert.ok(active && active.getAttribute && active.getAttribute("data-id") != null,
    "focus stayed inside the graph instead of falling to the document body");
  assert.equal(active.getAttribute("data-id"), rovingId(g),
    "and it landed on the element that now holds the roving tabindex");
  assert.notEqual(active.getAttribute("data-id"), "box.b");
  g.destroy();
});

test("a11y: a commit does NOT steal focus when the widget never had it", async () => {
  const { g } = mountSpec(nested());
  const outside = makeEl("button");
  outside.ownerDocument = doc;
  outside.focus();
  await settle(g.expandAll());
  assert.equal(doc.activeElement, outside, "an unrelated commit leaves outside focus alone");
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 12 — live/simulated run state must reach the accessible name.
// ---------------------------------------------------------------------------

test("a11y: aria-label follows live run status, not just the static spec", async () => {
  const { g } = mountSpec({
    nodes: [{ id: "ingest", label: "Ingest" }, { id: "ship", label: "Ship" }],
    edges: [{ id: "e", source: "ingest", target: "ship" }],
  });
  const run = g.run({ mode: "live" });
  await pump(2);

  const el = nodeEl(g, "ingest");
  assert.equal(el.getAttribute("aria-label"), "Ingest");

  run.start("ingest");
  await pump(2);
  assert.equal(el.getAttribute("data-run"), "active");
  assert.equal(el.getAttribute("aria-label"), "Ingest · active", "a screen reader hears the node start");

  run.finish("ingest");
  await pump(2);
  assert.equal(el.getAttribute("aria-label"), "Ingest · done", "…and hears it finish");
  g.destroy();
});

test("a11y: the spec's own data.status still drives aria-label with no run attached", () => {
  const { g } = mountSpec({ nodes: [{ id: "A", label: "A", data: { status: "queued" } }], edges: [] });
  assert.equal(nodeEl(g, "A").getAttribute("aria-label"), "A · queued");
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 13 — decorations are not standalone accessible text.
// ---------------------------------------------------------------------------

test("a11y: run decorations and edge labels are hidden from the accessibility tree", async () => {
  const { g } = mountSpec(nested());
  g.run({ mode: "live" });
  await pump(2);

  const tokens = g.renderer.svg.querySelector(".smv-tokens");
  assert.ok(tokens, "the decoration layer exists");
  assert.equal(tokens.getAttribute("aria-hidden"), "true");

  const label = g.renderer.svg.querySelector(".smv-edge-label");
  assert.ok(label, "the labeled edge rendered its text");
  assert.equal(label.getAttribute("aria-hidden"), "true");

  const badge = g.renderer.svg.querySelector(".smv-node-badge");
  assert.ok(badge, "the collapsed container rendered its count badge");
  assert.equal(badge.getAttribute("aria-hidden"), "true");
  g.destroy();
});

// ---------------------------------------------------------------------------
// Finding 14 — the interactive tree and the linearized table must not both be announced.
// ---------------------------------------------------------------------------

test("a11y-table: the fallback table is hidden from AT while the interactive tree is on", () => {
  const { g } = mountSpec(nested());
  const t = attachA11yTable(g, { visible: false });
  assert.equal(t.el.getAttribute("aria-hidden"), "true",
    "the tree already announces every node; the table would duplicate all of it");
  t.destroy();
  g.destroy();
});

test("a11y-table: with opts.a11y false the table IS the accessible surface", () => {
  const { g } = mountSpec(nested(), { a11y: false });
  const t = attachA11yTable(g, { visible: false });
  assert.equal(t.el.getAttribute("aria-hidden"), null, "nothing else is announcing the graph");
  const rows = t.el.querySelectorAll("tr");
  assert.ok(rows.length > 1);
  t.destroy();
  g.destroy();
});
