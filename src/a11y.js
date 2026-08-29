// M2 — ARIA + keyboard navigation (PLAN.md M2 "non-negotiable before 1.0"). Ships in the
// IIFE (core), always on unless `opts.a11y === false` (index.js's concern).
//
// Queries the live DOM by `[data-id]` on `.smv-node` under the svg the renderer owns —
// never touches render.js, and is re-applied after every `commit` event because the
// renderer keys elements by id and enters/exits them across mutations (a node's <g> from
// two commits ago may simply not exist any more). Pure DOM attribute writes; no state of
// its own survives a commit except which id currently holds the roving tabindex.

const STYLE_MARKER = "data-smv-a11y";

// :focus-visible covers pointer users tabbing in; the plain `[tabindex="0"]:focus` rule
// also lights up when we move focus programmatically via el.focus() on arrow-key nav
// (some engines don't treat scripted .focus() as "visible" under :focus-visible).
const CSS = `
.smv-node[tabindex]{outline:none}
.smv-node[tabindex="0"]:focus rect.smv-node-box,
.smv-node:focus-visible rect.smv-node-box{
  outline:2px solid var(--smv-accent, #5b6ef5);
  outline-offset:2px;
}
`;

function injectA11yStyles(doc) {
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

/** Pure: visible node ids from a `g.layoutResult()`, sorted x then y (reading order). */
export function readingOrder(layoutResult) {
  if (!layoutResult || !layoutResult.nodes) return [];
  const nodes = layoutResult.nodes;
  return Object.keys(nodes).sort((a, b) => {
    const na = nodes[a], nb = nodes[b];
    if (na.x !== nb.x) return na.x - nb.x;
    return na.y - nb.y;
  });
}

/** `aria-level` walks the spec parent chain via public `g.node()` — layout() carries no
 *  hierarchy (frozen seam, D2), only viewstate/store do. Cycle-guarded like every other
 *  parent walk in this codebase (a mutilated store must degrade, not hang). */
function depthOf(id, node) {
  let d = 0, cur = id, n = node(cur);
  const seen = new Set([id]);
  while (n && n.parent !== undefined && !seen.has(n.parent)) {
    const p = node(n.parent);
    if (!p) break;
    d++; seen.add(n.parent); cur = n.parent; n = p;
  }
  return d;
}

const isSpace = (key) => key === " " || key === "Spacebar";

export function attachA11y(g, { root, svg } = {}) {
  const noop = { destroy() {} };
  // Guard: importable and safely callable under Node (no document) or with a stub host.
  if (!g || !svg || typeof svg.setAttribute !== "function" || typeof svg.querySelectorAll !== "function") {
    return noop;
  }

  const doc = svg.ownerDocument || (root && root.ownerDocument) || null;
  if (doc) injectA11yStyles(doc);

  const node = (id) => (typeof g.node === "function" ? g.node(id) : null);
  const layoutOf = () => (typeof g.layoutResult === "function" ? g.layoutResult() : null);
  const vs = g.viewstate;

  const setAriaLabel = !(typeof svg.getAttribute === "function" && svg.getAttribute("aria-label"));
  svg.setAttribute("role", "application");
  svg.setAttribute("aria-roledescription", "graph");
  if (setAriaLabel) {
    const fallback = (root && typeof root.getAttribute === "function" && root.getAttribute("aria-label")) || "Graph";
    svg.setAttribute("aria-label", fallback);
  }

  let currentId = null;

  const nodeEls = () => Array.from(svg.querySelectorAll(".smv-node"));
  const findEl = (id) => nodeEls().find((el) => el.getAttribute("data-id") === id) || null;

  function ariaLabelFor(id) {
    const n = node(id);
    const status = n && n.data && n.data.status;
    const label = (n && n.label) || id;
    return status ? `${label} · ${status}` : String(label);
  }

  function isContainer(id) {
    return !!(vs && typeof vs.isContainer === "function" && vs.isContainer(id));
  }
  function isCollapsed(id) {
    return !!(vs && vs.collapsed && vs.collapsed.has(id));
  }

  /** Re-applies every ARIA attribute + the roving tabindex. Called on attach and on every
   *  `commit` (the DOM elements it targets may all be freshly re-created since). */
  function applyAttrs() {
    const groupG = svg.querySelector && svg.querySelector(".smv-nodes");
    if (groupG && typeof groupG.setAttribute === "function") groupG.setAttribute("role", "tree");

    const ids = readingOrder(layoutOf());
    if (ids.length && (currentId == null || !ids.includes(currentId))) currentId = ids[0];

    for (const el of nodeEls()) {
      const id = el.getAttribute("data-id");
      if (id == null) continue;
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-level", String(depthOf(id, node) + 1));
      el.setAttribute("aria-label", ariaLabelFor(id));
      if (isContainer(id)) el.setAttribute("aria-expanded", isCollapsed(id) ? "false" : "true");
      else if (typeof el.removeAttribute === "function") el.removeAttribute("aria-expanded");
      el.setAttribute("tabindex", id === currentId ? "0" : "-1");
    }
  }

  function focusId(id) {
    if (id == null) return;
    currentId = id;
    for (const el of nodeEls()) {
      el.setAttribute("tabindex", el.getAttribute("data-id") === id ? "0" : "-1");
    }
    const el = findEl(id);
    if (el && typeof el.focus === "function") el.focus();
  }

  function move(delta) {
    const ids = readingOrder(layoutOf());
    if (!ids.length) return;
    const i = Math.max(0, ids.indexOf(currentId));
    focusId(ids[Math.min(ids.length - 1, Math.max(0, i + delta))]);
  }

  function toggle(id) {
    if (id == null || !isContainer(id)) return;
    if (isCollapsed(id)) { if (typeof g.expand === "function") g.expand(id); }
    else if (typeof g.collapse === "function") g.collapse(id);
  }

  function onKeydown(ev) {
    const key = ev && ev.key;
    const stop = () => { if (ev && typeof ev.preventDefault === "function") ev.preventDefault(); };
    switch (key) {
      case "ArrowRight": case "ArrowDown": stop(); move(1); break;
      case "ArrowLeft": case "ArrowUp": stop(); move(-1); break;
      case "Home": { const ids = readingOrder(layoutOf()); if (ids.length) { stop(); focusId(ids[0]); } break; }
      case "End": { const ids = readingOrder(layoutOf()); if (ids.length) { stop(); focusId(ids[ids.length - 1]); } break; }
      case "Enter": stop(); toggle(currentId); break;
      default: if (isSpace(key)) { stop(); toggle(currentId); }
    }
  }

  if (typeof svg.addEventListener === "function") svg.addEventListener("keydown", onKeydown);
  applyAttrs();
  const offCommit = typeof g.on === "function" ? g.on("commit", applyAttrs) : null;

  return {
    destroy() {
      if (typeof svg.removeEventListener === "function") svg.removeEventListener("keydown", onKeydown);
      if (offCommit) offCommit();
      const groupG = svg.querySelector && svg.querySelector(".smv-nodes");
      if (groupG && typeof groupG.removeAttribute === "function") groupG.removeAttribute("role");
      svg.removeAttribute("role");
      svg.removeAttribute("aria-roledescription");
      if (setAriaLabel) svg.removeAttribute("aria-label");
      for (const el of nodeEls()) {
        el.removeAttribute("role");
        el.removeAttribute("aria-level");
        el.removeAttribute("aria-label");
        el.removeAttribute("aria-expanded");
        el.removeAttribute("tabindex");
      }
    },
  };
}

export default { attachA11y, readingOrder };
