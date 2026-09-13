// The reference placement-driven solver shipped with the demos (demo/sequence-solver.js).
// It is a UMD file with no ESM export: it hangs `SequenceLayout` off `self`, so give it one.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.self = globalThis;
await import("../demo/sequence-solver.js");
const SequenceLayout = globalThis.SequenceLayout;

test("F33: a `container: true` node the config never listed still gets its own column", () => {
  const seq = SequenceLayout.create({ actors: ["a"] });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  let out;
  try {
    out = seq.solver(
      { nodes: [{ id: "a", w: 60, h: 30, container: true }, { id: "z", w: 60, h: 30, container: true }], edges: [] },
      {}
    );
  } finally {
    console.warn = realWarn;
  }
  assert.ok(out.nodes.z, "the flagged node got a rect instead of being dropped");
  assert.notEqual(out.nodes.z.x, out.nodes.a.x, "and a column of its own, not a's");
  assert.notEqual(out.nodes.z.x, 0, "not the shell's origin fallback");
  assert.deepEqual(warned, [], "a declared container is placed, so nothing is 'unplaced'");
  assert.ok(seq.actors.includes("z"), "the column is remembered for the next solve");
});

test("an id with no placement at all is still parked in the spare column and named", () => {
  const seq = SequenceLayout.create({ actors: ["a"] });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  let out;
  try {
    out = seq.solver({ nodes: [{ id: "a", w: 60, h: 30, container: true }, { id: "q", w: 60, h: 30 }], edges: [] }, {});
  } finally {
    console.warn = realWarn;
  }
  assert.ok(out.nodes.q);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /no placement for: q/);
});

test("a node carries its own placement in data.seq (F32/F34)", () => {
  const seq = SequenceLayout.create({ actors: ["a", "b"] });
  const out = seq.solver(
    {
      nodes: [
        { id: "a", w: 60, h: 30, container: true },
        { id: "b", w: 60, h: 30, container: true },
        { id: "m", w: 60, h: 30, data: { seq: { actor: "b", row: 0 } } },
      ],
      edges: [],
    },
    {}
  );
  assert.equal(out.nodes.m.x, out.nodes.b.x, "placed in b's column from its own data");
});
