// Hand-written types for sparkle-motion-vizualizer's main entry (src/index.js), M2.
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

/** The shape every `GraphError` thrown by `g`'s mutation methods carries. Not a class you
 *  import — `store.js`'s `GraphError` is internal; catch it structurally instead:
 *  `catch (e) { if ((e as SmvErrorLike).code === "missing") ... }`. */
export interface SmvErrorLike extends Error {
  code: string;
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
}

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
  status: "pending" | "active" | "done";
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
  type: "enter" | "start" | "finish" | "spawn" | "join" | "drop" | "loop" | "done";
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
  type: "start" | "finish" | "spawn";
  id: string;
  n?: number;
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

export type StoryboardStep =
  | { op: "addNode"; args: [NodeSpec, ({ after?: string } | undefined)?] }
  | { op: "addEdge"; args: [EdgeSpec] }
  | { op: "removeNode"; args: [string] }
  | { op: "removeEdge"; args: [string] }
  | { op: "update"; args: [string, Record<string, unknown>] }
  | { op: "expand"; args: [string] }
  | { op: "collapse"; args: [string] }
  | { op: "condense"; args: [string[], NodeSpec] }
  | { op: "batch"; steps: StoryboardStep[] }
  | { op: "run.play"; until?: string; args?: [{ until?: string }?] }
  | { op: "run.step"; token?: string; args?: [{ token?: string }?] }
  | { op: "run.seek"; ms?: number; args?: [number] }
  | { op: "wait"; ms?: number; args?: [number] }
  | { label: string };

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
  node(id: string): Element | undefined;
  edge(id: string): Element | undefined;
  destroy(): void;
}

export interface Viewport {
  transform: { x: number; y: number; k: number };
  userMoved: boolean;
  fit(bounds: Rect, pad?: number, animate?: boolean): void;
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
  on(type: string, fn: (payload: unknown) => void): () => void;
  off<K extends keyof GraphEventMap>(type: K, fn: (payload: GraphEventMap[K]) => void): void;
  off(type: string, fn: (payload: unknown) => void): void;

  node(id: string): NodeSpec | undefined;
  edge(id: string): EdgeSpec | undefined;
  spec(): GraphSpec;
  bounds(): Rect | null | undefined;
  layoutResult(): LayoutResult | null;

  addNode(node: NodeSpec, opts?: { after?: string }): Awaitable;
  addEdge(edge: EdgeSpec): Awaitable;
  removeNode(id: string): Awaitable;
  removeEdge(id: string): Awaitable;
  update(id: string, patch: Record<string, unknown>): Awaitable;

  /** D5 — children bloom out of the container's previous centre. */
  expand(id: string): Awaitable;
  /** D5 inverse — everything that just went away flies into the container's new centre. */
  collapse(id: string): Awaitable;
  /** D6 — merge N nodes into one over the 3-phase choreography (highlight/converge/reveal). */
  condense(ids: Iterable<string>, node: NodeSpec): Awaitable;
  /** D6 inverse — one node becomes N (highlight/diverge/reveal). */
  split(id: string, parts: { nodes: NodeSpec[]; edges?: EdgeSpec[] }): Awaitable;
  /** Every container open in ONE commit. */
  expandAll(): Awaitable;
  /** The inverse: every open container closed in ONE commit. */
  collapseAll(): Awaitable;

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

  /** One relayout for many ops (batches into a single commit + awaitable). */
  batch(fn: (g: Graph) => void): Awaitable;

  /** User style functions set `--smv-*` custom properties only (D7). Pass `null` to clear. */
  style(fn: StyleFn | null): Graph;
  theme(t: ThemeName): Graph;
  layout(o?: LayoutOpts): Awaitable;
  fitView(o?: { pad?: number; animate?: boolean }): Graph;
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
