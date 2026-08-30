// M4 viewport surface — moveTo (D9 cancel-and-retarget with settled promises), the
// opts-form fit() with its maxK escape hatch, setInteractive, size() and the target
// getter. Same stub + manual-ticker idiom as test/viewport.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicker, EASE } from "../src/anim.js";
import { createViewport, FIT_MAX_K, MAX_K } from "../src/viewport.js";

function makeSvgStub(w = 800, h = 600) {
  const listeners = {};
  return {
    listeners,
    getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
    clientWidth: w, clientHeight: h,
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    classList: { add() {}, remove() {} },
    setPointerCapture() {}, releasePointerCapture() {},
  };
}

function setup() {
  const ticker = createTicker({ manual: true });
  const svg = makeSvgStub();
  const vp = createViewport(svg, { setAttribute() {} }, ticker);
  return { ticker, svg, vp };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const track = (p) => { const out = { value: null }; p.then((v) => { out.value = v; }); return out; };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);

test("moveTo(): the tween rides the manual clock, uses ITS ease, and settles at the declared duration", async () => {
  const { ticker, vp } = setup();
  const m = vp.moveTo({ x: 100, y: 50, k: 2 }, { duration: 300, ease: EASE.linear });
  const r = track(m.promise);

  ticker.tick(150);
  await flush();
  // Exactly halfway under linear — the hardcoded cubicOut this replaces would be at 0.875.
  close(vp.transform.x, 50, "mid x");
  close(vp.transform.y, 25, "mid y");
  close(vp.transform.k, 1.5, "mid k");
  assert.equal(r.value, null, "still in flight at t=150");

  ticker.tick(149);
  await flush();
  assert.equal(r.value, null, "still in flight at t=299");

  ticker.tick(1);
  await flush();
  assert.deepEqual(r.value, { canceled: false }, "settled exactly at the declared 300ms");
  assert.deepEqual(vp.transform, { x: 100, y: 50, k: 2 });
  ticker.destroy();
});

test("moveTo() with no duration lands immediately and resolves {canceled:false}", async () => {
  const { ticker, vp } = setup();
  const m = vp.moveTo({ x: 30, y: -10, k: 1.2 });
  assert.deepEqual(vp.transform, { x: 30, y: -10, k: 1.2 }, "written synchronously");
  assert.deepEqual(await m.promise, { canceled: false });
  ticker.destroy();
});

test("D9: a second moveTo mid-tween cancels the first, resolving ITS promise {canceled:true}", async () => {
  const { ticker, vp } = setup();
  const m1 = vp.moveTo({ x: 100, y: 0, k: 1 }, { duration: 300, ease: EASE.linear });
  const r1 = track(m1.promise);
  ticker.tick(100);
  await flush();
  assert.equal(r1.value, null);

  const m2 = vp.moveTo({ x: 0, y: 200, k: 2 }, { duration: 200, ease: EASE.linear });
  const r2 = track(m2.promise);
  await flush();
  assert.deepEqual(r1.value, { canceled: true }, "the retargeted move answered its awaiter");
  assert.equal(r2.value, null, "the new move is live");

  ticker.tick(200);
  await flush();
  assert.deepEqual(r2.value, { canceled: false });
  assert.deepEqual(vp.transform, { x: 0, y: 200, k: 2 }, "the NEW target won");
  ticker.destroy();
});

test("moveTo().cancel() stops its own tween — and a stale cancel cannot kill a later move", async () => {
  const { ticker, vp } = setup();
  const m1 = vp.moveTo({ x: 100, y: 0, k: 1 }, { duration: 300, ease: EASE.linear });
  const r1 = track(m1.promise);
  ticker.tick(150);
  m1.cancel();
  await flush();
  assert.deepEqual(r1.value, { canceled: true });
  close(vp.transform.x, 50, "cancel freezes the transform mid-flight");

  const m2 = vp.moveTo({ x: 0, y: 0, k: 2 }, { duration: 100, ease: EASE.linear });
  const r2 = track(m2.promise);
  m1.cancel(); // stale handle from the dead move
  ticker.tick(100);
  await flush();
  assert.deepEqual(r2.value, { canceled: false }, "the stale cancel was a no-op");
  ticker.destroy();
});

test("target getter reports where a live tween is HEADING; transform reports where it is", () => {
  const { ticker, vp } = setup();
  vp.moveTo({ x: 100, y: 40, k: 2 }, { duration: 400, ease: EASE.linear });
  ticker.tick(100);
  assert.deepEqual(vp.target, { x: 100, y: 40, k: 2 });
  close(vp.transform.x, 25, "state is mid-tween");
  ticker.tick(1000);
  assert.deepEqual(vp.target, vp.transform, "settled: target and state agree");
  ticker.destroy();
});

test("fit(): the M0 3-arg spelling still works and equals the opts form", async () => {
  const bounds = { x: 0, y: 0, w: 4000, h: 3000 };

  // fit(bounds, pad, animate:false) is instant.
  const a = setup();
  a.vp.fit(bounds, 24, false);
  assert.deepEqual(a.vp.transform, a.vp.target, "no tween pending");
  const landed = a.vp.transform;
  assert.notEqual(landed.k, 1, "the fit changed the scale");

  // The opts form with duration:0 and the same pad lands identically.
  const b = setup();
  b.vp.fit(bounds, { pad: 24, duration: 0 });
  assert.deepEqual(b.vp.transform, landed);

  // fit(bounds, pad, animate:true) runs the legacy 350ms tween.
  const c = setup();
  const r = track(c.vp.fit(bounds, 24, true));
  c.ticker.tick(349);
  await flush();
  assert.equal(r.value, null, "still animating at 349ms");
  c.ticker.tick(1);
  await flush();
  assert.deepEqual(r.value, { canceled: false }, "the legacy spelling is a 350ms move");
  // The tween lands via from + (to-from)*e(1), so compare within float noise.
  close(c.vp.transform.x, landed.x, "tweened fit x");
  close(c.vp.transform.y, landed.y, "tweened fit y");
  close(c.vp.transform.k, landed.k, "tweened fit k");

  a.ticker.destroy(); b.ticker.destroy(); c.ticker.destroy();
});

test("fit(): FIT_MAX_K lids the auto-fit, and opts.maxK raises the lid for a node framing", () => {
  const tiny = { x: 0, y: 0, w: 10, h: 10 }; // raw fit k would be 55.2
  const a = setup();
  a.vp.fit(tiny);
  close(a.vp.transform.k, FIT_MAX_K, "default lid holds a tiny graph at 1.5");

  const b = setup();
  b.vp.fit(tiny, { maxK: MAX_K });
  close(b.vp.transform.k, MAX_K, "maxK:4 zooms past the auto-fit lid");
  assert.ok(b.vp.transform.k > FIT_MAX_K);

  a.ticker.destroy(); b.ticker.destroy();
});

test("setInteractive() detaches and re-attaches the pointer/wheel listeners exactly once", () => {
  const { ticker, svg, vp } = setup();
  const count = (t) => (svg.listeners[t] || []).length;
  for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"]) {
    assert.equal(count(t), 1, `${t} attached on create`);
  }
  vp.setInteractive(true); // idempotent: never double-binds
  assert.equal(count("pointerdown"), 1);

  vp.setInteractive(false);
  for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"]) {
    assert.equal(count(t), 0, `${t} detached`);
  }
  vp.setInteractive(true);
  assert.equal(count("wheel"), 1, "re-attached");

  vp.destroy();
  assert.equal(count("pointerdown"), 0, "destroy() leaves nothing bound");
  ticker.destroy();
});

test("size() reports the svg's client box", () => {
  const { ticker, vp } = setup();
  assert.deepEqual(vp.size(), { w: 800, h: 600 });
  ticker.destroy();
});

test("tearing down the shared clock settles a live tween {canceled:true} instead of stranding it", async () => {
  const { ticker, vp } = setup();
  const r = track(vp.moveTo({ x: 100, y: 0, k: 1 }, { duration: 1000 }).promise);
  ticker.tick(50);
  await flush();
  assert.equal(r.value, null);
  ticker.destroy();
  await flush();
  assert.deepEqual(r.value, { canceled: true }, "g.ticker is public — destroy() must answer the awaiter");
});
