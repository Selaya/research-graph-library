// The recorder CLI's non-browser surface: argument parsing, the Mode B refusal (a live run
// is wall-clock and unreproducible), the ffmpeg/--out message, and smv-pack's --record
// variant — including the guarantee that packing WITHOUT --record still emits exactly the
// bytes it did before M4b (D11: the single-file export is a contract, not a moving target).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHTML } from "../bin/smv-pack.mjs";
import { parseArgs, findLiveRun } from "../bin/smv-record.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ id: "e1", source: "a", target: "b" }] };

function run(args, cwd = root) {
  return execFileSync("node", [join(root, "bin", "smv-record.mjs"), ...args], { cwd, stdio: "pipe" });
}

function expectExit1(args, re) {
  assert.throws(() => run(args), (err) => {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), re);
    return true;
  });
}

// --- args ---------------------------------------------------------------------------

test("smv-record parseArgs: defaults are the documented ones", () => {
  const a = parseArgs(["spec.json", "--storyboard", "sb.json", "--png-dir", "frames"]);
  assert.equal(a.spec, "spec.json");
  assert.equal(a.storyboard, "sb.json");
  assert.equal(a.pngDir, "frames");
  assert.deepEqual([a.fps, a.width, a.height, a.scale, a.tail], [60, 1920, 1080, 2, 1200]);
});

test("smv-record parseArgs: numbers are validated, unknown flags refused", () => {
  assert.throws(() => parseArgs(["s.json", "--fps", "nope"]), /--fps needs a positive number/);
  assert.throws(() => parseArgs(["s.json", "--scale", "0"]), /--scale needs a positive number/);
  assert.throws(() => parseArgs(["s.json", "--tail", "-1"]), /--tail needs a non-negative number/);
  assert.throws(() => parseArgs(["s.json", "--zoom"]), /unknown flag "--zoom"/);
  assert.throws(() => parseArgs(["a.json", "b.json"]), /expected one spec file/);
  // --tail 0 is legal: "cut on the last frame of the last step".
  assert.equal(parseArgs(["s.json", "--tail", "0"]).tail, 0);
});

test("smv-record: no spec prints usage and exits 1", () => {
  expectExit1([], /Usage: smv-record/);
});

test("smv-record: --storyboard is required", () => {
  expectExit1([join(root, "test", "fixtures", "record-demo.spec.json"), "--png-dir", "x"], /--storyboard sb\.json is required/);
});

test("smv-record: --png-dir is required when there is no --out", () => {
  expectExit1(
    [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard", join(root, "test", "fixtures", "record-demo.sb.json")],
    /--png-dir frames\/ is required/
  );
});

// --- refusals -----------------------------------------------------------------------

test("smv-record: --out with no --png-dir reports the missing encoder and points at --png-dir", () => {
  // M4c owns the ffmpeg pipe. Until then the failure has to name what is missing AND the
  // path that does work today, or the flag is just a dead end.
  expectExit1(
    [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard", join(root, "test", "fixtures", "record-demo.sb.json"), "--out", "story.mp4"],
    /(ffmpeg not found on PATH|not wired up yet)[\s\S]*--png-dir frames\/[\s\S]*ffmpeg -framerate/
  );
});

test("findLiveRun: a {mode:'live'} on a run.play step is Mode B — and only there", () => {
  assert.equal(findLiveRun([{ op: "wait", ms: 10 }]), null);
  assert.equal(findLiveRun([{ op: "wait", ms: 10 }, { op: "run.play", args: [{ mode: "live" }] }]), 1);
  assert.equal(findLiveRun([{ op: "batch", steps: [{ op: "run.play", args: [{ mode: "live" }] }] }]), 0);
  // "simulate" (Mode A) is exactly what IS recordable.
  assert.equal(findLiveRun([{ op: "run.play", args: [{ mode: "simulate" }] }]), null);
  // The hand-written shape applyStep also reads.
  assert.equal(findLiveRun([{ op: "run.play", mode: "live" }]), 0);
  // Node/edge `data` is an arbitrary user payload the store preserves verbatim, and
  // `data.mode` is this project's own pipeline idiom (see test/fixtures/record-demo.spec.json).
  // A deep walk read those as Mode B and refused a perfectly recordable story.
  assert.equal(findLiveRun([{ op: "addNode", args: [{ id: "n1", data: { mode: "live" } }] }]), null);
  assert.equal(findLiveRun([{ op: "update", args: ["ingest", { data: { mode: "live" } }] }]), null);
});

test("smv-record: the bin still runs through a symlink and from a path with a space", () => {
  // npm/npx install `bin.smv-record` as exactly this symlink, and a `file://${argv[1]}`
  // guard misses it twice over: import.meta.url is the realpath, and a space is
  // percent-encoded on one side only. Both made the CLI a silent no-op at exit 0.
  const dir = mkdtempSync(join(tmpdir(), "smv record-bin-"));
  const link = join(dir, "smv-record");
  symlinkSync(join(root, "bin", "smv-record.mjs"), link);
  const r = spawnSync("node", [link, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Usage: smv-record/);

  const packLink = join(dir, "smv-pack");
  symlinkSync(join(root, "bin", "smv-pack.mjs"), packLink);
  const p = spawnSync("node", [packLink, "--help"], { encoding: "utf8" });
  assert.equal(p.status, 0);
  assert.match(p.stderr, /Usage: smv-pack/);
});

test("smv-record: refuses a live-run storyboard before launching a browser", () => {
  const dir = mkdtempSync(join(tmpdir(), "smv-record-live-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify(SPEC));
  writeFileSync(join(dir, "sb.json"), JSON.stringify([{ op: "run.play", args: [{ mode: "live" }] }]));
  expectExit1([join(dir, "spec.json"), "--storyboard", join(dir, "sb.json"), "--png-dir", join(dir, "frames")],
    /step 0 drives a live run[\s\S]*not reproducible/);
});

test("smv-record: bad JSON fails with the file that is bad", () => {
  const dir = mkdtempSync(join(tmpdir(), "smv-record-badjson-"));
  writeFileSync(join(dir, "spec.json"), "{not json");
  writeFileSync(join(dir, "sb.json"), "[]");
  expectExit1([join(dir, "spec.json"), "--storyboard", join(dir, "sb.json"), "--png-dir", join(dir, "frames")],
    /spec ".*spec\.json" is not valid JSON/);
});

// --- the packed page ------------------------------------------------------------------

test("smv-pack buildHTML: default output is unchanged by the --record plumbing", () => {
  const html = buildHTML({ spec: SPEC, storyboard: [{ op: "wait", ms: 1 }], title: "T", preset: "pipeline", iife: "IIFE" });
  assert.match(html, /var opts = \{"controls":true,"preset":"pipeline","storyboard":\[\{"op":"wait","ms":1\}\],"autoplay":true\};/);
  assert.match(html, /^ {2}SparkleMotion\.mount\(document/m); // no window.__smv assignment
  assert.doesNotMatch(html, /__smv/);
});

test("smv-pack buildHTML: --record is the D15 mount variant plus window.__smv", () => {
  const html = buildHTML({ spec: SPEC, storyboard: [{ op: "wait", ms: 1 }], theme: "dark", record: true, iife: "IIFE" });
  const opts = JSON.parse(/var opts = (\{.*\});/.exec(html)[1]);
  assert.equal(opts.ticker, "manual");   // D1/D15: the renderer owns the clock
  assert.equal(opts.motion, "full");     // the recording's audience is not this machine
  assert.equal(opts.controls, false);    // no transport bar in the shot
  assert.equal(opts.captions, true);
  assert.equal(opts.autoplay, false);    // smv-record starts the story after fonts.ready
  assert.equal(opts.theme, "dark");
  assert.deepEqual(opts.storyboard, [{ op: "wait", ms: 1 }]);
  assert.match(html, /window\.__smv = SparkleMotion\.mount\(/);
});

test("smv-pack CLI: --record packs the record variant", () => {
  const dir = mkdtempSync(join(tmpdir(), "smv-pack-record-"));
  const specPath = join(dir, "spec.json");
  const sbPath = join(dir, "sb.json");
  writeFileSync(specPath, JSON.stringify(SPEC));
  writeFileSync(sbPath, JSON.stringify([{ op: "caption", args: ["hi"] }]));
  const outPath = join(dir, "out.html");
  try {
    execFileSync("node", [join(root, "bin", "smv-pack.mjs"), specPath, "-o", outPath, "--storyboard", sbPath, "--record"], { cwd: root, stdio: "pipe" });
  } catch (err) {
    // No dist/ in this checkout yet — the CLI's own "run npm run build" path, covered in
    // export.test.js; nothing to assert about the record variant here.
    assert.match(err.stderr.toString(), /run npm run build first/);
    return;
  }
  const html = readFileSync(outPath, "utf8");
  assert.match(html, /"ticker":"manual"/);
  assert.match(html, /window\.__smv = SparkleMotion\.mount/);
});
