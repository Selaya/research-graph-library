// Types for `sparkle-motion-visualizer/export` (src/export.js, D11). ESM-only entry — not
// bundled into the IIFE. Kept minimal: only what exportSVG/exportPNG actually read off `g`.

import type { ThemeName } from "./index.js";

/** The minimal shape exportSVG/exportPNG need — a full `Graph` satisfies this structurally. */
export interface ExportableGraph {
  renderer: { svg: unknown };
  el?: unknown;
  /** Only read by `viewport: true`, to size the shot's viewBox. */
  viewport?: { size?(): { w: number; h: number } };
  bounds(): { x: number; y: number; w: number; h: number } | null | undefined;
}

export interface ExportSVGOpts {
  pad?: number;
  theme?: ThemeName;
  width?: number;
  /** Export the SHOT rather than the whole graph (M4c): keeps the live `.smv-viewport`
   *  pan/zoom transform and the live culling state, with the on-screen pane as the viewBox
   *  — a still that matches what is on screen (or in a `smv-record` frame). Default false,
   *  which repositions to a whole-graph viewBox and un-culls everything. `pad` is ignored. */
  viewport?: boolean;
}

export interface ExportPNGOpts extends ExportSVGOpts {
  scale?: number;
  background?: string;
}

/** Standalone SVG document string: cloned scene, fixed viewBox, themed CSS inlined. */
export function exportSVG(g: ExportableGraph, opts?: ExportSVGOpts): string;

/** Browser-only rasterization: exportSVG() -> Image -> canvas -> toBlob. Rejects under Node
 *  (no document/Image) with a plain Error. */
export function exportPNG(g: ExportableGraph, opts?: ExportPNGOpts): Promise<Blob>;
