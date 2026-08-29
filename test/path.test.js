import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sampleCubic, catmullRom, resample, lerpPoints, arcLength, pointAt, pathString, clipEnds,
} from "../src/path.js";

test("sampleCubic includes exact endpoints and requested count", () => {
  const p0 = { x: 0, y: 0 }, c1 = { x: 0, y: 10 }, c2 = { x: 10, y: 10 }, p3 = { x: 10, y: 0 };
  const pts = sampleCubic(p0, c1, c2, p3, 16);
  assert.equal(pts.length, 16);
  assert.deepEqual(pts[0], p0);
  assert.equal(Math.abs(pts[15].x - p3.x) < 1e-9, true);
  assert.equal(Math.abs(pts[15].y - p3.y) < 1e-9, true);
});

test("catmullRom passes straight through fewer than 3 points", () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  assert.deepEqual(catmullRom(pts), pts);
  assert.deepEqual(catmullRom([{ x: 1, y: 1 }]), [{ x: 1, y: 1 }]);
});

test("catmullRom threads through every input point and stays dense", () => {
  const input = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }];
  const out = catmullRom(input, 8);
  assert.ok(out.length > input.length);
  // endpoints preserved exactly (t=0 of first / last segment)
  assert.deepEqual(out[0], input[0]);
  assert.deepEqual(out[out.length - 1], input[input.length - 1]);
});

test("arcLength sums segment lengths", () => {
  const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 8 }];
  assert.equal(arcLength(pts), 5 + 4);
});

test("resample produces n points uniformly spaced by arc length", () => {
  // colinear points with very uneven original segment lengths — since every point
  // sits on one line, arc length and Euclidean distance between resampled points
  // coincide exactly, so this isolates the arc-length parametrization itself
  // (a resampled step straddling a genuine corner would foreshorten in a straight-
  // line distance check even though the arc-length spacing is correct).
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 101, y: 0 }];
  const n = 24;
  const out = resample(pts, n);
  assert.equal(out.length, n);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
  const step = arcLength(pts) / (n - 1);
  const dists = [];
  for (let i = 1; i < out.length; i++) dists.push(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
  for (const d of dists) assert.ok(Math.abs(d - step) < 1e-6, `expected ~${step}, got ${d}`);
});

test("resample places each point at the correct cumulative arc length, corners included", () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 100 }]; // L-shaped, uneven legs
  const n = 24;
  const out = resample(pts, n);
  const total = arcLength(pts);
  const step = total / (n - 1);
  // reconstruct each resampled point's arc-length position by walking the ORIGINAL
  // polyline and finding where it lands, then compare to the expected i*step.
  const cum = [0, 1, 101];
  for (let i = 0; i < n; i++) {
    const target = i * step;
    let seg = target <= cum[1] ? 0 : 1;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    const a = pts[seg], b = pts[seg + 1];
    const expected = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    assert.ok(Math.abs(out[i].x - expected.x) < 1e-6, `x mismatch at ${i}`);
    assert.ok(Math.abs(out[i].y - expected.y) < 1e-6, `y mismatch at ${i}`);
  }
});

test("resample handles zero-length input without NaN", () => {
  const pts = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
  const out = resample(pts, 8);
  assert.equal(out.length, 8);
  for (const p of out) {
    assert.equal(p.x, 5);
    assert.equal(p.y, 5);
  }
});

test("resample handles a single input point", () => {
  const out = resample([{ x: 2, y: 3 }], 5);
  assert.equal(out.length, 5);
  for (const p of out) assert.deepEqual(p, { x: 2, y: 3 });
});

test("lerpPoints returns endpoints at t=0 and t=1, midpoint at t=0.5", () => {
  const a = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  const b = [{ x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.deepEqual(lerpPoints(a, b, 0), a);
  assert.deepEqual(lerpPoints(a, b, 1), b);
  assert.deepEqual(lerpPoints(a, b, 0.5), [{ x: 5, y: 0 }, { x: 15, y: 5 }]);
});

test("pointAt reports position and local direction on a right-angle polyline", () => {
  // (0,0) -> (10,0) -> (10,10): two 10-length legs, total length 20.
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const start = pointAt(pts, 0);
  assert.deepEqual({ x: start.x, y: start.y }, { x: 0, y: 0 });
  assert.ok(Math.abs(start.angle - 0) < 1e-9);

  const quarter = pointAt(pts, 0.25); // halfway along first leg
  assert.ok(Math.abs(quarter.x - 5) < 1e-9 && Math.abs(quarter.y - 0) < 1e-9);
  assert.ok(Math.abs(quarter.angle - 0) < 1e-9);

  const threeQuarter = pointAt(pts, 0.75); // halfway along second leg
  assert.ok(Math.abs(threeQuarter.x - 10) < 1e-9 && Math.abs(threeQuarter.y - 5) < 1e-9);
  assert.ok(Math.abs(threeQuarter.angle - Math.PI / 2) < 1e-9);

  const end = pointAt(pts, 1);
  assert.deepEqual({ x: end.x, y: end.y }, { x: 10, y: 10 });
});

test("pointAt never returns NaN on a zero-length path", () => {
  const p = pointAt([{ x: 1, y: 1 }, { x: 1, y: 1 }], 0.5);
  assert.equal(Number.isFinite(p.x), true);
  assert.equal(Number.isFinite(p.y), true);
  assert.equal(Number.isFinite(p.angle), true);
});

test("pathString rounds to 2 decimals and joins with L", () => {
  const s = pathString([{ x: 0, y: 0 }, { x: 1.23456, y: -2.0001 }]);
  assert.equal(s, "M 0 0 L 1.23 -2");
});

test("pathString on empty input is empty string", () => {
  assert.equal(pathString([]), "");
});

test("clipEnds trims a straight edge onto both rect borders", () => {
  const src = { x: 0, y: 0, w: 40, h: 20, r: 4 };
  const tgt = { x: 200, y: 0, w: 40, h: 20, r: 4 };
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  const { points, arrow } = clipEnds(pts, src, tgt);
  assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(points[0].x, 20); // src right border
  assert.equal(points[0].y, 0);
  assert.equal(points[points.length - 1].x, 180); // tgt left border
  assert.equal(points[points.length - 1].y, 0);
  assert.equal(arrow.x, 180);
  assert.ok(Number.isFinite(arrow.angle));
});

test("clipEnds degrades to a short segment on overlapping rects instead of NaN", () => {
  const src = { x: 0, y: 0, w: 100, h: 100, r: 0 };
  const tgt = { x: 10, y: 0, w: 100, h: 100, r: 0 };
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const { points, arrow } = clipEnds(pts, src, tgt);
  for (const p of points) {
    assert.equal(Number.isFinite(p.x), true);
    assert.equal(Number.isFinite(p.y), true);
  }
  assert.equal(Number.isFinite(arrow.x), true);
  assert.equal(Number.isFinite(arrow.y), true);
  assert.equal(Number.isFinite(arrow.angle), true);
});

test("clipEnds handles a zero-length path without NaN", () => {
  const src = { x: 0, y: 0, w: 40, h: 20 };
  const tgt = { x: 40, y: 0, w: 40, h: 20 };
  const { points, arrow } = clipEnds([], src, tgt);
  assert.equal(points.length, 2);
  for (const p of points) {
    assert.equal(Number.isFinite(p.x), true);
    assert.equal(Number.isFinite(p.y), true);
  }
  assert.equal(Number.isFinite(arrow.angle), true);
});
