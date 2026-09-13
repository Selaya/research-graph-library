// Types for `sparkle-motion-visualizer/preset-pipeline` (src/preset-pipeline.js, §6). ESM-only
// entry — the pipeline preset ships as a separate module (own stylesheet, own marker) so a
// core-only page never has to load it.

/** The minimal shape applyPipelinePreset needs — a full `Graph` satisfies this structurally
 *  (see index.d.ts). */
export interface PipelinePresetGraph {
  el?: unknown;
  ticker: {
    now(): number;
    add(fn: (now: number) => void): void;
    remove(fn: (now: number) => void): void;
  };
  renderer?: { node?(id: string): unknown; edge?(id: string): unknown };
  spec(): {
    nodes: { id: string; parent?: string; data?: Record<string, unknown>; durationAgg?: "sum" | "max" }[];
    edges?: { id: string; source?: string; target?: string; loop?: boolean; data?: Record<string, unknown> }[];
  };
  on(type: string, fn: (payload: unknown) => void): (() => void) | void;
  off?(type: string, fn: (payload: unknown) => void): void;
}

export interface PipelinePresetOpts {
  /** What the total-duration bar reports (F24). `'sum'` adds up the declared work,
   *  `'critical'` is the longest chain through the graph, `'both'` (the default) shows the
   *  sum with the critical path named beside it — and falls back to the bare sum when the
   *  two are equal. */
  total?: "sum" | "critical" | "both";
}

/** `opts.preset: 'pipeline'` inline, or `applyPipelinePreset(g)` after the fact (also
 *  exposed from the main entry as `SparkleMotion.presetPipeline`). Decorates a mounted
 *  instance with duration chips, status/mode glyph badges, edge-duration chips, a
 *  total-duration bar and the condense reveal payoff (odometer roll + delta badge). */
export function applyPipelinePreset(g: PipelinePresetGraph, opts?: PipelinePresetOpts): { destroy(): void };

/** The longest chain of declared work through the spec — the other half of what the total
 *  bar can report (F24). Edge-collapsed onto top-level ancestors, `loop: true` excluded.
 *  `null` when the spec has no top-level nodes. */
export function criticalPathSec(
  spec: { nodes?: unknown[]; edges?: unknown[] },
  cache?: Map<string, number | null>,
): number | null;

/** What the preset needs reserved on every node it decorates, in the shape
 *  `opts.layout.measure` takes (F22/F23). `mount(..., {preset: 'pipeline'})` installs it
 *  unless the caller supplied their own; pass it by hand alongside `presetPipeline(g)`. */
export const PIPELINE_MEASURE: {
  extraWidth(node: { data?: Record<string, unknown> }): number;
  extraHeight(node: { data?: Record<string, unknown> }): number;
};

/** The edge-label truncation cap the preset installs when the caller set none (F26). */
export const PIPELINE_EDGE_LABEL_MAX_W: number;

/** Injects the preset's own deduped stylesheet into `doc` (a no-op past the first call, or
 *  when `doc` has no `<head>`). Returns the `<style>` element, or `null`. */
export function injectPresetStyles(doc: Document | null | undefined): Element | null;

/** number(sec) | "2h" | ... -> "2h"/"8s"/"1.5m"/"300ms" short form. "" when absent/invalid. */
export function formatDuration(sec: number | string | null | undefined): string;

/** durationAgg 'sum'|'max' over child seconds (non-finite entries ignored); null if none. */
export function aggregateDuration(seconds: (number | null | undefined)[], mode?: "sum" | "max"): number | null;

/** "−99.9% · 900× faster" (the D6 reveal payoff). "" when sourceSec is missing/non-positive. */
export function deltaBadgeText(sourceSec: number, targetSec: number): string;

declare const _default: {
  applyPipelinePreset: typeof applyPipelinePreset;
  injectPresetStyles: typeof injectPresetStyles;
  formatDuration: typeof formatDuration;
  aggregateDuration: typeof aggregateDuration;
  deltaBadgeText: typeof deltaBadgeText;
  criticalPathSec: typeof criticalPathSec;
  PIPELINE_MEASURE: typeof PIPELINE_MEASURE;
};
export default _default;
