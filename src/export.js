// exportSVG / exportPNG (M2, D11). ESM-only entry — NOT bundled into the IIFE.
// exportSVG is pure string-assembly wherever possible so it is testable under Node with
// a minimal fake svg element (cloneNode/getAttribute/setAttribute/querySelector +
// outerHTML, or a real XMLSerializer in the browser). exportPNG is browser-only.

import { CSS } from "./styles.js";

const r2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

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
 */
export function exportSVG(g, opts = {}) {
  if (!g || !g.renderer || !g.renderer.svg) {
    throw new Error("[smv:export] exportSVG needs a mounted instance (g.renderer.svg missing)");
  }
  const pad = opts.pad ?? 24;
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

  const x = (bounds.x || 0) - pad;
  const y = (bounds.y || 0) - pad;
  const w = Math.max(0, (bounds.w || 0) + pad * 2);
  const h = Math.max(0, (bounds.h || 0) + pad * 2);
  clone.setAttribute("viewBox", `${r2(x)} ${r2(y)} ${r2(w)} ${r2(h)}`);

  const width = opts.width != null ? Math.max(1, Math.round(opts.width)) : Math.max(1, Math.round(w));
  const height =
    opts.width != null && w > 0 ? Math.max(1, Math.round((opts.width * h) / w)) : Math.max(1, Math.round(h));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  // Reset pan/zoom: the export renders the whole graph via the viewBox above, not
  // whatever the live viewport happened to be scrolled/zoomed to.
  const viewportG = typeof clone.querySelector === "function" ? clone.querySelector(".smv-viewport") : null;
  if (viewportG && typeof viewportG.removeAttribute === "function") viewportG.removeAttribute("transform");

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
