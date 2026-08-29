import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, GraphError, isConvex } from "../src/store.js";

function isCode(code) {
  return (err) => err instanceof GraphError && err.code === code;
}

// ---- validation ----

test("validation: rejects duplicate node ids", () => {
  assert.throws(() => new Store({ nodes: [{ id: "a" }, { id: "a" }], edges: [] }), isCode("dup-id"));
});

test("validation: rejects duplicate edge ids", () => {
  assert.throws(() => new Store({
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [{ id: "e1", source: "a", target: "b" }, { id: "e1", source: "b", target: "c" }],
  }), isCode("dup-id"));
});

test("validation: rejects dangling edge source/target", () => {
  assert.throws(() => new Store({
    nodes: [{ id: "a" }],
    edges: [{ id: "e1", source: "a", target: "missing" }],
  }), isCode("dangling"));
  assert.throws(() => new Store({
    nodes: [{ id: "a" }],
    edges: [{ id: "e1", source: "missing", target: "a" }],
  }), isCode("dangling"));
});

test("validation: rejects an unbounded loop edge, accepts a bounded one", () => {
  assert.throws(() => new Store({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "e1", source: "a", target: "b", loop: true }],
  }), isCode("unbounded-loop"));
  const s = new Store({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "e1", source: "a", target: "b", loop: true, maxIterations: 5 }],
  });
  assert.equal(s.edge("e1").maxIterations, 5);
});

test("validation: rejects a parent containment cycle", () => {
  assert.throws(() => new Store({
    nodes: [{ id: "a", parent: "b" }, { id: "b", parent: "a" }],
    edges: [],
  }), isCode("parent-cycle"));
  // self-parenting is the degenerate 1-node cycle
  assert.throws(() => new Store({ nodes: [{ id: "a", parent: "a" }], edges: [] }), isCode("parent-cycle"));
});

test("validation: rejects a dangling parent reference", () => {
  assert.throws(() => new Store({ nodes: [{ id: "a", parent: "nope" }], edges: [] }), isCode("dangling"));
});

// ---- mutations ----

test("mutations: addNode/addEdge/update/removeEdge", () => {
  const s = new Store({ nodes: [{ id: "a" }], edges: [] });
  s.addNode({ id: "b", data: { status: "pending" } });
  s.addEdge({ id: "e1", source: "a", target: "b" });
  assert.ok(s.hasNode("b"));
  assert.equal(s.edge("e1").source, "a");

  s.update("b", { data: { status: "done" } });
  assert.deepEqual(s.node("b").data, { status: "done" });
  s.update("b", { data: { note: "x" } }); // data patches merge, not replace
  assert.deepEqual(s.node("b").data, { status: "done", note: "x" });

  s.removeEdge("e1");
  assert.equal(s.edge("e1"), undefined);
  assert.throws(() => s.removeEdge("e1"), isCode("missing"));
});

test("mutations: addNode rejects duplicate id and dangling parent", () => {
  const s = new Store({ nodes: [{ id: "a" }], edges: [] });
  assert.throws(() => s.addNode({ id: "a" }), isCode("dup-id"));
  assert.throws(() => s.addNode({ id: "c", parent: "nope" }), isCode("dangling"));
});

test("mutations: addEdge rejects dangling endpoints and unbounded loop", () => {
  const s = new Store({ nodes: [{ id: "a" }, { id: "b" }], edges: [] });
  assert.throws(() => s.addEdge({ id: "e1", source: "a", target: "x" }), isCode("dangling"));
  assert.throws(() => s.addEdge({ id: "e2", source: "a", target: "b", loop: true }), isCode("unbounded-loop"));
});

test("mutations: update on a missing id throws", () => {
  const s = new Store({ nodes: [{ id: "a" }], edges: [] });
  assert.throws(() => s.update("nope", { data: {} }), isCode("missing"));
});

test("removeNode: cascades to descendants and their incident edges", () => {
  const s = new Store({
    nodes: [
      { id: "parent" },
      { id: "child1", parent: "parent" },
      { id: "grandchild", parent: "child1" },
      { id: "outside" },
    ],
    edges: [
      { id: "e1", source: "outside", target: "child1" },
      { id: "e2", source: "grandchild", target: "outside" },
    ],
  });

  const removed = s.removeNode("parent");
  assert.deepEqual(new Set(removed), new Set(["parent", "child1", "grandchild"]));
  assert.equal(s.hasNode("parent"), false);
  assert.equal(s.hasNode("child1"), false);
  assert.equal(s.hasNode("grandchild"), false);
  assert.equal(s.hasNode("outside"), true);
  assert.equal(s.edge("e1"), undefined);
  assert.equal(s.edge("e2"), undefined);
});

test("removeNode: missing id throws", () => {
  const s = new Store({ nodes: [{ id: "a" }], edges: [] });
  assert.throws(() => s.removeNode("nope"), isCode("missing"));
});

// ---- snapshot/restore ----

test("snapshot/restore: round-trips the spec exactly", () => {
  const s = new Store({
    nodes: [{ id: "a", data: { x: 1 } }, { id: "b" }],
    edges: [{ id: "e1", source: "a", target: "b" }],
  });
  const snap = s.snapshot();
  s.addNode({ id: "c" });
  s.addEdge({ id: "e2", source: "b", target: "c" });
  s.update("a", { data: { x: 2 } });

  s.restore(snap);
  assert.equal(s.hasNode("c"), false);
  assert.equal(s.edge("e2"), undefined);
  assert.deepEqual(s.node("a").data, { x: 1 });
  assert.deepEqual(s.spec(), snap);
});

test("snapshot: is a structural clone (mutating it does not affect the store)", () => {
  const s = new Store({ nodes: [{ id: "a", data: { x: 1 } }], edges: [] });
  const snap = s.snapshot();
  snap.nodes[0].data.x = 999;
  assert.equal(s.node("a").data.x, 1);
});

// ---- condense ----

test("condense: convexity guard throws non-convex for A->B->C condensing {A,C}", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [{ id: "e1", source: "A", target: "B" }, { id: "e2", source: "B", target: "C" }],
  });
  assert.equal(isConvex(s, new Set(["A", "C"])), false);
  assert.throws(() => s.condense(["A", "C"], { id: "AC" }), isCode("non-convex"));
  // rejection must not mutate the store
  assert.ok(s.hasNode("A") && s.hasNode("B") && s.hasNode("C"));
  assert.equal(s.edges.size, 2);
});

test("condense: a legal (convex) condense redirects and dedupes edges with weights", () => {
  const s = new Store({
    nodes: [{ id: "X" }, { id: "Y1" }, { id: "Y2" }, { id: "Z" }],
    edges: [
      { id: "e1", source: "X", target: "Y1" },
      { id: "e2", source: "X", target: "Y2" },
      { id: "e3", source: "Y1", target: "Z" },
      { id: "e4", source: "Y2", target: "Z" },
    ],
  });
  assert.ok(isConvex(s, new Set(["Y1", "Y2"])));

  const { merged, removedNodes, newEdges } = s.condense(["Y1", "Y2"], { id: "Y", label: "Merged" });
  assert.equal(merged.id, "Y");
  assert.deepEqual(new Set(removedNodes), new Set(["Y1", "Y2"]));
  assert.equal(s.hasNode("Y1"), false);
  assert.equal(s.hasNode("Y2"), false);
  assert.equal(s.hasNode("Y"), true);

  assert.equal(newEdges.length, 2);
  const byPair = Object.fromEntries(newEdges.map((e) => [`${e.source}->${e.target}`, e]));
  assert.equal(byPair["X->Y"].weight, 2);
  assert.equal(byPair["Y->Z"].weight, 2);

  // no leftover edges into/out of the condensed originals
  for (const e of s.edges.values()) {
    assert.notEqual(e.source, "Y1"); assert.notEqual(e.source, "Y2");
    assert.notEqual(e.target, "Y1"); assert.notEqual(e.target, "Y2");
  }
});

test("condense: a single-fanin edge is not weighted (weight stays undefined)", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [{ id: "e1", source: "A", target: "B" }, { id: "e2", source: "B", target: "C" }],
  });
  const { newEdges } = s.condense(["B"], { id: "B2" });
  assert.equal(newEdges.length, 2);
  for (const e of newEdges) assert.equal(e.weight, undefined);
});

test("condense: throws on a missing source id or a duplicate target id", () => {
  const s = new Store({ nodes: [{ id: "A" }, { id: "B" }], edges: [] });
  assert.throws(() => s.condense(["nope"], { id: "X" }), isCode("missing"));
  assert.throws(() => s.condense(["A"], { id: "B" }), isCode("dup-id"));
});
