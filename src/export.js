// exportSVG / exportPNG (M2, D11). ESM-only entry — NOT bundled into the IIFE.
// exportSVG is pure string-assembly wherever possible so it is testable under Node with
// a minimal fake svg element (cloneNode/getAttribute/setAttribute/querySelector +
// outerHTML, or a real XMLSerializer in the browser). exportPNG is browser-only.

import { CSS } from "./styles.js";

const r2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** The on-screen pane in CSS px — the viewBox of a `viewport:true` (shot) export.
 *  `g.viewport.size()` is the very measurement the live transform was computed against;
 *  the element's own box is the fallback for a partial `g` (a test double, a renderer used
 *  without a mount), and 800x600 is viewport.js's own last resort. */
function paneSize(g, svgEl) {
  const vp = g.viewport;
  if (vp && typeof vp.size === "function") {
    const s = vp.size();
    if (s && s.w > 0 && s.h > 0) return { w: s.w, h: s.h };
  }
  const r = svgEl && typeof svgEl.getBoundingClientRect === "function" ? svgEl.getBoundingClientRect() : null;
  if (r && r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
  if (svgEl && svgEl.clientWidth > 0 && svgEl.clientHeight > 0) return { w: svgEl.clientWidth, h: svgEl.clientHeight };
  return { w: 800, h: 600 };
}

function serialize(el) {
  if (typeof XMLSerializer !== "undefined") {
    try {
      return new XMLSerializer().serializeToString(el);
    } catch {
      /* fall through to outerHTML */
    }
  }
  if (typeof el.outerHTML === "string") return el.outerHTML;
  throw new Error("[smv:export] cannot serialize svg element (no XMLSerializer/outerHTML)");
}

/**
 * exportSVG(g, opts) -> string — a standalone SVG document: the live scene cloned,
 * repositioned to a fixed viewBox (independent of the current pan/zoom), themed CSS
 * inlined, ready to save or paste as a `.svg` file.
 *
 * `opts.viewport: true` (M4c) exports THE SHOT INSTEAD: the frame as it is on screen right
 * now — same pan/zoom, same culling — for a still that matches a recorded video or a live
 * demo. Default false; the whole-graph document above is what an export means otherwise.
 */
export function exportSVG(g, opts = {}) {
  if (!g || !g.renderer || !g.renderer.svg) {
    throw new Error("[smv:export] exportSVG needs a mounted instance (g.renderer.svg missing)");
  }
  const asShot = opts.viewport === true;
  const pad = asShot ? 0 : (opts.pad ?? 24);
  const src = g.renderer.svg;
  const bounds = (typeof g.bounds === "function" && g.bounds()) || { x: 0, y: 0, w: 0, h: 0 };

  const clone = typeof src.cloneNode === "function" ? src.cloneNode(true) : src;

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  // The mount root (not the svg) normally carries .smv-root + data-smv-theme, which is
  // where the themed custom properties (`:where(.smv-root)` / `[data-smv-theme]`) resolve
  // from — a standalone export has no separate root, so fold both onto the svg itself.
  const existingClass = (clone.getAttribute && clone.getAttribute("class")) || "smv";
  const classes = existingClass.split(/\s+/).filter(Boolean);
  if (!classes.includes("smv-root")) classes.push("smv-root");
  clone.setAttribute("class", classes.join(" "));

  const rootEl = g.el || g.root;
  const theme =
    opts.theme ||
    (rootEl && typeof rootEl.getAttribute === "function" && rootEl.getAttribute("data-smv-theme")) ||
    "auto";
  clone.setAttribute("data-smv-theme", theme);

  // In shot mode the viewBox is the PANE, not the graph: the .smv-viewport transform below
  // stays in place, so the document's coordinate space has to be the same screen-pixel box
  // that transform was computed against, or the kept pan/zoom would land somewhere else.
  const pane = asShot ? paneSize(g, src) : null;
  const x = pane ? 0 : (bounds.x || 0) - pad;
  const y = pane ? 0 : (bounds.y || 0) - pad;
  const w = pane ? pane.w : Math.max(0, (bounds.w || 0) + pad * 2);
  const h = pane ? pane.h : Math.max(0, (bounds.h || 0) + pad * 2);
  clone.setAttribute("viewBox", `${r2(x)} ${r2(y)} ${r2(w)} ${r2(h)}`);

  const width = opts.width != null ? Math.max(1, Math.round(opts.width)) : Math.max(1, Math.round(w));
  const height =
    opts.width != null && w > 0 ? Math.max(1, Math.round((opts.width * h) / w)) : Math.max(1, Math.round(h));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  // Reset pan/zoom: the export renders the whole graph via the viewBox above, not
  // whatever the live viewport happened to be scrolled/zoomed to.
  //
  // …unless `viewport:true`, where BOTH of the next two steps deliberately invert. Keeping
  // the transform and keeping the culling is the same decision twice, and it is not an
  // oversight to be tidied away: the two defaults below exist because a whole-graph
  // document that shows only what was on screen is a bug (a silently near-empty file
  // whenever the user was zoomed in). Shot mode asks for the opposite document — "the
  // frame I am looking at" — where the transform IS the framing and the culled elements
  // are, by definition, outside it. Un-culling here would not add anything visible; it
  // would only pour every off-screen node back into a document that clips them anyway,
  // which is the whole cost the culling avoids on a 300-node graph. Change one of these
  // two and you must change the other.
  const viewportG = typeof clone.querySelector === "function" ? clone.querySelector(".smv-viewport") : null;
  if (!asShot && viewportG && typeof viewportG.removeAttribute === "function") viewportG.removeAttribute("transform");

  // Undo viewport culling (M3): render.js hides whatever is off screen on the LIVE elements
  // (`data-culled` + inline display:none), and this is a clone of those. Resetting the
  // viewBox alone would then produce a document that claims to show the whole graph while
  // most of it is still display:none — a silently near-empty .svg/.png whenever the user
  // happened to be zoomed in. A standalone export always draws everything.
  const culled = !asShot && typeof clone.querySelectorAll === "function" ? clone.querySelectorAll("[data-culled]") : null;
  if (culled) {
    for (const el of Array.from(culled)) {
      if (typeof el.removeAttribute === "function") el.removeAttribute("data-culled");
      if (el.style) el.style.display = "";
    }
  }

  // Interaction-only affordances have no meaning in a static document (transport/pan
  // cursor state already lives outside the svg, on the mount root, so there is nothing
  // there to strip — just the live element's own focus/keyboard wiring).
  if (typeof clone.removeAttribute === "function") clone.removeAttribute("tabindex");

  let out = serialize(clone);
  // Inline the theme stylesheet. Done as a string splice (rather than a real DOM
  // insertion) so this path works identically whether `clone` is a real SVGElement or a
  // minimal test double that only implements outerHTML.
  const styleTag = `<style>${CSS}</style>`;
  out = /<svg\b[^>]*>/.test(out) ? out.replace(/<svg\b[^>]*>/, (m) => m + styleTag) : styleTag + out;
  return out;
}

/**
 * exportPNG(g, opts) -> Promise<Blob> — browser-only rasterization: exportSVG() -> data
 * URL -> Image -> canvas -> toBlob. Rejects with a clear Error under Node.
 */
export function exportPNG(g, opts = {}) {
  return new Promise((resolve, reject) => {
    if (
      typeof document === "undefined" ||
      typeof document.createElement !== "function" ||
      typeof Image === "undefined"
    ) {
      reject(new Error("[smv:export] exportPNG requires a browser environment (no document/Image)"));
      return;
    }
    let svgString;
    try {
      svgString = exportSVG(g, opts);
    } catch (err) {
      reject(err);
      return;
    }
    const scale = opts.scale ?? 2;
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 1;
        const h = img.naturalHeight || img.height || 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("[smv:export] canvas 2d context unavailable"));
          return;
        }
        if (opts.background) {
          ctx.fillStyle = opts.background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (typeof canvas.toBlob !== "function") {
          reject(new Error("[smv:export] canvas.toBlob unavailable"));
          return;
        }
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("[smv:export] canvas.toBlob returned null"));
        }, "image/png");
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("[smv:export] failed to rasterize svg"));
    img.src = dataUrl;
  });
}
