// M4 integration: the director surface through mount() — g.camera/highlight/caption/cues,
// per-step pacing (D12), camera ownership in the G2 snapshot (D13), forward-scrub
// narrowing, and the record-mode plumbing (D15). Same hand-rolled DOM shim as
// test/integration.test.js, but every mount here uses opts.ticker:"manual" so the one
// shared clock (D1) is stepped by hand — no rAF pump at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONDENSE_PHASES } from "../src/condense-anim.js";

// ---------------------------------------------------------------------------
// DOM shim (integration.test.js's makeEl, verbatim) + a controllable matchMedia.
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

// prefersReducedMotion() reads this at mount time; tests flip it around a single mount.
let reduceFlag = false;
globalThis.window = { matchMedia: () => ({ matches: reduceFlag }) };

const flush = () => new Promise((r) => setTimeout(r, 0));
const fire = (el, type, ev = {}) => { for (const fn of el.listeners[type] || []) fn(ev); };

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));

const { mount } = await import("../src/index.js");

/** Drive the manual clock until `promise` settles (the D1 idiom for opts.ticker:"manual"). */
async function settle(promise, g, maxTicks = 800, ms = 16) {
  let out, done = false;
  Promise.resolve(promise).then((v) => { out = v; done = true; });
  for (let i = 0; i < maxTicks && !done; i++) { g.ticker.tick(ms); await flush(); }
  assert.ok(done, `settled within ${maxTicks} ticks`);
  return out;
}

async function tickUntil(fn, g, maxTicks = 200, ms = 16) {
  for (let i = 0; i < maxTicks; i++) {
    if (fn()) return true;
    g.ticker.tick(ms);
    await flush();
  }
  return !!fn();
}

const spec = () => ({
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "c" }],
});

function mountM4(opts = {}) {
  const root = makeEl("div");
  root.ownerDocument = doc;
  const g = mount(root, spec(), { ticker: "manual", layout: { dir: "LR" }, animation: { duration: 120 }, ...opts });
  return { root, g };
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);

// ---------------------------------------------------------------------------

test("g.camera() returns an Awaitable, flies on the shared clock, and takes the camera", async () => {
  const { g } = mountM4();
  const from = g.viewport.transform;
  assert.equal(g.viewport.userMoved, false, "nothing has moved the camera yet");

  const h = g.camera({ x: 120, y: -40, k: 1.25, dur: 500, ease: "linear" });
  assert.equal(typeof h.then, "function", "awaitable");
  assert.equal(typeof h.cancel, "function", "…and cancelable (§5.3 handle shape)");
  assert.equal(g.viewport.userMoved, true, "the first camera op claims the auto-refit suppression signal");

  g.ticker.tick(250);
  await flush();
  close(g.viewport.transform.x, (from.x + 120) / 2, "linear halfway x — the ease string was honoured");
  close(g.viewport.transform.k, (from.k + 1.25) / 2, "linear halfway k");

  g.ticker.tick(250);
  await flush();
  assert.deepEqual(await h, { canceled: false });
  assert.deepEqual(g.viewport.transform, { x: 120, y: -40, k: 1.25 });
  g.destroy();
});

test("D9: a second camera call cancels the first, and relative moves compose onto viewport.target", async () => {
  const { g } = mountM4();
  const h1 = g.camera({ x: 100, y: 0, k: 1, dur: 1000 });
  g.ticker.tick(100);
  await flush();
  assert.notEqual(g.viewport.transform.x, 100, "first move is genuinely mid-flight");

  // by:{dx} resolves against the TARGET transform (x=100), never the mid-tween sample.
  const h2 = g.camera({ by: { dx: 50, dy: 0 }, dur: 0 });
  assert.deepEqual(await settle(h1, g, 5), { canceled: true }, "the retargeted move answered");
  assert.deepEqual(await settle(h2, g, 5), { canceled: false });
  close(g.viewport.transform.x, 150, "target-composed pan");
  close(g.viewport.transform.k, 1, "k carried from the target");
  g.destroy();
});

test("G9: reduced motion collapses a camera move to 1ms without skipping it", async () => {
  reduceFlag = true;
  const { g } = mountM4(); // no motion override -> reduced=true
  reduceFlag = false;
  const h = g.camera({ x: 50, y: 5, k: 1, dur: 600 });
  g.ticker.tick(2);
  await flush();
  assert.deepEqual(await h, { canceled: false }, "a 600ms move settles in one 2ms tick under reduced motion");
  assert.deepEqual(g.viewport.transform, { x: 50, y: 5, k: 1 });
  g.destroy();
});

test("D15 record mode: manual ticker installed, data-smv-record on the root, motion:'full' beats the environment", async () => {
  reduceFlag = true; // the environment asks for reduced…
  const { root, g } = mountM4({ motion: "full" });
  reduceFlag = false;
  assert.equal(root.getAttribute("data-smv-record"), "", "opts.ticker:'manual' marks the root for the CSS kill-switch");

  const durations = [];
  g.on("commit", (e) => durations.push(e.duration));
  const h = g.addNode({ id: "z" });
  assert.deepEqual(durations, [120], "…but motion:'full' keeps the full declared duration");

  let done = false;
  Promise.resolve(h).then(() => { done = true; });
  await flush(); await flush(); await flush();
  assert.equal(done, false, "nothing settles until the manual clock is stepped");
  await settle(h, g);
  assert.equal(done, true);

  g.destroy();
  assert.equal(root.getAttribute("data-smv-record"), null, "destroy() removes the record marker");
});

test("storyboard plays camera/highlight/caption ops, and a backward seek restores the pre-step viewport exactly (D13)", async () => {
  const steps = [
    { label: "start" },
    { op: "camera", args: [{ node: "b", k: 2, dur: 200 }] },
    { op: "highlight", args: [{ nodes: ["b"], variant: "warn", dim: true }] },
    { op: "caption", args: ["watch b", { place: "top" }] },
  ];
  const { root, g } = mountM4({ storyboard: steps });
  const sb = g.storyboard();
  const t0 = g.viewport.transform; // post-mount fit — what the step-0 snapshot must hold

  await settle(sb.play(), g);

  // Camera: node b framed at the explicit k=2 (past FIT_MAX_K), centred in the 900×480 pane.
  const b = g.layoutResult().nodes.b;
  close(g.viewport.transform.k, 2, "explicit node k");
  close(g.viewport.transform.x, 450 - b.x * 2, "b centred x");
  close(g.viewport.transform.y, 240 - b.y * 2, "b centred y");
  assert.equal(g.viewport.userMoved, true);

  // Highlight: the selection carries data-emph, everything else data-dim.
  assert.equal(g.renderer.node("b").getAttribute("data-emph"), "warn");
  assert.equal(g.renderer.node("b").getAttribute("data-dim"), null, "the subject is never dimmed");
  for (const id of ["a", "c"]) assert.equal(g.renderer.node(id).getAttribute("data-dim"), "", `${id} dimmed`);
  for (const id of ["e1", "e2"]) assert.equal(g.renderer.edge(id).getAttribute("data-dim"), "", `${id} dimmed`);

  // Caption overlay.
  const cap = byClass(root, "smv-caption")[0];
  assert.ok(cap, "caption overlay mounted");
  assert.equal(cap.textContent, "watch b");
  assert.equal(cap.attrs.role, "status");
  assert.equal(cap.attrs["data-place"], "top");

  // Backward seek: the script owns the camera (D13), so the snapshot restores it exactly.
  await settle(sb.seek("start"), g);
  g.ticker.tick(16); await flush();
  close(g.viewport.transform.x, t0.x, "restored x");
  close(g.viewport.transform.y, t0.y, "restored y");
  close(g.viewport.transform.k, t0.k, "restored k");
  assert.equal(g.viewport.userMoved, false, "seeking before the first camera op hands the camera back");
  for (const id of ["a", "b", "c"]) {
    assert.equal(g.renderer.node(id).getAttribute("data-emph"), null, `${id} emphasis restored away`);
    assert.equal(g.renderer.node(id).getAttribute("data-dim"), null, `${id} dim restored away`);
  }
  assert.equal(byClass(root, "smv-caption").length, 0, "caption restored away");
  g.destroy();
});

test("a storyboard with NO camera op never snapshots the viewport: a seek leaves the reader's camera alone", async () => {
  const steps = [{ label: "s" }, { op: "addNode", args: [{ id: "n1" }] }];
  const { g } = mountM4({ storyboard: steps });
  await settle(g.storyboard().play(), g);

  // The reader composes their own shot between steps…
  g.viewport.moveTo({ x: 33, y: 44, k: 2.5 }, { duration: 0 });
  g.viewport.userMoved = true;

  await settle(g.storyboard().seek("s"), g);
  g.ticker.tick(16); await flush();
  close(g.viewport.transform.k, 2.5, "…and the backward seek does not yank it");
  assert.equal(g.viewport.userMoved, true);
  g.destroy();
});

test("forward scrub replays director ops instantly but mutation ops keep their real duration", async () => {
  const steps = [
    { label: "go" },
    { op: "camera", args: [{ x: 250, y: 0, k: 2, dur: 8000 }] },
    { op: "addNode", args: [{ id: "z" }] },
    { op: "wait", ms: 100 },
  ];
  const { root, g } = mountM4({ storyboard: steps, controls: true });
  const durations = [];
  g.on("commit", (e) => durations.push(e.duration));

  // Scrub the transport to the end of the story. The 8000ms camera would need 500 ticks
  // at full length — the budget below only fits it replayed at zero (the instant flag).
  const scrub = byClass(root, "smv-transport-scrub")[0];
  fire(scrub, "pointerdown", {});
  scrub.value = "1000";
  fire(scrub, "input", {});
  const ok = await tickUntil(() => g.storyboard().position().index === 3, g, 150);
  fire(scrub, "change", {});
  assert.ok(ok, "the scrub landed within a budget far smaller than the camera's declared 8000ms");

  close(g.viewport.transform.k, 2, "the camera op still landed on its target, just instantly");
  assert.deepEqual(durations, [120], "the replayed addNode kept its real duration — mutations are NOT narrowed in M4a");
  assert.ok(g.node("z"), "the mutation landed");
  g.destroy();
});

test("overlapping drag scrubs keep replaying instantly — the scrub flag is a depth, not a boolean", async () => {
  const steps = [
    { label: "go" },
    { op: "wait", ms: 300 },                                    // suspends scrub #1 mid-replay
    { op: "camera", args: [{ x: 250, y: 0, k: 2, dur: 8000 }] },
    { op: "camera", args: [{ x: -100, y: 10, k: 1.5, dur: 8000 }] },
    { op: "wait", ms: 100 },
  ];
  const { root, g } = mountM4({ storyboard: steps, controls: true });
  const scrub = byClass(root, "smv-transport-scrub")[0];
  fire(scrub, "pointerdown", {});
  scrub.value = "1000";
  fire(scrub, "input", {});          // seek #1 — suspends inside the 300ms wait
  g.ticker.tick(16); await flush();
  // Another `input` of the same drag. It voids #1, whose replay then settles canceled —
  // and a shared boolean would go down right there, under #2's still-running replay.
  fire(scrub, "input", {});
  const ok = await tickUntil(() => g.storyboard().position().index === 4, g, 150);
  fire(scrub, "change", {});
  assert.ok(ok, "both 8000ms cameras still replayed at zero for the newer scrub");
  close(g.viewport.transform.k, 1.5, "…and the last one landed on its target");
  g.destroy();
});

test("D12: a camera step declaring dur twice plays the length durOf() measures (step.dur wins)", async () => {
  const steps = [
    { op: "camera", args: [{ x: 40, y: 0, k: 1, dur: 300 }], dur: 900 },
    { label: "after" },
  ];
  const { g } = mountM4({ storyboard: steps });
  assert.equal(g.timeline().total, 900, "the slice is the step's own dur");
  assert.deepEqual(g.cues(), [{ kind: "label", at: 900, label: "after", index: 1 }]);

  let done = false;
  const p = Promise.resolve(g.storyboard().next()).then(() => { done = true; });
  g.ticker.tick(300); await flush(); await flush();
  assert.equal(done, false, "the tween did not stop at the args' 300ms — the cue sheet says 900");
  g.ticker.tick(600); await flush();
  await p;
  assert.deepEqual(g.viewport.transform, { x: 40, y: 0, k: 1 });
  g.destroy();
});

test("g.highlight is replace-not-accumulate through the public surface, and clearHighlight wipes it", async () => {
  const { g } = mountM4();
  g.highlight({ nodes: ["a"] });
  assert.equal(g.renderer.node("a").getAttribute("data-emph"), "focus", "default variant");

  g.highlight({ nodes: ["b"], variant: "ok" });
  assert.equal(g.renderer.node("a").getAttribute("data-emph"), null, "the previous highlight was replaced");
  assert.equal(g.renderer.node("b").getAttribute("data-emph"), "ok");

  g.highlight({ nodes: ["b"], dim: true });
  assert.equal(g.renderer.node("a").getAttribute("data-dim"), "", "spotlight dims the rest");
  g.clearHighlight();
  for (const id of ["a", "b", "c"]) {
    assert.equal(g.renderer.node(id).getAttribute("data-emph"), null);
    assert.equal(g.renderer.node(id).getAttribute("data-dim"), null);
  }
  g.destroy();
});

test("emphasis is re-asserted onto the FRESH <g> of a removed-and-re-added node (commit hook)", async () => {
  const { g } = mountM4();
  g.highlight({ nodes: ["b"], variant: "warn" });
  const oldEl = g.renderer.node("b");
  assert.equal(oldEl.getAttribute("data-emph"), "warn");

  await settle(g.removeNode("b"), g);
  g.ticker.tick(400); await flush(); // let the exit animation sweep the element
  assert.equal(g.renderer.node("b"), undefined, "the element is gone");

  await settle(g.addNode({ id: "b" }), g);
  g.ticker.tick(16); await flush();
  const fresh = g.renderer.node("b");
  assert.ok(fresh, "a fresh element was built");
  assert.notEqual(fresh, oldEl, "…and it IS fresh, not the old one revived");
  assert.equal(fresh.getAttribute("data-emph"), "warn", "the commit hook re-wrote the emphasis");
  g.destroy();
});

test("g.caption() sets, updates and clears the overlay", () => {
  const { root, g } = mountM4();
  g.caption("hello", { variant: "note" });
  const cap = byClass(root, "smv-caption")[0];
  assert.ok(cap);
  assert.equal(cap.textContent, "hello");
  assert.equal(cap.attrs["data-variant"], "note");

  g.caption("changed");
  assert.equal(byClass(root, "smv-caption")[0], cap, "same element, updated in place");
  assert.equal(cap.textContent, "changed");
  assert.equal(cap.attrs["data-variant"], undefined);

  g.caption(null);
  assert.equal(byClass(root, "smv-caption").length, 0);
  g.destroy();
});

test("opts.captions:false suppresses the overlay while g.cues() still records the caption", async () => {
  const { root, g } = mountM4({ captions: false, storyboard: [{ op: "caption", args: ["quiet"] }] });
  await settle(g.storyboard().play(), g);
  assert.equal(byClass(root, "smv-caption").length, 0, "no overlay in a suppressed mount");
  assert.deepEqual(g.cues(), [{ kind: "caption", at: 0, text: "quiet", index: 0 }], "the cue sheet stays truthful");
  g.destroy();
});

test("D12: g.cues() offsets and timeline().total come from the truthful durOf table", () => {
  const CHOREO = CONDENSE_PHASES.highlight + CONDENSE_PHASES.converge + CONDENSE_PHASES.reveal;
  assert.equal(CHOREO, 900, "what condense actually costs — not the old 400ms guess");
  const steps = [
    { label: "start" },                                //   0ms, at 0
    { op: "addNode", args: [{ id: "n1" }] },           // 120ms (baseDuration)
    { op: "wait", ms: 250 },                           // 250ms
    { op: "caption", args: ["mid"] },                  //   0ms, at 370
    { op: "camera", args: [{ zoom: 2, dur: 800 }] },   // 800ms (its own dur)
    { op: "camera", args: [{ fit: true }] },           // 600ms (camera default)
    { op: "condense", args: [["a", "b"], { id: "ab" }] }, // 900ms
    { op: "wait", ms: 50, dur: 75 },                   //  75ms (step.dur overrides)
  ];
  const { g } = mountM4({ storyboard: steps }); // measured, never played
  assert.deepEqual(g.cues(), [
    { kind: "label", at: 0, label: "start", index: 0 },
    { kind: "caption", at: 370, text: "mid", index: 3 },
  ]);
  assert.equal(g.timeline().total, 120 + 250 + 800 + 600 + CHOREO + 75);
  g.destroy();
});

test("D12: step.dur is ambient for the whole op — a 900ms addNode, then back to base; a batch's dur survives its children", async () => {
  const steps = [
    { op: "addNode", args: [{ id: "p" }], dur: 900 },
    { op: "addNode", args: [{ id: "q" }] },
    { op: "batch", dur: 500, steps: [{ op: "addNode", args: [{ id: "r" }] }, { op: "addNode", args: [{ id: "s" }] }] },
  ];
  const { g } = mountM4({ storyboard: steps });
  const durations = [];
  g.on("commit", (e) => durations.push(e.duration));
  await settle(g.storyboard().play(), g);
  assert.deepEqual(durations, [900, 120, 500], "declared pacing, base default, batch dur over its children");

  g.addNode({ id: "t" });
  assert.equal(durations.at(-1), 120, "the ambient dur never leaks past its step");
  g.destroy();
});
