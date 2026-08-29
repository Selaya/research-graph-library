// D7 — one styling mechanism: this stylesheet consumes `--smv-*` custom properties and
// `data-*` attributes written at commit time. Nothing here is choreographed motion (D1):
// the only CSS transitions are hover/focus affordances.
// G8 — exactly one <style data-smv-styles> per document, however many instances mount.

export const STYLE_MARKER = "data-smv-styles";

export const CSS = `
.smv-root{position:relative; overflow:hidden; min-height:120px}

/* Defaults at specificity 0 (:where) so the dark override and any user rule win cleanly. */
:where(.smv-root){
  --smv-bg:#fbfbfd;
  --smv-fill:#ffffff;
  --smv-stroke:#ccd2de;
  --smv-text:#1b2230;
  --smv-muted:#6b7488;
  --smv-edge:#9aa3b5;
  --smv-edge-width:1.5px;
  --smv-accent:#5b6ef5;
  --smv-ok:#e8f6ec;
  --smv-ok-stroke:#4c9a63;
  --smv-active:#eef1ff;
  --smv-active-stroke:#5b6ef5;
  --smv-radius:8px;
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;
}
.smv-root[data-smv-theme="dark"]{
  --smv-bg:#11141b;
  --smv-fill:#1b2029;
  --smv-stroke:#39414f;
  --smv-text:#e6e9f0;
  --smv-muted:#98a1b3;
  --smv-edge:#5d6678;
  --smv-accent:#8b9bff;
  --smv-ok:#1a2c21;
  --smv-ok-stroke:#4f9c68;
  --smv-active:#1e2440;
  --smv-active-stroke:#8b9bff;
}
@media (prefers-color-scheme:dark){
  .smv-root[data-smv-theme="auto"]{
    --smv-bg:#11141b;
    --smv-fill:#1b2029;
    --smv-stroke:#39414f;
    --smv-text:#e6e9f0;
    --smv-muted:#98a1b3;
    --smv-edge:#5d6678;
    --smv-accent:#8b9bff;
    --smv-ok:#1a2c21;
    --smv-ok-stroke:#4f9c68;
    --smv-active:#1e2440;
    --smv-active-stroke:#8b9bff;
  }
}

svg.smv{
  display:block; width:100%; height:100%;
  background:var(--smv-bg);
  touch-action:none;              /* pan/pinch are ours; ctrl+wheel zoom is opt-in (D10) */
  cursor:grab; user-select:none;
}
svg.smv.smv-grabbing{cursor:grabbing}

.smv-node rect{
  fill:var(--smv-fill);
  stroke:var(--smv-stroke);
  stroke-width:1.25;
  transition:fill .15s ease, stroke .15s ease;   /* affordance only, never choreography */
}
.smv-node text{
  fill:var(--smv-text);
  font:500 13px system-ui,-apple-system,'Segoe UI',sans-serif;
  text-anchor:middle; dominant-baseline:central;
  pointer-events:none;
}
.smv-node:hover rect{stroke:var(--smv-accent)}
.smv-node:focus{outline:none}
.smv-node:focus-visible rect{stroke:var(--smv-accent); stroke-width:2}

.smv-node[data-status="done"]{--smv-fill:var(--smv-ok); --smv-stroke:var(--smv-ok-stroke)}
.smv-node[data-status="active"]{--smv-fill:var(--smv-active); --smv-stroke:var(--smv-active-stroke)}
.smv-node[data-mode="automated"] rect{stroke-dasharray:none}

.smv-edge path.smv-edge-line{
  fill:none;
  stroke:var(--smv-edge);
  stroke-width:var(--smv-edge-width);
  stroke-linecap:round; stroke-linejoin:round;
}
.smv-edge path.smv-edge-arrow{fill:var(--smv-edge); stroke:none}
/* Back edges read as loops, not glitches: muted + dashed, a distinct visual channel (D3). */
.smv-edge[data-reversed] path.smv-edge-line{stroke-dasharray:4 3; opacity:.7}
.smv-edge[data-reversed] path.smv-edge-arrow{opacity:.7}
`;

/** Inject the deduped global stylesheet. No-op (returns null) without a document. */
export function injectStyles(doc) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const existing = doc.querySelector ? doc.querySelector(`style[${STYLE_MARKER}]`) : null;
  if (existing) return existing;
  const head = doc.head || doc.documentElement;
  if (!head) return null;
  const el = doc.createElement("style");
  el.setAttribute(STYLE_MARKER, "");
  el.textContent = CSS;
  head.appendChild(el);
  return el;
}
