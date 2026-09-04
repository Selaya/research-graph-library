#!/usr/bin/env node
// Fails the build if a docs page pins a CDN copy of this package to a version other than
// the one in package.json (docs/EMBED.md once pinned @1, which resolves to nothing
// published — README and package.json were already at 0.1.0). Scans README.md and every
// docs/*.md for `sparkle-motion-visualizer@<version>` and compares each hit against
// package.json's own version.

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const PIN_RE = /sparkle-motion-visualizer@([\w.\-]+)/g;

/** Pure: every `sparkle-motion-visualizer@<pinned>` in `text` whose version disagrees with
 *  `wantVersion`, as `{line, pinned, text}` (1-indexed line, trimmed source line). */
export function findVersionPinMismatches(text, wantVersion) {
  const mismatches = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(PIN_RE)) {
      const pinned = m[1];
      if (pinned !== wantVersion) mismatches.push({ line: i + 1, pinned, text: line.trim() });
    }
  });
  return mismatches;
}

function main() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const wantVersion = pkg.version;
  const targets = ["README.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];

  let failed = false;
  for (const relPath of targets) {
    let text;
    try {
      text = readFileSync(join(root, relPath), "utf8");
    } catch (err) {
      console.error(`check-doc-versions: could not read ${relPath}: ${err.message}`);
      process.exit(1);
    }
    for (const m of findVersionPinMismatches(text, wantVersion)) {
      failed = true;
      console.error(
        `check-doc-versions: ${relPath}:${m.line}: pins sparkle-motion-visualizer@${m.pinned}, ` +
        `but package.json is at ${wantVersion}\n    ${m.text}`
      );
    }
  }

  if (failed) {
    console.error("check-doc-versions: fix the pin(s) above, or bump package.json's version.");
    process.exit(1);
  }
  console.log(`check-doc-versions: all CDN pins agree with package.json (${wantVersion}).`);
}

// Only run when invoked directly (so findVersionPinMismatches is importable from tests) —
// see bin/smv-pack.mjs for why this compares resolved file URLs rather than a hand-built
// `file://` + argv[1].
if (import.meta.url === entryURL()) main();

function entryURL() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return null;
  }
}
