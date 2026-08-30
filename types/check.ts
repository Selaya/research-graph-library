// Compile-only usage sample exercising the public surface pinned by index.d.ts/export.d.ts/
// a11y-table.d.ts. `npm run types` = `tsc -p types` — this file passing with zero errors
// (plus the deliberate @ts-expect-error lines actually erroring) IS the test.

import {
  mount,
  version,
  presetPipeline,
  type Graph,
  type GraphSpec,
  type MountOpts,
  type NodeSpec,
  type EdgeSpec,
  type Awaitable,
  type SmvErrorLike,
  type SimRun,
  type LiveRun,
  type Run,
  type StoryboardStep,
  type Timeline,
  type CameraTarget,
  type HighlightSelection,
  type Cue,
  type LayoutResult,
  type LayoutSolver,
  type SolverInput,
  type SolverResult,
} from "./index.js";

import { exportSVG, exportPNG } from "./export.js";
import { attachA11yTable, computeRows } from "./a11y-table.js";
import { dagreSolver, dagreLayout } from "./adapters-dagre.js";

const spec: GraphSpec = {
  nodes: [
    { id: "ingest", label: "Ingest", data: { duration: "45m" } },
    { id: "clean", label: "Clean data", collapsed: true, durationAgg: "sum" },
    { id: "clean.dedupe", parent: "clean", label: "Dedupe" },
    { id: "build", label: "Build", join: "all" },
    { id: "deploy", label: "Deploy" },
  ],
  edges: [
    { id: "e1", source: "ingest", target: "clean" },
    { id: "e2", source: "clean", target: "build" },
    { id: "e3", source: "build", target: "deploy" },
    { id: "retry", source: "deploy", target: "build", loop: true, maxIterations: 5 },
  ],
};

const opts: MountOpts = {
  theme: "auto",
  layout: { dir: "LR", nodesep: 24 },
  animation: { duration: 350, easing: "cubic-out" },
  controls: true,
  preset: "pipeline",
  a11y: true,
};

const g: Graph = mount("#pipe", spec, opts);

const v: string = version;
const presetHandle = presetPipeline(g);
presetHandle.destroy();

// ---- mutations return an awaitable + cancelable handle ------------------------------
const addP: Awaitable = g.addNode({ id: "check", label: "Health check" }, { after: "deploy" });
addP.then((r) => r.canceled).catch(() => {}).finally(() => {});
addP.cancel();

const upd: Awaitable = g.update("check", { data: { status: "done" } });
const rm: Awaitable<{ canceled: boolean }> = g.removeNode("check");
void rm;

g.batch((inner: Graph) => {
  inner.addEdge({ id: "e4", source: "check", target: "deploy" });
  inner.removeEdge("e4");
});

g.expand("clean");
g.collapse("clean");
g.expandAll();
g.collapseAll();

const splitAwaitable: Awaitable = g.split("build", {
  nodes: [
    { id: "build.compile", label: "Compile" },
    { id: "build.link", label: "Link" },
  ],
  edges: [{ id: "compile->link", source: "build.compile", target: "build.link" }],
});
void splitAwaitable;

g.condense(["build.compile", "build.link"], { id: "build" });

g.style((n: NodeSpec) => (n.data && n.data.status === "done" ? { "--smv-fill": "#e8f6ec" } : null));
g.theme("dark");
g.fitView({ pad: 24, animate: true });
g.layout({ dir: "TB" });

// ---- M3: the layout solver seam + the optional dagre adapter --------------------------
const solver: LayoutSolver = dagreSolver;
g.layout({ dir: "LR", solver, prevOrder: [["ingest"], ["clean"]], prevLayers: [["ingest"], ["clean"]] });

const solved: SolverResult = solver(
  { nodes: [{ id: "a", w: 100, h: 36 }], edges: [] } satisfies SolverInput,
  { dir: "LR" }
);
const ranks: string[][] = solved.order;
void ranks;

const adapted: LayoutResult = dagreLayout(
  { nodes: [{ id: "a", w: 100, h: 36 }], edges: [] },
  { dir: "LR" }
);
const persistedOrder: string[][] = adapted.order;
const persistedLayers: string[][] = adapted.layers;
const persistedPins: Set<string> = adapted.reversedEdgeIds;
void [persistedOrder, persistedLayers, persistedPins];

// ---- query sugar ----------------------------------------------------------------------
const doneNodes: NodeSpec[] = g.nodes({ data: { status: "done" } });
const doneNodes2: NodeSpec[] = g.nodes((n) => n.label === "Build");
const loopEdges: EdgeSpec[] = g.edges({ loop: true });
const kids: NodeSpec[] = g.children("clean");
const desc: NodeSpec[] = g.descendants("clean");
const roots: NodeSpec[] = g.roots();
const single: NodeSpec | undefined = g.node("build");
const singleEdge: EdgeSpec | undefined = g.edge("e1");
void [doneNodes, doneNodes2, loopEdges, kids, desc, roots, single, singleEdge];

// ---- events -----------------------------------------------------------------------------
const offCommit = g.on("commit", (payload) => {
  const bounds = payload.bounds;
  void bounds.w;
});
offCommit();
g.on("split", (payload) => {
  const targets: string[] = payload.targets;
  void targets;
});
g.on("expandAll", (payload) => {
  const ids: string[] = payload.ids;
  void ids;
});
g.on("arbitrary-custom-event", (payload: unknown) => void payload);

// ---- run: Mode A (simulate, default) ---------------------------------------------------
const runA: SimRun = g.run({ hopMs: 300, rates: [{ t: 0, scope: "*", factor: 1 }] });
runA.play({ until: "deploy" }).then((r) => r.canceled);
runA.pause();
runA.seek(1000);
runA.speed(2, { branch: "build" });
runA.step({ token: "t1" });
const stateA = runA.state();
const firstToken = stateA.tokens[0];
if (firstToken) void firstToken.at.progress;
void runA.sim().stateAt(0).done;

// bare g.run() returns whatever transport already exists (typed as the union).
const bare: Run = g.run();
void bare.duration;

// ---- run: Mode B (live) ------------------------------------------------------------------
const runB: LiveRun = g.run({ mode: "live" });
runB.start("ingest");
runB.finish("ingest", { n: 1 });
runB.spawn("clean.dedupe", 3);
runB.follow();
const following: boolean = runB.following;
const nowMs: number = runB.now();
const log = runB.log();
void [following, nowMs, log];

// ---- storyboard ---------------------------------------------------------------------------
const steps: StoryboardStep[] = [
  { label: "start" },
  { op: "addNode", args: [{ id: "s1", label: "Step 1" }] },
  { op: "wait", ms: 200 },
  { op: "expand", args: ["clean"] },
  { op: "condense", args: [["build.compile", "build.link"], { id: "build" }] },
  { op: "run.play", until: "deploy" },
  { op: "batch", steps: [{ op: "run.step" }, { op: "run.seek", ms: 0 }] },
];
const sb = g.storyboard(steps);
sb.play();
sb.pause();
sb.next();
sb.seek("start");
const pos = sb.position();
void pos.done;

const timeline: Timeline = g.timeline();
void timeline.total;

// ---- M4: director ops ----------------------------------------------------------------------
const shot: CameraTarget = { node: "clean", k: 1.8, pad: 60, dur: 700, ease: "cubic-in-out" };
const cam: Awaitable = g.camera(shot);
cam.cancel();
g.camera({ nodes: ["ingest", "build"], pad: 48, dur: 600 });
g.camera({ fit: true, pad: 24, dur: 800 });
g.camera({ x: 120, y: -40, k: 1.25, dur: 500 });
g.camera({ by: { dx: -200, dy: 0 }, dur: 400 });
g.camera({ zoom: 1.6 });

const spotlight: HighlightSelection = { nodes: ["build"], edges: ["e3"], variant: "focus", dim: true };
g.highlight(spotlight).clearHighlight();
g.caption("Now the build fans out.", { place: "bottom", variant: "note" }).caption(null);

const directed: StoryboardStep[] = [
  { label: "open" },
  { op: "camera", args: [{ node: "clean", dur: 700 }], dur: 700 },
  { op: "highlight", args: [{ nodes: ["clean"], dim: true }] },
  { op: "caption", args: ["Cleaning the data", { place: "bottom" }] },
  { op: "wait", ms: 800 },
  { op: "clearHighlight" },
  { op: "expand", args: ["clean"], dur: 900 },
];
g.storyboard(directed);
const cues: Cue[] = g.cues();
void cues[0]?.at;

// The camera/emphasis primitives underneath, and the record-mode mount opts (D15).
const move = g.viewport.moveTo({ x: 0, y: 0, k: 2 }, { duration: 400 });
move.promise.then((r) => r.canceled);
move.cancel();
g.viewport.fit({ x: 0, y: 0, w: 100, h: 100 }, { pad: 12, duration: 300, maxK: 4 });
g.viewport.fit({ x: 0, y: 0, w: 100, h: 100 }, 12, true); // the M0 spelling still compiles
g.viewport.setInteractive(false);
const paneSize: { w: number; h: number } = g.viewport.size();
const heading = g.viewport.target;
void [paneSize, heading.k];
g.renderer.emphasize("build", "focus");
g.renderer.dim("build", null);

const recordOpts: MountOpts = { ticker: "manual", motion: "full", captions: false, autoplay: true };
void recordOpts;

// ---- destroy --------------------------------------------------------------------------
g.destroy();

// ---- export / a11y-table (ESM-only subpath entries) ------------------------------------
const svgString: string = exportSVG(g, { pad: 16, theme: "light" });
void svgString;
// M4c — the shot: live pan/zoom transform and live culling kept, pane-sized viewBox.
const shotString: string = exportSVG(g, { viewport: true, theme: "dark" });
void shotString;
exportPNG(g, { scale: 2, background: "#fff" }).then((blob: Blob) => blob.size);

const rows = computeRows(g);
void rows[0]?.targets;
const tableHandle = attachA11yTable(g, { visible: false });
tableHandle.destroy();

// ---- error shape (catch-and-inspect, structural — not an importable class) -------------
try {
  g.addNode({ id: "" });
} catch (err) {
  const smvErr = err as SmvErrorLike;
  void smvErr.code;
}

// ---- deliberately wrong usages: these MUST fail to compile -----------------------------
// @ts-expect-error — split requires a container-free node's `parts.nodes` to be non-empty
// spec-shaped, not a bare string.
g.split("build", "not-a-parts-object");

// @ts-expect-error — 'live' run's start/finish/spawn/follow are not on the Mode A surface.
runA.start("ingest");
