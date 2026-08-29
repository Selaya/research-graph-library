// Regenerates test/golden/*.json from the current layout() output.
// Run explicitly: `node test/golden/update.js` — only when a layout change is intended
// (INTERNALS §Tests). Never run automatically from the test suite.
//
// M3: the goldens were regenerated once when layout.js swapped dagre for the in-house
// engine (src/engine.js). Coordinates AND point counts differ from the dagre era by
// design — an adjacent-rank edge is now 2 points, dagre always emitted 3 because it
// doubles ranks to make room for edge labels. The gate that survives the swap is the
// crossing non-regression against DAGRE_CROSSINGS, not coordinate identity
// (docs/DEVIATIONS.md §parity).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { layout } from "../../src/layout.js";
import { fixtureDiamond, fixtureLoop, fixtureSelfLoop, OPTS } from "./fixtures.js";
import { countCrossings, DAGRE_CROSSINGS } from "./crossing.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function toGolden(result) {
  const forward = Object.values(result.edges).filter((e) => !e.reversed).map((e) => e.points);
  return {
    nodes: result.nodes,
    edges: result.edges,
    bounds: result.bounds,
    reversedEdgeIds: [...result.reversedEdgeIds].sort(),
    order: result.order,
    crossings: countCrossings(forward),
  };
}

function write(name, view) {
  const golden = toGolden(layout(view, OPTS));
  const bar = DAGRE_CROSSINGS[name];
  if (bar !== undefined && golden.crossings > bar) {
    console.error(
      `refusing to write ${name}.json: ${golden.crossings} crossings exceeds the ` +
        `dagre-era bar of ${bar} (INTERNALS §Gates — fix the engine, not the bar).`
    );
    process.exit(1);
  }
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(golden, null, 2) + "\n");
  console.log(`wrote test/golden/${name}.json (crossings ${golden.crossings}, bar ${bar})`);
}

write("diamond", fixtureDiamond());
write("loop", fixtureLoop());
write("selfloop", fixtureSelfLoop());
