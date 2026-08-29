// Regenerates test/golden/*.json from the current layout() output.
// Run explicitly: `node test/golden/update.js` — only when a layout change is intended
// (INTERNALS §Tests). Never run automatically from the test suite.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { layout } from "../../src/layout.js";
import { fixtureDiamond, fixtureLoop, fixtureSelfLoop, OPTS } from "./fixtures.js";
import { countCrossings } from "./crossing.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function toGolden(result, extra = {}) {
  return {
    nodes: result.nodes,
    edges: result.edges,
    bounds: result.bounds,
    reversedEdgeIds: [...result.reversedEdgeIds].sort(),
    ...extra,
  };
}

function write(name, golden) {
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(golden, null, 2) + "\n");
  console.log(`wrote test/golden/${name}.json`);
}

const rDiamond = layout(fixtureDiamond(), OPTS);
const fwd = Object.values(rDiamond.edges).filter((e) => !e.reversed).map((e) => e.points);
write("diamond", toGolden(rDiamond, { crossings: countCrossings(fwd) }));

const rLoop = layout(fixtureLoop(), OPTS);
write("loop", toGolden(rLoop));

const rSelfLoop = layout(fixtureSelfLoop(), OPTS);
write("selfloop", toGolden(rSelfLoop));
