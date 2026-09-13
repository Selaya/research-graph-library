// F36 — the "story finished" handshake scripts/check-demos.mjs runs inside the page.
// The checker itself needs headless chromium, so the two snippets it evaluates live in
// scripts/finish-signal.mjs and are exercised here against a stub window: a regression in
// the branch that waits for `g.finished` would otherwise be invisible to CI, since all 27
// demo pages still take the older `__smvExit` path.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAL_JS, LATCH_JS, LATCH_DONE_JS, EXIT_DONE_JS, waitedLabel,
} from "../scripts/finish-signal.mjs";

/** Evaluate one of the page snippets with `window` bound to a stub, the way page.evaluate does. */
const evalIn = (win, js) => new Function("window", `return (${js});`)(win);
const evalStmt = (win, js) => new Function("window", js)(win);

test("SIGNAL_JS: a page offering neither hook keeps the poll going", () => {
  assert.equal(evalIn({}, SIGNAL_JS), false);
  assert.equal(evalIn({ smv: {} }, SIGNAL_JS), false, "an instance with no .finished is not a signal");
  assert.equal(evalIn({ smv: { finished: 1 } }, SIGNAL_JS), false, "…nor a non-thenable one");
});

test("SIGNAL_JS: g.finished is picked up from window.smv and from window.__smv", () => {
  assert.equal(evalIn({ smv: { finished: Promise.resolve() } }, SIGNAL_JS), "finished");
  assert.equal(evalIn({ __smv: { finished: Promise.resolve() } }, SIGNAL_JS), "finished");
});

test("SIGNAL_JS: __smvExit wins when a page offers both (it carries the page's errors)", () => {
  const win = { __smvExit: { done: false, errors: [] }, smv: { finished: Promise.resolve() } };
  assert.equal(evalIn(win, SIGNAL_JS), "__smvExit");
});

test("LATCH_JS latches g.finished onto the flag the poll reads", async () => {
  let resolve;
  const win = { smv: { finished: new Promise((r) => { resolve = r; }) } };
  evalStmt(win, LATCH_JS);
  assert.equal(win.__smvFinished, false);
  assert.equal(evalIn(win, LATCH_DONE_JS), false, "…and the poll says 'not yet'");
  resolve({ reason: "storyboard" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(evalIn(win, LATCH_DONE_JS), true, "the poll sees it once the story ends");
});

test("EXIT_DONE_JS is the older hook's own done flag, and tolerates a missing hook", () => {
  assert.equal(!!evalIn({}, EXIT_DONE_JS), false);
  assert.equal(evalIn({ __smvExit: { done: false } }, EXIT_DONE_JS), false);
  assert.equal(evalIn({ __smvExit: { done: true } }, EXIT_DONE_JS), true);
});

test("waitedLabel names the signal each page was actually waited on", () => {
  assert.equal(waitedLabel("finished", 4000), "(waited for smv.finished)");
  assert.equal(waitedLabel("__smvExit", 4000), "(waited for __smvExit.done)");
  assert.equal(waitedLabel(null, 4000), "(waited 4000ms)");
});
