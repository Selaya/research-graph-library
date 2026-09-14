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

test("a container that already has children is a nested block, not an extra actor column", async () => {
  const { layout } = await import("../src/layout.js");
  const seq = SequenceLayout.create({ actors: ["app", "db"] });
  const view = {
    nodes: [
      { id: "app", w: 80, h: 36, container: true },
      { id: "db", w: 80, h: 36, container: true },
      { id: "grp", w: 80, h: 36, parent: "app", container: true }, // an activation group inside app
      { id: "a1", w: 80, h: 36, parent: "grp", data: { seq: { actor: "app", row: 0 } } },
      { id: "a2", w: 80, h: 36, parent: "grp", data: { seq: { actor: "app", row: 1 } } },
      { id: "d1", w: 80, h: 36, parent: "db", data: { seq: { actor: "db", row: 2 } } },
    ],
    edges: [{ id: "e1", source: "a1", target: "d1" }],
  };
  const out = layout(view, { solver: seq.solver, dir: "TB", nodesep: 40, ranksep: 28 }).nodes;
  assert.deepEqual(seq.actors, ["app", "db"], "the nested block got no column of its own");
  // The block's rect is derived from its children (F35), so it stays inside app's lifeline…
  assert.ok(out.grp.x - out.grp.w / 2 >= out.app.x - out.app.w / 2 - 0.001);
  assert.ok(out.grp.x + out.grp.w / 2 <= out.app.x + out.app.w / 2 + 0.001);
  // …and app's lifeline does not stretch across db's.
  assert.ok(out.app.x + out.app.w / 2 <= out.db.x - out.db.w / 2, "the lifelines do not overlap");
});

test("a child of a nested block with no row joins the lifeline around it, not the spare column", () => {
  const seq = SequenceLayout.create({ actors: ["app"] });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(String(m));
  let out;
  try {
    out = seq.solver(
      {
        nodes: [
          { id: "app", w: 60, h: 30, container: true },
          { id: "grp", w: 60, h: 30, parent: "app", container: true },
          { id: "a1", w: 60, h: 30, parent: "grp" },
        ],
        edges: [],
      },
      {}
    );
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(warned, [], "nothing is unplaced");
  assert.equal(out.nodes.a1.x, out.nodes.app.x, "placed in app's column");
});

test("an unplaced id is parked past an actor column a data.seq placement introduced", () => {
  const seq = SequenceLayout.create({ actors: ["a"] });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(String(m));
  let out;
  try {
    out = seq.solver(
      {
        nodes: [
          { id: "a", w: 60, h: 30, container: true },
          { id: "m", w: 60, h: 30, data: { seq: { actor: "c", row: 0 } } }, // "c" is new: appended mid-loop
          { id: "q", w: 60, h: 30 }, // no placement at all
        ],
        edges: [],
      },
      {}
    );
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /no placement for: q/);
  assert.notEqual(out.nodes.q.x, out.nodes.m.x, "q is not stacked on top of c's activation");
  assert.ok(out.nodes.q.x > out.nodes.m.x, "the spare column sits to the right of every actor");
});
