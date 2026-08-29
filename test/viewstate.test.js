import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createViewState } from "../src/viewstate.js";
import { layout, CONTAINER_PAD } from "../src/layout.js";

/** A -> C{c1 -> c2 -> c3, c3 -> c1 loop} -> Z, plus two boundary edges out of C's children. */
function spec(collapsed) {
  return {
    nodes: [
      { id: "A" },
      { id: "C", label: "clean", collapsed: collapsed || undefined },
      { id: "c1", parent: "C" },
      { id: "c2", parent: "C" },
      { id: "c3", parent: "C" },
      { id: "Z" },
    ],
    edges: [
      { id: "eAC", source: "A", target: "C" },
      { id: "e12", source: "c1", target: "c2" },
      { id: "e23", source: "c2", target: "c3" },
      { id: "eLoop", source: "c3", target: "c1", loop: true, maxIterations: 5 },
      { id: "e1Z", source: "c1", target: "Z" },
      { id: "e2Z", source: "c2", target: "Z" },
    ],
  };
}

const setup = (collapsed) => {
  const store = new Store(spec(collapsed));
  return { store, vs: createViewState(store) };
};
const ids = (list) => list.map((x) => x.id).sort();
const byId = (list) => new Map(list.map((x) => [x.id, x]));

test("collapsed:true in the spec seeds the collapsed set; descendants are invisible", () => {
  const { vs } = setup(true);
  assert.deepEqual([...vs.collapsed], ["C"]);
  assert.equal(vs.isContainer("C"), true);
  assert.equal(vs.isContainer("c1"), false);
  assert.equal(vs.isVisible("C"), true);
  assert.equal(vs.isVisible("c1"), false);
  assert.deepEqual(ids(vs.view().nodes), ["A", "C", "Z"]);
});

test("a collapsed container is a plain node with a ×N badge allowance, no parent links", () => {
  const { vs } = setup(true);
  const v = vs.view();
  const c = byId(v.nodes).get("C");
  assert.equal(c.container, true);
  assert.equal(c.collapsed, true);
  assert.equal(c.count, 3, "×3 counts the hidden descendants");
  assert.ok(v.nodes.every((n) => n.parent === undefined), "no child is visible, so nothing has a parent");

  const { vs: open } = setup(false);
  const wide = byId(open.view().nodes).get("C").w;
  assert.ok(c.w > wide, `collapsed container reserves badge room (${c.w} > ${wide})`);
});

test("meta-edges: parallel boundary edges dedupe into meta:<src>-><tgt> with a weight", () => {
  const { vs } = setup(true);
  const v = vs.view();
  const e = byId(v.edges).get("meta:C->Z");
  assert.ok(e, `expected a meta edge, got [${ids(v.edges)}]`);
  assert.deepEqual({ source: e.source, target: e.target, weight: e.weight }, { source: "C", target: "Z", weight: 2 });
  assert.deepEqual(v.meta.metaEdges.get("meta:C->Z"), { sources: ["e1Z", "e2Z"], weight: 2 });
  assert.equal(v.edges.filter((x) => x.id.startsWith("meta:")).length, 1, "the two child edges collapse into one line");
  // An edge whose endpoints were both already visible keeps its own identity.
  assert.ok(byId(v.edges).get("eAC"), "eAC is untouched: A and C are both visible");
});

test("a loop wholly inside a collapsed container becomes a loopBadge, not an edge (D3)", () => {
  const { vs } = setup(true);
  const v = vs.view();
  assert.deepEqual(v.meta.loopBadges, [{ id: "C", max: 5 }]);
  assert.equal(v.edges.some((e) => e.id === "eLoop"), false);
  assert.equal(v.edges.some((e) => e.id === "e12" || e.id === "e23"), false, "interior edges vanish too");
});

test("expanded: children carry parent links and container edges re-attach to entry/exit children", () => {
  const { vs } = setup(false);
  const v = vs.view();
  assert.deepEqual(ids(v.nodes), ["A", "C", "Z", "c1", "c2", "c3"]);
  assert.deepEqual(byId(v.nodes).get("c2").parent, "C");
  assert.equal(byId(v.nodes).get("C").parent, undefined);
  assert.equal(byId(v.nodes).get("C").collapsed, undefined);

  // dagre throws on any edge incident to a cluster, so nothing may point at C itself.
  const containers = new Set(v.nodes.filter((n) => n.container).map((n) => n.id));
  for (const e of v.edges) {
    assert.equal(containers.has(e.source), false, `${e.id} still leaves the container node`);
    assert.equal(containers.has(e.target), false, `${e.id} still enters the container node`);
  }
  assert.equal(byId(v.edges).get("eAC").target, "c1", "incoming edge lands on the interior entry child");
  assert.equal(byId(v.edges).get("e1Z").source, "c1", "child edges keep their own endpoints");
  assert.equal(v.meta.metaEdges.size, 0);
  assert.deepEqual(v.meta.loopBadges, []);
});

test("expand/collapse round-trips to exactly the same view", () => {
  const { vs } = setup(false);
  const before = vs.view();
  assert.equal(vs.collapse("C"), true);
  assert.equal(vs.collapse("C"), false, "collapsing twice is a no-op");
  assert.deepEqual(ids(vs.view().nodes), ["A", "C", "Z"]);
  assert.equal(vs.expand("C"), true);
  assert.equal(vs.expand("C"), false, "expanding twice is a no-op");
  const after = vs.view();
  assert.deepEqual(ids(after.nodes), ids(before.nodes));
  assert.deepEqual(ids(after.edges), ids(before.edges));
  assert.deepEqual(after.sizes, before.sizes);
});

test("collapse() only applies to nodes that actually have children", () => {
  const { vs } = setup(false);
  assert.equal(vs.collapse("A"), false);
  assert.deepEqual([...vs.collapsed], []);
});

test("the expanded view lays out: the container wraps its children with a 28px header strip", () => {
  const { vs } = setup(false);
  const v = vs.view();
  const res = layout(v, { dir: "LR" });
  const c = res.nodes.C;
  const kids = ["c1", "c2", "c3"].map((id) => res.nodes[id]);
  const top = Math.min(...kids.map((k) => k.y - k.h / 2));
  assert.ok(c.y - c.h / 2 <= top - CONTAINER_PAD.top,
    `header strip must clear the topmost child (container top ${c.y - c.h / 2}, child top ${top})`);
  for (const k of kids) {
    assert.ok(k.x - k.w / 2 >= c.x - c.w / 2 + CONTAINER_PAD.side, "child sits inside horizontally");
    assert.ok(k.x + k.w / 2 <= c.x + c.w / 2 - CONTAINER_PAD.side, "child sits inside horizontally");
    assert.ok(k.y + k.h / 2 <= c.y + c.h / 2 - CONTAINER_PAD.bottom, "child sits inside vertically");
  }
  for (const e of Object.values(res.edges)) {
    for (const p of e.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "no NaN geometry");
  }
});

test("nodes added with collapsed:true after their children land still collapse", () => {
  const store = new Store({ nodes: [{ id: "A" }], edges: [] });
  const vs = createViewState(store);
  store.addNode({ id: "G", collapsed: true });
  assert.deepEqual([...vs.collapsed], [], "no children yet — nothing to collapse");
  store.addNode({ id: "g1", parent: "G" });
  assert.deepEqual(ids(vs.view().nodes), ["A", "G"]);
  assert.deepEqual([...vs.collapsed], ["G"]);
});
