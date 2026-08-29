// Token decorations (D4). Everything here is SAMPLED from run.state() = stateAt(t) inside
// the single rAF (D1) — there is not one WAAPI animation, CSS transition or timer per
// token. Two callbacks feed the same draw(): the run's own 'tick' (time moved) and
// scene.onFrame (geometry moved), so a pulse rides a mid-transition edge correctly.
//
// One `g.smv-tokens` layer, appended after the nodes group so decorations paint on top.
// Geometry comes from scene.visual (the CURRENT interpolated frame), never from a layout
// result, and edge positions come from pointAt() on that live polyline.

import { pointAt } from "./path.js";

const NS = "http://www.w3.org/2000/svg";
const GHOST_MS = 320;
const FILL_INSET = 3;
const PIP_R = 2.6;
const PIP_GAP = 8;
const TOKEN_FAN = 9; // x-spread when several tokens sit on one node

const r2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

function makePool(doc, group, tag, cls, init) {
  const els = new Map();
  const used = new Set();
  return {
    get(key) {
      let el = els.get(key);
      if (!el) {
        el = doc.createElementNS(NS, tag);
        el.setAttribute("class", cls);
        // Geometry attributes that never change live here, not in CSS: `r`/`rx` as CSS
        // properties are a recent addition and we do not depend on them.
        if (init) for (const [k, v] of Object.entries(init)) el.setAttribute(k, v);
        group.appendChild(el);
        els.set(key, el);
      }
      used.add(key);
      return el;
    },
    sweep() {
      for (const [k, el] of els) if (!used.has(k)) { el.remove(); els.delete(k); }
      used.clear();
    },
    clear() { for (const el of els.values()) el.remove(); els.clear(); used.clear(); },
  };
}

/**
 * createRunRender(internals, run) -> { draw, destroy }
 *   internals = { ticker, scene, renderer, viewstate, store, bus }
 * No-ops (still a valid handle) when there is no document — the module imports under Node.
 */
export function createRunRender(internals, run) {
  const { ticker, scene, renderer, store } = internals;
  const vs = internals.viewstate;
  const doc = renderer && renderer.svg && renderer.svg.ownerDocument;
  if (!doc || typeof doc.createElementNS !== "function") return { draw() {}, destroy() {} };

  const layer = doc.createElementNS(NS, "g");
  layer.setAttribute("class", "smv-tokens");
  const gFill = doc.createElementNS(NS, "g");
  const gMark = doc.createElementNS(NS, "g");
  const gTok = doc.createElementNS(NS, "g");
  layer.appendChild(gFill); layer.appendChild(gMark); layer.appendChild(gTok);
  renderer.viewportG.appendChild(layer);

  const fills = makePool(doc, gFill, "rect", "smv-node-fill", { rx: "5", ry: "5" });
  const pips = makePool(doc, gMark, "circle", "smv-join-pip", { r: String(PIP_R) });
  const badges = makePool(doc, gMark, "text", "smv-token-badge");
  const loops = makePool(doc, gMark, "text", "smv-loop-badge");
  const dots = makePool(doc, gTok, "circle", "smv-token", { r: "5" });
  const ghostEls = makePool(doc, gTok, "circle", "smv-token smv-ghost", { r: "5" });

  // Written per frame by exception (a token decoration channel, not the D7 style commit):
  // both are cached so an unchanged edge/node costs zero DOM writes.
  const traversedAt = new Map();  // visible edge id -> last written value
  const runStatusAt = new Map();  // node id -> last written data-run

  let edgeAlias = new Map();      // spec edge id -> the edge id actually on screen
  let containerLoops = new Map(); // collapsed container id -> [loop edge ids it swallowed]
  // A condense hands the merged node max(progress) as a floor until its own schedule
  // catches up, so the fill never visibly rewinds mid-dwell (D4). Rendering-only.
  const floors = new Map();
  let ghosts = [];
  let ghostCb = null;
  let destroyed = false;

  /** Refreshed at commit time: which spec edges are represented by which visible edge,
   *  and which loop edges a collapsed container is standing in for (D3/D5 loopBadges). */
  function indexView(meta) {
    edgeAlias = new Map();
    containerLoops = new Map();
    if (!meta) return;
    if (meta.metaEdges) {
      for (const [metaId, rec] of meta.metaEdges) {
        for (const src of rec.sources || []) edgeAlias.set(src, metaId);
      }
    }
    const badgeList = meta.loopBadges || [];
    if (!badgeList.length) return;
    const inside = (id, containerId) => {
      const seen = new Set();
      let cur = id;
      while (cur !== undefined && !seen.has(cur)) {
        if (cur === containerId) return true;
        seen.add(cur);
        const n = store.node(cur);
        cur = n ? n.parent : undefined;
      }
      return false;
    };
    for (const b of badgeList) {
      const list = [];
      for (const e of store.edges.values()) {
        if (e.loop && inside(e.source, b.id) && inside(e.target, b.id)) list.push(e.id);
      }
      containerLoops.set(b.id, { max: b.max, edges: list });
    }
  }

  // `h` rides along so a node-hosted pulse can sit on the border instead of over the label.
  const centre = (r) => ({ x: r.x, y: r.y, h: r.h });

  /** A token on something hidden inside a collapsed container renders on the container. */
  function anchorFor(kind, id, progress) {
    const vis = scene.visual;
    if (kind === "edge") {
      const alias = edgeAlias.get(id) || id;
      const e = vis.edges.get(alias);
      if (e && e.points && e.points.length) return pointAt(e.points, progress);
      // An edge wholly inside a collapsed container has no geometry: ride the container.
      const spec = store.edge(id);
      return spec ? nodeAnchor(spec.target) || nodeAnchor(spec.source) : null;
    }
    return nodeAnchor(id);
  }

  function nodeAnchor(id) {
    const vis = scene.visual;
    const n = vis.nodes.get(id);
    if (n) return centre(n);
    const up = vs && vs.visibleAncestor ? vs.visibleAncestor(id) : null;
    const host = up && up !== id ? vis.nodes.get(up) : null;
    return host ? centre(host) : null;
  }

  function setEdgeTraversal(st) {
    const merged = new Map();
    for (const [id, e] of Object.entries(st.edges)) {
      const alias = edgeAlias.get(id) || id;
      const v = merged.get(alias) || 0;
      if (e.traversed > v) merged.set(alias, e.traversed);
      else if (!merged.has(alias)) merged.set(alias, e.traversed);
    }
    for (const [id, v] of merged) {
      const prev = traversedAt.get(id);
      const rounded = Math.round(v * 100) / 100;
      if (prev === rounded) continue;
      const el = renderer.edge(id);
      if (!el) continue;
      traversedAt.set(id, rounded);
      if (rounded > 0) {
        el.setAttribute("data-traversed", "");
        el.style.setProperty("--smv-traversed", String(rounded));
      } else {
        el.removeAttribute("data-traversed");
        el.style.removeProperty("--smv-traversed");
      }
    }
    for (const id of [...traversedAt.keys()]) if (!merged.has(id)) traversedAt.delete(id);
  }

  function setRunStatus(id, status) {
    if (runStatusAt.get(id) === status) return;
    runStatusAt.set(id, status);
    const el = renderer.node(id);
    if (!el) return;
    if (status === "pending") el.removeAttribute("data-run");
    else el.setAttribute("data-run", status);
  }

  /** stateAt(t) with the condense progress floors folded in (never mutates the engine's
   *  own objects — stateAt returns fresh ones, but the floor stays a render concern). */
  function sample() {
    const st = run.state();
    for (const [id, floor] of floors) {
      const n = st.nodes[id];
      if (!n || n.progress >= floor) { floors.delete(id); continue; }
      st.nodes[id] = { ...n, progress: floor, status: n.status === "pending" ? "active" : n.status };
    }
    return st;
  }

  function draw() {
    if (destroyed) return;
    const st = sample();
    const vis = scene.visual;
    const now = ticker.now();

    // --- per-node: progress fill, occupancy badge, join pips ---
    for (const [id, r] of vis.nodes) {
      const n = st.nodes[id];
      if (!n) { setRunStatus(id, "pending"); continue; }
      setRunStatus(id, n.status);
      const iw = Math.max(0, r.w - 2 * FILL_INSET);
      const ih = Math.max(0, r.h - 2 * FILL_INSET);
      if (n.status === "active" && n.progress > 0 && iw > 0) {
        const el = fills.get(id);
        el.setAttribute("x", String(r2(r.x - r.w / 2 + FILL_INSET)));
        el.setAttribute("y", String(r2(r.y - r.h / 2 + FILL_INSET)));
        el.setAttribute("width", String(r2(iw * Math.min(1, n.progress))));
        el.setAttribute("height", String(r2(ih)));
      }
      if (n.occupancy > 1) {
        const el = badges.get(id);
        el.setAttribute("x", String(r2(r.x + r.w / 2 - 6)));
        el.setAttribute("y", String(r2(r.y - r.h / 2 + 9)));
        el.textContent = `×${n.occupancy}`;
      }
      const j = st.joins[id];
      if (j && j.needed > 1) {
        const y = r2(r.y + r.h / 2 + 7);
        const x0 = r.x - ((j.needed - 1) * PIP_GAP) / 2;
        for (let i = 0; i < j.needed; i++) {
          const el = pips.get(`${id}#${i}`);
          el.setAttribute("cx", String(r2(x0 + i * PIP_GAP)));
          el.setAttribute("cy", String(y));
          if (i < j.arrived) el.setAttribute("data-filled", "");
          else el.removeAttribute("data-filled");
        }
      }
    }

    // --- loop badges: on the arc while visible, on the container once collapsed (D3/D5) ---
    for (const [eid, lp] of Object.entries(st.loops)) {
      if (!lp.iteration || !lp.max) continue;
      const alias = edgeAlias.get(eid) || eid;
      const e = vis.edges.get(alias);
      if (!e || !e.points || !e.points.length) continue;
      const p = pointAt(e.points, 0.5);
      const el = loops.get(alias);
      el.setAttribute("x", String(r2(p.x)));
      el.setAttribute("y", String(r2(p.y - 8)));
      el.textContent = `iter ${lp.iteration}/${lp.max}`;
    }
    for (const [cid, rec] of containerLoops) {
      const r = vis.nodes.get(cid);
      if (!r) continue;
      let iteration = 0;
      for (const eid of rec.edges) {
        const lp = st.loops[eid];
        if (lp && lp.iteration > iteration) iteration = lp.iteration;
      }
      if (!iteration) continue;
      const el = loops.get(`c:${cid}`);
      el.setAttribute("x", String(r2(r.x)));
      el.setAttribute("y", String(r2(r.y - r.h / 2 - 6)));
      el.textContent = `iter ${iteration}/${rec.max}`;
    }

    // --- token pulses ---
    const perNode = new Map();
    for (const tk of st.tokens) if (tk.at.kind === "node") perNode.set(tk.at.id, (perNode.get(tk.at.id) || 0) + 1);
    const seenNode = new Map();
    for (const tk of st.tokens) {
      const pt = anchorFor(tk.at.kind, tk.at.id, tk.at.progress);
      if (!pt) continue;
      let dx = 0, dy = 0;
      if (tk.at.kind === "node") {
        const total = perNode.get(tk.at.id) || 1;
        const i = seenNode.get(tk.at.id) || 0;
        seenNode.set(tk.at.id, i + 1);
        dx = (i - (total - 1) / 2) * TOKEN_FAN;
        // A dwelling pulse rides the node's TOP border, never its middle: the label under
        // it stays readable and the progress fill already says "working here".
        if (Number.isFinite(pt.h)) dy = -pt.h / 2;
      }
      const el = dots.get(tk.id);
      el.setAttribute("cx", String(r2(pt.x + dx)));
      el.setAttribute("cy", String(r2(pt.y + dy)));
      el.setAttribute("data-where", tk.at.kind);
      if (tk.rate === 0) el.setAttribute("data-frozen", "");
      else el.removeAttribute("data-frozen");
    }

    // --- ghosts: tokens whose node was merged away by condense (D4) ---
    if (ghosts.length) {
      ghosts = ghosts.filter((gh) => now - gh.t0 < GHOST_MS);
      for (const gh of ghosts) {
        const el = ghostEls.get(gh.id);
        el.setAttribute("cx", String(r2(gh.x)));
        el.setAttribute("cy", String(r2(gh.y)));
        el.setAttribute("opacity", String(r2(1 - (now - gh.t0) / GHOST_MS)));
      }
      if (!ghosts.length && ghostCb) { ticker.remove(ghostCb); ghostCb = null; }
    }

    fills.sweep(); pips.sweep(); badges.sweep(); loops.sweep(); dots.sweep(); ghostEls.sweep();
    setEdgeTraversal(st);
  }

  function onRemap({ target, progress, ghosts: list }) {
    const vis = scene.visual;
    const now = ticker.now();
    for (const gh of list || []) {
      const r = vis.nodes.get(gh.nodeId);
      if (r) ghosts.push({ id: gh.id, x: r.x, y: r.y, t0: now });
    }
    if (progress > 0 && target != null) floors.set(target, progress);
    if (ghosts.length && !ghostCb) {
      ghostCb = () => draw();
      ticker.add(ghostCb);
    }
    draw();
  }

  const offs = [
    scene.onFrame(draw),
    run.on("tick", draw),
    run.on("seek", () => { floors.clear(); draw(); }),
    run.on("recompile", draw),
    run.on("step", draw),
    run.on("speed", draw),
    run.on("pause", draw),
    run.on("remap", onRemap),
  ];
  // A commit can destroy and recreate the very elements these caches remember writing to
  // (collapse/expand, storyboard restore) — a fresh <g> starts with no data-run/data-traversed
  // of its own, so the memoized "already wrote this value" state must not survive it, or the
  // decoration silently never reappears on the new element (it looks identical to the cache).
  if (internals.bus) {
    offs.push(internals.bus.on("commit", (ev) => {
      indexView(ev && ev.meta);
      traversedAt.clear();
      runStatusAt.clear();
      draw();
    }));
  }

  // A run is usually created after the first commit, so seed the view index rather than
  // waiting for the next one — otherwise tokens inside a collapsed container have nowhere
  // to render until something else moves.
  if (vs && typeof vs.view === "function") indexView(vs.view().meta);
  draw();

  return {
    draw,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) if (typeof off === "function") off();
      if (ghostCb) { ticker.remove(ghostCb); ghostCb = null; }
      for (const id of traversedAt.keys()) {
        const el = renderer.edge(id);
        if (el) { el.removeAttribute("data-traversed"); el.style.removeProperty("--smv-traversed"); }
      }
      for (const id of runStatusAt.keys()) {
        const el = renderer.node(id);
        if (el) el.removeAttribute("data-run");
      }
      traversedAt.clear(); runStatusAt.clear(); floors.clear();
      fills.clear(); pips.clear(); badges.clear(); loops.clear(); dots.clear(); ghostEls.clear();
      layer.remove();
    },
  };
}

export default { createRunRender };
