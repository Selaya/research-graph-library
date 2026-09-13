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
  // Deterministic estimate (Node / golden files): average glyph ~7.2px at 13px weight 500,
  // scaled by the font's own px size so a 10px chip/edge label is not measured as a 13px one.
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const k = m ? Number(m[1]) / 13 : 1;
  let w = 0;
  for (const ch of String(text)) w += /[iIl.,:'|!]/.test(ch) ? 3.6 : /[mwMW@]/.test(ch) ? 11 : 7.2;
  return w * k;
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

/** `layout.measure` entry: a number, or a `(node, ctx)` function. Anything else reads as 0. */
function extraOf(v, node, ctx) {
  const n = typeof v === "function" ? v(node, ctx) : v;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/**
 * Size a plain (non-container) node from its label.
 *
 * `measure` (F22/F23 — `opts.layout.measure`) lets whatever decorates a node contribute to
 * its box: `{ extraWidth, extraHeight }`, each a number or `(node) => number`. The extra
 * width is reserved chrome, NOT label room — it comes back as `reserve`, and render.js
 * truncates the label to `w - 2*NODE_PAD_X - reserve` so a long label cannot run under a
 * chip parked in the corner. The reserve is added INSIDE the NODE_MAX_W clamp, so a
 * measured node still never exceeds the documented 220px maximum (past that the label
 * gives way, not the box). `ctx` — `{ nodes: Map<id, node>, cache }` — is forwarded to the
 * hooks so a hook can look at the rest of the graph (the pipeline preset needs it for a
 * durationAgg rollup chip, whose text is not on the node itself).
 *
 * A node that declares both `w` and `h` opts out entirely; one that declares only `w` keeps
 * its width but still gets the reserve, so its label clears the chrome.
 */
export function sizeNode(node, measure, ctx) {
  if (node.w && node.h) return { w: node.w, h: node.h, reserve: 0 };
  const label = node.label ?? node.id;
  const reserve = measure ? extraOf(measure.extraWidth, node, ctx) : 0;
  const w = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.ceil(textWidth(label)) + NODE_PAD_X * 2 + reserve));
  const h = NODE_H + (measure ? extraOf(measure.extraHeight, node, ctx) : 0);
  return { w: node.w || w, h: node.h || h, reserve };
}
