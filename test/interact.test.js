// M2 — tap-to-toggle (src/interact.js): tap a container node -> expand/collapse through
// the public API; a pan (movement past the slop) or a pinch (second pointer) never
// toggles. Tested against a minimal fake DOM: interact.js only needs addEventListener,
// getAttribute, and parentNode walks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { attachTapToggle } from "../src/interact.js";

function fakeEl(cls, id, parent) {
  const el = {
    attrs: cls ? { class: cls, "data-id": id } : {},
    parentNode: parent || null,
    listeners: {},
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) {
      const l = this.listeners[t] || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    fire(t, ev) { for (const fn of [...(this.listeners[t] || [])]) fn(ev); },
  };
  return el;
}

function harness({ containers = ["box"], collapsed = ["box"] } = {}) {
  const rootEl = fakeEl(null, null, null);
  const svg = fakeEl("smv", null, rootEl);
  const nodeG = fakeEl("smv-node", "box", svg);
  const rect = fakeEl(null, null, nodeG); // tap lands on the rect INSIDE the node group
  rect.attrs = {};
  const calls = [];
  const collapsedSet = new Set(collapsed);
  const g = {
    viewstate: {
      collapsed: collapsedSet,
      isContainer: (id) => containers.includes(id),
    },
    expand(id) { calls.push(["expand", id]); collapsedSet.delete(id); },
    collapse(id) { calls.push(["collapse", id]); collapsedSet.add(id); },
  };
  const tap = attachTapToggle(g, { svg });
  return { svg, rect, nodeG, calls, g, tap };
}

test("a clean tap on a collapsed container expands it; the next tap collapses", () => {
  const { svg, rect, calls } = harness();
  svg.fire("pointerdown", { target: rect, clientX: 10, clientY: 10, pointerId: 1 });
  svg.fire("pointerup", { target: svg, clientX: 11, clientY: 10, pointerId: 1 });
  assert.deepEqual(calls, [["expand", "box"]]);
  svg.fire("pointerdown", { target: rect, clientX: 40, clientY: 12, pointerId: 2 });
  svg.fire("pointerup", { target: svg, clientX: 40, clientY: 12, pointerId: 2 });
  assert.deepEqual(calls, [["expand", "box"], ["collapse", "box"]]);
});

test("movement past the slop radius is a pan, not a tap", () => {
  const { svg, rect, calls } = harness();
  svg.fire("pointerdown", { target: rect, clientX: 10, clientY: 10, pointerId: 1 });
  svg.fire("pointerup", { target: svg, clientX: 40, clientY: 10, pointerId: 1 });
  assert.deepEqual(calls, []);
});

test("a second pointer (pinch) kills the gesture even if both lift in place", () => {
  const { svg, rect, calls } = harness();
  svg.fire("pointerdown", { target: rect, clientX: 10, clientY: 10, pointerId: 1 });
  svg.fire("pointerdown", { target: rect, clientX: 30, clientY: 30, pointerId: 2 });
  svg.fire("pointerup", { target: svg, clientX: 10, clientY: 10, pointerId: 1 });
  svg.fire("pointerup", { target: svg, clientX: 30, clientY: 30, pointerId: 2 });
  assert.deepEqual(calls, []);
});

test("tapping a non-container node or empty canvas does nothing", () => {
  const { svg, calls } = harness({ containers: [] });
  const plain = fakeEl("smv-node", "leaf", svg);
  svg.fire("pointerdown", { target: plain, clientX: 5, clientY: 5, pointerId: 1 });
  svg.fire("pointerup", { target: svg, clientX: 5, clientY: 5, pointerId: 1 });
  svg.fire("pointerdown", { target: svg, clientX: 90, clientY: 90, pointerId: 2 });
  svg.fire("pointerup", { target: svg, clientX: 90, clientY: 90, pointerId: 2 });
  assert.deepEqual(calls, []);
});

test("pointercancel clears the gesture; destroy() removes every listener", () => {
  const { svg, rect, calls, tap } = harness();
  svg.fire("pointerdown", { target: rect, clientX: 10, clientY: 10, pointerId: 1 });
  svg.fire("pointercancel", {});
  svg.fire("pointerup", { target: svg, clientX: 10, clientY: 10, pointerId: 1 });
  assert.deepEqual(calls, []);
  tap.destroy();
  assert.equal((svg.listeners.pointerdown || []).length, 0);
  assert.equal((svg.listeners.pointerup || []).length, 0);
  assert.equal((svg.listeners.pointercancel || []).length, 0);
});

test("imports cleanly and no-ops without a real svg (Node safety)", () => {
  const tap = attachTapToggle({}, { svg: null });
  tap.destroy();
});
