#!/usr/bin/env node
// smv-pack — bundle a graph spec + the prebuilt IIFE into one self-contained HTML file
// (D11: the single-file export is a docs recipe + this tiny CLI, not a runtime feature).
// No deps, no shelling out: if dist/smv.iife.min.js is missing we just tell the user to
// build it (`npm run build`) rather than trying to build it ourselves.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function usage() {
  return (
    "Usage: smv-pack <spec.json> [-o out.html] [--storyboard sb.json] [--title T] [--preset pipeline]\n" +
    "                   [--theme dark|light] [--record]\n" +
    "\n" +
    "  Packs a graph spec (and optional storyboard) with the prebuilt smv.iife.min.js\n" +
    "  into one self-contained HTML file — open it directly, no server, no build step.\n" +
    "  Run `npm run build` first if dist/smv.iife.min.js does not exist yet.\n" +
    "\n" +
    "  --record emits the frame-renderer variant (D15): manual ticker, forced full motion,\n" +
    "  no transport chrome, the story NOT autoplayed, and the instance on window.__smv.\n" +
    "  That is the page bin/smv-record.mjs drives; on its own it just sits at step 0.\n"
  );
}

function parseArgs(argv) {
  const out = { spec: null, out: null, storyboard: null, title: null, preset: null, theme: null, record: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") out.out = argv[++i];
    else if (a === "--storyboard") out.storyboard = argv[++i];
    else if (a === "--title") out.title = argv[++i];
    else if (a === "--preset") out.preset = argv[++i];
    else if (a === "--theme") out.theme = argv[++i];
    else if (a === "--record") out.record = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else positional.push(a);
  }
  out.spec = positional[0] || null;
  return out;
}

function readJSON(path, what) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`could not read ${what} "${path}": ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${what} "${path}" is not valid JSON: ${err.message}`);
  }
}

function escapeForScript(str) {
  // A JSON blob embedded inside <script> must not contain a literal "</script>" (or,
  // defensively, "<!--") — both would truncate/confuse the surrounding HTML parser.
  return str.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function htmlEscape(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function buildHTML({ spec, storyboard, title, preset, iife, theme = null, record = false }) {
  // D15 — the record variant hands the clock to the renderer CLI: a manual ticker stepped
  // frame by frame, motion forced full whatever the machine's accessibility settings say,
  // no transport chrome in the shot, and the story parked at step 0 until smv-record has
  // fonts and the viewport interlock in place. `window.__smv` is the CLI's only handle.
  const mountOpts = record
    ? { controls: false, captions: true, autoplay: false, ticker: "manual", motion: "full" }
    : { controls: true };
  if (preset) mountOpts.preset = preset;
  if (theme) mountOpts.theme = theme;
  if (storyboard) {
    mountOpts.storyboard = storyboard;
    if (!record) mountOpts.autoplay = true;
  }
  const specJSON = escapeForScript(JSON.stringify(spec));
  const optsJSON = escapeForScript(JSON.stringify(mountOpts));
  const docTitle = htmlEscape(title || "sparkle-motion-vizualizer");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${docTitle}</title>
<style>html,body{margin:0;height:100%}#smv-pack-root{width:100%;height:100vh}</style>
</head>
<body>
<div id="smv-pack-root"></div>
<script>
/* smv-pack: inlined dist/smv.iife.min.js — https://github.com/ (sparkle-motion-vizualizer) */
${iife}
</script>
<script>
(function () {
  var spec = ${specJSON};
  var opts = ${optsJSON};
  ${record ? "window.__smv = " : ""}SparkleMotion.mount(document.getElementById("smv-pack-root"), spec, opts);
})();
</script>
</body>
</html>
`;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.spec) {
    process.stderr.write(usage());
    process.exit(args.help ? 0 : 1);
  }

  const iifePath = join(root, "dist", "smv.iife.min.js");
  if (!existsSync(iifePath)) {
    process.stderr.write("smv-pack: dist/smv.iife.min.js not found — run npm run build first\n");
    process.exit(1);
  }
  const iife = readFileSync(iifePath, "utf8");

  let spec, storyboard;
  try {
    spec = readJSON(args.spec, "spec");
    storyboard = args.storyboard ? readJSON(args.storyboard, "storyboard") : null;
  } catch (err) {
    process.stderr.write(`smv-pack: ${err.message}\n`);
    process.exit(1);
  }

  const html = buildHTML({
    spec,
    storyboard,
    title: args.title,
    preset: args.preset,
    theme: args.theme,
    record: args.record,
    iife,
  });

  const outPath = args.out || basename(args.spec).replace(/\.json$/i, "") + ".smv.html";
  writeFileSync(outPath, html, "utf8");
  process.stderr.write(`smv-pack: wrote ${outPath}\n`);
}

// Only run when invoked directly (so buildHTML is importable from tests). Resolved file
// URLs on both sides: argv[1] is the npm .bin symlink, not the realpath, and a space in the
// path is percent-encoded in import.meta.url only — either would silently skip main().
if (import.meta.url === entryURL()) {
  main(process.argv.slice(2));
}

function entryURL() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return null;
  }
}
