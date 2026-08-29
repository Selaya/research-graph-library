// Pipeline preset (§6, M1 contract "src/preset-pipeline.js"). Decorates a mounted
// instance for the "pipeline of work" story: duration chips + durationAgg rollups,
// status/mode glyph badges, a total-duration bar, and the condense reveal payoff
// (odometer roll + transient delta badge). Core knows nothing about durations (C12) —
// this file is the only place that reads `data.duration`.
//
// Boundary: subscribes ONLY via the public instance surface (g.on/g.node/g.spec/g.el/
// g.renderer.node|edge/g.ticker) plus DOM elements it creates itself. Never reaches into
// scene/render/index internals — so it can ship as a separate entry point (own stylesheet,
// own marker) that a core-only page never has to load.

import { parseDuration } from "./run.js";
import { prefersReducedMotion } from "./anim.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Mirrors render.js's HEADER_H — the header strip an expanded container reserves up top.
const HEADER_H = 28;

const UNITS = [["d", 86400], ["h", 3600], ["m", 60], ["s", 1], ["ms", 0.001]];
const MINUS = "−"; // typographic minus (not hyphen-minus) for the delta badge

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free, exported for direct testing).
// ---------------------------------------------------------------------------

/** number(sec) | "2h" | ... -> "2h"/"8s"/"1.5m"/"300ms" short form. "" when absent/invalid. */
export function formatDuration(sec) {
  if (typeof sec === "string") sec = parseDuration(sec);
  if (sec == null || !Number.isFinite(sec)) return "";
  const sign = sec < 0 ? "-" : "";
  const abs = Math.abs(sec);
  if (abs === 0) return "0s";
  for (const [suffix, size] of UNITS) {
    if (abs >= size || suffix === "ms") {
      const v = abs / size;
      const r = Math.round(v * 10) / 10;
      const s = Number.isInteger(r) ? String(r) : r.toFixed(1);
      return `${sign}${s}${suffix}`;
    }
  }
  /* c8 ignore next */
  return `${sign}${abs}s`; // unreachable: the ms bucket above always matches
}

/** durationAgg 'sum'|'max' over child seconds (non-finite entries ignored); null if none. */
export function aggregateDuration(seconds, mode = "sum") {
  const vals = (seconds || []).filter((s) => Number.isFinite(s));
  if (!vals.length) return null;
  return mode === "max" ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0);
}

/**
 * The duration a node "represents": its own `data.duration` if set, else a durationAgg
 * rollup (default 'sum') over its children's own effective durations, recursively — so a
 * collapsed container's chip stays numerically consistent through expand/collapse (G5).
 * `nodesById` = Map<id, specNode> (from a store.spec() snapshot).
 */
export function effectiveDurationSec(nodesById, id, cache = new Map()) {
  if (cache.has(id)) return cache.get(id);
  cache.set(id, null); // guards against a malformed parent cycle slipping through
  const node = nodesById.get(id);
  if (!node) return null;
  const own = node.data && parseDuration(node.data.duration);
  if (own != null) { cache.set(id, own); return own; }
  const childIds = [];
  for (const n of nodesById.values()) if (n.parent === id) childIds.push(n.id);
  if (!childIds.length) return null;
  const agg = aggregateDuration(childIds.map((cid) => effectiveDurationSec(nodesById, cid, cache)), node.durationAgg || "sum");
  cache.set(id, agg);
  return agg;
}

function roundMultiplier(x) {
  if (!Number.isFinite(x)) return "∞";
  const r = x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "−99.9% · 900× faster" (the D6 reveal payoff). "" when sourceSec is missing/non-positive. */
export function deltaBadgeText(sourceSec, targetSec) {
  if (!Number.isFinite(sourceSec) || sourceSec <= 0 || !Number.isFinite(targetSec) || targetSec < 0) return "";
  const pct = ((targetSec - sourceSec) / sourceSec) * 100;
  const pctStr = `${pct <= 0 ? MINUS : "+"}${Math.abs(pct).toFixed(1)}%`;
  const faster = targetSec <= sourceSec;
  const ratio = faster ? (targetSec > 0 ? sourceSec / targetSec : Infinity) : targetSec / sourceSec;
  return `${pctStr} · ${roundMultiplier(ratio)}× ${faster ? "faster" : "slower"}`;
}

/** Odometer value at normalized t∈[0,1] rolling fromSec -> toSec. Log-lerp: a linear roll
 *  reads as "stuck" for the first 90% of a 2h -> 8s drop (three orders of magnitude). */
export function odometerValueAt(fromSec, toSec, t) {
  const tt = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (!Number.isFinite(fromSec) || fromSec <= 0) return Number.isFinite(toSec) ? toSec : fromSec;
  if (!Number.isFinite(toSec) || toSec <= 0) return fromSec * (1 - tt);
  if (tt === 0) return fromSec;   // exact endpoints — log/exp round-trips lose a ULP or two
  if (tt === 1) return toSec;
  const a = Math.log(fromSec), b = Math.log(toSec);
  return Math.exp(a + (b - a) * tt);
}

// ---------------------------------------------------------------------------
// Styles (own deduped stylesheet, D7-flavoured: only .smv-*/[data-*]/--smv-* selectors).
// ---------------------------------------------------------------------------

export const PRESET_STYLE_MARKER = "data-smv-preset-styles";

export const PRESET_CSS = `
.smv-chip{font:600 10px system-ui,-apple-system,'Segoe UI',sans-serif; fill:var(--smv-muted,#6b7488); text-anchor:end; dominant-baseline:central; pointer-events:none}
.smv-status-glyph{font:11px system-ui,-apple-system,'Segoe UI',sans-serif; text-anchor:start; dominant-baseline:central; pointer-events:none}
.smv-mode-badge{font:11px system-ui,-apple-system,'Segoe UI',sans-serif; text-anchor:end; dominant-baseline:central; pointer-events:none; opacity:.8}
/* Ambient decoration, not choreography (D1): an independent looping CSS animation, never
   tied to the shared clock, so it never competes with cancel-and-retarget. */
.smv-node[data-status="active"] .smv-status-glyph{animation:smv-pulse 1.1s ease-in-out infinite}
@keyframes smv-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.smv-delta-badge{font:700 11px system-ui,-apple-system,'Segoe UI',sans-serif; fill:var(--smv-condense,#f0a000); text-anchor:middle; pointer-events:none}
.smv-totalbar{position:absolute; left:0; right:0; bottom:0; height:22px; display:flex; align-items:center; gap:8px; padding:0 10px; box-sizing:border-box; font:500 11px system-ui,-apple-system,'Segoe UI',sans-serif; color:var(--smv-muted,#6b7488)}
.smv-totalbar-track{flex:1; height:4px; border-radius:2px; background:var(--smv-stroke,#ccd2de); overflow:hidden}
/* Width is set at commit time only (D7) — never a CSS transition, so an odometer-timed
   shrink and a plain relayout shrink read identically instead of racing two clocks. */
.smv-totalbar-fill{height:100%; background:var(--smv-accent,#5b6ef5); border-radius:2px}
`;

/** Inject the deduped preset stylesheet. Its own marker (G8) — independent of core's, so a
 *  page can load the preset entry point without the core stylesheet ever existing. */
export function injectPresetStyles(doc) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const existing = doc.querySelector ? doc.querySelector(`style[${PRESET_STYLE_MARKER}]`) : null;
  if (existing) return existing;
  const head = doc.head || doc.documentElement;
  if (!head) return null;
  const el = doc.createElement("style");
  el.setAttribute(PRESET_STYLE_MARKER, "");
  el.textContent = PRESET_CSS;
  head.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// DOM adornments (guarded — every entry point checks for a document before touching one).
// ---------------------------------------------------------------------------

const STATUS_GLYPH = { pending: "⏱", active: "●", done: "✓" }; // clock / dot / check
const MODE_GLYPH = { manual: "✋", automated: "⚡", auto: "⚡" }; // hand / bolt

function makeText(doc, host, cls) {
  const el = doc.createElementNS(SVG_NS, "text");
  el.setAttribute("class", cls);
  host.appendChild(el);
  return el;
}

function setXY(el, x, y) {
  el.setAttribute("x", String(Math.round(x)));
  el.setAttribute("y", String(Math.round(y)));
}

/** Position the three adornments against the node's *committed* box (D7 — style-commit
 *  time only, never per frame; the chip glides for free as the node's own <g> tweens). */
function positionParts(parts, rect) {
  if (!rect) return;
  const w = Number.isFinite(rect.w) ? rect.w : 0;
  const container = typeof parts.host.hasAttribute === "function" && parts.host.hasAttribute("data-container");
  const collapsed = typeof parts.host.hasAttribute === "function" && parts.host.hasAttribute("data-collapsed");
  const y = container && !collapsed ? HEADER_H / 2 : 10;
  setXY(parts.status, 12, y);
  setXY(parts.mode, Math.max(12, w - 32), y);
  setXY(parts.chip, Math.max(12, w - 10), y);
}

const DELTA_BADGE_MS = 1600;
const ODOMETER_MS = 600;

/** DOM-lite (only `.textContent`): drives an odometer roll on `g.ticker`, no CSS transition
 *  in sight (D1). `reduced` snaps straight to the end value (G9). */
export function runOdometer(ticker, textEl, fromSec, toSec, { reduced = false, ms = ODOMETER_MS } = {}) {
  if (!textEl) return { cancel() {} };
  if (reduced || !(fromSec > 0)) {
    textEl.textContent = formatDuration(toSec);
    return { cancel() {} };
  }
  const t0 = ticker.now();
  let done = false;
  function step(now) {
    const t = ms > 0 ? (now - t0) / ms : 1;
    if (t >= 1) {
      textEl.textContent = formatDuration(toSec);
      done = true;
      ticker.remove(step);
      return;
    }
    textEl.textContent = formatDuration(odometerValueAt(fromSec, toSec, t));
  }
  ticker.add(step);
  return {
    cancel() {
      if (done) return;
      done = true;
      ticker.remove(step);
      textEl.textContent = formatDuration(toSec);
    },
  };
}

/** Pops a transient "−99.9% · N× faster" badge above the merged node, timed on the shared
 *  ticker (not a CSS transition) so it composes with reduced-motion the same way as the
 *  rest of the choreography. */
function popDeltaBadge(ticker, doc, host, text, reduced) {
  if (!doc || !host || !text || typeof doc.createElementNS !== "function") return { cancel() {} };
  const el = doc.createElementNS(SVG_NS, "text");
  el.setAttribute("class", "smv-delta-badge");
  el.setAttribute("x", "0");
  el.setAttribute("y", "-14");
  el.textContent = text;
  host.appendChild(el);
  const ms = reduced ? 1 : DELTA_BADGE_MS;
  const t0 = ticker.now();
  let done = false;
  function remove() {
    if (el.parentNode && typeof el.parentNode.removeChild === "function") el.parentNode.removeChild(el);
  }
  function step(now) {
    if (now - t0 < ms) return;
    done = true;
    ticker.remove(step);
    remove();
  }
  ticker.add(step);
  return {
    cancel() {
      if (done) return;
      done = true;
      ticker.remove(step);
      remove();
    },
  };
}

/** Finds an already-appended `<div class="cls">` among `root`'s direct children — used so a
 *  destroy()-less re-apply (or a re-mount of the preset onto the same instance) reuses the
 *  existing total bar instead of stacking a second one. */
function findChildByClass(root, cls) {
  if (!root || !root.children) return null;
  for (const c of root.children) {
    const className = typeof c.getAttribute === "function" ? c.getAttribute("class") : null;
    if (className === cls) return c;
  }
  return null;
}

function ensureTotalBar(doc, root) {
  if (!doc || typeof doc.createElement !== "function" || !root) return null;
  const existingWrap = findChildByClass(root, "smv-totalbar");
  if (existingWrap) {
    const track = findChildByClass(existingWrap, "smv-totalbar-track");
    const fill = track && findChildByClass(track, "smv-totalbar-fill");
    const label = findChildByClass(existingWrap, "smv-totalbar-label");
    if (track && fill && label) return { wrap: existingWrap, fill, label, maxSec: 0 };
  }
  const wrap = doc.createElement("div");
  wrap.setAttribute("class", "smv-totalbar");
  const track = doc.createElement("div");
  track.setAttribute("class", "smv-totalbar-track");
  const fill = doc.createElement("div");
  fill.setAttribute("class", "smv-totalbar-fill");
  track.appendChild(fill);
  const label = doc.createElement("span");
  label.setAttribute("class", "smv-totalbar-label");
  wrap.appendChild(track);
  wrap.appendChild(label);
  root.appendChild(wrap);
  return { wrap, fill, label, maxSec: 0 };
}

/**
 * applyPipelinePreset(g) — the single entry point (also exposed as
 * `SparkleMotion.presetPipeline` / `opts.preset: 'pipeline'` by the integration layer).
 * Returns `{ destroy() }` so a page that unmounts the preset independently of `g` can.
 */
export function applyPipelinePreset(g) {
  const doc = (g.el && g.el.ownerDocument) || null;
  injectPresetStyles(doc);

  const parts = new Map(); // id -> {host, chip, status, mode}
  const bar = ensureTotalBar(doc, g.el);
  const liveTimers = new Set(); // in-flight runOdometer()/popDeltaBadge() cancel handles

  function partsFor(id) {
    const host = g.renderer && g.renderer.node && g.renderer.node(id);
    if (!host || !doc) return null;
    let p = parts.get(id);
    if (!p || p.host !== host) {
      p = {
        host,
        chip: makeText(doc, host, "smv-chip"),
        status: makeText(doc, host, "smv-status-glyph"),
        mode: makeText(doc, host, "smv-mode-badge"),
      };
      parts.set(id, p);
    }
    return p;
  }

  function updateTotalBar(totalSec) {
    if (!bar) return;
    if (totalSec == null) {
      bar.wrap.style.setProperty("display", "none");
      return;
    }
    bar.wrap.style.removeProperty("display");
    bar.maxSec = Math.max(bar.maxSec, totalSec);
    const pct = bar.maxSec > 0 ? Math.min(100, (totalSec / bar.maxSec) * 100) : 100;
    bar.fill.style.setProperty("width", `${pct}%`);
    bar.label.textContent = formatDuration(totalSec);
  }

  function onCommit(ev) {
    const spec = g.spec();
    const nodesById = new Map(spec.nodes.map((n) => [n.id, n]));
    const cache = new Map();
    let total = 0, hasTotal = false;
    for (const n of spec.nodes) {
      if (n.parent === undefined) {
        const sec = effectiveDurationSec(nodesById, n.id, cache);
        if (sec != null) { total += sec; hasTotal = true; }
      }
      const p = partsFor(n.id);
      if (!p) continue;
      const sec = effectiveDurationSec(nodesById, n.id, cache);
      p.chip.textContent = sec != null ? formatDuration(sec) : "";
      const data = n.data || {};
      p.status.textContent = STATUS_GLYPH[data.status] || "";
      p.mode.textContent = MODE_GLYPH[data.mode] || "";
      positionParts(p, ev && ev.nodes && ev.nodes[n.id]);
    }
    for (const id of [...parts.keys()]) if (!nodesById.has(id)) parts.delete(id);
    updateTotalBar(hasTotal ? total : null);
  }

  /** Tracks a runOdometer()/popDeltaBadge() cancel handle so destroy() can stop it — wraps
   *  cancel() so a handle that has already run to completion (or been canceled) is dropped
   *  from the live set instead of accumulating forever. */
  function track(handle) {
    liveTimers.add(handle);
    const cancel = handle.cancel;
    handle.cancel = () => { liveTimers.delete(handle); cancel(); };
    return handle;
  }

  function onCondense({ sources, target, sourceData, targetData }) {
    const p = partsFor(target);
    if (!p) return;
    const sourceSec = aggregateDuration((sourceData || []).map((d) => parseDuration(d && d.data && d.data.duration)), "sum");
    const targetSec = parseDuration(targetData && targetData.data && targetData.data.duration);
    const reduced = prefersReducedMotion();
    track(runOdometer(g.ticker, p.chip, sourceSec, targetSec, { reduced }));
    const text = deltaBadgeText(sourceSec, targetSec);
    if (text) track(popDeltaBadge(g.ticker, doc, p.host, text, reduced));
  }

  const offCommit = g.on("commit", onCommit);
  const offCondense = g.on("condense", onCondense);

  return {
    destroy() {
      if (typeof offCommit === "function") offCommit();
      else g.off("commit", onCommit);
      if (typeof offCondense === "function") offCondense();
      else g.off("condense", onCondense);
      for (const handle of [...liveTimers]) handle.cancel();
      liveTimers.clear();
      for (const p of parts.values()) {
        for (const el of [p.chip, p.status, p.mode]) {
          if (el.parentNode && typeof el.parentNode.removeChild === "function") el.parentNode.removeChild(el);
        }
      }
      parts.clear();
      if (bar && bar.wrap.parentNode && typeof bar.wrap.parentNode.removeChild === "function") {
        bar.wrap.parentNode.removeChild(bar.wrap);
      }
    },
  };
}

export default { applyPipelinePreset, injectPresetStyles, formatDuration, aggregateDuration, deltaBadgeText };
