import { test } from "node:test";
import assert from "node:assert/strict";
import { breakCycles, isAcyclic } from "../src/cycles.js";

test("breakCycles: acyclic graph reverses nothing", () => {
  const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "B", target: "C" },
  ];
  const reversed = breakCycles(nodes, edges);
  assert.equal(reversed.size, 0);
  assert.ok(isAcyclic(nodes, edges, reversed));
});

test("breakCycles: a simple cycle gets exactly one reversal", () => {
  const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "B", target: "C" },
    { id: "e3", source: "C", target: "A" },
  ];
  const reversed = breakCycles(nodes, edges);
  assert.equal(reversed.size, 1);
  assert.ok(isAcyclic(nodes, edges, reversed));
});

test("breakCycles: loop:true edges are always tagged reversed", () => {
  const nodes = [{ id: "A" }, { id: "B" }];
  const edges = [
    { id: "eAB", source: "A", target: "B" },
    { id: "eBA", source: "B", target: "A", loop: true, maxIterations: 5 },
  ];
  const reversed = breakCycles(nodes, edges);
  assert.equal(reversed.size, 1);
  assert.ok(reversed.has("eBA"), "the explicit loop edge must be the one tagged reversed");
  assert.ok(isAcyclic(nodes, edges, reversed));
});

test("breakCycles: self-loops are ignored (never enter ranking)", () => {
  const nodes = [{ id: "A" }, { id: "B" }];
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "eSelf", source: "B", target: "B" },
  ];
  const reversed = breakCycles(nodes, edges);
  assert.equal(reversed.size, 0);
  assert.ok(isAcyclic(nodes, edges, reversed));
});

test("breakCycles: reversal choice is stable across re-runs when unrelated nodes/edges are appended", () => {
  const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "B", target: "C" },
    { id: "e3", source: "C", target: "A" },
  ];
  const first = breakCycles(nodes, edges);
  assert.equal(first.size, 1);
  const pinnedEdgeId = [...first][0];

  let pinned = first;
  let curNodes = nodes, curEdges = edges;
  for (let i = 1; i <= 5; i++) {
    curNodes = [...curNodes, { id: `D${i}` }];
    curEdges = [...curEdges, { id: `eD${i}`, source: "C", target: `D${i}` }];
    const reversed = breakCycles(curNodes, curEdges, pinned);
    assert.equal(reversed.size, 1, `unexpected extra reversal at step ${i}`);
    assert.ok(reversed.has(pinnedEdgeId), `reversed edge flipped away from "${pinnedEdgeId}" at step ${i}`);
    assert.ok(isAcyclic(curNodes, curEdges, reversed));
    pinned = reversed;
  }
});

test("isAcyclic: sanity checks", () => {
  const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const cyclic = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "B", target: "C" },
    { id: "e3", source: "C", target: "A" },
  ];
  assert.equal(isAcyclic(nodes, cyclic), false);
  assert.ok(isAcyclic(nodes, cyclic, new Set(["e3"])));
  // A self-loop never makes an otherwise-acyclic graph report cyclic.
  const withSelfLoop = [...cyclic.slice(0, 2), { id: "eSelf", source: "A", target: "A" }];
  assert.ok(isAcyclic(nodes, withSelfLoop));
});
