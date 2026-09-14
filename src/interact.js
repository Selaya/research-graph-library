// M2 — tap/click a container node to expand/collapse it (the §6 "drill in" affordance),
// touch-first: pointer events unify mouse/touch/pen, and the decision is made at
// pointerup so a pan never toggles. Ships in the IIFE; `opts.interaction.tapToggle:
// false` opts out (index.js's concern).
//
// Two constraints shape this:
// - The viewport calls setPointerCapture(svg) on pointerdown, which retargets every
//   LATER event in the gesture to the svg — so the node under the finger is resolved at
//   pointerdown (targets are still real there) and only remembered until pointerup.
// - A tap is "no real movement, one pointer": any second pointer (pinch) or travel past
//   the slop radius (pan) disqualifies the gesture entirely.

const TAP_SLOP_PX = 6;

/** Walk up from an event target to the enclosing `.smv-node`/`.smv-edge` and return
 *  `{kind, id}` for whichever is found first, or null. */
function hitFrom(target, stopAt) {
  let el = target;
  while (el && el !== stopAt) {
    const cls = el.getAttribute ? ` ${el.getAttribute("class") || ""} ` : "";
    if (cls.indexOf(" smv-node ") >= 0) return { kind: "node", id: el.getAttribute("data-id") };
    if (cls.indexOf(" smv-edge ") >= 0) return { kind: "edge", id: el.getAttribute("data-id") };
    el = el.parentNode;
  }
  return null;
}

/**
 * `toggle: false` keeps the listeners (F27 clicks still fire) but stops the expand/collapse.
 * `emit` publishes `nodeclick`/`edgeclick` on `g`'s own bus — suppressed by the very same
 * slop/pinch guard the toggle uses, so a pan never reads as a click.
 */
export function attachTapToggle(g, { svg, toggle = true, emit = null }) {
  if (!svg || typeof svg.addEventListener !== "function") return { destroy() {} };

  let down = null; // {hit, x, y, pointerId, dead}

  function onDown(ev) {
    if (down) { down.dead = true; return; } // second pointer: this is a pinch, not a tap
    down = {
      hit: hitFrom(ev.target, svg.parentNode),
      x: ev.clientX || 0, y: ev.clientY || 0,
      pointerId: ev.pointerId, dead: false,
    };
  }

  function onUp(ev) {
    const d = down;
    if (!d) return;
    if (ev.pointerId !== undefined && d.pointerId !== undefined && ev.pointerId !== d.pointerId) return;
    down = null;
    if (d.dead || !d.hit || d.hit.id == null) return;
    const dx = (ev.clientX || 0) - d.x, dy = (ev.clientY || 0) - d.y;
    if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) return; // it was a pan
    const { kind, id } = d.hit;
    if (emit) emit(kind === "edge" ? "edgeclick" : "nodeclick", { id, event: ev });
    if (!toggle || kind !== "node") return;
    const vs = g.viewstate;
    if (!vs || !vs.isContainer(id)) return;
    if (vs.collapsed.has(id)) g.expand(id);
    else g.collapse(id);
  }

  function onCancel() { down = null; }

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onCancel);
  return {
    destroy() {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onCancel);
      down = null;
    },
  };
}

export default { attachTapToggle };
