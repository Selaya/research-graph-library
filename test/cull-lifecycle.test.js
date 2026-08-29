// M3 culling, at the mount() seam rather than render.js's: who re-arms the cull pass, and
// what keyboard navigation does about the nodes it hides. Both regressions this file gates
// were invisible to test/cull.test.js, which drives the renderer directly and never moves a
// viewport, and to test/a11y.test.js, which never has a culled node on screen.
//
// Hand-rolled DOM + manual rAF, the technique test/integration.test.js established.

import { test } from "node:test";
import assert from "node:assert/strict";

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "",
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
    dispatchEvent(ev) { for (const fn of this.listeners[ev.type] || []) fn(ev); return true; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 480 }; },
    clientWidth: 900, clientHeight: 480,
    setPointerCapture() {}, releasePointerCapture() {},
    getContext() { return { font: "", measureText: (s) => ({ width: String(s).length * 7.2 }) }; },
    // Only the two shapes this repo's modules ask for: ".cls" and "[attr]".
    querySelectorAll(sel) {
      const out = [];
      const want = sel.startsWith(".") ? sel.slice(1) : null;
      const attr = sel.startsWith("[") ? sel.slice(1, -1) : null;
      const walk = (n) => {
        for (const c of n.children) {
          if (want && (c.attrs.class || "").split(/\s+/).includes(want)) out.push(c);
          if (attr && c.attrs[attr] !== undefined) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    focus() {
      // The browser rule this whole a11y regression is about: focus() on a hidden element
      // is a silent no-op, and a culled group is display:none.
      if (this.attrs["data-culled"] !== undefined) return;
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    },
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
  createElementNS(ns, t) { const e = makeEl(ns, t) && makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector(sel) {
    return head.children.find((c) => c.tagName === "style" && Object.keys(c.attrs).some((k) => sel.includes(k))) || null;
  },
};
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

const { mount } = await import("../src/index.js");

/** A grid wide enough to blow past render.js's 150-element culling threshold. */
function bigSpec(cols = 12, rows = 16) {
  const nodes = [], edges = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      nodes.push({ id: `n${c}-${r}`, label: `n${c}-${r}` });
      if (c) edges.push({ id: `e${c}-${r}`, source: `n${c - 1}-${r}`, target: `n${c}-${r}` });
    }
  }
  return { nodes, edges };
}

const culledCount = (g) => g.renderer.svg.querySelectorAll("[data-culled]").length;
const groupCount = (g) => g.renderer.svg.querySelectorAll("[data-id]").length;

async function mounted() {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, bigSpec(), { animation: { duration: 0 } });
  await pump(4);
  return g;
}

test("culling: fitView() re-arms the cull pass with no pointer event anywhere", async () => {
  const g = await mounted();
  assert.ok(groupCount(g) > 150, "sanity: over render.js's cull threshold");
  assert.equal(culledCount(g), 0, "everything visible at the initial fit");

  // Programmatic zoom into a corner. No pointermove, no wheel — just the public API.
  g.viewport.zoomBy(4, { x: 0, y: 0 });
  await pump(2);
  const hidden = culledCount(g);
  assert.ok(hidden > 0, `zooming in should cull something (culled ${hidden})`);

  // Regression: culling only ever re-ran from the svg's own pointermove/pointerup/wheel
  // listeners, so a programmatic viewport move left every hidden element hidden — the
  // transform was right, the cull pass simply never ran again.
  g.fitView({ animate: false });
  await pump(2);
  assert.equal(culledCount(g), 0, "fitView() shows the whole graph again");
  g.destroy();
});

test("culling: zoom out through viewport.zoomBy() brings culled elements back", async () => {
  const g = await mounted();
  g.viewport.zoomBy(4, { x: 0, y: 0 });
  await pump(2);
  assert.ok(culledCount(g) > 0);
  g.viewport.zoomBy(0.25, { x: 0, y: 0 });
  await pump(2);
  assert.equal(culledCount(g), 0, "zooming back out un-culls");
  g.destroy();
});

test("a11y: End never parks the roving tabindex on a culled (unfocusable) node", async () => {
  const g = await mounted();
  g.viewport.zoomBy(4, { x: 0, y: 0 });
  await pump(2);

  const els = g.renderer.svg.querySelectorAll(".smv-node");
  const culled = els.filter((el) => el.getAttribute("data-culled") !== null);
  const visible = els.filter((el) => el.getAttribute("data-culled") === null);
  assert.ok(culled.length > 0 && visible.length > 0, "fixture has both culled and visible nodes");

  // Put real focus on a visible node, then walk to the end of the reading order.
  visible[0].focus();
  assert.equal(doc.activeElement, visible[0]);
  g.renderer.svg.dispatchEvent({ type: "keydown", key: "End", preventDefault() {} });

  // Regression: focusId() committed currentId + the roving tabindex BEFORE calling focus(),
  // and never checked that focus moved. On a culled node .focus() is a silent no-op, so the
  // tabindex="0" marker ended up on an element nobody can reach while the element that still
  // held focus was demoted to tabindex="-1" — tabbing out and back dropped focus entirely.
  const stops = els.filter((el) => el.getAttribute("tabindex") === "0");
  assert.equal(stops.length, 1, "exactly one roving stop");
  assert.equal(stops[0].getAttribute("data-culled"), null, "the roving stop is a focusable node");
  assert.equal(doc.activeElement, stops[0], "real focus and the roving stop agree");
  g.destroy();
});
