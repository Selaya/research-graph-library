// The public dagre escape hatch (`sparkle-motion-vizualizer/adapters/dagre`), gated.
//
// DEVIATIONS.md item 9 records that `dagreLayout` reproduces the pre-M3 goldens
// byte-for-byte. Nothing checked it: test/engine-parity.test.js hand-rolls its own copy of
// the dagre invocation instead of importing the shipped adapter, so a botched rankdir or
// dimension mapping in src/adapters/dagre.js could break the escape hatch with the whole
// suite green. The goldens under test/golden/dagre/ are the M2-era `layout()` output
// (commit 01b9911, before the solver swap), verbatim minus the two keys that did not exist
// then — so this file makes that "byte-for-byte" claim something CI re-verifies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dagreSolver, dagreLayout } from "../src/adapters/dagre.js";
import { layout } from "../src/layout.js";
import { fixtureDiamond, fixtureLoop, fixtureSelfLoop, OPTS } from "./golden/fixtures.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const golden = (name) => JSON.parse(readFileSync(path.join(dir, "golden", "dagre", `${name}.json`), "utf8"));

/** The four keys the M2 goldens carry. `order`/`layers` are M3 additions dagre has no
 *  pre-M3 answer for, so they are compared separately below. */
const toComparable = (r) => ({
  nodes: r.nodes,
  edges: r.edges,
  bounds: r.bounds,
  reversedEdgeIds: [...r.reversedEdgeIds].sort(),
});

const FIXTURES = [
  ["diamond", fixtureDiamond],
  ["loop", fixtureLoop],
  ["selfloop", fixtureSelfLoop],
];

for (const [name, fixture] of FIXTURES) {
  test(`dagreLayout(${name}) still reproduces the pre-M3 drawing byte-for-byte`, () => {
    assert.deepEqual(toComparable(dagreLayout(fixture(), OPTS)), golden(name));
  });
}

test("dagreLayout is layout() with dagreSolver in the solver slot, nothing else", () => {
  for (const [, fixture] of FIXTURES) {
    assert.deepEqual(
      toComparable(dagreLayout(fixture(), OPTS)),
      toComparable(layout(fixture(), { ...OPTS, solver: dagreSolver }))
    );
  }
});

test("dagreSolver honours the solver contract: rects, bend chains, per-rank order", () => {
  const input = {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, w: 100, h: 36 })),
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
      { id: "e3", source: "c", target: "d" },
      { id: "long", source: "a", target: "d" },
    ],
  };
  const out = dagreSolver(input, { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 });

  for (const n of input.nodes) {
    const r = out.nodes[n.id];
    for (const k of ["x", "y", "w", "h"]) assert.ok(Number.isFinite(r[k]), `${n.id}.${k}`);
    // w/h come straight back out — the regression this catches is a swapped mapping.
    assert.equal(r.w, n.w, `${n.id}.w round-trips`);
    assert.equal(r.h, n.h, `${n.id}.h round-trips`);
  }
  for (const e of input.edges) assert.ok(out.edges[e.id].points.length >= 2, `${e.id} has a polyline`);
  assert.ok(out.edges.long.points.length > 2, "a multi-rank edge carries bends");

  assert.ok(Array.isArray(out.order) && out.order.length === 4, "one entry per rank");
  assert.deepEqual(out.order, [["a"], ["b"], ["c"], ["d"]]);
});

test("dagreSolver maps every dir onto dagre's rankdir", () => {
  const input = {
    nodes: [{ id: "a", w: 100, h: 36 }, { id: "b", w: 100, h: 36 }],
    edges: [{ id: "e", source: "a", target: "b" }],
  };
  const o = { nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };
  const at = (dir) => dagreSolver(input, { ...o, dir }).nodes;
  assert.ok(at("LR").b.x > at("LR").a.x, "LR advances along +x");
  assert.ok(at("RL").b.x < at("RL").a.x, "RL advances along -x");
  assert.ok(at("TB").b.y > at("TB").a.y, "TB advances along +y");
  assert.ok(at("BT").b.y < at("BT").a.y, "BT advances along -y");
});

test("dagreSolver produces no `layers`, and the shell degrades to an empty one", () => {
  // The bend-stability channel is engine.js's; a third-party solver just does not have it,
  // and layout() has to keep working (and keep returning a usable shape) without it.
  const r = dagreLayout(fixtureLoop(), OPTS);
  assert.deepEqual(r.layers, []);
  const again = dagreLayout(fixtureLoop(), { ...OPTS, prevOrder: r.order, prevLayers: r.layers });
  assert.deepEqual(toComparable(again), toComparable(r));
});
