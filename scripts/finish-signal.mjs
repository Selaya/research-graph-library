// The "story finished" handshake scripts/check-demos.mjs runs inside the page, kept here as
// plain strings + one pure helper so it is testable without a browser (test/finish-signal.test.js).
//
// Two signals, in priority order:
//   1. `window.__smvExit = {done, errors}` — the older page-rolled hook. Preferred when a
//      page offers both: it also carries the page's own error list.
//   2. `window.smv` (or `window.__smv`) = the mounted instance, whose `g.finished` promise
//      resolves when the story ends — the library's own convention (F36).

/** Which finish signal the page offers: "__smvExit", "finished", or false (poll again). */
export const SIGNAL_JS = `(() => {
  if (window.__smvExit && typeof window.__smvExit === "object") return "__smvExit";
  const g = window.smv || window.__smv;
  return g && g.finished && typeof g.finished.then === "function" ? "finished" : false;
})()`;

/** Latch g.finished onto a plain flag, so a polling wait (and --timeout) owns the wait
 *  instead of hanging inside evaluate(). */
export const LATCH_JS = `(() => {
  window.__smvFinished = false;
  (window.smv || window.__smv).finished.then(() => { window.__smvFinished = true; });
})()`;

/** The flag LATCH_JS writes, as the poll reads it. */
export const LATCH_DONE_JS = "window.__smvFinished === true";
/** The condition the older hook is done, as the poll reads it. */
export const EXIT_DONE_JS = "window.__smvExit && window.__smvExit.done === true";

/** What the PASS/FAIL line says it waited on. */
export const waitedLabel = (hook, waitMs) =>
  hook === "finished" ? "(waited for smv.finished)"
    : hook === "__smvExit" ? "(waited for __smvExit.done)" : `(waited ${waitMs}ms)`;
