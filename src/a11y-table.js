// M2 — linearized table fallback (PLAN.md M2 "non-negotiable before 1.0"). ESM-only entry
// `sparkle-motion-visualizer/a11y-table` (package.json export owned by the integration
// agent) — not part of the IIFE.
//
// One row per VISIBLE node: label, status, duration, depth, outgoing targets. Appended
// after the svg inside the mount root, kept in sync on `commit`/`update`.

const STYLE_MARKER = "data-smv-a11y-table";
const HIDDEN_CLASS = "smv-a11y-table-hidden";

// A standard visually-hidden clip (not display:none — screen readers still need it laid
// out) scoped to our own class so it never depends on styles.js.
const CSS = `
.${HIDDEN_CLASS}{
  position:absolute !important;
  width:1px !important; height:1px !important;
  padding:0 !important; margin:-1px !important;
  overflow:hidden !important;
  clip:rect(0,0,0,0) !important;
  clip-path:inset(50%) !important;
  white-space:nowrap !important;
  border:0 !important;
}
`;

function injectTableStyles(doc) {
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

/** Same live-status preference as a11y.js's `ariaLabelFor`: run-render.js writes the
 *  live run state to `data-run` on each `.smv-node` per status transition and
 *  deliberately never back into the spec (a run is not a spec mutation), so the static
 *  `data.status` alone goes stale the moment a run starts. Reads the DOM rather than
 *  keeping our own cache of `runstatus` payloads, so a `commit` that recreates the
 *  elements (collapse/expand) resets us for free exactly when run-render's own
 *  `runStatusAt` cache resets — no separate invalidation to keep in sync with it. */
function liveRunStatus(g) {
  const root = g && g.el;
  const svg = root && typeof root.querySelector === "function" ? root.querySelector("svg") : null;
  const live = new Map();
  if (!svg || typeof svg.querySelectorAll !== "function") return live;
  for (const el of svg.querySelectorAll(".smv-node")) {
    const id = typeof el.getAttribute === "function" ? el.getAttribute("data-id") : null;
    const run = typeof el.getAttribute === "function" ? el.getAttribute("data-run") : null;
    if (id != null && run) live.set(id, run);
  }
  return live;
}

/** Pure row-model derivation: `g` -> `[{id,label,status,duration,depth,targets:[id,...]}]`.
 *  Visible-node source of truth is `g.layoutResult().nodes` (exactly what's on screen —
 *  meta-edge remaps and collapsed containers already folded in); falls back to walking
 *  the spec through `viewstate.isVisible` if no layout has landed yet. Targets are the
 *  *other spec edges'* visible ancestors (mirrors viewstate's own boundary-edge remap,
 *  via the public `visibleAncestor`), deduped, self-loops on the row's own id dropped.
 *  `status` prefers the live `data-run` value over the design-time `data.status` (see
 *  `liveRunStatus`) — this table is THE accessible surface when a page mounts with
 *  `a11y:false`, and a run driving the graph with no live signal here left it silently
 *  wrong the whole time a run was in progress. */
export function computeRows(g) {
  if (!g) return [];
  const spec = typeof g.spec === "function" ? g.spec() : null;
  const byId = new Map();
  if (spec) for (const n of spec.nodes || []) byId.set(n.id, n);

  const vs = g.viewstate;
  const lr = typeof g.layoutResult === "function" ? g.layoutResult() : null;
  const runStatus = liveRunStatus(g);

  let ids;
  if (lr && lr.nodes) ids = Object.keys(lr.nodes);
  else if (vs && typeof vs.isVisible === "function") ids = [...byId.keys()].filter((id) => vs.isVisible(id));
  else ids = [...byId.keys()];

  const depthOf = (id) => {
    let d = 0, cur = id, n = byId.get(cur);
    const seen = new Set([id]);
    while (n && n.parent !== undefined && byId.has(n.parent) && !seen.has(n.parent)) {
      d++; seen.add(n.parent); cur = n.parent; n = byId.get(cur);
    }
    return d;
  };

  const ancestorOf = (id) => {
    if (vs && typeof vs.visibleAncestor === "function") return vs.visibleAncestor(id);
    return byId.has(id) ? id : null;
  };

  const targetsOf = (id) => {
    const out = [], seen = new Set();
    for (const e of (spec && spec.edges) || []) {
      if (ancestorOf(e.source) !== id) continue;
      const t = ancestorOf(e.target);
      if (t == null || t === id || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  };

  return ids.map((id) => {
    const n = byId.get(id) || { id };
    const d = n.data || {};
    const live = runStatus.get(id);
    return {
      id,
      label: n.label != null ? String(n.label) : String(id),
      status: live || (d.status != null ? String(d.status) : ""),
      duration: d.duration != null ? String(d.duration) : "",
      depth: depthOf(id),
      targets: targetsOf(id),
    };
  });
}

export function attachA11yTable(g, { visible = false } = {}) {
  const root = g && g.el;
  const noop = { el: null, destroy() {} };
  if (!root || typeof root.appendChild !== "function" || !root.ownerDocument) return noop;

  const doc = root.ownerDocument;
  injectTableStyles(doc);

  const table = doc.createElement("table");
  table.setAttribute("class", visible ? "smv-a11y-table" : `smv-a11y-table ${HIDDEN_CLASS}`);

  const caption = doc.createElement("caption");
  caption.textContent = "Graph nodes (accessible table view)";
  table.appendChild(caption);

  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const h of ["Label", "Status", "Duration", "Depth", "Outgoing"]) {
    const th = doc.createElement("th");
    th.setAttribute("scope", "col");
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  table.appendChild(tbody);

  const labelOf = (id) => {
    const n = typeof g.node === "function" ? g.node(id) : null;
    return (n && n.label) || id;
  };

  /** This table and a11y.js's interactive tree are two renderings of the SAME content, and
   *  nothing stops a page attaching both (the tree is on by default). Announcing both makes
   *  assistive tech read every node twice in a row, so only one of them is ever in the
   *  accessibility tree: with the tree attached this stays a visual/structural fallback;
   *  with `mount(..., { a11y: false })` this IS the accessible surface. Re-checked per
   *  render so attaching/destroying the tree later stays coherent. */
  function syncAria() {
    const svg = typeof root.querySelector === "function" ? root.querySelector("svg") : null;
    const treeOn = !!(svg && typeof svg.getAttribute === "function" && svg.getAttribute("role") === "application");
    if (treeOn) table.setAttribute("aria-hidden", "true");
    else table.removeAttribute("aria-hidden");
  }

  function render() {
    syncAria();
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    for (const row of computeRows(g)) {
      const tr = doc.createElement("tr");
      tr.setAttribute("data-id", row.id);
      for (const c of [row.label, row.status, row.duration, String(row.depth), row.targets.map(labelOf).join(", ")]) {
        const td = doc.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  render();
  root.appendChild(table);

  const offs = [];
  if (typeof g.on === "function") {
    offs.push(g.on("commit", render));
    offs.push(g.on("update", render));
    // run-render.js writes `data-run` and emits this outside the commit/update cycle
    // (a run is not a spec mutation), so the table needs its own subscription or the
    // Status column simply never moves while a run is in progress.
    offs.push(g.on("runstatus", render));
  }

  return {
    el: table,
    destroy() {
      for (const off of offs) off();
      if (table.parentNode && typeof table.parentNode.removeChild === "function") table.parentNode.removeChild(table);
      else if (typeof table.remove === "function") table.remove();
    },
  };
}

export default { attachA11yTable, computeRows };
