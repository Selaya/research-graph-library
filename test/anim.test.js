import { test } from "node:test";
import assert from "node:assert/strict";
import { EASE, createTicker, prefersReducedMotion } from "../src/anim.js";

test("EASE functions map 0->0 and 1->1 (except overshoot's designed excursion)", () => {
  for (const name of ["linear", "cubicOut", "cubicInOut"]) {
    assert.ok(Math.abs(EASE[name](0) - 0) < 1e-9, name);
    assert.ok(Math.abs(EASE[name](1) - 1) < 1e-9, name);
  }
  assert.ok(Math.abs(EASE.overshoot(0) - 0) < 1e-9);
  assert.ok(Math.abs(EASE.overshoot(1) - 1) < 1e-9);
});

test("EASE.cubicOut front-loads motion (t' > t before the end)", () => {
  assert.ok(EASE.cubicOut(0.25) > 0.25);
});

test("EASE.overshoot exceeds 1 partway through (back-out excursion)", () => {
  let max = 0;
  for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, EASE.overshoot(t));
  assert.ok(max > 1, `expected an overshoot excursion, got max=${max}`);
});

test("createTicker manual mode: tick() advances now() and drives callbacks", () => {
  const ticker = createTicker({ manual: true });
  const seen = [];
  ticker.add((t) => seen.push(t));
  assert.equal(ticker.now(), 0);
  ticker.tick(16);
  assert.equal(ticker.now(), 16);
  ticker.tick(16);
  assert.equal(ticker.now(), 32);
  assert.deepEqual(seen, [16, 32]);
  ticker.destroy();
});

test("createTicker manual mode: remove() stops a callback from firing", () => {
  const ticker = createTicker({ manual: true });
  let count = 0;
  const fn = () => count++;
  ticker.add(fn);
  ticker.tick(10);
  ticker.remove(fn);
  ticker.tick(10);
  assert.equal(count, 1);
  ticker.destroy();
});

test("createTicker: now() works under Node without a rAF/WAAPI environment", () => {
  const ticker = createTicker();
  assert.equal(typeof ticker.now(), "number");
  assert.ok(Number.isFinite(ticker.now()));
  // add()/remove() must not throw even with no requestAnimationFrame global.
  const fn = () => {};
  ticker.add(fn);
  ticker.remove(fn);
  ticker.destroy();
});

test("createTicker: multiple callbacks all receive the same tick", () => {
  const ticker = createTicker({ manual: true });
  const a = [], b = [];
  ticker.add((t) => a.push(t));
  ticker.add((t) => b.push(t));
  ticker.tick(5);
  assert.deepEqual(a, [5]);
  assert.deepEqual(b, [5]);
  ticker.destroy();
});

test("destroy() settles onDestroy waiters — nothing suspended on the clock is stranded", () => {
  const ticker = createTicker({ manual: true });
  let fired = 0;
  ticker.onDestroy(() => fired++);
  const off = ticker.onDestroy(() => fired++);
  off();                       // an already-completed waiter unsubscribes
  assert.equal(fired, 0, "not called before teardown");
  ticker.destroy();
  assert.equal(fired, 1, "the live waiter is notified exactly once");
  ticker.destroy();            // idempotent
  assert.equal(fired, 1);
});

test("onDestroy on an already-destroyed ticker fires immediately", () => {
  const ticker = createTicker({ manual: true });
  ticker.destroy();
  let fired = 0;
  ticker.onDestroy(() => fired++);
  assert.equal(fired, 1, "a late registration cannot wait for a teardown that already happened");
});

test("prefersReducedMotion is false under Node (no window)", () => {
  assert.equal(prefersReducedMotion(), false);
});
