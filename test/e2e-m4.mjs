// M4b/M4c exit criterion: the frame renderer is deterministic, and what it publishes
// matches what it rendered.
//   node test/e2e-m4.mjs
// Renders test/fixtures/record-demo.sb.json twice through bin/smv-record.mjs — real
// chromium, real PNGs — and asserts the two takes are byte-identical frame for frame.
// That is the whole point of the manual ticker (D15): no wall clock in the loop, so the
// declared timeline (D12) alone decides what every frame contains. Also gates the frame
// count against the declared timeline, that the take ends on a settled picture, that a
// Mode A run.play story is measured off the compiled run, the refusals the CLI owes its
// user, and then M4c: a real mp4 off the ffmpeg pipe (probed for codec/pix_fmt, frame
// count and duration), the cue sheet in all three formats (no ffmpeg needed for those), a
// --from/--to slice that is byte-identical to the matching stretch of the full render, and
// a --font take that is still deterministic.
//
// ffmpeg and a pinned font file are environment, not contract: the sections that need them
// SKIP with a notice rather than failing when the machine has neither.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
const skip = [];
const check = (ok, label, detail = "") => (ok ? pass : fail).push(label + (detail ? " — " + detail : ""));

/** ffmpeg is installed in CI but not on every contributor's machine. A section that needs
 *  it announces itself as skipped rather than failing — an absent encoder is not a broken
 *  recorder, and a silent skip is how a gate quietly stops gating.
 *
 *  `has()` only answers "is there a binary of that name". That is the right gate for
 *  ffprobe, and NOT for the pipe: bin/smv-record.mjs hardcodes `-c:v libx264`, and an
 *  ffmpeg built without it (Fedora/RHEL `ffmpeg-free` ships no x264 for patent reasons)
 *  answers `-version` perfectly well and then fails the encode — a red suite for an
 *  environment problem. So gate on the encoder the pipe actually asks for. */
const FFMPEG = process.env.SMV_FFMPEG || "ffmpeg"; // the same binary the CLI resolves
const has = (bin) => !spawnSync(bin, ["-version"], { stdio: "ignore" }).error;
const HAS_FFMPEG_BIN = has(FFMPEG);
const encoders = spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf8" });
// The row is ` V....D libx264  libx264 H.264 …`; the trailing \s keeps libx264rgb out.
const HAS_FFMPEG = !encoders.error && encoders.status === 0 && /^\s*\S+\s+libx264\s/m.test(encoders.stdout || "");
const HAS_FFPROBE = has("ffprobe");
/** Any serif face on the box: the point is that it is visibly NOT the headless default UI
 *  font, so a pinned take can be told apart from an unpinned one. */
const FONT = [
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/liberation/LiberationSerif-Regular.ttf",
].find((p) => existsSync(p));

const work = mkdtempSync(join(tmpdir(), "e2e-m4-"));
const frames = (dir) => readdirSync(dir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();

/** The CLI reports progress on stderr (smv-pack's idiom), so spawn rather than exec.
 *  `dir` may be null for a take that writes no PNG sequence (--out only). Every take runs
 *  at the SAME settings, which is what lets a slice or a pinned-font take be compared
 *  frame-for-frame against the baseline one. */
function record(dir, extra = []) {
  const r = spawnSync("node", [
    REC, SPEC, "--storyboard", SB, ...(dir ? ["--png-dir", join(work, dir)] : []),
    "--fps", String(FPS), "--width", String(WIDTH), "--height", String(HEIGHT),
    "--scale", "1", "--theme", "dark", "--tail", String(TAIL), ...extra,
  ], { cwd: ROOT, encoding: "utf8" });
  check(r.status === 0, `recording "${dir || extra.join(" ")}" exits 0`, String(r.stderr).trim().split("\n").slice(-1)[0]);
  return String(r.stderr);
}

// The cue sheets ride the two determinism takes (writing one does not touch a frame), so
// all three formats are gated even on a machine with no ffmpeg.
const cuesJSON = join(work, "cues.json"), cuesSRT = join(work, "cues.srt");
const logA = record("a", ["--cues", cuesJSON]);
record("b", ["--cues", cuesSRT]);

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

// 3b — the M4d pulse (D17) is inside that gate: the fixture's highlight carries
// `pulse:true`, so the stretch after the camera settles (1.1s) and before the condense
// begins (1.4s) is a `wait` with NOTHING moving but the pulse. Two frames of it that differ
// are the pulse doing per-frame work; that the takes above still matched frame for frame is
// the point — it rides the shared ticker (D1), so it quantizes with everything else and the
// `data-smv-record` CSS kill-switch has nothing to kill.
check(!bytes[12].equals(bytes[13]),
  "the pulse moves pixels during a hold where nothing else does (frames 12/13 = 1.2s/1.3s)");

// 4 — the summary line reports the story the fixture declares (step count + cue sheet).
check(/14 steps, 2900ms \+ 200ms tail/.test(logA), "summary reports 14 steps and the declared 2900ms", logA.split("\n")[0]);
check(/5 cues/.test(logA), "cue sheet has 5 entries (3 labels + 2 captions)", logA.split("\n")[0]);

// 5 — the cue sheets are well-formed in all three formats (the chapters .txt is gated in
// section 9, where the slice writes one). The JSON is the story's own clock — g.cues()
// verbatim plus the render metadata a VO tool rebases with; the SRT annotates the media
// file, so its entries must be sequentially numbered spans with sane timing.
{
  const sheet = JSON.parse(readFileSync(cuesJSON, "utf8"));
  check(sheet.fps === FPS && sheet.width === WIDTH && sheet.height === HEIGHT && sheet.scale === 1
    && sheet.total === DECLARED_MS && sheet.range === null,
    "cues.json records the render metadata (and no range on a full take)",
    JSON.stringify({ fps: sheet.fps, total: sheet.total, range: sheet.range }));
  check(Array.isArray(sheet.cues) && sheet.cues.length === 5 && sheet.cues[0].label === "intro" && sheet.cues[2].at === 700,
    "cues.json carries the 5 cues at their declared offsets", JSON.stringify((sheet.cues || []).map((c) => c.at)));

  const srt = readFileSync(cuesSRT, "utf8");
  const blocks = srt.split("\n\n").map((s) => s.trim()).filter(Boolean);
  check(blocks.length === 2, "cues.srt holds one entry per caption span (2)", `got ${blocks.length}`);
  const TIMING = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
  const parsed = blocks.map((blk) => {
    const [index, timing, ...text] = blk.split("\n");
    const m = TIMING.exec(timing);
    const ms = (h, mi, s, mil) => ((Number(h) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + Number(mil);
    return { index: Number(index), timing, text: text.join("\n"), start: m && ms(...m.slice(1, 5)), end: m && ms(...m.slice(5, 9)) };
  });
  check(parsed.every((p, i) => p.index === i + 1), "SRT indices are sequential from 1", JSON.stringify(parsed.map((p) => p.index)));
  check(parsed.every((p) => TIMING.test(p.timing)), "every SRT timing line is HH:MM:SS,mmm --> HH:MM:SS,mmm",
    parsed.map((p) => p.timing).join(" | "));
  check(parsed.every((p) => p.start != null && p.start < p.end && p.text.length > 0),
    "every SRT span runs forward and carries its caption text");
  // The last span runs to the end of the MEDIA, not of the story: the caption that is up
  // when the story ends is burned into every one of the tail frames too.
  check(parsed[0] && parsed[0].timing === "00:00:00,300 --> 00:00:02,300"
    && parsed[1] && parsed[1].end === DECLARED_MS + TAIL,
    `the spans are the fixture's captions (300ms..2300ms, then held to the end of the media, ${DECLARED_MS + TAIL}ms)`,
    parsed.map((p) => p.timing).join(" | "));
}

// 5b — an end-card caption: the last step of a story sits at `at === total` (captions are
// zero-duration ops), so on the story's clock its span is zero-length and the clip dropped
// it — while the pixels showed it for the whole tail. The .srt annotates the media, so it
// has to be there, running to the end of the media.
{
  const endSb = join(work, "endcard.json");
  writeFileSync(endSb, JSON.stringify([{ op: "wait", ms: 200 }, { op: "caption", args: ["The End"] }]));
  const endSRT = join(work, "endcard.srt");
  const r = spawnSync("node", [
    REC, SPEC, "--storyboard", endSb, "--png-dir", join(work, "endcard"), "--cues", endSRT,
    "--fps", "5", "--width", "320", "--height", "180", "--scale", "1", "--tail", "400",
  ], { cwd: ROOT, encoding: "utf8" });
  check(r.status === 0, "a story ending on a caption records", String(r.stderr).trim().split("\n").slice(-1)[0]);
  check(existsSync(endSRT) && readFileSync(endSRT, "utf8") === "1\n00:00:00,200 --> 00:00:00,600\nThe End\n",
    "the final-step caption is in the .srt, held for the tail (200ms..600ms)",
    JSON.stringify(existsSync(endSRT) ? readFileSync(endSRT, "utf8") : "no file"));
}

// 6 — a Mode A (`simulate`) run.play take is sized from the COMPILED run, not from one
// mutation's baseDuration. The run transport only exists once a run.* op has created it,
// and the record pack does not autoplay — so measuring before play() priced a ~5s story at
// 350ms and cut the take off inside step 1, at exit 0, with no warning.
const RUN_FPS = 2, RUN_TAIL = 0;
const runSb = join(work, "run.json");
writeFileSync(runSb, JSON.stringify([{ label: "go" }, { op: "run.play" }, { op: "caption", args: ["tokens"] }, { op: "wait", ms: 200 }]));
const runDir = join(work, "run");
const runRes = spawnSync("node", [
  REC, SPEC, "--storyboard", runSb, "--png-dir", runDir,
  "--fps", String(RUN_FPS), "--width", "320", "--height", "180", "--scale", "1", "--tail", String(RUN_TAIL),
], { cwd: ROOT, encoding: "utf8" });
const lastLine = (t) => String(t).trim().split("\n").slice(-1)[0];
check(runRes.status === 0, "a run.play take exits 0", lastLine(runRes.stderr));

const runTotal = compileRun(JSON.parse(readFileSync(SPEC, "utf8")), {}).duration + 200;
const summary = /(\d+) steps, ([\d.]+)ms \+ (\d+)ms tail/.exec(runRes.stderr);
check(!!summary && Math.abs(Number(summary[2]) - runTotal) < 1,
  `the run.play story is measured at the compiled run's ${runTotal.toFixed(2)}ms`, summary ? summary[2] : "no summary line");
const runFrames = frames(runDir);
check(runFrames.length >= Math.ceil(runTotal / (1000 / RUN_FPS)),
  `the take covers the whole run (>= ${Math.ceil(runTotal / (1000 / RUN_FPS))} frames)`, `got ${runFrames.length}`);

// 7 — the refusals.
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
expectExit1([SPEC, "--storyboard", SB, "--from", "nope", "--png-dir", join(work, "never")],
  /--from "nope" is not a label[\s\S]*"intro", "focus", "automate"/, "an unknown --from label is refused, with the known ones");
expectExit1([SPEC, "--storyboard", SB, "--font", join(work, "no-such-face.woff2"), "--png-dir", join(work, "never")],
  /--font ".*no-such-face\.woff2" is not a file/, "a missing --font file is refused before a browser is launched");
// A file that IS there and is named right but holds no font — an unfetched git-lfs pointer
// is the everyday one. The extension cannot see it, and the browser's failure is a console
// *warning*, so this used to render a whole take at exit 0 with the pin silently unapplied
// and the layout measured in the machine's default font.
writeFileSync(join(work, "broken.woff2"), "version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 9\n");
expectExit1([SPEC, "--storyboard", SB, "--font", join(work, "broken.woff2"), "--png-dir", join(work, "never")],
  /--font ".*broken\.woff2" does not contain woff2 font data[\s\S]*machine dependence --font exists to remove/,
  "a --font file that is not a font is refused (a git-lfs pointer), before a browser is launched");
// The no-encoder path, forced on a machine that has one: --out has to say what is missing
// and hand over the route that works, before a browser is launched.
{
  const r = spawnSync("node", [REC, SPEC, "--storyboard", SB, "--out", join(work, "never.mp4")],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, SMV_FFMPEG: "smv-no-such-ffmpeg" } });
  check(r.status === 1 && /ffmpeg not found on PATH[\s\S]*--png-dir[\s\S]*ffmpeg -framerate/.test(r.stderr),
    "--out with no encoder fails with an actionable ffmpeg message", lastLine(r.stderr));
}

// 8 — M4c: the ffmpeg pipe. A real mp4, probed: the stream is there in the advertised
// encoding (h264 + yuv420p is what makes the file play everywhere, and it is exactly what
// the pipe's arguments promise), it has exactly the frames the take shot (nothing dropped
// in the pipe, nothing duplicated by a wrong framerate) and its duration is frames/fps.
if (!HAS_FFMPEG) {
  skip.push(HAS_FFMPEG_BIN
    ? "mp4 pipe (--out): this ffmpeg has no libx264 encoder (e.g. Fedora ffmpeg-free) — the pipe hardcodes -c:v libx264"
    : "mp4 pipe (--out): no ffmpeg on this machine — install ffmpeg to gate the encoder");
} else {
  const mp4 = join(work, "story.mp4");
  const mp4Log = record(null, ["--out", mp4]);
  check(existsSync(mp4), "the mp4 exists where --out asked for it", mp4);
  check(mp4Log.includes(mp4), "the summary names the mp4 it wrote", lastLine(mp4Log));
  if (!HAS_FFPROBE) {
    skip.push("mp4 probe: ffmpeg is installed but ffprobe is not");
  } else {
    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
      "stream=codec_name,width,height,pix_fmt,nb_frames,r_frame_rate", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1", mp4], { encoding: "utf8" });
    const field = (k) => (new RegExp(`^${k}=(.*)$`, "m").exec(probe.stdout) || [])[1];
    check(field("codec_name") === "h264", "the mp4 carries an h264 video stream", probe.stdout.trim());
    check(field("pix_fmt") === "yuv420p", "the stream is yuv420p (the plays-everywhere pixel format)", field("pix_fmt"));
    check(field("width") === String(WIDTH) && field("height") === String(HEIGHT),
      `the stream is ${WIDTH}x${HEIGHT} (the clip box at scale 1)`, `${field("width")}x${field("height")}`);
    check(field("r_frame_rate") === `${FPS}/1`, `the stream runs at ${FPS}fps`, field("r_frame_rate"));
    check(Number(field("nb_frames")) === a.length,
      `the mp4 holds exactly the frames the PNG take shot (${a.length})`, field("nb_frames"));
    check(Math.abs(Number(field("duration")) - a.length / FPS) < 0.05,
      `the duration is frames/fps (${(a.length / FPS).toFixed(2)}s)`, field("duration"));
  }
}

// 9 — M4c: a label range renders the SAME pixels as the full take. The slice ticks the
// story exactly as the full render does and only moves the capture window, so frame N of
// `--from focus --to automate` must be byte-identical to the frame of the full take that
// covers the same story ms. Anything else (a seek to `focus`, a fresh play from there)
// would produce a state the story never actually held.
{
  const sliceDir = "slice", chapters = join(work, "chapters.txt");
  const sliceLog = record(sliceDir, ["--from", "focus", "--to", "automate", "--cues", chapters]);
  check(/\[focus 700ms \.\. automate 1400ms\]/.test(sliceLog), "the range is resolved off the cue sheet (700ms..1400ms)", sliceLog.split("\n")[0]);
  const s = frames(join(work, sliceDir));
  const first = Math.ceil(700 / frameMs), last = Math.ceil(1400 / frameMs);
  check(s.length === last - first + 1, `the slice is frames ${first}..${last} inclusive of the --to boundary`, `got ${s.length}`);
  const mismatched = s.filter((f, i) => !readFileSync(join(work, sliceDir, f)).equals(readFileSync(join(work, "a", a[first + i]))));
  check(mismatched.length === 0, `all ${s.length} slice frames are byte-identical to the full take's ${a[first]}..${a[last]}`,
    mismatched.join(", "));
  check(readFileSync(chapters, "utf8") === "00:00 focus\n00:00 automate\n",
    "chapters.txt rebases onto the slice (and pins the first mark at 00:00)", JSON.stringify(readFileSync(chapters, "utf8")));
}

// 10 — M4c: a pinned font is still deterministic, and actually lands. Two takes with the
// same face are byte-identical; a take with it differs from the unpinned baseline, which
// is the only proof from out here that the face reached both the drawing and the
// measurement (node boxes are sized by canvas measureText, see bin/smv-pack.mjs).
if (!FONT) {
  skip.push("--font: no serif font file found on this machine to pin");
} else {
  record("fontA", ["--font", FONT]);
  record("fontB", ["--font", FONT]);
  const fa = frames(join(work, "fontA")), fb = frames(join(work, "fontB"));
  check(fa.length === fb.length && fa.length > 0, "both pinned-font takes wrote the same number of frames", `${fa.length} vs ${fb.length}`);
  const fontDiffs = fa.filter((f, i) => !fb[i] || !readFileSync(join(work, "fontA", f)).equals(readFileSync(join(work, "fontB", fb[i]))));
  check(fontDiffs.length === 0, `--font renders byte-identically across takes (${fa.length} frames)`, fontDiffs.slice(0, 3).join(", "));
  check(fa.length === a.length, "pinning a font does not change the length of the take", `${fa.length} vs ${a.length}`);
  check(!readFileSync(join(work, "fontA", fa[0])).equals(readFileSync(join(work, "a", a[0]))),
    "the pinned face actually reached the page (frame 0 differs from the unpinned take)");
}

// 11 — M4c: Ctrl+C during a take leaves NO mp4. The signal reaches the whole process group,
// which is how a terminal delivers it: ffmpeg used to get it directly, finalize what it had
// and leave a valid, playable 0.4s clip of a 3.4s story — a half story that looks like a
// whole one, which is exactly what abort()'s SIGKILL+unlink exists to prevent, and which it
// never ran because node exited without unwinding the finally.
if (!HAS_FFMPEG) {
  skip.push("interrupting a take: needs the ffmpeg pipe (there is no half-finished file to leave behind without it)");
} else {
  const out = join(work, "interrupted.mp4");
  const strays = () => readdirSync(tmpdir()).filter((f) => f.startsWith("smv-record-"));
  const before = new Set(strays());
  // A long tail, so the signal lands with hundreds of frames of story left: the point is to
  // interrupt a take that is nowhere near done. 30fps × (2900ms + 6s) ≈ 270 frames.
  const child = spawn("node", [
    REC, SPEC, "--storyboard", SB, "--out", out, "--png-dir", join(work, "int"),
    "--fps", "30", "--width", String(WIDTH), "--height", String(HEIGHT), "--scale", "1", "--tail", "6000",
  ], { cwd: ROOT, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (s) => { log += s; });
  const exited = new Promise((res) => child.on("exit", (code, signal) => res({ code, signal })));

  // Wait until the encoder has actually put BYTES on disk (ffmpeg opens the output only
  // after 5MB of PNG has filled its probe buffer, ~frame 150 here). Interrupting before
  // that would prove nothing: there would be no partial file to leave behind either way.
  let gone = null;
  exited.then((e) => { gone = e; });
  const deadline = Date.now() + 180_000;
  let mid = false;
  const shot = () => (log.match(/frame (\d+)\//g) || []).map((s) => Number(/\d+/.exec(s)[0])).pop() || 0;
  while (Date.now() < deadline && !gone) {
    if (existsSync(out) && statSync(out).size > 0) { mid = true; break; }
    await new Promise((r) => setTimeout(r, 20));
  }
  check(mid, `the encoder had written bytes before the signal (at ~frame ${shot()} of ~270)`,
    log.trim().split("\n").slice(-1)[0]);
  // Exactly what a terminal Ctrl+C sends: the whole process group, not the node pid alone.
  try { if (!gone) process.kill(-child.pid, "SIGINT"); } catch { /* it beat us to it */ }
  const end = await exited;
  check(!existsSync(out), "Ctrl+C removes the partial mp4 instead of leaving a playable clip of half the story", out);
  check(end.code !== 0 || end.signal != null, "…and the CLI exits nonzero", JSON.stringify(end));
  check(/smv-record: interrupted/.test(log), "…and says on stderr that the take was interrupted", log.trim().split("\n").slice(-1)[0]);
  // The PNG sequence is the take you can salvage, and the serve dir must not be left behind.
  check(frames(join(work, "int")).length > 0, "…while the --png-dir frames it already wrote survive");
  check(strays().filter((f) => !before.has(f)).length === 0,
    "…and the mkdtemp serve directory is cleaned up", strays().filter((f) => !before.has(f)).join(", "));
}

rmSync(work, { recursive: true, force: true });

console.log(`frames: ${a.length} per take, ${bytes.reduce((n, buf) => n + buf.length, 0)} bytes total`);
for (const p of pass) console.log("  PASS  " + p);
for (const s of skip) console.log("  SKIP  " + s);
for (const f of fail) console.log("  FAIL  " + f);
console.log(fail.length === 0 ? `\ne2e-m4: PASS${skip.length ? ` (${skip.length} skipped)` : ""}` : `\ne2e-m4: FAIL (${fail.length})`);
process.exit(fail.length === 0 ? 0 : 1);
