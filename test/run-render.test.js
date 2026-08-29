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
