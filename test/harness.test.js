// scripts/harness.mjs — findChromium()'s discovery order and its final, actionable error
// (M4/CLI packaging fix: a real npm consumer outside this repo's image has no
// /opt/pw-browsers, so it needs a fallback and a message that tells it what to run).

import { test } from "node:test";
import assert from "node:assert/strict";
import { findChromium, chromiumNotFoundMessage } from "../scripts/harness.mjs";

test("findChromium() resolves a real path in this dev image (the fast /opt path)", () => {
  const p = findChromium();
  assert.equal(typeof p, "string");
  assert.ok(p.length > 0);
});

test("chromiumNotFoundMessage() names every path tried and the fix", () => {
  const msg = chromiumNotFoundMessage(["/opt/pw-browsers/chromium", "/opt/pw-browsers"]);
  assert.match(msg, /\/opt\/pw-browsers\/chromium/);
  assert.match(msg, /\/opt\/pw-browsers/);
  assert.match(msg, /npx playwright install chromium/);
  assert.match(msg, /playwright-core/);
});

test("chromiumNotFoundMessage() reflects whatever list of tried paths it is given", () => {
  const msg = chromiumNotFoundMessage(["/a", "/b", "/c"]);
  assert.match(msg, /\/a, \/b, \/c/);
});
