// M3 culling agent: src/render.js's setCull()/frame() interaction, exercised through the
// same minimal hand-rolled DOM used by test/labels.test.js (createRenderer takes an
// explicit {root, doc} — no globalThis.document, so this file stays isolated).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../src/render.js";

// ---------------------------------------------------------------------------
// Minimal hand-rolled DOM (same technique as test/labels.test.js / test/integration.test.js).
// ---------------------------------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], parent: null, attrs: {}, textContent: "",
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove();
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
  };
  return el;
}
function makeRoot() {
  const root = makeEl("div");
  const doc = { createElementNS(_ns, t) { const e = makeEl(t); e.ownerDocument = doc; return e; } };
  root.ownerDocument = doc;
  return { root, doc };
}

// A minimal `visual` (the shape scene.commit's onFrame hands to renderer.frame): centered
// node rects + polyline edge points, built directly (render.js's contract is geometry-in,
// DOM-out — no scene/layout needed).
function visualOf(nodes, edges) {
  const vn = new Map(Object.entries(nodes).map(([id, n]) => [id, { ...n, opacity: 1 }]));
  const ve = new Map(Object.entries(edges).map(([id, e]) => [id, { ...e, opacity: 1 }]));
  return { nodes: vn, edges: ve };
}

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));

// Fixed viewport rect used across the over-threshold tests: covers roughly x/y in
// [-100, 1100] — everything the "near" fixture nodes sit in, none of the "far" ones.
const RECT = { x: -100, y: -100, w: 1200, h: 1200 };

/** N filler nodes clustered inside RECT, all tiny and harmless to the counts under test. */
function fillerNodes(n) {
  const out = {};
  for (let i = 0; i < n; i++) out[`f${i}`] = { x: i * 7, y: 500, w: 10, h: 10 };
  return out;
}

test("under-threshold graphs never cull, even with a cull fn set and elements far outside the rect", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  r.setCull(() => RECT);

  const nodes = { ...fillerNodes(8), far: { x: 100000, y: 100000, w: 10, h: 10 } }; // 9 total, well under 150
  r.styleCommit({ nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])), edges: {} });
  r.frame(visualOf(nodes, {}));

  for (const id of Object.keys(nodes)) {
    const g = r.node(id);
    assert.equal(g.getAttribute("data-culled"), null, `${id}: not culled below CULL_THRESHOLD`);
    assert.notEqual(g.attrs.transform, undefined, `${id}: geometry was still written`);
  }
});

test("over-threshold: fully-outside groups get data-culled + display:none, restored on re-entry", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);

  const nodes = { ...fillerNodes(150), far1: { x: 100000, y: 100000, w: 10, h: 10 }, far2: { x: -100000, y: 5000, w: 10, h: 10 } };
  assert.ok(Object.keys(nodes).length > 150, "sanity: over CULL_THRESHOLD");
  r.styleCommit({ nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])), edges: {} });

  // No cull fn yet: nothing culled regardless of position.
  r.frame(visualOf(nodes, {}));
  assert.equal(r.node("far1").getAttribute("data-culled"), null);

  r.setCull(() => RECT);
  r.frame(visualOf(nodes, {}));

  const far1 = r.node("far1"), far2 = r.node("far2"), near = r.node("f0");
  assert.equal(far1.getAttribute("data-culled"), "", "far1 marked culled");
  assert.equal(far1.style.display, "none");
  assert.equal(far2.getAttribute("data-culled"), "", "far2 marked culled");
  assert.equal(near.getAttribute("data-culled"), null, "near filler node stays visible");
  assert.equal(near.style.display, undefined, "near node's display never touched (uncull path is a no-op for it)");

  // Move far1 into the rect and re-frame: it must be restored.
  nodes.far1 = { x: 0, y: 0, w: 10, h: 10 };
  r.frame(visualOf(nodes, {}));
  assert.equal(far1.getAttribute("data-culled"), null, "far1 restored once back inside the rect");
  assert.equal(far1.style.display, "", "display restored");
  assert.notEqual(far1.attrs.transform, undefined, "geometry resumed being written");

  // far2 is still outside: stays culled.
  assert.equal(far2.getAttribute("data-culled"), "");
});

test("a null rect (cull fn returns null) culls nothing, even over threshold", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  const nodes = { ...fillerNodes(150), far: { x: 100000, y: 100000, w: 10, h: 10 } };
  r.styleCommit({ nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])), edges: {} });

  r.setCull(() => null);
  r.frame(visualOf(nodes, {}));
  for (const id of Object.keys(nodes)) {
    assert.equal(r.node(id).getAttribute("data-culled"), null, `${id}: null rect culls nothing`);
  }
});

test("setCull(null) clears the cull fn — a previously-culled group stays uncullable until re-armed", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  const nodes = { ...fillerNodes(150), far: { x: 100000, y: 100000, w: 10, h: 10 } };
  r.styleCommit({ nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])), edges: {} });

  r.setCull(() => RECT);
  r.frame(visualOf(nodes, {}));
  assert.equal(r.node("far").getAttribute("data-culled"), "");

  r.setCull(null);
  r.frame(visualOf(nodes, {}));
  assert.equal(r.node("far").getAttribute("data-culled"), null, "restored once culling is disabled");
});

test("an edge culls only when BOTH endpoints AND every point are outside the rect", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);

  const nodes = {
    ...fillerNodes(148),
    A: { x: 50, y: 50, w: 10, h: 10 }, B: { x: 60, y: 50, w: 10, h: 10 }, // both near: baseline
    C: { x: -5000, y: 500, w: 10, h: 10 }, D: { x: 5000, y: 500, w: 10, h: 10 }, // far endpoints...
    E: { x: -5000, y: -5000, w: 10, h: 10 }, F: { x: 5000, y: -5000, w: 10, h: 10 }, // far endpoints
  };
  const edges = {
    nearEdge: { source: "A", target: "B", points: [{ x: 50, y: 50 }, { x: 60, y: 50 }] },
    // Far endpoints, but a bend point sits inside the rect: must NOT cull.
    throughEdge: { source: "C", target: "D", points: [{ x: -5000, y: 500 }, { x: 0, y: 500 }, { x: 5000, y: 500 }] },
    // Far endpoints AND every point outside: must cull.
    farEdge: { source: "E", target: "F", points: [{ x: -5000, y: -5000 }, { x: 0, y: -5000 }, { x: 5000, y: -5000 }] },
  };
  assert.ok(Object.keys(nodes).length + Object.keys(edges).length > 150, "sanity: over CULL_THRESHOLD");

  r.styleCommit({
    nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])),
    edges: Object.fromEntries(Object.entries(edges).map(([id, e]) => [id, { source: e.source, target: e.target }])),
  });
  r.setCull(() => RECT);
  r.frame(visualOf(nodes, edges));

  assert.equal(r.edge("nearEdge").getAttribute("data-culled"), null, "both endpoints near: never culled");
  assert.equal(r.edge("throughEdge").getAttribute("data-culled"), null,
    "far endpoints but a point inside the rect: not culled (would corrupt a real crossing edge)");
  assert.equal(r.edge("farEdge").getAttribute("data-culled"), "", "endpoints AND every point outside: culled");
  assert.equal(r.edge("farEdge").style.display, "none");
});

test("geometry writes are actually skipped for culled groups (setAttribute call counts)", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  const nodes = { ...fillerNodes(150), far: { x: 100000, y: 100000, w: 10, h: 10 }, near: { x: 0, y: 0, w: 10, h: 10 } };
  r.styleCommit({ nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])), edges: {} });

  // Establish the elements first (uncalled — no cull fn armed yet).
  r.frame(visualOf(nodes, {}));
  const farRect = byClass(r.node("far"), "smv-node-box")[0];
  const nearRect = byClass(r.node("near"), "smv-node-box")[0];

  const spy = (el) => {
    let calls = 0;
    const orig = el.setAttribute.bind(el);
    el.setAttribute = (...args) => { calls++; return orig(...args); };
    return () => calls;
  };
  const farCalls = spy(farRect);
  const nearCalls = spy(nearRect);

  r.setCull(() => RECT);
  r.frame(visualOf(nodes, {})); // this frame culls "far"
  const farAfterCull = farCalls();
  const nearAfterCull = nearCalls();
  assert.ok(nearAfterCull > 0, "near node's rect still gets geometry writes");

  r.frame(visualOf(nodes, {})); // another identical frame — far stays culled
  assert.equal(farCalls(), farAfterCull, "no additional setAttribute calls on a still-culled node's rect");
  assert.ok(nearCalls() > nearAfterCull, "near node keeps getting written every frame, as before culling existed");
});
