// M4b exit criterion: the frame renderer is deterministic.
//   node test/e2e-m4.mjs
// Renders test/fixtures/record-demo.sb.json twice through bin/smv-record.mjs — real
// chromium, real PNGs — and asserts the two takes are byte-identical frame for frame.
// That is the whole point of the manual ticker (D15): no wall clock in the loop, so the
// declared timeline (D12) alone decides what every frame contains. Also gates the frame
// count against the declared timeline, that the take ends on a settled picture, that a
// Mode A run.play story is measured off the compiled run, and the refusals the CLI owes
// its user (a live-run storyboard, and --out with no encoder).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRun } from "../src/run.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REC = join(ROOT, "bin", "smv-record.mjs");
const SPEC = join(ROOT, "test", "fixtures", "record-demo.spec.json");
const SB = join(ROOT, "test", "fixtures", "record-demo.sb.json");

// Small and slow on purpose: 10fps at 480x270 is ~33 frames of real browser work, enough
// to cross every step boundary in the fixture (camera, highlight, caption, condense)
// without spending a minute of CI on pixels nobody looks at.
const FPS = 10, WIDTH = 480, HEIGHT = 270, TAIL = 200;
const DECLARED_MS = 2900; // the fixture's declared timeline; asserted below, not assumed

const fail = [];
const pass = [];
const check = (ok, label, detail = "") => (ok ? pass : fail).push(label + (detail ? " — " + detail : ""));

const work = mkdtempSync(join(tmpdir(), "e2e-m4-"));
const frames = (dir) => readdirSync(dir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();

/** The CLI reports progress on stderr (smv-pack's idiom), so spawn rather than exec. */
function record(dir, extra = []) {
  const r = spawnSync("node", [
    REC, SPEC, "--storyboard", SB, "--png-dir", join(work, dir),
    "--fps", String(FPS), "--width", String(WIDTH), "--height", String(HEIGHT),
    "--scale", "1", "--theme", "dark", "--tail", String(TAIL), ...extra,
  ], { cwd: ROOT, encoding: "utf8" });
  check(r.status === 0, `recording "${dir}" exits 0`, String(r.stderr).trim().split("\n").slice(-1)[0]);
  return String(r.stderr);
}

const logA = record("a");
record("b");

const a = frames(join(work, "a"));
const b = frames(join(work, "b"));

// 1 — the declared timeline decides the frame count (D12), nothing wall-clock does. It is
// a FLOOR, not the cut: every async phase boundary resolves on the first tick at or past
// its duration, so a story of N boundaries may run up to N frames long, and the tail is
// spent after that — never on the overrun (which used to eat the settled final state).
const frameMs = 1000 / FPS;
const floor = Math.ceil(DECLARED_MS / frameMs) + Math.ceil(TAIL / frameMs);
check(a.length >= floor, `frame count is at least ceil(${DECLARED_MS}/${frameMs}) + ceil(${TAIL}/${frameMs}) = ${floor}`, `got ${a.length}`);
check(a.length <= floor + 14, "…and no more than one extra frame per step boundary", `got ${a.length}`);
check(a.length === b.length, "both takes wrote the same number of frames", `${a.length} vs ${b.length}`);
check(a[0] === "frame-00000.png", "frames are zero-padded from 0", a[0]);

// 2 — every frame is a real, non-empty PNG.
const bytes = a.map((f) => readFileSync(join(work, "a", f)));
check(bytes.every((buf) => buf.length > 0), "no zero-byte frames");
check(bytes.every((buf) => buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))),
  "every frame carries the PNG magic");
// A frame that never changes means the story never played — the condense/camera beats must
// actually move pixels between the first and last shot.
check(a.length > 2 && !bytes[0].equals(bytes[bytes.length - 1]), "the last frame differs from the first (the story ran)");
// The tail is held frames on a FINISHED story: the last two must be identical, which they
// are not if the take cut while the condense choreography still had a state flip to make.
check(bytes[bytes.length - 1].equals(bytes[bytes.length - 2]), "the tail holds a settled picture (last two frames identical)");

// 3 — the determinism gate itself.
const diffs = a.filter((f, i) => {
  const other = b[i];
  if (!other) return true;
  return !readFileSync(join(work, "a", f)).equals(readFileSync(join(work, "b", other)));
});
check(diffs.length === 0, `all ${a.length} frames byte-identical across two takes`, diffs.slice(0, 5).join(", "));

// 4 — the summary line reports the story the fixture declares (step count + cue sheet).
check(/14 steps, 2900ms \+ 200ms tail/.test(logA), "summary reports 14 steps and the declared 2900ms", logA.split("\n")[0]);
check(/5 cues/.test(logA), "cue sheet has 5 entries (3 labels + 2 captions)", logA.split("\n")[0]);

// 5 — a Mode A (`simulate`) run.play take is sized from the COMPILED run, not from one
// mutation's baseDuration. The run transport only exists once a run.* op has created it,
// and the record pack does not autoplay — so measuring before play() priced a ~5s story at
// 350ms and cut the take off inside step 1, at exit 0, with no warning.
const RUN_FPS = 2, RUN_TAIL = 0;
const runSb = join(work, "run.json");
writeFileSync(runSb, JSON.stringify([{ label: "go" }, { op: "run.play" }, { op: "caption", args: ["tokens"] }, { op: "wait", ms: 200 }]));
const runDir = join(work, "run"), runMp4 = join(work, "story.mp4");
const runRes = spawnSync("node", [
  REC, SPEC, "--storyboard", runSb, "--png-dir", runDir, "--out", runMp4,
  "--fps", String(RUN_FPS), "--width", "320", "--height", "180", "--scale", "1", "--tail", String(RUN_TAIL),
], { cwd: ROOT, encoding: "utf8" });
const lastLine = (t) => String(t).trim().split("\n").slice(-1)[0];
check(runRes.status === 0, "a run.play take exits 0", lastLine(runRes.stderr));
// …and --png-dir alongside --out records instead of refusing the flag combination it was
// just handed ("render the frames with --png-dir" to someone who passed --png-dir).
check(/frames are written[\s\S]*ffmpeg -framerate/.test(runRes.stderr) && runRes.stderr.includes(join(runDir, "frame-%05d.png")),
  "--out alongside --png-dir warns after the take and names the real frame dir", lastLine(runRes.stderr));

const runTotal = compileRun(JSON.parse(readFileSync(SPEC, "utf8")), {}).duration + 200;
const summary = /(\d+) steps, ([\d.]+)ms \+ (\d+)ms tail/.exec(runRes.stderr);
check(!!summary && Math.abs(Number(summary[2]) - runTotal) < 1,
  `the run.play story is measured at the compiled run's ${runTotal.toFixed(2)}ms`, summary ? summary[2] : "no summary line");
const runFrames = frames(runDir);
check(runFrames.length >= Math.ceil(runTotal / (1000 / RUN_FPS)),
  `the take covers the whole run (>= ${Math.ceil(runTotal / (1000 / RUN_FPS))} frames)`, `got ${runFrames.length}`);

// 6 — the refusals.
const expectExit1 = (args, re, label) => {
  try {
    execFileSync("node", [REC, ...args], { cwd: ROOT, stdio: "pipe" });
    check(false, label, "exited 0");
  } catch (err) {
    check(err.status === 1 && re.test(String(err.stderr)), label, `status ${err.status}: ${String(err.stderr).slice(0, 200)}`);
  }
};
const liveSb = join(work, "live.json");
writeFileSync(liveSb, JSON.stringify([{ op: "run.play", args: [{ mode: "live" }] }]));
expectExit1([SPEC, "--storyboard", liveSb, "--png-dir", join(work, "never")],
  /live run[\s\S]*not reproducible/, "a live-run storyboard is refused (Mode B is wall-clock)");
expectExit1([SPEC, "--storyboard", SB, "--out", join(work, "story.mp4")],
  /(ffmpeg not found on PATH|not wired up yet)[\s\S]*--png-dir/, "--out fails with an actionable ffmpeg message");

rmSync(work, { recursive: true, force: true });

console.log(`frames: ${a.length} per take, ${bytes.reduce((n, buf) => n + buf.length, 0)} bytes total`);
for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(fail.length === 0 ? "\ne2e-m4: PASS" : `\ne2e-m4: FAIL (${fail.length})`);
process.exit(fail.length === 0 ? 0 : 1);
