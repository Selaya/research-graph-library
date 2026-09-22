import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { layout } from "../src/layout.js";
import { sizeNode } from "../src/measure.js";
import { createViewState } from "../src/viewstate.js";
import { Store } from "../src/store.js";
import { fixtureDiamond, fixtureLoop, fixtureSelfLoop, OPTS } from "./golden/fixtures.js";
import { countCrossings, DAGRE_CROSSINGS } from "./golden/crossing.js";

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
    order: result.order,
  };
}

const forwardPoints = (result) =>
  Object.values(result.edges).filter((e) => !e.reversed).map((e) => e.points);

test("layout(diamond) matches golden snapshot", () => {
  const result = layout(fixtureDiamond(), OPTS);
  const { crossings, ...expected } = golden("diamond");
  assert.deepEqual(toComparable(result), expected);
});

test("layout(loop) matches golden snapshot", () => {
  const result = layout(fixtureLoop(), OPTS);
  const { crossings, ...expected } = golden("loop");
  assert.deepEqual(toComparable(result), expected);
});

test("layout(selfloop) matches golden snapshot", () => {
  const result = layout(fixtureSelfLoop(), OPTS);
  const { crossings, ...expected } = golden("selfloop");
  assert.deepEqual(toComparable(result), expected);
});

// M3 gate (INTERNALS "Layout gates"): "parity" with dagre is structural + crossing
// non-regression, NOT coordinate identity. Every golden fixture must draw with at most
// the crossings dagre drew it with as of M2 (DAGRE_CROSSINGS, hard-coded), and the
// regenerated golden must not have drifted above its own recorded count either.
for (const [name, view] of [
  ["diamond", fixtureDiamond],
  ["loop", fixtureLoop],
  ["selfloop", fixtureSelfLoop],
]) {
  test(`crossing count for the ${name} fixture is at or below the dagre-era count`, () => {
    const count = countCrossings(forwardPoints(layout(view(), OPTS)));
    const bar = DAGRE_CROSSINGS[name];
    assert.ok(count <= bar, `expected <= ${bar} dagre-era crossings, got ${count}`);
    assert.ok(count <= golden(name).crossings, `drifted above the recorded golden count`);
  });
}

test("layout() is a shell over a pluggable solver: opts.solver drives the geometry", () => {
  // A stand-in solver — proves the seam is real without needing dagre installed. It puts
  // every node on a diagonal; the shell still owns cycle breaking, arcs, bounds, order.
  let seen = null;
  const stubSolver = (input, opts) => {
    seen = { input, opts };
    const nodes = {};
    input.nodes.forEach((n, i) => { nodes[n.id] = { x: i * 200, y: i * 200, w: n.w, h: n.h }; });
    const edges = {};
    for (const e of input.edges) {
      edges[e.id] = { points: [{ x: nodes[e.source].x, y: nodes[e.source].y }, { x: nodes[e.target].x, y: nodes[e.target].y }] };
    }
    return { nodes, edges, order: input.nodes.map((n) => [n.id]) };
  };

  const view = fixtureLoop();
  const result = layout(view, { ...OPTS, solver: stubSolver });

  assert.equal(result.nodes.N1.x, 0);
  assert.equal(result.nodes.N2.x, 200);
  // The shell withholds back edges from the solver and routes them itself (D3).
  assert.ok(!seen.input.edges.some((e) => e.id === "eLoop"));
  assert.equal(seen.input.edges.length, view.edges.length - 1);
  assert.equal(result.edges.eLoop.reversed, true);
  assert.ok(result.edges.eLoop.points.length > 2, "back edge is still a shell-drawn arc");
  assert.equal(result.order.length, view.nodes.length);
});

test("opts.prevOrder reaches the solver and layout() hands the new order back", () => {
  const first = layout(fixtureLoop(), OPTS);
  assert.ok(Array.isArray(first.order) && first.order.length > 0);
  assert.ok(first.order.every((rank) => Array.isArray(rank)));

  let received;
  const spy = (input, opts) => {
    received = opts.prevOrder;
    return { nodes: {}, edges: {}, order: [] };
  };
  layout(fixtureLoop(), { ...OPTS, solver: spy, prevOrder: first.order });
  assert.deepEqual(received, first.order);
});

test("re-solving with its own order back is a fixed point (stability channel)", () => {
  const view = fixtureLoop();
  const first = layout(view, OPTS);
  const again = layout(view, { ...OPTS, prevOrder: first.order });
  assert.deepEqual(again.order, first.order);
  assert.deepEqual(again.nodes, first.nodes);
});

test("layout() hands `layers` back and threads it down as opts.prevLayers", () => {
  const first = layout(fixtureLoop(), OPTS);
  assert.ok(Array.isArray(first.layers) && first.layers.length > 0);
  let received;
  const spy = (input, opts) => {
    received = opts.prevLayers;
    return { nodes: {}, edges: {}, order: [], layers: [] };
  };
  layout(fixtureLoop(), { ...OPTS, solver: spy, prevLayers: first.layers });
  assert.deepEqual(received, first.layers);
  // A solver that does not produce layers (the dagre adapter) still yields a usable result.
  const none = layout(fixtureLoop(), { ...OPTS, solver: () => ({ nodes: {}, edges: {}, order: [] }) });
  assert.deepEqual(none.layers, []);
});

test("container chrome is reserved: tiny nodesep/ranksep still clear the padded rect", () => {
  // Regression: the emitted rect is the children bbox grown by CLUSTER_PAD (engine) and then
  // by CONTAINER_PAD (padContainers). Neither growth was reserved anywhere, so below
  // ranksep ~12 or nodesep ~6 a container swallowed a node that is not its child.
  const WH = { w: 100, h: 36 };
  const view = {
    nodes: [
      { id: "C", ...WH }, { id: "c1", ...WH, parent: "C" }, { id: "c2", ...WH, parent: "C" },
      { id: "p", ...WH }, { id: "q", ...WH }, { id: "r", ...WH },
    ],
    edges: [
      { id: "e1", source: "c1", target: "c2" }, { id: "e2", source: "p", target: "q" },
      { id: "e3", source: "q", target: "r" }, { id: "e4", source: "c2", target: "r" },
    ],
  };
  for (const o of [{ ranksep: 8 }, { ranksep: 2 }, { nodesep: 6 }, { nodesep: 2 }]) {
    const res = layout(view, { dir: "LR", nodesep: 28, ranksep: 56, ...o });
    const c = res.nodes.C;
    for (const id of ["p", "q", "r"]) {
      const n = res.nodes[id];
      const hit = Math.abs(n.x - c.x) < (n.w + c.w) / 2 && Math.abs(n.y - c.y) < (n.h + c.h) / 2;
      assert.ok(!hit, `${id} overlaps container C at ${JSON.stringify(o)}`);
    }
  }
});

test("appending a node with prevOrder passed leaves every existing rank's order intact", () => {
  let order;
  let pinned;
  let prevRanks = null;
  for (let extra = 0; extra <= 5; extra++) {
    const result = layout(fixtureLoop(extra), { ...OPTS, pinnedReversals: pinned, prevOrder: order });
    if (prevRanks) {
      for (let r = 0; r < prevRanks.length; r++) {
        const kept = (result.order[r] || []).filter((id) => prevRanks[r].includes(id));
        assert.deepEqual(kept, prevRanks[r], `rank ${r} reshuffled at extra=${extra}`);
      }
    }
    prevRanks = result.order.map((rank) => [...rank]);
    order = result.order;
    pinned = result.reversedEdgeIds;
  }
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

test("forward edges strictly advance along the rank axis; siblings never overlap (LR)", () => {
  const result = layout(fixtureDiamond(), OPTS);
  for (const [id, e] of Object.entries(result.edges)) {
    if (e.reversed) continue;
    const spec = fixtureDiamond().edges.find((s) => s.id === id);
    assert.ok(
      result.nodes[spec.target].x > result.nodes[spec.source].x,
      `edge ${id} does not advance left-to-right`
    );
    for (const p of e.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  const rects = Object.values(result.nodes);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const overlap =
        Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.001 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.001;
      assert.ok(!overlap, `nodes overlap: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
    }
  }
});

// --- the solver seam's node view (F32/F33) and container fallback (F35) ---------------

/** A view with one container, one child and one free-standing declared container. */
function fixtureSeam() {
  return {
    nodes: [
      { id: "act", w: 90, h: 36, container: true, data: { col: 0 } },
      { id: "a1", w: 80, h: 36, parent: "act", data: { row: 1, note: "first" } },
      { id: "solo", w: 70, h: 36, container: true, data: { col: 1 } },
    ],
    edges: [{ id: "e1", source: "a1", target: "solo" }],
  };
}

test("F32: the solver sees each node's data and the container flag", () => {
  let seen = null;
  layout(fixtureSeam(), {
    ...OPTS,
    solver: (input) => {
      seen = input.nodes;
      return { nodes: {}, edges: {}, order: [] };
    },
  });
  const byId = Object.fromEntries(seen.map((n) => [n.id, n]));
  assert.deepEqual(byId.a1.data, { row: 1, note: "first" });
  assert.equal(byId.a1.parent, "act");
  assert.equal(byId.act.container, true);
  assert.equal(byId.solo.container, true, "a childless declared container is flagged too");
  assert.equal(byId.a1.container, undefined, "a leaf carries no container key");
  // Still the frozen seam: id/w/h are untouched and nothing else appeared.
  assert.deepEqual(Object.keys(byId.solo).sort(), ["container", "data", "id", "parent", "w", "h"].sort());
});

test("F32: layout.hint(node) picks what the solver sees as data, and a node without data has no key", () => {
  let seen = null;
  const view = fixtureSeam();
  view.nodes.push({ id: "bare", w: 40, h: 36 });
  layout(view, {
    ...OPTS,
    hint: (n) => (n.data ? { col: n.data.col } : undefined),
    solver: (input) => { seen = input.nodes; return { nodes: {}, edges: {}, order: [] }; },
  });
  const byId = Object.fromEntries(seen.map((n) => [n.id, n]));
  assert.deepEqual(byId.a1.data, { col: undefined });
  assert.deepEqual(byId.act.data, { col: 0 });
  assert.equal("data" in byId.bare, false);
});

test("F32: custom layout opts reach the solver untouched, by spread", () => {
  let opts = null;
  layout(fixtureSeam(), {
    ...OPTS,
    minColWidth: 120,
    lanes: ["a", "b"],
    solver: (input, o) => { opts = o; return { nodes: {}, edges: {}, order: [] }; },
  });
  assert.equal(opts.minColWidth, 120);
  assert.deepEqual(opts.lanes, ["a", "b"]);
});

test("F35: a container the solver omitted takes its rect from the children alone", () => {
  const place = { a1: { x: 500, y: 300 } };
  const result = layout(fixtureSeam(), {
    ...OPTS,
    containerPad: { top: 40, side: 12, bottom: 12 },
    solver: (input) => {
      const nodes = {};
      for (const n of input.nodes) {
        const p = place[n.id];
        if (p) nodes[n.id] = { x: p.x, y: p.y, w: n.w, h: n.h };
      }
      return { nodes, edges: {}, order: [] };
    },
  });
  const act = result.nodes.act;
  // children bbox is x 460..540, y 282..318; + pad = x 448..552, y 242..330.
  assert.equal(act.x, 500);
  assert.equal(act.w, 80 + 24);
  assert.equal(act.y, (242 + 330) / 2);
  assert.equal(act.h, 330 - 242);
  assert.equal(act.x - act.w / 2, 448, "left edge is the child's, not the origin's");
});

test("F35: a container the solver DID place still unions with its children", () => {
  const result = layout(fixtureSeam(), {
    ...OPTS,
    solver: (input) => {
      const nodes = {};
      for (const n of input.nodes) nodes[n.id] = { x: 500, y: 300, w: n.w, h: n.h };
      nodes.act = { x: 400, y: 300, w: 40, h: 40 };
      return { nodes, edges: {}, order: [] };
    },
  });
  assert.ok(result.nodes.act.x - result.nodes.act.w / 2 <= 380, "kept the solver's own left edge");
});

test("F33/F35: an EMPTY container the solver omitted keeps the origin fallback, and is named", () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  let result;
  try {
    result = layout(fixtureSeam(), {
      ...OPTS,
      solver: (input) => {
        const nodes = {};
        for (const n of input.nodes) if (n.id !== "solo") nodes[n.id] = { x: 500, y: 300, w: n.w, h: n.h };
        return { nodes, edges: {}, order: [] };
      },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(result.nodes.solo.x, 0, "no children means no bbox to derive from");
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^\[smv:layout\] solver returned no rect for empty container\(s\): solo/);
});

test("a container WITH children that the solver omitted is derived silently (no warning)", () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  try {
    layout(fixtureSeam(), {
      ...OPTS,
      solver: (input) => {
        const nodes = {};
        for (const n of input.nodes) if (n.id !== "act") nodes[n.id] = { x: 500, y: 300, w: n.w, h: n.h };
        return { nodes, edges: {}, order: [] };
      },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(warned, []);
});

// ---------------------------------------------------------------------------
// F22/F23 — the measurement hook (`opts.layout.measure`, src/measure.js)
// ---------------------------------------------------------------------------

test("sizeNode: no measure options means byte-identical sizing (golden layouts are safe)", () => {
  const node = { id: "a", label: "Ingest" };
  const bare = sizeNode(node);
  assert.deepEqual({ w: bare.w, h: bare.h }, { w: sizeNode(node, null).w, h: sizeNode(node, {}).h });
  assert.equal(bare.h, 36);
  assert.equal(bare.reserve, 0);
});

test("sizeNode: extraWidth/extraHeight grow the derived box and report the reserve", () => {
  const node = { id: "a", label: "Ingest" };
  const bare = sizeNode(node);
  const grown = sizeNode(node, { extraWidth: 30, extraHeight: 8 });
  assert.equal(grown.w, bare.w + 30);
  assert.equal(grown.h, bare.h + 8);
  assert.equal(grown.reserve, 30, "the extra width is chrome, not label room");

  // Per-node functions, and anything non-finite reading as zero.
  const perNode = sizeNode(node, { extraWidth: (n) => (n.id === "a" ? 12 : 0) });
  assert.equal(perNode.w, bare.w + 12);
  assert.equal(sizeNode(node, { extraWidth: NaN, extraHeight: -5 }).w, bare.w);
});

test("sizeNode: a node that declares both w and h opts out of the hook entirely", () => {
  const fixed = sizeNode({ id: "a", w: 120, h: 44 }, { extraWidth: 30, extraHeight: 8 });
  assert.deepEqual(fixed, { w: 120, h: 44, reserve: 0 });
  // An explicit width alone keeps its width but STILL reserves, so the label of a node
  // that shipped the pre-hook `w:` workaround also clears the chrome.
  const halfFixed = sizeNode({ id: "a", label: "Ingest", w: 120 }, { extraWidth: 30 });
  assert.equal(halfFixed.w, 120);
  assert.equal(halfFixed.reserve, 30);
});

test("sizeNode: the reserve lands inside the NODE_MAX_W clamp — the 220px cap still holds", () => {
  const long = { id: "a", label: "a very long node label that runs past the maximum width" };
  assert.equal(sizeNode(long).w, 220);
  const grown = sizeNode(long, { extraWidth: 132, extraHeight: 8 });
  assert.equal(grown.w, 220, "extra width never pushes a node past NODE_MAX_W");
  assert.equal(grown.reserve, 132, "the label gives way instead");
});

test("viewstate threads the measure hook into view().sizes, live on every view()", () => {
  let measure = null;
  const vs = createViewState(new Store({ nodes: [{ id: "a", label: "Ingest" }], edges: [] }), () => measure);
  const bare = vs.view().sizes.a;
  measure = { extraWidth: 24, extraHeight: 8 };
  const grown = vs.view().sizes.a;
  assert.equal(grown.w, bare.w + 24);
  assert.equal(grown.h, bare.h + 8);
  assert.equal(grown.reserve, 24);
  assert.equal(bare.reserve, 0);
});
