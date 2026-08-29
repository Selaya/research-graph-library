// SVG renderer. Owns element lifecycle keyed by the ids present in `visual`.
// Split by cadence (D7): styleCommit() writes data-* + --smv-* at commit time only;
// frame() writes geometry and nothing else, once per rAF tick.
// Arrowheads are hand-drawn triangles posed by clipEnds (G6) — <marker> never appears.
// Node size animates via rect width/height, never a group scale (D1).

import { clipEnds, pathString } from "./path.js";
import { truncate, NODE_PAD_X, NODE_MAX_W } from "./measure.js";

const NS = "http://www.w3.org/2000/svg";
const CORNER = 8;
const ARROW = "M 0 0 L -9 -3.8 L -9 3.8 Z"; // tip at the origin, pointing +x

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

  const nodeEls = new Map(); // id -> {g, rect, text}
  const edgeEls = new Map(); // id -> {g, line, arrow}
  const nodeStyle = new Map(); // id -> committed style descriptor
  const edgeStyle = new Map();
  const edgeMeta = new Map(); // id -> {source, target}

  function ensureNode(id) {
    let e = nodeEls.get(id);
    if (e) return e;
    const g = make("g", "smv-node");
    g.setAttribute("data-id", id);
    const rect = make("rect");
    rect.setAttribute("rx", String(CORNER));
    rect.setAttribute("ry", String(CORNER));
    const text = make("text");
    g.appendChild(rect);
    g.appendChild(text);
    nodesG.appendChild(g);
    e = { g, rect, text };
    nodeEls.set(id, e);
    applyNodeStyle(id, e);
    return e;
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
    e = { g, line, arrow };
    edgeEls.set(id, e);
    applyEdgeStyle(id, e);
    return e;
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
    setProps(e.g, st.props);
    if (e.text.textContent !== st.text) e.text.textContent = st.text;
  }

  function applyEdgeStyle(id, e) {
    const st = edgeStyle.get(id);
    if (!st) return;
    setData(e.g, "data-reversed", st.reversed);
    setData(e.g, "data-weight", st.weight);
    setData(e.g, "data-mode", st.mode);
    setProps(e.g, st.props);
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
        container: n.collapsed !== undefined || n.type === "group" ? true : null,
        collapsed: n.collapsed ? true : null,
        text: truncate(String(n.label ?? id), Math.max(8, w - 2 * NODE_PAD_X)),
        props: styleFn ? styleFn(n) : null,
      });
      const e = nodeEls.get(id);
      if (e) applyNodeStyle(id, e);
    }
    for (const [id, ed] of edges) {
      edgeMeta.set(id, { source: ed.source, target: ed.target });
      edgeStyle.set(id, {
        reversed: reversed.has(id) || ed.loop ? true : null,
        weight: ed.weight > 1 ? ed.weight : null,
        mode: ed.data && ed.data.mode,
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

    for (const [id, n] of vNodes) {
      const e = ensureNode(id);
      const w = Math.max(0, n.w), h = Math.max(0, n.h);
      e.g.setAttribute("transform", `translate(${r2(n.x - w / 2)},${r2(n.y - h / 2)})`);
      e.rect.setAttribute("width", String(r2(w)));
      e.rect.setAttribute("height", String(r2(h)));
      e.text.setAttribute("x", String(r2(w / 2)));
      e.text.setAttribute("y", String(r2(h / 2)));
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
      // Clip against the CURRENT-frame rects so edges stay attached while nodes resize.
      const { points, arrow } = clipEnds(ed.points, rectOf(vNodes.get(meta.source)), rectOf(vNodes.get(meta.target)));
      e.line.setAttribute("d", pathString(points));
      e.arrow.setAttribute("transform", `translate(${r2(arrow.x)},${r2(arrow.y)}) rotate(${deg(arrow.angle)})`);
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
    node(id) { const e = nodeEls.get(id); return e && e.g; },
    edge(id) { const e = edgeEls.get(id); return e && e.g; },
    destroy() {
      svg.remove();
      nodeEls.clear(); edgeEls.clear();
      nodeStyle.clear(); edgeStyle.clear(); edgeMeta.clear();
    },
  };
}
