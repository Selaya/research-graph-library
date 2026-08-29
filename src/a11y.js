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

  /** render.js hides off-screen groups once a drawing is big enough (`data-culled` +
   *  display:none), and `.focus()` on a hidden element is a silent no-op. Moving the roving
   *  tabindex onto one therefore strands REAL focus on the element we just demoted to
   *  tabindex="-1": the ring stays put while Enter/arrows act on a node nobody can see, and
   *  tabbing back into the widget lands on nothing. */
  const isCulled = (el) => !!el && el.getAttribute("data-culled") !== null;

  /** Reading order restricted to the nodes that can actually take focus. Falls back to the
   *  full order when everything is culled, so navigation never dead-ends. */
  function navOrder() {
    const ids = readingOrder(layoutOf());
    const els = new Map();
    for (const el of nodeEls()) els.set(el.getAttribute("data-id"), el);
    const live = ids.filter((id) => els.has(id) && !isCulled(els.get(id)));
    return live.length ? live : ids;
  }

  /** `status` prefers the LIVE run state over the design-time `data.status`. run-render.js
   *  writes it to `data-run` on the element per status transition and deliberately never
   *  back into the spec, so reading the spec alone left a screen-reader user with no signal
   *  at all while a run drove the graph (sighted users get fills, pulses and badges). */
  function ariaLabelFor(id, el) {
    const n = node(id);
    const run = el && typeof el.getAttribute === "function" ? el.getAttribute("data-run") : null;
    const status = run || (n && n.data && n.data.status);
    const label = (n && n.label) || id;
    return status ? `${label} · ${status}` : String(label);
  }

  function isContainer(id) {
    return !!(vs && typeof vs.isContainer === "function" && vs.isContainer(id));
  }
  function isCollapsed(id) {
    return !!(vs && vs.collapsed && vs.collapsed.has(id));
  }

  /** The `<g class="smv-node">` an event landed on (or inside). */
  function nodeElFor(target) {
    let el = target, guard = 0;
    while (el && guard++ < 16) {
      if (typeof el.getAttribute === "function"
        && (el.getAttribute("class") || "").split(/\s+/).includes("smv-node")) return el;
      el = el.parentNode;
    }
    return null;
  }

  /** Which of our elements really holds DOM focus right now (null if focus is elsewhere). */
  function focusedEl() {
    const active = doc && doc.activeElement;
    if (!active || typeof active.getAttribute !== "function") return null;
    return nodeEls().includes(active) ? active : null;
  }

  function setRoving() {
    for (const el of nodeEls()) {
      el.setAttribute("tabindex", el.getAttribute("data-id") === currentId ? "0" : "-1");
    }
  }

  /** Re-applies every ARIA attribute + the roving tabindex. Called on attach and on every
   *  `commit` (the DOM elements it targets may all be freshly re-created since). */
  function applyAttrs() {
    const groupG = svg.querySelector && svg.querySelector(".smv-nodes");
    if (groupG && typeof groupG.setAttribute === "function") groupG.setAttribute("role", "tree");

    const ids = readingOrder(layoutOf());
    const active = focusedEl();
    const activeId = active ? active.getAttribute("data-id") : null;
    if (activeId != null) currentId = activeId; // real focus always wins over our bookkeeping
    // The focused node is leaving the visible set (its container just collapsed, a condense
    // merged it away). Its element is still in the DOM mid-exit-animation; once it detaches
    // the browser drops focus to <body>, so re-home it onto the new roving stop now.
    const orphaned = activeId != null && !ids.includes(activeId);
    // The roving stop has to be somewhere focus can actually go, so re-home onto the
    // navigable subset (culling excluded) rather than the first id in reading order.
    if (ids.length && (currentId == null || !ids.includes(currentId))) currentId = navOrder()[0];

    for (const el of nodeEls()) {
      const id = el.getAttribute("data-id");
      if (id == null) continue;
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-level", String(depthOf(id, node) + 1));
      el.setAttribute("aria-label", ariaLabelFor(id, el));
      if (isContainer(id)) el.setAttribute("aria-expanded", isCollapsed(id) ? "false" : "true");
      else if (typeof el.removeAttribute === "function") el.removeAttribute("aria-expanded");
      el.setAttribute("tabindex", id === currentId ? "0" : "-1");
    }

    if (orphaned && currentId != null && currentId !== activeId) {
      const el = findEl(currentId);
      if (el && el !== active && typeof el.focus === "function") el.focus();
    }
  }

  /** run-render writes `data-run` outside the commit cycle, so the accessible name has to
   *  refresh on that channel too. Already throttled at the source: it only fires when a
   *  node's status actually changes, never once per animation frame. */
  function onRunStatus(ev) {
    const id = ev && ev.id;
    if (id == null) return;
    const el = findEl(id);
    if (el) el.setAttribute("aria-label", ariaLabelFor(id, el));
  }

  /** Focus can arrive by routes this module does not drive — a click on the `<g>`, an
   *  external `.focus()`, a screen reader's virtual cursor. The roving-tabindex pattern
   *  requires `currentId` to track REAL focus, or Enter/Space and the arrows act on a stale
   *  node while the user's focus ring sits somewhere else entirely. */
  function onFocusIn(ev) {
    const el = nodeElFor(ev && ev.target);
    const id = el && el.getAttribute("data-id");
    if (id == null || id === currentId) return;
    currentId = id;
    setRoving();
  }

  function focusId(id) {
    if (id == null) return;
    const el = findEl(id);
    if (isCulled(el)) return; // unfocusable: leave the roving stop where focus actually is
    currentId = id;
    setRoving();
    if (el && typeof el.focus === "function") el.focus();
  }

  function move(delta) {
    const ids = navOrder();
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
      case "Home": { const ids = navOrder(); if (ids.length) { stop(); focusId(ids[0]); } break; }
      case "End": { const ids = navOrder(); if (ids.length) { stop(); focusId(ids[ids.length - 1]); } break; }
      case "Enter": stop(); toggle(currentId); break;
      default: if (isSpace(key)) { stop(); toggle(currentId); }
    }
  }

  if (typeof svg.addEventListener === "function") {
    svg.addEventListener("keydown", onKeydown);
    svg.addEventListener("focusin", onFocusIn);
  }
  applyAttrs();
  const offCommit = typeof g.on === "function" ? g.on("commit", applyAttrs) : null;
  const offRun = typeof g.on === "function" ? g.on("runstatus", onRunStatus) : null;

  return {
    destroy() {
      if (typeof svg.removeEventListener === "function") {
        svg.removeEventListener("keydown", onKeydown);
        svg.removeEventListener("focusin", onFocusIn);
      }
      if (offCommit) offCommit();
      if (offRun) offRun();
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
