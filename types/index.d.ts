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
  /** Free-form payload. Two keys are read by the Mode A run engine (src/run.js):
   *  - `duration`: `"2h" | "45m" | "8s" | "300ms" | 12` (bare number = seconds) — paces
   *    the dwell. Unparseable or negative values warn and fall back to the default.
   *  - `fail`: truthy = this step runs its dwell and then FAILS — status `'failed'`, no
   *    fan-out to its successors, a `'fail'` run event. A string value is carried through
   *    as that event's `reason`. (Mode B's equivalent is `LiveRun.fail(id)`.) */
  data?: Record<string, unknown>;
  /** Container starts collapsed. */
  collapsed?: boolean;
  join?: JoinPolicy;
  type?: string;
  iterate?: unknown;
  children?: unknown;
  /** Container/collapsed-group duration rollup (preset-pipeline). */
  durationAgg?: "sum" | "max";
  w?: number;
  h?: number;
  groups?: unknown;
  [key: string]: unknown;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  /** Back/retry edge; requires `maxIterations` (D3/D4). */
  loop?: boolean;
  maxIterations?: number;
  label?: string;
  data?: Record<string, unknown>;
  /** Meta-edge aggregation weight (>1 renders as a heavier line + badge). */
  weight?: number;
  [key: string]: unknown;
}

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
  | "batch-async";

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
}

// ---------------------------------------------------------------------------
// The layout solver seam (M3): layout() is a shell around a pluggable solver.
// Default is the in-house engine; `sparkle-motion-visualizer/adapters/dagre`
// supplies the same contract on top of the optional @dagrejs/dagre peer.
// ---------------------------------------------------------------------------

export interface LayoutViewNode {
  id: string;
  w?: number;
  h?: number;
  parent?: string;
}

export interface LayoutViewEdge {
  id: string;
  source: string;
  target: string;
}

/** What the shell hands a solver: acyclic, and no edge incident to a node with children. */
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
}

export type LayoutSolver = (input: SolverInput, opts: LayoutOpts) => SolverResult;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ThemeName = "auto" | "light" | "dark";
export type EasingName = "linear" | "cubic-out" | "cubic-in-out" | "overshoot";
export type EasingFn = (t: number) => number;

export interface LayoutOpts {
  dir?: "LR" | "TB" | "RL" | "BT";
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
   * Engine-only: the dagre adapter ignores it. `null` (or anything that is not an array)
   * turns it off.
   */
  componentOrder?: Array<string | string[]> | null;
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
  /** `'pipeline'` applies the bundled preset (duration chips, status glyphs, odometer). */
  preset?: "pipeline";
  /** ARIA + keyboard is on by default; pass `false` to opt out. */
  a11y?: boolean;
  /** Pointer interactions. `tapToggle` (tap/click a container to expand/collapse) is on
   *  by default; pass `{ tapToggle: false }` to opt out. */
  interaction?: { tapToggle?: boolean };
  storyboard?: StoryboardStep[];
  autoplay?: boolean;
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
export type StyleFn = (node: NodeSpec) => Record<string, string | number> | null | undefined;

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
  [key: string]: unknown;
}

export interface Sim {
  duration: number;
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
}
export interface LiveRunOpts extends RunOptsBase {
  mode: "live";
  /** Re-seed the live event log (re-seeding/tests). The frontier starts at the seeded
   *  log's own span, so the events handed in are immediately reachable. */
  log?: LiveEvent[];
}
export type RunOpts = SimRunOpts | LiveRunOpts;

/** Surface shared by both engines (run-transport.js). */
export interface RunControllerBase {
  play(o?: { until?: string }): Promise<{ canceled: boolean }>;
  pause(): number;
  seek(ms: number): number;
  /** `{branch}` is per-token in Mode A, a documented no-op in Mode B (§5.4). */
  speed(factor: number, o?: { branch?: string }): number;
  step(o?: { token?: string }): number;
  /** First moment `nodeId` finishes — what a `run.play({until})` storyboard step is worth. */
  timeOf(nodeId: string): number;
  /** In-place re-seat (recompile/reseed + silent resync); used by storyboard restore (G2). */
  reset(o?: Record<string, unknown>, time?: number): number;
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
export type SimRun = RunControllerBase;

/** Mode B — event-log/replayed. `t` can never exceed `now()`; `following` tracks it live. */
export interface LiveRun extends RunControllerBase {
  start(id: string, o?: { at?: number }): number;
  finish(id: string, o?: { at?: number; n?: number }): number;
  /** Terminal sibling of `finish`: consumes every current occupant of `id` WITHOUT fanning
   *  tokens out (the branch dies), leaves the node on status `'failed'`, and emits a
   *  `'fail'` bus event `{id, t, reason?}`. Logged like any other entry, so it replays,
   *  time-travels and self-heals the same way. Returns the stamped time.
   *  No `n`: a failure is not partial. On a node with zero occupancy it warns and is a
   *  no-op, exactly as `finish` is. */
  fail(id: string, o?: { at?: number; reason?: string }): number;
  spawn(id: string, n: number, o?: { at?: number }): number;
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

/** Where a `camera` op is pointed. First match wins, in declaration order: absolute
 *  `x`/`y` -> `node` -> `nodes` -> `fit` -> relative `zoom`/`by`. */
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
 *  it; only `--smv-*` keys are accepted (D7) and anything else throws. */
export type PropsOverride = Record<string, Record<string, string | number | false | null>>;

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
 *  all read the same number. Omitted, the op's own default applies. */
export type StoryboardStep = { dur?: number } & (
  | { op: "addNode"; args: [NodeSpec, ({ after?: string } | undefined)?] }
  | { op: "addEdge"; args: [EdgeSpec] }
  | { op: "removeNode"; args: [string] }
  | { op: "removeEdge"; args: [string] }
  | { op: "update"; args: [string, Record<string, unknown>] }
  | { op: "expand"; args: [string] }
  | { op: "collapse"; args: [string] }
  | { op: "condense"; args: [string[], NodeSpec] }
  | { op: "split"; args: [string, { nodes: NodeSpec[]; edges?: EdgeSpec[] }] }
  | { op: "batch"; steps: StoryboardStep[] }
  | { op: "run.play"; until?: string; args?: [{ until?: string }?] }
  | { op: "run.step"; token?: string; args?: [{ token?: string }?] }
  | { op: "run.seek"; ms?: number; args?: [number] }
  | { op: "wait"; ms?: number; args?: [number] }
  | { op: "camera"; args: [CameraTarget] }
  | { op: "highlight"; args: [HighlightSelection] }
  | { op: "clearHighlight"; args?: [] }
  | { op: "caption"; args: [string | null, CaptionOpts?] }
  | { op: "props"; args: [PropsOverride | null] }
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
   *  accessible name in step with the live/simulated run. */
  runstatus: { id: string; status: "pending" | "active" | "done" };
}

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
  on(type: string, fn: (payload: unknown) => void): () => void;
  off<K extends keyof GraphEventMap>(type: K, fn: (payload: GraphEventMap[K]) => void): void;
  /** Same two-argument shape as the `on("*", ...)` overload above — `off()` only needs to
   *  match the function reference, but the type has to line up for callers that keep the
   *  listener in a typed variable. */
  off(type: "*", fn: (type: string, payload: unknown) => void): void;
  off(type: string, fn: (payload: unknown) => void): void;

  /** A plain copy, like every plural query method (`nodes()`, `children()`, …) — mutating
   *  the returned object does not touch the store. */
  node(id: string): NodeSpec | undefined;
  /** A plain copy — see `node()`. */
  edge(id: string): EdgeSpec | undefined;
  spec(): GraphSpec;
  bounds(): Rect | null | undefined;
  layoutResult(): LayoutResult | null;

  addNode(node: NodeSpec, opts?: { after?: string }): Awaitable<MutationResult>;
  addEdge(edge: EdgeSpec): Awaitable<MutationResult>;
  /** Resolves with the full removed-ids cascade (`ids.nodes`/`ids.edges`), not just
   *  `{canceled, applied}` — see `RemoveNodeResult`. */
  removeNode(id: string): Awaitable<RemoveNodeResult>;
  removeEdge(id: string): Awaitable<MutationResult>;
  update(id: string, patch: Record<string, unknown>): Awaitable<MutationResult>;

  /** D5 — children bloom out of the container's previous centre. */
  expand(id: string): Awaitable<MutationResult>;
  /** D5 inverse — everything that just went away flies into the container's new centre. */
  collapse(id: string): Awaitable<MutationResult>;
  /** D6 — merge N nodes into one over the 3-phase choreography (highlight/converge/reveal).
   *  Resolves with the created/removed ids once the merge actually lands — see
   *  `CondenseSplitResult`. */
  condense(ids: Iterable<string>, node: NodeSpec): Awaitable<CondenseSplitResult>;
  /** D6 inverse — one node becomes N (highlight/diverge/reveal). Same resolution shape as
   *  `condense()`. */
  split(id: string, parts: { nodes: NodeSpec[]; edges?: EdgeSpec[] }): Awaitable<CondenseSplitResult>;
  /** Every container open in ONE commit. */
  expandAll(): Awaitable<MutationResult>;
  /** The inverse: every open container closed in ONE commit. */
  collapseAll(): Awaitable<MutationResult>;

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
   *  (this call IS the layer) and snapshotted like emphasis. `null` clears it. */
  props(map: PropsOverride | null): Graph;
  theme(t: ThemeName): Graph;
  layout(o?: LayoutOpts): Awaitable;
  fitView(o?: { pad?: number; animate?: boolean; duration?: number }): Graph;
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

/** `opts.preset: 'pipeline'` inline, or `presetPipeline(g)` after the fact. */
export function presetPipeline(g: Graph): { destroy(): void };

declare const _default: { mount: typeof mount; version: string; presetPipeline: typeof presetPipeline };
export default _default;
