// package.json `exports`: the well-tested pure functions in bin/cues.mjs and bin/smv-fit.mjs
// were unreachable from an npm install (only the CLIs, not the module code, were published
// under a subpath) — "./cues" and "./fit" fix that. Resolved here via Node's own
// self-referencing package import (the package's own name, same as an external consumer
// would `import "sparkle-motion-visualizer/cues"`), so this is exactly the path a real
// integrator's `import` goes through — not a relative path into bin/.

import { test } from "node:test";
import assert from "node:assert/strict";

test("sparkle-motion-visualizer/cues exports formatCues/toSRT/toChapters", async () => {
  const mod = await import("sparkle-motion-visualizer/cues");
  assert.equal(typeof mod.formatCues, "function");
  assert.equal(typeof mod.toSRT, "function");
  assert.equal(typeof mod.toChapters, "function");
  assert.equal(typeof mod.toJSON, "function");
  // A quick end-to-end sanity check, not just "the export exists".
  const cues = [{ kind: "label", at: 0, label: "intro", index: 0 }];
  assert.match(mod.toChapters(cues, { total: 1000 }), /00:00 intro/);
});

test("sparkle-motion-visualizer/fit exports fit/parseMarks (and does not run any CLI on import)", async () => {
  const mod = await import("sparkle-motion-visualizer/fit");
  assert.equal(typeof mod.fit, "function");
  assert.equal(typeof mod.parseMarks, "function");
  assert.deepEqual(mod.parseMarks({ intro: 0, focus: 1200 }), [
    { label: "intro", ms: 0 },
    { label: "focus", ms: 1200 },
  ]);
});

test("sparkle-motion-visualizer/preset-pipeline has a types condition wired (subpath resolves, module loads)", async () => {
  const mod = await import("sparkle-motion-visualizer/preset-pipeline");
  assert.equal(typeof mod.applyPipelinePreset, "function");
});
