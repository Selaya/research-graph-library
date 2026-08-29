// D6 mental map: a condense/split has to LAND where its choreography flew it from.
// condense-anim/split-anim animate the new node out of the sources' old centroid, but the
// solver had never seen its id, and an unknown id sorts after everything known — so the
// node bloomed at the centroid and then flew past every untouched sibling to the tail of
// its rank. test/condense.test.js's fake host never threads prevOrder, so it structurally
// cannot see this; this file drives the real mount() instead.

import { test } from "node:test";
import assert from "node:assert/strict";

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "",
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, contains(c) { return this._s.has(c); } },
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return this.attrs[k] !== undefined; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove(); c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) { if (c.parent === this) c.remove(); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 480 }; },
    clientWidth: 900, clientHeight: 480,
    setPointerCapture() {}, releasePointerCapture() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return { font: "", measureText: (s) => ({ width: String(s).length * 7.2 }) }; },
  };
  Object.defineProperty(el, "parentNode", { get() { return this.parent; } });
  el.ownerDocument = null;
  return el;
}

const head = makeEl("head");
const doc = {
  head, documentElement: head,
  createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; },
  createElementNS(ns, t) { const e = makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector() { return null; },
};
globalThis.document = doc;

let clock = 0;
const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => clock };
const flush = () => new Promise((r) => setTimeout(r, 0));
async function pump(frames, ms = 16) {
  for (let i = 0; i < frames; i++) {
    clock += ms;
    for (const fn of rafQueue.splice(0, rafQueue.length)) fn(clock);
    await flush();
  }
}

const { mount } = await import("../src/index.js");

/** src -> m0..m4 -> sink: one wide rank whose members are all interchangeable siblings. */
function fanSpec() {
  const nodes = [{ id: "src" }, { id: "sink" }];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push({ id: `m${i}` });
    edges.push({ id: `in${i}`, source: "src", target: `m${i}` });
    edges.push({ id: `out${i}`, source: `m${i}`, target: "sink" });
  }
  return { nodes, edges };
}

function mountFan() {
  const root = makeEl("div");
  root.ownerDocument = doc;
  return mount(root, fanSpec(), { animation: { duration: 0 }, a11y: false, interaction: { tapToggle: false } });
}

const rankY = (g, ids) => ids.map((id) => g.layoutResult().nodes[id].y);

test("condense: the merged node lands between its sources, not at the tail of the rank", async () => {
  const g = mountFan();
  await pump(3);
  const before = g.layoutResult().nodes;
  const sources = ["m0", "m1"];
  const centroid = (before.m0.y + before.m1.y) / 2;
  const untouched = rankY(g, ["m2", "m3", "m4"]);

  const run = g.condense(sources, { id: "merged", label: "merged" });
  await pump(140); // past the full 900ms choreography
  await run;

  const merged = g.layoutResult().nodes.merged;
  assert.ok(merged, "the merged node exists");
  // It must not have flown past every sibling that never moved.
  assert.ok(
    merged.y < Math.max(...untouched),
    `merged landed at y=${merged.y}, past untouched siblings at ${untouched.join(", ")}`
  );
  // And it should settle near where the choreography flew it from.
  const spread = Math.max(...untouched) - Math.min(...untouched);
  assert.ok(
    Math.abs(merged.y - centroid) <= spread,
    `merged y=${merged.y} is nowhere near the sources' centroid ${centroid}`
  );
  g.destroy();
});

test("split: the parts land where the node they came out of stood", async () => {
  const g = mountFan();
  await pump(3);
  const wasY = g.layoutResult().nodes.m2.y; // the middle of the rank
  const others = rankY(g, ["m3", "m4"]);

  const run = g.split("m2", { nodes: [{ id: "s1" }, { id: "s2" }] });
  await pump(140);
  await run;

  const after = g.layoutResult().nodes;
  for (const id of ["s1", "s2"]) {
    assert.ok(after[id], `${id} exists`);
    assert.ok(
      after[id].y < Math.max(...others) + 1e-6 || Math.abs(after[id].y - wasY) < Math.max(...others) - wasY,
      `${id} landed at y=${after[id].y}, past m3/m4 at ${others.join(", ")} (m2 was at ${wasY})`
    );
  }
  g.destroy();
});
