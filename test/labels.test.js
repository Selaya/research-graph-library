// M2 render-extras: edge labels (render.js + styles.js) and containers()/expandAll()/
// collapseAll() (viewstate.js). The renderer is exercised through a minimal hand-rolled
// DOM (same technique as test/integration.test.js) passed explicitly to createRenderer —
// no globalThis.document, so this file stays isolated from the other test files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createViewState } from "../src/viewstate.js";
import { createRenderer } from "../src/render.js";
import { pointAt } from "../src/path.js";
import { CSS } from "../src/styles.js";

// ---------------------------------------------------------------------------
// Minimal hand-rolled DOM (same technique as test/integration.test.js), scoped to this
// file only — no globalThis mutation, so createRenderer(root, doc) is fed it explicitly.
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
// node rects + straight-line edge points, built directly (no scene/layout needed —
// render.js's contract is geometry-in, DOM-out).
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

test("edge.label renders a <text class=smv-edge-label>; unlabeled edges get no element at all", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  r.styleCommit({
    nodes: { A: { label: "A" }, B: { label: "B" }, C: { label: "C" }, D: { label: "D" } },
    edges: {
      e1: { source: "A", target: "B", label: "goes here" },
      e2: { source: "C", target: "D" }, // no label
    },
    sizes: { A: { w: 60, h: 36 }, B: { w: 60, h: 36 }, C: { w: 60, h: 36 }, D: { w: 60, h: 36 } },
  });
  r.frame(visualOf(
    { A: { x: 0, y: 0, w: 60, h: 36 }, B: { x: 200, y: 0, w: 60, h: 36 },
      C: { x: 0, y: 100, w: 60, h: 36 }, D: { x: 200, y: 100, w: 60, h: 36 } },
    { e1: { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }, e2: { points: [{ x: 0, y: 100 }, { x: 200, y: 100 }] } },
  ));

  const e1g = r.edge("e1"), e2g = r.edge("e2");
  const l1 = byClass(e1g, "smv-edge-label");
  const l2 = byClass(e2g, "smv-edge-label");
  assert.equal(l1.length, 1, "labeled edge gets exactly one label text node");
  assert.equal(l1[0].textContent, "goes here");
  assert.equal(l2.length, 0, "unlabeled edge has no label element at all");
});

test("label position tracks pointAt(clippedPoints, 0.5) offset along the local normal, per frame", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  r.styleCommit({
    nodes: { A: {}, B: {} },
    edges: { e1: { source: "A", target: "B", label: "mid" } },
    sizes: { A: { w: 40, h: 20 }, B: { w: 40, h: 20 } },
  });
  const nodes = { A: { x: 0, y: 0, w: 40, h: 20 }, B: { x: 100, y: 0, w: 40, h: 20 } };
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  r.frame(visualOf(nodes, { e1: { points } }));

  // Reproduce the clip the renderer itself performs (straight horizontal line clipped
  // to both node borders) so the expected midpoint/normal match exactly.
  const clipped = [{ x: 20, y: 0 }, { x: 80, y: 0 }]; // borders at x=±20 from each center
  const mid = pointAt(clipped, 0.5);
  const nx = -Math.sin(mid.angle), ny = Math.cos(mid.angle);
  const off = 8;

  const label = byClass(r.edge("e1"), "smv-edge-label")[0];
  assert.equal(Number(label.attrs.x), Math.round((mid.x + nx * off) * 100) / 100);
  assert.equal(Number(label.attrs.y), Math.round((mid.y + ny * off) * 100) / 100);

  // Move B: per-frame reposition, not a one-time placement.
  nodes.B.x = 300;
  r.frame(visualOf(nodes, { e1: { points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] } }));
  assert.ok(Number(label.attrs.x) > 100, "label followed the edge to its new midpoint");
});

test("label text is truncated at styleCommit, not re-measured per frame", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  const long = "a very long edge label that will not fit in ninety pixels of space";
  r.styleCommit({
    nodes: { A: {}, B: {} },
    edges: { e1: { source: "A", target: "B", label: long } },
    sizes: { A: { w: 40, h: 20 }, B: { w: 40, h: 20 } },
  });
  r.frame(visualOf(
    { A: { x: 0, y: 0, w: 40, h: 20 }, B: { x: 100, y: 0, w: 40, h: 20 } },
    { e1: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } },
  ));
  const label = byClass(r.edge("e1"), "smv-edge-label")[0];
  assert.ok(label.textContent.length < long.length, "truncated");
  assert.ok(label.textContent.endsWith("…"), "ellipsis appended");

  // Re-commit with a shorter label sharing the same id: text updates, no accumulation.
  r.styleCommit({
    nodes: { A: {}, B: {} },
    edges: { e1: { source: "A", target: "B", label: "short" } },
    sizes: { A: { w: 40, h: 20 }, B: { w: 40, h: 20 } },
  });
  assert.equal(label.textContent, "short");
  assert.equal(byClass(r.edge("e1"), "smv-edge-label").length, 1, "still exactly one label node");
});

test("a label can disappear on re-commit (edge loses its label) and the element is removed", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  const commit = (label) => r.styleCommit({
    nodes: { A: {}, B: {} },
    edges: { e1: { source: "A", target: "B", label } },
    sizes: { A: { w: 40, h: 20 }, B: { w: 40, h: 20 } },
  });
  commit("here");
  r.frame(visualOf(
    { A: { x: 0, y: 0, w: 40, h: 20 }, B: { x: 100, y: 0, w: 40, h: 20 } },
    { e1: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } },
  ));
  assert.equal(byClass(r.edge("e1"), "smv-edge-label").length, 1);
  commit(undefined);
  assert.equal(byClass(r.edge("e1"), "smv-edge-label").length, 0, "label element removed when the label goes away");
});

test("a meta-edge aggregating >=2 source edges never gets a label (weight badge tells the story)", () => {
  const store = new Store({
    nodes: [
      { id: "P", collapsed: true },
      { id: "c1", parent: "P" }, { id: "c2", parent: "P" },
      { id: "Z" },
    ],
    edges: [
      { id: "e1", source: "c1", target: "Z", label: "one" },
      { id: "e2", source: "c2", target: "Z", label: "two" },
    ],
  });
  const vs = createViewState(store);
  const v = vs.view();
  const meta = v.edges.find((e) => e.id === "meta:P->Z");
  assert.ok(meta, "meta edge exists");
  assert.equal(meta.weight, 2);

  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: v.nodes, edges: v.edges, sizes: v.sizes });
  r.frame(visualOf(
    { P: { x: 0, y: 0, w: 80, h: 36 }, Z: { x: 200, y: 0, w: 60, h: 36 } },
    { [meta.id]: { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] } },
  ));
  assert.equal(byClass(r.edge(meta.id), "smv-edge-label").length, 0);
});

test(".smv-edge-label CSS: muted fill, small size, paint-order stroke halo (both themes)", () => {
  assert.match(CSS, /\.smv-edge\s+text\.smv-edge-label\s*\{[^}]*fill:var\(--smv-muted\)/);
  assert.match(CSS, /\.smv-edge-label\s*\{[^}]*paint-order:stroke fill/);
  assert.match(CSS, /\.smv-edge-label\s*\{[^}]*stroke:var\(--smv-bg\)/, "halo uses the themed bg token, so it works in light and dark");
});

// ---------------------------------------------------------------------------
// viewstate: containers() / expandAll() / collapseAll()
// ---------------------------------------------------------------------------

function nestedSpec() {
  return {
    nodes: [
      { id: "root" },
      { id: "Outer" },
      { id: "Outer.a", parent: "Outer" },
      { id: "Outer.Inner" , parent: "Outer" },
      { id: "Outer.Inner.x", parent: "Outer.Inner" },
      { id: "Outer.Inner.y", parent: "Outer.Inner" },
      { id: "Solo" },
      { id: "Solo.only", parent: "Solo" },
    ],
    edges: [],
  };
}

test("containers() lists every container id, parents before their nested containers", () => {
  const vs = createViewState(new Store(nestedSpec()));
  const list = vs.containers();
  assert.deepEqual(new Set(list), new Set(["Outer", "Outer.Inner", "Solo"]));
  assert.ok(list.indexOf("Outer") < list.indexOf("Outer.Inner"), "Outer (depth 0) precedes its nested Inner (depth 1)");
});

test("expandAll() expands every collapsed container in one pass and returns the changed ids", () => {
  const spec = nestedSpec();
  spec.nodes.find((n) => n.id === "Outer").collapsed = true;
  spec.nodes.find((n) => n.id === "Outer.Inner").collapsed = true;
  spec.nodes.find((n) => n.id === "Solo").collapsed = true;
  const vs = createViewState(new Store(spec));
  assert.deepEqual([...vs.collapsed].sort(), ["Outer", "Outer.Inner", "Solo"]);

  const changed = vs.expandAll();
  assert.deepEqual(changed.sort(), ["Outer", "Outer.Inner", "Solo"]);
  assert.equal(vs.collapsed.size, 0, "expandAll only touches the collapsed set");
  assert.equal(vs.isVisible("Outer.Inner.x"), true, "descendants become visible again");

  assert.deepEqual(vs.expandAll(), [], "calling again with nothing collapsed changes nothing");
});

test("collapseAll() collapses every container and returns only the ids that actually changed", () => {
  const spec = nestedSpec();
  spec.nodes.find((n) => n.id === "Outer.Inner").collapsed = true; // pre-collapsed
  const vs = createViewState(new Store(spec));
  assert.deepEqual([...vs.collapsed], ["Outer.Inner"]);

  const changed = vs.collapseAll();
  // Inner was already collapsed -> not reported as "changed"; Outer and Solo are.
  assert.deepEqual(changed.sort(), ["Outer", "Solo"]);
  assert.deepEqual([...vs.collapsed].sort(), ["Outer", "Outer.Inner", "Solo"]);

  assert.deepEqual(vs.collapseAll(), [], "calling again with everything collapsed changes nothing");
});

test("expandAll/collapseAll mutate only the collapsed set — a relayout still needs an explicit view() call", () => {
  const vs = createViewState(new Store(nestedSpec()));
  const before = vs.view();
  vs.collapseAll();
  // The set changed but nothing re-derives until view() is called again.
  assert.deepEqual(before.nodes.map((n) => n.id).sort(), before.nodes.map((n) => n.id).sort());
  const after = vs.view();
  assert.notDeepEqual(after.nodes.map((n) => n.id).sort(), before.nodes.map((n) => n.id).sort(),
    "a fresh view() after collapseAll does reflect the new collapsed set");
});

test("a weight-1 meta-edge keeps the hidden edge's label; aggregating a 2nd source keeps weight authority", () => {
  const store = new Store({
    nodes: [
      { id: "C", label: "Box", collapsed: true },
      { id: "C.a", parent: "C" },
      { id: "C.b", parent: "C" },
      { id: "X" },
    ],
    edges: [
      { id: "e1", source: "C.a", target: "X", label: "ships to" },
    ],
  });
  const vs = createViewState(store);
  const v1 = vs.view();
  const m1 = v1.edges.find((e) => e.meta);
  assert.equal(m1.weight, 1);
  assert.equal(m1.label, "ships to", "single hidden labeled edge keeps its label on the meta edge");

  // A second boundary edge aggregates in: weight 2 — the renderer drops the label
  // (weight > 1), viewstate still reports the first label it saw.
  store.addEdge({ id: "e2", source: "C.b", target: "X" });
  const v2 = vs.view();
  const m2 = v2.edges.find((e) => e.meta);
  assert.equal(m2.weight, 2);
});
