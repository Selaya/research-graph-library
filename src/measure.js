// Text measurement before layout (G1): offscreen canvas measureText — no DOM reflow,
// works before mount. Node fallback is a deterministic per-char estimate so layout
// tests and golden files run without a browser.

let ctx = null;
function context2d() {
  if (ctx) return ctx;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }
  return ctx;
}

export const FONT = "500 13px system-ui, -apple-system, 'Segoe UI', sans-serif";

export function textWidth(text, font = FONT) {
  const c = context2d();
  if (c) {
    c.font = font;
    return c.measureText(text).width;
  }
  // Deterministic estimate (Node / golden files): average glyph ~7.2px at 13px weight 500.
  let w = 0;
  for (const ch of String(text)) w += /[iIl.,:'|!]/.test(ch) ? 3.6 : /[mwMW@]/.test(ch) ? 11 : 7.2;
  return w;
}

/** Truncate `text` with an ellipsis so it fits `maxWidth`. */
export function truncate(text, maxWidth, font = FONT) {
  if (textWidth(text, font) <= maxWidth) return text;
  let s = String(text);
  while (s.length > 1 && textWidth(s + "…", font) > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

export const NODE_PAD_X = 14;
export const NODE_MIN_W = 60;
export const NODE_MAX_W = 220;
export const NODE_H = 36;

/** `layout.measure` entry: a number, or a per-node function. Anything else reads as 0. */
function extraOf(v, node) {
  const n = typeof v === "function" ? v(node) : v;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/**
 * Size a plain (non-container) node from its label.
 *
 * `measure` (F22/F23 — `opts.layout.measure`) lets whatever decorates a node contribute to
 * its box: `{ extraWidth, extraHeight }`, each a number or `(node) => number`. The extra
 * width is reserved chrome, NOT label room — it comes back as `reserve`, and render.js
 * truncates the label to `w - 2*NODE_PAD_X - reserve` so a long label cannot run under a
 * chip parked in the corner. A node that declares both `w` and `h` opts out entirely.
 */
export function sizeNode(node, measure) {
  if (node.w && node.h) return { w: node.w, h: node.h, reserve: 0 };
  const label = node.label ?? node.id;
  const reserve = measure ? extraOf(measure.extraWidth, node) : 0;
  const w = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.ceil(textWidth(label)) + NODE_PAD_X * 2)) + reserve;
  const h = NODE_H + (measure ? extraOf(measure.extraHeight, node) : 0);
  return { w: node.w || w, h: node.h || h, reserve: node.w ? 0 : reserve };
}
