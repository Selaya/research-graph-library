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
import { parseArgs, findLiveRun, labelsOf, resolveRange, sniffFontFormat } from "../bin/smv-record.mjs";

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
  assert.deepEqual([a.out, a.cues, a.from, a.to, a.font], [null, null, null, null, null]);
});

test("smv-record parseArgs: the M4c flags", () => {
  const a = parseArgs([
    "spec.json", "--storyboard", "sb.json", "--out", "story.mp4",
    "--cues", "cues.srt", "--from", "focus", "--to", "automate", "--font", "Pinned.woff2",
  ]);
  assert.deepEqual(
    [a.out, a.cues, a.from, a.to, a.font],
    ["story.mp4", "cues.srt", "focus", "automate", "Pinned.woff2"]
  );
  assert.equal(a.pngDir, null); // --out alone is a complete output now
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

test("smv-record: an output is required — --out, --png-dir, or both", () => {
  expectExit1(
    [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard", join(root, "test", "fixtures", "record-demo.sb.json")],
    /nowhere to put the frames[\s\S]*--out story\.mp4 and\/or --png-dir/
  );
});

// --- refusals -----------------------------------------------------------------------

test("smv-record: --out without an encoder names what is missing and the way through", () => {
  // The one path a user cannot fix by reading the flag list: no ffmpeg on the machine. It
  // has to say so BEFORE the browser launch (a take is minutes) and hand over the PNG
  // route plus the exact command, or --out is a dead end on that machine.
  // $SMV_FFMPEG points the probe at a binary that does not exist, so this asserts the
  // no-ffmpeg behaviour on a machine that does have one.
  const args = [join(root, "bin", "smv-record.mjs"), join(root, "test", "fixtures", "record-demo.spec.json"),
    "--storyboard", join(root, "test", "fixtures", "record-demo.sb.json"), "--out", "story.mp4"];
  const r = spawnSync("node", args, { cwd: root, encoding: "utf8", env: { ...process.env, SMV_FFMPEG: "smv-no-such-ffmpeg" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ffmpeg not found on PATH[\s\S]*--png-dir frames\/[\s\S]*ffmpeg -framerate 60 -i frames\/frame-%05d\.png/);
});

test("smv-record: --cues is refused up front unless the extension names a format", () => {
  const base = [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard",
    join(root, "test", "fixtures", "record-demo.sb.json"), "--png-dir", "frames"];
  expectExit1([...base, "--cues", "cues.vtt"], /--cues "cues\.vtt" needs a known extension[\s\S]*\.json[\s\S]*\.srt[\s\S]*\.txt/);
});

test("smv-record: --font must exist and be a format a browser can load", () => {
  const base = [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard",
    join(root, "test", "fixtures", "record-demo.sb.json"), "--png-dir", "frames"];
  expectExit1([...base, "--font", join(root, "nope.woff2")], /--font ".*nope\.woff2" is not a file/);
  expectExit1([...base, "--font", join(root, "package.json")], /--font ".*package\.json" must be one of: \.woff2, \.woff, \.ttf, \.otf/);
});

test("smv-record: a --font whose CONTENT is not a font is refused, before a browser", () => {
  // The extension check cannot see either everyday accident: an unfetched git-lfs pointer
  // (a text file with the right name) and a WOFF2 renamed .ttf. Both used to run a whole
  // take at exit 0 with the pin silently unapplied — the face fails to decode, chromium
  // says so in a console *warning* nothing collects, and the layout is measured in the
  // machine's default font, which is precisely what --font exists to prevent.
  const dir = mkdtempSync(join(tmpdir(), "smv-record-font-"));
  const base = [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard",
    join(root, "test", "fixtures", "record-demo.sb.json"), "--png-dir", join(dir, "frames")];

  const lfs = join(dir, "pointer.woff2");
  writeFileSync(lfs, "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n");
  expectExit1([...base, "--font", lfs], /does not contain woff2 font data[\s\S]*no font signature at all/);

  // Right signature, wrong wrapper: format("truetype") makes the browser skip the src.
  const renamed = join(dir, "actually.ttf");
  writeFileSync(renamed, Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(64)]));
  expectExit1([...base, "--font", renamed], /does not contain truetype font data[\s\S]*it is woff2/);
});

test("sniffFontFormat: four bytes, and the sfnt flavours are one bucket", () => {
  const dir = mkdtempSync(join(tmpdir(), "smv-record-sniff-"));
  const write = (name, head) => {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([Buffer.isBuffer(head) ? head : Buffer.from(head, "latin1"), Buffer.alloc(32)]));
    return p;
  };
  assert.equal(sniffFontFormat(write("a.woff2", "wOF2")), "woff2");
  assert.equal(sniffFontFormat(write("b.woff", "wOFF")), "woff");
  assert.equal(sniffFontFormat(write("c.otf", "OTTO")), "opentype");
  assert.equal(sniffFontFormat(write("d.ttf", Buffer.from([0, 1, 0, 0]))), "truetype");
  assert.equal(sniffFontFormat(write("e.ttf", "true")), "truetype");
  assert.equal(sniffFontFormat(write("f.ttc", "ttcf")), "truetype");
  assert.equal(sniffFontFormat(write("g.woff2", "vers")), null); // a git-lfs pointer
  assert.equal(sniffFontFormat(join(dir, "missing.woff2")), null);
  // A file too short to hold a signature is not a font either (a truncated download).
  writeFileSync(join(dir, "h.ttf"), "wO");
  assert.equal(sniffFontFormat(join(dir, "h.ttf")), null);
});

test("smv-record: --from/--to are checked against the storyboard's labels, before a browser", () => {
  const base = [join(root, "test", "fixtures", "record-demo.spec.json"), "--storyboard",
    join(root, "test", "fixtures", "record-demo.sb.json"), "--png-dir", "frames"];
  expectExit1([...base, "--from", "nope"], /--from "nope" is not a label in the storyboard — known labels: "intro", "focus", "automate"/);
  expectExit1([...base, "--to", "nope"], /--to "nope" is not a label/);
});

test("labelsOf: the chapter markers are the bare {label} steps, exactly as g.cues() reads them", () => {
  assert.deepEqual(labelsOf([{ label: "a" }, { op: "wait", ms: 1 }, { label: "b" }]), ["a", "b"]);
  // An op step is not a marker even when it carries a label of its own (cues() agrees).
  assert.deepEqual(labelsOf([{ op: "caption", args: ["x"], label: "not-a-marker" }]), []);
  assert.deepEqual(labelsOf(null), []);
});

test("resolveRange: labels → ms off the cue sheet → frame indices, --to inclusive", () => {
  // The cue-sheet shape g.cues() emits (the record-demo fixture's labels).
  const cues = [
    { kind: "label", at: 0, label: "intro", index: 0 },
    { kind: "caption", at: 300, text: "not a label", index: 2 },
    { kind: "label", at: 700, label: "focus", index: 4 },
    { kind: "label", at: 1400, label: "automate", index: 8 },
  ];
  // No range: the whole story, lastFrame null meaning "to the end, tail and all".
  assert.deepEqual(resolveRange(cues, { fps: 10 }),
    { startMs: 0, endMs: null, firstFrame: 0, lastFrame: null });
  // A slice: 700ms..1400ms at 10fps is frames 7..14, --to inclusive of its boundary frame.
  assert.deepEqual(resolveRange(cues, { from: "focus", to: "automate", fps: 10 }),
    { startMs: 700, endMs: 1400, firstFrame: 7, lastFrame: 14 });
  // --from alone leaves the tail on; --to alone starts at frame 0.
  assert.deepEqual(resolveRange(cues, { from: "automate", fps: 10 }),
    { startMs: 1400, endMs: null, firstFrame: 14, lastFrame: null });
  assert.deepEqual(resolveRange(cues, { to: "focus", fps: 10 }),
    { startMs: 0, endMs: 700, firstFrame: 0, lastFrame: 7 });
  // from == to is legal: the single frame that shows the labelled moment.
  assert.deepEqual(resolveRange(cues, { from: "focus", to: "focus", fps: 10 }),
    { startMs: 700, endMs: 700, firstFrame: 7, lastFrame: 7 });
});

test("resolveRange: the epsilon keeps a boundary that IS a frame on that frame", () => {
  // 5250ms at 24fps is exactly frame 126, but 5250/(1000/24) floats to 126.000…01 — a bare
  // ceil() would charge the label an entire extra frame of story.
  const cues = [{ kind: "label", at: 5250, label: "late", index: 0 }];
  assert.equal(resolveRange(cues, { from: "late", fps: 24 }).firstFrame, 126);
});

test("resolveRange: unknown labels and an inverted range are refused, naming the flag", () => {
  const cues = [
    { kind: "label", at: 0, label: "intro", index: 0 },
    { kind: "label", at: 700, label: "focus", index: 4 },
    // A caption whose text collides with a label name must not satisfy the lookup.
    { kind: "caption", at: 900, text: "focus", index: 6 },
  ];
  assert.throws(() => resolveRange(cues, { from: "nope", fps: 10 }), /--from "nope" is not a label/);
  assert.throws(() => resolveRange(cues, { to: "nope", fps: 10 }), /--to "nope" is not a label/);
  assert.throws(() => resolveRange([{ kind: "caption", at: 0, text: "intro" }], { from: "intro", fps: 10 }),
    /--from "intro" is not a label/);
  assert.throws(() => resolveRange(cues, { from: "focus", to: "intro", fps: 10 }),
    /--to "intro" \(0ms\) comes before --from "focus" \(700ms\)/);
  assert.deepEqual(resolveRange(null, { fps: 10 }), { startMs: 0, endMs: null, firstFrame: 0, lastFrame: null });
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

test("smv-pack buildHTML: a pinned font is @font-face + override + a measurement patch", () => {
  const font = { file: "smv-record-font.woff2", format: "woff2", family: "smv-record-font" };
  const html = buildHTML({ spec: SPEC, storyboard: [], record: true, font, iife: "IIFE" });
  assert.match(html, /@font-face\{font-family:"smv-record-font";src:url\("smv-record-font\.woff2"\) format\("woff2"\)/);
  assert.match(html, /#smv-pack-root,#smv-pack-root \*\{font-family:"smv-record-font"!important\}/);
  // Both pipelines, or the point is missed: node boxes are sized by canvas measureText
  // against `500 13px system-ui, …` (src/measure.js), and `system-ui` is a generic family
  // no @font-face can redefine — so what is DRAWN would be pinned while what is MEASURED
  // still came from the recording machine's UI font.
  assert.match(html, /CanvasRenderingContext2D\.prototype, "font"/);
  // …and the mount waits for the face, since it measures during mount.
  assert.match(html, /document\.fonts\.load\('500 13px ' \+ FAM\)\.then\(go, go\)/);

  // No font: not a byte of any of that, and the mount is still the plain synchronous call.
  const plain = buildHTML({ spec: SPEC, storyboard: [], record: true, iife: "IIFE" });
  assert.doesNotMatch(plain, /@font-face|CanvasRenderingContext2D/);
  assert.match(plain, /^ {2}window\.__smv = SparkleMotion\.mount\(document/m);
  // …and a font passed WITHOUT --record is not a pack feature (the face would have nowhere
  // to be served from in a single-file export).
  assert.doesNotMatch(buildHTML({ spec: SPEC, storyboard: [], font, iife: "IIFE" }), /@font-face/);
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
