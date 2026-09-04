// M2 a11y: ARIA/keyboard (src/a11y.js) + linearized table fallback (src/a11y-table.js).
// Pure logic (reading order, row derivation) gets full coverage; DOM application gets a
// lightweight hand-rolled fake (same technique as test/labels.test.js and
// test/integration.test.js) so this stays a Node-only unit test — real-browser behavior
// is e2e-m2's job (INTERNALS.md M2 exit).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readingOrder, attachA11y } from "../src/a11y.js";
import { computeRows, attachA11yTable } from "../src/a11y-table.js";

// ---------------------------------------------------------------------------
// Minimal hand-rolled DOM: attrs, children, events, and just enough query support
// (".class" and "tag[attr]") for the selectors a11y.js/a11y-table.js actually use.
// ---------------------------------------------------------------------------
function matches(el, sel) {
  const m = /^([a-zA-Z0-9-]*)(?:\[([^\]]+)\])?(?:\.([a-zA-Z0-9-_]+))?$/.exec(sel);
  if (!m) return false;
  const [, tag, attr, cls] = m;
  if (tag && el.tagName !== tag) return false;
  if (cls && !(el.attrs.get("class") || "").split(/\s+/).includes(cls)) return false;
  if (attr && !el.attrs.has(attr)) return false;
  return true;
}
function queryAll(root, sel) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } };
  walk(root);
  return out;
}

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.textContent = "";
    this._focused = false;
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, ev) { for (const fn of [...(this.listeners.get(type) || [])]) fn(ev); }
  focus() { this._focused = true; }
}

class FakeDocument {
  constructor() { this.head = new FakeEl("head"); this.documentElement = new FakeEl("html"); }
  createElement(tag) { const el = new FakeEl(tag); el.ownerDocument = this; return el; }
  createElementNS(_ns, tag) { return this.createElement(tag); }
  querySelector(sel) { return queryAll(this.head, sel)[0] || queryAll(this.documentElement, sel)[0] || null; }
}

/** Builds the svg > g.smv-viewport > (g.smv-edges, g.smv-nodes > g.smv-node[data-id]) shape
 *  render.js produces, populated with `ids`, each laid out at `pos[id] = {x,y}`. */
function fakeSvg(doc, ids, pos) {
  const svg = doc.createElement("svg");
  svg.ownerDocument = doc;
  const viewportG = doc.createElement("g"); viewportG.setAttribute("class", "smv-viewport");
  const edgesG = doc.createElement("g"); edgesG.setAttribute("class", "smv-edges");
  const nodesG = doc.createElement("g"); nodesG.setAttribute("class", "smv-nodes");
  viewportG.appendChild(edgesG);
  viewportG.appendChild(nodesG);
  svg.appendChild(viewportG);
  for (const id of ids) {
    const n = doc.createElement("g");
    n.setAttribute("class", "smv-node");
    n.setAttribute("data-id", id);
    nodesG.appendChild(n);
  }
  return svg;
}

function fakeRoot(doc) {
  const root = doc.createElement("div");
  root.ownerDocument = doc;
  return root;
}

function fakeG({ ids, pos, specNodes, edges, isContainer, collapsed, isVisible, visibleAncestor } = {}) {
  const listeners = new Map();
  const byId = new Map((specNodes || []).map((n) => [n.id, n]));
  const layout = { nodes: {} };
  for (const id of ids || []) layout.nodes[id] = { x: (pos && pos[id] && pos[id].x) ?? 0, y: (pos && pos[id] && pos[id].y) ?? 0, w: 10, h: 10 };
  const calls = { expand: [], collapse: [] };
  const g = {
    el: null,
    layoutResult: () => layout,
    node: (id) => byId.get(id),
    spec: () => ({ nodes: specNodes || [], edges: edges || [] }),
    viewstate: {
      isContainer: (id) => (isContainer || (() => false))(id),
      collapsed: collapsed || new Set(),
      isVisible: (id) => (isVisible || (() => true))(id),
      visibleAncestor: visibleAncestor || ((id) => (byId.has(id) ? id : null)),
    },
    expand: (id) => calls.expand.push(id),
    collapse: (id) => calls.collapse.push(id),
    on: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
    emit: (type, payload) => { for (const fn of [...(listeners.get(type) || [])]) fn(payload); },
    _calls: calls,
  };
  return g;
}

// ---------------------------------------------------------------------------
// readingOrder (pure)
// ---------------------------------------------------------------------------

test("readingOrder sorts visible nodes by x then y", () => {
  const lr = { nodes: {
    C: { x: 10, y: 5 },
    A: { x: 0, y: 100 },
    B: { x: 10, y: -5 },
    D: { x: 0, y: 0 },
  } };
  assert.deepEqual(readingOrder(lr), ["D", "A", "B", "C"]);
});

test("readingOrder is empty/defensive with no layout", () => {
  assert.deepEqual(readingOrder(null), []);
  assert.deepEqual(readingOrder({}), []);
  assert.deepEqual(readingOrder({ nodes: {} }), []);
});

test("readingOrder is rank-major for a TB layout: order's shared-axis grouping beats raw x", () => {
  // Two siblings on rank 0 (screen y is IDENTICAL for both — the TB tell, per
  // engine.js's emit()); one node on rank 1, further down. A plain x-then-y sort would
  // read C (x=25) before B (x=50): between the two ranks instead of after both.
  const lr = {
    nodes: {
      A: { x: 0, y: 0 },
      B: { x: 50, y: 0 },
      C: { x: 25, y: 80 },
    },
    order: [["A", "B"], ["C"]],
  };
  assert.deepEqual(readingOrder(lr), ["A", "B", "C"]);
});

test("readingOrder stays x-then-y for an LR layout's order (same-rank nodes share x, not y)", () => {
  const lr = {
    nodes: { A: { x: 0, y: 0 }, B: { x: 0, y: 50 }, C: { x: 80, y: 25 } },
    order: [["A", "B"], ["C"]],
  };
  assert.deepEqual(readingOrder(lr), ["A", "B", "C"]);
});

test("readingOrder falls back to x-then-y when every rank is a singleton (axis is unobservable)", () => {
  const lr = {
    nodes: { A: { x: 0, y: 0 }, B: { x: 50, y: 10 }, C: { x: 100, y: 20 } },
    order: [["A"], ["B"], ["C"]],
  };
  assert.deepEqual(readingOrder(lr), ["A", "B", "C"]);
});

// ---------------------------------------------------------------------------
// computeRows (pure)
// ---------------------------------------------------------------------------

test("computeRows: one row per visible node, label/status/duration/depth/targets", () => {
  const specNodes = [
    { id: "A", label: "Ingest", data: { status: "done", duration: "45m" } },
    { id: "C", label: "Clean", parent: undefined },
    { id: "c1", parent: "C", label: "Dedupe" },
    { id: "Z", label: "Ship" },
  ];
  const edges = [
    { id: "e1", source: "A", target: "C" },
    { id: "e2", source: "c1", target: "Z" },
  ];
  const g = fakeG({
    ids: ["A", "C", "Z"], // C collapsed: c1 not visible
    specNodes, edges,
    isContainer: (id) => id === "C",
    collapsed: new Set(["C"]),
    visibleAncestor: (id) => (id === "c1" ? "C" : id),
  });

  const rows = computeRows(g);
  assert.equal(rows.length, 3);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("A").label, "Ingest");
  assert.equal(byId.get("A").status, "done");
  assert.equal(byId.get("A").duration, "45m");
  assert.equal(byId.get("A").depth, 0);
  assert.deepEqual(byId.get("A").targets, ["C"]);
  // c1 -> Z folds through C's visibleAncestor, dropping duplicates/self-loops elsewhere.
  assert.deepEqual(byId.get("C").targets, ["Z"]);
  assert.equal(byId.get("c1"), undefined, "collapsed child is not a row");
});

test("computeRows: depth walks the parent chain; falls back to viewstate.isVisible with no layout yet", () => {
  const specNodes = [
    { id: "P" },
    { id: "K", parent: "P" },
  ];
  const g = fakeG({ ids: [], specNodes, edges: [], isVisible: () => true });
  g.layoutResult = () => null; // before the first commit
  const rows = computeRows(g);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("K").depth, 1);
  assert.equal(byId.get("P").depth, 0);
});

test("computeRows: empty/defensive with no g or empty spec", () => {
  assert.deepEqual(computeRows(null), []);
  assert.deepEqual(computeRows(fakeG({ ids: [] })), []);
});

test("computeRows: prefers the live data-run status (read off the DOM) over the static spec status", () => {
  const doc = new FakeDocument();
  const root = fakeRoot(doc);
  const specNodes = [{ id: "A", label: "A", data: { status: "done" } }];
  const svg = fakeSvg(doc, ["A"], { A: { x: 0, y: 0 } });
  root.appendChild(svg);
  const g = fakeG({ ids: ["A"], specNodes, edges: [] });
  g.el = root;

  // No run in progress yet: falls back to the spec's static status.
  assert.equal(computeRows(g)[0].status, "done");

  // run-render.js writes `data-run` straight onto the node's element.
  svg.querySelectorAll(".smv-node")[0].setAttribute("data-run", "active");
  assert.equal(computeRows(g)[0].status, "active", "live data-run wins over spec data.status");
});

// ---------------------------------------------------------------------------
// attachA11y — lightweight fake-DOM smoke
// ---------------------------------------------------------------------------

test("attachA11y: no-op handles under Node / missing svg (importable + safely callable)", () => {
  const h1 = attachA11y({}, {});
  assert.equal(typeof h1.destroy, "function");
  h1.destroy(); // must not throw
  const h2 = attachA11y(null, { svg: null });
  h2.destroy();
});

test("attachA11y: applies role/treeitem/aria-level/aria-expanded + roving tabindex", () => {
  const doc = new FakeDocument();
  const specNodes = [{ id: "A", label: "A", data: { status: "active" } }, { id: "C", label: "C" }, { id: "c1", parent: "C", label: "c1" }];
  const ids = ["A", "C", "c1"];
  const svg = fakeSvg(doc, ids, { A: { x: 0, y: 0 }, C: { x: 10, y: 0 }, c1: { x: 20, y: 0 } });
  const root = fakeRoot(doc);
  root.appendChild(svg);

  const g = fakeG({ ids, pos: { A: { x: 0, y: 0 }, C: { x: 10, y: 0 }, c1: { x: 20, y: 0 } }, specNodes, isContainer: (id) => id === "C", collapsed: new Set() });
  const handle = attachA11y(g, { root, svg });

  assert.equal(svg.getAttribute("role"), "application");
  assert.equal(svg.getAttribute("aria-roledescription"), "graph");
  assert.ok(svg.getAttribute("aria-label"));
  const nodesG = svg.querySelector(".smv-nodes");
  assert.equal(nodesG.getAttribute("role"), "tree");

  const els = svg.querySelectorAll(".smv-node");
  const byId = new Map(els.map((el) => [el.getAttribute("data-id"), el]));
  assert.equal(byId.get("A").getAttribute("role"), "treeitem");
  assert.equal(byId.get("A").getAttribute("aria-label"), "A · active");
  assert.equal(byId.get("c1").getAttribute("aria-level"), "2", "c1's parent is C, so depth+1 = 2");
  assert.equal(byId.get("C").getAttribute("aria-expanded"), "true", "C is expanded (not in collapsed set)");
  assert.equal(byId.get("A").getAttribute("aria-expanded"), null, "non-container carries no aria-expanded");

  // Roving tabindex: reading order is x-sorted A,C,c1 — A (x=0) starts current.
  assert.equal(byId.get("A").getAttribute("tabindex"), "0");
  assert.equal(byId.get("C").getAttribute("tabindex"), "-1");

  handle.destroy();
  assert.equal(svg.getAttribute("role"), null, "destroy strips what it owns");
  assert.equal(byId.get("A").getAttribute("tabindex"), null);
});

test("attachA11y: ArrowRight/ArrowLeft/Home/End move the roving tabindex in reading order", () => {
  const doc = new FakeDocument();
  const ids = ["A", "B", "C"];
  const pos = { A: { x: 0, y: 0 }, B: { x: 10, y: 0 }, C: { x: 20, y: 0 } };
  const svg = fakeSvg(doc, ids, pos);
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const g = fakeG({ ids, pos, specNodes: ids.map((id) => ({ id, label: id })) });
  attachA11y(g, { root, svg });

  const els = new Map(svg.querySelectorAll(".smv-node").map((el) => [el.getAttribute("data-id"), el]));
  const current = () => [...els.entries()].find(([, el]) => el.getAttribute("tabindex") === "0")[0];

  assert.equal(current(), "A");
  svg.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(current(), "B");
  svg.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(current(), "C");
  svg.dispatch("keydown", { key: "ArrowRight" }); // clamps at the end
  assert.equal(current(), "C");
  svg.dispatch("keydown", { key: "Home" });
  assert.equal(current(), "A");
  svg.dispatch("keydown", { key: "End" });
  assert.equal(current(), "C");
  svg.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(current(), "B");
  assert.ok(els.get("B")._focused, "focus() follows the roving tabindex");
});

test("attachA11y: Enter/Space toggle expand/collapse on containers only, via public g.expand/collapse", () => {
  const doc = new FakeDocument();
  const ids = ["C"];
  const pos = { C: { x: 0, y: 0 } };
  const svg = fakeSvg(doc, ids, pos);
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const collapsed = new Set(["C"]);
  const g = fakeG({ ids, pos, specNodes: [{ id: "C", label: "C" }], isContainer: () => true, collapsed });
  attachA11y(g, { root, svg });

  svg.dispatch("keydown", { key: "Enter" }); // collapsed -> expand
  assert.deepEqual(g._calls.expand, ["C"]);
  assert.deepEqual(g._calls.collapse, []);

  collapsed.delete("C"); // simulate the resulting state
  svg.dispatch("keydown", { key: " " }); // expanded -> collapse
  assert.deepEqual(g._calls.collapse, ["C"]);
});

test("attachA11y: re-applies attrs on the 'commit' event against fresh elements", () => {
  const doc = new FakeDocument();
  const ids = ["A"];
  const svg = fakeSvg(doc, ids, { A: { x: 0, y: 0 } });
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const g = fakeG({ ids, pos: { A: { x: 0, y: 0 } }, specNodes: [{ id: "A", label: "A" }] });
  attachA11y(g, { root, svg });

  // The renderer re-creates elements across commits (keyed by id) — simulate that here.
  const nodesG = svg.querySelector(".smv-nodes");
  nodesG.children[0].remove();
  const fresh = doc.createElement("g");
  fresh.setAttribute("class", "smv-node");
  fresh.setAttribute("data-id", "A");
  nodesG.appendChild(fresh);
  assert.equal(fresh.getAttribute("role"), null);

  g.emit("commit", {});
  assert.equal(fresh.getAttribute("role"), "treeitem");
  assert.equal(fresh.getAttribute("tabindex"), "0");
});

test("attachA11y: arrow-key navigation follows rank-major order for a TB layout, not raw x", () => {
  const doc = new FakeDocument();
  const ids = ["A", "B", "C"];
  const pos = { A: { x: 0, y: 0 }, B: { x: 50, y: 0 }, C: { x: 25, y: 80 } };
  const svg = fakeSvg(doc, ids, pos);
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const g = fakeG({ ids, pos, specNodes: ids.map((id) => ({ id, label: id })) });
  g.layoutResult = () => ({ nodes: pos, order: [["A", "B"], ["C"]] });
  attachA11y(g, { root, svg });

  const els = new Map(svg.querySelectorAll(".smv-node").map((el) => [el.getAttribute("data-id"), el]));
  const current = () => [...els.entries()].find(([, el]) => el.getAttribute("tabindex") === "0")[0];

  assert.equal(current(), "A", "rank 0's first sibling, not the smallest x overall");
  svg.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(current(), "B", "next in the SAME rank, though C has a smaller x than B");
  svg.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(current(), "C", "rank 1 comes after all of rank 0");
});

// ---------------------------------------------------------------------------
// attachA11y — aria-live region
// ---------------------------------------------------------------------------

test("attachA11y: injects a visually-hidden role=status live region", () => {
  const doc = new FakeDocument();
  const ids = ["A"];
  const svg = fakeSvg(doc, ids, { A: { x: 0, y: 0 } });
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const g = fakeG({ ids, pos: { A: { x: 0, y: 0 } }, specNodes: [{ id: "A", label: "A" }] });
  const handle = attachA11y(g, { root, svg });

  const live = root.children.find((c) => c.getAttribute("role") === "status");
  assert.ok(live, "a role=status element is appended near the svg");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.ok((live.getAttribute("class") || "").includes("smv-a11y-live"));

  handle.destroy();
  assert.ok(!root.children.includes(live), "destroy removes the live region");
});

test("attachA11y: onRunStatus announces started/finished into the live region, coalescing a same-tick burst", async () => {
  const doc = new FakeDocument();
  const ids = ["A", "B"];
  const svg = fakeSvg(doc, ids, { A: { x: 0, y: 0 }, B: { x: 10, y: 0 } });
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const specNodes = [{ id: "A", label: "Ingest" }, { id: "B", label: "Clean" }];
  const g = fakeG({ ids, pos: { A: { x: 0, y: 0 }, B: { x: 10, y: 0 } }, specNodes });
  attachA11y(g, { root, svg });

  const live = root.children.find((c) => c.getAttribute("role") === "status");

  g.emit("runstatus", { id: "A", status: "active" });
  assert.equal(live.textContent, "", "not written synchronously — coalesced to the next microtask");
  await Promise.resolve();
  assert.equal(live.textContent, "Ingest started");

  // A burst in the same tick (e.g. a fan-out step landing on two nodes at once) joins
  // into one announcement instead of two separate writes.
  g.emit("runstatus", { id: "A", status: "done" });
  g.emit("runstatus", { id: "B", status: "active" });
  await Promise.resolve();
  assert.equal(live.textContent, "Ingest finished. Clean started");

  // "pending" (a reset) is not an announced transition.
  g.emit("runstatus", { id: "A", status: "pending" });
  await Promise.resolve();
  assert.equal(live.textContent, "Ingest finished. Clean started", "pending is silent");
});

test("attachA11y: a failed run status is announced and reaches the accessible name — no special-casing", async () => {
  const doc = new FakeDocument();
  const ids = ["A"];
  const svg = fakeSvg(doc, ids, { A: { x: 0, y: 0 } });
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const g = fakeG({ ids, pos: { A: { x: 0, y: 0 } }, specNodes: [{ id: "A", label: "Ingest" }] });
  attachA11y(g, { root, svg });
  const live = root.children.find((c) => c.getAttribute("role") === "status");

  g.emit("runstatus", { id: "A", status: "active" });
  await Promise.resolve();

  // run-render.js writes data-run to the element, THEN emits 'runstatus' — same order here.
  const el = svg.querySelectorAll(".smv-node").find((n) => n.getAttribute("data-id") === "A");
  el.setAttribute("data-run", "failed");
  g.emit("runstatus", { id: "A", status: "failed" });
  await Promise.resolve();

  assert.equal(live.textContent, "Ingest failed");
  assert.equal(el.getAttribute("aria-label"), "Ingest · failed", "the live status wins in the accessible name");
});

test("attachA11yTable: the status column carries 'failed' straight off the data-run channel", () => {
  const doc = new FakeDocument();
  const root = fakeRoot(doc);
  const svg = fakeSvg(doc, ["A"], { A: { x: 0, y: 0 } });
  root.appendChild(svg);
  const g = fakeG({ ids: ["A"], specNodes: [{ id: "A", label: "Ingest" }], edges: [] });
  g.el = root;

  const handle = attachA11yTable(g);
  const tbody = handle.el.children.find((c) => c.tagName === "tbody");

  svg.querySelectorAll(".smv-node")[0].setAttribute("data-run", "failed");
  g.emit("runstatus", { id: "A", status: "failed" });
  assert.equal(tbody.children[0].children[1].textContent, "failed");
  assert.equal(computeRows(g)[0].status, "failed");
});

test("attachA11y: a queued live-region flush after destroy() is a no-op, not a write to a detached node", async () => {
  const doc = new FakeDocument();
  const ids = ["A"];
  const svg = fakeSvg(doc, ids, { A: { x: 0, y: 0 } });
  const root = fakeRoot(doc);
  root.appendChild(svg);
  const g = fakeG({ ids, pos: { A: { x: 0, y: 0 } }, specNodes: [{ id: "A", label: "A" }] });
  const handle = attachA11y(g, { root, svg });

  g.emit("runstatus", { id: "A", status: "active" });
  handle.destroy(); // must not throw when the queued microtask flush lands afterward
  await Promise.resolve();
});

// ---------------------------------------------------------------------------
// attachA11yTable — lightweight fake-DOM smoke
// ---------------------------------------------------------------------------

test("attachA11yTable: no-op under Node / missing root ownerDocument", () => {
  const h = attachA11yTable({ el: { appendChild() {} } });
  assert.equal(h.el, null);
  h.destroy();
});

test("attachA11yTable: appends a table with a caption + one row per visible node, hidden by default", () => {
  const doc = new FakeDocument();
  const root = fakeRoot(doc);
  const specNodes = [{ id: "A", label: "A", data: { status: "done", duration: "1h" } }, { id: "B", label: "B" }];
  const edges = [{ id: "e1", source: "A", target: "B" }];
  const g = fakeG({ ids: ["A", "B"], specNodes, edges });
  g.el = root;

  const handle = attachA11yTable(g);
  assert.ok(handle.el, "returns the table element");
  assert.ok(root.children.includes(handle.el), "appended into the mount root");
  assert.ok((handle.el.getAttribute("class") || "").includes("smv-a11y-table-hidden"), "visually-hidden by default");

  const caption = handle.el.children.find((c) => c.tagName === "caption");
  assert.ok(caption && caption.textContent);
  const tbody = handle.el.children.find((c) => c.tagName === "tbody");
  assert.equal(tbody.children.length, 2);
  const firstRowCells = tbody.children[0].children.map((td) => td.textContent);
  assert.deepEqual(firstRowCells, ["A", "done", "1h", "0", "B"]);

  handle.destroy();
  assert.ok(!root.children.includes(handle.el), "destroy removes the table");
});

test("attachA11yTable: visible:true skips the hidden class; rows refresh on 'commit'/'update'", () => {
  const doc = new FakeDocument();
  const root = fakeRoot(doc);
  const specNodes = [{ id: "A", label: "A" }];
  const g = fakeG({ ids: ["A"], specNodes, edges: [] });
  g.el = root;

  const handle = attachA11yTable(g, { visible: true });
  assert.ok(!(handle.el.getAttribute("class") || "").includes("smv-a11y-table-hidden"));

  // Mutate what computeRows will see, then fire the sync events.
  specNodes[0].label = "A renamed";
  g.emit("commit", {});
  const tbody = handle.el.children.find((c) => c.tagName === "tbody");
  assert.equal(tbody.children[0].children[0].textContent, "A renamed");

  specNodes[0].label = "A again";
  g.emit("update", {});
  assert.equal(tbody.children[0].children[0].textContent, "A again");
});

test("attachA11yTable: is THE accessible surface — rows refresh on 'runstatus' and prefer the live data-run status", () => {
  const doc = new FakeDocument();
  const root = fakeRoot(doc);
  const specNodes = [{ id: "A", label: "A", data: { status: "done" } }];
  const svg = fakeSvg(doc, ["A"], { A: { x: 0, y: 0 } });
  root.appendChild(svg);
  const g = fakeG({ ids: ["A"], specNodes, edges: [] });
  g.el = root;

  const handle = attachA11yTable(g);
  const tbody = handle.el.children.find((c) => c.tagName === "tbody");
  assert.equal(tbody.children[0].children[1].textContent, "done", "no run yet: falls back to spec status");

  // run-render.js writes data-run to the node's element, THEN emits 'runstatus'.
  svg.querySelectorAll(".smv-node")[0].setAttribute("data-run", "active");
  g.emit("runstatus", { id: "A", status: "active" });
  assert.equal(tbody.children[0].children[1].textContent, "active", "refreshed on 'runstatus', live status wins");
});
