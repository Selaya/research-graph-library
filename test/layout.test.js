import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { layout } from "../src/layout.js";
import { fixtureDiamond, fixtureLoop, fixtureSelfLoop, OPTS } from "./golden/fixtures.js";
import { countCrossings } from "./golden/crossing.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function golden(name) {
  return JSON.parse(readFileSync(path.join(dir, "golden", `${name}.json`), "utf8"));
}

/** Shape layout()'s output to compare against the golden json (Set -> sorted array). */
function toComparable(result) {
  return {
    nodes: result.nodes,
    edges: result.edges,
    bounds: result.bounds,
    reversedEdgeIds: [...result.reversedEdgeIds].sort(),
  };
}

test("layout(diamond) matches golden snapshot", () => {
  const result = layout(fixtureDiamond(), OPTS);
  const { crossings, ...expected } = golden("diamond");
  assert.deepEqual(toComparable(result), expected);
});

test("layout(loop) matches golden snapshot", () => {
  const result = layout(fixtureLoop(), OPTS);
  assert.deepEqual(toComparable(result), golden("loop"));
});

test("layout(selfloop) matches golden snapshot", () => {
  const result = layout(fixtureSelfLoop(), OPTS);
  assert.deepEqual(toComparable(result), golden("selfloop"));
});

test("crossing count for the diamond fixture is at or below the golden count", () => {
  const result = layout(fixtureDiamond(), OPTS);
  const forward = Object.values(result.edges).filter((e) => !e.reversed).map((e) => e.points);
  const count = countCrossings(forward);
  const { crossings } = golden("diamond");
  assert.ok(count <= crossings, `expected <= ${crossings} crossings, got ${count}`);
});

test("back edge: reversed flag set, every arc point at-or-below both endpoint centers (LR)", () => {
  const view = fixtureLoop();
  const result = layout(view, OPTS);
  const edge = result.edges.eLoop;
  assert.equal(edge.reversed, true);
  assert.ok(result.reversedEdgeIds.has("eLoop"));
  const src = result.nodes.N5, tgt = result.nodes.N2; // eLoop: source N5, target N2
  for (const p of edge.points) {
    assert.ok(p.y >= src.y - 0.01, `point ${JSON.stringify(p)} sits above the source center`);
    assert.ok(p.y >= tgt.y - 0.01, `point ${JSON.stringify(p)} sits above the target center`);
  }
});

test("self-loop: reversed flag set, every arc point at-or-below the node's own center", () => {
  const view = fixtureSelfLoop();
  const result = layout(view, OPTS);
  const edge = result.edges.eQQ;
  assert.equal(edge.reversed, true);
  const q = result.nodes.Q;
  for (const p of edge.points) {
    assert.ok(p.y >= q.y - 0.01, `point ${JSON.stringify(p)} sits above the node center`);
  }
});

test("appending 5 nodes one at a time (pinned forward) never flips which edge is reversed, arc stays below", () => {
  let pinned;
  let pinnedEdgeId = null;
  for (let extra = 1; extra <= 5; extra++) {
    const view = fixtureLoop(extra);
    const result = layout(view, { ...OPTS, pinnedReversals: pinned });
    const ids = [...result.reversedEdgeIds];
    assert.equal(ids.length, 1, `expected exactly one reversed edge at extra=${extra}, got [${ids}]`);
    if (pinnedEdgeId === null) pinnedEdgeId = ids[0];
    assert.equal(ids[0], pinnedEdgeId, `reversed edge changed at extra=${extra}`);

    const edgeSpec = view.edges.find((e) => e.id === pinnedEdgeId);
    const edge = result.edges[pinnedEdgeId];
    const src = result.nodes[edgeSpec.source], tgt = result.nodes[edgeSpec.target];
    for (const p of edge.points) {
      assert.ok(p.y >= src.y - 0.01);
      assert.ok(p.y >= tgt.y - 0.01);
    }
    pinned = result.reversedEdgeIds;
  }
});
