// M1 integration: mount() + run transport + token layer + storyboard + transport bar,
// driven through a hand-rolled minimal DOM (no jsdom in this repo) and a manually pumped
// rAF, so the single clock (D1) is fully deterministic here.

import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// DOM shim + manual rAF pump (the technique M0's mount smoke test established).
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
async function settle(promise, maxFrames = 4000) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  const ok = await pumpUntil(() => done, maxFrames);
  assert.ok(ok, "awaited work settled within the frame budget");
  return out;
}

const fire = (el, type, ev = {}) => { for (const fn of el.listeners[type] || []) fn(ev); };

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));

const { mount } = await import("../src/index.js");

// ---------------------------------------------------------------------------
// The §6 pipeline: a collapsed container of 3 substeps, a 3-way fan-out into an
// all-join, and a bounded retry loop.
// ---------------------------------------------------------------------------

const SUBSTEPS = ["clean.dedupe", "clean.validate", "clean.normalize"];
const MERGED = { id: "clean.auto", label: "Automated cleaning", data: { duration: "8s", mode: "automated" } };

function pipelineSpec() {
  return {
    nodes: [
      { id: "ingest", label: "Ingest", data: { duration: "30s" } },
      { id: "clean", label: "Clean data", collapsed: true },
      { id: "clean.dedupe", label: "Dedupe", parent: "clean", data: { duration: "30m" } },
      { id: "clean.validate", label: "Validate", parent: "clean", data: { duration: "1h" } },
      { id: "clean.normalize", label: "Normalize", parent: "clean", data: { duration: "30m" } },
      { id: "lint", label: "Lint", data: { duration: "8s" } },
      { id: "unit", label: "Unit", data: { duration: "40s" } },
      { id: "e2e", label: "E2E", data: { duration: "3m" } },
      { id: "gate", label: "Gate", join: "all" },
      { id: "deploy", label: "Deploy", data: { duration: "20s" } },
      { id: "verify", label: "Verify" },
    ],
    edges: [
      { id: "e1", source: "ingest", target: "clean.dedupe" },
      { id: "e2", source: "clean.dedupe", target: "clean.validate" },
      { id: "e3", source: "clean.validate", target: "clean.normalize" },
      { id: "f1", source: "clean.normalize", target: "lint" },
      { id: "f2", source: "clean.normalize", target: "unit" },
      { id: "f3", source: "clean.normalize", target: "e2e" },
      { id: "j1", source: "lint", target: "gate" },
      { id: "j2", source: "unit", target: "gate" },
      { id: "j3", source: "e2e", target: "gate" },
      { id: "d1", source: "gate", target: "deploy" },
      { id: "d2", source: "deploy", target: "verify" },
      { id: "retry", source: "verify", target: "deploy", loop: true, maxIterations: 5 },
    ],
  };
}

function mountPipeline(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, pipelineSpec(), { layout: { dir: "LR" }, animation: { duration: 120 }, ...opts });
  return { root, g };
}

const RANK = { pending: 0, active: 1, done: 2 };

// ---------------------------------------------------------------------------

test("g.run() plays to completion on the shared ticker and state only moves forward", async () => {
  const { root, g } = mountPipeline();
  const run = g.run({});
  assert.ok(run.duration > 0, "the compiled schedule has a duration");

  const events = [];
  run.on("join", (e) => events.push(e.type));
  run.on("loop", (e) => events.push(e.type));
  run.on("done", (e) => events.push(e.type));

  let ticks = 0;
  run.on("tick", () => ticks++);

  const prevRank = new Map();
  const prevProgress = new Map();
  let prevTime = -1;
  const check = () => {
    const st = run.state();
    assert.ok(run.time() >= prevTime, "virtual time never goes backwards");
    prevTime = run.time();
    for (const [id, n] of Object.entries(st.nodes)) {
      assert.ok(RANK[n.status] >= (prevRank.get(id) ?? 0), `${id} status regressed to ${n.status}`);
      assert.ok(n.progress >= (prevProgress.get(id) ?? 0) - 1e-9, `${id} progress regressed`);
      prevRank.set(id, RANK[n.status]);
      prevProgress.set(id, n.progress);
    }
  };

  let settled = null;
  run.play().then((r) => { settled = r; });
  await pumpUntil(() => { check(); return settled !== null; });

  assert.deepEqual(settled, { canceled: false }, "play() resolves when the schedule runs out");
  assert.equal(run.playing, false);
  assert.ok(ticks > 5, "the run emitted a 'tick' per frame while playing");
  assert.ok(events.includes("join"), "the all-join fired");
  assert.ok(events.includes("loop"), "the bounded retry loop ticked");
  assert.ok(events.includes("done"), "the engine's terminal event was re-emitted");

  const final = run.state();
  assert.equal(final.nodes.gate.status, "done");
  assert.equal(final.loops.retry.iteration, 5, "the loop badge reached its cap");
  assert.equal(final.done, true);

  // One token layer, and nothing NaN made it into the DOM.
  const layers = byClass(root, "smv-tokens");
  assert.equal(layers.length, 1, "exactly one g.smv-tokens layer");
  const bad = findAll(root, (n) => Object.values(n.attrs).some((v) => /NaN/.test(v)));
  assert.deepEqual(bad.map((n) => n.attrs.class), [], "no NaN attributes anywhere");

  g.destroy();
  assert.equal(byClass(root, "smv-tokens").length, 0, "destroy() takes the token layer with it");
});

test("token decorations are sampled from stateAt: pulses, fill, badges, traversal", async () => {
  const { root, g } = mountPipeline();
  const run = g.run({});
  run.play();
  // Far enough in that the fan-out has three live branches on three different edges.
  await pumpUntil(() => run.state().tokens.filter((t) => t.at.kind === "edge").length >= 2, 400);

  const st = run.state();
  assert.ok(st.tokens.length >= 2, "several tokens are live at once");
  const dots = byClass(root, "smv-token").filter((n) => !(n.attrs.class || "").includes("smv-ghost"));
  assert.equal(dots.length, st.tokens.length, "one pulse circle per live token");
  for (const d of dots) {
    assert.ok(Number.isFinite(Number(d.attrs.cx)) && Number.isFinite(Number(d.attrs.cy)), "pulse has real coordinates");
  }

  // Node progress fill: one rect per active node, width = progress of its inner box.
  await pumpUntil(() => Object.values(run.state().nodes).some((n) => n.status === "active" && n.progress > 0.1), 400);
  const active = Object.entries(run.state().nodes).filter(([, n]) => n.status === "active" && n.progress > 0);
  const fillEls = byClass(root, "smv-node-fill");
  assert.equal(fillEls.length, active.length, "one progress fill per active node");
  for (const el of fillEls) assert.ok(Number(el.attrs.width) > 0, "the fill has a real width");

  await pumpUntil(() => Object.values(run.state().edges).some((e) => e.traversed > 0), 400);
  const traversedIds = Object.entries(run.state().edges).filter(([, e]) => e.traversed > 0).map(([id]) => id);
  const marked = findAll(root, (n) => n.attrs["data-traversed"] !== undefined);
  assert.ok(marked.length > 0, "traversed edges carry data-traversed");
  for (const el of marked) {
    const v = Number(el.style._p["--smv-traversed"]);
    assert.ok(v > 0 && v <= 1, `--smv-traversed is a 0..1 number (got ${el.style._p["--smv-traversed"]})`);
  }
  assert.ok(traversedIds.length >= marked.length - 1, "traversal is mirrored from the engine, not invented");

  // The join node advertises its slots as pips while it waits (k of n).
  await pumpUntil(() => run.state().joins.gate.arrived > 0, 900);
  const pips = byClass(root, "smv-join-pip");
  assert.equal(pips.length, run.state().joins.gate.needed, "one pip per expected in-edge");
  assert.equal(
    pips.filter((p) => p.attrs["data-filled"] !== undefined).length,
    run.state().joins.gate.arrived,
    "filled pips track arrivals",
  );

  // Occupancy: while the join holds two branches, the node wears a ×n badge.
  const sawOccupancy = await pumpUntil(() => run.state().nodes.gate.occupancy > 1, 900);
  if (sawOccupancy) {
    const badge = byClass(root, "smv-token-badge").find((b) => b.textContent.startsWith("×"));
    assert.ok(badge, "an occupancy badge is drawn");
    assert.equal(badge.textContent, `×${run.state().nodes.gate.occupancy}`);
  }

  // Loop badge on the arc itself, while the arc is visible.
  await pumpUntil(() => run.state().loops.retry.iteration > 0, 2000);
  const loopBadge = byClass(root, "smv-loop-badge")[0];
  assert.ok(loopBadge, "the loop arc carries an iteration badge");
  assert.match(loopBadge.textContent, /^iter [1-5]\/5$/);

  g.destroy();
});

test("a loop swallowed by a collapsed container badges the container (D3/D5 loopBadges)", async () => {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, {
    nodes: [
      { id: "start", data: { duration: "5s" } },
      { id: "box", label: "Box", collapsed: true },
      { id: "box.a", parent: "box", data: { duration: "5s" } },
      { id: "box.b", parent: "box", data: { duration: "5s" } },
    ],
    edges: [
      { id: "s2a", source: "start", target: "box.a" },
      { id: "a2b", source: "box.a", target: "box.b" },
      { id: "back", source: "box.b", target: "box.a", loop: true, maxIterations: 3 },
    ],
  }, { layout: { dir: "LR" }, animation: { duration: 60 } });

  assert.equal(g.viewstate.collapsed.has("box"), true, "the container starts collapsed");
  const run = g.run({});
  run.play();
  await pumpUntil(() => run.state().loops.back.iteration >= 2, 2000);

  const badge = byClass(root, "smv-loop-badge").find((b) => /^iter \d+\/3$/.test(b.textContent));
  assert.ok(badge, "the collapsed container carries the swallowed loop's badge");
  // It is drawn on the container, not on an edge that no longer exists.
  const box = findAll(root, (n) => n.attrs["data-id"] === "box")[0];
  assert.ok(box, "the container node is on screen");
  assert.ok(Math.abs(Number(badge.attrs.x) - g.layoutResult().nodes.box.x) < 40, "…positioned over it");

  g.destroy();
});

test("speed() recompiles around the current time; step() lands on event boundaries", async () => {
  const { g } = mountPipeline();
  const run = g.run({});
  run.seek(500);
  const before = run.state();

  run.speed(2);
  const after = run.state();
  assert.equal(run.time(), 500, "speed() preserves the current virtual time");
  assert.deepEqual(
    Object.fromEntries(Object.entries(after.nodes).map(([id, n]) => [id, n.status])),
    Object.fromEntries(Object.entries(before.nodes).map(([id, n]) => [id, n.status])),
    "the past is untouched — a rate only folds in at the next node entry",
  );

  const t0 = run.time();
  const t1 = run.step();
  assert.ok(t1 > t0, "step() advances");
  const boundaries = run.sim().boundaries;
  assert.ok(boundaries.includes(t1) || t1 === run.duration, "step() lands on an event boundary");

  const branch = run.state().tokens[0];
  if (branch) {
    const t2 = run.step({ token: branch.id });
    assert.ok(t2 >= t1, "step({token}) walks that branch's own boundary list");
  }

  run.speed(0.5, { branch: "e2e" });
  assert.ok(run.duration > 0);
  g.destroy();
});

test("storyboard: snapshot/restore round-trips a condense through a backward and forward seek", async () => {
  const steps = [
    { label: "start" },
    { op: "run.play", until: "clean.dedupe" },
    { label: "expand" },
    { op: "expand", args: ["clean"] },
    { label: "automate" },
    { op: "condense", args: [SUBSTEPS, MERGED] },
    { op: "run.play" },
  ];
  const { g } = mountPipeline({ storyboard: steps });
  const sb = g.storyboard();
  assert.ok(sb, "opts.storyboard builds the sequencer");
  assert.deepEqual(sb.labels().map((l) => l.label), ["start", "expand", "automate"]);

  const ids = () => new Set(g.spec().nodes.map((n) => n.id));

  // Walk the whole story forward, pumping the shared clock as each step animates.
  await settle(sb.play(), 6000);

  assert.ok(ids().has("clean.auto"), "condense landed the merged node");
  for (const s of SUBSTEPS) assert.equal(ids().has(s), false, `${s} was merged away`);

  // Backward seek to the label BEFORE the condense step restores its pre-step snapshot.
  await settle(sb.seek("automate"));
  await pump(20);
  for (const s of SUBSTEPS) assert.ok(ids().has(s), `${s} is back after seeking to "automate"`);
  assert.equal(ids().has("clean.auto"), false);
  assert.equal(g.viewstate.collapsed.has("clean"), false, "…and it is still expanded there");

  // Further back: before the expand step, the container is collapsed again.
  await settle(sb.seek("expand"));
  await pump(20);
  assert.equal(g.viewstate.collapsed.has("clean"), true, "collapsed set round-trips through the snapshot");

  // Forward again over ground already covered: the condensed state comes back intact.
  await settle(sb.seek(6));
  await pump(20);
  assert.ok(ids().has("clean.auto"), "forward seek re-lands the condensed graph");
  for (const s of SUBSTEPS) assert.equal(ids().has(s), false);

  g.destroy();
});

test("expand then condense mid-run does not throw and tokens remap onto the merged node", async () => {
  const { root, g } = mountPipeline();
  const run = g.run({});
  run.play();
  // Let a token get into the container's chain before the graph morphs under it (D4).
  await pumpUntil(() => SUBSTEPS.some((id) => run.state().nodes[id].status === "active"), 600);

  await settle(g.expand("clean"));
  await pump(12);

  const remaps = [];
  run.on("remap", (e) => remaps.push(e));
  const progressBefore = Math.max(...SUBSTEPS.map((id) => run.state().nodes[id].progress));

  let err = null;
  const condensed = g.condense(SUBSTEPS, MERGED).catch((e) => { err = e; return { canceled: true }; });
  await pumpUntil(() => remaps.length > 0, 200);
  // Ghosts live for ~320ms, so look while they are still on screen.
  const ghostsDrawn = byClass(root, "smv-ghost").length;
  let settled = null;
  condensed.then((r) => { settled = r; });
  await pumpUntil(() => settled !== null, 400);

  assert.equal(err, null, "condense mid-run did not throw");
  assert.equal(remaps.length, 1, "the transport recompiled and announced one remap");
  assert.equal(remaps[0].target, "clean.auto");
  assert.ok(remaps[0].progress >= progressBefore - 1e-9, "the merged node carries max(progress)");
  assert.ok(Array.isArray(remaps[0].ghosts), "tokens on removed nodes are handed over to ghost-fade");
  if (remaps[0].ghosts.length) {
    assert.equal(ghostsDrawn, remaps[0].ghosts.length, "…and they are drawn fading, one per stranded token");
  }
  assert.equal(byClass(root, "smv-ghost").length, 0, "the ghosts are swept once they have faded");

  const st = run.state();
  assert.ok(st.nodes["clean.auto"], "the recompiled schedule knows the merged node");
  for (const id of SUBSTEPS) assert.equal(st.nodes[id], undefined, "…and forgot the sources");

  // The morph did not leave broken geometry behind.
  const bad = findAll(root, (n) => Object.values(n.attrs).some((v) => /NaN/.test(v)));
  assert.deepEqual(bad.map((n) => n.attrs["data-id"] ?? n.attrs.class), []);

  run.pause();
  g.destroy();
});

test("opts.controls mounts the transport bar and its scrubber seeks the storyboard timeline", async () => {
  const steps = [
    { label: "start" },
    { op: "run.play", until: "clean.dedupe" },
    { label: "expand" },
    { op: "expand", args: ["clean"] },
  ];
  const { root, g } = mountPipeline({ controls: true, storyboard: steps });
  const bars = byClass(root, "smv-transport");
  assert.equal(bars.length, 1, "one .smv-transport bar");
  assert.equal(root.classList.contains("smv-has-transport"), true);
  const bar = bars[0];
  const scrub = byClass(bar, "smv-transport-scrub")[0];
  const speed = byClass(bar, "smv-transport-speed")[0];
  const label = byClass(bar, "smv-transport-label")[0];
  const playBtn = bar.children.find((c) => c.attrs["data-act"] === "play");
  assert.ok(scrub && speed && label && playBtn, "buttons, scrubber, speed select and readout");
  assert.equal(speed.children.map((o) => o.attrs.value).join(","), "0.5,1,2,4");

  const tl0 = g.timeline();
  assert.ok(tl0.total > 0 && tl0.steps === steps.length);
  assert.equal(tl0.label, "start", "the readout starts on the first label");

  // Play through the run step from the bar, then scrub back to the beginning.
  fire(playBtn, "click", { currentTarget: playBtn });
  await pumpUntil(() => g.timeline().index >= 2, 3000);
  assert.ok(g.timeline().time > 0, "the cumulative position advanced");

  fire(scrub, "pointerdown", {});
  scrub.value = "0";
  fire(scrub, "input", {});
  await pump(20);
  fire(scrub, "change", {});
  assert.equal(g.storyboard().position().index, 0, "scrubbing to 0 seeks back to the first step");
  assert.equal(g.run().time(), 0, "…and rewinds the run inside it");

  speed.value = "2";
  fire(speed, "change", {});
  assert.equal(label.textContent.length > 0, true, "the label readout is populated");

  g.destroy();
  assert.equal(byClass(root, "smv-transport").length, 0);
});

test("opts.preset:'pipeline' is wired in, and presetPipeline is on the default export", async () => {
  const mod = await import("../src/index.js");
  assert.equal(typeof mod.presetPipeline, "function");
  assert.equal(typeof mod.default.presetPipeline, "function", "the IIFE global exposes SparkleMotion.presetPipeline");

  const { root, g } = mountPipeline({ preset: "pipeline" });
  const chips = byClass(root, "smv-chip");
  assert.ok(chips.length > 0, "duration chips were adorned on the first commit");
  assert.equal(chips.some((c) => c.textContent === "30s"), true, "ingest's own duration");
  assert.equal(byClass(root, "smv-totalbar").length, 1, "the total-duration bar exists");
  g.destroy();
  assert.equal(byClass(root, "smv-totalbar").length, 0);
});

test("one deduped stylesheet however many instances mount (G8)", () => {
  const a = mountPipeline();
  const b = mountPipeline();
  assert.equal(head.children.filter((c) => c.tagName === "style" && c.attrs["data-smv-styles"] !== undefined).length, 1);
  a.g.destroy();
  b.g.destroy();
});
