// Pure geometry helpers (no DOM) shared by layout.js, scene.js and render.js.
// clipEnds runs per frame during transitions (G7) — keep it cheap and NaN-proof.

/** n points on a cubic Bézier p0-c1-c2-p3, endpoints included. */
export function sampleCubic(p0, c1, c2, p3, n) {
  const pts = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    pts[i] = cubicAt(p0, c1, c2, p3, t);
  }
  return pts;
}

function cubicAt(p0, c1, c2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

/** Dense polyline through `points` via uniform Catmull-Rom (`per` samples/segment).
 *  Fewer than 3 points: straight pass-through (nothing to interpolate). */
export function catmullRom(points, per = 8) {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const at = (i) => points[Math.max(0, Math.min(n - 1, i))];
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const last = i === n - 2;
    const steps = last ? per + 1 : per; // include the final endpoint only once
    for (let s = 0; s < steps; s++) out.push(crAt(p0, p1, p2, p3, s / per));
  }
  return out;
}

function crAt(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

export function arcLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

/** Exactly n points uniformly spaced by arc length. Endpoints preserved.
 *  Zero-length (or single-point) input repeats the point rather than dividing by zero. */
export function resample(points, n = 24) {
  if (!points || points.length === 0) return new Array(Math.max(0, n)).fill(0).map(() => ({ x: 0, y: 0 }));
  if (n <= 0) return [];
  if (points.length === 1) {
    const p = points[0];
    return new Array(n).fill(0).map(() => ({ x: p.x, y: p.y }));
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = cum[cum.length - 1];
  if (total === 0) {
    const p = points[0];
    return new Array(n).fill(0).map(() => ({ x: p.x, y: p.y }));
  }
  const out = new Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = n === 1 ? 0 : (i / (n - 1)) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    const a = points[seg], b = points[seg + 1];
    out[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  out[0] = { x: points[0].x, y: points[0].y };
  out[n - 1] = { x: points[points.length - 1].x, y: points[points.length - 1].y };
  return out;
}

/** Pointwise lerp of two equal-length point arrays. */
export function lerpPoints(a, b, t) {
  const n = Math.min(a.length, b.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { x: a[i].x + (b[i].x - a[i].x) * t, y: a[i].y + (b[i].y - a[i].y) * t };
  return out;
}

/** Position + local direction at normalized arc-length position t in [0,1]. */
export function pointAt(points, t) {
  if (!points || points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y, angle: 0 };
  const total = arcLength(points);
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const isLast = i === points.length - 1;
    if (acc + segLen >= target || isLast) {
      const segT = segLen > 0 ? Math.min(1, Math.max(0, (target - acc) / segLen)) : 0;
      return { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    acc += segLen;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

/** "M x y L x y ..." with coordinates rounded to 2 decimals. */
export function pathString(points) {
  if (!points || points.length === 0) return "";
  const r = (n) => Math.round(n * 100) / 100;
  let s = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 1; i < points.length; i++) s += ` L ${r(points[i].x)} ${r(points[i].y)}`;
  return s;
}

function halfExtents(rect) {
  return { x0: rect.x - rect.w / 2, x1: rect.x + rect.w / 2, y0: rect.y - rect.h / 2, y1: rect.y + rect.h / 2 };
}

function inRect(pt, rect) {
  const h = halfExtents(rect);
  return pt.x >= h.x0 && pt.x <= h.x1 && pt.y >= h.y0 && pt.y <= h.y1;
}

/** Point where the ray from `p1` (assumed inside `rect`) toward `p2` crosses the border. */
function exitPoint(p1, p2, rect) {
  const h = halfExtents(rect);
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  let tx = Infinity, ty = Infinity;
  if (dx > 1e-9) tx = (h.x1 - p1.x) / dx;
  else if (dx < -1e-9) tx = (h.x0 - p1.x) / dx;
  if (dy > 1e-9) ty = (h.y1 - p1.y) / dy;
  else if (dy < -1e-9) ty = (h.y0 - p1.y) / dy;
  let t = Math.min(tx, ty);
  if (!Number.isFinite(t) || t < 0) t = 0;
  t = Math.min(t, 1);
  return { x: p1.x + dx * t, y: p1.y + dy * t };
}

const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);

/** Trim `points` so it starts on `srcRect`'s border and ends on `tgtRect`'s border
 *  (corner radius `r` ignored — plain-rect intersection). Overlapping rects or a
 *  fully-consumed polyline degrade to a short segment, never NaN (G7: runs per frame). */
export function clipEnds(points, srcRect, tgtRect) {
  if (!points || points.length === 0) {
    const a = { x: finite(srcRect?.x), y: finite(srcRect?.y) };
    const b = { x: finite(tgtRect?.x), y: finite(tgtRect?.y) };
    const angle = finite(Math.atan2(b.y - a.y, b.x - a.x));
    return { points: [a, b], arrow: { x: b.x, y: b.y, angle } };
  }
  if (points.length === 1) {
    const p = { x: finite(points[0].x), y: finite(points[0].y) };
    return { points: [p, p], arrow: { x: p.x, y: p.y, angle: 0 } };
  }

  const pts = points;
  const n = pts.length;

  let startIdx = 0;
  let startPt = pts[0];
  if (srcRect && inRect(pts[0], srcRect)) {
    let found = false;
    for (let i = 1; i < n; i++) {
      if (!inRect(pts[i], srcRect)) {
        startPt = exitPoint(pts[i - 1], pts[i], srcRect);
        startIdx = i - 1;
        found = true;
        break;
      }
    }
    if (!found) { startIdx = n - 1; startPt = pts[n - 1]; } // whole path inside src
  }

  let endIdx = n - 1;
  let endPt = pts[n - 1];
  if (tgtRect && inRect(pts[n - 1], tgtRect)) {
    let found = false;
    for (let i = n - 2; i >= 0; i--) {
      if (!inRect(pts[i], tgtRect)) {
        endPt = exitPoint(pts[i + 1], pts[i], tgtRect);
        endIdx = i + 1;
        found = true;
        break;
      }
    }
    if (!found) { endIdx = 0; endPt = pts[0]; } // whole path inside tgt
  }

  let out;
  if (startIdx < endIdx) out = [startPt, ...pts.slice(startIdx + 1, endIdx), endPt];
  else out = [startPt, endPt]; // rects overlap / path fully consumed — degenerate segment

  out = out.map((p) => ({ x: finite(p.x), y: finite(p.y) }));
  const last = out[out.length - 1], prev = out[out.length - 2];
  const angle = finite(Math.atan2(last.y - prev.y, last.x - prev.x));

  return { points: out, arrow: { x: last.x, y: last.y, angle } };
}
