// `sparkle-motion-vizualizer/adapters/dagre` — the optional M0–M2 layout engine, kept
// alive behind the M3 solver seam. Requires the optional peer `@dagrejs/dagre`.

import type {
  LayoutOpts,
  LayoutResult,
  LayoutViewEdge,
  LayoutViewNode,
  SolverInput,
  SolverResult,
} from "./index.js";

export type { SolverInput, SolverResult };

/** The view `layout()` takes: the same node/edge shape, cycles and self-loops allowed. */
export interface LayoutView {
  nodes: LayoutViewNode[];
  edges: Array<LayoutViewEdge & { loop?: boolean; maxIterations?: number }>;
}

/** The solver contract implemented on dagre — drop into `LayoutOpts.solver`. */
export function dagreSolver(input: SolverInput, opts?: LayoutOpts): SolverResult;

/** `layout()` with dagre in the solver slot; identical shell behaviour and result shape. */
export function dagreLayout(view: LayoutView, opts?: LayoutOpts): LayoutResult;

declare const _default: {
  dagreSolver: typeof dagreSolver;
  dagreLayout: typeof dagreLayout;
};
export default _default;
