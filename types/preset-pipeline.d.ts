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
  renderer?: { node?(id: string): unknown };
  spec(): { nodes: { id: string; parent?: string; data?: Record<string, unknown>; durationAgg?: "sum" | "max" }[] };
  on(type: string, fn: (payload: unknown) => void): (() => void) | void;
  off?(type: string, fn: (payload: unknown) => void): void;
}

/** `opts.preset: 'pipeline'` inline, or `applyPipelinePreset(g)` after the fact (also
 *  exposed from the main entry as `SparkleMotion.presetPipeline`). Decorates a mounted
 *  instance with duration chips, status/mode glyph badges, a total-duration bar and the
 *  condense reveal payoff (odometer roll + transient delta badge). */
export function applyPipelinePreset(g: PipelinePresetGraph): { destroy(): void };

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
};
export default _default;
