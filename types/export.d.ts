// Types for `sparkle-motion-vizualizer/export` (src/export.js, D11). ESM-only entry — not
// bundled into the IIFE. Kept minimal: only what exportSVG/exportPNG actually read off `g`.

import type { ThemeName } from "./index.js";

/** The minimal shape exportSVG/exportPNG need — a full `Graph` satisfies this structurally. */
export interface ExportableGraph {
  renderer: { svg: unknown };
  el?: unknown;
  bounds(): { x: number; y: number; w: number; h: number } | null | undefined;
}

export interface ExportSVGOpts {
  pad?: number;
  theme?: ThemeName;
  width?: number;
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
