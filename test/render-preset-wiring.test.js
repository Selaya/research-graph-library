// F21–F27 wiring, at mount() level: the preset's measurement/edge-label defaults reaching
// the layout, and the public nodeclick/edgeclick events reaching `g.on()`. Same hand-rolled
// DOM + manual rAF technique as test/integration.test.js (no jsdom in this repo).

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
const fire = (el, type, ev = {}) => { for (const fn of el.listeners[type] || []) fn(ev); };
function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));

const { mount } = await import("../src/index.js");
const { PIPELINE_MEASURE } = await import("../src/preset-pipeline.js");
const { truncate, NODE_PAD_X } = await import("../src/measure.js");

const SPEC = {
  nodes: [
    { id: "a", label: "Ingest raw events", data: { duration: "45m", status: "done", mode: "manual" } },
    { id: "b", label: "Publish" },
  ],
  edges: [{ id: "e1", source: "a", target: "b", label: "hands off the batch to" }],
};

function mountIn(opts) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  return { root, g: mount(root, JSON.parse(JSON.stringify(SPEC)), opts) };
}

// ---------------------------------------------------------------------------
// F22/F23/F26 — what `preset: "pipeline"` installs in the layout options
// ---------------------------------------------------------------------------

test("preset 'pipeline' reserves chip room in measurement; a plain mount is untouched", () => {
  const plain = mountIn({});
  const preset = mountIn({ preset: "pipeline" });

  const bare = plain.g.layoutResult().nodes.a;
  const withChip = preset.g.layoutResult().nodes.a;
  assert.ok(withChip.w > bare.w, "the chip/glyph gutters widen the box (F22)");
  assert.ok(withChip.h > bare.h, "the chip row adds height (F23)");
  // A node with nothing to decorate is sized exactly as before.
  assert.deepEqual(preset.g.layoutResult().nodes.b.h, bare.h);

  // ...and the label gets the room that is left, not the whole box.
  const label = byClass(preset.g.renderer.node("a"), "smv-node-label")[0];
  assert.ok(label.textContent.endsWith("…") || label.textContent === "Ingest raw events");
  plain.g.destroy();
  preset.g.destroy();
});

test("F22: the measured reserve survives the layout swap - a long label truncates clear of the chip", async () => {
  // Regression: index.js rebuilt `sizes[id]` as a fresh {w,h} from the layout result after
  // every commit, which dropped the `reserve` viewstate had measured. The box still got
  // 96px wider and the label happily spent all of it, so a long label ran under the chip -
  // exactly the F22 friction, only on a wider box.
  const LONG = { nodes: [{ id: "a", label: "Reconcile ledger entries nightly", data: { duration: "45m", mode: "manual" } }], edges: [] };
  const mountLong = (opts) => {
    const root = makeEl("div");
    root.ownerDocument = doc;
    return mount(root, JSON.parse(JSON.stringify(LONG)), opts);
  };
  const plain = mountLong({});
  const preset = mountLong({ preset: "pipeline" });
  const labelOf = (g) => byClass(g.renderer.node("a"), "smv-node-label")[0].textContent;

  const node = LONG.nodes[0];
  const reserve = PIPELINE_MEASURE.extraWidth(node, { nodes: new Map([["a", node]]), cache: new Map() });
  assert.ok(reserve > 0, "the preset does reserve chip room for this node");

  const w = preset.layoutResult().nodes.a.w;
  assert.equal(labelOf(preset), truncate(node.label, w - 2 * NODE_PAD_X - reserve),
    "the label gets the box MINUS the reserve");
  assert.notEqual(labelOf(preset), labelOf(plain),
    "the reserve changed something: an undecorated mount of the same node keeps more label");
  assert.ok(labelOf(preset).length < labelOf(plain).length);

  // A style-only commit (g.style/g.props) goes through the other sizes path - same rule.
  preset.style(() => ({ "--smv-fill": "#eee" }));
  await pump(1);
  assert.equal(labelOf(preset), truncate(node.label, w - 2 * NODE_PAD_X - reserve),
    "a style-only commit does not hand the reserve back to the label");

  plain.destroy();
  preset.destroy();
});

test("preset 'pipeline' raises the edge-label cap; an explicit layout option still wins", () => {
  const preset = mountIn({ preset: "pipeline" });
  const full = byClass(preset.g.renderer.edge("e1"), "smv-edge-label")[0].textContent;
  assert.equal(full, "hands off the batch to", "180px fits the whole message (F26)");
  preset.g.destroy();

  const tight = mountIn({ preset: "pipeline", layout: { edgeLabelMaxW: 40 } });
  assert.ok(byClass(tight.g.renderer.edge("e1"), "smv-edge-label")[0].textContent.endsWith("…"),
    "the caller's own cap is never overwritten");
  tight.g.destroy();

  const bare = mountIn({});
  assert.ok(byClass(bare.g.renderer.edge("e1"), "smv-edge-label")[0].textContent.endsWith("…"),
    "without the preset the 90px default still applies");
  bare.g.destroy();
});

test("preset options: { name: 'pipeline', total } reaches the preset", () => {
  const { g, root } = mountIn({ preset: { name: "pipeline", total: "critical" } });
  const key = byClass(root, "smv-totalbar-key")[0];
  assert.equal(key.textContent, "critical");
  g.destroy();
});

test("layout.measure can be supplied by hand, and g.layout() re-measures with it", () => {
  const { g } = mountIn({ layout: { measure: { extraWidth: 40, extraHeight: 10 } } });
  assert.equal(g.layoutResult().nodes.b.h, 46);
  const wide = g.layoutResult().nodes.b.w;
  g.layout({ measure: null }); // the new drawing is computed synchronously; only the tween is not
  assert.equal(g.layoutResult().nodes.b.h, 36, "dropping the hook returns to the plain size");
  assert.equal(g.layoutResult().nodes.b.w, wide - 40);
  g.destroy();
});

// ---------------------------------------------------------------------------
// F27 — nodeclick / edgeclick
// ---------------------------------------------------------------------------

/** A clean tap on `el`: down, then up within the slop, through the svg's own listeners. */
function tap(svg, el, { travel = 0 } = {}) {
  fire(svg, "pointerdown", { target: el, clientX: 100, clientY: 100, pointerId: 7 });
  fire(svg, "pointerup", { target: svg, clientX: 100 + travel, clientY: 100, pointerId: 7 });
}

test("F27: g.on('nodeclick'/'edgeclick') fires from a tap, with {id, event}", async () => {
  const { g } = mountIn({});
  await pump(2);
  const seen = [];
  g.on("nodeclick", (p) => seen.push(["node", p.id, p.event.pointerId]));
  g.on("edgeclick", (p) => seen.push(["edge", p.id, p.event.pointerId]));

  tap(g.renderer.svg, byClass(g.renderer.node("b"), "smv-node-box")[0]);
  tap(g.renderer.svg, byClass(g.renderer.edge("e1"), "smv-edge-line")[0]);
  assert.deepEqual(seen, [["node", "b", 7], ["edge", "e1", 7]]);

  // Past the tap slop it is a pan, and nothing is published.
  seen.length = 0;
  tap(g.renderer.svg, byClass(g.renderer.node("b"), "smv-node-box")[0], { travel: 40 });
  assert.deepEqual(seen, []);
  g.destroy();
});

test("F27: the edge LABEL and its pill are part of the edge's hit area, not just the stroke", async () => {
  // styles.js deliberately leaves pointer-events on the label (a 1.25px stroke is a poor
  // click target), and types/index.d.ts documents the hit area as the whole edge group.
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, {
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "ab", source: "a", target: "b", label: { text: "GET /orders", pill: true } }],
  }, {});
  await pump(2);
  const seen = [];
  g.on("edgeclick", (p) => seen.push(p.id));

  tap(g.renderer.svg, byClass(g.renderer.edge("ab"), "smv-edge-label")[0]);
  tap(g.renderer.svg, byClass(g.renderer.edge("ab"), "smv-edge-pill")[0]);
  assert.deepEqual(seen, ["ab", "ab"], "the label and the pill behind it both hit the edge");
  g.destroy();
});

test("F27: interaction.click:false drops the events, tapToggle:false keeps them", async () => {
  const quiet = mountIn({ interaction: { click: false } });
  await pump(2);
  let count = 0;
  quiet.g.on("nodeclick", () => { count++; });
  tap(quiet.g.renderer.svg, byClass(quiet.g.renderer.node("b"), "smv-node-box")[0]);
  assert.equal(count, 0);
  quiet.g.destroy();

  const noToggle = mountIn({ interaction: { tapToggle: false } });
  await pump(2);
  const ids = [];
  noToggle.g.on("nodeclick", (p) => ids.push(p.id));
  tap(noToggle.g.renderer.svg, byClass(noToggle.g.renderer.node("b"), "smv-node-box")[0]);
  assert.deepEqual(ids, ["b"]);
  noToggle.g.destroy();
});
