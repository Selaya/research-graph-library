// SVG renderer. Owns element lifecycle keyed by the ids present in `visual`.
// Split by cadence (D7): styleCommit() writes data-* + --smv-* at commit time only;
// frame() writes geometry and nothing else, once per rAF tick.
// Arrowheads are hand-drawn triangles posed by clipEnds (G6) — <marker> never appears.
// Node size animates via rect width/height, never a group scale (D1).

import { clipEnds, pathString, pointAt } from "./path.js";
import { truncate, NODE_PAD_X, NODE_MAX_W } from "./measure.js";

const NS = "http://www.w3.org/2000/svg";
const CORNER = 8;
const ARROW = "M 0 0 L -9 -3.8 L -9 3.8 Z"; // tip at the origin, pointing +x

// Container chrome (D5) — HEADER_H mirrors layout.js CONTAINER_PAD.top, so the strip
// always lands exactly in the gap the layout reserved above the first child.
const HEADER_H = 28;
const CHEV_X = 13;
const LABEL_X = 26;
const STACK_OFF = 4;
const CHEV_RIGHT = "M -2.5 -4 L 1.5 0 L -2.5 4"; // collapsed
const CHEV_DOWN = "M -4 -2.5 L 0 1.5 L 4 -2.5";  // expanded

// Edge labels: truncated at commit time (D7), positioned per frame at the path midpoint
// nudged off the line so the halo doesn't sit directly on the stroke.
const EDGE_LABEL_MAX_W = 90;
const EDGE_LABEL_OFFSET = 8;

// Viewport culling (M3): only worth the per-frame outside-test cost above this element
// count (nodes.size + edges.size) — below it the check costs more than it saves.
const CULL_THRESHOLD = 150;

/** True when the node's world-space rect has zero overlap with `rect` ({x,y,w,h}, x/y = top-left). */
function nodeOutsideRect(n, rect) {
  const w = Math.max(0, n.w), h = Math.max(0, n.h);
  const left = n.x - w / 2, right = n.x + w / 2, top = n.y - h / 2, bottom = n.y + h / 2;
  return right < rect.x || left > rect.x + rect.w || bottom < rect.y || top > rect.y + rect.h;
}

/** True when a single point sits strictly outside `rect`. */
function pointOutsideRect(p, rect) {
  return p.x < rect.x || p.x > rect.x + rect.w || p.y < rect.y || p.y > rect.y + rect.h;
}

/** An edge culls only when BOTH endpoints' rects AND every point on it are outside —
 *  a long edge merely passing through the viewport must stay drawn. Missing endpoint
 *  geometry (dangling meta lookup) never culls: we can't prove it's outside. */
function edgeFullyOutside(ed, meta, vNodes, rect) {
  const src = vNodes.get(meta.source), tgt = vNodes.get(meta.target);
  if (!src || !tgt) return false;
  if (!nodeOutsideRect(src, rect) || !nodeOutsideRect(tgt, rect)) return false;
  const pts = ed.points;
  if (!pts || !pts.length) return true;
  for (let i = 0; i < pts.length; i++) if (!pointOutsideRect(pts[i], rect)) return false;
  return true;
}

const r2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const deg = (rad) => r2((Number.isFinite(rad) ? rad : 0) * 180 / Math.PI);

function asMap(x) {
  if (!x) return new Map();
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.map((v) => [v.id, v]));
  return new Map(Object.entries(x));
}

function rectOf(n) {
  return n ? { x: n.x, y: n.y, w: n.w, h: n.h, r: CORNER } : null;
}

export function createRenderer(rootEl, doc = rootEl && rootEl.ownerDocument) {
  if (!doc || typeof doc.createElementNS !== "function") {
    throw new Error("[smv:no-dom] createRenderer needs a document");
  }
  const make = (tag, cls) => {
    const el = doc.createElementNS(NS, tag);
    if (cls) el.setAttribute("class", cls);
    return el;
  };

  const svg = make("svg", "smv");
  svg.setAttribute("xmlns", NS);
  const viewportG = make("g", "smv-viewport");
  const edgesG = make("g", "smv-edges"); // edges first so nodes paint over them
  const nodesG = make("g", "smv-nodes");
  viewportG.appendChild(edgesG);
  viewportG.appendChild(nodesG);
  svg.appendChild(viewportG);
  rootEl.appendChild(svg);

  const nodeEls = new Map(); // id -> {g, rect, text, depth, container, collapsed, stack?, header?, chev?, badge?}
  const edgeEls = new Map(); // id -> {g, line, arrow}
  const nodeStyle = new Map(); // id -> committed style descriptor
  const edgeStyle = new Map();
  const edgeMeta = new Map(); // id -> {source, target}

  // Viewport culling (M3): `fn()` returns the current world-space visible rect (or null
  // to cull nothing) — set by index.js from viewport.visibleWorldRect(). Only consulted
  // above CULL_THRESHOLD total elements (below it the check costs more than it saves).
  let cullFn = null;
  function setCull(fn) { cullFn = typeof fn === "function" ? fn : null; }

  /** Toggle the culled bookkeeping on one element: data-culled attr + display:none.
   *  The CSS home for [data-culled] would be styles.js, which this agent does not own —
   *  set style.display directly instead (see M3 report). */
  function setCulled(e, value) {
    if (e.culled === value) return;
    e.culled = value;
    if (value) { e.g.setAttribute("data-culled", ""); e.g.style.display = "none"; }
    else { e.g.removeAttribute("data-culled"); e.g.style.display = ""; }
  }

  /** Containment depth decides paint order: children must land above their container. */
  function place(e) {
    for (const sib of nodesG.children) {
      if (sib === e.g) continue;
      const other = nodeEls.get(sib.getAttribute("data-id"));
      if (other && other.depth > e.depth) { nodesG.insertBefore(e.g, sib); return; }
    }
    nodesG.appendChild(e.g);
  }

  function ensureNode(id) {
    let e = nodeEls.get(id);
    if (e) return e;
    const g = make("g", "smv-node");
    g.setAttribute("data-id", id);
    const rect = make("rect", "smv-node-box");
    rect.setAttribute("rx", String(CORNER));
    rect.setAttribute("ry", String(CORNER));
    const text = make("text", "smv-node-label");
    g.appendChild(rect);
    g.appendChild(text);
    e = { g, rect, text, depth: (nodeStyle.get(id) || {}).depth || 0, container: false, collapsed: false, culled: false };
    nodeEls.set(id, e);
    place(e);
    applyNodeStyle(id, e);
    return e;
  }

  /** Container-only chrome, built lazily so plain nodes stay two elements (G7). */
  function ensureContainerParts(e) {
    if (e.stack) return;
    e.stack = make("rect", "smv-node-stack");
    e.stack.setAttribute("rx", String(CORNER));
    e.stack.setAttribute("ry", String(CORNER));
    e.stack.setAttribute("x", String(STACK_OFF));
    e.stack.setAttribute("y", String(STACK_OFF));
    e.g.insertBefore(e.stack, e.rect); // paints behind the card
    e.header = make("rect", "smv-node-header");
    e.header.setAttribute("rx", String(CORNER));
    e.header.setAttribute("ry", String(CORNER));
    e.header.setAttribute("x", "0");
    e.header.setAttribute("y", "0");
    e.g.insertBefore(e.header, e.text);
    e.chev = make("path", "smv-node-chev");
    e.g.appendChild(e.chev);
    e.badge = make("text", "smv-node-badge");
    e.g.appendChild(e.badge);
    // Chrome, not content: the treeitem's own aria-label is the authoritative name for all
    // of it, so these must not surface as extra accessible nodes inside every container.
    for (const part of [e.stack, e.header, e.chev, e.badge]) part.setAttribute("aria-hidden", "true");
  }

  function ensureEdge(id) {
    let e = edgeEls.get(id);
    if (e) return e;
    const g = make("g", "smv-edge");
    g.setAttribute("data-id", id);
    const line = make("path", "smv-edge-line");
    const arrow = make("path", "smv-edge-arrow");
    arrow.setAttribute("d", ARROW);
    g.appendChild(line);
    g.appendChild(arrow);
    edgesG.appendChild(g);
    e = { g, line, arrow, label: null, culled: false };
    edgeEls.set(id, e);
    applyEdgeStyle(id, e);
    return e;
  }

  /** Lazily allocated so an unlabeled edge (the common case) stays a two-element group. */
  function ensureEdgeLabel(e) {
    if (e.label) return e.label;
    e.label = make("text", "smv-edge-label");
    // Decorative: edges are not tree items, so this text would otherwise linearize as a
    // bare orphan string ("then") with no relationship to anything a reader can find.
    e.label.setAttribute("aria-hidden", "true");
    e.g.appendChild(e.label);
    return e.label;
  }

  function setProps(el, props) {
    if (!props) return;
    for (const [k, v] of Object.entries(props)) {
      if (!k.startsWith("--smv-")) continue; // user style functions only set custom properties (D7)
      if (v == null || v === false) el.style.removeProperty(k);
      else el.style.setProperty(k, String(v));
    }
  }

  function setData(el, key, value) {
    if (value == null || value === false || value === "") el.removeAttribute(key);
    else el.setAttribute(key, value === true ? "" : String(value));
  }

  function applyNodeStyle(id, e) {
    const st = nodeStyle.get(id);
    if (!st) return;
    const d = st.data || {};
    setData(e.g, "data-status", d.status);
    setData(e.g, "data-mode", d.mode);
    setData(e.g, "data-container", st.container);
    setData(e.g, "data-collapsed", st.collapsed);
    setData(e.g, "data-count", st.count);
    setProps(e.g, st.props);
    if (e.text.textContent !== st.text) e.text.textContent = st.text;
    e.container = !!st.container;
    e.collapsed = !!st.collapsed;
    if (e.container) {
      ensureContainerParts(e);
      e.chev.setAttribute("d", e.collapsed ? CHEV_RIGHT : CHEV_DOWN);
      const badge = st.count > 0 ? `×${st.count}` : "";
      if (e.badge.textContent !== badge) e.badge.textContent = badge;
    }
    const depth = st.depth || 0;
    if (depth !== e.depth) { e.depth = depth; place(e); }
  }

  function applyEdgeStyle(id, e) {
    const st = edgeStyle.get(id);
    if (!st) return;
    setData(e.g, "data-reversed", st.reversed);
    setData(e.g, "data-weight", st.weight);
    setData(e.g, "data-mode", st.mode);
    setProps(e.g, st.props);
    if (st.label) {
      ensureEdgeLabel(e);
      if (e.label.textContent !== st.label) e.label.textContent = st.label;
    } else if (e.label) {
      e.label.remove();
      e.label = null;
    }
  }

  /**
   * Commit-time style pass (D7). `like` supplies {nodes, edges} as Maps/arrays/objects of
   * spec items, plus optional {reversed:Set, style:fn, sizes:{id:{w,h}}}.
   */
  function styleCommit(like) {
    const nodes = asMap(like && like.nodes);
    const edges = asMap(like && like.edges);
    const reversed = (like && (like.reversed || like.reversedEdgeIds)) || new Set();
    const styleFn = like && typeof like.style === "function" ? like.style : null;
    const sizes = (like && like.sizes) || {};

    for (const [id, n] of nodes) {
      const w = (sizes[id] && sizes[id].w) || NODE_MAX_W;
      nodeStyle.set(id, {
        data: n.data,
        container: n.container === true || n.collapsed !== undefined || n.type === "group" ? true : null,
        collapsed: n.collapsed ? true : null,
        count: n.count > 0 ? n.count : null,
        depth: n.depth || 0,
        text: truncate(String(n.label ?? id), Math.max(8, w - 2 * NODE_PAD_X)),
        props: styleFn ? styleFn(n) : null,
      });
      const e = nodeEls.get(id);
      if (e) applyNodeStyle(id, e);
    }
    for (const [id, ed] of edges) {
      edgeMeta.set(id, { source: ed.source, target: ed.target });
      const weight = ed.weight > 1 ? ed.weight : null;
      // A meta-edge aggregating >=2 source edges drops its label — the weight badge
      // already carries the story, and there's no single label left to show.
      const label = ed.label && !(ed.meta && weight) ? truncate(String(ed.label), EDGE_LABEL_MAX_W) : null;
      edgeStyle.set(id, {
        reversed: reversed.has(id) || ed.loop ? true : null,
        weight,
        mode: ed.data && ed.data.mode,
        label,
        props: null, // the user style function is node-scoped (§5.6)
      });
      const e = edgeEls.get(id);
      if (e) applyEdgeStyle(id, e);
    }
    for (const id of [...nodeStyle.keys()]) if (!nodes.has(id)) nodeStyle.delete(id);
    for (const id of [...edgeStyle.keys()]) if (!edges.has(id)) edgeStyle.delete(id);
  }

  /** Per-frame geometry only — no styling, no measurement, no layout reads. */
  function frame(visual) {
    const vNodes = visual.nodes, vEdges = visual.edges;
    // Cull only above the threshold — a null rect (fn unset, or no usable svg size, e.g.
    // Node/fake-DOM tests) means "cull nothing", per the viewport.js contract.
    const cullRect = cullFn && (vNodes.size + vEdges.size > CULL_THRESHOLD) ? cullFn() : null;

    for (const [id, n] of vNodes) {
      const e = ensureNode(id);
      if (cullRect && nodeOutsideRect(n, cullRect)) {
        setCulled(e, true);
        continue; // skip geometry writes for fully-outside groups (hot-path saving)
      }
      setCulled(e, false);
      const w = Math.max(0, n.w), h = Math.max(0, n.h);
      e.g.setAttribute("transform", `translate(${r2(n.x - w / 2)},${r2(n.y - h / 2)})`);
      e.rect.setAttribute("width", String(r2(w)));
      e.rect.setAttribute("height", String(r2(h)));
      if (e.container) {
        e.stack.setAttribute("width", String(r2(w)));
        e.stack.setAttribute("height", String(r2(h)));
        e.header.setAttribute("width", String(r2(w)));
        e.header.setAttribute("height", String(r2(Math.min(HEADER_H, h))));
        if (e.collapsed) {
          e.chev.setAttribute("transform", `translate(${CHEV_X - 1},${r2(h / 2)})`);
          e.text.setAttribute("x", String(r2(w / 2)));
          e.text.setAttribute("y", String(r2(h / 2)));
          e.badge.setAttribute("x", String(r2(w - 10)));
          e.badge.setAttribute("y", String(r2(h / 2)));
        } else {
          // Expanded: the label lives top-left in the header strip, never over the children.
          e.chev.setAttribute("transform", `translate(${CHEV_X},${HEADER_H / 2})`);
          e.text.setAttribute("x", String(LABEL_X));
          e.text.setAttribute("y", String(HEADER_H / 2));
          e.badge.setAttribute("x", String(r2(w - 10)));
          e.badge.setAttribute("y", String(HEADER_H / 2));
        }
      } else {
        e.text.setAttribute("x", String(r2(w / 2)));
        e.text.setAttribute("y", String(r2(h / 2)));
      }
      e.g.setAttribute("opacity", String(r2(n.opacity ?? 1)));
    }
    for (const [id, e] of nodeEls) {
      if (vNodes.has(id)) continue;
      e.g.remove();
      nodeEls.delete(id);
    }

    for (const [id, ed] of vEdges) {
      const e = ensureEdge(id);
      const meta = edgeMeta.get(id) || {};
      if (cullRect && edgeFullyOutside(ed, meta, vNodes, cullRect)) {
        setCulled(e, true);
        continue; // both endpoints AND every point outside — skip geometry writes
      }
      setCulled(e, false);
      // Clip against the CURRENT-frame rects so edges stay attached while nodes resize.
      const { points, arrow } = clipEnds(ed.points, rectOf(vNodes.get(meta.source)), rectOf(vNodes.get(meta.target)));
      e.line.setAttribute("d", pathString(points));
      e.arrow.setAttribute("transform", `translate(${r2(arrow.x)},${r2(arrow.y)}) rotate(${deg(arrow.angle)})`);
      if (e.label) {
        // Midpoint of the CLIPPED path, nudged along the local normal so the halo
        // doesn't sit directly on the stroke; opacity inherits from the group below.
        const mid = pointAt(points, 0.5);
        const nx = -Math.sin(mid.angle), ny = Math.cos(mid.angle);
        e.label.setAttribute("x", String(r2(mid.x + nx * EDGE_LABEL_OFFSET)));
        e.label.setAttribute("y", String(r2(mid.y + ny * EDGE_LABEL_OFFSET)));
      }
      e.g.setAttribute("opacity", String(r2(ed.opacity ?? 1)));
    }
    for (const [id, e] of edgeEls) {
      if (vEdges.has(id)) continue;
      e.g.remove();
      edgeEls.delete(id);
    }
  }

  return {
    svg,
    viewportG,
    styleCommit,
    frame,
    setCull,
    /** Phase marker for the condense choreography (D6): data-condense="src"|"reveal"|null. */
    mark(id, value) {
      const e = nodeEls.get(id);
      if (e) setData(e.g, "data-condense", value);
    },
    /** Director emphasis (D14) — discrete state, never tweened. Deliberately NOT folded
     *  into mark(): data-condense is the condense choreography's own channel, and a
     *  highlight that outlives a merge must not fight it for the same attribute. */
    emphasize(id, value) {
      const e = nodeEls.get(id) || edgeEls.get(id);
      if (e) setData(e.g, "data-emph", value);
    },
    /** The spotlight's other half: everything NOT emphasised (D14). */
    dim(id, value) {
      const e = nodeEls.get(id) || edgeEls.get(id);
      if (e) setData(e.g, "data-dim", value);
    },
    node(id) { const e = nodeEls.get(id); return e && e.g; },
    edge(id) { const e = edgeEls.get(id); return e && e.g; },
    destroy() {
      svg.remove();
      nodeEls.clear(); edgeEls.clear();
      nodeStyle.clear(); edgeStyle.clear(); edgeMeta.clear();
    },
  };
}
