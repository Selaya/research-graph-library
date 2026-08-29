// Shared fixtures for the layout golden tests + the update script (test/golden/update.js).
// Explicit w/h on every node keeps sizeNode() out of the loop entirely — determinism (INTERNALS §Tests).

export const NODE_WH = { w: 100, h: 36 };
export const OPTS = { dir: "LR" };

/** (a) 6-node DAG with a diamond: A fans to B/C, both rejoin at D, D fans to E/F. */
export function fixtureDiamond() {
  const nodes = ["A", "B", "C", "D", "E", "F"].map((id) => ({ id, ...NODE_WH }));
  const edges = [
    { id: "eAB", source: "A", target: "B" },
    { id: "eAC", source: "A", target: "C" },
    { id: "eBD", source: "B", target: "D" },
    { id: "eCD", source: "C", target: "D" },
    { id: "eDE", source: "D", target: "E" },
    { id: "eDF", source: "D", target: "F" },
  ];
  return { nodes, edges };
}

/** (b) 10-node chain with one loop:true back edge (N5 -> N2). `extra` appends
 *  unrelated nodes/edges after N10, for the pinning-stability test. */
export function fixtureLoop(extra = 0) {
  const ids = [];
  for (let i = 1; i <= 10; i++) ids.push(`N${i}`);
  for (let i = 1; i <= extra; i++) ids.push(`X${i}`);
  const nodes = ids.map((id) => ({ id, ...NODE_WH }));
  const edges = [];
  for (let i = 1; i < 10; i++) edges.push({ id: `e${i}`, source: `N${i}`, target: `N${i + 1}` });
  edges.push({ id: "eLoop", source: "N5", target: "N2", loop: true, maxIterations: 3 });
  let prev = "N10";
  for (let i = 1; i <= extra; i++) {
    const id = `X${i}`;
    edges.push({ id: `eX${i}`, source: prev, target: id });
    prev = id;
  }
  return { nodes, edges };
}

/** (c) 3-node chain with a self-loop on the middle node. */
export function fixtureSelfLoop() {
  const nodes = ["P", "Q", "R"].map((id) => ({ id, ...NODE_WH }));
  const edges = [
    { id: "ePQ", source: "P", target: "Q" },
    { id: "eQQ", source: "Q", target: "Q" },
    { id: "eQR", source: "Q", target: "R" },
  ];
  return { nodes, edges };
}
