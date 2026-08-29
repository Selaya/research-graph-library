// M3 parity gate (INTERNALS §M3 contracts). Coordinate-identical parity with dagre is
// not a meaningful target — an independent solver lands elsewhere and that is the point.
// What IS gated: the structural invariants below hold for engineSolve on every fixture,
// and the engine never draws a materially messier picture than dagre did:
//   golden fixtures        crossings(engine) <= crossings(dagre)
//   seeded synthetics      crossings(engine) <= crossings(dagre) + 2
// Both solvers run here (dagre from devDependencies), on identical input, and both
// polylines are clipped to the node rects the way the renderer clips them (src/path.js)
// so the counts compare what is actually drawn.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as dagre from "@dagrejs/dagre";
import { engineSolve } from "../src/engine.js";
import { breakCycles } from "../src/cycles.js";
import { clipEnds } from "../src/path.js";
import { countCrossings } from "./golden/crossing.js";
import { fixtureDiamond, fixtureLoop, fixtureSelfLoop, OPTS } from "./golden/fixtures.js";

const O = { dir: "LR", nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 };

// ------------------------------------------------------------------------ dagre solver

/** The M2-era dagre path, expressed as an engineSolve-shaped solver for comparison. */
function dagreSolve(input, o) {
  const hasParents = input.nodes.some((n) => n.parent !== undefined);
  const g = new dagre.graphlib.Graph({ compound: hasParents, multigraph: true });
  g.setGraph({ rankdir: o.dir, nodesep: o.nodesep, ranksep: o.ranksep, marginx: o.marginx, marginy: o.marginy });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of input.nodes) g.setNode(n.id, { width: n.w, height: n.h });
  if (hasParents) for (const n of input.nodes) if (n.parent !== undefined) g.setParent(n.id, n.parent);
  for (const e of input.edges) g.setEdge(e.source, e.target, {}, e.id);
  dagre.layout(g);
  const nodes = {};
  for (const n of input.nodes) {
    const d = g.node(n.id);
    nodes[n.id] = { x: d.x, y: d.y, w: d.width, h: d.height };
  }
  const edges = {};
  for (const e of input.edges) {
    const d = g.edge(e.source, e.target, e.id);
    edges[e.id] = { points: (d.points || []).map((p) => ({ x: p.x, y: p.y })) };
  }
  return { nodes, edges };
}

// ------------------------------------------------------------------------- invariants

function axes(dir) {
  const horiz = dir === "LR" || dir === "RL";
  const sign = dir === "RL" || dir === "BT" ? -1 : 1;
  return {
    rank: (n) => (horiz ? n.x : n.y) * sign,
    cross: (n) => (horiz ? n.y : n.x),
    crossSize: (n) => (horiz ? n.h : n.w),
  };
}

function checkInvariants(input, out, o, label) {
  const ax = axes(o.dir);
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const isContainer = new Set(input.nodes.filter((n) => n.parent !== undefined).map((n) => n.parent));

  for (const [id, r] of Object.entries(out.nodes)) {
    for (const k of ["x", "y", "w", "h"]) assert.ok(Number.isFinite(r[k]), `${label}: ${id}.${k} = ${r[k]}`);
  }
  for (const e of input.edges) {
    const s = out.nodes[e.source], t = out.nodes[e.target];
    if (!s || !t) continue;
    assert.ok(ax.rank(t) > ax.rank(s) + 1e-3, `${label}: edge ${e.id} does not advance a rank`);
    const pts = out.edges[e.id].points;
    assert.ok(pts.length >= 2, `${label}: edge ${e.id} has < 2 points`);
    for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: NaN on ${e.id}`);
  }
  const ids = Object.keys(out.nodes);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId.get(ids[i]), b = byId.get(ids[j]);
      if (a.parent !== b.parent) continue;
      const ra = out.nodes[ids[i]], rb = out.nodes[ids[j]];
      const gapX = Math.abs(ra.x - rb.x) - (ra.w + rb.w) / 2;
      const gapY = Math.abs(ra.y - rb.y) - (ra.h + rb.h) / 2;
      assert.ok(gapX > -1e-3 || gapY > -1e-3, `${label}: siblings ${ids[i]}/${ids[j]} overlap`);
      if (Math.abs(ax.rank(ra) - ax.rank(rb)) < 1e-3 && !isContainer.has(ids[i]) && !isContainer.has(ids[j])) {
        const sep = Math.abs(ax.cross(ra) - ax.cross(rb)) - (ax.crossSize(ra) + ax.crossSize(rb)) / 2;
        assert.ok(sep >= o.nodesep - 1e-3, `${label}: ${ids[i]}/${ids[j]} under nodesep (${sep})`);
      }
    }
  }
  for (const n of input.nodes) {
    if (n.parent === undefined) continue;
    const c = out.nodes[n.parent], k = out.nodes[n.id];
    assert.ok(
      k.x - k.w / 2 > c.x - c.w / 2 - 1e-3 && k.x + k.w / 2 < c.x + c.w / 2 + 1e-3 &&
      k.y - k.h / 2 > c.y - c.h / 2 - 1e-3 && k.y + k.h / 2 < c.y + c.h / 2 + 1e-3,
      `${label}: ${n.id} is not inside ${n.parent}`
    );
  }
}

/** Edge polylines as the renderer draws them: trimmed to both endpoint rects. */
function drawn(input, out, edges = input.edges) {
  return edges.map((e) => clipEnds(out.edges[e.id].points, out.nodes[e.source], out.nodes[e.target]).points);
}

// -------------------------------------------------------------- seeded graph generator

/** mulberry32 — 32-bit seeded PRNG. Math.random is never used: fixtures must be fixed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ["chain", "layered", "diamond", "fan", "multi", "disconnected", "nested", "siblings", "wide"];

/** Acyclic by construction: every edge runs from a lower to a higher node index. */
function synth(kind, seed) {
  const rnd = mulberry32(seed);
  const pick = (n) => Math.floor(rnd() * n);
  const nodes = [];
  const edges = [];
  let ec = 0;
  const N = (id, extra = {}) => { nodes.push({ id, w: 80 + pick(3) * 20, h: 30 + pick(2) * 8, ...extra }); return id; };
  const E = (s, t) => { edges.push({ id: `e${ec++}`, source: s, target: t }); };

  if (kind === "chain") {
    const n = 6 + pick(8);
    for (let i = 0; i < n; i++) N(`n${i}`);
    for (let i = 1; i < n; i++) E(`n${i - 1}`, `n${i}`);
    for (let k = 0; k < 2; k++) { const a = pick(n - 2); E(`n${a}`, `n${Math.min(n - 1, a + 2 + pick(3))}`); }
  } else if (kind === "layered") {
    const levels = 3 + pick(3);
    const layer = [];
    for (let l = 0; l < levels; l++) {
      const size = 1 + pick(4);
      const row = [];
      for (let i = 0; i < size; i++) row.push(N(`l${l}_${i}`));
      layer.push(row);
      if (l) for (const t of row) {
        const prev = layer[l - 1];
        E(prev[pick(prev.length)], t);
        if (rnd() < 0.4) E(prev[pick(prev.length)], t);
      }
    }
  } else if (kind === "diamond") {
    const depth = 2 + pick(3);
    N("root");
    let frontier = ["root"];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (let i = 0; i < 2 + pick(2); i++) next.push(N(`d${d}_${i}`));
      for (const f of frontier) for (const t of next) if (rnd() < 0.7) E(f, t);
      for (const t of next) if (!edges.some((e) => e.target === t)) E(frontier[0], t);
      frontier = next;
    }
    N("sink");
    for (const f of frontier) E(f, "sink");
  } else if (kind === "fan") {
    N("hub");
    const out = 4 + pick(8);
    for (let i = 0; i < out; i++) { N(`o${i}`); E("hub", `o${i}`); }
    N("join");
    for (let i = 0; i < out; i++) if (rnd() < 0.8) E(`o${i}`, "join");
  } else if (kind === "multi") {
    const n = 4 + pick(4);
    for (let i = 0; i < n; i++) N(`m${i}`);
    for (let i = 1; i < n; i++) {
      const reps = 1 + pick(3);
      for (let k = 0; k < reps; k++) E(`m${i - 1}`, `m${i}`);
    }
    for (let k = 0; k < 3; k++) { const a = pick(n - 1); E(`m${a}`, `m${n - 1}`); }
  } else if (kind === "disconnected") {
    const comps = 2 + pick(3);
    for (let c = 0; c < comps; c++) {
      const n = 2 + pick(4);
      for (let i = 0; i < n; i++) N(`c${c}_${i}`);
      for (let i = 1; i < n; i++) E(`c${c}_${i - 1}`, `c${c}_${i}`);
      if (n > 2 && rnd() < 0.5) E(`c${c}_0`, `c${c}_${n - 1}`);
    }
    for (let i = 0; i < 1 + pick(3); i++) N(`lone${i}`);
  } else if (kind === "nested") {
    // one outer cluster holding an inner cluster plus loose members, and outside traffic
    N("OUT", { w: 10, h: 10 });
    N("IN", { w: 10, h: 10, parent: "OUT" });
    const inner = [];
    for (let i = 0; i < 2 + pick(2); i++) inner.push(N(`i${i}`, { parent: "IN" }));
    const mid = [];
    for (let i = 0; i < 1 + pick(2); i++) mid.push(N(`p${i}`, { parent: "OUT" }));
    const outside = [];
    for (let i = 0; i < 2 + pick(3); i++) outside.push(N(`x${i}`));
    for (let i = 1; i < inner.length; i++) E(inner[i - 1], inner[i]);
    for (const m of mid) E(inner[inner.length - 1], m);
    for (let i = 1; i < outside.length; i++) E(outside[i - 1], outside[i]);
    if (mid.length && outside.length) E(mid[0], outside[outside.length - 1]);
    if (outside.length > 1) E(outside[0], inner[0]);
  } else if (kind === "siblings") {
    // Two or three sibling containers whose members trade edges across the ranks they share
    // — the shape that used to make a cluster's block sit left of a sibling on one rank and
    // right of it on the next, and hand both of them the same full-width rect.
    const groups = [];
    for (let c = 0; c < 2 + pick(2); c++) {
      N(`G${c}`, { w: 10, h: 10 });
      const members = [];
      for (let i = 0; i < 2 + pick(3); i++) members.push(N(`g${c}_${i}`, { parent: `G${c}` }));
      for (let i = 1; i < members.length; i++) E(members[i - 1], members[i]);
      groups.push(members);
    }
    for (let c = 1; c < groups.length; c++) {
      const from = groups[c - 1], to = groups[c];
      // Deliberately symmetric: each group feeds the other's tail, so neither has a reason
      // to stay on one side of the other unless the solver makes it a hard constraint.
      E(from[0], to[to.length - 1]);
      E(to[0], from[from.length - 1]);
      if (rnd() < 0.5) E(from[pick(from.length - 1)], to[1 + pick(to.length - 1)]);
    }
    for (let i = 0; i < 1 + pick(3); i++) N(`free${i}`);
  } else {
    // wide: two very wide ranks with a random matching between them
    const n = 10 + pick(10);
    const a = [], b = [];
    for (let i = 0; i < n; i++) a.push(N(`a${i}`));
    for (let i = 0; i < n; i++) b.push(N(`b${i}`));
    for (let i = 0; i < n; i++) {
      E(a[i], b[pick(n)]);
      if (rnd() < 0.3) E(a[pick(n)], b[i]);
    }
  }
  return { nodes, edges };
}

const SEEDS = [1, 7, 42, 1337, 90210];
const cases = [];
for (const kind of KINDS) for (const seed of SEEDS) cases.push({ name: `${kind}#${seed}`, input: synth(kind, seed) });

// ------------------------------------------------------------------------ golden set

/** The shell withholds self-loops and back edges before the solver sees anything (D3). */
function acyclicView(view) {
  const real = view.edges.filter((e) => e.source !== e.target);
  const reversed = breakCycles(view.nodes, real);
  return {
    nodes: view.nodes.map((n) => ({ id: n.id, w: n.w, h: n.h })),
    edges: real.filter((e) => !reversed.has(e.id)).map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

const goldens = [
  { name: "diamond", input: acyclicView(fixtureDiamond()) },
  { name: "loop", input: acyclicView(fixtureLoop()) },
  { name: "loop+5", input: acyclicView(fixtureLoop(5)) },
  { name: "selfloop", input: acyclicView(fixtureSelfLoop()) },
];

// ------------------------------------------------------------------------------ tests

test("golden fixtures: engine invariants hold and crossings never regress on dagre", () => {
  for (const { name, input } of goldens) {
    const mine = engineSolve(input, { ...O, ...OPTS });
    checkInvariants(input, mine, { ...O, ...OPTS }, name);
    const theirs = dagreSolve(input, { ...O, ...OPTS });
    const a = countCrossings(drawn(input, mine));
    const b = countCrossings(drawn(input, theirs));
    assert.ok(a <= b, `${name}: engine ${a} crossings vs dagre ${b}`);
  }
});

test("seeded synthetics: engine invariants hold on all 45 graphs", () => {
  assert.equal(cases.length, 45);
  for (const { name, input } of cases) {
    const out = engineSolve(input, O);
    checkInvariants(input, out, O, name);
  }
});

test("seeded synthetics: crossings(engine) <= crossings(dagre) + 2", () => {
  const worse = [];
  let compared = 0;
  for (const { name, input } of cases) {
    const mine = engineSolve(input, O);
    let theirs;
    try {
      theirs = dagreSolve(input, O);
    } catch (err) {
      // dagre 3.1.1 throws "Not possible to find intersection inside of the rectangle"
      // on some compound graphs. Nothing to compare against; the engine's own
      // invariants (asserted above) still have to hold, and they do.
      console.log(`  (dagre failed on ${name}: ${err.message})`);
      continue;
    }
    compared++;
    const a = countCrossings(drawn(input, mine));
    const b = countCrossings(drawn(input, theirs));
    if (a > b + 2) worse.push(`${name}: engine ${a} vs dagre ${b}`);
  }
  assert.deepEqual(worse, []);
  assert.ok(compared >= 30, `only ${compared} graphs could be compared against dagre`);
});

test("seeded synthetics: every solve is deterministic and pure", () => {
  for (const { name, input } of cases) {
    const before = JSON.stringify(input);
    const a = JSON.stringify(engineSolve(input, O));
    const b = JSON.stringify(engineSolve(input, O));
    assert.equal(a, b, `${name} is not deterministic`);
    assert.equal(JSON.stringify(input), before, `${name}: input mutated`);
  }
});

test("seeded synthetics: feeding the drawing back is a fixed point", () => {
  // `order` names the real nodes; `layers` adds where each multi-rank edge bends. Both are
  // the stability channel — the caller persists them and hands them straight back — and a
  // re-solve of an unchanged graph has to land on the identical picture, not merely the
  // same ranks.
  for (const { name, input } of cases) {
    const first = engineSolve(input, O);
    const second = engineSolve(input, { ...O, prevOrder: first.order, prevLayers: first.layers });
    assert.deepEqual(second.order, first.order, `${name} drifted on re-layout`);
    assert.deepEqual(second.layers, first.layers, `${name}: bends drifted on re-layout`);
    assert.deepEqual(second.nodes, first.nodes, `${name}: geometry drifted on re-layout`);
  }
});

test("seeded synthetics: appending a node with prevOrder keeps every rank's order", () => {
  // The one licensed exception (INTERNALS: "keep the best-crossing result"): a reshuffle
  // that STRICTLY reduces crossings among the pre-existing edges is allowed. Anything
  // else — an equal-crossing reshuffle, or a worse one — is a mental-map violation.
  let improved = 0;
  for (const { name, input } of cases) {
    const first = engineSolve(input, O);
    const anchor = input.nodes.filter((n) => !input.nodes.some((m) => m.parent === n.id)).pop();
    const grown = {
      nodes: [...input.nodes, { id: "__new", w: 90, h: 30 }],
      edges: [...input.edges, { id: "__enew", source: anchor.id, target: "__new" }],
    };
    const second = engineSolve(grown, { ...O, prevOrder: first.order, prevLayers: first.layers });
    const was = countCrossings(drawn(input, first));
    const now = countCrossings(drawn(grown, second, input.edges));
    assert.ok(now <= was, `${name}: appending a node made the old edges cross more (${was} -> ${now})`);
    if (now < was) { improved++; continue; }
    for (let r = 0; r < first.order.length; r++) {
      const kept = (second.order[r] || []).filter((id) => first.order[r].includes(id));
      assert.deepEqual(kept, first.order[r].filter((id) => (second.order[r] || []).includes(id)), `${name}: rank ${r} reshuffled`);
    }
  }
  assert.ok(improved <= 3, `${improved}/40 graphs reshuffled on append — stability is too loose`);
});

test("all four dirs: invariants hold on every synthetic", () => {
  for (const dir of ["TB", "BT", "LR", "RL"]) {
    for (const { name, input } of cases) {
      const o = { ...O, dir };
      checkInvariants(input, engineSolve(input, o), o, `${name}/${dir}`);
    }
  }
});

test("scale: a 300-node layered graph solves quickly and stays sane", () => {
  const rnd = mulberry32(2026);
  const nodes = [], edges = [];
  const layers = [];
  let id = 0;
  for (let l = 0; l < 20; l++) {
    const row = [];
    for (let i = 0; i < 15; i++) {
      const nid = `n${id++}`;
      nodes.push({ id: nid, w: 100, h: 36 });
      row.push(nid);
    }
    layers.push(row);
  }
  let ec = 0;
  for (let l = 1; l < layers.length; l++) {
    for (const t of layers[l]) {
      const prev = layers[l - 1];
      edges.push({ id: `e${ec++}`, source: prev[Math.floor(rnd() * prev.length)], target: t });
      if (rnd() < 0.3) edges.push({ id: `e${ec++}`, source: prev[Math.floor(rnd() * prev.length)], target: t });
    }
  }
  const t0 = Date.now();
  const out = engineSolve({ nodes, edges }, O);
  const ms = Date.now() - t0;
  assert.equal(Object.keys(out.nodes).length, 300);
  checkInvariants({ nodes, edges }, out, O, "scale");
  assert.ok(ms < 4000, `300-node solve took ${ms}ms`);
});
