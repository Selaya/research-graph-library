// Pairwise proper-segment-intersection counter used by the crossing-count
// non-regression assertion (INTERNALS §Tests). Shared segments at a common
// node (e.g. two edges meeting at the same target) are NOT counted: the
// orientation test below only fires on a strict interior crossing.

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function properlyIntersects(a1, a2, b1, b2) {
  const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * The dagre-era crossing counts, measured on the M2 layout (`@dagrejs/dagre` 3.1.1) for
 * each golden fixture just before the M3 solver swap, and reproducible at any time with:
 *
 *   import { dagreLayout } from "../../src/adapters/dagre.js";
 *   countCrossings(Object.values(dagreLayout(fixtureDiamond(), OPTS).edges)
 *     .filter((e) => !e.reversed).map((e) => e.points));
 *
 * These are the M3 non-regression bar (INTERNALS §Gates): the in-house engine must draw
 * each fixture with AT MOST this many crossings. Hard-coded on purpose — the bar must not
 * move when the engine does, and the test must not need dagre installed to run.
 */
export const DAGRE_CROSSINGS = { diamond: 0, loop: 0, selfloop: 0 };

/** Count pairwise crossings between the polylines in `edgePointsList` (points per edge). */
export function countCrossings(edgePointsList) {
  let count = 0;
  for (let i = 0; i < edgePointsList.length; i++) {
    for (let j = i + 1; j < edgePointsList.length; j++) {
      const A = edgePointsList[i], B = edgePointsList[j];
      for (let a = 0; a < A.length - 1; a++) {
        for (let b = 0; b < B.length - 1; b++) {
          if (properlyIntersects(A[a], A[a + 1], B[b], B[b + 1])) count++;
        }
      }
    }
  }
  return count;
}
