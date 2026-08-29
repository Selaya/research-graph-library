import { test } from "node:test";
import assert from "node:assert/strict";
import { emitter } from "../src/events.js";
import { createTicker } from "../src/anim.js";
import {
  formatDuration, aggregateDuration, effectiveDurationSec, deltaBadgeText,
  odometerValueAt, runOdometer, injectPresetStyles, applyPipelinePreset,
  PRESET_STYLE_MARKER,
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
  let spec = initialSpec;

  const g = {
    el: root,
    ticker,
    spec: () => spec,
    setSpec: (s) => { spec = s; },
    node: (id) => spec.nodes.find((n) => n.id === id),
    renderer: {
      node(id) {
        if (!nodeEls.has(id)) {
          const el = fakeSvgEl("g");
          el.setAttribute("data-id", id);
          nodeEls.set(id, el);
        }
        return nodeEls.get(id);
      },
    },
    on: (type, fn) => bus.on(type, fn),
    off: (type, fn) => bus.off(type, fn),
    emit: (type, payload) => bus.emit(type, payload), // test-only helper
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
