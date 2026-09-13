// Regression coverage for src/viewport.js — the anchored-viewport correction (D10).
// DOM needs here are minimal (no pointer/wheel exercised), so a small hand-rolled stub
// stands in for the svg element/viewport group, same spirit as test/integration.test.js's
// fuller DOM shim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicker } from "../src/anim.js";
import { createViewport, paneInsets } from "../src/viewport.js";

function makeSvgStub(w = 800, h = 600) {
  return {
    getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
    clientWidth: w,
    clientHeight: h,
  };
}

function makeGroupStub() {
  return { setAttribute() {} };
}

function setup() {
  const ticker = createTicker({ manual: true });
  const vp = createViewport(makeSvgStub(), makeGroupStub(), ticker);
  return { ticker, vp };
}

test("viewport.anchor(): mid-tween correction targets the tween's destination frame, not the mid-tween state", () => {
  const bounds = { x: 0, y: 0, w: 4000, h: 3000 };

  // Reference: run the exact same fit() to completion so we know what `target` actually is.
  const ref = setup();
  ref.vp.fit(bounds, 24, true);
  ref.ticker.tick(1000); // well past the 350ms tween — state has fully caught up to target
  const target = ref.vp.transform;
  ref.ticker.destroy();
  assert.notEqual(target.k, 1, "sanity: fit() actually changed the scale for this bounds/viewport");

  const before = { x: 1000, y: 300 };
  const after = { x: 700, y: 300 };
  // The D10 invariant anchor() must uphold: once the correction lands, world point `after`
  // renders exactly where world point `before` was heading to under the fit's destination
  // transform (`target`) — that's what setTo() below actually writes into.
  const expected = { x: before.x * target.k + target.x, y: before.y * target.k + target.y };

  const { ticker, vp } = setup();
  vp.fit(bounds, 24, true);
  ticker.tick(60); // partway through the 350ms tween: state.k is still far from target.k
  assert.notEqual(vp.transform.k, target.k, "precondition: the fit tween is genuinely still in flight");

  vp.anchor(before, after, 0);
  const screen = vp.worldToScreen(after);
  assert.ok(Math.abs(screen.x - expected.x) < 0.01, `x: got ${screen.x}, expected ${expected.x}`);
  assert.ok(Math.abs(screen.y - expected.y) < 0.01, `y: got ${screen.y}, expected ${expected.y}`);

  ticker.destroy();
});

test("viewport.anchor(): matches the mid-tween case when no tween is in flight (state === target)", () => {
  const bounds = { x: 0, y: 0, w: 4000, h: 3000 };
  const { ticker, vp } = setup();
  vp.fit(bounds, 24, true);
  ticker.tick(1000); // let the tween fully settle: state.k === target.k here
  const target = vp.transform;

  const before = { x: 1000, y: 300 };
  const after = { x: 700, y: 300 };
  const expected = { x: before.x * target.k + target.x, y: before.y * target.k + target.y };

  vp.anchor(before, after, 0);
  const screen = vp.worldToScreen(after);
  assert.ok(Math.abs(screen.x - expected.x) < 0.01);
  assert.ok(Math.abs(screen.y - expected.y) < 0.01);

  ticker.destroy();
});

// ---------------------------------------------------------------------------
// F15 — pane chrome insets. The library mounts the transport bar, the preset's
// total-duration bar and the caption strip OVER the pane, and a fit that centres on the
// whole client box parks the last rank underneath them. paneInsets() measures what is
// actually there; fit() frames and centres inside what is left.
// ---------------------------------------------------------------------------

/** A chrome element as paneInsets() reads it: a class and a client rect, nothing else. */
function chromeEl(cls, { left = 0, top = 0, width = 900, height = 34 }) {
  return {
    getAttribute: (k) => (k === "class" ? cls : null),
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
  };
}
function rootWith(children, w = 900, h = 480) {
  const svg = makeSvgStub(w, h);
  return { root: { children: [svg, ...children] }, svg };
}

test("paneInsets(): measures the chrome the library mounted, per edge, deepest intrusion wins", () => {
  // Exactly the stack styles.js produces with controls + the pipeline preset: a 34px
  // transport on the bottom edge and the total bar stepped up above it.
  const { root, svg } = rootWith([
    chromeEl("smv-transport", { top: 446, height: 34 }),
    chromeEl("smv-totalbar", { top: 424, height: 22 }),
  ]);
  assert.deepEqual(paneInsets(root, svg), { top: 0, right: 0, bottom: 56, left: 0 });
});

test("paneInsets(): a caption is measured on the edge it sits on, gap included", () => {
  const bottom = rootWith([chromeEl("smv-caption", { left: 300, top: 404, width: 300, height: 30 })]);
  assert.deepEqual(paneInsets(bottom.root, bottom.svg), { top: 0, right: 0, bottom: 76, left: 0 });

  const top = rootWith([chromeEl("smv-caption", { left: 300, top: 12, width: 300, height: 30 })]);
  assert.deepEqual(paneInsets(top.root, top.svg), { top: 42, right: 0, bottom: 0, left: 0 });
});

test("paneInsets(): ignores host markup, panels, and a DOM that cannot be measured", () => {
  const { root, svg } = rootWith([
    chromeEl("my-app-legend", { top: 446, height: 34 }),           // not ours
    chromeEl("smv-caption", { top: 0, width: 900, height: 480 }),  // a panel, not a bar
    { getAttribute: () => "smv-transport" },                       // no rect at all
  ]);
  assert.deepEqual(paneInsets(root, svg), { top: 0, right: 0, bottom: 0, left: 0 });

  // The fake-DOM case (every test in this repo): nothing measurable, so nothing changes.
  assert.deepEqual(paneInsets({ children: [] }, {}), { top: 0, right: 0, bottom: 0, left: 0 });
});

test("viewport.fit({inset}): frames and centres inside the pane MINUS the chrome", () => {
  const bounds = { x: 0, y: 0, w: 400, h: 200 };
  const { ticker, vp } = setup();          // 800x600 pane
  vp.fit(bounds, { pad: 0, inset: { bottom: 100 } });
  const t = vp.transform;
  // The usable box is 800x500 sitting at the top of the pane, so the shot centres at
  // y = 250, not 300 — the whole point of F15.
  const k = Math.min(800 / 400, 500 / 200); // = 2, lidded by FIT_MAX_K to 1.5
  assert.equal(t.k, Math.min(k, 1.5));
  assert.equal(t.x, 400 - 200 * t.k);
  assert.equal(t.y, 250 - 100 * t.k);

  // …and with no inset it is the pane centre, exactly as before.
  vp.fit(bounds, { pad: 0 });
  assert.equal(vp.transform.y, 300 - 100 * vp.transform.k);
  ticker.destroy();
});

test("viewport.fit({inset}): a tall inset shrinks the fitted scale, not just the centre", () => {
  const bounds = { x: 0, y: 0, w: 200, h: 400 };
  const { ticker, vp } = setup();
  vp.fit(bounds, { pad: 0, maxK: 4 });
  assert.equal(vp.transform.k, Math.min(800 / 200, 600 / 400)); // 1.5, height-bound
  vp.fit(bounds, { pad: 0, maxK: 4, inset: { top: 100, bottom: 100 } });
  assert.equal(vp.transform.k, 400 / 400, "the usable height is 400px now");
  ticker.destroy();
});
