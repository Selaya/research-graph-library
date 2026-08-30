// smv-fit (M4d): the VO-first hold fitter. Pure JSON->JSON, so almost all of it is testable
// without a browser — the one thing that is not is the claim the whole transform rests on:
// that bin/smv-fit.mjs prices a story exactly the way the library does (D12). That is
// asserted against a REAL `g.cues()`, mounting test/fixtures/record-demo.sb.json through the
// same hand-rolled DOM shim test/m4-integration.test.js uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { durOf, labelOffsets, parseMarks, fit, parseArgs } from "../bin/smv-fit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(root, "test", "fixtures", "record-demo.sb.json");
const readFixture = () => JSON.parse(readFileSync(FIXTURE, "utf8"));

// ---------------------------------------------------------------------------
// DOM shim (integration.test.js's makeEl, trimmed to what a mount needs).
// ---------------------------------------------------------------------------

function makeEl(tag, ns) {
  const el = {
    tagName: tag, ns, children: [], parent: null, attrs: {}, textContent: "", value: "",
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
      getPropertyValue(k) { return this._p[k] ?? ""; },
    },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
    },
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return this.attrs[k] !== undefined; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove();
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) { if (c.parent === this) c.remove(); return c; },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 480 }; },
    clientWidth: 900, clientHeight: 480,
    setPointerCapture() {}, releasePointerCapture() {},
    querySelector() { return null; },
    getContext() { return { font: "", measureText: (s) => ({ width: String(s).length * 7.2 }) }; },
  };
  Object.defineProperty(el, "parentNode", { get() { return this.parent; } });
  el.ownerDocument = null;
  return el;
}

const head = makeEl("head");
const doc = {
  head,
  documentElement: head,
  createElement(t) { const e = makeEl(t); e.ownerDocument = doc; return e; },
  createElementNS(ns, t) { const e = makeEl(t, ns); e.ownerDocument = doc; return e; },
  querySelector(sel) {
    return head.children.find((c) => c.tagName === "style" && Object.keys(c.attrs).some((k) => sel.includes(k))) || null;
  },
};
globalThis.document = doc;
globalThis.window = { matchMedia: () => ({ matches: false }) };

const { mount } = await import("../src/index.js");

// ---------------------------------------------------------------------------
// The parity that everything else rests on (D12).
// ---------------------------------------------------------------------------

test("smv-fit prices a story exactly as g.cues() does (D12 parity, record fixture)", () => {
  const steps = readFixture();
  const spec = JSON.parse(readFileSync(join(root, "test", "fixtures", "record-demo.spec.json"), "utf8"));
  const el = makeEl("div");
  el.ownerDocument = doc;
  // No `animation` opts: the mount's baseDuration is the 350ms default smv-fit assumes.
  const g = mount(el, spec, { ticker: "manual", storyboard: steps });

  const fromLib = g.cues().filter((c) => c.kind === "label").map((c) => ({ label: c.label, at: c.at, index: c.index }));
  const fromBin = labelOffsets(steps).map((l) => ({ label: l.label, at: l.at, index: l.index }));
  assert.deepEqual(fromBin, fromLib, "bin/smv-fit.mjs durOf() and src/index.js durOf() agree");
  // …and the numbers are the ones docs/RECORDING.md quotes for this fixture.
  assert.deepEqual(fromBin, [
    { label: "intro", at: 0, index: 0 },
    { label: "focus", at: 700, index: 4 },
    { label: "automate", at: 1400, index: 8 },
  ]);
  assert.equal(g.timeline().total, steps.reduce((s, x) => s + durOf(x), 0), "and so do the totals");
  g.destroy();
});

test("durOf: every op's default, and `dur` overriding all of them", () => {
  assert.equal(durOf({ label: "x" }), 0);
  assert.equal(durOf({ op: "wait", ms: 400 }), 400);
  assert.equal(durOf({ op: "wait", args: [250] }), 250);
  assert.equal(durOf({ op: "camera", args: [{ fit: true }] }), 600);
  assert.equal(durOf({ op: "camera", args: [{ fit: true, dur: 300 }] }), 300);
  assert.equal(durOf({ op: "condense", args: [["a"], { id: "b" }] }), 900);
  assert.equal(durOf({ op: "highlight", args: [{}] }), 0);
  assert.equal(durOf({ op: "props", args: [null] }), 0);
  assert.equal(durOf({ op: "expand", args: ["a"] }), 350);
  assert.equal(durOf({ op: "expand", args: ["a"] }, 120), 120, "--base is the mount's animation.duration");
  assert.equal(durOf({ op: "expand", args: ["a"], dur: 900 }), 900, "`dur` wins");
  // A batch is worth its longest PARALLEL child, never a folded mutation's own dur.
  assert.equal(durOf({ op: "batch", steps: [{ op: "wait", ms: 800 }, { op: "expand", args: ["a"], dur: 5000 }] }), 800);
});

// ---------------------------------------------------------------------------
// Marks parsing + validation.
// ---------------------------------------------------------------------------

test("parseMarks accepts both shapes and refuses the malformed ones", () => {
  assert.deepEqual(parseMarks({ intro: 0, focus: 4200 }), [{ label: "intro", ms: 0 }, { label: "focus", ms: 4200 }]);
  assert.deepEqual(
    parseMarks([{ label: "intro", ms: 0 }, { label: "focus", ms: 4200 }]),
    [{ label: "intro", ms: 0 }, { label: "focus", ms: 4200 }],
  );
  assert.throws(() => parseMarks({ intro: -5 }), /has no time before 0/);
  assert.throws(() => parseMarks({ intro: "0" }), /needs a number of milliseconds/);
  assert.throws(() => parseMarks({}), /names no labels/);
  assert.throws(() => parseMarks(null), /must be/);
  assert.throws(() => parseMarks([{ label: "a", ms: 1 }, { label: "a", ms: 2 }]), /appears twice/);
});

test("fit refuses an unknown label and marks that run backwards against the script order", () => {
  assert.throws(
    () => fit(readFixture(), parseMarks({ nope: 0 })),
    /does not have: "nope" — known labels: "intro", "focus", "automate"/,
  );
  // Ordered by where the labels sit in the SCRIPT, not by the marks file's key order.
  assert.throws(
    () => fit(readFixture(), parseMarks({ automate: 1000, focus: 3000 })),
    /the marks run backwards: "automate" comes after "focus"/,
  );
});

test("fit refuses a gap the segment's unstretchable steps already exceed", () => {
  // intro -> focus is a 300ms camera + a 0ms caption + one wait: it cannot be under 300ms.
  assert.throws(
    () => fit(readFixture(), parseMarks({ intro: 0, focus: 200 })),
    /"focus" cannot land at 200ms: the 300ms of unstretchable steps after "intro" already exceed the 200ms gap/,
  );
});

// ---------------------------------------------------------------------------
// The transform itself.
// ---------------------------------------------------------------------------

test("fit lands every marked label on its mark and leaves the tail alone", () => {
  const steps = readFixture();
  const { moves } = fit(steps, parseMarks({ intro: 0, focus: 1200, automate: 2000 }));
  assert.deepEqual(moves, [
    { label: "intro", from: 0, to: 0 },
    { label: "focus", from: 700, to: 1200 },
    { label: "automate", from: 1400, to: 2000 },
  ]);
  assert.deepEqual(labelOffsets(steps), [
    { label: "intro", index: 0, at: 0 },
    { label: "focus", index: 4, at: 1200 },
    { label: "automate", index: 8, at: 2000 },
  ]);
  // Only the two waits inside the marked span moved: 400 -> 900 and 300 -> 400.
  assert.deepEqual(steps.filter((s) => s.op === "wait").map((s) => s.ms), [900, 400, 300]);
  assert.equal(steps.length, 14, "no step was added or removed");
  assert.deepEqual(steps[9], readFixture()[9], "the condense step is untouched, keys and all");
});

test("fit shrinks as readily as it stretches, down to a 0ms wait when the gap IS the floor", () => {
  const steps = readFixture();
  // Both segments compressed: intro->focus (floor 300) squeezed to 400, focus->automate
  // (floor 400) squeezed to exactly its floor — the wait legally holds nothing.
  fit(steps, parseMarks({ intro: 0, focus: 400, automate: 800 }));
  assert.deepEqual(steps.filter((s) => s.op === "wait").map((s) => s.ms), [100, 0, 300]);
  assert.deepEqual(labelOffsets(steps).map((l) => l.at), [0, 400, 800]);
  assert.equal(steps.length, 14, "shrinking never deletes a wait, it just empties it");
});

test("a no-wait segment whose gap equals its floor gets NO insert — and stays idempotent", () => {
  const steps = [
    { label: "a" },
    { op: "camera", args: [{ fit: true, dur: 200 }] },
    { label: "b" },
  ];
  fit(steps, parseMarks({ a: 0, b: 200 }));
  assert.equal(steps.length, 3, "a 0ms wait would be noise; nothing was inserted");
  assert.equal(labelOffsets(steps).find((l) => l.label === "b").at, 200);
  fit(steps, parseMarks({ a: 0, b: 200 }));
  assert.equal(steps.length, 3, "…and the re-fit finds nothing to add either");
});

test("fit is idempotent: re-fitting the result with the same marks changes nothing", () => {
  const marks = parseMarks({ intro: 0, focus: 1200, automate: 2000 });
  const once = fit(readFixture(), marks).steps;
  const twice = fit(JSON.parse(JSON.stringify(once)), marks).steps;
  assert.deepEqual(twice, once);
});

test("fit distributes a segment's budget across its waits proportionally, remainder last", () => {
  const steps = [
    { label: "a" },
    { op: "wait", ms: 100 },
    { op: "wait", ms: 200 },
    { op: "wait", ms: 300 },
    { label: "b" },
  ];
  fit(steps, parseMarks({ a: 0, b: 1000 }));
  // 100:200:300 of a 1000ms budget -> 166 + 333 + the remainder, summing to exactly 1000.
  assert.deepEqual(steps.filter((s) => s.op === "wait").map((s) => s.ms), [166, 333, 501]);
  assert.equal(labelOffsets(steps).find((l) => l.label === "b").at, 1000);
});

test("fit inserts one wait just before the label when a segment has none to stretch", () => {
  const steps = [
    { label: "a" },
    { op: "camera", args: [{ fit: true, dur: 200 }] },
    { label: "b" },
  ];
  fit(steps, parseMarks({ a: 0, b: 900 }));
  assert.deepEqual(steps[2], { op: "wait", ms: 700 }, "inserted immediately before the label");
  assert.equal(steps.length, 4);
  assert.equal(labelOffsets(steps).find((l) => l.label === "b").at, 900);
  // …and the insert is idempotent: the second pass finds the wait and rewrites it in place.
  fit(steps, parseMarks({ a: 0, b: 900 }));
  assert.equal(steps.length, 4);
});

test("the story start is an implicit 0ms anchor, so a first mark before any label still fits", () => {
  const steps = [
    { op: "camera", args: [{ fit: true, dur: 200 }] },
    { label: "only" },
    { op: "wait", ms: 50 },
  ];
  fit(steps, parseMarks({ only: 800 }));
  assert.deepEqual(steps[1], { op: "wait", ms: 600 });
  assert.equal(labelOffsets(steps).find((l) => l.label === "only").at, 800);
  assert.deepEqual(steps[3], { op: "wait", ms: 50 }, "the tail after the last mark rides along");
});

test("unmarked labels ride along on whatever the fit did around them", () => {
  const steps = [
    { label: "a" },
    { op: "wait", ms: 100 },
    { label: "mid" },              // never mentioned in the marks
    { op: "wait", ms: 100 },
    { label: "b" },
  ];
  fit(steps, parseMarks({ a: 0, b: 1000 }));
  const at = Object.fromEntries(labelOffsets(steps).map((l) => [l.label, l.at]));
  assert.equal(at.b, 1000);
  assert.equal(at.mid, 500, "it moved with its share of the stretch, not against it");
});

test("a wait declaring `dur` is repriced on the field that prices it", () => {
  const steps = [{ label: "a" }, { op: "wait", ms: 100, dur: 250 }, { label: "b" }];
  fit(steps, parseMarks({ a: 0, b: 600 }));
  assert.deepEqual(steps[1], { op: "wait", ms: 600, dur: 600 });
  const args = [{ label: "a" }, { op: "wait", args: [100] }, { label: "b" }];
  fit(args, parseMarks({ a: 0, b: 600 }));
  assert.deepEqual(args[1], { op: "wait", args: [600] }, "the builder's arg form too");
});

// ---------------------------------------------------------------------------
// The CLI shell.
// ---------------------------------------------------------------------------

test("smv-fit parseArgs: the documented grammar", () => {
  const a = parseArgs(["sb.json", "--vo", "marks.json", "-o", "out.json"]);
  assert.deepEqual([a.steps, a.vo, a.out, a.base], ["sb.json", "marks.json", "out.json", 350]);
  assert.equal(parseArgs(["sb.json", "--vo", "m.json", "--base", "120"]).base, 120);
  assert.throws(() => parseArgs(["sb.json", "--zoom"]), /unknown flag "--zoom"/);
  assert.throws(() => parseArgs(["a.json", "b.json"]), /expected one storyboard file/);
  assert.throws(() => parseArgs(["sb.json", "--base", "nope"]), /--base needs a non-negative number/);
});

test("smv-fit end to end: writes the fitted script, reports the moves, exits 1 on bad input", () => {
  const dir = mkdtempSync(join(tmpdir(), "smv-fit-"));
  const sb = join(dir, "sb.json"), vo = join(dir, "vo.json"), out = join(dir, "out.json");
  writeFileSync(sb, readFileSync(FIXTURE));
  writeFileSync(vo, JSON.stringify({ intro: 0, focus: 1200, automate: 2000 }));

  const bin = join(root, "bin", "smv-fit.mjs");
  const err = execFileSync("node", [bin, sb, "--vo", vo, "-o", out], { stdio: "pipe" });
  assert.equal(err.toString(), "", "the fitted script goes to the file, not to stdout");
  const fitted = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(labelOffsets(fitted).map((l) => l.at), [0, 1200, 2000]);

  // No -o: the script goes to stdout, the report to stderr — pipeable.
  const piped = execFileSync("node", [bin, sb, "--vo", vo], { stdio: "pipe" }).toString();
  assert.deepEqual(labelOffsets(JSON.parse(piped)).map((l) => l.at), [0, 1200, 2000]);

  writeFileSync(vo, JSON.stringify({ intro: 0, focus: 200 }));
  assert.throws(() => execFileSync("node", [bin, sb, "--vo", vo], { stdio: "pipe" }), (e) => {
    assert.equal(e.status, 1);
    assert.match(e.stderr.toString(), /smv-fit: "focus" cannot land at 200ms/);
    return true;
  });
  assert.throws(() => execFileSync("node", [bin, sb], { stdio: "pipe" }), (e) => {
    assert.equal(e.status, 1);
    assert.match(e.stderr.toString(), /--vo marks\.json is required/);
    return true;
  });
});

test("smv-fit refuses a run.play story rather than mispricing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "smv-fit-"));
  const sb = join(dir, "sb.json"), vo = join(dir, "vo.json");
  writeFileSync(sb, JSON.stringify([{ label: "a" }, { op: "run.play" }, { label: "b" }]));
  writeFileSync(vo, JSON.stringify({ a: 0, b: 1000 }));
  assert.throws(() => execFileSync("node", [join(root, "bin", "smv-fit.mjs"), sb, "--vo", vo], { stdio: "pipe" }), (e) => {
    assert.equal(e.status, 1);
    assert.match(e.stderr.toString(), /step 1 is a run\.play/);
    // The refusal may only offer remedies the tool actually accepts: an explicit `dur` is
    // not one (stepSlices() prices run.play off runCtl and never reads it), so it must not
    // be advertised as a way out.
    assert.doesNotMatch(e.stderr.toString(), /explicit `dur`/);
    return true;
  });
  // …including on a step that already carries one — the advice, not the guard, was wrong.
  writeFileSync(sb, JSON.stringify([{ label: "a" }, { op: "run.play", dur: 2000 }, { label: "b" }]));
  assert.throws(() => execFileSync("node", [join(root, "bin", "smv-fit.mjs"), sb, "--vo", vo], { stdio: "pipe" }), (e) => {
    assert.equal(e.status, 1);
    assert.match(e.stderr.toString(), /step 1 is a run\.play/);
    return true;
  });
  // A library caller gets the same refusal rather than a run priced at `base`.
  assert.throws(
    () => fit([{ label: "a" }, { op: "run.play", dur: 2000 }, { label: "b" }], [{ label: "b", ms: 1000 }]),
    /step 1 is a run\.play/,
  );
});
