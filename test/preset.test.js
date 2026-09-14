import { test } from "node:test";
import assert from "node:assert/strict";
import { emitter } from "../src/events.js";
import { pointAt } from "../src/path.js";
import { readFile } from "node:fs/promises";
import { createTicker } from "../src/anim.js";
import {
  formatDuration, aggregateDuration, effectiveDurationSec, deltaBadgeText,
  odometerValueAt, runOdometer, injectPresetStyles, applyPipelinePreset,
  criticalPathSec, PIPELINE_MEASURE, PIPELINE_EDGE_LABEL_MAX_W,
  PRESET_STYLE_MARKER, PRESET_CSS,
} from "../src/preset-pipeline.js";

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test("formatDuration: picks the largest clean unit", () => {
  assert.equal(formatDuration(7200), "2h");
  assert.equal(formatDuration(8), "8s");
  assert.equal(formatDuration(45 * 60), "45m");
  assert.equal(formatDuration(0.3), "300ms");
  assert.equal(formatDuration(0), "0s");
});

test("formatDuration: fractional units get one decimal, trimmed when whole", () => {
  assert.equal(formatDuration(90), "1.5m");
  assert.equal(formatDuration(3600 * 1.5), "1.5h");
  assert.equal(formatDuration(3600 * 2), "2h"); // not "2.0h"
});

test("formatDuration: accepts a raw duration string (parses then formats)", () => {
  assert.equal(formatDuration("2h"), "2h");
  assert.equal(formatDuration("120m"), "2h"); // renormalizes to the canonical short form
});

test("formatDuration: '' for missing/invalid", () => {
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration(NaN), "");
  assert.equal(formatDuration("nonsense"), "");
});

// ---------------------------------------------------------------------------
// aggregateDuration (G5 durationAgg)
// ---------------------------------------------------------------------------

test("aggregateDuration: sum is the default", () => {
  assert.equal(aggregateDuration([30, 60, 30]), 120);
});

test("aggregateDuration: max mode for parallel rollups", () => {
  assert.equal(aggregateDuration([8, 40, 180], "max"), 180);
});

test("aggregateDuration: ignores non-finite entries", () => {
  assert.equal(aggregateDuration([10, null, NaN, 20]), 30);
  assert.equal(aggregateDuration([10, null], "max"), 10);
});

test("aggregateDuration: null when nothing to roll up", () => {
  assert.equal(aggregateDuration([]), null);
  assert.equal(aggregateDuration([null, NaN]), null);
  assert.equal(aggregateDuration(undefined), null);
});

// ---------------------------------------------------------------------------
// effectiveDurationSec — the recursive rollup over a store.spec() snapshot
// ---------------------------------------------------------------------------

function byId(nodes) { return new Map(nodes.map((n) => [n.id, n])); }

test("effectiveDurationSec: a leaf reports its own duration", () => {
  const nodes = byId([{ id: "a", data: { duration: "45m" } }]);
  assert.equal(effectiveDurationSec(nodes, "a"), 45 * 60);
});

test("effectiveDurationSec: a container sums children by default (G5)", () => {
  const nodes = byId([
    { id: "clean" },
    { id: "clean.dedupe", parent: "clean", data: { duration: "30m" } },
    { id: "clean.validate", parent: "clean", data: { duration: "1h" } },
    { id: "clean.normalize", parent: "clean", data: { duration: "30m" } },
  ]);
  assert.equal(effectiveDurationSec(nodes, "clean"), 2 * 3600); // "2h" from the plan's own example
});

test("effectiveDurationSec: durationAgg:'max' rolls up the parallel max", () => {
  const nodes = byId([
    { id: "collect", durationAgg: "max" },
    { id: "lint", parent: "collect", data: { duration: "8s" } },
    { id: "unit", parent: "collect", data: { duration: "40s" } },
    { id: "e2e", parent: "collect", data: { duration: "3m" } },
  ]);
  assert.equal(effectiveDurationSec(nodes, "collect"), 180);
});

test("effectiveDurationSec: an explicit duration on a container wins over the rollup", () => {
  const nodes = byId([
    { id: "clean", data: { duration: "8s" } },
    { id: "clean.dedupe", parent: "clean", data: { duration: "30m" } },
  ]);
  assert.equal(effectiveDurationSec(nodes, "clean"), 8);
});

test("effectiveDurationSec: nests recursively through multiple container levels", () => {
  const nodes = byId([
    { id: "root" },
    { id: "a", parent: "root", data: { duration: "1m" } },
    { id: "grp", parent: "root" },
    { id: "grp.x", parent: "grp", data: { duration: "2m" } },
    { id: "grp.y", parent: "grp", data: { duration: "3m" } },
  ]);
  assert.equal(effectiveDurationSec(nodes, "root"), 6 * 60);
});

test("effectiveDurationSec: null for an unknown id or a childless, duration-less node", () => {
  const nodes = byId([{ id: "a" }]);
  assert.equal(effectiveDurationSec(nodes, "missing"), null);
  assert.equal(effectiveDurationSec(nodes, "a"), null);
});

// ---------------------------------------------------------------------------
// deltaBadgeText — the "-99.9% / N× faster" condense payoff
// ---------------------------------------------------------------------------

test("deltaBadgeText: 2h -> 8s reads as a huge percentage drop and a big multiplier", () => {
  const text = deltaBadgeText(7200, 8);
  assert.match(text, /^−99\.9% · 900× faster$/);
});

test("deltaBadgeText: a smaller drop rounds the multiplier to one decimal", () => {
  const text = deltaBadgeText(100, 40); // 2.5x faster, -60%
  assert.match(text, /^−60\.0% · 2\.5× faster$/);
});

test("deltaBadgeText: a regression reads as slower with a '+' sign", () => {
  const text = deltaBadgeText(10, 20);
  assert.match(text, /^\+100\.0% · 2× slower$/);
});

test("deltaBadgeText: '' when the source duration is missing or non-positive", () => {
  assert.equal(deltaBadgeText(null, 8), "");
  assert.equal(deltaBadgeText(0, 8), "");
  assert.equal(deltaBadgeText(NaN, 8), "");
});

// ---------------------------------------------------------------------------
// odometerValueAt / runOdometer
// ---------------------------------------------------------------------------

test("odometerValueAt: endpoints are exact, interior values fall strictly between", () => {
  assert.equal(odometerValueAt(7200, 8, 0), 7200);
  assert.equal(odometerValueAt(7200, 8, 1), 8);
  const mid = odometerValueAt(7200, 8, 0.5);
  assert.ok(mid > 8 && mid < 7200);
});

test("odometerValueAt: log-lerp — value at t=0.5 is the geometric mean (reads faster than linear)", () => {
  const mid = odometerValueAt(100, 4, 0.5);
  assert.ok(Math.abs(mid - 20) < 1e-9); // sqrt(100*4) = 20
});

test("odometerValueAt: degenerate fromSec falls back to toSec immediately", () => {
  assert.equal(odometerValueAt(0, 8, 0.5), 8);
  assert.equal(odometerValueAt(null, 8, 0.5), 8);
});

test("runOdometer: rolls the text over the shared ticker and lands exactly on the target", () => {
  const ticker = createTicker({ manual: true });
  const el = { textContent: "" };
  runOdometer(ticker, el, 7200, 8, { ms: 100 });
  ticker.tick(1);
  assert.equal(el.textContent, formatDuration(odometerValueAt(7200, 8, 1 / 100)));
  ticker.tick(49); // t = 0.5
  assert.equal(el.textContent, formatDuration(odometerValueAt(7200, 8, 0.5)));
  ticker.tick(60); // past the end
  assert.equal(el.textContent, "8s");
  ticker.destroy();
});

test("runOdometer: reduced motion snaps immediately (G9), no ticker callback left running", () => {
  const ticker = createTicker({ manual: true });
  const el = { textContent: "" };
  runOdometer(ticker, el, 7200, 8, { reduced: true });
  assert.equal(el.textContent, "8s");
  ticker.tick(1000); // nothing further changes it
  assert.equal(el.textContent, "8s");
  ticker.destroy();
});

test("runOdometer: cancel() jumps straight to the end value", () => {
  const ticker = createTicker({ manual: true });
  const el = { textContent: "" };
  const handle = runOdometer(ticker, el, 7200, 8, { ms: 1000 });
  ticker.tick(10);
  handle.cancel();
  assert.equal(el.textContent, "8s");
  ticker.tick(500); // canceled — no further writes
  assert.equal(el.textContent, "8s");
  ticker.destroy();
});

// ---------------------------------------------------------------------------
// injectPresetStyles — its own marker, independent of core's (separate entry point).
// ---------------------------------------------------------------------------

function fakeDoc() {
  const head = { children: [], appendChild(c) { this.children.push(c); return c; } };
  return {
    head,
    createElement(tag) {
      return { tag, attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, textContent: "" };
    },
    querySelector(sel) {
      const m = /\[([^\]]+)\]/.exec(sel);
      const attr = m && m[1];
      return head.children.find((c) => Object.prototype.hasOwnProperty.call(c.attrs, attr)) || null;
    },
  };
}

test("injectPresetStyles: null without a document, no throw", () => {
  assert.equal(injectPresetStyles(null), null);
  assert.equal(injectPresetStyles(undefined), null);
});

test("injectPresetStyles: one deduped <style>, its own marker", () => {
  const doc = fakeDoc();
  const first = injectPresetStyles(doc);
  assert.ok(first);
  assert.ok(Object.prototype.hasOwnProperty.call(first.attrs, PRESET_STYLE_MARKER));
  assert.equal(doc.head.children.length, 1);
  const second = injectPresetStyles(doc);
  assert.equal(second, first);
  assert.equal(doc.head.children.length, 1); // no duplicate on a second call
});

// ---------------------------------------------------------------------------
// applyPipelinePreset — wiring, against a hand-built fake host (plain objects, no DOM
// library involved; keeps this file importable/runnable under plain Node).
// ---------------------------------------------------------------------------

function fakeSvgEl(tag) {
  return {
    tag, attrs: {}, children: [], parentNode: null, textContent: "",
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
  };
}

function fakeHostDoc() {
  const doc = fakeSvgEl("#document");
  doc.head = fakeSvgEl("head");
  doc.createElementNS = (ns, tag) => fakeSvgEl(tag);
  doc.createElement = (tag) => fakeSvgEl(tag);
  doc.querySelector = (sel) => {
    const m = /\[([^\]]+)\]/.exec(sel);
    return doc.head.children.find((c) => c.hasAttribute(m[1])) || null;
  };
  return doc;
}

/** A minimal fake `g` exposing exactly the public surface preset-pipeline is allowed to use. */
function fakeInstance(initialSpec) {
  const doc = fakeHostDoc();
  const root = fakeSvgEl("div");
  root.ownerDocument = doc;
  const bus = emitter();
  const ticker = createTicker({ manual: true });
  const nodeEls = new Map();
  const edgeEls = new Map();
  let spec = initialSpec;
  let lastCommit = null; // mirrors g.layoutResult() — the real index.js keeps this in sync

  const g = {
    el: root,
    ticker,
    spec: () => spec,
    setSpec: (s) => { spec = s; },
    node: (id) => spec.nodes.find((n) => n.id === id),
    layoutResult: () => lastCommit,
    renderer: {
      node(id) {
        if (!nodeEls.has(id)) {
          const el = fakeSvgEl("g");
          el.setAttribute("data-id", id);
          nodeEls.set(id, el);
        }
        return nodeEls.get(id);
      },
      edge(id) {
        if (!edgeEls.has(id)) {
          const el = fakeSvgEl("g");
          el.setAttribute("data-id", id);
          edgeEls.set(id, el);
        }
        return edgeEls.get(id);
      },
    },
    on: (type, fn) => bus.on(type, fn),
    off: (type, fn) => bus.off(type, fn),
    emit: (type, payload) => { // test-only helper
      if (type === "commit") lastCommit = payload;
      bus.emit(type, payload);
    },
  };
  return g;
}

function rectsFrom(spec, w = 80) {
  const out = {};
  for (const n of spec.nodes) out[n.id] = { x: 0, y: 0, w, h: 40 };
  return out;
}

test("applyPipelinePreset: chips render the effective duration and total bar sums root nodes", () => {
  const spec = {
    nodes: [
      { id: "ingest", data: { duration: "45m", status: "done" } },
      { id: "clean", data: { duration: "2h", status: "active", mode: "manual" } },
    ],
    edges: [],
  };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);

  g.emit("commit", { nodes: rectsFrom(spec) });

  const clean = g.renderer.node("clean");
  const chip = clean.children.find((c) => c.attrs.class === "smv-chip");
  const status = clean.children.find((c) => c.attrs.class === "smv-status-glyph");
  const mode = clean.children.find((c) => c.attrs.class === "smv-mode-badge");
  assert.equal(chip.textContent, "2h");
  assert.equal(status.textContent, "●"); // active
  assert.equal(mode.textContent, "✋"); // manual

  const ingest = g.renderer.node("ingest");
  assert.equal(ingest.children.find((c) => c.attrs.class === "smv-chip").textContent, "45m");
  assert.equal(ingest.children.find((c) => c.attrs.class === "smv-status-glyph").textContent, "✓");

  // total bar: 45m + 2h = 2h45m worth of seconds
  const label = g.el.children.find((c) => c.attrs.class === "smv-totalbar").children
    .find((c) => c.attrs.class === "smv-totalbar-label");
  assert.equal(label.textContent, formatDuration(45 * 60 + 2 * 3600));

  handle.destroy();
});

test("applyPipelinePreset: presetPipeline(g) 'after the fact' back-fills already-rendered state (no further mutation needed)", () => {
  const spec = {
    nodes: [
      { id: "ingest", data: { duration: "45m", status: "done" } },
      { id: "clean", data: { duration: "2h", status: "active", mode: "manual" } },
    ],
    edges: [],
  };
  const g = fakeInstance(spec);

  // Mounted WITHOUT the preset — mirrors mount()'s own initial "commit", which fires
  // whether or not opts.preset:'pipeline' was given.
  g.emit("commit", { nodes: rectsFrom(spec) });

  // presetPipeline(g) attached only now, "after the fact" — no mutation/commit follows.
  const handle = applyPipelinePreset(g);

  const clean = g.renderer.node("clean");
  const chip = clean.children.find((c) => c.attrs.class === "smv-chip");
  const status = clean.children.find((c) => c.attrs.class === "smv-status-glyph");
  const mode = clean.children.find((c) => c.attrs.class === "smv-mode-badge");
  assert.ok(chip && status && mode, "adornments exist immediately, before any further commit");
  assert.equal(chip.textContent, "2h");
  assert.equal(status.textContent, "●");
  assert.equal(mode.textContent, "✋");

  const ingest = g.renderer.node("ingest");
  assert.equal(ingest.children.find((c) => c.attrs.class === "smv-chip").textContent, "45m");

  const label = g.el.children.find((c) => c.attrs.class === "smv-totalbar").children
    .find((c) => c.attrs.class === "smv-totalbar-label");
  assert.equal(label.textContent, formatDuration(45 * 60 + 2 * 3600), "total bar back-filled too");

  handle.destroy();
});

test("applyPipelinePreset: with no prior commit (layoutResult() unset), attach is a no-op until the next commit — same as before", () => {
  const spec = { nodes: [{ id: "a", data: { duration: "1m" } }], edges: [] };
  const g = fakeInstance(spec); // never emits "commit" before attaching
  const handle = applyPipelinePreset(g);

  const host = g.renderer.node("a");
  assert.equal(host.children.find((c) => c.attrs.class === "smv-chip"), undefined, "nothing to back-fill yet");

  g.emit("commit", { nodes: rectsFrom(spec) });
  assert.equal(host.children.find((c) => c.attrs.class === "smv-chip").textContent, "1m");

  handle.destroy();
});

test("applyPipelinePreset: container chip rolls up children via durationAgg", () => {
  const spec = {
    nodes: [
      { id: "clean" }, // no own duration -> sums children (default)
      { id: "clean.dedupe", parent: "clean", data: { duration: "30m" } },
      { id: "clean.validate", parent: "clean", data: { duration: "1h" } },
      { id: "clean.normalize", parent: "clean", data: { duration: "30m" } },
    ],
    edges: [],
  };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });
  const chip = g.renderer.node("clean").children.find((c) => c.attrs.class === "smv-chip");
  assert.equal(chip.textContent, "2h");
  handle.destroy();
});

test("applyPipelinePreset: condense odometer-rolls the target chip and pops a delta badge", () => {
  const before = {
    nodes: [
      { id: "clean.dedupe", data: { duration: "30m" } },
      { id: "clean.validate", data: { duration: "1h" } },
      { id: "clean.normalize", data: { duration: "30m" } },
    ],
    edges: [],
  };
  const g = fakeInstance(before);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(before) });

  const after = { nodes: [{ id: "clean.auto", data: { duration: "8s", mode: "automated" } }], edges: [] };
  g.setSpec(after);
  g.emit("commit", { nodes: rectsFrom(after) });
  g.emit("condense", {
    sources: ["clean.dedupe", "clean.validate", "clean.normalize"],
    target: "clean.auto",
    sourceData: before.nodes,
    targetData: after.nodes[0],
  });

  const host = g.renderer.node("clean.auto");
  const chip = host.children.find((c) => c.attrs.class === "smv-chip");
  const badge = host.children.find((c) => c.attrs.class === "smv-delta-badge");
  assert.ok(badge, "delta badge should have popped");
  assert.match(badge.textContent, /faster$/);

  g.ticker.tick(10000); // run the odometer + badge timer to completion
  assert.equal(chip.textContent, "8s");
  assert.equal(host.children.includes(badge), false); // badge removed after its timer

  handle.destroy();
});

test("applyPipelinePreset: destroy() stops updating chips on further commits", () => {
  const spec = { nodes: [{ id: "a", data: { duration: "1m" } }], edges: [] };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });
  const chip = g.renderer.node("a").children.find((c) => c.attrs.class === "smv-chip");
  assert.equal(chip.textContent, "1m");

  handle.destroy();
  g.setSpec({ nodes: [{ id: "a", data: { duration: "5m" } }], edges: [] });
  g.emit("commit", { nodes: rectsFrom(spec) });
  assert.equal(chip.textContent, "1m"); // unchanged — listener was removed
});

test("applyPipelinePreset: destroy() removes per-node chip/status/mode adornments and cancels an in-flight condense timer", () => {
  const before = {
    nodes: [
      { id: "clean.dedupe", data: { duration: "30m" } },
      { id: "clean.validate", data: { duration: "1h" } },
      { id: "clean.normalize", data: { duration: "30m" } },
    ],
    edges: [],
  };
  const g = fakeInstance(before);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(before) });

  const after = { nodes: [{ id: "clean.auto", data: { duration: "8s", mode: "automated" } }], edges: [] };
  g.setSpec(after);
  g.emit("commit", { nodes: rectsFrom(after) });
  g.emit("condense", {
    sources: ["clean.dedupe", "clean.validate", "clean.normalize"],
    target: "clean.auto",
    sourceData: before.nodes,
    targetData: after.nodes[0],
  });

  const host = g.renderer.node("clean.auto");
  const chip = host.children.find((c) => c.attrs.class === "smv-chip");
  const status = host.children.find((c) => c.attrs.class === "smv-status-glyph");
  const mode = host.children.find((c) => c.attrs.class === "smv-mode-badge");
  const badge = host.children.find((c) => c.attrs.class === "smv-delta-badge");
  assert.ok(chip && status && mode && badge, "sanity: all four adornments were injected");

  g.ticker.tick(300); // mid odometer roll (default 600ms) — the condense is still in flight
  assert.notEqual(chip.textContent, "8s", "sanity: the odometer has not landed yet");

  handle.destroy();

  // The injected elements are actually removed from the host, not just orphaned in place.
  assert.equal(host.children.includes(chip), false, "chip removed from its host on destroy");
  assert.equal(host.children.includes(status), false, "status glyph removed from its host on destroy");
  assert.equal(host.children.includes(mode), false, "mode badge removed from its host on destroy");
  assert.equal(host.children.includes(badge), false, "in-flight delta badge is canceled and removed, not left to pop later");

  // The odometer's ticker callback was actually canceled (removed), not just orphaned:
  // ticking the shared clock further must not write into the now-detached chip again.
  const chipTextAtDestroy = chip.textContent;
  g.ticker.tick(10000);
  assert.equal(chip.textContent, chipTextAtDestroy, "no further writes into the orphaned chip after destroy()");
});

test("applyPipelinePreset: destroy() then re-applying the preset leaves exactly one chip per node (no stacking)", () => {
  const spec = { nodes: [{ id: "a", data: { duration: "1m" } }], edges: [] };
  const g = fakeInstance(spec);
  const h1 = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });
  h1.destroy();

  const h2 = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });

  const host = g.renderer.node("a");
  const chips = host.children.filter((c) => c.attrs.class === "smv-chip");
  const statuses = host.children.filter((c) => c.attrs.class === "smv-status-glyph");
  assert.equal(chips.length, 1, "no duplicate chip left behind by the first, destroyed instance");
  assert.equal(statuses.length, 1);
  assert.equal(chips[0].textContent, "1m");

  h2.destroy();
});

test("applyPipelinePreset: re-applying without destroying first reuses the existing total-duration bar instead of stacking a second one", () => {
  const spec = { nodes: [{ id: "a", data: { duration: "1m" } }], edges: [] };
  const g = fakeInstance(spec);
  const h1 = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });
  assert.equal(g.el.children.filter((c) => c.attrs.class === "smv-totalbar").length, 1);

  const h2 = applyPipelinePreset(g); // no destroy() in between
  g.emit("commit", { nodes: rectsFrom(spec) });
  assert.equal(
    g.el.children.filter((c) => c.attrs.class === "smv-totalbar").length,
    1,
    "ensureTotalBar must reuse the existing bar rather than appending a duplicate",
  );

  h2.destroy();
  h1.destroy();
});

// ---------------------------------------------------------------------------
// F21/F22/F23 — decoration slots and the measurement hook
// ---------------------------------------------------------------------------

const clsOf = (host, cls) => host.children.find((c) => c.attrs.class === cls);
const xy = (el) => ({ x: Number(el.attrs.x), y: Number(el.attrs.y) });

test("F21: the mode glyph is placed off the chip's measured width, so a wide chip never covers it", () => {
  const spec = {
    nodes: [
      { id: "wide", data: { duration: "300ms", mode: "manual" } },
      { id: "narrow", data: { duration: "2h", mode: "manual" } },
    ],
    edges: [],
  };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec, 160) });

  for (const id of ["wide", "narrow"]) {
    const host = g.renderer.node(id);
    const chip = clsOf(host, "smv-chip"), mode = clsOf(host, "smv-mode-badge");
    // Both are text-anchor:end, so the mode glyph's own right edge must clear the chip's
    // left edge — the chip text starts at (chip.x - its width).
    assert.ok(xy(mode).x < xy(chip).x, `${id}: mode sits left of the chip`);
    assert.equal(xy(mode).y, xy(chip).y, `${id}: one shared row`);
  }
  const wide = xy(clsOf(g.renderer.node("wide"), "smv-mode-badge")).x;
  const narrow = xy(clsOf(g.renderer.node("narrow"), "smv-mode-badge")).x;
  assert.ok(wide < narrow, "a wider chip pushes the mode glyph further left");
  handle.destroy();
});

test("F23: a box too short for the chip row wears it above the box; a measured box keeps it inside", () => {
  const spec = { nodes: [{ id: "a", data: { duration: "2h" } }], edges: [] };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);

  g.emit("commit", { nodes: { a: { x: 0, y: 0, w: 90, h: 36 } } });
  assert.ok(xy(clsOf(g.renderer.node("a"), "smv-chip")).y < 0, "short box: the row lifts out of the way");

  g.emit("commit", { nodes: { a: { x: 0, y: 0, w: 90, h: 44 } } });
  assert.ok(xy(clsOf(g.renderer.node("a"), "smv-chip")).y > 0, "a measured box keeps the row inside");
  handle.destroy();
});

test("F22/F23: PIPELINE_MEASURE reserves gutters for the chip/glyphs and a row of height", () => {
  const plain = { id: "a" };
  assert.equal(PIPELINE_MEASURE.extraWidth(plain), 0, "a node with nothing to decorate is untouched");
  assert.equal(PIPELINE_MEASURE.extraHeight(plain), 0);

  const chipped = { id: "b", data: { duration: "300ms" } };
  assert.ok(PIPELINE_MEASURE.extraWidth(chipped) > 0);
  assert.ok(PIPELINE_MEASURE.extraHeight(chipped) > 0);

  // Both gutters are as wide as the wider side, because the label is centred.
  assert.equal(PIPELINE_MEASURE.extraWidth(chipped) % 2, 0);
  const withMode = { id: "c", data: { duration: "300ms", mode: "manual" } };
  assert.ok(PIPELINE_MEASURE.extraWidth(withMode) > PIPELINE_MEASURE.extraWidth(chipped),
    "a mode glyph widens the right gutter further");
  assert.ok(PIPELINE_EDGE_LABEL_MAX_W > 90, "the preset raises the edge-label cap (F26)");
});

test("F21/F23: a container's rollup chip keeps its in-box slot — it never lifts out of the node", () => {
  const spec = {
    nodes: [
      { id: "chassis", label: "Chassis", collapsed: true, durationAgg: "sum" },
      { id: "weld", parent: "chassis", data: { duration: "20m" } },
      { id: "paint", parent: "chassis", data: { duration: "10m" } },
    ],
    edges: [],
  };
  const g = fakeInstance(spec);
  const host = g.renderer.node("chassis");
  host.setAttribute("data-container", "");
  host.setAttribute("data-collapsed", "");
  const handle = applyPipelinePreset(g);

  // A collapsed container is 36px tall by construction (viewstate sizes it like a plain
  // node), but its chip is the rollup the condense odometer and delta badge anchor to.
  g.emit("commit", { nodes: { chassis: { x: 0, y: 0, w: 140, h: 36 } } });
  const chip = clsOf(host, "smv-chip");
  assert.equal(chip.textContent, "30m", "the chip shows the durationAgg rollup");
  assert.ok(xy(chip).y > 0, "collapsed container: the chip stays INSIDE the box");

  host.removeAttribute("data-collapsed");
  g.emit("commit", { nodes: { chassis: { x: 0, y: 0, w: 240, h: 120 } } });
  assert.equal(xy(chip).y, 14, "expanded container: the chip rides the header strip");
  handle.destroy();
});

test("F22: PIPELINE_MEASURE reserves for the rollup chip a container actually draws", () => {
  const nodes = new Map([
    ["chassis", { id: "chassis", label: "Chassis", durationAgg: "sum" }],
    ["weld", { id: "weld", parent: "chassis", data: { duration: "20m" } }],
    ["paint", { id: "paint", parent: "chassis", data: { duration: "10m" } }],
  ]);
  const chassis = nodes.get("chassis");
  const ctx = { nodes, cache: new Map() };
  // Without the graph context all a bare node can offer is its own (absent) duration...
  assert.equal(PIPELINE_MEASURE.extraWidth(chassis), 0);
  // ...with it, the rollup the chip will show is measured, so the label clears the chip.
  assert.ok(PIPELINE_MEASURE.extraWidth(chassis, ctx) > 0, "a rollup container reserves width");
  assert.ok(PIPELINE_MEASURE.extraHeight(chassis, ctx) > 0, "and a chip row of height");
  // A leaf with its own duration is measured the same either way.
  assert.equal(
    PIPELINE_MEASURE.extraWidth(nodes.get("weld"), ctx),
    PIPELINE_MEASURE.extraWidth(nodes.get("weld")),
  );
});

// ---------------------------------------------------------------------------
// F24 — the total-duration bar reports sum vs critical path
// ---------------------------------------------------------------------------

function forkSpec() {
  // ingest -> (slow | fast) : sum = 30+120+10 = 160s, critical path = 30+120 = 150s
  return {
    nodes: [
      { id: "ingest", data: { duration: "30s" } },
      { id: "slow", data: { duration: "120s" } },
      { id: "fast", data: { duration: "10s" } },
    ],
    edges: [
      { id: "e1", source: "ingest", target: "slow" },
      { id: "e2", source: "ingest", target: "fast" },
    ],
  };
}

test("criticalPathSec: the heaviest chain, not the sum; loop edges are excluded", () => {
  assert.equal(criticalPathSec(forkSpec()), 150);

  const withLoop = forkSpec();
  withLoop.edges.push({ id: "back", source: "slow", target: "ingest", loop: true, maxIterations: 3 });
  assert.equal(criticalPathSec(withLoop), 150, "a back edge is not a longer path");

  assert.equal(criticalPathSec({ nodes: [], edges: [] }), null);
});

test("criticalPathSec: a child's edges count against its top-level ancestor", () => {
  const spec = {
    nodes: [
      { id: "grp" },
      { id: "grp.a", parent: "grp", data: { duration: "1m" } },
      { id: "grp.b", parent: "grp", data: { duration: "1m" } },
      { id: "after", data: { duration: "30s" } },
    ],
    edges: [{ id: "e", source: "grp.b", target: "after" }],
  };
  assert.equal(criticalPathSec(spec), 2 * 60 + 30); // the container rolls up to 2m, then 30s
});

test("F24: total defaults to 'both' — the label stays the sum, the alt names the critical path", () => {
  const spec = forkSpec();
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });

  const bar = g.el.children.find((c) => c.attrs.class === "smv-totalbar");
  assert.equal(clsOf(bar, "smv-totalbar-label").textContent, formatDuration(160));
  assert.equal(clsOf(bar, "smv-totalbar-key").textContent, "sum");
  assert.equal(clsOf(bar, "smv-totalbar-alt").textContent, `critical ${formatDuration(150)}`);
  handle.destroy();
});

test("F24: total:'critical' reports the path, total:'sum' is exactly the old bare number", () => {
  const spec = forkSpec();
  const crit = fakeInstance(spec);
  const h1 = applyPipelinePreset(crit, { total: "critical" });
  crit.emit("commit", { nodes: rectsFrom(spec) });
  const cbar = crit.el.children.find((c) => c.attrs.class === "smv-totalbar");
  assert.equal(clsOf(cbar, "smv-totalbar-label").textContent, formatDuration(150));
  assert.equal(clsOf(cbar, "smv-totalbar-key").textContent, "critical");
  assert.equal(clsOf(cbar, "smv-totalbar-alt").textContent, "");
  h1.destroy();

  const sum = fakeInstance(spec);
  const h2 = applyPipelinePreset(sum, { total: "sum" });
  sum.emit("commit", { nodes: rectsFrom(spec) });
  const sbar = sum.el.children.find((c) => c.attrs.class === "smv-totalbar");
  assert.equal(clsOf(sbar, "smv-totalbar-label").textContent, formatDuration(160));
  assert.equal(clsOf(sbar, "smv-totalbar-key").textContent, "", "no key: one number, nothing to disambiguate");
  assert.equal(clsOf(sbar, "smv-totalbar-alt").textContent, "");
  h2.destroy();
});

test("F24: 'both' says nothing extra when the two totals agree (a straight pipeline)", () => {
  const spec = {
    nodes: [{ id: "a", data: { duration: "1m" } }, { id: "b", data: { duration: "2m" } }],
    edges: [{ id: "e", source: "a", target: "b" }],
  };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec) });
  const bar = g.el.children.find((c) => c.attrs.class === "smv-totalbar");
  assert.equal(clsOf(bar, "smv-totalbar-label").textContent, formatDuration(180));
  assert.equal(clsOf(bar, "smv-totalbar-key").textContent, "");
  assert.equal(clsOf(bar, "smv-totalbar-alt").textContent, "");
  handle.destroy();
});

// ---------------------------------------------------------------------------
// F26 — edge.data.duration as an edge chip
// ---------------------------------------------------------------------------

test("F26: edge.data.duration renders a chip on the edge, offset off the line", () => {
  const spec = {
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [
      { id: "hop", source: "a", target: "b", data: { duration: "400ms" } },
      { id: "plain", source: "a", target: "b" },
    ],
  };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", {
    nodes: rectsFrom(spec),
    edges: { hop: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, plain: { points: [] } },
  });

  const chip = clsOf(g.renderer.edge("hop"), "smv-edge-chip");
  assert.equal(chip.textContent, "400ms");
  assert.equal(xy(chip).x, 50, "midpoint of the bend chain");
  assert.notEqual(xy(chip).y, 0, "pushed off the line so it does not sit on the stroke");
  assert.equal(clsOf(g.renderer.edge("plain"), "smv-edge-chip"), undefined, "no duration, no element");

  // The chip goes away with its edge, and destroy() takes the rest.
  g.setSpec({ nodes: spec.nodes, edges: [] });
  g.emit("commit", { nodes: rectsFrom(spec), edges: {} });
  assert.equal(g.renderer.edge("hop").children.length, 0, "chip removed when the edge loses its duration");
  handle.destroy();
});

test("F26: a BENT edge (odd-length bend chain) still pushes its chip off the stroke", () => {
  // Any edge the solver bends spans >2 points, and an odd-length chain has its middle
  // index land exactly ON a bend point. Indexing the chain by hand made `a === b` there,
  // so the perpendicular push was (0,0) and the chip sat on the wire under the label.
  const spec = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ac", source: "a", target: "c", label: "skip", data: { duration: "400ms" } },
    ],
  };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  // A three-point chain that bends: the middle point is the bend the solver routed around.
  const points = [{ x: 20, y: 27.25 }, { x: 76, y: 34.5 }, { x: 132, y: 31.6 }];
  g.emit("commit", { nodes: rectsFrom(spec), edges: { ac: { points } } });

  const chip = clsOf(g.renderer.edge("ac"), "smv-edge-chip");
  assert.equal(chip.textContent, "400ms");
  const bend = points[1];
  const off = Math.hypot(xy(chip).x - bend.x, xy(chip).y - bend.y);
  assert.ok(off > 5, `the chip must clear the stroke, not sit on the bend (off by ${off})`);
  // render.js rides the label on pointAt(path, 0.5) + 8px along the SAME normal, so the
  // chip has to be on the other side of the line from it, not a couple of px away.
  const mid = pointAt(points, 0.5);
  const nx = -Math.sin(mid.angle), ny = Math.cos(mid.angle);
  const label = { x: mid.x + nx * 8, y: mid.y + ny * 8 };
  assert.ok(Math.hypot(xy(chip).x - label.x, xy(chip).y - label.y) > 12,
    "chip and edge label end up on opposite sides of the wire");
  handle.destroy();
});

test("F26: a straight two-point edge is placed exactly as before (arc-length midpoint)", () => {
  const spec = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ id: "hop", source: "a", target: "b", data: { duration: "1s" } }] };
  const g = fakeInstance(spec);
  const handle = applyPipelinePreset(g);
  g.emit("commit", { nodes: rectsFrom(spec), edges: { hop: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } } });
  assert.deepEqual(xy(clsOf(g.renderer.edge("hop"), "smv-edge-chip")), { x: 50, y: -9 });
  handle.destroy();
});

// ---------------------------------------------------------------------------
// docs/PRESETS.md's copy-paste snippets have to actually link
// ---------------------------------------------------------------------------

test("every subpath import in docs/PRESETS.md names an export the module really has", async () => {
  const md = await readFile(new URL("../docs/PRESETS.md", import.meta.url), "utf8");
  const re = /import\s*\{([^}]*)\}\s*from\s*"sparkle-motion-visualizer\/([\w-]+)"/g;
  const seen = [];
  for (const m of md.matchAll(re)) {
    const mod = await import(`sparkle-motion-visualizer/${m[2]}`);
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      seen.push(`${m[2]}:${name}`);
      // A named import of a missing export is a LINK-time SyntaxError, not `undefined` —
      // the page never runs at all, so a wrong name in a doc snippet is not a soft failure.
      assert.ok(name in mod, `docs/PRESETS.md imports "${name}" from "${m[2]}", which does not export it`);
    }
  }
  assert.ok(seen.length > 0, "the doc still has at least one subpath import to check");
});

test("PRESET_CSS carries the new slots: edge chip + the total bar's key/alt spans", () => {
  assert.match(PRESET_CSS, /\.smv-edge-chip\{/);
  assert.match(PRESET_CSS, /\.smv-totalbar-key,\.smv-totalbar-alt\{/);
});
