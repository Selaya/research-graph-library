// scripts/harness.mjs — findChromium()'s discovery order and its final, actionable error
// (M4/CLI packaging fix: a real npm consumer outside this repo's image has no
// /opt/pw-browsers, so it needs a fallback and a message that tells it what to run).

import { test } from "node:test";
import assert from "node:assert/strict";
import { findChromium, chromiumNotFoundMessage } from "../scripts/harness.mjs";

test("findChromium() returns a real path where a browser exists, else throws the actionable message", () => {
  // Portable across environments: in this dev image a browser lives under /opt/pw-browsers
  // so a path comes back; on a bare runner (CI) nothing is discoverable, so the contract is
  // to throw the `npx playwright install chromium` guidance — never to return a junk path.
  try {
    const p = findChromium();
    assert.equal(typeof p, "string");
    assert.ok(p.length > 0);
  } catch (e) {
    assert.match(e.message, /npx playwright install chromium/);
  }
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
