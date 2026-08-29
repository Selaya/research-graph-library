// What the published tarball is allowed to contain (D11: the public dist surface is
// smv.esm.js + smv.iife.min.js, nothing else).
//
// Regression: scripts/build.js emits a third bundle for the core-size metric, built with
// `external: ['./engine.js']` so the layout engine can be subtracted from the gzip figure.
// Its own comment called it "never shipped", but package.json packs the whole of `dist`
// with no exclusions — so ~106KB of dead code went out in every publish, and it is a
// broken module the moment anything loads it (the externalized `./engine.js` is never
// emitted next to it). It now lives in build/, outside `files`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

test("package `files` names no directory that would carry the metric bundle", () => {
  assert.ok(pkg.files.includes("dist"), "dist is still published");
  assert.ok(!pkg.files.includes("build"), "the metric bundle's directory is never published");
});

test("scripts write the metric bundle outside the published dist", () => {
  const build = readFileSync(path.join(root, "scripts", "build.js"), "utf8");
  const budget = readFileSync(path.join(root, "scripts", "size-budget.js"), "utf8");
  assert.match(build, /metricdir/, "build.js has a separate destination for the metric bundle");
  assert.doesNotMatch(
    build,
    /outfile:\s*join\(outdir,\s*'smv\.core\.esm\.js'\)/,
    "the metric bundle is not written into dist"
  );
  assert.match(build, /rmSync\(join\(outdir, 'smv\.core\.esm\.js'\)/, "a stale copy in dist is cleaned up");
  assert.match(budget, /join\(metric, 'smv\.core\.esm\.js'\)/, "the size gate reads it from there");
});

test("if a build has run, dist holds only the two shipped bundles", () => {
  const dist = path.join(root, "dist");
  if (!existsSync(path.join(dist, "smv.esm.js"))) return; // no build in this checkout
  assert.ok(
    !existsSync(path.join(dist, "smv.core.esm.js")),
    "dist/smv.core.esm.js is unloadable (its ./engine.js import is never emitted) and must not be published"
  );
});
