// F40 — a `dur` on a discrete step (caption / highlight / clearHighlight / props /
// run.step / run.seek) is a HOLD. durOf() already priced such a step at `step.dur`, so the
// scrubber and the cue sheet declared a length the sequencer never waited for — the exact
// disagreement D12 forbids — and every page wrote the beat as caption + wait + caption(null)
// instead. Same DOM shim + manual-ticker idiom as test/toggle-camera.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { captionSpans } from "../bin/cues.mjs";

// ---------------------------------------------------------------------------
// DOM shim (integration.test.js's makeEl, verbatim).
// ---------------------------------------------------------------------------

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "", value: "",
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
      getPropertyValue(k) { return this._p[k] ?? ""; },
    },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
    },
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return this.attrs[k] !== undefined; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove();
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) { if (c.parent === this) c.remove(); return c; },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 480 }; },
    clientWidth: 900, clientHeight: 480,
    setPointerCapture() {}, releasePointerCapture() {},
    querySelector() { return null; },
    getContext() { return { font: "", measureText: (s) => ({ width: String(s).length * 7.2 }) }; },
  };
  Object.defineProperty(el, "parentNode", { get() { return this.parent; } });
  el.ownerDocument = null;
  return el;
}

const head = makeEl("head");
const doc = {
  head,
  documentElement: head,
  createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; },
  createElementNS(ns, t) { const e = makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector(sel) {
    return head.children.find((c) => c.tagName === "style" && Object.keys(c.attrs).some((k) => sel.includes(k))) || null;
  },
};
globalThis.document = doc;
globalThis.window = { matchMedia: () => ({ matches: false }) };

const flush = () => new Promise((r) => setTimeout(r, 0));
const { mount } = await import("../src/index.js");

const fire = (el, type, ev = {}) => { for (const fn of el.listeners[type] || []) fn(ev); };
function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));

async function settle(promise, g, maxTicks = 800, ms = 16) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
  return out;
}
/** Ticks until `pred()` is true; returns how many ticks it took (or -1 past `max`). */
async function ticksUntil(pred, g, max, ms = 16) {
  for (let i = 0; i <= max; i++) {
    await flush();
    if (pred()) return i;
    g.ticker.tick(ms);
  }
  return -1;
}

const spec = () => ({
  nodes: [{ id: "a", label: "Ingest" }, { id: "b", label: "Build" }],
  edges: [{ id: "e", source: "a", target: "b" }],
});
function mountT(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec(), { ticker: "manual", animation: { duration: 120 }, ...opts });
  return { root, g };
}

// ---------------------------------------------------------------------------

test("a caption step's `dur` is held on the shared clock, so the story is awaited for what it declares", async () => {
  const steps = [
    { op: "caption", args: ["hello"], dur: 1600 },
    { op: "caption", args: [null] },
  ];
  const { g } = mountT({ storyboard: steps });
  assert.equal(g.timeline().total, 1600, "durOf() prices the caption at its dur (as it always did)");
  let done = false;
  g.storyboard().play().then(() => { done = true; });
  await flush(); await flush(); await flush();
  assert.equal(done, false, "…and the sequencer now waits for it (it used to finish with zero ticks of the clock)");
  const n = await ticksUntil(() => done, g, 200);
  assert.ok(n >= 100 && n <= 101, `landed after 1600ms of ticks (took ${n} × 16ms)`);
  g.destroy();
});

test("the cue sheet's caption span ends where the hold ends — one step replaces caption + wait", async () => {
  const held = [{ op: "caption", args: ["one"], dur: 1500 }, { op: "caption", args: [null] }];
  const waited = [{ op: "caption", args: ["one"] }, { op: "wait", ms: 1500 }, { op: "caption", args: [null] }];
  const { g: g1 } = mountT({ storyboard: held });
  const { g: g2 } = mountT({ storyboard: waited });
  const s1 = captionSpans(g1.cues(), g1.timeline().total);
  const s2 = captionSpans(g2.cues(), g2.timeline().total);
  assert.deepEqual(s1, [{ start: 0, end: 1500, text: "one" }]);
  assert.deepEqual(s1, s2, "same subtitle, one step fewer");
  g1.destroy(); g2.destroy();
});

test("highlight / clearHighlight / props / run.step / run.seek hold for their dur; bare, they stay instant", async () => {
  const held = [
    { op: "highlight", args: [{ nodes: ["a"], pulse: true }], dur: 320 },
    { op: "props", args: [{ a: { "--smv-fill": "#f50" } }], dur: 160 },
    { op: "clearHighlight", dur: 160 },
    { op: "run.step", dur: 160 },
    { op: "run.seek", ms: 0, dur: 160 },
  ];
  const { g } = mountT({ storyboard: held });
  assert.equal(g.timeline().total, 960);
  let done = false;
  g.storyboard().play().then(() => { done = true; });
  const n = await ticksUntil(() => done, g, 200);
  assert.ok(n >= 60 && n <= 65, `awaited for the declared 960ms (took ${n} × 16ms)`);
  g.destroy();

  const bare = [
    { op: "highlight", args: [{ nodes: ["a"] }] },
    { op: "props", args: [{ a: { "--smv-fill": "#f50" } }] },
    { op: "clearHighlight" },
    { op: "caption", args: ["x"] },
    { op: "caption", args: [null] },
  ];
  const { g: g2 } = mountT({ storyboard: bare });
  assert.equal(g2.timeline().total, 1, "a story of discrete flips is worth nothing on the clock");
  let done2 = false;
  g2.storyboard().play().then(() => { done2 = true; });
  await flush(); await flush(); await flush();
  assert.equal(done2, true, "…and plays through without a single tick, as before");
  g2.destroy();
});

test("`run` / `run.reset` never hold: durOf() prices them at 0 before it reads `dur`", async () => {
  const steps = [{ op: "run", args: [{}], dur: 500 }, { op: "run.reset", dur: 500 }];
  const { g } = mountT({ storyboard: steps });
  assert.equal(g.timeline().total, 1);
  let done = false;
  g.storyboard().play().then(() => { done = true; });
  await flush(); await flush(); await flush();
  assert.equal(done, true, "declared 0, awaited 0");
  g.destroy();
});

test("inside a batch, a held child stretches the step exactly as durOf() declares", async () => {
  const steps = [{ op: "batch", steps: [
    { op: "addNode", args: [{ id: "c" }] },
    { op: "caption", args: ["adding c"], dur: 800 },
  ] }];
  const { g } = mountT({ storyboard: steps });
  assert.equal(g.timeline().total, 800, "the hold runs alongside the commit, like a wait would");
  let done = false;
  g.storyboard().play().then(() => { done = true; });
  const n = await ticksUntil(() => done, g, 200);
  assert.ok(n >= 50 && n <= 52, `awaited 800ms, not the 120ms commit (took ${n} × 16ms)`);
  assert.ok(g.node("c"));
  g.destroy();
});

test("a forward scrub skips the hold — you asked for a position, not a screening", async () => {
  const steps = [
    { label: "go" },
    { op: "caption", args: ["long"], dur: 8000 },
    { op: "highlight", args: [{ nodes: ["a"] }], dur: 8000 },
    { op: "wait", ms: 100 },
  ];
  const { root, g } = mountT({ storyboard: steps, controls: true });
  const scrub = byClass(root, "smv-transport-scrub")[0];
  fire(scrub, "pointerdown", {});
  scrub.value = "1000";
  fire(scrub, "input", {});
  const n = await ticksUntil(() => g.storyboard().position().index === 3, g, 150);
  fire(scrub, "change", {});
  assert.ok(n >= 0 && n < 150, `landed within a budget far smaller than the 16s declared (took ${n} ticks)`);
  g.destroy();
});

test("a backward seek out of a held caption cancels nothing it should not: the restored snapshot wins", async () => {
  const steps = [
    { label: "start" },
    { op: "caption", args: ["held"], dur: 1000 },
    { label: "after" },
  ];
  const { g } = mountT({ storyboard: steps });
  const sb = g.storyboard();
  await settle(sb.next(), g);          // start
  const p = sb.next();                 // the held caption — suspended on the clock
  g.ticker.tick(160); await flush();
  await settle(sb.seek("start"), g);
  assert.equal(sb.position().index, 0);
  assert.equal(g.cues().find((c) => c.kind === "caption").text, "held", "the cue sheet is untouched");
  await settle(p, g, 100);             // the voided step settles without advancing the cursor
  assert.equal(sb.position().index, 0);
  g.destroy();
});
