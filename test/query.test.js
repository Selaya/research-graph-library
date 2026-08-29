import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { makeQuery } from "../src/query.js";

function fixture() {
  return new Store({
    nodes: [
      { id: "ingest", data: { status: "done" } },
      { id: "clean", collapsed: true, data: { status: "active" } },
      { id: "clean.dedupe", parent: "clean", data: { status: "done" } },
      { id: "clean.validate", parent: "clean", data: { status: "pending" } },
      { id: "clean.normalize", parent: "clean", data: { status: "pending", note: "x" } },
      { id: "report", join: "all", data: { status: "pending" } },
    ],
    edges: [
      { id: "e1", source: "ingest", target: "clean", data: { kind: "flow" } },
      { id: "e2", source: "clean", target: "report", loop: true, maxIterations: 3 },
    ],
  });
}

test("nodes(): no filter returns every node as a plain copy", () => {
  const q = makeQuery(fixture());
  const all = q.nodes();
  assert.equal(all.length, 6);
  assert.deepEqual(all.map((n) => n.id).sort(), [
    "clean", "clean.dedupe", "clean.normalize", "clean.validate", "ingest", "report",
  ]);
});

test("nodes(): predicate filter", () => {
  const q = makeQuery(fixture());
  const pending = q.nodes((n) => n.data?.status === "pending");
  assert.deepEqual(pending.map((n) => n.id).sort(), ["clean.normalize", "clean.validate", "report"]);
});

test("nodes(): match-object filter on top-level fields", () => {
  const q = makeQuery(fixture());
  const collapsed = q.nodes({ collapsed: true });
  assert.deepEqual(collapsed.map((n) => n.id), ["clean"]);
  const inClean = q.nodes({ parent: "clean" });
  assert.deepEqual(inClean.map((n) => n.id).sort(), ["clean.dedupe", "clean.normalize", "clean.validate"]);
});

test("nodes(): match-object filter shallow-matches under `data`", () => {
  const q = makeQuery(fixture());
  const done = q.nodes({ data: { status: "done" } });
  assert.deepEqual(done.map((n) => n.id).sort(), ["clean.dedupe", "ingest"]);
  // a second data key narrows further (both must match)
  const narrowed = q.nodes({ data: { status: "pending", note: "x" } });
  assert.deepEqual(narrowed.map((n) => n.id), ["clean.normalize"]);
});

test("nodes(): a node with no `data` never matches a data filter", () => {
  const s = new Store({ nodes: [{ id: "bare" }, { id: "withData", data: { status: "done" } }], edges: [] });
  const q = makeQuery(s);
  assert.deepEqual(q.nodes({ data: { status: "done" } }).map((n) => n.id), ["withData"]);
});

test("edges(): predicate and match-object filters, including `loop`", () => {
  const q = makeQuery(fixture());
  assert.deepEqual(q.edges({ loop: true }).map((e) => e.id), ["e2"]);
  assert.deepEqual(q.edges((e) => e.source === "ingest").map((e) => e.id), ["e1"]);
  assert.deepEqual(q.edges({ data: { kind: "flow" } }).map((e) => e.id), ["e1"]);
});

test("children(): direct children only, not grandchildren", () => {
  const s = new Store({
    nodes: [{ id: "P" }, { id: "c1", parent: "P" }, { id: "c2", parent: "P" }, { id: "gc", parent: "c1" }],
    edges: [],
  });
  const q = makeQuery(s);
  assert.deepEqual(q.children("P").map((n) => n.id).sort(), ["c1", "c2"]);
  assert.deepEqual(q.children("c1").map((n) => n.id), ["gc"]);
  assert.deepEqual(q.children("gc"), []);
});

test("descendants(): every nested descendant, never the node itself", () => {
  const q = makeQuery(fixture());
  assert.deepEqual(
    q.descendants("clean").map((n) => n.id).sort(),
    ["clean.dedupe", "clean.normalize", "clean.validate"],
  );
  assert.deepEqual(q.descendants("clean.dedupe"), [], "a leaf has no descendants");

  const s = new Store({
    nodes: [{ id: "P" }, { id: "c1", parent: "P" }, { id: "gc1", parent: "c1" }, { id: "gc2", parent: "c1" }],
    edges: [],
  });
  const q2 = makeQuery(s);
  const desc = q2.descendants("P").map((n) => n.id).sort();
  assert.deepEqual(desc, ["c1", "gc1", "gc2"]);
});

test("roots(): nodes with no parent", () => {
  const q = makeQuery(fixture());
  assert.deepEqual(q.roots().map((n) => n.id).sort(), ["clean", "ingest", "report"]);
});

test("returns copies, not live references — mutating a result never touches the store", () => {
  const s = fixture();
  const q = makeQuery(s);
  const n = q.nodes({ data: { status: "done" } })[0];
  n.data.status = "MUTATED";
  n.label = "MUTATED";
  const again = q.nodes((x) => x.id === n.id)[0];
  assert.notEqual(again.data.status, "MUTATED");
  assert.notEqual(again.label, "MUTATED");

  const e = q.edges()[0];
  e.data ? (e.data.kind = "MUTATED") : null;
  const eAgain = q.edges((x) => x.id === e.id)[0];
  assert.notEqual(eAgain.data?.kind, "MUTATED");
});

test("live against the store: reflects mutations made after makeQuery() was called", () => {
  const s = new Store({ nodes: [{ id: "a" }], edges: [] });
  const q = makeQuery(s);
  assert.equal(q.nodes().length, 1);
  s.addNode({ id: "b", data: { status: "done" } });
  assert.equal(q.nodes().length, 2);
  assert.deepEqual(q.nodes({ data: { status: "done" } }).map((n) => n.id), ["b"]);
});
