// Hand-written types for sparkle-motion-visualizer's main entry (src/index.js), M2.
// Source stays plain JS — this file is the only place the public surface is typed.
// Kept in sync by hand; when index.js's surface changes, this file changes with it.

// ---------------------------------------------------------------------------
// Graph spec (src/store.js field lists)
// ---------------------------------------------------------------------------

export type JoinPolicy = "all" | "any" | { count: number };

export interface NodeSpec {
  id: string;
  label?: string;
  /** Containment: this node is a child of `parent` (compound / container nodes, D5). */
  parent?: string;
  /** Free-form payload. Four keys are read by the Mode A run engine (src/run.js):
   *  - `duration`: `"2h" | "45m" | "8s" | "300ms" | 12` (bare number = seconds) — paces
   *    the dwell. Unparseable or negative values warn and fall back to the default.
   *  - `fail`: truthy = this step runs its dwell and then FAILS — status `'failed'`, no
   *    fan-out to its successors, a `'fail'` run event. A string value is carried through
   *    as that event's `reason`; the object form `{reason, retries, recover}` gives it a
   *    retry budget (see `NodeFail`). (Mode B's equivalent is `LiveRun.fail(id)`.)
   *  - `entry`: `true` declares an EXTRA seed — this node is minted a token of its own at
   *    t = 0 even when it has in-edges (a saga's compensation, a token refresh).
   *  - `startAt`: when this node's seed token appears, in ms on the compiled clock
   *    (a string goes through the duration grammar, so `"2s"` is 2000). */
  data?: Record<string, unknown>;
  /** Container starts collapsed. */
  collapsed?: boolean;
  /** Treat this node as a container even before anything names it as a `parent` (F33):
   *  it draws as a header-only box (`data-container` + `data-empty`) and reaches the
   *  layout solver flagged `container: true`, instead of being a plain leaf until its
   *  first child arrives. Ignored (harmlessly) once the node does have children.
   *  View/layout/render only: collapse, expand, the tap toggle, `aria-expanded` and the
   *  run engine all keep keying off "has children", so an empty declared container is not
   *  collapsible and is still an executable step. */
  container?: boolean;
  /** F9 — container ports: the descendants an edge INTO this container attaches to. With
   *  several, the incoming edge fans out to all of them, like any other fan-out. Default
   *  (unset): the one inferred entry child. */
  entry?: string[];
  /** F9 — the descendants an edge OUT of this container is fed by. Several exits give the
   *  downstream node that many in-edges, so its implicit AND-join waits for all of them. */
  exit?: string[];
  join?: JoinPolicy;
  type?: string;
  iterate?: unknown;
  children?: unknown;
  /** Container/collapsed-group duration rollup (preset-pipeline). */
  durationAgg?: "sum" | "max";
  /** Container status rollup from its descendants in Mode A (src/run.js), the status
   *  mirror of `durationAgg`. `'earliest-fail'` (default) keeps the container `'failed'`
   *  from the first descendant failure onward; `'latest'` follows the most recent
   *  descendant outcome, so a later success clears it again; `'none'` never inherits a
   *  failure at all. */
  statusAgg?: "earliest-fail" | "latest" | "none";
  w?: number;
  h?: number;
  groups?: unknown;
  [key: string]: unknown;
}

/** A rich edge label (F25). A bare string is the same thing with every default taken. */
export interface EdgeLabelSpec {
  text: string;
  /** Where along the (clipped) path it rides. Default `'mid'`. */
  place?: "mid" | "start" | "end";
  /** Lay the text along the line instead of upright. Default `false`; never upside down. */
  rotate?: boolean;
  /** Draw an opaque backing plate instead of the background-colored halo. Default `false`. */
  pill?: boolean;
  /** Truncation cap in px for THIS label, beating `LayoutOpts.edgeLabelMaxW` (F26). */
  maxW?: number;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  /** Back/retry edge; requires `maxIterations` (D3/D4). */
  loop?: boolean;
  maxIterations?: number;
  /** F1 — a `loop` edge that fires only out of a DECLARED FAILURE at its source: its
   *  iteration budget is that node's retry budget, and it is the arc each retry crosses.
   *  It is inert on a successful finish (an ordinary loop edge handles that case). */
  onFail?: boolean;
  label?: string | EdgeLabelSpec;
  /** `data.duration` (same grammar as a node's) is this edge's own hop time (F8); `hopMs`
   *  is the default for every edge that declares none. */
  data?: Record<string, unknown>;
  /** Meta-edge aggregation weight (>1 renders as a heavier line + badge). */
  weight?: number;
  [key: string]: unknown;
}

/** The merged-node spec `g.condense()` takes. Same as `NodeSpec`, except `parent` may also
 *  be `null` — "inherit the sources' common parent", exactly like leaving it out (a spec
 *  built from a form or a diff has no other way to say "absent"). When the sources have
 *  DIFFERENT parents there is no common one to inherit: the merged node lands at the top
 *  level and warns, so name a `parent` explicitly for a cross-container merge. A source
 *  swallowed by another source (a container named together with one of its own children)
 *  is not a second parent — its parent is being removed too, so the common parent is still
 *  the container's. */
export type CondenseNodeSpec = Omit<NodeSpec, "parent"> & { parent?: string | null };

export interface GraphSpec {
  nodes?: NodeSpec[];
  edges?: EdgeSpec[];
}

/** The shape every `GraphError` thrown by `g`'s mutation methods carries. `GraphError` is
 *  now a real exported class (`import { GraphError } from "sparkle-motion-visualizer"`) —
 *  `instanceof GraphError` works — but `SmvErrorLike` stays for callers that only want to
 *  narrow structurally: `catch (e) { if ((e as SmvErrorLike).code === "missing") ... }`. */
export interface SmvErrorLike extends Error {
  code: GraphErrorCode;
}

/** Every code a `GraphError` is thrown with (grep of every `new GraphError(...)` call site
 *  in src/, M2). Not exhaustive-checked by the compiler — new codes are additive — but this
 *  is the complete list as of this writing. */
export type GraphErrorCode =
  | "no-mount"
  | "node-id"
  | "edge-id"
  | "dup-id"
  | "dangling"
  | "unbounded-loop"
  | "missing"
  | "parent-cycle"
  | "non-convex"
  | "split-container"
  | "split-edge"
  | "split-no-entry"
  | "split-no-exit"
  | "props-key"
  /** g.style(fn) returned a key that isn't `--smv-*` (same contract as `props-key`,
   *  thrown from render.js's checkStyleProps). */
  | "style-key"
  | "storyboard-step"
  | "storyboard-op"
  | "storyboard-label"
  /** g.batch(fn) was called with an fn that returned a thenable (finding #2): batch
   *  requires a synchronous callback. */
  | "batch-async"
  /** `g.validate()` was handed a step whose `op` is not a known op name. Reported in the
   *  returned `errors`, never thrown. */
  | "validate-op";

/** The real, importable error class every `g` mutation method throws (`src/store.js`).
 *  `code` is one of `GraphErrorCode`; `message` is human-readable and already carries the
 *  code (`[smv:<code>] ...`). */
export class GraphError extends Error {
  constructor(code: GraphErrorCode, message: string);
  readonly code: GraphErrorCode;
}

// ---------------------------------------------------------------------------
// Awaitable — every mutation's return value (§5.3): a thenable that is also cancelable.
// ---------------------------------------------------------------------------

export interface Awaitable<T = { canceled: boolean }> extends PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null): Promise<T>;
  /** Cancel-and-retarget (D9): the transition this awaitable is riding gets interrupted;
   *  the awaitable itself still resolves, with `{canceled: true}`. */
  cancel(): void;
}

/** What every `g` mutation method's `Awaitable` actually resolves with (M2 finding: used
 *  to be `{canceled}` alone, which cannot say whether the graph changed — cancel() never
 *  undoes add/remove/update, and for condense/split the structural change lands mid-flight,
 *  so `{canceled}` meant something different before vs. after that async phase).
 *  `applied` is additive: `canceled` is still there for existing callers. */
export interface MutationResult {
  canceled: boolean;
  /** Did the structural change actually land in the store? For addNode/addEdge/removeNode/
   *  removeEdge/update/batch this is synchronous, so it is always `true` by the time the
   *  awaitable exists (cancel() only interrupts the relayout tween). For condense/split it
   *  flips `true` partway through, in the async converge/diverge phase — see
   *  `CondenseSplitResult`. `expand`/`collapse`/`expandAll`/`collapseAll` resolve
   *  `applied:false` instead of this shape entirely when there was nothing to do (already
   *  expanded/collapsed) — see their return types below. */
  applied: boolean;
}

/** `g.removeNode(id)`'s resolution: the full doomed cascade (`id` plus every descendant it
 *  swallowed, src/store.js's `removeNode`) and every edge left dangling by any of them. */
export interface RemoveNodeResult extends MutationResult {
  ids: { nodes: string[]; edges: string[] };
}

/** `g.condense()`/`g.split()`'s resolution. `ids` is only present once `applied` is true —
 *  a run canceled before the store actually merged/split (phase 1, or a stale re-check)
 *  never created or removed anything. */
export interface CondenseSplitResult extends MutationResult {
  ids?: { created: string[]; removed: string[] };
}

// ---------------------------------------------------------------------------
// Layout results (src/layout.js's frozen seam)
// ---------------------------------------------------------------------------

export interface Rect {
  /** center x/y, per layout.js (D2) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutEdgeResult {
  points: Point[];
  reversed?: boolean;
}

export interface LayoutResult {
  nodes: Record<string, Rect>;
  edges: Record<string, LayoutEdgeResult>;
  bounds: Rect;
  reversedEdgeIds: Set<string>;
  /** Final per-rank id sequences (real nodes only). Persisted by the caller and passed
   *  back as `LayoutOpts.prevOrder` for order stability across re-layouts (M3). */
  order: string[][];
  /** The same per-rank sequences WITH each multi-rank edge's bends interleaved (opaque
   *  tokens). `order` alone does not determine a drawing, so this is persisted and passed
   *  back as `LayoutOpts.prevLayers` — together they make a re-layout of an unchanged graph
   *  reproduce the identical picture. Empty for a solver that does not produce it. */
  layers: string[][];
  /** `componentOrder` only: which slot each real id's component landed in. mount() persists
   *  it to keep a component's slot alive after every id the option named for it is gone.
   *  Absent when the option was not in play (or the solver does not produce it). */
  slots?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// The layout solver seam (M3): layout() is a shell around a pluggable solver.
// Default is the in-house engine; `sparkle-motion-visualizer/adapters/dagre`
// supplies the same contract on top of the optional @dagrejs/dagre peer.
// ---------------------------------------------------------------------------

/** A node as the drawing sees it: the spec node plus the fields the view pass computed.
 *  This is what `StyleFn` and `LayoutOpts.hint` are handed. */
export interface ViewNode extends NodeSpec {
  w?: number;
  h?: number;
  /** Has children, or was declared with `NodeSpec.container` (F33). */
  container?: true;
  /** A container with no children yet — mirrored as `data-empty` on the DOM group. */
  empty?: true;
  /** Container currently folded shut. */
  collapsed?: true;
  /** Hidden descendants, on a collapsed container only (the ×N badge). */
  count?: number;
  /** Containment depth, 0 at the root. */
  depth?: number;
}

export interface LayoutViewNode {
  id: string;
  w?: number;
  h?: number;
  parent?: string;
  /** True for a container — one with children, or one declared with `NodeSpec.container`
   *  before it has any (F33). Absent on leaves. */
  container?: true;
  /** The node's own `data`, or whatever `LayoutOpts.hint(node)` picked instead (F32), so a
   *  placement-driven solver can read per-node hints. Absent when there is nothing to pass. */
  data?: unknown;
}

export interface LayoutViewEdge {
  id: string;
  source: string;
  target: string;
}

/** What the shell hands a solver: acyclic, and no edge incident to a node with children.
 *  Every custom key on `LayoutOpts` reaches the solver untouched, by spread — that is the
 *  supported channel for a solver's own options. */
export interface SolverInput {
  nodes: LayoutViewNode[];
  edges: LayoutViewEdge[];
}

export interface SolverResult {
  /** x,y are centers; a container's rect covers its children. */
  nodes: Record<string, Rect>;
  /** Bend chain included, >= 2 points, running source -> target. */
  edges: Record<string, { points: Point[] }>;
  order: string[][];
  /** Optional: `order` with each edge bend interleaved, for full re-layout stability. */
  layers?: string[][];
  /** Optional: per-id component slot, produced only when `LayoutOpts.componentOrder` was set. */
  slots?: Record<string, number>;
}

export type LayoutSolver = (input: SolverInput, opts: LayoutOpts) => SolverResult;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

import type { PipelinePresetOpts } from "./preset-pipeline.js";

export type ThemeName = "auto" | "light" | "dark";
export type EasingName = "linear" | "cubic-out" | "cubic-in-out" | "overshoot";
export type EasingFn = (t: number) => number;

/** The rest of the graph, handed to a measure hook whose chrome depends on more than the
 *  node itself (the pipeline preset's rollup chip reads its children's durations). */
export interface MeasureCtx {
  nodes: Map<string, NodeSpec>;
  cache: Map<string, unknown>;
}

/** F22/F23 - what a decoration layer contributes to node measurement. Each entry is a
 *  number or a per-node function; anything non-finite reads as 0. A node that declares both
 *  `w` and `h` opts out entirely; one that declares only `w` keeps that width and still
 *  gets the reserve. `extraWidth` is reserved CHROME, not label room: the renderer
 *  truncates the label to the box minus it, so a chip can never be run under. It widens the
 *  box inside the 220px maximum, never past it. */
export interface MeasureOpts {
  extraWidth?: number | ((node: NodeSpec, ctx?: MeasureCtx) => number);
  extraHeight?: number | ((node: NodeSpec, ctx?: MeasureCtx) => number);
}

export interface LayoutOpts {
  dir?: "LR" | "TB" | "RL" | "BT";
  /** Node measurement contributions (F22/F23). `mount(..., {preset:'pipeline'})` installs
   *  the preset's own unless you set one. */
  measure?: MeasureOpts | null;
  /** Edge-label truncation cap in px for the whole drawing (F26). Default 90; the pipeline
   *  preset raises it to 180 when you set none. Per-edge `label.maxW` still wins. */
  edgeLabelMaxW?: number;
  nodesep?: number;
  ranksep?: number;
  marginx?: number;
  marginy?: number;
  /** Swap the layered solver (M3). Defaults to the in-house engine. */
  solver?: LayoutSolver;
  /** Previous per-rank order, for stability across re-layouts. mount() persists this
   *  itself; pass one only when driving layout() directly. */
  prevOrder?: string[][];
  /** The bend half of the same channel (LayoutResult.layers). Persist and pass both. */
  prevLayers?: string[][];
  /** Pick what each node carries to the solver as `LayoutViewNode.data` (F32). Defaults to
   *  the node's own `data`; return `undefined` to pass nothing for that node. */
  hint?: (node: ViewNode) => unknown;
  /**
   * Pin the order of the drawing's DISCONNECTED components (e.g. several parallel
   * pipelines), which nothing else holds in place: with no edges between them, adding or
   * removing a node in one can slide the whole component past the others.
   *
   * Each entry is ONE slot, in order: a node id, or an array of ids that are aliases for
   * the same slot (list a few, so the slot survives losing one). The component containing
   * any listed id takes that entry's index — the lowest one, if it holds ids from several.
   * Unknown ids are ignored. A container and its children are one component, so listing
   * either the container or any child places the whole thing. Every component nobody
   * listed shares one slot after all the listed ones.
   *
   * Through `mount()` the slots are STICKY: each drawing's slot assignment is remembered,
   * so a component keeps its slot even once every id listed for it has been removed (a
   * `condense()`/`split()` passes it to the nodes it mints) — you do not have to guess
   * which ids will survive. The list always outranks that memory, which only places
   * components no listed id claims. Handing `g.layout()` a different list (or switching
   * the option off) drops the memory and re-resolves from the new list.
   *
   * Engine-only: the dagre adapter ignores it. `null` (or anything that is not an array)
   * turns it off.
   */
  componentOrder?: Array<string | string[]> | null;
  /**
   * Solver-seam only: the previous drawing's `slots`, applied to components that no
   * `componentOrder` entry claims. `mount()` derives and overwrites this on every relayout,
   * so set it only when driving `layout()` directly. Ignored without `componentOrder`.
   */
  componentOrderMemory?: Record<string, number> | null;
  [key: string]: unknown;
}

export interface AnimationOpts {
  duration?: number;
  easing?: EasingName | EasingFn;
}

export interface MountOpts {
  theme?: ThemeName;
  layout?: LayoutOpts;
  animation?: AnimationOpts;
  /** Mounts `.smv-transport` (play/pause/step/scrub/speed). */
  controls?: boolean;
  /** `'pipeline'` applies the bundled preset (duration chips, status glyphs, odometer), and
   *  installs its measurement/edge-label defaults into `layout` (F22/F23/F26). The object
   *  form passes options through: `{ name: 'pipeline', total: 'critical' }` (F24). */
  preset?: "pipeline" | ({ name: "pipeline" } & PipelinePresetOpts);
  /** ARIA + keyboard is on by default; pass `false` to opt out. */
  a11y?: boolean;
  /** Pointer interactions. `tapToggle` (tap/click a container to expand/collapse) and
   *  `click` (the `nodeclick`/`edgeclick` events, F27) are both on by default; either can be
   *  turned off on its own. */
  interaction?: { tapToggle?: boolean; click?: boolean };
  storyboard?: StoryboardStep[];
  /** `true` plays the storyboard as soon as it is mounted; `'auto'` plays it only when the
   *  page URL carries `?auto=1` (or `auto=true`) — the headless-verification convention
   *  `g.finished` completes (F36). */
  autoplay?: boolean | "auto";
  /** D15 (M4) — `'manual'` drives the shared ticker by hand (`g.ticker.tick(ms)`) instead
   *  of rAF, and stamps `data-smv-record` on the root to kill every CSS transition. What
   *  the deterministic frame renderer mounts with. */
  ticker?: "manual";
  /** D15 — `'full'` forces reduced motion OFF regardless of the environment (recording). */
  motion?: "full";
  /** `false` suppresses the `.smv-caption` overlay. The caption is still snapshotted state
   *  and still appears in `g.cues()`, so subtitles can be burned in separately. */
  captions?: boolean;
}

/** Node-scoped user style function (§5.6) — return `--smv-*` custom-property values only. */
export type StyleFn = (node: ViewNode) => Record<string, string | number> | null | undefined;

// ---------------------------------------------------------------------------
// Query sugar (src/query.js)
// ---------------------------------------------------------------------------

export type QueryPredicate<T> = (item: T) => boolean;
export type QueryMatch<T> = { [K in keyof T]?: T[K] } & { data?: Record<string, unknown> };
export type QueryFilter<T> = QueryPredicate<T> | QueryMatch<T>;

// ---------------------------------------------------------------------------
// Token run — Mode A (src/run.js) + Mode B / live (src/run-live.js)
// ---------------------------------------------------------------------------

export interface TokenState {
  id: string;
  rate: number;
  at: { kind: "node" | "edge"; id: string; progress: number };
}
export interface NodeRunState {
  /** `'failed'` is terminal like `'done'`: the step stopped and nothing was handed on to
   *  its successors. Mode A reaches it via `data.fail`, Mode B via `LiveRun.fail(id)`.
   *  A failed node reports `progress: 1` and `occupancy: 0`. */
  status: "pending" | "active" | "done" | "failed";
  progress: number;
  occupancy: number;
  /** Mode B only. Occupants that are not working yet — a landed arrival, or one still held
   *  by a join that has not fired. `waiting + active === occupancy`. */
  waiting?: number;
  /** Mode B only. Occupants currently dwelling (an explicit `start()` picked them up). */
  active?: number;
  /** Mode B only. The live dwell outran the node's declared `data.duration` (which in live
   *  mode is an expectation, never a schedule). Rendered as `data-over-budget`. */
  overBudget?: boolean;
}
export interface EdgeRunState {
  traversed: number;
}
export interface JoinState {
  arrived: number;
  needed: number;
  fired: boolean;
}
export interface LoopState {
  iteration: number;
  max: number;
}
export interface RunState {
  tokens: TokenState[];
  nodes: Record<string, NodeRunState>;
  edges: Record<string, EdgeRunState>;
  joins: Record<string, JoinState>;
  loops: Record<string, LoopState>;
  done: boolean;
}

export interface RunEvent {
  t: number;
  /** `'fail'` = a `data.fail` node reached the end of its dwell and died there (carries
   *  `nodeId`, `tokenId`, and `reason` when `data.fail` was a string); `'warn'` = a
   *  compile-time diagnostic (carries `nodeId`, `message`, `value`). Both are re-emitted
   *  on the run bus by type, like every other event. */
  type: "enter" | "start" | "finish" | "fail" | "spawn" | "join" | "drop" | "loop" | "warn" | "done";
  /** `fail` events: the 1-based attempt, its retry budget, and whether this one stuck. */
  attempt?: number;
  retries?: number;
  terminal?: boolean;
  [key: string]: unknown;
}

export interface NodeFail {
  /** Carried through as the emitted `'fail'` event's `reason`. Annotation only. */
  reason?: string;
  /** F1 — attempts AFTER the first. Each spent retry re-runs the dwell and emits its own
   *  `'fail'` (`terminal: false`) plus a `'loop'`; the node only reaches status `'failed'`
   *  when the budget is gone. Omitted: an `onFail` loop edge out of this node supplies the
   *  budget instead, and with neither it is 0 — today's single terminal attempt. */
  retries?: number;
  /** The attempt that spends the last retry SUCCEEDS instead: `'finish'`, fan-out, status
   *  `'done'` — "fail, retry, pass" without recompiling the run. */
  recover?: boolean;
}

export interface Sim {
  /** The DECLARED timeline's length in ms. Playback speed never moves it (F7). */
  duration: number;
  /** `duration` under its intent-revealing name. */
  declared?: number;
  /** Wall-clock ms the declared timeline takes at the current bare `speed()` multiplier
   *  (`Infinity` at speed 0). Mode A and Mode B both report it. */
  playback?: number;
  events: RunEvent[];
  boundaries?: number[];
  stateAt(t: number): RunState;
  nextBoundary?(t: number, tokenId?: string): number | null;
}

export interface RunRate {
  t: number;
  scope: string | "*";
  factor: number;
}

export interface RunOptsBase {
  iterations?: Record<string, number>;
  rates?: RunRate[];
  hopMs?: number;
  dwell?: (sec: number | null, ctx?: unknown) => number;
  /** Playback multiplier a bare `speed(f)` set — playback only, never the schedule (F7). */
  playbackSpeed?: number;
}

/** An extra seed: one token minted at `id` at `at` ms on the compiled clock (F3). */
export interface RunEntry {
  id: string;
  at?: number;
}

export interface LiveEvent {
  t: number;
  type: "start" | "finish" | "fail" | "spawn";
  id: string;
  n?: number;
  /** `fail` entries only, and only when one was given. Annotation: the replay ignores it. */
  reason?: string;
}

export interface SimRunOpts extends RunOptsBase {
  mode?: "simulate";
  /** Pre-seed extra tokens (the compile input `run.inject()` appends to, F3). */
  entries?: RunEntry[];
}
export interface LiveRunOpts extends RunOptsBase {
  mode: "live";
  /** Re-seed the live event log (re-seeding/tests). The frontier starts at the seeded
   *  log's own span, so the events handed in are immediately reachable. */
  log?: LiveEvent[];
  /** Explicit epoch for the frontier, ms. Use it when the run resumes a session that has
   *  already been running for `now` ms, so later `{ at }` stamps are not clamped back onto
   *  a frontier that restarted at the seeded log's span. */
  now?: number;
  /** Shortest crossing, in ms, a hop may be squashed to when a `start()` claims it while it
   *  is still in flight (default 0 — the start collapses the hop). Clamped to `hopMs`. Set
   *  it when replaying real timestamps, where a parent's dispatch instant IS the child's
   *  start instant and every token would otherwise teleport. */
  minHopMs?: number;
  /** Whether a bare `start()` may mint a token where nothing is waiting (default `true`).
   *  `false` makes a warned-about phantom start a no-op; `start(id, { spawn: true })` still
   *  mints one deliberately. A root always seeds itself either way. */
  spawnOnStart?: boolean;
}

/** What `LiveRun.reset()` accepts — `options()` returns exactly this shape. */
export interface LiveResetOpts extends Omit<LiveRunOpts, "mode"> {
  mode?: "live";
  /** Re-emit every seeded entry through this handle's emitter as it is re-seeded, in log
   *  order, each payload carrying `replay: true`. */
  replay?: boolean;
}
export type RunOpts = SimRunOpts | LiveRunOpts;

/** Surface shared by both engines (run-transport.js). */
export interface RunControllerBase {
  play(o?: { until?: string }): Promise<{ canceled: boolean }>;
  pause(): number;
  seek(ms: number): number;
  /** Bare: a pure PLAYBACK multiplier in both modes — it scales how fast the clock walks
   *  the timeline and leaves `duration` alone (F7). `{branch}` is a Mode A compile input
   *  (a rate event, which does re-time the schedule) and a documented no-op in Mode B. */
  speed(factor: number, o?: { branch?: string }): number;
  /** The multiplier a bare `speed()` set; 1 = real declared time. */
  playbackSpeed(): number;
  step(o?: { token?: string }): number;
  /** First moment `nodeId` finishes — what a `run.play({until})` storyboard step is worth. */
  timeOf(nodeId: string): number;
  /** In-place re-seat (recompile/reseed + silent resync); used by storyboard restore (G2). */
  reset(o?: Record<string, unknown>, time?: number): number;
  /** Force a recompile against the LIVE spec, returning the new `duration` — Mode A picks
   *  the edited graph up on the next sample; Mode B has nothing to recompile and hands back
   *  the current frontier. What a page calls after mutating the graph mid-run. */
  reload(): number;
  readonly playing: boolean;
  /** Mode A: the compiled run's total ms. Mode B: the frontier (grows). */
  readonly duration: number;
  /** The awaitable for the CURRENT play target; pause() never resolves it. */
  readonly promise: Promise<{ canceled: boolean }>;
  time(): number;
  state(): RunState;
  sim(): Sim;
  options(): Record<string, unknown>;
  on(type: string, fn: (payload: unknown) => void): () => void;
  off(type: string, fn: (payload: unknown) => void): void;
  destroy(): void;
}

/** Mode A — compiled/declared token schedule. */
export interface SimRun extends RunControllerBase {
  /** F3 — mint a token at `nodeId` on the compiled clock (`at` defaults to now),
   *  recompiling and extending the schedule around it. The seed is a compile input, so it
   *  survives later recompiles and round-trips through `options()`/`reset()`. Injecting
   *  into a container seeds every entry child. Returns the instant it was seeded. */
  inject(nodeId: string, o?: { at?: number }): number;
}

/** Mode B — event-log/replayed. `t` can never exceed `now()`; `following` tracks it live. */
export interface LiveRun extends RunControllerBase {
  /** `{ spawn: true }` says "mint a token here on purpose" — without it, a start on a
   *  non-root with nothing waiting, nothing crossing towards it and no finished attempt to
   *  retry warns (`[smv:live]`), and is ignored entirely under `spawnOnStart: false`. */
  start(id: string, o?: { at?: number; spawn?: boolean }): number;
  finish(id: string, o?: { at?: number; n?: number }): number;
  /** Terminal sibling of `finish`: consumes every current occupant of `id` WITHOUT fanning
   *  tokens out (the branch dies), leaves the node on status `'failed'`, and emits a
   *  `'fail'` bus event `{id, t, reason?}`. Logged like any other entry, so it replays,
   *  time-travels and self-heals the same way. Returns the stamped time.
   *  No `n`: a failure is not partial. On a node with zero occupancy it warns and is a
   *  no-op, exactly as `finish` is. */
  fail(id: string, o?: { at?: number; reason?: string }): number;
  spawn(id: string, n: number, o?: { at?: number }): number;
  /** Re-seed the log under the same transport identity/listeners: `{ log, now, replay }`. */
  reset(o?: LiveResetOpts, time?: number): number;
  /** Re-attach the view clock to the frontier immediately (a "jump to live" snap). */
  follow(): number;
  readonly following: boolean;
  /** The frontier clock, ms — grows every tick regardless of play/pause. */
  now(): number;
  log(): LiveEvent[];
}

export type Run = SimRun | LiveRun;

// ---------------------------------------------------------------------------
// Storyboard (src/storyboard.js's op table, as index.js's applyStep dispatches it)
// ---------------------------------------------------------------------------

/** Chrome sitting OVER the pane that a fit must keep clear of, in screen px (F15). A bare
 *  number is all four sides; `0` opts out of the library's own measurement. */
export interface Inset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Where a `camera` op is pointed. First match wins, in declaration order: absolute
 *  `x`/`y` -> `node` -> `nodes` -> `fit` -> relative `zoom`/`by`. A `node`/`nodes` id that
 *  is a collapsed descendant resolves to the nearest DRAWN ancestor (F16); only an id
 *  nothing can resolve warns. */
export interface CameraTarget {
  /** Absolute transform (screen px / scale). `k` alone is a relative zoom-to-scale. */
  x?: number;
  y?: number;
  k?: number;
  /** Frame one node's box. */
  node?: string;
  /** Frame the union of several nodes' boxes. */
  nodes?: string[];
  /** Frame the whole graph. */
  fit?: boolean;
  /** Screen-px nudge, applied after any zoom. */
  by?: { dx?: number; dy?: number };
  /** Scale multiplier about the pane centre. */
  zoom?: number;
  /** Padding around a framed box (default 24). */
  pad?: number;
  /** Chrome to keep the shot clear of. Defaults to the bars the library itself mounted
   *  (transport, the preset's total bar, the caption strip); `0` opts out (F15). */
  inset?: Inset | number;
  /** Lid on a FITTED scale — never on an explicit `k`. Defaults to 1.5 for a `nodes[]`
   *  union, so two nodes in a short pane are not an extreme close-up (F17). */
  maxK?: number;
  /** Move duration in ms (default 600). Reduced motion shrinks it to 1 (G9). */
  dur?: number;
  ease?: EasingName;
}

export type EmphasisVariant = "focus" | "warn" | "ok" | "mute";

/** Replace-not-accumulate: one call IS the emphasis state. */
export interface HighlightSelection {
  nodes?: string[];
  edges?: string[];
  variant?: EmphasisVariant;
  /** Spotlight: everything currently drawn and NOT selected gets `data-dim`. */
  dim?: boolean;
  /** M4d/D17 — a gentle attention beat on the emphasised elements, driven per frame off
   *  the one shared ticker (never a CSS animation, so a frame capture reproduces it).
   *  A modifier on `variant`, not one of them. Reduced motion holds it static (G9). */
  pulse?: boolean;
}

/** M4d/D16 — the per-step custom-property override layer: `{id: {"--smv-*": value}}`,
 *  merged OVER the mount's style function at commit time. `null`/`false` on a key removes
 *  it; only `--smv-*` keys are accepted (D7) and anything else throws. A whole ENTRY may be
 *  `null` — under `{merge:true}` (F18) that drops every override for that one id, while the
 *  rest of the layer stands; in a replacing `props()` call it simply carries no overrides. */
export type PropsOverride = Record<string, Record<string, string | number | false | null> | null>;

/** `{merge:true}` patches the override layer instead of replacing it (F18). */
export interface PropsOpts {
  merge?: boolean;
}

export interface CaptionOpts {
  place?: "bottom" | "top";
  variant?: string;
}

/** One entry of the cue sheet (`g.cues()`), at an ABSOLUTE ms offset on the story clock. */
export interface Cue {
  kind: "label" | "caption";
  at: number;
  label?: string;
  text?: string | null;
  index: number;
}

/** D12 — every step may declare its own duration; scrubber, cue sheet and frame renderer
 *  all read the same number. Omitted, the op's own default applies. On a mutation it paces
 *  the relayout; on a discrete step (`caption`, `highlight`, `clearHighlight`, `props`,
 *  `run.step`, `run.seek`) it is a HOLD — the flip happens at once and the step keeps the
 *  clock for `dur` ms, so `{op:"caption", args:["…"], dur:1500}` replaces caption + wait
 *  (F40). `run` / `run.reset` are always 0. */
export type StoryboardStep = { dur?: number } & (
  /** F38 — every relayout-producing op takes `{ camera }` in its options slot, composed
   *  against the layout the op produces and flown on the step's `dur` (`MutationOpts`). */
  | { op: "addNode"; args: [NodeSpec, AddNodeOpts?] }
  | { op: "addEdge"; args: [EdgeSpec, MutationOpts?] }
  | { op: "removeNode"; args: [string, MutationOpts?] }
  | { op: "removeEdge"; args: [string, MutationOpts?] }
  | { op: "update"; args: [string, Record<string, unknown>, UpdateOpts?] }
  | { op: "expand"; args: [string, ToggleOpts?] }
  | { op: "collapse"; args: [string, ToggleOpts?] }
  /** F39 — `{ camera }` in the third slot frames the merged node / the parts' union in the
   *  choreography's own converge/diverge tween (`MutationOpts`). */
  | { op: "condense"; args: [string[], CondenseNodeSpec, MutationOpts?] }
  | { op: "split"; args: [string, { nodes: NodeSpec[]; edges?: EdgeSpec[] }, MutationOpts?] }
  | { op: "batch"; steps: StoryboardStep[] }
  /** Every container open / closed in one commit — `g.expandAll()` / `g.collapseAll()`.
   *  `[{ camera: true }]` fits the result in the same tween (F37). */
  | { op: "expandAll"; args?: [ToggleOpts?] }
  | { op: "collapseAll"; args?: [ToggleOpts?] }
  /** Re-lay the graph out with new layout opts — `g.layout(o, opts)`; `[{dir:"TB"},
   *  {camera:true}]` fits the re-laid drawing in the same tween (F38). */
  | { op: "layout"; args?: [LayoutOpts?, MutationOpts?] }
  /** (Re)compile the run with these opts — `g.run(opts)`. Subscriptions survive it (F6).
   *  Omit the argument to recompile with the opts the run already has. */
  | { op: "run"; args?: [(SimRunOpts | LiveRunOpts)?] }
  /** Re-seat the SAME transport (identity, listeners, live log) back at t = 0 —
   *  `run.reset(opts, 0)`. Omit the argument to keep the current compile inputs. */
  | { op: "run.reset"; args?: [(SimRunOpts | LiveRunOpts)?] }
  | { op: "run.play"; until?: string; args?: [{ until?: string }?] }
  | { op: "run.step"; token?: string; args?: [{ token?: string }?] }
  | { op: "run.seek"; ms?: number; args?: [number] }
  | { op: "wait"; ms?: number; args?: [number] }
  | { op: "camera"; args: [CameraTarget] }
  | { op: "highlight"; args: [HighlightSelection] }
  | { op: "clearHighlight"; args?: [] }
  | { op: "caption"; args: [string | null, CaptionOpts?] }
  | { op: "props"; args: [PropsOverride | null, PropsOpts?] }
  | { label: string }
);

export interface StoryboardPosition {
  index: number;
  total: number;
  done: boolean;
  label: string | null;
}

export interface StoryboardHandle {
  play(): Promise<unknown>;
  pause(): void;
  next(): Promise<{ canceled: boolean }>;
  prev(): Promise<unknown>;
  seek(indexOrLabel: number | string): Promise<void>;
  labels(): { label: string; index: number }[];
  position(): StoryboardPosition;
  on(type: string, fn: (payload: unknown) => void): () => void;
  off(type: string, fn: (payload: unknown) => void): void;
}

export interface Timeline {
  total: number;
  time: number;
  label: string | null;
  index: number;
  steps: number;
  playing: boolean;
}

// ---------------------------------------------------------------------------
// Events (bus.emit(...) sites in index.js/condense-anim.js/split-anim.js)
// ---------------------------------------------------------------------------

export interface CommitEvent {
  nodes: Record<string, Rect>;
  edges: Record<string, LayoutEdgeResult>;
  bounds: Rect;
  reversedEdgeIds: Set<string>;
  meta: unknown;
  focal: string | null;
  duration: number;
  transition: unknown;
}

export interface GraphEventMap {
  commit: CommitEvent;
  add: { kind: "node" | "edge"; id: string; item: NodeSpec | EdgeSpec };
  remove: { kind: "node" | "edge"; id: string };
  update: { id: string; patch: Record<string, unknown>; item: NodeSpec | EdgeSpec };
  expand: { id: string };
  collapse: { id: string };
  expandAll: { ids: string[] };
  collapseAll: { ids: string[] };
  condense: { sources: string[]; target: string; sourceData: NodeSpec[]; targetData?: NodeSpec };
  split: { source: string; targets: string[]; sourceData: NodeSpec };
  /** A node's RUN status changed (run-render.js). Emitted per transition, never per frame;
   *  a run is not a spec mutation, so no `commit` announces it. a11y.js uses it to keep the
   *  accessible name in step with the live/simulated run. The status is the engine's own,
   *  `'failed'` included — a listener switching on it has four cases, not three. */
  runstatus: { id: string; status: NodeRunState["status"] };
  /** F36 — the story ended: the storyboard ran out of steps (`"storyboard"`), a page called
   *  `g.finish(reason)`, or the instance was destroyed (`"destroy"`). Fires at most once,
   *  alongside `g.finished` resolving. */
  finish: { reason: string };
  /** F27 - a clean tap/click on a node, suppressed when the pointer travelled past the tap
   *  slop (a pan) or a second pointer joined (a pinch). `event` is the raw `pointerup`. */
  nodeclick: { id: string; event: unknown };
  /** The same, for an edge. The hit area is the whole edge group - the drawn stroke, its
   *  label, and the `label: {pill: true}` plate behind it - because a 1.25px stroke is a
   *  poor thing to aim at (F25/F27). */
  edgeclick: { id: string; event: unknown };
}

/** F6 — every run event (`docs/RUN.md` "Event vocabulary") is also mirrored onto the
 *  instance bus under a `run:` prefix — `g.on("run:finish", …)`, `g.on("run:end", …)` —
 *  so a listener registered on `g` outlives any number of `g.run(opts)` recompiles. The
 *  payload is the run event's own payload, passed through untouched — `unknown` here, the
 *  same as `run.on()`'s, because the run bus carries two open families of events. */
export type RunMirrorEvent = `run:${string}`;

// ---------------------------------------------------------------------------
// Opaque low-level handles exposed on `g` for advanced use (export.js reads
// g.renderer.svg/g.el/g.bounds(); everything else is intentionally loose — these are
// implementation modules, not part of the stable contract this file pins).
// ---------------------------------------------------------------------------

export interface Ticker {
  now(): number;
  add(fn: (now: number) => void): void;
  remove(fn: (now: number) => void): void;
  onDestroy?(fn: () => void): () => void;
  destroy(): void;
}

export interface Scene {
  visual: { nodes: Map<string, unknown>; edges: Map<string, unknown> };
  onFrame(cb: (visual: unknown) => void): () => void;
  commit(target: unknown, opts?: unknown): unknown;
  readonly transition: unknown;
  destroy(): void;
}

export interface Renderer {
  svg: SVGSVGElement | Element;
  viewportG: SVGGElement | Element;
  styleCommit(like: unknown): void;
  frame(visual: unknown): void;
  mark(id: string, value: string | null): void;
  /** Director emphasis (D14) — `data-emph` / `data-dim` on a node's or edge's group. */
  emphasize(id: string, value: string | null): void;
  dim(id: string, value: boolean | null): void;
  node(id: string): Element | undefined;
  edge(id: string): Element | undefined;
  destroy(): void;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface FitOpts {
  pad?: number;
  duration?: number;
  ease?: EasingFn;
  /** Pane chrome to fit inside of, in screen px (F15). */
  inset?: Inset | number;
  /** Scale lid. Defaults to 1.5 (the initial-auto-fit rule); pass 4 to frame one node. */
  maxK?: number;
}

/** A camera move in flight: awaitable, and cancelable into `{canceled:true}` (D9). */
export interface ViewportMove {
  promise: Promise<{ canceled: boolean }>;
  cancel(): void;
}

export interface Viewport {
  transform: Transform;
  /** Where a live tween is HEADING; the current transform when none is. */
  readonly target: Transform;
  userMoved: boolean;
  fit(bounds: Rect, opts?: FitOpts): Promise<{ canceled: boolean }>;
  /** The M0 spelling, still supported. */
  fit(bounds: Rect, pad?: number, animate?: boolean): Promise<{ canceled: boolean }>;
  /** Drive the camera to an absolute transform. Starting one cancels the in-flight move. */
  moveTo(to: Partial<Transform>, opts?: { duration?: number; ease?: EasingFn }): ViewportMove;
  /** Detach/attach every pointer + wheel listener in one flip (frame capture uses this). */
  setInteractive(on: boolean): void;
  /** The pane's client size. */
  size(): { w: number; h: number };
  screenToWorld(pt: Point): Point;
  worldToScreen(pt: Point): Point;
  anchor(before: Point, after: Point, duration: number): void;
  contains(bounds: Rect): boolean;
  zoomBy(factor: number, at?: Point): void;
  destroy(): void;
}

export interface ViewState {
  collapsed: Set<string>;
  isContainer(id: string): boolean;
  isVisible(id: string): boolean;
  visibleAncestor(id: string): string | null;
  expand(id: string): boolean;
  collapse(id: string): boolean;
  containers(): string[];
  expandAll(): string[];
  collapseAll(): string[];
  view(): unknown;
}

/** F37/F38 — the `{ camera }` option every relayout-producing mutation takes: the toggles
 *  (`ToggleOpts`), `addNode`/`addEdge`/`removeNode`/`removeEdge`/`update`/`layout`, and the
 *  condense/split choreographies.
 *
 *  `camera` composes a shot AGAINST THE LAYOUT THE MUTATION PRODUCES and flies it on the
 *  mutation's own clock (a storyboard step's `dur`, else the mount's `animation.duration`;
 *  the choreography's converge phase for condense/split), so the camera move and the
 *  structural motion are one tween. This replaces the pattern of chasing a mutation with a
 *  second `camera` step — `batch(addNode, addEdge)` then `camera({nodes: [prev, id]})`,
 *  `expand(id)` then `camera({fit})` — which can only start once the graph has already
 *  bloomed wherever the anchored viewport left it: two tweens where one was wanted, and a
 *  target that names ids the first step has not created yet.
 *
 *  - `true` frames the mutation's SUBJECT: the toggled container, the added or patched
 *    node (with `after`, that node and the one it hangs off), an edge's two endpoints, the
 *    merged node, the union of a split's parts. An op with no one subject — the -All
 *    toggles, a remove, `layout` — fits the whole graph.
 *  - A `CameraTarget` is a shot in its own right (`{fit: true}`, `{nodes: [...]}`,
 *    `{node, k}`…); one that names no box (`{pad: 60}`, say) frames the subject.
 *  - A FITTED scale is lidded at 1.5 like a `nodes[]` union, so a lone node is never a
 *    close-up; `k` or `maxK` on the target still wins. `dur` on the target is ignored: the
 *    shot rides the mutation's duration. `ease` on the target overrides the mount easing.
 *  - Taking the shot takes the camera (D13), exactly as `g.camera()` would: relayout stops
 *    auto-refitting, and in a storyboard the viewport joins the scrub snapshots.
 *  - Inside a `batch`, the shot is composed against the batch's one shared commit (the
 *    last child to name one wins).
 *  Absent or `false`, the mutation keeps the anchored D10 behaviour. */
export interface MutationOpts {
  camera?: boolean | CameraTarget;
}

/** `g.addNode(node, opts)`. */
export interface AddNodeOpts extends MutationOpts {
  /** Also mint the edge `e:<after>-><id>` from this node. With `camera: true` the shot
   *  frames the new node AND this one (F38). */
  after?: string;
}

/** `g.update(id, patch, opts)`. */
export interface UpdateOpts extends MutationOpts {
  /** `patch.data` REPLACES the record's `data` instead of merging into it (`data: {}` or
   *  `data: undefined` then clears it). Merging is the default either way;
   *  `data: { key: undefined }` removes a single key without it. */
  replace?: boolean;
  /** When the patch carries `collapsed` (which routes to `expand()`/`collapse()`) this is
   *  the shot option those take (`ToggleOpts`); on any other patch it frames the patched
   *  node — or an edge's endpoints — at the geometry the update produces (F38). */
  camera?: boolean | CameraTarget;
}

/** F37 — the options `expand()`, `collapse()`, `expandAll()` and `collapseAll()` take:
 *  `MutationOpts`, where `camera: true` frames the toggled container itself (`fit: true`
 *  for the -All ops, which have no one subject). A toggle that is a no-op (already in the
 *  requested state) still flies the shot, and resolves `applied: false` — re-issuing "show
 *  me this open" is idempotent rather than a warning. */
export interface ToggleOpts extends MutationOpts {}

/** The probe `g.validate(fn)` hands its callback: the structural mutation methods, run
 *  against a throwaway clone, plus the read sugar. Nothing commits, nothing renders, and
 *  a method that would have thrown records its `GraphError` instead. */
export interface ValidateProbe {
  node(id: string): NodeSpec | undefined;
  edge(id: string): EdgeSpec | undefined;
  children(id: string): NodeSpec[];
  spec(): GraphSpec;
  /** `{after}` mints the same implicit `e:<after>-><id>` edge `g.addNode()` does, so a
   *  dangling `after` reports `"dangling"` here and the edge is present for later ops. */
  addNode(node: NodeSpec, opts?: { after?: string }): void;
  addEdge(edge: EdgeSpec): void;
  removeNode(id: string): void;
  removeEdge(id: string): void;
  update(id: string, patch: Record<string, unknown>, opts?: UpdateOpts): void;
  condense(ids: Iterable<string>, node: CondenseNodeSpec): void;
  split(id: string, parts: { nodes: NodeSpec[]; edges?: EdgeSpec[] }): void;
  /** View-only — nothing commits, but an unknown id still records `"missing"`, because the
   *  real `expand()`/`collapse()` throw on one. */
  expand(id?: string, opts?: ToggleOpts): void;
  collapse(id?: string, opts?: ToggleOpts): void;
  expandAll(opts?: ToggleOpts): void;
  collapseAll(opts?: ToggleOpts): void;
  batch(fn: (probe: ValidateProbe) => void): void;
}

/** `g.validate()`'s verdict: `ok` is `errors.length === 0`. */
export interface ValidateResult {
  ok: boolean;
  errors: GraphError[];
}

// ---------------------------------------------------------------------------
// The mounted instance
// ---------------------------------------------------------------------------

export interface Graph {
  readonly version: string;
  readonly el: Element;
  readonly ticker: Ticker;
  readonly scene: Scene;
  readonly renderer: Renderer;
  readonly viewport: Viewport;
  readonly viewstate: ViewState;

  on<K extends keyof GraphEventMap>(type: K, fn: (payload: GraphEventMap[K]) => void): () => void;
  /** The wildcard listener (src/events.js): unlike every other `on()` call, `fn` is
   *  called with TWO positional arguments — the event's own type name, then its payload —
   *  not just the payload. Declared ahead of the generic `(type: string, ...)` overload
   *  below so a literal `"*"` resolves here instead of there. */
  on(type: "*", fn: (type: string, payload: unknown) => void): () => void;
  /** F6 — a mirrored run event (`docs/RUN.md` "Event vocabulary"), e.g. `"run:finish"`. */
  on(type: RunMirrorEvent, fn: (payload: unknown) => void): () => void;
  on(type: string, fn: (payload: unknown) => void): () => void;
  off<K extends keyof GraphEventMap>(type: K, fn: (payload: GraphEventMap[K]) => void): void;
  /** Same two-argument shape as the `on("*", ...)` overload above — `off()` only needs to
   *  match the function reference, but the type has to line up for callers that keep the
   *  listener in a typed variable. */
  off(type: "*", fn: (type: string, payload: unknown) => void): void;
  off(type: RunMirrorEvent, fn: (payload: unknown) => void): void;
  off(type: string, fn: (payload: unknown) => void): void;

  /** A plain copy, like every plural query method (`nodes()`, `children()`, …) — mutating
   *  the returned object does not touch the store. */
  node(id: string): NodeSpec | undefined;
  /** A plain copy — see `node()`. */
  edge(id: string): EdgeSpec | undefined;
  spec(): GraphSpec;
  bounds(): Rect | null | undefined;
  layoutResult(): LayoutResult | null;

  /** `{ after }` also mints the `after -> id` edge. F38 — `{ camera: true }` frames the new
   *  node (with `after`, the new node and the one it hangs off) in the add's own tween,
   *  against the layout the add produces (`MutationOpts`). */
  addNode(node: NodeSpec, opts?: AddNodeOpts): Awaitable<MutationResult>;
  /** F38 — `{ camera: true }` frames the edge's two endpoints in the same tween. */
  addEdge(edge: EdgeSpec, opts?: MutationOpts): Awaitable<MutationResult>;
  /** Resolves with the full removed-ids cascade (`ids.nodes`/`ids.edges`), not just
   *  `{canceled, applied}` — see `RemoveNodeResult`. F38 — `{ camera: true }` fits what is
   *  left, in the remove's own tween. */
  removeNode(id: string, opts?: MutationOpts): Awaitable<RemoveNodeResult>;
  /** F38 — `{ camera }` as on `removeNode()`. */
  removeEdge(id: string, opts?: MutationOpts): Awaitable<MutationResult>;
  /** `patch.data` merges into the record's `data`; `data: { key: undefined }` REMOVES that
   *  key, and `{ replace: true }` swaps the whole payload. A `collapsed` patch is routed to
   *  `expand()`/`collapse()` (it is view state, not a rendered spec field): a patch whose
   *  ONLY key is `collapsed` resolves like they do — `{applied: false}` when the container
   *  was already in that state — while a patch carrying anything else always resolves
   *  `{applied: true}`, since the rest of it is committed and rendered either way. A `data`
   *  left with no keys is dropped, so `node(id).data` reads `undefined` rather than `{}`. */
  update(id: string, patch: Record<string, unknown>, opts?: UpdateOpts): Awaitable<MutationResult>;

  /** Dry-run the structural guards without committing anything: every op runs against a
   *  throwaway clone of the store, and every `GraphError` they would have thrown comes back
   *  in `errors` (an op that fails just does not land in the clone; the ops after it are
   *  still checked). Takes either a `batch()`-shaped function or an array of
   *  storyboard-shaped `{op, args}` steps; director/transport steps and `label` markers are
   *  skipped, an `op` that `storyboard()` would not accept reports `"validate-op"`. */
  validate(ops: StoryboardStep[] | ((probe: ValidateProbe) => void)): ValidateResult;

  /** D5 — children bloom out of the container's previous centre. `{ camera: true }` frames
   *  the OPENED box in the same tween, so the camera never has to chase the expansion
   *  (F37, `ToggleOpts`). */
  expand(id: string, opts?: ToggleOpts): Awaitable<MutationResult>;
  /** D5 inverse — everything that just went away flies into the container's new centre.
   *  `{ camera: true }` frames the closed box; `{ camera: { fit: true } }` the whole graph. */
  collapse(id: string, opts?: ToggleOpts): Awaitable<MutationResult>;
  /** D6 — merge N nodes into one over the 3-phase choreography (highlight/converge/reveal).
   *  Resolves with the created/removed ids once the merge actually lands — see
   *  `CondenseSplitResult`. F39 — `{ camera: true }` frames the MERGED node where it lands,
   *  in the converge phase's own tween: the id does not exist before that phase, so no
   *  `camera()` call placed before or after the condense can compose the shot
   *  (`MutationOpts`). */
  condense(ids: Iterable<string>, node: CondenseNodeSpec, opts?: MutationOpts): Awaitable<CondenseSplitResult>;
  /** D6 inverse — one node becomes N (highlight/diverge/reveal). Same resolution shape as
   *  `condense()`. F39 — `{ camera: true }` frames the union of the parts in the diverge. */
  split(id: string, parts: { nodes: NodeSpec[]; edges?: EdgeSpec[] }, opts?: MutationOpts): Awaitable<CondenseSplitResult>;
  /** Every container open in ONE commit. `{ camera: true }` fits the opened graph in the
   *  same tween (F37). */
  expandAll(opts?: ToggleOpts): Awaitable<MutationResult>;
  /** The inverse: every open container closed in ONE commit. `{ camera }` as on expandAll(). */
  collapseAll(opts?: ToggleOpts): Awaitable<MutationResult>;

  /** D4 — the token run. Called with opts it (re)compiles; bare it returns the current one
   *  (compiling a default Mode A run on first call). */
  run(o: SimRunOpts): SimRun;
  run(o: LiveRunOpts): LiveRun;
  run(): Run;

  /** D8 — the JSON-op sequencer. Called with steps it (re)builds; bare it returns the
   *  current one (`undefined` if none has been built yet). */
  storyboard(steps: StoryboardStep[]): StoryboardHandle;
  storyboard(): StoryboardHandle | undefined;

  /** The transport-facing view of where the story is (also what `.smv-transport` renders from). */
  timeline(): Timeline;

  /** F36 — the "story finished" signal, as ONE promise per instance: it resolves when the
   *  storyboard runs out of steps (`{reason: "storyboard"}`), when a page calls
   *  `g.finish()`, or when the instance is destroyed (`{reason: "destroy"}`), so awaiting
   *  it can never hang. It never rejects and never re-arms. */
  readonly finished: Promise<{ reason: string }>;
  /** F36 — mark the story finished by hand: the explicit end for a live-mode or otherwise
   *  hand-driven page, which has no last storyboard step to reach. Idempotent (the first
   *  call wins) and it also emits `"finish"` on the instance bus. */
  finish(reason?: string): Graph;

  /** M4/D13 — the scripted camera. The first call hands the viewport to the script, so
   *  relayout stops auto-refitting over composed shots and viewport state joins the G2
   *  snapshot. A second call cancels-and-retargets the first (D9). */
  camera(target?: CameraTarget): Awaitable;
  /** M4/D14 — emphasis. Replace-not-accumulate: this call IS the emphasis state. */
  highlight(selection?: HighlightSelection): Graph;
  clearHighlight(): Graph;
  /** M4/D14 — the caption overlay. `null` clears it. */
  caption(text: string | null, opts?: CaptionOpts): Graph;
  /** D12 — every label and caption in the storyboard at its absolute ms offset. */
  cues(): Cue[];

  /** One relayout for many ops (batches into a single commit + awaitable). NOT
   *  transactional — `fn`'s ops land in the store as `fn` runs; batch() only defers the
   *  relayout(s) they'd each have caused alone into one shared commit. `fn` must be
   *  synchronous: a `Promise`-returning `fn` throws `GraphError` with code `"batch-async"`,
   *  since its later ops would otherwise run after batch() has already returned. */
  batch(fn: (g: Graph) => void): Awaitable<MutationResult>;

  /** User style functions set `--smv-*` custom properties only (D7). Pass `null` to clear. */
  style(fn: StyleFn | null): Graph;
  /** M4d/D16 — the per-step override layer, merged over `style()`. Replace-not-accumulate
   *  (this call IS the layer) and snapshotted like emphasis. `null` clears it. F18 —
   *  `{merge:true}` patches instead: unnamed ids keep their overrides, a `null` value drops
   *  one key and a `null` entry drops one id. */
  props(map: PropsOverride | null, opts?: PropsOpts): Graph;
  theme(t: ThemeName): Graph;
  /** Re-lay the graph out with new options (merged in place, so they persist). F38 — a
   *  second argument's `{ camera: true }` fits the re-laid drawing in the same tween: a
   *  script that owns the camera (D13) gets no auto-refit, so `layout({dir:"TB"})` alone
   *  re-flows the drawing under a shot composed for the old direction. */
  layout(o?: LayoutOpts, opts?: MutationOpts): Awaitable;
  /** `inset` defaults to the chrome the library mounted over the pane (F15); `0` opts out. */
  fitView(o?: { pad?: number; animate?: boolean; duration?: number; inset?: Inset | number }): Graph;
  destroy(): void;

  // Query sugar (M2, src/query.js) — spread onto `g`; `node`/`edge` above stay singular.
  nodes(filter?: QueryFilter<NodeSpec>): NodeSpec[];
  edges(filter?: QueryFilter<EdgeSpec>): EdgeSpec[];
  children(id: string): NodeSpec[];
  descendants(id: string): NodeSpec[];
  roots(): NodeSpec[];
}

export function mount(el: Element | string, spec?: GraphSpec, opts?: MountOpts): Graph;

export const version: string;

/** `opts.preset: 'pipeline'` inline, or `presetPipeline(g, opts)` after the fact. Applied
 *  after mount it decorates what is already on screen, but it cannot retro-fit the node
 *  measurement it wants - pass `PIPELINE_MEASURE` as `layout.measure` yourself for that. */
export function presetPipeline(g: Graph, opts?: PipelinePresetOpts): { destroy(): void };

declare const _default: { mount: typeof mount; version: string; presetPipeline: typeof presetPipeline };
export default _default;
