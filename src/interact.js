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

/** Walk up from an event target to the enclosing `.smv-node` and return its data-id. */
function nodeIdFrom(target, stopAt) {
  let el = target;
  while (el && el !== stopAt) {
    const cls = el.getAttribute ? el.getAttribute("class") : null;
    if (cls && ` ${cls} `.indexOf(" smv-node ") >= 0) return el.getAttribute("data-id");
    el = el.parentNode;
  }
  return null;
}

export function attachTapToggle(g, { svg }) {
  if (!svg || typeof svg.addEventListener !== "function") return { destroy() {} };

  let down = null; // {id, x, y, pointerId, dead}

  function onDown(ev) {
    if (down) { down.dead = true; return; } // second pointer: this is a pinch, not a tap
    down = {
      id: nodeIdFrom(ev.target, svg.parentNode),
      x: ev.clientX || 0, y: ev.clientY || 0,
      pointerId: ev.pointerId, dead: false,
    };
  }

  function onUp(ev) {
    const d = down;
    if (!d) return;
    if (ev.pointerId !== undefined && d.pointerId !== undefined && ev.pointerId !== d.pointerId) return;
    down = null;
    if (d.dead || d.id == null) return;
    const dx = (ev.clientX || 0) - d.x, dy = (ev.clientY || 0) - d.y;
    if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) return; // it was a pan
    const vs = g.viewstate;
    if (!vs || !vs.isContainer(d.id)) return;
    if (vs.collapsed.has(d.id)) g.expand(d.id);
    else g.collapse(d.id);
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
