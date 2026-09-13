// F5/F6/F36 — the storyboard's run-shaped ops, listener survival across a recompile, and
// the documented "story finished" signal, driven through mount() itself (the op table in
// src/storyboard.js is only half of each: index.js's applyStep is the other half).
//
// Same hand-rolled DOM shim + manual-ticker idiom as test/core-api-fixes.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

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
  // What `autoplay: "auto"` reads (F36); each test sets the search string it wants.
  defaultView: { location: { search: "" } },
};
globalThis.document = doc;
globalThis.window = { matchMedia: () => ({ matches: false }) };

const flush = () => new Promise((r) => setTimeout(r, 0));

const { mount, GraphError } = await import("../src/index.js");
const { timeline: tl } = await import("../src/storyboard.js");

/** Drive the manual clock until `promise` settles (opts.ticker:"manual", D1). */
async function settle(promise, g, maxTicks = 2000, ms = 16) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
  return out;
}

/** Pump the clock for `n` frames without waiting on anything. */
async function pump(g, n = 4, ms = 16) {
  for (let i = 0; i < n; i++) { g.ticker.tick(ms); await flush(); }
}

const spec = () => ({
  nodes: [
    { id: "a", label: "A", data: { duration: "1s" } },
    { id: "box", label: "Box", collapsed: true },
    { id: "box.x", label: "X", parent: "box", data: { duration: "1s" } },
    { id: "box.y", label: "Y", parent: "box", data: { duration: "1s" } },
    { id: "c", label: "C", data: { duration: "1s" } },
  ],
  edges: [
    { id: "e1", source: "a", target: "box.x" },
    { id: "e2", source: "box.x", target: "box.y" },
    { id: "e3", source: "box.y", target: "c" },
  ],
});

function mountG(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec(), { ticker: "manual", layout: { dir: "LR" }, animation: { duration: 40 }, ...opts });
  return { root, g };
}

// ---------------------------------------------------------------------------
// F5 — run / run.reset / expandAll / collapseAll / layout as storyboard ops
// ---------------------------------------------------------------------------

test("F5: a `run` op compiles exactly like g.run(opts), from inside the declared timeline", async () => {
  const { g } = mountG({ storyboard: [{ op: "run", args: [{ hopMs: 1000 }] }] });
  assert.equal(g.run().options().hopMs, undefined, "no compile has happened yet");
  const slow = g.run().duration;

  await settle(g.storyboard().play(), g);
  assert.equal(g.run().options().hopMs, 1000, "the step recompiled with its own opts");
  assert.ok(g.run().duration > slow, "…and the new schedule is the one the run now plays");
  g.destroy();
});

test("F5: a `run.reset` op re-seats the SAME transport at t=0 (identity and listeners intact)", async () => {
  const { g } = mountG({ storyboard: [{ op: "run.seek", ms: 900 }, { op: "run.reset" }] });
  const run = g.run({ hopMs: 120 });
  const seen = [];
  run.on("seek", (e) => seen.push(e.time));

  await settle(g.storyboard().play(), g);
  assert.equal(g.run(), run, "run.reset never replaces the transport");
  assert.equal(run.time(), 0, "…it puts the clock back to the start");
  assert.equal(run.options().hopMs, 120, "…keeping the compile inputs it was given");
  assert.deepEqual(seen, [900, 0], "the listener registered before the step saw both moves");
  g.destroy();
});

test("F5: expandAll / collapseAll ops flip every container from the script", async () => {
  const events = [];
  const { g } = mountG({ storyboard: [{ op: "expandAll" }, { label: "open" }, { op: "collapseAll" }] });
  g.on("expandAll", (e) => events.push(["expandAll", e.ids]));
  g.on("collapseAll", (e) => events.push(["collapseAll", e.ids]));

  await settle(g.storyboard().seek("open"), g);
  assert.deepEqual(events, [["expandAll", ["box"]]], "the expandAll step ran through g's own method");
  assert.ok(g.layoutResult().nodes["box.x"], "the children are drawn");

  await settle(g.storyboard().play(), g);
  assert.deepEqual(events[1], ["collapseAll", ["box"]]);
  assert.ok(!g.layoutResult().nodes["box.x"], "…and the collapseAll step closed it again");
  g.destroy();
});

test("F5: a `layout` op re-lays the graph out with new opts", async () => {
  const { g } = mountG({ storyboard: [{ op: "layout", args: [{ dir: "TB" }] }] });
  const before = g.layoutResult().nodes;
  assert.ok(before.c.x > before.a.x, "LR to start with");

  await settle(g.storyboard().play(), g);
  const after = g.layoutResult().nodes;
  assert.ok(after.c.y > after.a.y, "the step switched the direction to TB");
  g.destroy();
});

test("F5: a backward seek past a `layout` op restores the direction it was taken with", async () => {
  const { g } = mountG({
    storyboard: [{ label: "start" }, { op: "layout", args: [{ dir: "TB" }] }, { label: "end" }],
  });
  await settle(g.storyboard().play(), g);
  const after = g.layoutResult().nodes;
  assert.ok(after.c.y > after.a.y, "played through: TB");

  await settle(g.storyboard().seek("start"), g);
  const back = g.layoutResult().nodes;
  assert.ok(back.c.x > back.a.x, "seeking back before the layout step puts LR back on screen");

  await settle(g.storyboard().seek("end"), g);
  assert.ok(g.layoutResult().nodes.c.y > g.layoutResult().nodes.a.y, "…and replaying re-applies TB");
  g.destroy();
});

test("F5: the new ops are priced on the same declared timeline cues() and the scrubber read", async () => {
  const { g } = mountG({
    animation: { duration: 400 },
    storyboard: [
      { label: "start" },
      { op: "run", args: [{ hopMs: 100 }] },   // discrete flip: 0ms
      { op: "run.reset" },                     // discrete flip: 0ms
      { op: "expandAll" },                     // a commit: the base animation duration
      { label: "open" },
      { op: "layout", args: [{ dir: "TB" }], dur: 250 },
      { label: "end" },
    ],
  });
  assert.deepEqual(g.cues(), [
    { kind: "label", at: 0, label: "start", index: 0 },
    { kind: "label", at: 400, label: "open", index: 4 },
    { kind: "label", at: 650, label: "end", index: 6 },
  ]);
  assert.equal(g.timeline().total, 650);
  g.destroy();
});

test("F5: the ops validate at build time, like every other op", () => {
  const { g } = mountG();
  assert.throws(
    () => g.storyboard([{ op: "run", args: ["deploy"] }]),
    (e) => e instanceof GraphError && e.code === "storyboard-step" && /step 0/.test(e.message),
    "a run.play-shaped argument on the `run` op is caught before playback",
  );
  assert.throws(
    () => g.storyboard([{ op: "batch", steps: [{ op: "layout", args: [["TB"]] }] }]),
    (e) => e instanceof GraphError && e.code === "storyboard-step" && /step 0\.0/.test(e.message),
  );
  assert.doesNotThrow(() => g.storyboard([{ op: "run" }, { op: "run.reset" }, { op: "expandAll" }, { op: "collapseAll" }, { op: "layout" }]));
  g.destroy();
});

test("F5: the fluent builder knows the new ops", () => {
  const built = tl()
    .runCompile({ hopMs: 120 })
    .expandAll()
    .layout({ dir: "TB" })
    .collapseAll()
    .runReset()
    .build();
  assert.deepEqual(built, [
    { op: "run", args: [{ hopMs: 120 }] },
    { op: "expandAll" },
    { op: "layout", args: [{ dir: "TB" }] },
    { op: "collapseAll" },
    { op: "run.reset" },
  ]);
  const { g } = mountG();
  assert.doesNotThrow(() => g.storyboard(built));
  g.destroy();
});

// ---------------------------------------------------------------------------
// F6 — run.on(...) survives g.run(opts), and run events mirror onto g
// ---------------------------------------------------------------------------

test("F6: listeners registered on the run survive a g.run(opts) recompile", async () => {
  const { g } = mountG();
  const run = g.run({ hopMs: 100 });
  const seen = [];
  run.on("play", () => seen.push("play"));
  run.on("fail", () => seen.push("fail"));

  const fresh = g.run({ hopMs: 400 });
  assert.notEqual(fresh, run, "g.run(opts) still hands back a brand-new transport");
  await settle(fresh.play({ until: "a" }), g);
  assert.deepEqual(seen, ["play"], "the handler registered before the recompile still fires");
  g.destroy();
});

test("F6: unsubscribing works across a recompile, from either handle or the returned off()", async () => {
  const { g } = mountG();
  const run = g.run({});
  let viaOff = 0, viaUnsub = 0;
  const onPlay = () => { viaOff++; };
  run.on("play", onPlay);
  const unsub = run.on("play", () => { viaUnsub++; });

  run.off("play", onPlay);   // dropped on the old handle, before the recompile
  unsub();
  const fresh = g.run({});
  await settle(fresh.play({ until: "a" }), g);
  assert.equal(viaOff, 0, "off() on the old handle really unsubscribes, not just locally");
  assert.equal(viaUnsub, 0, "…and so does the unsubscriber on() handed back");
  g.destroy();
});

test("F6: the unsubscriber still drops the handler when it is called AFTER a recompile", async () => {
  const { g } = mountG();
  const run = g.run({});
  let viaUnsub = 0, viaOff = 0;
  const onPlay = () => { viaOff++; };
  const unsub = run.on("play", () => { viaUnsub++; });
  run.on("play", onPlay);

  const fresh = g.run({});   // carried onto the new transport…
  unsub();                   // …and dropped from it, not from the destroyed one
  fresh.off("play", onPlay);
  await settle(fresh.play({ until: "a" }), g);
  assert.equal(viaUnsub, 0, "the unsubscriber on() handed back works after a recompile too");
  assert.equal(viaOff, 0, "and so does off() on the fresh handle");

  const again = g.run({});   // nothing resurrects on the NEXT recompile either
  await settle(again.play({ until: "a" }), g);
  assert.equal(viaUnsub + viaOff, 0);
  g.destroy();
});

test("F6: a storyboard `run` step recompiles without dropping the page's listeners either", async () => {
  const { g } = mountG({ storyboard: [{ op: "run", args: [{ hopMs: 50 }] }, { op: "run.play", until: "a" }] });
  const seen = [];
  g.run({}).on("finish", (e) => seen.push(e.nodeId));
  await settle(g.storyboard().play(), g);
  assert.deepEqual(seen, ["a"], "the run the step compiled still carries the subscription");
  g.destroy();
});

test("F6: run events mirror onto the instance bus as `run:<type>`, which outlives every recompile", async () => {
  const { g } = mountG();
  const seen = [];
  g.on("run:play", () => seen.push("play"));
  g.on("run:finish", (e) => seen.push("finish:" + e.nodeId));
  g.run({ hopMs: 50 });
  g.run({ hopMs: 60 });                       // two recompiles, one subscription
  await settle(g.run().play({ until: "a" }), g);
  assert.deepEqual(seen, ["play", "finish:a"]);
  g.destroy();
});

test("F6: a backward storyboard seek still re-seats the same transport (the restore path)", async () => {
  const { g } = mountG({ storyboard: [{ label: "start" }, { op: "run.play", until: "a" }] });
  const run = g.run({ hopMs: 50 });
  let seeks = 0;
  run.on("seek", () => seeks++);
  await settle(g.storyboard().play(), g);
  await settle(g.storyboard().seek("start"), g);
  assert.equal(g.run(), run, "identity held across the restore");
  assert.ok(seeks > 0, "and the listener saw the restore's own seek");
  g.destroy();
});

// ---------------------------------------------------------------------------
// F36 — autoplay: 'auto' and g.finished / g.finish()
// ---------------------------------------------------------------------------

test("F36: autoplay 'auto' plays only when the page URL says ?auto=1", async () => {
  doc.defaultView.location.search = "";
  const quiet = mountG({ storyboard: [{ op: "expandAll" }], autoplay: "auto" });
  await pump(quiet.g, 6);
  assert.equal(quiet.g.storyboard().position().index, 0, "no ?auto=1: the story waits");
  quiet.g.destroy();

  doc.defaultView.location.search = "?theme=dark&auto=1";
  const loud = mountG({ storyboard: [{ op: "expandAll" }], autoplay: "auto" });
  await settle(loud.g.finished, loud.g);
  assert.equal(loud.g.storyboard().position().done, true, "?auto=1: the story ran itself");
  loud.g.destroy();

  doc.defaultView.location.search = "";
  const forced = mountG({ storyboard: [{ op: "expandAll" }], autoplay: true });
  await settle(forced.g.finished, forced.g);
  assert.equal(forced.g.storyboard().position().done, true, "autoplay:true still always plays");
  forced.g.destroy();
});

test("F36: g.finished resolves {reason:'storyboard'} when the script runs out of steps", async () => {
  const { g } = mountG({ storyboard: [{ label: "one" }, { op: "expandAll" }] });
  let settled = null;
  g.finished.then((r) => { settled = r; });
  await pump(g, 4);
  assert.equal(settled, null, "nothing has played yet");

  const out = await settle(g.storyboard().play().then(() => g.finished), g);
  assert.deepEqual(out, { reason: "storyboard" });
  assert.equal(g.finished, g.finished, "one promise per instance, not a fresh one per read");
  g.destroy();
});

test("F36: g.finish() is the explicit end for a live-mode / hand-driven page", async () => {
  const { g } = mountG();
  const events = [];
  g.on("finish", (e) => events.push(e.reason));
  const run = g.run({ mode: "live" });
  run.start("a");
  run.finish("a");
  assert.equal(g.finish("live-done"), g, "chainable like every other director method");
  g.finish("again");
  assert.deepEqual(await g.finished, { reason: "live-done" }, "the first call wins");
  assert.deepEqual(events, ["live-done"], "…and it announces itself exactly once");
  g.destroy();
});

test("F36: destroy() settles g.finished, so awaiting it can never hang", async () => {
  const { g } = mountG({ storyboard: [{ op: "expandAll" }] });
  g.destroy();
  assert.deepEqual(await g.finished, { reason: "destroy" });
});
