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

test("update: rejects a dangling parent and a containment cycle, leaving the record untouched", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "B", parent: "A" }, { id: "X" }],
    edges: [{ id: "e1", source: "X", target: "B" }],
  });
  // Re-parenting a container under its own child would close a cycle the view walks forever.
  assert.throws(() => s.update("A", { parent: "B" }), isCode("parent-cycle"));
  assert.throws(() => s.update("A", { parent: "A" }), isCode("parent-cycle"));
  assert.throws(() => s.update("B", { parent: "nope" }), isCode("dangling"));
  assert.equal(s.node("A").parent, undefined, "a rejected patch must not have been written");
  assert.equal(s.node("B").parent, "A");

  // A legal reparent still goes through.
  s.update("X", { parent: "A" });
  assert.equal(s.node("X").parent, "A");
});

test("update: rejects a dangling edge source/target", () => {
  const s = new Store({
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [{ id: "e1", source: "A", target: "B" }],
  });
  assert.throws(() => s.update("e1", { target: "ZZZ" }), isCode("dangling"));
  assert.throws(() => s.update("e1", { source: "ZZZ" }), isCode("dangling"));
  assert.equal(s.edge("e1").target, "B", "a rejected patch must not have been written");
  s.update("e1", { target: "C" });
  assert.equal(s.edge("e1").target, "C");
  // …and the store still round-trips, which a dangling endpoint would have broken.
  s.restore(s.snapshot());
  assert.equal(s.edge("e1").target, "C");
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

test("condense: a container's boundary edges redirect through its swallowed children", () => {
  // The demo topology: `clean` is a container; every edge crossing its boundary is
  // attached to a CHILD, so condensing the container must redirect those, not drop them.
  const s = new Store({
    nodes: [
      { id: "ingest" },
      { id: "clean" },
      { id: "clean.dedupe", parent: "clean" },
      { id: "clean.validate", parent: "clean" },
      { id: "clean.normalize", parent: "clean" },
      { id: "collect" },
    ],
    edges: [
      { id: "e1", source: "ingest", target: "clean.dedupe" },
      { id: "e2", source: "clean.dedupe", target: "clean.validate" },
      { id: "e3", source: "clean.validate", target: "clean.normalize" },
      { id: "e4", source: "clean.normalize", target: "collect" },
    ],
  });

  const { removedNodes, newEdges } = s.condense(["clean"], { id: "clean.auto" });
  assert.deepEqual(new Set(removedNodes), new Set(["clean", "clean.dedupe", "clean.validate", "clean.normalize"]));
  assert.deepEqual(
    newEdges.map((e) => `${e.source}->${e.target}`).sort(),
    ["clean.auto->collect", "ingest->clean.auto"],
  );
  assert.deepEqual(
    [...s.edges.values()].map((e) => `${e.source}->${e.target}`).sort(),
    ["clean.auto->collect", "ingest->clean.auto"],
    "the pipeline must stay connected, not fall into islands",
  );
  for (const e of newEdges) assert.equal(e.weight, undefined, "one edge per side, so no weight");
});

test("condense: convexity is judged on the containment closure too", () => {
  // The path ingest -> C(c1) -> mid -> C(c2) leaves the set and re-enters through children.
  const s = new Store({
    nodes: [
      { id: "C" }, { id: "c1", parent: "C" }, { id: "c2", parent: "C" }, { id: "mid" },
    ],
    edges: [
      { id: "a", source: "c1", target: "mid" },
      { id: "b", source: "mid", target: "c2" },
    ],
  });
  assert.throws(() => s.condense(["C"], { id: "M" }), isCode("non-convex"));
  assert.ok(s.hasNode("c1") && s.hasNode("c2"), "a rejected condense must not mutate");
  assert.equal(s.edges.size, 2);
});

test("condense: an unsatisfiable merged node is rejected BEFORE anything is deleted", () => {
  const s = new Store({
    nodes: [{ id: "C" }, { id: "c1", parent: "C" }, { id: "c2", parent: "C" }, { id: "X" }],
    edges: [{ id: "e1", source: "X", target: "c1" }],
  });
  // `c1` is swallowed by this very condense, so it can never be the merged node's parent.
  assert.throws(() => s.condense(["C"], { id: "M", parent: "c1" }), isCode("dangling"));
  assert.throws(() => s.condense(["C"], { id: "M", parent: "nope" }), isCode("dangling"));
  assert.throws(() => s.condense(["C"], { id: "" }), isCode("node-id"));

  // The store is exactly as it was — no half-destroyed graph.
  assert.deepEqual([...s.nodes.keys()].sort(), ["C", "X", "c1", "c2"]);
  assert.deepEqual([...s.edges.keys()], ["e1"]);
  assert.equal(s.hasNode("M"), false);
  // …and a legal condense on the same store still works.
  const { merged } = s.condense(["C"], { id: "M" });
  assert.equal(merged.id, "M");
});

test("condense: throws on a missing source id or a duplicate target id", () => {
  const s = new Store({ nodes: [{ id: "A" }, { id: "B" }], edges: [] });
  assert.throws(() => s.condense(["nope"], { id: "X" }), isCode("missing"));
  assert.throws(() => s.condense(["A"], { id: "B" }), isCode("dup-id"));
});

// ---- F29: update() can unset a data key ----

test("update: `data: {key: undefined}` removes the key instead of merging it back", () => {
  const s = new Store({ nodes: [{ id: "a", data: { fail: "boom", duration: "2s" } }], edges: [] });
  s.update("a", { data: { fail: undefined } });
  assert.deepEqual(s.node("a").data, { duration: "2s" });
  assert.equal("fail" in s.node("a").data, false, "the key is gone, not present-and-undefined");
  // …and the record still round-trips through JSON, which `fail: undefined` would not.
  s.restore(s.snapshot());
  assert.deepEqual(s.node("a").data, { duration: "2s" });
});

test("update: `{replace: true}` swaps the whole data payload", () => {
  const s = new Store({ nodes: [{ id: "a", data: { fail: true, duration: "2s" } }], edges: [] });
  s.update("a", { data: { duration: "5s" } }, { replace: true });
  assert.deepEqual(s.node("a").data, { duration: "5s" });
  // Emptying it drops `data` entirely rather than leaving an empty object behind.
  s.update("a", { data: {} }, { replace: true });
  assert.equal(s.node("a").data, undefined);
  assert.equal("data" in s.node("a"), false);
});

test("update: unsetting the last data key drops `data`, and edges get the same treatment", () => {
  const s = new Store({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "e1", source: "a", target: "b", data: { kind: "retry" } }],
  });
  s.update("e1", { data: { kind: undefined } });
  assert.equal(s.edge("e1").data, undefined);
  s.update("e1", { data: { kind: "http" } });
  assert.deepEqual(s.edge("e1").data, { kind: "http" });
});

// ---- F28: condense and `parent: null` / loop edges ----

test("condense: `parent: null` on the merged spec means 'inherit the common parent'", () => {
  const s = new Store({
    nodes: [
      { id: "box" }, { id: "a", parent: "box" }, { id: "b", parent: "box" }, { id: "z" },
    ],
    edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "z" }],
  });
  const { merged } = s.condense(["a", "b"], { id: "ab", parent: null });
  assert.equal(merged.parent, "box", "null is 'absent', not a dangling id");
  assert.equal(s.node("ab").parent, "box");
});

test("condense: `parent: null` on a parentless set stays parentless (and round-trips)", () => {
  const s = new Store({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "e1", source: "a", target: "b" }],
  });
  const { merged } = s.condense(["a", "b"], { id: "ab", parent: null });
  assert.equal(merged.parent, undefined);
  assert.equal("parent" in merged, false);
  s.restore(s.snapshot());
  assert.ok(s.hasNode("ab"));
});

test("condense: an explicit parent still wins over the inherited one", () => {
  const s = new Store({
    nodes: [{ id: "box" }, { id: "other" }, { id: "a", parent: "box" }, { id: "b", parent: "box" }],
    edges: [{ id: "e1", source: "a", target: "b" }],
  });
  const { merged } = s.condense(["a", "b"], { id: "ab", parent: "other" });
  assert.equal(merged.parent, "other");
});

test("condense: sources with different parents warn and land at the top level (F34)", () => {
  const s = new Store({
    nodes: [{ id: "L" }, { id: "R" }, { id: "a", parent: "L" }, { id: "b", parent: "R" }],
    edges: [{ id: "e1", source: "a", target: "b" }],
  });
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    const { merged } = s.condense(["a", "b"], { id: "ab" });
    assert.equal(merged.parent, undefined);
  } finally { console.warn = orig; }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[smv:condense\].*different parents/);
});

test("condense: a naming an explicit parent for a mixed-parent set does not warn", () => {
  const s = new Store({
    nodes: [{ id: "L" }, { id: "R" }, { id: "a", parent: "L" }, { id: "b", parent: "R" }],
    edges: [{ id: "e1", source: "a", target: "b" }],
  });
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try { s.condense(["a", "b"], { id: "ab", parent: "L" }); } finally { console.warn = orig; }
  assert.deepEqual(warns, []);
  assert.equal(s.node("ab").parent, "L");
});

test("isConvex: a loop edge leaving and re-entering the set does not break convexity", () => {
  const s = new Store({
    nodes: [{ id: "a" }, { id: "b" }, { id: "retry" }],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "retry" },
      // The back edge re-enters the set — it is not a path *through* it.
      { id: "e3", source: "retry", target: "a", loop: true, maxIterations: 3 },
    ],
  });
  assert.equal(isConvex(s, new Set(["a", "b"])), true);
  // …and the same shape with a plain (non-loop) back edge is still non-convex.
  const plain = new Store({
    nodes: [{ id: "a" }, { id: "b" }, { id: "retry" }],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "retry" },
      { id: "e3", source: "retry", target: "a" },
    ],
  });
  assert.equal(isConvex(plain, new Set(["a", "b"])), false);
});

test("condense: a retry loop around the set no longer blocks the merge", () => {
  const s = new Store({
    nodes: [{ id: "in" }, { id: "a" }, { id: "b" }, { id: "check" }, { id: "out" }],
    edges: [
      { id: "e0", source: "in", target: "a" },
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "check" },
      { id: "e3", source: "check", target: "a", loop: true, maxIterations: 3 },
      { id: "e4", source: "check", target: "out" },
    ],
  });
  const { merged, newEdges } = s.condense(["a", "b"], { id: "ab" });
  assert.equal(merged.id, "ab");
  // The loop edge is redirected like any other boundary edge, and stays a loop.
  const loop = newEdges.find((e) => e.loop);
  assert.equal(loop.source, "check");
  assert.equal(loop.target, "ab");
  assert.equal(loop.maxIterations, 3);
});

// ---- F31: statusAgg is a first-class container field ----

test("statusAgg survives normalizeSpec/spec() like durationAgg does", () => {
  const s = new Store({
    nodes: [{ id: "box", statusAgg: "latest" }, { id: "a", parent: "box" }],
    edges: [],
  });
  assert.equal(s.node("box").statusAgg, "latest");
  assert.equal(s.spec().nodes[0].statusAgg, "latest");
  s.restore(s.snapshot());
  assert.equal(s.node("box").statusAgg, "latest");
});

test("update(): {replace:true} with `data: undefined` clears the payload (F29)", () => {
  const s = new Store({ nodes: [{ id: "a", data: { x: 1 } }], edges: [] });
  s.update("a", { data: undefined }, { replace: true });
  assert.equal(s.node("a").data, undefined, "cleared like `data: {}` does");
  // Without `replace`, a top-level `data: undefined` is simply nothing to merge.
  s.update("a", { data: { y: 2 } });
  s.update("a", { data: undefined });
  assert.deepEqual(s.node("a").data, { y: 2 });
});
