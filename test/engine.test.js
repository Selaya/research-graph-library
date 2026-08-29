import { test } from "node:test";
import assert from "node:assert/strict";
import { engineSolve } from "../src/engine.js";

const WH = { w: 100, h: 36 };
const OPTS = { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };

const nodes = (...ids) => ids.map((id) => ({ id, ...WH }));
const edge = (id, source, target) => ({ id, source, target });
const chainEdges = (ids) => ids.slice(1).map((id, i) => edge(`e${i}`, ids[i], id));

/** Rank axis / in-rank axis accessors for a dir (the engine solves TB and transposes). */
function axes(dir) {
  const horiz = dir === "LR" || dir === "RL";
  const sign = dir === "RL" || dir === "BT" ? -1 : 1;
  return {
    rank: (n) => (horiz ? n.x : n.y) * sign,
    cross: (n) => (horiz ? n.y : n.x),
    crossSize: (n) => (horiz ? n.h : n.w),
  };
}

/** The invariants the M3 contract gates on, asserted on one engineSolve result. */
function checkInvariants(input, out, o = OPTS, label = "") {
  const ax = axes(o.dir);
  const nodesep = o.nodesep ?? 28;
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const isContainer = new Set(input.nodes.filter((n) => n.parent !== undefined).map((n) => n.parent));

  for (const [id, r] of Object.entries(out.nodes)) {
    for (const k of ["x", "y", "w", "h"]) {
      assert.ok(Number.isFinite(r[k]), `${label} ${id}.${k} is not finite (${r[k]})`);
    }
  }
  // every forward edge strictly advances along the rank axis
  for (const e of input.edges) {
    const s = out.nodes[e.source], t = out.nodes[e.target];
    if (!s || !t || isContainer.has(e.source) || isContainer.has(e.target)) continue;
    assert.ok(ax.rank(t) > ax.rank(s) + 1e-3, `${label} edge ${e.id} does not advance a rank`);
    const pts = out.edges[e.id].points;
    assert.ok(pts.length >= 2, `${label} edge ${e.id} has < 2 points`);
    for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label} NaN point on ${e.id}`);
  }
  // no two visible siblings overlap; same-rank siblings keep the minimum separation
  const ids = Object.keys(out.nodes);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId.get(ids[i]), b = byId.get(ids[j]);
      if (!a || !b || a.parent !== b.parent) continue;
      const ra = out.nodes[ids[i]], rb = out.nodes[ids[j]];
      const gapX = Math.abs(ra.x - rb.x) - (ra.w + rb.w) / 2;
      const gapY = Math.abs(ra.y - rb.y) - (ra.h + rb.h) / 2;
      assert.ok(gapX > -1e-3 || gapY > -1e-3, `${label} siblings ${ids[i]}/${ids[j]} overlap`);
      const sameRank = Math.abs(ax.rank(ra) - ax.rank(rb)) < 1e-3;
      const leaves = !isContainer.has(ids[i]) && !isContainer.has(ids[j]);
      if (sameRank && leaves) {
        const sep = Math.abs(ax.cross(ra) - ax.cross(rb)) - (ax.crossSize(ra) + ax.crossSize(rb)) / 2;
        assert.ok(sep >= nodesep - 1e-3, `${label} ${ids[i]}/${ids[j]} closer than nodesep (${sep})`);
      }
    }
  }
  // children strictly inside their container
  for (const n of input.nodes) {
    if (n.parent === undefined) continue;
    const c = out.nodes[n.parent], k = out.nodes[n.id];
    if (!c || !k) continue;
    assert.ok(k.x - k.w / 2 > c.x - c.w / 2 - 1e-3, `${label} ${n.id} leaks left of ${n.parent}`);
    assert.ok(k.x + k.w / 2 < c.x + c.w / 2 + 1e-3, `${label} ${n.id} leaks right of ${n.parent}`);
    assert.ok(k.y - k.h / 2 > c.y - c.h / 2 - 1e-3, `${label} ${n.id} leaks above ${n.parent}`);
    assert.ok(k.y + k.h / 2 < c.y + c.h / 2 + 1e-3, `${label} ${n.id} leaks below ${n.parent}`);
  }
}

// ------------------------------------------------------------------ ranking + tightening

test("ranking: a chain occupies one node per rank, in order", () => {
  const ids = ["a", "b", "c", "d"];
  const input = { nodes: nodes(...ids), edges: chainEdges(ids) };
  const out = engineSolve(input, OPTS);
  assert.deepEqual(out.order, [["a"], ["b"], ["c"], ["d"]]);
  let prev = -Infinity;
  for (const id of ids) {
    assert.ok(out.nodes[id].x > prev);
    prev = out.nodes[id].x;
  }
});

test("ranking: longest path puts a rejoining branch on the deepest rank", () => {
  const input = {
    nodes: nodes("a", "b", "c", "d"),
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d"), edge("e4", "a", "d")],
  };
  const out = engineSolve(input, OPTS);
  assert.equal(out.order.length, 4);
  assert.deepEqual(out.order[3], ["d"]);
});

test("tightening: a source that only feeds a late node is pulled next to it", () => {
  // a->b->c plus x->c: longest-path alone leaves x on rank 0, one rank too early.
  const input = {
    nodes: nodes("a", "b", "c", "x"),
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "x", "c")],
  };
  const out = engineSolve(input, OPTS);
  const rankOf = (id) => out.order.findIndex((r) => r.includes(id));
  assert.equal(rankOf("c"), 2);
  assert.equal(rankOf("x"), 1, "x should be tightened onto the rank before c");
});

test("ranks are compacted: tightening never leaves an empty rank behind", () => {
  const input = {
    nodes: nodes("a", "b", "x"),
    edges: [edge("e1", "a", "b"), edge("e2", "x", "b")],
  };
  const out = engineSolve(input, OPTS);
  for (const rank of out.order) assert.ok(rank.length > 0, "empty rank in order");
});

// ------------------------------------------------------------------------------ dummies

test("dummies: a multi-rank edge gets one bend per skipped rank", () => {
  const ids = ["a", "b", "c", "d"];
  const input = { nodes: nodes(...ids), edges: [...chainEdges(ids), edge("long", "a", "d")] };
  const out = engineSolve(input, OPTS);
  assert.equal(out.edges.long.points.length, 4, "2 endpoints + 2 bends");
  assert.equal(out.edges.e0.points.length, 2, "adjacent ranks need no bend");
  const xs = out.edges.long.points.map((p) => p.x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], "bends advance along the rank axis");
});

test("dummies keep a long edge clear of the nodes it passes", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const input = { nodes: nodes(...ids), edges: [...chainEdges(ids), edge("long", "a", "e")] };
  const out = engineSolve(input, OPTS);
  for (const p of out.edges.long.points.slice(1, -1)) {
    for (const id of ["b", "c", "d"]) {
      const n = out.nodes[id];
      const inside = Math.abs(p.x - n.x) < n.w / 2 && Math.abs(p.y - n.y) < n.h / 2;
      assert.ok(!inside, `long edge bend lands inside ${id}`);
    }
  }
});

// ----------------------------------------------------------------------------- ordering

test("ordering: the median sweep untangles a deliberately crossed bipartite graph", () => {
  const input = {
    nodes: nodes("a1", "a2", "b1", "b2"),
    edges: [edge("e1", "a1", "b2"), edge("e2", "a2", "b1")],
  };
  const out = engineSolve(input, OPTS);
  const [r0, r1] = out.order;
  // a1 pairs with b2 and a2 with b1 -> the two ranks must end up mirrored
  assert.equal(r0.indexOf("a1"), r1.indexOf("b2"));
  assert.equal(r0.indexOf("a2"), r1.indexOf("b1"));
});

test("ordering: prevOrder seeds the initial order, unknown ids appended in input order", () => {
  const input = {
    nodes: nodes("a", "b", "c"),
    edges: [],
  };
  const out = engineSolve(input, { ...OPTS, prevOrder: [["c", "b"]] });
  assert.deepEqual(out.order, [["c", "b", "a"]]);
});

test("stability: appending a node with prevOrder preserves every existing rank's order", () => {
  const ids = [];
  for (let i = 0; i < 30; i++) ids.push(`n${i}`);
  const edges = [];
  // 3 parallel chains of 10, cross-linked so ordering has real work to do
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 9; i++) edges.push(edge(`c${c}_${i}`, `n${c * 10 + i}`, `n${c * 10 + i + 1}`));
  }
  edges.push(edge("x1", "n2", "n13"), edge("x2", "n14", "n25"), edge("x3", "n5", "n26"));
  const base = { nodes: nodes(...ids), edges };
  const first = engineSolve(base, OPTS);

  const grown = {
    nodes: nodes(...ids, "fresh"),
    edges: [...edges, edge("efresh", "n9", "fresh")],
  };
  const second = engineSolve(grown, { ...OPTS, prevOrder: first.order });
  assert.equal(second.order.length >= first.order.length, true);
  for (let r = 0; r < first.order.length; r++) {
    const kept = second.order[r].filter((id) => first.order[r].includes(id));
    assert.deepEqual(kept, first.order[r], `rank ${r} was reshuffled`);
  }
});

test("stability: a re-run fed its own order back is a fixed point", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const input = {
    nodes: nodes(...ids),
    edges: [
      edge("e1", "a", "c"), edge("e2", "b", "d"), edge("e3", "c", "e"),
      edge("e4", "d", "f"), edge("e5", "a", "d"),
    ],
  };
  const one = engineSolve(input, OPTS);
  const two = engineSolve(input, { ...OPTS, prevOrder: one.order });
  assert.deepEqual(two.order, one.order);
  assert.deepEqual(two.nodes, one.nodes);
});

// -------------------------------------------------------------------------- determinism

test("determinism: identical input and opts produce byte-identical output", () => {
  const ids = [];
  for (let i = 0; i < 24; i++) ids.push(`n${i}`);
  const edges = [];
  for (let i = 0; i < 24; i++) {
    for (const j of [i + 1, i + 3, i + 7]) if (j < 24) edges.push(edge(`e${i}_${j}`, `n${i}`, `n${j}`));
  }
  const input = { nodes: nodes(...ids), edges };
  const a = JSON.stringify(engineSolve(input, OPTS));
  const b = JSON.stringify(engineSolve(input, OPTS));
  assert.equal(a, b);
  // a fresh (structurally equal) input object must not change anything either
  const c = JSON.stringify(engineSolve(JSON.parse(JSON.stringify(input)), { ...OPTS }));
  assert.equal(a, c);
});

test("determinism: node input order, not iteration luck, decides ties", () => {
  const input = { nodes: nodes("a", "b", "c"), edges: [] };
  const flipped = { nodes: nodes("c", "b", "a"), edges: [] };
  assert.deepEqual(engineSolve(input, OPTS).order, [["a", "b", "c"]]);
  assert.deepEqual(engineSolve(flipped, OPTS).order, [["c", "b", "a"]]);
});

// ------------------------------------------------------------------------- coordinates

test("coordinates: nodesep and ranksep are honoured as minimums", () => {
  const input = {
    nodes: nodes("a", "b", "c"),
    edges: [edge("e1", "a", "b"), edge("e2", "a", "c")],
  };
  const o = { ...OPTS, nodesep: 40, ranksep: 90 };
  const out = engineSolve(input, o);
  assert.ok(Math.abs(out.nodes.b.y - out.nodes.c.y) >= 36 + 40 - 1e-3);
  assert.equal(out.nodes.b.x - out.nodes.a.x, 100 + 90);
  checkInvariants(input, out, o);
});

test("coordinates: margins place the tightest bound exactly on (marginx, marginy)", () => {
  const input = { nodes: nodes("a", "b"), edges: [edge("e1", "a", "b")] };
  const out = engineSolve(input, { ...OPTS, marginx: 11, marginy: 7 });
  const minX = Math.min(...Object.values(out.nodes).map((n) => n.x - n.w / 2));
  const minY = Math.min(...Object.values(out.nodes).map((n) => n.y - n.h / 2));
  assert.ok(Math.abs(minX - 11) < 1e-9);
  assert.ok(Math.abs(minY - 7) < 1e-9);
});

test("coordinates: a straight chain stays straight (dummies are relaxed first)", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const input = { nodes: nodes(...ids), edges: chainEdges(ids) };
  const out = engineSolve(input, OPTS);
  const ys = ids.map((id) => out.nodes[id].y);
  for (const y of ys) assert.ok(Math.abs(y - ys[0]) < 1e-3, "chain drifted off its line");
});

// ------------------------------------------------------------------------------ dir

for (const dir of ["TB", "BT", "LR", "RL"]) {
  test(`dir ${dir}: ranks advance along the expected axis`, () => {
    const ids = ["a", "b", "c"];
    const input = { nodes: nodes(...ids), edges: [...chainEdges(ids), edge("fan", "a", "c")] };
    const o = { ...OPTS, dir };
    const out = engineSolve(input, o);
    const ax = axes(dir);
    assert.ok(ax.rank(out.nodes.b) > ax.rank(out.nodes.a));
    assert.ok(ax.rank(out.nodes.c) > ax.rank(out.nodes.b));
    checkInvariants(input, out, o, dir);
    const minX = Math.min(...Object.values(out.nodes).map((n) => n.x - n.w / 2));
    const minY = Math.min(...Object.values(out.nodes).map((n) => n.y - n.h / 2));
    assert.ok(Math.abs(minX - 20) < 1e-9 && Math.abs(minY - 20) < 1e-9, "margins applied after the flip");
  });
}

test("dir: LR and TB are transposes of each other for the same graph", () => {
  const input = { nodes: nodes("a", "b", "c"), edges: [edge("e1", "a", "b"), edge("e2", "a", "c")] };
  const lr = engineSolve({ nodes: input.nodes.map((n) => ({ ...n, w: n.h, h: n.w })), edges: input.edges }, { ...OPTS, dir: "LR" });
  const tb = engineSolve(input, { ...OPTS, dir: "TB" });
  for (const id of ["a", "b", "c"]) {
    assert.ok(Math.abs(lr.nodes[id].x - tb.nodes[id].y) < 1e-9, `${id} x/y mismatch`);
    assert.ok(Math.abs(lr.nodes[id].y - tb.nodes[id].x) < 1e-9, `${id} y/x mismatch`);
  }
});

// ------------------------------------------------------------------------------ nesting

test("nesting: a container covers its children with room to spare", () => {
  const input = {
    nodes: [
      { id: "C", w: 10, h: 10 },
      { id: "a", ...WH, parent: "C" },
      { id: "b", ...WH, parent: "C" },
      { id: "out", ...WH },
    ],
    edges: [edge("e1", "a", "b"), edge("e2", "b", "out")],
  };
  const out = engineSolve(input, OPTS);
  checkInvariants(input, out);
  assert.ok(out.nodes.C.w >= 2 * WH.w, "container too narrow for two ranks of children");
  assert.ok(out.nodes.C.h >= WH.h);
});

test("nesting: 2 levels — the inner container sits strictly inside the outer one", () => {
  const input = {
    nodes: [
      { id: "OUT", w: 10, h: 10 },
      { id: "IN", w: 10, h: 10, parent: "OUT" },
      { id: "a", ...WH, parent: "IN" },
      { id: "b", ...WH, parent: "IN" },
      { id: "c", ...WH, parent: "OUT" },
      { id: "z", ...WH },
    ],
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "z")],
  };
  const out = engineSolve(input, OPTS);
  checkInvariants(input, out);
  const o = out.nodes.OUT, i = out.nodes.IN;
  assert.ok(i.x - i.w / 2 > o.x - o.w / 2 && i.x + i.w / 2 < o.x + o.w / 2);
  assert.ok(i.y - i.h / 2 > o.y - o.h / 2 && i.y + i.h / 2 < o.y + o.h / 2);
});

test("nesting: a foreign node never lands inside a container's rect", () => {
  const input = {
    nodes: [
      { id: "C", w: 10, h: 10 },
      { id: "a", ...WH, parent: "C" },
      { id: "b", ...WH, parent: "C" },
      { id: "p", ...WH },
      { id: "q", ...WH },
      { id: "r", ...WH },
    ],
    edges: [
      edge("e1", "a", "b"), edge("e2", "p", "q"), edge("e3", "q", "r"), edge("e4", "b", "r"),
    ],
  };
  const out = engineSolve(input, OPTS);
  checkInvariants(input, out);
  const c = out.nodes.C;
  for (const id of ["p", "q", "r"]) {
    const n = out.nodes[id];
    const overlapX = Math.abs(n.x - c.x) < (n.w + c.w) / 2;
    const overlapY = Math.abs(n.y - c.y) < (n.h + c.h) / 2;
    assert.ok(!(overlapX && overlapY), `${id} overlaps container C`);
  }
});

test("nesting: cluster children stay contiguous within every rank", () => {
  const input = {
    nodes: [
      { id: "C", w: 10, h: 10 },
      { id: "c1", ...WH, parent: "C" }, { id: "c2", ...WH, parent: "C" },
      { id: "c3", ...WH, parent: "C" }, { id: "c4", ...WH, parent: "C" },
      { id: "o1", ...WH }, { id: "o2", ...WH }, { id: "o3", ...WH },
    ],
    edges: [
      edge("a", "c1", "c3"), edge("b", "c2", "c4"),
      edge("c", "o1", "o2"), edge("d", "o2", "o3"), edge("e", "c4", "o3"),
    ],
  };
  const out = engineSolve(input, OPTS);
  const members = new Set(["c1", "c2", "c3", "c4"]);
  for (const rank of out.order) {
    const flags = rank.map((id) => members.has(id));
    const runs = flags.reduce((n, f, i) => n + (f && !flags[i - 1] ? 1 : 0), 0);
    assert.ok(runs <= 1, `cluster split into ${runs} runs on rank ${rank.join(",")}`);
  }
  checkInvariants(input, out);
});

test("nesting: a cluster spanning ranks it has no member on still reserves a corridor", () => {
  // C owns a (rank 0) and d (rank 3); the path between them leaves the cluster, so ranks
  // 1 and 2 hold only C's border pair.
  const input = {
    nodes: [
      { id: "C", w: 10, h: 10 },
      { id: "a", ...WH, parent: "C" }, { id: "d", ...WH, parent: "C" },
      { id: "b", ...WH }, { id: "c", ...WH },
    ],
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d")],
  };
  const out = engineSolve(input, OPTS);
  checkInvariants(input, out);
  const cRect = out.nodes.C;
  for (const id of ["b", "c"]) {
    const n = out.nodes[id];
    const overlapX = Math.abs(n.x - cRect.x) < (n.w + cRect.w) / 2;
    const overlapY = Math.abs(n.y - cRect.y) < (n.h + cRect.h) / 2;
    assert.ok(!(overlapX && overlapY), `${id} sits inside C's rect`);
  }
});

test("ordering: prevOrder entries for ids that no longer exist are ignored", () => {
  const input = { nodes: nodes("a", "b"), edges: [] };
  const out = engineSolve(input, { ...OPTS, prevOrder: [["gone", "b", "vanished", "a"]] });
  assert.deepEqual(out.order, [["b", "a"]]);
});

test("nesting: a container's own w/h in the input is ignored, the rect comes from children", () => {
  const input = {
    nodes: [
      { id: "C", w: 9999, h: 9999 },
      { id: "a", ...WH, parent: "C" },
    ],
    edges: [],
  };
  const out = engineSolve(input, OPTS);
  assert.ok(out.nodes.C.w < 200 && out.nodes.C.h < 100);
  checkInvariants(input, out);
});

// -------------------------------------------------------------------- degenerate input

test("degenerate: empty graph", () => {
  const out = engineSolve({ nodes: [], edges: [] }, OPTS);
  assert.deepEqual(out, { nodes: {}, edges: {}, order: [] });
  assert.deepEqual(engineSolve({}, OPTS), { nodes: {}, edges: {}, order: [] });
  assert.deepEqual(engineSolve(undefined, undefined), { nodes: {}, edges: {}, order: [] });
});

test("degenerate: single node sits at the margin", () => {
  const out = engineSolve({ nodes: nodes("only"), edges: [] }, OPTS);
  assert.deepEqual(out.nodes.only, { x: 70, y: 38, w: 100, h: 36 });
  assert.deepEqual(out.order, [["only"]]);
});

test("degenerate: disconnected components all lay out without overlapping", () => {
  const input = {
    nodes: nodes("a", "b", "c", "d", "e"),
    edges: [edge("e1", "a", "b"), edge("e2", "c", "d")],
  };
  const out = engineSolve(input, OPTS);
  assert.equal(Object.keys(out.nodes).length, 5);
  checkInvariants(input, out);
});

test("degenerate: nodes with no edges at all", () => {
  const input = { nodes: nodes("a", "b", "c"), edges: [] };
  const out = engineSolve(input, OPTS);
  assert.deepEqual(out.order, [["a", "b", "c"]]);
  checkInvariants(input, out);
});

test("degenerate: multi-edges between the same pair each get their own entry", () => {
  const input = {
    nodes: nodes("a", "b", "c"),
    edges: [
      edge("m1", "a", "b"), edge("m2", "a", "b"), edge("m3", "a", "b"),
      edge("far1", "a", "c"), edge("far2", "a", "c"), edge("mid", "b", "c"),
    ],
  };
  const out = engineSolve(input, OPTS);
  for (const id of ["m1", "m2", "m3", "far1", "far2", "mid"]) {
    assert.ok(out.edges[id], `missing edge ${id}`);
    assert.ok(out.edges[id].points.length >= 2);
  }
  checkInvariants(input, out);
});

test("degenerate: wide fan-out", () => {
  const kids = [];
  for (let i = 0; i < 60; i++) kids.push(`k${i}`);
  const input = {
    nodes: nodes("root", ...kids),
    edges: kids.map((k, i) => edge(`e${i}`, "root", k)),
  };
  const out = engineSolve(input, OPTS);
  assert.equal(out.order.length, 2);
  assert.equal(out.order[1].length, 60);
  checkInvariants(input, out);
  const ys = kids.map((k) => out.nodes[k].y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 36 + 28 - 1e-3);
  // the root centres on its fan
  assert.ok(Math.abs(out.nodes.root.y - (ys[0] + ys[ys.length - 1]) / 2) < 1e-3);
});

test("degenerate: wide fan-in", () => {
  const kids = [];
  for (let i = 0; i < 40; i++) kids.push(`k${i}`);
  const input = {
    nodes: nodes(...kids, "sink"),
    edges: kids.map((k, i) => edge(`e${i}`, k, "sink")),
  };
  const out = engineSolve(input, OPTS);
  assert.deepEqual(out.order[1], ["sink"]);
  checkInvariants(input, out);
});

test("degenerate: zero-sized nodes and missing w/h", () => {
  const input = {
    nodes: [{ id: "a" }, { id: "b", w: 0, h: 0 }, { id: "c", ...WH }],
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
  };
  const out = engineSolve(input, OPTS);
  for (const n of Object.values(out.nodes)) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  }
  assert.ok(out.nodes.b.x > out.nodes.a.x);
});

test("degenerate: malformed input is tolerated, never thrown on", () => {
  const input = {
    nodes: [
      { id: "a", ...WH }, { id: "a", ...WH }, // duplicate id
      { id: "b", ...WH, parent: "b" }, // self-parent
      { id: "c", ...WH, parent: "nope" }, // dangling parent
      null,
    ],
    edges: [
      edge("ok", "a", "b"),
      edge("dangling", "a", "ghost"),
      edge("self", "c", "c"),
      null,
    ],
  };
  const out = engineSolve(input, OPTS);
  assert.equal(Object.keys(out.nodes).length, 3);
  assert.ok(out.edges.ok);
  assert.equal(out.edges.dangling, undefined);
  assert.equal(out.edges.self.points.length, 2, "a self loop degrades to a degenerate segment");
});

test("degenerate: a parent cycle degrades to a flat forest instead of hanging", () => {
  const input = {
    nodes: [{ id: "a", ...WH, parent: "b" }, { id: "b", ...WH, parent: "a" }],
    edges: [],
  };
  const out = engineSolve(input, OPTS);
  assert.equal(Object.keys(out.nodes).length, 2);
});

test("degenerate: a cyclic edge set (contract violation) still returns finite geometry", () => {
  const input = {
    nodes: nodes("a", "b", "c"),
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
  };
  const out = engineSolve(input, OPTS);
  for (const n of Object.values(out.nodes)) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  for (const e of Object.values(out.edges)) {
    assert.ok(e.points.length >= 2);
    for (const p of e.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

test("degenerate: an edge incident to a container (contract violation) still routes", () => {
  const input = {
    nodes: [
      { id: "C", w: 10, h: 10 },
      { id: "a", ...WH, parent: "C" },
      { id: "z", ...WH },
    ],
    edges: [edge("bad", "C", "z")],
  };
  const out = engineSolve(input, OPTS);
  assert.equal(out.edges.bad.points.length, 2);
  for (const p of out.edges.bad.points) assert.ok(Number.isFinite(p.x));
});

// --------------------------------------------------------------------------- purity

test("purity: the input objects are never mutated", () => {
  const input = {
    nodes: [{ id: "a", ...WH }, { id: "b", ...WH, parent: undefined }],
    edges: [edge("e1", "a", "b")],
  };
  const before = JSON.stringify(input);
  engineSolve(input, OPTS);
  assert.equal(JSON.stringify(input), before);
});

test("purity: opts are read, not written", () => {
  const opts = { ...OPTS, prevOrder: [["b"], ["a"]] };
  const before = JSON.stringify(opts);
  engineSolve({ nodes: nodes("a", "b"), edges: [edge("e1", "a", "b")] }, opts);
  assert.equal(JSON.stringify(opts), before);
});

test("opts: unknown dir and non-numeric separations fall back to the defaults", () => {
  const input = { nodes: nodes("a", "b"), edges: [edge("e1", "a", "b")] };
  const out = engineSolve(input, { dir: "sideways", nodesep: "wide", ranksep: NaN });
  assert.equal(out.nodes.b.x - out.nodes.a.x, 100 + 56); // LR + ranksep 56
});
