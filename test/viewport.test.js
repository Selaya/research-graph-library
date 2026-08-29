// Regression coverage for src/viewport.js — the anchored-viewport correction (D10).
// DOM needs here are minimal (no pointer/wheel exercised), so a small hand-rolled stub
// stands in for the svg element/viewport group, same spirit as test/integration.test.js's
// fuller DOM shim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicker } from "../src/anim.js";
import { createViewport } from "../src/viewport.js";

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
