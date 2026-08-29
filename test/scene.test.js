import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicker, EASE } from "../src/anim.js";
import { createScene, EDGE_POINTS } from "../src/scene.js";

const N = (x, y = 0, w = 20, h = 20) => ({ x, y, w, h });
const nodesOnly = (nodes) => ({ nodes, edges: {} });

/** Land a node in `visual` at its target, fully opaque, with no tween in flight. */
function seed(scene, ticker, target) {
  scene.commit(target, { duration: 0 });
  ticker.tick(1);
}

function setup() {
  const ticker = createTicker({ manual: true });
  return { ticker, scene: createScene(ticker) };
}

test("commit tweens x from A to B and settles exactly on target", () => {
  const { ticker, scene } = setup();
  seed(scene, ticker, nodesOnly({ a: N(0) }));
  assert.deepEqual(
    { x: scene.visual.nodes.get("a").x, o: scene.visual.nodes.get("a").opacity },
    { x: 0, o: 1 }
  );

  scene.commit(nodesOnly({ a: N(100) }), { duration: 100, easing: EASE.linear });
  ticker.tick(25);
  assert.equal(scene.visual.nodes.get("a").x, 25);
  ticker.tick(25);
  assert.equal(scene.visual.nodes.get("a").x, 50);
  ticker.tick(50);
  assert.equal(scene.visual.nodes.get("a").x, 100);
  ticker.destroy();
});

test("interruption at t=0.5 retargets from the interpolated position — no jump (D9)", async () => {
  const { ticker, scene } = setup();
  seed(scene, ticker, nodesOnly({ a: N(0) }));

  const first = scene.commit(nodesOnly({ a: N(100) }), { duration: 100, easing: EASE.linear });
  ticker.tick(50);
  const mid = scene.visual.nodes.get("a").x;
  assert.equal(mid, 50, "linear ease is halfway at t=0.5");

  const second = scene.commit(nodesOnly({ a: N(0) }), { duration: 100, easing: EASE.linear });
  // The commit itself must not move anything: the sampled state IS the new "from".
  assert.equal(scene.visual.nodes.get("a").x, mid, "no jump on interruption");

  assert.deepEqual(await first.promise, { canceled: true });

  ticker.tick(10);
  const after = scene.visual.nodes.get("a").x;
  assert.ok(after < mid && after > mid - 10, `expected a small step back from ${mid}, got ${after}`);
  assert.equal(after, 45, "new tween runs from the sampled 50 toward 0");

  ticker.tick(90);
  assert.equal(scene.visual.nodes.get("a").x, 0);
  assert.deepEqual(await second.promise, { canceled: false });
  ticker.destroy();
});

test("interruption never lets two transitions write one element", () => {
  const { ticker, scene } = setup();
  seed(scene, ticker, nodesOnly({ a: N(0) }));
  scene.commit(nodesOnly({ a: N(100) }), { duration: 100, easing: EASE.linear });
  ticker.tick(50);
  scene.commit(nodesOnly({ a: N(200) }), { duration: 100, easing: EASE.linear });
  ticker.tick(100); // if the first tween were still live it would also be writing `a`
  assert.equal(scene.visual.nodes.get("a").x, 200);
  ticker.destroy();
});

test("exit fades out, then removes from visual", async () => {
  const { ticker, scene } = setup();
  seed(scene, ticker, nodesOnly({ a: N(0), b: N(60) }));

  const tr = scene.commit(nodesOnly({ a: N(0) }), { duration: 100, easing: EASE.linear });
  assert.ok(scene.visual.nodes.has("b"), "still present while fading");
  ticker.tick(50);
  const o = scene.visual.nodes.get("b").opacity;
  assert.ok(o > 0 && o < 1, `mid-fade opacity, got ${o}`);
  ticker.tick(50);
  assert.equal(scene.visual.nodes.has("b"), false, "removed once the fade completes");
  assert.deepEqual(await tr.promise, { canceled: false });
  ticker.destroy();
});

test("enter honors enterFrom and grows from 60% at opacity 0", () => {
  const { ticker, scene } = setup();
  seed(scene, ticker, nodesOnly({ a: N(0) }));

  scene.commit(nodesOnly({ a: N(0), b: N(100, 40, 50, 30) }), {
    duration: 100, easing: EASE.linear, enterFrom: { b: { x: -20, y: -10 } },
  });
  const b0 = scene.visual.nodes.get("b");
  assert.deepEqual({ x: b0.x, y: b0.y, opacity: b0.opacity }, { x: -20, y: -10, opacity: 0 });
  assert.equal(b0.w, 50 * 0.6);
  assert.equal(b0.h, 30 * 0.6);

  ticker.tick(100);
  const b1 = scene.visual.nodes.get("b");
  assert.deepEqual({ x: b1.x, y: b1.y, w: b1.w, h: b1.h, opacity: b1.opacity }, { x: 100, y: 40, w: 50, h: 30, opacity: 1 });
  ticker.destroy();
});

test("enter without enterFrom starts at the target position", () => {
  const { ticker, scene } = setup();
  scene.commit(nodesOnly({ a: N(7, 9) }), { duration: 100 });
  const a = scene.visual.nodes.get("a");
  assert.deepEqual({ x: a.x, y: a.y, opacity: a.opacity }, { x: 7, y: 9, opacity: 0 });
  ticker.destroy();
});

test("edges are carried as fixed-length geometry and lerp between differing bend counts", () => {
  const { ticker, scene } = setup();
  const target1 = {
    nodes: { a: N(0), b: N(100) },
    edges: { e1: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } },
  };
  seed(scene, ticker, target1);
  assert.equal(scene.visual.edges.get("e1").points.length, EDGE_POINTS);

  // Same edge, five bend points instead of two — pointwise lerp must still work.
  scene.commit({
    nodes: { a: N(0), b: N(100) },
    edges: { e1: { points: [{ x: 0, y: 0 }, { x: 25, y: 40 }, { x: 50, y: 40 }, { x: 75, y: 40 }, { x: 100, y: 0 }], reversed: true } },
  }, { duration: 100, easing: EASE.linear });

  assert.equal(scene.visual.edges.get("e1").reversed, true, "reversed lands at commit time");
  ticker.tick(50);
  const mid = scene.visual.edges.get("e1").points;
  assert.equal(mid.length, EDGE_POINTS);
  assert.ok(mid.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(Math.max(...mid.map((p) => p.y)) > 0, "bowed partway toward the new arc");
  ticker.tick(50);
  assert.ok(Math.max(...scene.visual.edges.get("e1").points.map((p) => p.y)) > 20, "settles on the new arc");
  ticker.destroy();
});

test("zero-duration commits complete on the next tick, never synchronously", async () => {
  const { ticker, scene } = setup();
  let settled = false;
  const tr = scene.commit(nodesOnly({ a: N(5) }), { duration: 0 });
  tr.promise.then(() => { settled = true; });
  assert.equal(tr.done, false, "not finished inside commit()");
  assert.equal(scene.visual.nodes.get("a").opacity, 0);
  ticker.tick(1);
  await tr.promise;
  assert.equal(settled, true);
  assert.equal(scene.visual.nodes.get("a").opacity, 1);
  ticker.destroy();
});

test("onFrame fires once per commit and once per interpolation step", () => {
  const { ticker, scene } = setup();
  let frames = 0;
  const off = scene.onFrame(() => frames++);
  scene.commit(nodesOnly({ a: N(0) }), { duration: 100 });
  assert.equal(frames, 1, "one frame at commit time");
  ticker.tick(50);
  assert.equal(frames, 2);
  ticker.tick(50);
  assert.equal(frames, 3);
  ticker.tick(50); // transition is over; the scene is off the ticker
  assert.equal(frames, 3);
  off();
  ticker.destroy();
});

test("holdOpacity keeps an element's opacity untouched", () => {
  const { ticker, scene } = setup();
  scene.commit(nodesOnly({ a: N(0) }), { duration: 100, holdOpacity: new Set(["a"]) });
  assert.equal(scene.visual.nodes.get("a").opacity, 1, "enters already opaque");
  ticker.destroy();
});

test("cancel() resolves the transition as canceled and leaves visual state put", async () => {
  const { ticker, scene } = setup();
  seed(scene, ticker, nodesOnly({ a: N(0) }));
  const tr = scene.commit(nodesOnly({ a: N(100) }), { duration: 100, easing: EASE.linear });
  ticker.tick(40);
  tr.cancel();
  assert.deepEqual(await tr.promise, { canceled: true });
  assert.equal(scene.visual.nodes.get("a").x, 40);
  ticker.tick(1000);
  assert.equal(scene.visual.nodes.get("a").x, 40, "nothing keeps writing after cancel");
  ticker.destroy();
});
