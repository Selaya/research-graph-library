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

function makeHost(extra = {}) {
  const doc = { createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; } };
  const root = makeEl("div");
  root.ownerDocument = doc;
  const calls = [];
  const dir = createDirector({
    root,
    lastLayout: () => ({ nodes: { a: {}, b: {} }, edges: { e1: {} } }),
    emphasize: (id, v) => calls.push(["emph", id, v]),
    dim: (id, v) => calls.push(["dim", id, v]),
    ...extra,
  });
  const capEl = () => root.children.find((c) => c.attrs.class === "smv-caption") || null;
  return { root, dir, calls, capEl };
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

test("destroy() removes the overlay and stops any further rendering", () => {
  const { root, dir, capEl } = makeHost();
  dir.caption("bye");
  assert.ok(capEl());
  dir.destroy();
  assert.equal(capEl(), null);
  dir.caption("again");
  assert.equal(root.children.length, 0, "a destroyed director never touches the DOM again");
});
