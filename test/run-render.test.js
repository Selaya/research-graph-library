// Regression coverage for src/run-render.js — the token-run decoration layer (D4).
// Driven through a hand-rolled minimal DOM (no jsdom in this repo) and a manually pumped
// rAF, the same technique test/integration.test.js established for M1.

import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// DOM shim + manual rAF pump (self-contained — this file owns its own globals).
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

let clock = 0;
const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => clock };

const flush = () => new Promise((r) => setTimeout(r, 0));

/** One frame: advance the clock, drain the rAF queue, let microtasks settle. */
async function pump(frames = 1, ms = 16) {
  for (let i = 0; i < frames; i++) {
    clock += ms;
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const fn of batch) fn(clock);
    await flush();
  }
}

/** Pump until `fn()` is truthy (or we run out of patience). Returns whether it fired. */
async function pumpUntil(fn, maxFrames = 2000) {
  for (let i = 0; i < maxFrames; i++) {
    if (fn()) return true;
    await pump(1);
  }
  return !!fn();
}

/** Await a promise that can only settle if the shared clock keeps running. */
async function settle(promise, maxFrames = 400) {
  let done = false;
  Promise.resolve(promise).then(() => { done = true; });
  const ok = await pumpUntil(() => done, maxFrames);
  assert.ok(ok, "awaited work settled within the frame budget");
}

/** Every element under `root` matching `fn` (the DOM shim has no querySelectorAll). */
function findAllEls(root, fn, out = []) {
  if (fn(root)) out.push(root);
  for (const c of root.children) findAllEls(c, fn, out);
  return out;
}

const { mount } = await import("../src/index.js");

// ---------------------------------------------------------------------------
// A tiny chain inside a container, so collapse/expand actually destroys/recreates the
// interior elements a run has already decorated.
// ---------------------------------------------------------------------------

function chainSpec() {
  return {
    nodes: [
      { id: "a", label: "A", data: { duration: "1s" } },
      { id: "c", label: "C", collapsed: false },
      { id: "c1", label: "C1", parent: "c", data: { duration: "1s" } },
      { id: "c2", label: "C2", parent: "c", data: { duration: "1s" } },
      { id: "z", label: "Z", data: { duration: "1s" } },
    ],
    edges: [
      { id: "e1", source: "a", target: "c1" },
      { id: "e2", source: "c1", target: "c2" },
      { id: "e3", source: "c2", target: "z" },
    ],
  };
}

function mountChain() {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, chainSpec(), { animation: { duration: 40 } });
  return { root, g };
}

test("run-render: a completed node's data-run decoration reappears after collapse/expand recreates its element", async () => {
  const { g } = mountChain();
  const run = g.run({});
  run.play();
  await pumpUntil(() => run.state().nodes.c1.status === "done", 800);

  const before = g.renderer.node("c1");
  assert.equal(before.getAttribute("data-run"), "done", "sanity: the live element carries the decoration");

  await settle(g.collapse("c"));
  await pump(3);
  await settle(g.expand("c"));
  await pump(3);

  const after = g.renderer.node("c1");
  assert.notEqual(after, before, "sanity: collapse/expand actually recreated the element");
  assert.equal(run.state().nodes.c1.status, "done", "the engine itself still reports the node done");
  assert.equal(after.getAttribute("data-run"), "done", "the fresh element must be decorated too — the cache must not suppress the write");

  g.destroy();
});

test("run-render: a fully-traversed edge's data-traversed decoration reappears after collapse/expand", async () => {
  const { g } = mountChain();
  const run = g.run({});
  run.play();
  await pumpUntil(() => (run.state().edges.e2 && run.state().edges.e2.traversed) >= 1, 800);

  const beforeEl = g.renderer.edge("e2");
  assert.equal(beforeEl.getAttribute("data-traversed"), "", "sanity: the live edge is marked traversed");

  await settle(g.collapse("c"));
  await pump(3);
  await settle(g.expand("c"));
  await pump(3);

  const afterEl = g.renderer.edge("e2");
  assert.notEqual(afterEl, beforeEl, "sanity: collapse/expand actually recreated the edge element");
  assert.ok(run.state().edges.e2.traversed >= 1, "the engine still reports the edge fully traversed");
  assert.equal(afterEl.getAttribute("data-traversed"), "", "the fresh edge element must be re-marked traversed");
  assert.equal(afterEl.style.getPropertyValue("--smv-traversed"), "1");

  g.destroy();
});

test("run-render: a failed node is written to the same data-run channel and announced on the 'runstatus' bus", async () => {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, {
    nodes: [
      { id: "a", label: "A", data: { duration: "1s" } },
      { id: "b", label: "B", data: { duration: "1s", fail: true } },
      { id: "z", label: "Z", data: { duration: "1s" } },
    ],
    edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "z" }],
  }, { animation: { duration: 40 } });

  const seen = [];
  g.on("runstatus", (ev) => seen.push(`${ev.id}:${ev.status}`));

  const run = g.run({});
  run.play();
  await pumpUntil(() => run.state().nodes.b.status === "failed", 800);
  await pump(2);

  assert.equal(g.renderer.node("b").getAttribute("data-run"), "failed",
    "the same attribute channel 'active'/'done' use — the stylesheet needs nothing else");
  assert.equal(g.renderer.node("a").getAttribute("data-run"), "done");
  assert.equal(g.renderer.node("z").getAttribute("data-run"), null,
    "the successor is never decorated: nothing was handed on to it");
  assert.ok(seen.includes("b:failed"), "a11y.js and the a11y table hear it on the existing bus channel");

  g.destroy();
});

test("run-render: a live dwell past its declared duration is written to data-over-budget (F13)", async () => {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, {
    nodes: [{ id: "a", label: "A", data: { duration: "100ms" } }, { id: "b", label: "B" }],
    edges: [{ id: "e1", source: "a", target: "b" }],
  }, { animation: { duration: 40 } });

  const run = g.run({ mode: "live" });
  await pump(2);
  run.start("a");
  await pump(2);
  assert.equal(g.renderer.node("a").getAttribute("data-over-budget"), null,
    "inside its declared budget the node carries nothing extra");

  await pumpUntil(() => run.state().nodes.a.overBudget === true, 60);
  await pump(1);
  assert.equal(g.renderer.node("a").getAttribute("data-over-budget"), "",
    "the live dwell outran data.duration — its own channel, alongside data-run");
  assert.equal(g.renderer.node("a").getAttribute("data-run"), "active");

  run.finish("a");
  await pump(1);
  assert.equal(g.renderer.node("a").getAttribute("data-over-budget"), "",
    "…and the finish that closed the over-long dwell does not erase it");

  run.start("a"); // the retry of a done node: judged against its own dwell from scratch
  await pump(1);
  assert.equal(g.renderer.node("a").getAttribute("data-over-budget"), null);

  g.destroy();
});

// ---------------------------------------------------------------------------
// F31 — the container status rollup is a policy (`statusAgg`), and the picture follows it.
// ---------------------------------------------------------------------------

/** A lifeline-shaped graph: one call into `svc` fails, a second, longer one succeeds. */
function lifelineSpec(statusAgg) {
  return {
    nodes: [
      { id: "svc", label: "auth", ...(statusAgg ? { statusAgg } : {}) },
      { id: "hit", label: "401", parent: "svc", data: { duration: "1s", fail: "401" } },
      { id: "retry", label: "retry", parent: "svc", data: { duration: "5s" } },
      { id: "r1", label: "R1" }, { id: "r2", label: "R2" },
    ],
    edges: [{ id: "e1", source: "r1", target: "hit" }, { id: "e2", source: "r2", target: "retry" }],
  };
}

function mountLifeline(statusAgg) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  return mount(root, lifelineSpec(statusAgg), { animation: { duration: 40 } });
}

test("run-render: the default rollup leaves a container painted failed for the rest of the run", async () => {
  const g = mountLifeline();
  const run = g.run({});
  run.play();
  await pumpUntil(() => run.state().done, 1200);
  await pump(2);
  assert.equal(g.renderer.node("svc").getAttribute("data-run"), "failed");
  g.destroy();
});

test("run-render: statusAgg 'latest' repaints the container once a later call succeeds", async () => {
  const g = mountLifeline("latest");
  const seen = [];
  g.on("runstatus", (ev) => { if (ev.id === "svc") seen.push(ev.status); });
  const run = g.run({});
  run.play();

  await pumpUntil(() => run.state().nodes.hit.status === "failed", 1200);
  await pump(2);
  assert.equal(g.renderer.node("svc").getAttribute("data-run"), "failed", "red while the failure is the latest news");

  await pumpUntil(() => run.state().done, 1200);
  await pump(2);
  assert.equal(g.renderer.node("svc").getAttribute("data-run"), "done", "…and back to done once the retry lands");
  assert.equal(g.renderer.node("hit").getAttribute("data-run"), "failed", "the child that failed stays failed");
  assert.deepEqual(seen.slice(-2), ["failed", "done"], "the flip is announced on the same bus channel");
  g.destroy();
});

test("run-render: statusAgg 'none' never paints the container from its children at all", async () => {
  const g = mountLifeline("none");
  const run = g.run({});
  run.play();
  await pumpUntil(() => run.state().done, 1200);
  await pump(2);
  assert.equal(g.renderer.node("svc").getAttribute("data-run"), "done");
  assert.equal(g.renderer.node("hit").getAttribute("data-run"), "failed");
  g.destroy();
});

// ---------------------------------------------------------------------------
// F21 — the occupancy badge and the preset's duration chip have separate slots, including
// in the gutter above a short box, where the chip row lifts to clear a centred label.
// ---------------------------------------------------------------------------

test("run-render: the ×N occupancy badge and the preset's duration chip never share a slot", async () => {
  const { textWidth } = await import("../src/measure.js");
  const BADGE_FONT = "600 10px system-ui,-apple-system,'Segoe UI',sans-serif";
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, {
    nodes: [
      { id: "A", label: "A", data: { duration: "1s" } },
      // Explicit w/h opts out of the measure hook, so the box stays 36px tall and the
      // preset lifts its chip row into the gutter the badge also lives in.
      { id: "M", label: "M", w: 120, h: 36, data: { duration: "300ms" } },
    ],
    edges: [{ id: "e1", source: "A", target: "M" }],
  }, { animation: { duration: 40 }, preset: "pipeline" });

  const run = g.run({ mode: "live" });
  run.start("A");
  await pump(2);
  run.finish("A");
  await pumpUntil(() => run.state().nodes.M.occupancy > 0, 200);
  run.spawn("M", 3);
  await pumpUntil(() => run.state().nodes.M.occupancy === 4, 200);
  await pump(2);

  const badge = findAllEls(root, (n) => (n.attrs.class || "") === "smv-token-badge" && n.textContent === "×4")[0];
  assert.ok(badge, "the occupancy badge is drawn");
  const chip = findAllEls(g.renderer.node("M"), (n) => (n.attrs.class || "") === "smv-chip")[0];
  assert.ok(chip && chip.textContent === "300ms", "the preset chip is drawn");

  const rect = g.layoutResult().nodes.M;
  const left = rect.x - rect.w / 2;
  const chipRight = left + Number(chip.attrs.x); // .smv-chip is text-anchor:end
  assert.equal(Number(chip.attrs.y), -7, "sanity: the short box lifted its chip row");
  assert.equal(Number(badge.attrs.y), rect.y - rect.h / 2 - 7, "badge and chip share the gutter");
  // .smv-token-badge is text-anchor:start from the box's left edge; .smv-chip runs
  // leftwards from the right edge. The two spans must not meet.
  assert.ok(
    Number(badge.attrs.x) + textWidth("×4", BADGE_FONT) < chipRight - textWidth("300ms", BADGE_FONT),
    "the badge's span ends before the chip's begins",
  );

  g.destroy();
});
