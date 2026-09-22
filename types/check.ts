// Compile-only usage sample exercising the public surface pinned by index.d.ts/export.d.ts/
// a11y-table.d.ts. `npm run types` = `tsc -p types` — this file passing with zero errors
// (plus the deliberate @ts-expect-error lines actually erroring) IS the test.

import {
  mount,
  version,
  presetPipeline,
  GraphError,
  type Graph,
  type GraphSpec,
  type MountOpts,
  type NodeSpec,
  type EdgeSpec,
  type Awaitable,
  type MutationResult,
  type RemoveNodeResult,
  type CondenseSplitResult,
  type SmvErrorLike,
  type GraphErrorCode,
  type SimRun,
  type LiveRun,
  type LiveEvent,
  type Run,
  type StoryboardStep,
  type Timeline,
  type CameraTarget,
  type MutationOpts,
  type AddNodeOpts,
  type HighlightSelection,
  type PropsOverride,
  type Cue,
  type LayoutResult,
  type ValidateProbe,
  type ValidateResult,
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
    { id: "clean", label: "Clean data", collapsed: true, durationAgg: "sum", statusAgg: "latest" },
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
  layout: { dir: "LR", nodesep: 24, componentOrder: ["ingest", ["clean", "clean.dedupe"], "deploy"] },
  animation: { duration: 350, easing: "cubic-out" },
  controls: true,
  preset: "pipeline",
  a11y: true,
};

const g: Graph = mount("#pipe", spec, opts);

const v: string = version;
const presetHandle = presetPipeline(g);
presetHandle.destroy();

// ---- mutations return an awaitable + cancelable handle, resolving {canceled, applied, …} --
const addP: Awaitable<MutationResult> = g.addNode({ id: "check", label: "Health check" }, { after: "deploy" });
addP.then((r) => { r.canceled; r.applied; }).catch(() => {}).finally(() => {});
addP.cancel();

const upd: Awaitable<MutationResult> = g.update("check", { data: { status: "done" } });
void upd;
// `data: {key: undefined}` unsets a key; `{replace: true}` swaps the payload; a `collapsed`
// patch routes to expand()/collapse().
g.update("check", { data: { status: undefined } });
g.update("check", { data: { status: "done" } }, { replace: true });
g.update("clean", { collapsed: true });

// validate(ops | fn) — the same guards, against a throwaway clone, nothing committed.
const verdict: ValidateResult = g.validate([
  { op: "addNode", args: [{ id: "check2" }] },
  { op: "batch", steps: [{ op: "removeNode", args: ["check2"] }] },
]);
if (!verdict.ok) { const codes: GraphErrorCode[] = verdict.errors.map((e) => e.code); void codes; }
const verdict2: ValidateResult = g.validate((probe: ValidateProbe) => {
  probe.addNode({ id: "check3" });
  probe.condense(["check3"], { id: "merged", parent: null });
});
void verdict2;
// removeNode() resolves the full removed-ids cascade on top of {canceled, applied}.
const rm: Awaitable<RemoveNodeResult> = g.removeNode("check");
rm.then((r) => { const nodeIds: string[] = r.ids.nodes; const edgeIds: string[] = r.ids.edges; void [nodeIds, edgeIds]; });

const batchP: Awaitable<MutationResult> = g.batch((inner: Graph) => {
  inner.addEdge({ id: "e4", source: "check", target: "deploy" });
  inner.removeEdge("e4");
});
void batchP;
// batch(fn) requires a synchronous fn (finding #2) — enforced at RUNTIME only
// (GraphError "batch-async"), not by this signature: TypeScript's `void` return type
// accepts a Promise-returning function too, so an async callback still type-checks here.

g.expand("clean");
g.collapse("clean");
g.expandAll();
g.collapseAll();
// F37 — a shot resolved against the layout the toggle produces, flown on its clock.
g.expand("clean", { camera: true });
g.expand("clean", { camera: { pad: 60 } });
g.collapse("clean", { camera: { fit: true } });
g.expandAll({ camera: true });
g.collapseAll({ camera: { nodes: ["ingest", "build"] } });
g.update("clean", { collapsed: false }, { camera: true });
// F38 — the same option on every relayout-producing mutation, framing the op's subject.
g.addNode({ id: "deploy", label: "Deploy" }, { after: "check", camera: true });
g.addNode({ id: "notify", label: "Notify" }, { camera: { nodes: ["deploy", "notify"], maxK: 1, pad: 120 } });
g.addEdge({ id: "e6", source: "deploy", target: "notify" }, { camera: true });
g.update("deploy", { label: "Deploy to production" }, { camera: { pad: 40 } });
g.removeEdge("e6", { camera: true });
g.removeNode("notify", { camera: { fit: true } });
const relaid: Awaitable = g.layout({ dir: "TB" }, { camera: true });
void relaid;
const mutOpts: MutationOpts = { camera: { fit: true, pad: 32 } };
const addOpts: AddNodeOpts = { after: "check", camera: true };
void [mutOpts, addOpts];

// condense()/split() resolve the created/removed ids once the merge/split actually lands
// (`applied:true`) — `ids` is optional because a run canceled before that never happened.
const splitAwaitable: Awaitable<CondenseSplitResult> = g.split("build", {
  nodes: [
    { id: "build.compile", label: "Compile" },
    { id: "build.link", label: "Link" },
  ],
  edges: [{ id: "compile->link", source: "build.compile", target: "build.link" }],
});
splitAwaitable.then((r) => { if (r.applied && r.ids) { const created: string[] = r.ids.created; void created; } });

// `parent: null` on the merged spec = "inherit the sources' common parent".
const condenseAwaitable: Awaitable<CondenseSplitResult> = g.condense(["build.compile", "build.link"], { id: "build", parent: null });
void condenseAwaitable;

g.style((n: NodeSpec) => (n.data && n.data.status === "done" ? { "--smv-fill": "#e8f6ec" } : null));
g.theme("dark");
g.fitView({ pad: 24, animate: true });
g.fitView({ inset: { bottom: 56 } });           // F15 — keep clear of the pane's own chrome
g.fitView({ inset: 0 });                        // …or opt out of the measurement entirely
g.layout({ dir: "TB" });

// ---- M3: the layout solver seam + the optional dagre adapter --------------------------
const solver: LayoutSolver = dagreSolver;
g.layout({ dir: "LR", solver, prevOrder: [["ingest"], ["clean"]], prevLayers: [["ingest"], ["clean"]] });

// ---- componentOrder: one slot per entry, aliases in an array, null to clear ------------
g.layout({ componentOrder: ["deploy", "ingest"] });
g.layout({ componentOrder: null });

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

// The wildcard listener gets TWO positional args — type, then payload (src/events.js) —
// not just the payload every other on() overload hands its callback.
const offAny = g.on("*", (type: string, payload: unknown) => { void [type, payload]; });
offAny();
g.off("*", (type: string, payload: unknown) => { void [type, payload]; });

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
// Documented on the handle in RUN.md, so it is on the shared surface: Mode A recompiles
// against the live spec, Mode B hands back the frontier.
const reloadedA: number = runA.reload();
void reloadedA;

// ---- run: Mode B (live) ------------------------------------------------------------------
const runB: LiveRun = g.run({ mode: "live" });
runB.start("ingest");
runB.finish("ingest", { n: 1 });
runB.fail("clean.dedupe");
const failedAt: number = runB.fail("clean.dedupe", { at: 1200, reason: "OOM" });
void failedAt;
runB.spawn("clean.dedupe", 3);
runB.follow();

// The failure primitive end to end: a declared Mode A failure, the 'failed' status it
// produces, and the log entry a live fail() writes.
const failingNode: NodeSpec = { id: "flaky", label: "Flaky", data: { duration: "3s", fail: true } };
void failingNode;
const runState = runB.state().nodes.ingest;
if (runState && runState.status === "failed") void runState.progress;
const failEntry: LiveEvent = { t: 10, type: "fail", id: "ingest", reason: "timeout" };
void failEntry;
void runB.sim().events.filter((e) => e.type === "fail");
const reloadedB: number = runB.reload();
void reloadedB;
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
  { op: "expand", args: ["clean", { camera: true }] },
  { op: "collapse", args: ["clean", { camera: { fit: true } }] },
  { op: "expandAll", args: [{ camera: true }] },
  // F38 — a child's shot composes against the batch's one commit (the seq-diagram idiom).
  { op: "batch", steps: [
    { op: "addNode", args: [{ id: "s2", label: "Step 2" }, { camera: { nodes: ["s1", "s2"], maxK: 1 } }] },
    { op: "addEdge", args: [{ id: "s1-s2", source: "s1", target: "s2" }] },
  ], dur: 300 },
  { op: "removeEdge", args: ["s1-s2", { camera: true }] },
  { op: "removeNode", args: ["s2", { camera: { fit: true } }] },
  { op: "update", args: ["s1", { label: "Step one" }, { camera: true }] },
  { op: "layout", args: [{ dir: "TB" }, { camera: true }] },
  { op: "condense", args: [["build.compile", "build.link"], { id: "build" }] },
  { op: "run.play", until: "deploy" },
  { op: "batch", steps: [{ op: "run.step" }, { op: "run.seek", ms: 0 }] },
  // F5 — the run-shaped and structural ops.
  { op: "run", args: [{ iterations: { retry: 2 }, hopMs: 120 }] },
  { op: "run.reset" },
  { op: "expandAll" },
  { op: "collapseAll" },
  { op: "layout", args: [{ dir: "TB" }] },
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
g.camera({ nodes: ["ingest", "build"], maxK: 2.5 });        // F17 — the fit lid (default 1.5)
g.camera({ fit: true, inset: { bottom: 56, top: 12 } });    // F15 — explicit pane chrome
g.props({ ingest: { "--smv-fill": "#7c5cff" } }, { merge: true });  // F18 — patch the layer
// F18 — a `null` VALUE drops one key, a `null` ENTRY drops every override for one id.
g.props({ ingest: { "--smv-fill": null }, build: null }, { merge: true });
const dropOne: PropsOverride = { clean: null };
g.props(dropOne, { merge: true });

const spotlight: HighlightSelection = { nodes: ["build"], edges: ["e3"], variant: "focus", dim: true };
g.highlight(spotlight).clearHighlight();
g.caption("Now the build fans out.", { place: "bottom", variant: "note" }).caption(null);

const directed: StoryboardStep[] = [
  { label: "open" },
  { op: "camera", args: [{ node: "clean", dur: 700 }], dur: 700 },
  { op: "highlight", args: [{ nodes: ["clean"], dim: true }] },
  { op: "caption", args: ["Cleaning the data", { place: "bottom" }] },
  { op: "props", args: [{ clean: { "--smv-fill": "#7c5cff" } }, { merge: true }] },
  { op: "props", args: [{ clean: null }, { merge: true }] },
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

// ---- F36: the "story finished" convention ---------------------------------------------
const autoOpts: MountOpts = { autoplay: "auto" };
void autoOpts;
g.finished.then((r) => r.reason);
g.finish().finish("live-done");
g.on("finish", (e) => e.reason);
// The run-status channel carries the engine's own union, so an exhaustive listener has
// FOUR cases: `'failed'` is emitted by both engines (data.fail / LiveRun.fail).
g.on("runstatus", (e) => {
  switch (e.status) {
    case "pending":
    case "active":
    case "done":
    case "failed":
      return;
    default: {
      const exhaustive: never = e.status;
      return exhaustive;
    }
  }
});
// F6 — run events mirrored onto the instance bus outlive a g.run(opts) recompile.
g.on("run:finish", (payload) => void payload);

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

// ---- error shape ------------------------------------------------------------------------
// GraphError is a real, importable class (M2 finding): instanceof narrows it directly, and
// `.code` is one of the pinned GraphErrorCode union. SmvErrorLike stays for callers who
// prefer to narrow structurally instead.
try {
  g.addNode({ id: "" });
} catch (err) {
  if (err instanceof GraphError) {
    const code: GraphErrorCode = err.code;
    void code;
  }
  const smvErr = err as SmvErrorLike;
  const structCode: GraphErrorCode = smvErr.code;
  void structCode;
}

// ---- F21-F27: preset options, node measurement, rich edge labels, click events --------
const rich: EdgeSpec = {
  id: "e9", source: "ingest", target: "build",
  label: { text: "hands the batch to", place: "start", rotate: true, pill: true, maxW: 220 },
};
void rich;

const decorated: Graph = mount("#pipe", spec, {
  preset: { name: "pipeline", total: "critical" },
  interaction: { tapToggle: false, click: true },
  layout: {
    edgeLabelMaxW: 200,
    measure: { extraWidth: (n: NodeSpec) => (n.data ? 40 : 0), extraHeight: 8 },
  },
});
decorated.on("nodeclick", ({ id, event }) => { void id; void event; });
const offEdgeClick = decorated.on("edgeclick", ({ id }) => { void id; });
offEdgeClick();
void presetPipeline(decorated, { total: "both" }).destroy;

// @ts-expect-error — the total-duration bar has three modes, and 'mean' is not one.
presetPipeline(decorated, { total: "mean" });

// @ts-expect-error — an edge label object must carry its text.
const noText: EdgeSpec = { id: "e10", source: "ingest", target: "build", label: { place: "mid" } };
void noText;

// ---- deliberately wrong usages: these MUST fail to compile -----------------------------
// @ts-expect-error — split requires a container-free node's `parts.nodes` to be non-empty
// spec-shaped, not a bare string.
g.split("build", "not-a-parts-object");

// @ts-expect-error — 'live' run's start/finish/spawn/follow are not on the Mode A surface.
runA.start("ingest");

// @ts-expect-error — fail() is a live-mode primitive; Mode A declares failure via data.fail.
runA.fail("ingest");

// @ts-expect-error — a failure is not partial: fail() takes no `n`.
runB.fail("ingest", { n: 1 });
