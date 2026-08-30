// M4 director unit tests — resolveCameraTarget (pure) and the emphasis/caption state
// machine, both run against a fake host per the `internals` contract (D12–D14). No DOM
// beyond a hand-rolled element stub, no clock at all: the director is discrete state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirector, resolveCameraTarget } from "../src/director.js";
import { MIN_K, MAX_K } from "../src/viewport.js";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);
const closeT = (t, e, msg = "") => {
  close(t.x, e.x, `${msg} x`); close(t.y, e.y, `${msg} y`); close(t.k, e.k, `${msg} k`);
};

// Centre-origin node records, exactly what layout.js produces; bounds is a top-left rect.
const LAYOUT = {
  nodes: {
    a: { x: 100, y: 50, w: 120, h: 40 },
    b: { x: 300, y: 200, w: 80, h: 40 },
  },
  edges: { e1: { points: [] } },
  bounds: { x: 40, y: 30, w: 340, h: 210 },
};
const SIZE = { w: 800, h: 600 };
const CUR = { x: 10, y: 20, k: 2 };

// ---------------------------------------------------------------------------
// resolveCameraTarget — pure target resolution.
// ---------------------------------------------------------------------------

test("camera target: node without k fits the node box with the default pad", () => {
  const t = resolveCameraTarget({ node: "a" }, LAYOUT, SIZE, CUR);
  // a's box is 120×40 at centre (100,50); k = min((800-48)/120, (600-48)/40) = 6.27, which
  // the viewport's MAX_K lids at 4 — and the centring must use THAT k, not the raw fit.
  const k = MAX_K;
  closeT(t, { x: 400 - 100 * k, y: 300 - 50 * k, k }, "node fit");
});

test("camera target: explicit k on a node target is an explicit scale, pad ignored", () => {
  const t = resolveCameraTarget({ node: "a", k: 2, pad: 500 }, LAYOUT, SIZE, CUR);
  closeT(t, { x: 400 - 100 * 2, y: 300 - 50 * 2, k: 2 }, "node with k");
});

test("camera target: pad changes the fitted scale", () => {
  const t = resolveCameraTarget({ node: "b", pad: 100 }, LAYOUT, SIZE, CUR);
  const k = Math.min(600 / 80, 400 / 40); // = 7.5 -> lidded at MAX_K
  close(t.k, Math.min(k, MAX_K), "padded node k");
  const t2 = resolveCameraTarget({ node: "b", pad: 260 }, LAYOUT, SIZE, CUR);
  const k2 = Math.min(280 / 80, 80 / 40); // = 2, under the lid: the pad is what moved it
  closeT(t2, { x: 400 - 300 * k2, y: 300 - 200 * k2, k: k2 }, "padded node");
});

test("camera target: a derived k is clamped to the viewport's own range BEFORE x/y (D9/MAX_K)", () => {
  // setTo() clamps k but copies x/y verbatim, so an unclamped fit would centre the shot at
  // a scale that never gets applied and put the node off-screen by the clamp ratio.
  const t = resolveCameraTarget({ node: "a" }, LAYOUT, SIZE, CUR);
  close(t.k, MAX_K, "fitted k lidded");
  close(t.x + 100 * t.k, 400, "…and a's centre still lands on the pane centre");
  close(t.y + 50 * t.k, 300, "…y too");

  // Explicit k on a box target is a scale request, not an exemption.
  close(resolveCameraTarget({ node: "a", k: 9 }, LAYOUT, SIZE, CUR).k, MAX_K, "explicit box k lidded");

  // A relative zoom past the lid keeps the pane centre fixed at the clamped scale.
  const z = resolveCameraTarget({ zoom: 8 }, LAYOUT, SIZE, CUR); // k0=2 -> 16
  close(z.k, MAX_K, "zoom lidded");
  close(z.x, 400 - (400 - CUR.x) * (MAX_K / CUR.k), "zoom x uses the clamped ratio");

  // And the floor: bounds too big to fit bottom out at MIN_K, not below it.
  const huge = { nodes: {}, bounds: { x: 0, y: 0, w: 100000, h: 100000 } };
  const f = resolveCameraTarget({ fit: true }, huge, SIZE, CUR);
  close(f.k, MIN_K, "fitted k floored");
  close(f.x + 50000 * f.k, 400, "…still centred at the floored k");
});

test("camera target: nodes[] frames the union of the boxes", () => {
  const t = resolveCameraTarget({ nodes: ["a", "b"] }, LAYOUT, SIZE, CUR);
  // Union of a (40..160, 30..70) and b (260..340, 180..220): 300×190 centred at (190,125).
  const k = Math.min(752 / 300, 552 / 190);
  closeT(t, { x: 400 - 190 * k, y: 300 - 125 * k, k }, "union fit");
});

test("camera target: fit:true frames layoutResult.bounds", () => {
  const t = resolveCameraTarget({ fit: true }, LAYOUT, SIZE, CUR);
  const k = Math.min(752 / 340, 552 / 210);
  closeT(t, { x: 400 - 210 * k, y: 300 - 135 * k, k }, "full fit");
});

test("camera target: absolute x/y/k passes straight through; partials keep the current axis", () => {
  closeT(resolveCameraTarget({ x: 120, y: -40, k: 1.25 }, LAYOUT, SIZE, CUR), { x: 120, y: -40, k: 1.25 }, "absolute");
  closeT(resolveCameraTarget({ x: 50 }, LAYOUT, SIZE, CUR), { x: 50, y: 20, k: 2 }, "x only");
  closeT(resolveCameraTarget({ y: 7, k: 3 }, LAYOUT, SIZE, CUR), { x: 10, y: 7, k: 3 }, "y+k");
});

test("camera target: zoom is relative to the CURRENT (target) transform and zooms about the pane centre", () => {
  const t = resolveCameraTarget({ zoom: 1.5 }, LAYOUT, SIZE, CUR);
  // k: 2 -> 3; whatever sits under (400,300) stays there: x = 400 - (400-10)*1.5.
  closeT(t, { x: 400 - 390 * 1.5, y: 300 - 280 * 1.5, k: 3 }, "zoom");
});

test("camera target: bare k (no x/y) also zooms about the pane centre", () => {
  const t = resolveCameraTarget({ k: 3 }, LAYOUT, SIZE, CUR);
  closeT(t, { x: 400 - 390 * 1.5, y: 300 - 280 * 1.5, k: 3 }, "bare k");
});

test("camera target: by:{dx,dy} is a screen-px nudge applied after any zoom", () => {
  closeT(resolveCameraTarget({ by: { dx: -200, dy: 30 } }, LAYOUT, SIZE, CUR), { x: -190, y: 50, k: 2 }, "pan");
  const t = resolveCameraTarget({ zoom: 1.5, by: { dx: 100, dy: 0 } }, LAYOUT, SIZE, CUR);
  closeT(t, { x: 400 - 390 * 1.5 + 100, y: 300 - 280 * 1.5, k: 3 }, "zoom+pan");
});

test("camera target: an unknown node id resolves to 'stay put', never the origin", () => {
  closeT(resolveCameraTarget({ node: "ghost" }, LAYOUT, SIZE, CUR), CUR, "unknown id");
  closeT(resolveCameraTarget({ node: "ghost" }, null, SIZE, CUR), CUR, "no layout at all");
});

// ---------------------------------------------------------------------------
// createDirector — emphasis + caption state machine against a fake host.
// ---------------------------------------------------------------------------

function makeEl(tag) {
  return {
    tag, children: [], parent: null, attrs: {}, textContent: "",
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
      getPropertyValue(k) { return this._p[k] ?? ""; },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
  };
}

/** The manual half of src/anim.js's ticker: enough clock for the pulse, and observable —
 *  `cbs.size` IS the "can the rAF loop go idle again?" question (D1/D17). */
function makeTicker() {
  const cbs = new Set();
  let t = 0;
  return {
    cbs,
    now: () => t,
    add: (fn) => cbs.add(fn),
    remove: (fn) => cbs.delete(fn),
    tick(ms) { t += ms; for (const fn of [...cbs]) fn(t); },
  };
}

function makeHost(extra = {}) {
  const doc = { createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; } };
  const root = makeEl("div");
  root.ownerDocument = doc;
  const calls = [];
  const ticker = makeTicker();
  const dir = createDirector({
    root,
    ticker,
    lastLayout: () => ({ nodes: { a: {}, b: {} }, edges: { e1: {} } }),
    emphasize: (id, v) => calls.push(["emph", id, v]),
    dim: (id, v) => calls.push(["dim", id, v]),
    ...extra,
  });
  const capEl = () => root.children.find((c) => c.attrs.class === "smv-caption") || null;
  const pulse = () => root.style.getPropertyValue("--smv-pulse");
  return { root, dir, calls, capEl, ticker, pulse };
}

test("highlight writes the variant onto the selection and dim:true dims everything else drawn", () => {
  const { dir, calls } = makeHost();
  dir.highlight({ nodes: ["a"], edges: ["e1"], variant: "warn", dim: true });
  assert.deepEqual(
    calls.filter((c) => c[0] === "emph").sort(),
    [["emph", "a", "warn"], ["emph", "e1", "warn"]],
  );
  // Only b (drawn, not selected) is dimmed — the selection itself never is.
  assert.deepEqual(calls.filter((c) => c[0] === "dim"), [["dim", "b", true]]);
});

test("highlight is replace-not-accumulate: the next call clears what the last one wrote", () => {
  const { dir, calls } = makeHost();
  dir.highlight({ nodes: ["a"], dim: true });
  calls.length = 0;
  dir.highlight({ nodes: ["b"] });
  assert.deepEqual(calls.sort(), [
    ["dim", "b", null],       // the spotlight dimmed b and e1; the new highlight has no dim
    ["dim", "e1", null],
    ["emph", "a", null],
    ["emph", "b", "focus"],   // default variant
  ]);
});

test("apply() diffs against what is already written: an identical highlight writes nothing", () => {
  const { dir, calls } = makeHost();
  dir.highlight({ nodes: ["a"], variant: "ok", dim: true });
  calls.length = 0;
  dir.highlight({ nodes: ["a"], variant: "ok", dim: true });
  assert.deepEqual(calls, [], "no redundant DOM writes");
});

test("clearHighlight removes every emphasis and every dim", () => {
  const { dir, calls } = makeHost();
  dir.highlight({ nodes: ["a"], edges: ["e1"], dim: true });
  calls.length = 0;
  dir.clearHighlight();
  assert.deepEqual(calls.sort(), [["dim", "b", null], ["emph", "a", null], ["emph", "e1", null]]);
  calls.length = 0;
  dir.clearHighlight(); // already clear: still nothing to write
  assert.deepEqual(calls, []);
});

test("reassert() force-rewrites the whole desired state onto fresh elements", () => {
  const { dir, calls } = makeHost();
  dir.highlight({ nodes: ["a"], dim: true });
  calls.length = 0;
  // A commit rebuilt the <g>s: the DOM is blank but the diff cache says "written".
  dir.reassert();
  assert.deepEqual(calls.sort(), [["dim", "b", true], ["dim", "e1", true], ["emph", "a", "focus"]]);
});

test("snapshot()/restore() round-trips emphasis and caption as state (G2/D14)", () => {
  const { dir, calls, capEl } = makeHost();
  dir.highlight({ nodes: ["a"], variant: "warn" });
  dir.caption("first");
  const snap = dir.snapshot();

  dir.highlight({ nodes: ["b"], dim: true });
  dir.caption("second", { place: "top" });
  calls.length = 0;
  dir.restore(snap);

  assert.deepEqual(calls.sort(), [
    ["dim", "a", null], ["dim", "e1", null],
    ["emph", "a", "warn"], ["emph", "b", null],
  ]);
  assert.equal(capEl().textContent, "first");
  assert.equal(capEl().attrs["data-place"], undefined, "the restored caption has no place attr");

  // Restoring an empty snapshot clears everything.
  dir.restore({ emphasis: { emph: [], dim: [] }, caption: null });
  assert.equal(capEl(), null);
  assert.equal(dir.captionText(), null);
});

test("caption(): lazily creates one role=status overlay, updates it in place, and clear removes it", () => {
  const { root, dir, capEl } = makeHost();
  assert.equal(capEl(), null, "no overlay until the first caption");

  dir.caption("hello", { place: "top", variant: "note" });
  const el = capEl();
  assert.ok(el, "overlay created");
  assert.equal(el.attrs.role, "status");
  assert.equal(el.attrs["aria-live"], undefined, "never assertive, never aria-live");
  assert.equal(el.textContent, "hello");
  assert.equal(el.attrs["data-place"], "top");
  assert.equal(el.attrs["data-variant"], "note");

  dir.caption("next"); // same element, opts dropped
  assert.equal(capEl(), el, "the overlay is reused, not recreated");
  assert.equal(el.textContent, "next");
  assert.equal(el.attrs["data-place"], undefined);
  assert.equal(el.attrs["data-variant"], undefined);

  dir.caption(null);
  assert.equal(capEl(), null, "caption(null) removes the overlay");
  assert.equal(dir.captionText(), null);
  assert.equal(root.children.length, 0);
});

test("captions:false suppresses the overlay but the caption stays state (cues, snapshot)", () => {
  const { dir, capEl } = makeHost({ captions: false });
  dir.caption("quiet");
  assert.equal(capEl(), null, "no overlay in a suppressed mount");
  assert.equal(dir.captionText(), "quiet", "…but the text is still readable state");
  assert.equal(dir.snapshot().caption.text, "quiet", "…and still snapshotted");
});

test("caption is inert without a document (no ownerDocument on the root)", () => {
  const root = makeEl("div"); // ownerDocument stays undefined
  const dir = createDirector({ root, lastLayout: () => null });
  assert.doesNotThrow(() => dir.caption("nobody sees this"));
  assert.equal(root.children.length, 0);
  assert.equal(dir.captionText(), "nobody sees this");
});

// ---------------------------------------------------------------------------
// M4d — the property override layer (D16) and the ticker-driven pulse (D17).
// ---------------------------------------------------------------------------

test("props(): the layer the renderer merges, with dropped keys nulled out (D16)", () => {
  const { dir } = makeHost();
  dir.props({ a: { "--smv-fill": "#7c5cff" }, e1: { "--smv-stroke": "#f5a" } });
  assert.deepEqual(
    [...dir.propsLayer()],
    [["a", { "--smv-fill": "#7c5cff" }], ["e1", { "--smv-stroke": "#f5a" }]],
  );
  // Nothing changed since the last commit: the same values go out again, harmlessly.
  dir.props({ a: { "--smv-fill": "#7c5cff" }, e1: { "--smv-stroke": "#f5a" } });
  assert.deepEqual([...dir.propsLayer()].map(([id]) => id), ["a", "e1"]);

  // Replace, not accumulate: e1 drops out entirely and a swaps which key it sets, so both
  // of the old properties have to arrive as null or they would outlive their override.
  dir.props({ a: { "--smv-stroke": "#0f0" } });
  assert.deepEqual([...dir.propsLayer()], [
    ["a", { "--smv-fill": null, "--smv-stroke": "#0f0" }],
    ["e1", { "--smv-stroke": null }],
  ]);

  dir.props(null);
  assert.deepEqual([...dir.propsLayer()], [["a", { "--smv-stroke": null }]]);
  assert.equal(dir.propsLayer(), null, "…and once nothing is written, there is no layer");
});

test("props(): only --smv-* keys, and a rejected map leaves the previous layer standing (D7)", () => {
  const { dir } = makeHost();
  dir.props({ a: { "--smv-fill": "red" } });
  dir.propsLayer();
  assert.throws(
    () => dir.props({ a: { "--smv-fill": "blue" }, b: { fill: "blue" } }),
    /props only sets --smv-\* properties \(D7\): "fill" on "b" is not one/,
  );
  assert.deepEqual(
    [...dir.propsLayer()],
    [["a", { "--smv-fill": "red" }]],
    "the layer is exactly what it was: the good half of a rejected map was not written either",
  );
  assert.deepEqual(dir.snapshot().props, [["a", { "--smv-fill": "red" }]], "the old layer survives");
});

test("props() round-trips through snapshot/restore like emphasis (G2)", () => {
  const { dir } = makeHost();
  dir.props({ a: { "--smv-fill": "red" } });
  dir.propsLayer();
  const snap = dir.snapshot();
  dir.props({ b: { "--smv-fill": "blue" } });
  dir.propsLayer();
  dir.restore(snap);
  assert.deepEqual([...dir.propsLayer()], [["b", { "--smv-fill": null }], ["a", { "--smv-fill": "red" }]]);
});

test("pulse: rides the shared ticker in quantized buckets, and the same ticks give the same DOM (D1/D17)", () => {
  const { dir, ticker, pulse } = makeHost();
  assert.equal(pulse(), "", "nothing on the root until something pulses");

  dir.highlight({ nodes: ["a"], pulse: true });
  assert.equal(ticker.cbs.size, 1, "the pulse registered with the one shared clock");
  assert.equal(pulse(), "0", "t=0 is the trough");

  const seen = [];
  for (let i = 0; i < 12; i++) { ticker.tick(100); seen.push(pulse()); }
  // 1400ms cycle, 12 buckets: every value is k/12, and it climbs to the peak and back.
  for (const v of seen) assert.ok(Number.isInteger(Number(v) * 12), `bucketed: ${v}`);
  assert.equal(Math.max(...seen.map(Number)), 1, "reaches the peak");
  assert.ok(seen.some((v) => Number(v) > 0 && Number(v) < 1), "…through intermediate stops");

  // Determinism: a second director fed the identical tick sequence writes the identical
  // strings. That is what makes a frame capture reproducible without a CSS kill-switch.
  const other = makeHost();
  other.dir.highlight({ nodes: ["a"], pulse: true });
  const again = [];
  for (let i = 0; i < 12; i++) { other.ticker.tick(100); again.push(other.pulse()); }
  assert.deepEqual(again, seen);
});

test("pulse: unregisters on clearHighlight, on a restore that has none, and on destroy", () => {
  const { dir, ticker, pulse } = makeHost();
  dir.highlight({ nodes: ["a"], pulse: true });
  const snap = dir.snapshot();
  assert.equal(snap.emphasis.pulse, true, "it is snapshotted state like everything else here");

  dir.clearHighlight();
  assert.equal(ticker.cbs.size, 0, "the rAF loop can go idle again");
  assert.equal(pulse(), "", "and the property is off the root");

  dir.restore(snap);
  assert.equal(ticker.cbs.size, 1, "a restore brings it back");
  dir.restore({ emphasis: { emph: [["a", "focus"]], dim: [] }, caption: null, props: [] });
  assert.equal(ticker.cbs.size, 0, "…and a snapshot without one takes it away");

  dir.highlight({ nodes: ["a"], pulse: true });
  dir.destroy();
  assert.equal(ticker.cbs.size, 0, "destroy() never leaves a callback on the clock");
  assert.equal(pulse(), "");
});

test("pulse: replaced by a non-pulsing highlight, it comes off the clock with the old emphasis", () => {
  const { dir, ticker, pulse } = makeHost();
  dir.highlight({ nodes: ["a"], pulse: true });
  assert.equal(ticker.cbs.size, 1);
  dir.highlight({ nodes: ["b"] }); // replace-not-accumulate applies to the modifier too
  assert.equal(ticker.cbs.size, 0, "the new highlight does not pulse, so nothing stays registered");
  assert.equal(pulse(), "", "and the property came off the root");
});

test("pulse: re-rendering the same instant writes the same value (record-mode double render)", () => {
  // The frame renderer evaluates a tick, drains microtasks, then may pump extra zero-length
  // turns before the screenshot — the intensity must be a function of the clock, not of how
  // many times the callback ran.
  const { dir, ticker, pulse } = makeHost();
  dir.highlight({ nodes: ["a"], pulse: true });
  ticker.tick(250);
  const v = pulse();
  ticker.tick(0);
  ticker.tick(0);
  assert.equal(pulse(), v, "a zero-length tick never moves the pulse");
});

test("pulse: a plain highlight never registers, and an empty selection has nothing to pulse", () => {
  const { dir, ticker } = makeHost();
  dir.highlight({ nodes: ["a"] });
  assert.equal(ticker.cbs.size, 0);
  dir.highlight({ nodes: [], pulse: true });
  assert.equal(ticker.cbs.size, 0);
});

test("G9: reduced motion holds the pulse at its peak instead of dropping the emphasis", () => {
  const { dir, ticker, pulse } = makeHost({ reduced: true });
  dir.highlight({ nodes: ["a"], pulse: true });
  assert.equal(ticker.cbs.size, 0, "no per-frame work at all");
  assert.equal(pulse(), "1", "…but the state is still there, statically");
  dir.clearHighlight();
  assert.equal(pulse(), "");
});

test("destroy() removes the overlay and stops any further rendering", () => {
  const { root, dir, capEl } = makeHost();
  dir.caption("bye");
  assert.ok(capEl());
  dir.destroy();
  assert.equal(capEl(), null);
  dir.caption("again");
  assert.equal(root.children.length, 0, "a destroyed director never touches the DOM again");
});
