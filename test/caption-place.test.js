// A top-placed caption must not inherit the transport-bar lift: with controls on,
// `.smv-root.smv-has-transport .smv-caption{bottom:46px}` outranked
// `.smv-caption[data-place="top"]{bottom:auto}` and stretched the pill into a
// near-full-height box (found while building demo/seq-checkout.html).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/styles.js";

test("top-placed caption keeps bottom:auto even when the transport bar is mounted", () => {
  const rule = CSS.match(/\.smv-root\.smv-has-transport \.smv-caption\[data-place="top"\]\{([^}]*)\}/);
  assert.ok(rule, "expected a transport-aware rule for data-place=\"top\" captions");
  assert.match(rule[1], /bottom:\s*auto/);
  // and it must come AFTER the generic transport lift so equal specificity resolves in its favour
  const lift = CSS.indexOf('.smv-root.smv-has-transport .smv-caption{bottom:46px}');
  assert.ok(lift >= 0 && CSS.indexOf(rule[0]) > lift);
});
