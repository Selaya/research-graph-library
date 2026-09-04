// scripts/check-doc-versions.mjs — the CDN version-pin checker (npm run check chain). Pure
// regex/compare logic, tested directly on synthetic doc text rather than the real repo's
// docs (whose pins are other agents' files to fix, not fixtures for this test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findVersionPinMismatches } from "../scripts/check-doc-versions.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("no mismatches when every pin agrees with package.json's version", () => {
  const text = [
    '<script src="https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@0.1.0/dist/smv.iife.min.js"></script>',
    'import { exportSVG } from "https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@0.1.0/src/export.js";',
  ].join("\n");
  assert.deepEqual(findVersionPinMismatches(text, "0.1.0"), []);
});

test("flags a stale pin with its 1-indexed line and the pinned version", () => {
  const text = [
    "# heading",
    "",
    '<script src="https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@1/dist/smv.iife.min.js"></script>',
  ].join("\n");
  const mismatches = findVersionPinMismatches(text, "0.1.0");
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].line, 3);
  assert.equal(mismatches[0].pinned, "1");
});

test("flags every stale pin on its own line, even several in one file", () => {
  const text = [
    'a: sparkle-motion-visualizer@1',
    'b: sparkle-motion-visualizer@0.1.0',
    'c: sparkle-motion-visualizer@2.0.0',
  ].join("\n");
  const mismatches = findVersionPinMismatches(text, "0.1.0");
  assert.deepEqual(mismatches.map((m) => m.line), [1, 3]);
  assert.deepEqual(mismatches.map((m) => m.pinned), ["1", "2.0.0"]);
});

test("a bare, unversioned reference (no @) is not a pin and is ignored", () => {
  const text = 'import { mount } from "sparkle-motion-visualizer";';
  assert.deepEqual(findVersionPinMismatches(text, "0.1.0"), []);
});

test("regression: README.md and docs/EMBED.md — this workstream's own files — agree with package.json", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const relPath of ["README.md", "docs/EMBED.md"]) {
    const text = readFileSync(join(root, relPath), "utf8");
    assert.deepEqual(
      findVersionPinMismatches(text, pkg.version),
      [],
      `${relPath} has a pin that disagrees with package.json@${pkg.version}`
    );
  }
});
