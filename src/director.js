// M4 — the director: scripted camera targeting, emphasis state and the caption overlay.
//
// D12/D13/D14. Same `internals`-taking contract as condense-anim.js, for the same reason:
// nothing here imports the renderer or reaches for a global document, so it runs against a
// fake host in tests. index.js owns the viewport, the ticker and `reduced`; this module
// owns only WHERE the camera should go and WHAT is currently emphasised.
//
// D14 — emphasis and captions are discrete state, not motion: data-* flips and one DOM
// overlay, snapshotted alongside the spec (G2) and never tweened. A CSS transition here
// would run on the wall clock, which the frame renderer (M4b) cannot reproduce.

import { MIN_K, MAX_K } from "./viewport.js";
import { GraphError } from "./store.js";

const FIT_PAD = 24;

/** M4d — the attention pulse (D17). One full breath, quantized into PULSE_STEPS buckets so
 *  a frame's intensity is a function of the tick count and nothing else: the same tick
 *  sequence writes the same string, which is what lets the frame renderer reproduce it
 *  without the `data-smv-record` transition kill-switch having anything to kill. */
const PULSE_MS = 1400;
const PULSE_STEPS = 12;

/** The camera's scale lid is the viewport's, not fit()'s FIT_MAX_K. It has to be applied
 *  HERE and not left to setTo(): setTo clamps `k` but copies x/y verbatim, so centring a
 *  box at an unclamped k lands the shot off by the clamp ratio (a normal 120×36 node fits
 *  a 900px pane at k≈6, which clamped to 4 puts the node right off the screen). */
const clampK = (k) => Math.max(MIN_K, Math.min(MAX_K, k));

/** Union of the layout boxes of `ids`, as a top-left rect. Null when none of them exist —
 *  layout.js stores centre-origin {x,y,w,h}, so the corners come out of the half-extents. */
function boundsOf(layoutResult, ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const nodes = (layoutResult && layoutResult.nodes) || null;
  for (const id of ids) {
    const r = nodes && nodes[id];
    if (!r) continue;
    x0 = Math.min(x0, r.x - r.w / 2); y0 = Math.min(y0, r.y - r.h / 2);
    x1 = Math.max(x1, r.x + r.w / 2); y1 = Math.max(y1, r.y + r.h / 2);
  }
  return x1 > -Infinity ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * resolveCameraTarget(opts, layoutResult, size, current) -> {x,y,k} — PURE.
 *
 * Resolution order, first match wins:
 *   absolute `x`/`y` (+ optional `k`) -> `node` -> `nodes` -> `fit:true` -> relative
 *   `zoom`/`k` + `by:{dx,dy}`.
 * A box target centres the box; `k` on it is an explicit scale, and without one the box is
 * fitted to the pane with `pad`. Relative moves compose onto `current` — which index.js
 * passes as viewport.target, the frame the move is actually written into, never a mid-tween
 * sample (the same reasoning viewport.anchor spells out). An unknown node id resolves to
 * "stay put" rather than flying the camera to the origin. Every derived `k` is clamped to
 * the viewport's MIN_K..MAX_K first, so the x/y that centre the shot are computed from the
 * scale the viewport will really apply (absolute x/y are the caller's own and pass through).
 */
export function resolveCameraTarget(opts = {}, layoutResult = null, size = { w: 800, h: 600 }, current = { x: 0, y: 0, k: 1 }) {
  const W = size && size.w > 0 ? size.w : 800;
  const H = size && size.h > 0 ? size.h : 600;
  const k0 = Number.isFinite(current.k) && current.k > 0 ? current.k : 1;
  const cx0 = Number.isFinite(current.x) ? current.x : 0;
  const cy0 = Number.isFinite(current.y) ? current.y : 0;

  if (Number.isFinite(opts.x) || Number.isFinite(opts.y)) {
    return {
      x: Number.isFinite(opts.x) ? opts.x : cx0,
      y: Number.isFinite(opts.y) ? opts.y : cy0,
      k: Number.isFinite(opts.k) ? opts.k : k0,
    };
  }

  let box = null;
  if (opts.node != null) box = boundsOf(layoutResult, [opts.node]);
  else if (Array.isArray(opts.nodes)) box = boundsOf(layoutResult, opts.nodes);
  else if (opts.fit === true) box = (layoutResult && layoutResult.bounds) || null;
  if (box) {
    const pad = Number.isFinite(opts.pad) ? opts.pad : FIT_PAD;
    let k = opts.k;
    if (!Number.isFinite(k)) {
      k = Math.min((W - 2 * pad) / Math.max(box.w, 1), (H - 2 * pad) / Math.max(box.h, 1));
      if (!Number.isFinite(k) || k <= 0) k = 1;
    }
    k = clampK(k);
    return { x: W / 2 - (box.x + box.w / 2) * k, y: H / 2 - (box.y + box.h / 2) * k, k };
  }

  // Relative. A zoom keeps whatever is under the pane centre under the pane centre, so
  // `zoom:1.6` reads as "lean in on this", not "lean in on the world origin".
  let k = Number.isFinite(opts.k) ? opts.k : k0;
  if (Number.isFinite(opts.zoom) && opts.zoom > 0) k = k0 * opts.zoom;
  k = clampK(k);                       // same reason: the pane centre must hold at the k
  const f = k / k0;                    // the viewport will actually apply, not the asked-for one
  let x = W / 2 - (W / 2 - cx0) * f;
  let y = H / 2 - (H / 2 - cy0) * f;
  if (opts.by) {                       // screen-space nudge, in px, applied last
    if (Number.isFinite(opts.by.dx)) x += opts.by.dx;
    if (Number.isFinite(opts.by.dy)) y += opts.by.dy;
  }
  return { x, y, k };
}

/**
 * createDirector(internals) -> the emphasis + caption state machine.
 *   internals = { root, doc, lastLayout(), emphasize(id, value), dim(id, value), captions,
 *                 ticker, reduced }
 * `captions:false` suppresses the overlay only — the caption text is still state, still
 * snapshotted, and still shows up in g.cues(), so a suppressed run still renders subtitles.
 */
export function createDirector(internals = {}) {
  const emph = new Map();      // id -> variant, the DESIRED state
  const dimmed = new Set();
  const wroteE = new Map();    // id -> variant currently written to the DOM
  const wroteD = new Set();
  const props = new Map();     // id -> {--smv-*: value}, the DESIRED override layer (D16)
  const wroteP = new Map();    // id -> the keys the last layer handed to the renderer
  let caption = null;          // {text, place?, variant?}
  let capEl = null;
  let pulsing = false;
  let destroyed = false;

  const emphasize = (id, v) => internals.emphasize && internals.emphasize(id, v);
  const setDim = (id, v) => internals.dim && internals.dim(id, v);

  /** Push the desired state onto the DOM, writing only what actually differs. `force`
   *  re-asserts everything: render.js builds a FRESH <g> for a re-added id, so a commit
   *  that revives an emphasised node hands back a blank element. */
  function apply(force) {
    if (force) { wroteE.clear(); wroteD.clear(); }
    for (const id of [...wroteE.keys()]) if (!emph.has(id)) emphasize(id, null);
    for (const [id, v] of emph) if (wroteE.get(id) !== v) emphasize(id, v);
    for (const id of [...wroteD]) if (!dimmed.has(id)) setDim(id, null);
    for (const id of dimmed) if (!wroteD.has(id)) setDim(id, true);
    wroteE.clear();
    for (const [id, v] of emph) wroteE.set(id, v);
    wroteD.clear();
    for (const id of dimmed) wroteD.add(id);
  }

  /** Everything the last layout drew — what a spotlight dims around its subject. */
  function drawnIds() {
    const res = typeof internals.lastLayout === "function" ? internals.lastLayout() : null;
    if (!res) return [];
    return [...Object.keys(res.nodes || {}), ...Object.keys(res.edges || {})];
  }

  // ---- the pulse (D17) -------------------------------------------------------------
  // A gentle attention beat on whatever is emphasised, and NOT a CSS animation: the one
  // shared ticker (D1) drives it, exactly like every other moving thing here, so under a
  // manual clock the same tick sequence produces the same DOM and the frame renderer needs
  // no kill-switch. One custom property on the mount root carries it — the CSS reads
  // `var(--smv-pulse, 0)`, so "not pulsing" and "unset" are the same picture.
  function writePulse(v) {
    const st = internals.root && internals.root.style;
    if (!st) return;
    if (v == null) st.removeProperty("--smv-pulse");
    else st.setProperty("--smv-pulse", String(v));
  }

  let pulseT0 = 0;
  function onPulse(now) {
    const p = ((now - pulseT0) % PULSE_MS) / PULSE_MS;
    // Bucketed, not continuous: a float of the raw cosine would make one frame's markup
    // depend on the exact tick arithmetic. 0..1 in PULSE_STEPS discrete stops.
    writePulse(Math.round(((1 - Math.cos(p * 2 * Math.PI)) / 2) * PULSE_STEPS) / PULSE_STEPS);
  }

  /** Registers with the ticker only while it is actually pulsing, so clearHighlight(), a
   *  snapshot restore and destroy() all let the rAF loop go idle again (ticker.remove()
   *  stops the loop on the last callback). G9 — reduced motion holds the peak statically
   *  rather than dropping the emphasis: shrink the motion, never skip the state. */
  function setPulse(on) {
    if (on === pulsing || destroyed) return;
    pulsing = on;
    const t = internals.ticker;
    if (!on) { if (t) t.remove(onPulse); writePulse(null); return; }
    if (internals.reduced || !t) { writePulse(1); return; }
    pulseT0 = t.now();
    onPulse(pulseT0);
    t.add(onPulse);
  }

  /** Replace-not-accumulate: one highlight is the whole emphasis state, so a script never
   *  has to remember to clear the last one before setting the next. `pulse` is a modifier
   *  on top of `variant`, not one of them — a warning that breathes is still a warning. */
  function highlight(sel = {}) {
    emph.clear();
    dimmed.clear();
    const variant = sel.variant || "focus";
    for (const id of sel.nodes || []) emph.set(id, variant);
    for (const id of sel.edges || []) emph.set(id, variant);
    if (sel.dim) for (const id of drawnIds()) if (!emph.has(id)) dimmed.add(id);
    apply();
    setPulse(!!sel.pulse && emph.size > 0);
  }

  function clear() {
    emph.clear();
    dimmed.clear();
    apply();
    setPulse(false);
  }

  // ---- per-step property overrides (D16) ---------------------------------------------
  // The same --smv-* channel the user style function writes (D7), one layer above it: the
  // renderer merges this over `style(n)` at commit time, so a script can recolour one node
  // for one beat without the mount owning a style function that knows about the story.

  /** `map` = {id: {"--smv-fill": "#7c5cff"}}; null clears the whole layer. Replace, not
   *  accumulate — like highlight, this call IS the override state. Validated in full before
   *  anything is written, so a rejected key leaves the previous layer intact. */
  function setPropsMap(map) {
    const next = new Map();
    for (const [id, p] of Object.entries(map || {})) {
      if (!p) continue;
      for (const k of Object.keys(p)) {
        if (!k.startsWith("--smv-")) {
          throw new GraphError("props-key", `props only sets --smv-* properties (D7): "${k}" on "${id}" is not one`);
        }
      }
      next.set(id, { ...p });
    }
    props.clear();
    for (const [id, p] of next) props.set(id, p);
  }

  /** What renderer.styleCommit merges in, as `Map<id, {key: value|null}>` — every key the
   *  LAST layer set starts out null, because setProps() only removes what it is handed and
   *  an inline property would otherwise outlive the override that wrote it. Consumed once
   *  per style commit (it rolls the shadow forward), which is why it is read at the two
   *  styleCommit call sites and nowhere else. */
  function propsLayer() {
    const out = new Map();
    for (const [id, p] of wroteP) {
      const gone = {};
      for (const k in p) gone[k] = null;
      out.set(id, gone);
    }
    wroteP.clear();
    for (const [id, p] of props) { out.set(id, Object.assign(out.get(id) || {}, p)); wroteP.set(id, p); }
    return out.size ? out : null;
  }

  // ---- caption overlay -------------------------------------------------------------
  // Plain HTML over the pane, same pattern as transport.js: narration is not graph content,
  // so it must not enter the SVG's accessibility tree. role="status" (never assertive) —
  // a caption is ambient, and interrupting the reader on every step is hostile.
  function renderCaption() {
    if (internals.captions === false || destroyed) return;
    const root = internals.root;
    const doc = root && root.ownerDocument;
    if (!caption) {
      if (capEl) { capEl.remove(); capEl = null; }
      return;
    }
    if (!capEl) {
      if (!doc || typeof doc.createElement !== "function") return; // inert without a document
      capEl = doc.createElement("div");
      capEl.setAttribute("class", "smv-caption");
      capEl.setAttribute("role", "status");
      root.appendChild(capEl);
    }
    if (capEl.textContent !== caption.text) capEl.textContent = caption.text;
    for (const key of ["place", "variant"]) {
      const v = caption[key];
      if (v == null || v === "") capEl.removeAttribute(`data-${key}`);
      else capEl.setAttribute(`data-${key}`, String(v));
    }
  }

  function setCaption(text, o) {
    caption = text == null || text === "" ? null : { ...(o || {}), text: String(text) };
    renderCaption();
    return caption;
  }

  return {
    resolve: resolveCameraTarget,
    highlight,
    clearHighlight: clear,
    caption: setCaption,
    props: setPropsMap,
    propsLayer,
    /** What the caption currently says (cue metadata reads this even when suppressed). */
    captionText: () => (caption ? caption.text : null),
    /** Re-assert onto elements the renderer may have just rebuilt (commit). */
    reassert: () => apply(true),
    /** G2 — emphasis, the caption, the pulse and the property layer are all state a step
     *  moves, so they are all part of the snapshot. */
    snapshot() {
      return {
        emphasis: { emph: [...emph], dim: [...dimmed], pulse: pulsing },
        caption: caption && { ...caption },
        props: [...props].map(([id, p]) => [id, { ...p }]),
      };
    },
    restore(snap) {
      const e = (snap && snap.emphasis) || { emph: [], dim: [] };
      emph.clear();
      for (const [id, v] of e.emph || []) emph.set(id, v);
      dimmed.clear();
      for (const id of e.dim || []) dimmed.add(id);
      apply();
      setPulse(!!e.pulse && emph.size > 0);
      props.clear();
      for (const [id, p] of (snap && snap.props) || []) props.set(id, { ...p });
      caption = (snap && snap.caption) ? { ...snap.caption } : null;
      renderCaption();
    },
    destroy() {
      setPulse(false);   // before `destroyed`: the ticker registration has to come off
      destroyed = true;
      emph.clear(); dimmed.clear(); wroteE.clear(); wroteD.clear();
      props.clear(); wroteP.clear();
      caption = null;
      if (capEl) { capEl.remove(); capEl = null; }
    },
  };
}
