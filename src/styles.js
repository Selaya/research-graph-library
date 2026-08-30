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
  --smv-container:#f2f4f9;
  --smv-header:#e7eaf3;
  --smv-condense:#f0a000;
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
  --smv-container:#161b24;
  --smv-header:#222836;
  --smv-condense:#e0a53a;
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
    --smv-container:#161b24;
    --smv-header:#222836;
    --smv-condense:#e0a53a;
  }
}

svg.smv{
  display:block; width:100%; height:100%;
  background:var(--smv-bg);
  touch-action:none;              /* pan/pinch are ours; ctrl+wheel zoom is opt-in (D10) */
  cursor:grab; user-select:none;
}
svg.smv.smv-grabbing{cursor:grabbing}

.smv-node rect.smv-node-box{
  fill:var(--smv-fill);
  stroke:var(--smv-stroke);
  stroke-width:1.25;
  transition:fill .15s ease, stroke .15s ease;   /* affordance only, never choreography */
}
.smv-node text.smv-node-label{
  fill:var(--smv-text);
  font:500 13px system-ui,-apple-system,'Segoe UI',sans-serif;
  text-anchor:middle; dominant-baseline:central;
  pointer-events:none;
}
.smv-node:hover rect.smv-node-box{stroke:var(--smv-accent)}
.smv-node:focus{outline:none}
.smv-node:focus-visible rect.smv-node-box{stroke:var(--smv-accent); stroke-width:2}

.smv-node[data-status="done"]{--smv-fill:var(--smv-ok); --smv-stroke:var(--smv-ok-stroke)}
.smv-node[data-status="active"]{--smv-fill:var(--smv-active); --smv-stroke:var(--smv-active-stroke)}
.smv-node[data-mode="automated"] rect.smv-node-box{stroke-dasharray:none}

/* Containers (D5): stacked-card lip + chevron say "has substeps" at a glance (§6).
   The chrome elements are built once and kept, so they hide unless the node is a container. */
.smv-node rect.smv-node-stack,
.smv-node rect.smv-node-header,
.smv-node path.smv-node-chev,
.smv-node text.smv-node-badge{display:none}
.smv-node[data-container]{--smv-fill:var(--smv-container); cursor:pointer}
.smv-node[data-container] rect.smv-node-stack{
  display:inline; fill:var(--smv-fill); stroke:var(--smv-stroke); stroke-width:1.25; opacity:.55;
}
.smv-node[data-container] rect.smv-node-header{display:inline; fill:var(--smv-header); stroke:none}
.smv-node[data-container] path.smv-node-chev{
  display:inline; fill:none; stroke:var(--smv-muted); stroke-width:1.6;
  stroke-linecap:round; stroke-linejoin:round; pointer-events:none;
}
.smv-node[data-container][data-count] text.smv-node-badge{
  display:inline; fill:var(--smv-muted);
  font:500 11px system-ui,-apple-system,'Segoe UI',sans-serif;
  text-anchor:end; dominant-baseline:central; pointer-events:none;
}
/* An expanded container is a frame around its children, not a card on top of them. */
.smv-node[data-container]:not([data-collapsed]) rect.smv-node-box{fill:none; stroke-dasharray:none}
.smv-node[data-container]:not([data-collapsed]) rect.smv-node-stack{display:none}
.smv-node[data-container]:not([data-collapsed]) text.smv-node-label{text-anchor:start}
.smv-node[data-container][data-collapsed] rect.smv-node-header{display:none}

/* Condense phase markers (D6). Static state deltas — the sequencing is on our clock (D1). */
.smv-node[data-condense="src"]{--smv-stroke:var(--smv-condense)}
.smv-node[data-condense="src"] rect.smv-node-box{stroke-width:2.25}
.smv-node[data-condense="reveal"]{--smv-stroke:var(--smv-condense)}
.smv-node[data-condense="reveal"] rect.smv-node-box{stroke-width:2.25}

.smv-edge path.smv-edge-line{
  fill:none;
  stroke:var(--smv-edge);
  stroke-width:var(--smv-edge-width);
  stroke-linecap:round; stroke-linejoin:round;
}
.smv-edge path.smv-edge-arrow{fill:var(--smv-edge); stroke:none}
/* Edge labels (M2): muted, small, with a background-colored stroke halo (paint-order)
   so they stay legible crossing lines/nodes in both themes without a backing rect. */
.smv-edge text.smv-edge-label{
  fill:var(--smv-muted);
  font:500 10px system-ui,-apple-system,'Segoe UI',sans-serif;
  text-anchor:middle; dominant-baseline:central;
  paint-order:stroke fill;
  stroke:var(--smv-bg); stroke-width:3px; stroke-linejoin:round;
  pointer-events:none;
}
/* Back edges read as loops, not glitches: muted + dashed, a distinct visual channel (D3). */
.smv-edge[data-reversed] path.smv-edge-line{stroke-dasharray:4 3; opacity:.7}
.smv-edge[data-reversed] path.smv-edge-arrow{opacity:.7}
/* Meta-edges: N collapsed child edges to one target read as one heavier line (D5). */
.smv-edge[data-weight] path.smv-edge-line{stroke-width:calc(var(--smv-edge-width) * 2)}

/* Token decorations (D4). The layer is written per frame from stateAt(t) — these rules are
   pure appearance; every position/size/opacity comes from the one rAF loop (D1). */
.smv-tokens{pointer-events:none}
.smv-node-fill{fill:var(--smv-active-stroke); opacity:.16}
.smv-token{fill:var(--smv-accent); stroke:var(--smv-bg); stroke-width:1.5}
.smv-token[data-frozen]{opacity:.45}
.smv-ghost{fill:var(--smv-muted)}
.smv-token-badge{fill:var(--smv-muted); font:600 10px system-ui,-apple-system,'Segoe UI',sans-serif; text-anchor:end; dominant-baseline:central}
.smv-loop-badge{fill:var(--smv-condense); font:600 10px system-ui,-apple-system,'Segoe UI',sans-serif; text-anchor:middle; dominant-baseline:central}
.smv-join-pip{fill:none; stroke:var(--smv-muted); stroke-width:1.2}
.smv-join-pip[data-filled]{fill:var(--smv-accent); stroke:var(--smv-accent)}
/* Traversed edges keep a persistent progress channel: --smv-traversed is 0..1 (§6). */
.smv-edge[data-traversed] path.smv-edge-line{
  stroke:var(--smv-accent);
  stroke-width:calc(var(--smv-edge-width) * (1 + var(--smv-traversed, 0)));
}
.smv-edge[data-traversed] path.smv-edge-arrow{fill:var(--smv-accent)}
/* Run-derived node state, the token engine's mirror of data-status (never spec-written). */
.smv-node[data-run="active"]{--smv-fill:var(--smv-active); --smv-stroke:var(--smv-active-stroke)}
.smv-node[data-run="done"]{--smv-fill:var(--smv-ok); --smv-stroke:var(--smv-ok-stroke)}

/* Director emphasis (D14): discrete state, no transition — a wall clock cannot reproduce
   byte-for-byte under frame capture. */
.smv-node[data-emph] rect.smv-node-box,
.smv-edge[data-emph] path.smv-edge-line{stroke:var(--smv-emph); stroke-width:2.5}
.smv-edge[data-emph] path.smv-edge-arrow{fill:var(--smv-emph)}
.smv-node[data-emph="focus"],.smv-edge[data-emph="focus"]{--smv-emph:var(--smv-accent)}
.smv-node[data-emph="warn"],.smv-edge[data-emph="warn"]{--smv-emph:var(--smv-condense)}
.smv-node[data-emph="ok"],.smv-edge[data-emph="ok"]{--smv-emph:var(--smv-ok-stroke)}
.smv-node[data-emph="mute"],.smv-edge[data-emph="mute"]{--smv-emph:var(--smv-muted)}
/* Spotlight half of highlight({dim:true}). The opacity PROPERTY beats the per-frame
   presentation attribute render.js writes — that is what makes it stick. */
.smv-node[data-dim],.smv-edge[data-dim]{opacity:.28}

/* Caption overlay (D14) — narration, not graph content: plain HTML over the pane, never
   SVG text inside the a11y tree. Steps up over the transport like .smv-totalbar. */
.smv-caption{
  position:absolute; left:50%; bottom:12px; transform:translateX(-50%);
  max-width:80%; box-sizing:border-box; padding:6px 12px;
  border:1px solid var(--smv-stroke); border-radius:var(--smv-radius);
  background:var(--smv-container); color:var(--smv-text);
  font:500 13px system-ui,-apple-system,'Segoe UI',sans-serif; line-height:1.35;
  text-align:center; pointer-events:none;
}
.smv-caption[data-place="top"]{top:12px; bottom:auto}
.smv-caption[data-variant="note"]{color:var(--smv-muted); font-style:italic}
.smv-root.smv-has-transport .smv-caption{bottom:46px}

/* D15 — record mode: the affordance transitions above run on the wall clock, so two
   captures of one frame would differ. Kill every one of them. */
[data-smv-record] *,[data-smv-record] *::before,[data-smv-record] *::after{
  transition:none !important; animation:none !important;
}

/* Transport bar (opts.controls). Chrome, not choreography — plain HTML over the pane. */
.smv-transport{
  position:absolute; left:0; right:0; bottom:0; height:34px; box-sizing:border-box;
  display:flex; align-items:center; gap:8px; padding:0 10px;
  background:var(--smv-container); border-top:1px solid var(--smv-stroke);
  font:500 11px system-ui,-apple-system,'Segoe UI',sans-serif; color:var(--smv-muted);
}
.smv-transport-btn{
  flex:none; width:24px; height:22px; padding:0; cursor:pointer;
  background:var(--smv-fill); color:var(--smv-text);
  border:1px solid var(--smv-stroke); border-radius:5px; font-size:11px; line-height:1;
}
.smv-transport-btn:hover{border-color:var(--smv-accent)}
.smv-transport-scrub{flex:1; min-width:60px; accent-color:var(--smv-accent)}
.smv-transport-speed{
  flex:none; background:var(--smv-fill); color:var(--smv-text);
  border:1px solid var(--smv-stroke); border-radius:5px; font-size:11px; padding:1px 2px;
}
.smv-transport-label{flex:none; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
/* The preset's total-duration bar shares the bottom edge; the transport wins it. */
.smv-root.smv-has-transport .smv-totalbar{bottom:34px}
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
