// Types for `sparkle-motion-vizualizer/a11y-table` (src/a11y-table.js, M2). ESM-only entry —
// the linearized `<table>` fallback, not bundled into the IIFE.

/** The minimal shape attachA11yTable/computeRows need — a full `Graph` satisfies this
 *  structurally (see index.d.ts). */
export interface A11yTableGraph {
  el?: unknown;
  spec?(): { nodes?: { id: string; label?: string; parent?: string; data?: Record<string, unknown> }[]; edges?: { source: string; target: string }[] };
  layoutResult?(): { nodes: Record<string, unknown> } | null;
  viewstate?: { isVisible?(id: string): boolean; visibleAncestor?(id: string): string | null };
  node?(id: string): { label?: string } | undefined;
  on?(type: string, fn: (payload: unknown) => void): () => void;
}

export interface A11yTableRow {
  id: string;
  label: string;
  status: string;
  duration: string;
  depth: number;
  targets: string[];
}

export interface A11yTableOpts {
  /** false (default) applies a visually-hidden clip class; true keeps the table on screen. */
  visible?: boolean;
}

export interface A11yTableHandle {
  el: Element | null;
  destroy(): void;
}

/** Pure row-model derivation: `g` -> one row per visible node. */
export function computeRows(g: A11yTableGraph): A11yTableRow[];

/** Appends a `<table>` (caption + one row per visible node) after the svg inside the mount
 *  root; kept in sync on `commit`/`update`. */
export function attachA11yTable(g: A11yTableGraph, opts?: A11yTableOpts): A11yTableHandle;

declare const _default: { attachA11yTable: typeof attachA11yTable; computeRows: typeof computeRows };
export default _default;
