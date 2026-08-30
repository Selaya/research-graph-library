#!/usr/bin/env node
// smv-record — the deterministic frame renderer (M4b). Packs the spec + storyboard with
// smv-pack's record variant (D15: manual ticker, motion forced full, `data-smv-record`
// killing every CSS transition), drives it in headless chromium and writes one PNG per
// frame.
//
// There is no wall clock anywhere in the loop: the declared timeline (D12) says how many
// frames the story is worth at minimum, each frame is exactly one `ticker.tick(1000/fps)`
// followed by a microtask drain, and the screenshot is taken only once the page has
// stopped changing. Two runs of the same script therefore produce byte-identical frames.
// The take runs on past the declared total — still tick by tick — until the storyboard
// says the story is over, because each async boundary can only resolve on the first tick
// at or past its duration; only then is the tail spent, on a settled picture.
//
// M4c adds the publishing half: frames go straight down an ffmpeg pipe (`--out story.mp4`),
// the cue sheet comes out beside the video in the format its extension asks for
// (`--cues`), a label range can be re-rendered on its own (`--from`/`--to`), and `--font`
// pins the typeface so two machines lay the graph out identically. `--png-dir` is
// unchanged, and is still the fallback for a machine with no ffmpeg.

import {
  readFileSync, writeFileSync, existsSync, statSync, mkdirSync, mkdtempSync, readdirSync,
  rmSync, copyFileSync, realpathSync, openSync, readSync, closeSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { buildHTML } from "./smv-pack.mjs";
import { formatCues } from "./cues.mjs";
import { findChromium, serveRoot } from "../scripts/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/** The encoder, overridable so the no-ffmpeg path is testable on a machine that has one
 *  (and so a custom/static build can be pointed at without touching PATH). */
const FFMPEG = process.env.SMV_FFMPEG || "ffmpeg";
/** The family name the pinned `--font` face is injected under (bin/smv-pack.mjs). */
const FONT_FAMILY = "smv-record-font";
const FONT_FORMATS = { ".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype" };

/** What a font file's first four bytes say it actually is — the extension is only what
 *  someone named it. Returns the `format()` hint that content needs, or null when the file
 *  does not start with any font signature at all (a git-lfs pointer, a truncated download,
 *  an HTML error page saved under the wrong name). The two sfnt flavours are one bucket:
 *  TrueType outlines in a .otf and CFF outlines in a .ttf are both legal and both decode,
 *  so refusing them would be a false alarm; a wOF2 named .ttf is not — the injected
 *  format("truetype") hint makes the browser skip the src entirely. */
function sniffFontFormat(path) {
  let head;
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(4);
      head = buf.subarray(0, readSync(fd, buf, 0, 4, 0));
    } finally { closeSync(fd); }
  } catch { return null; }
  const tag = head.toString("latin1");
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "opentype";
  if (tag === "true" || tag === "ttcf" || head.equals(Buffer.from([0x00, 0x01, 0x00, 0x00]))) return "truetype";
  return null;
}
const sfntBucket = (format) => (format === "opentype" || format === "truetype" ? "sfnt" : format);

const MOUNT_TIMEOUT_MS = 30000;
/** Macrotask turns per frame: at least 2 (one drains the microtasks behind the tick, one
 *  proves nothing new was queued), at most 8 for a long promise chain across a step
 *  boundary. Every turn is a full microtask drain, so this is a settling poll, not a sleep. */
const MIN_TURNS = 2;
const MAX_TURNS = 8;
/** How far past the declared timeline the loop will chase a story that has not finished
 *  before it cuts anyway. Tick quantization costs a frame per async boundary, never this. */
const SETTLE_CAP_MS = 2000;

function usage() {
  return (
    "Usage: smv-record <spec.json> --storyboard sb.json (--out story.mp4 | --png-dir frames/)\n" +
    "                  [--fps 60] [--width 1920] [--height 1080] [--scale 2]\n" +
    "                  [--theme dark|light] [--preset pipeline] [--tail 1200]\n" +
    "                  [--cues cues.srt|cues.json|chapters.txt] [--from label] [--to label]\n" +
    "                  [--font pinned.woff2]\n" +
    "\n" +
    "  Renders a director script frame by frame in headless chromium: straight into an\n" +
    "  h.264 mp4 (--out) and/or as a zero-padded PNG sequence (--png-dir, frame-00000.png\n" +
    "  …). Deterministic: the manual ticker is stepped 1000/fps per frame, so two runs are\n" +
    "  byte-identical. Run `npm run build` first if dist/smv.iife.min.js does not exist.\n" +
    "\n" +
    "  --tail  ms of held frames after the story has settled (default 1200)\n" +
    "  --out   pipes frames to ffmpeg (-c:v libx264 -pix_fmt yuv420p -crf 18); needs\n" +
    "          ffmpeg on PATH ($SMV_FFMPEG overrides), otherwise use --png-dir\n" +
    "  --cues  writes the cue sheet beside the video; the extension picks the format\n" +
    "  --from/--to  render only the range between two storyboard labels\n" +
    "  --font  pin a .woff2/.woff/.ttf/.otf face so the layout is machine-independent\n"
  );
}

function parseArgs(argv) {
  const out = {
    spec: null, storyboard: null, pngDir: null, out: null, preset: null, theme: null,
    cues: null, from: null, to: null, font: null,
    fps: 60, width: 1920, height: 1080, scale: 2, tail: 1200, help: false,
  };
  const positive = (flag, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number (got "${v}")`);
    return n;
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--storyboard") out.storyboard = argv[++i];
    else if (a === "--png-dir") out.pngDir = argv[++i];
    else if (a === "-o" || a === "--out") out.out = argv[++i];
    else if (a === "--preset") out.preset = argv[++i];
    else if (a === "--theme") out.theme = argv[++i];
    else if (a === "--cues") out.cues = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--font") out.font = argv[++i];
    else if (a === "--fps") out.fps = positive(a, argv[++i]);
    else if (a === "--width") out.width = positive(a, argv[++i]);
    else if (a === "--height") out.height = positive(a, argv[++i]);
    else if (a === "--scale") out.scale = positive(a, argv[++i]);
    else if (a === "--tail") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`--tail needs a non-negative number of ms`);
      out.tail = n;
    } else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag "${a}"`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new Error(`expected one spec file, got ${positional.length}`);
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

/** A batch step's children, read exactly as applyStep reads them (src/index.js). */
const batchKids = (step) =>
  Array.isArray(step.steps) ? step.steps : (Array.isArray(step.args && step.args[0]) ? step.args[0] : []);

/** Mode B is not recordable by construction: a live run replays a real event log against
 *  real time, so it answers to the wall clock rather than to the manual ticker and two
 *  renders of it would differ. Refuse it up front, before spending a browser launch.
 *
 *  Scoped to `run.play` — the only op that takes run options — rather than deep-walked over
 *  the step: node/edge `data` is an arbitrary user payload the store preserves verbatim, and
 *  `data:{mode:"live"}` on a node is this project's own pipeline idiom, not a Mode B run. */
function findLiveRun(steps) {
  let hit = null;
  (steps || []).forEach((s, i) => {
    if (hit != null || !s) return;
    if (s.op === "run.play") {
      const o = s.args && s.args[0];
      // Both shapes applyStep reads: `{op,mode}` by hand, `{op,args:[{mode}]}` from timeline().
      if (s.mode === "live" || (o && o.mode === "live")) hit = i;
    } else if (s.op === "batch" && findLiveRun(batchKids(s)) != null) hit = i;
  });
  return hit;
}

/** Does the story drive the token run? Then the run transport has to exist before the
 *  timeline is measured — see the `info` evaluate below. */
function hasRunPlay(steps) {
  return (steps || []).some((s) => !!s && (s.op === "run.play" || (s.op === "batch" && hasRunPlay(batchKids(s)))));
}

/** The chapter markers a script declares, read exactly as `g.cues()` reads them: a bare
 *  `{label}` step with no `op` is the zero-duration position marker. Lets --from/--to be
 *  validated before a browser is launched; the ms offsets still come from the page. */
function labelsOf(steps) {
  return (steps || []).filter((s) => s && s.op === undefined && s.label != null).map((s) => String(s.label));
}

/** --from/--to, resolved: labels → absolute ms off the cue sheet (the SAME sheet the
 *  scrubber and the cue file read, D12) → frame indices. PURE, so the mapping is testable
 *  without a browser. `lastFrame` is inclusive of the boundary frame — the first frame at
 *  or past --to is part of the range (it is the frame that shows the labelled moment);
 *  null means "to the end, tail and all". The epsilon in frameAt is float hygiene, not
 *  slack: frameMs is 1000/fps and 600/16.666… lands a hair under 36, which would cost the
 *  boundary frame an entire extra frame of story. */
function resolveRange(cues, { from = null, to = null, fps }) {
  const frameMs = 1000 / fps;
  const at = (label, flag) => {
    const cue = (cues || []).find((c) => c.kind === "label" && String(c.label) === label);
    if (!cue) throw new Error(`${flag} "${label}" is not a label in this storyboard`);
    return cue.at;
  };
  const startMs = from ? at(from, "--from") : 0;
  const endMs = to ? at(to, "--to") : null;
  if (endMs != null && endMs < startMs) {
    throw new Error(`--to "${to}" (${endMs}ms) comes before --from "${from}" (${startMs}ms) in the story`);
  }
  const frameAt = (ms) => Math.max(0, Math.ceil(ms / frameMs - 1e-9));
  return { startMs, endMs, firstFrame: frameAt(startMs), lastFrame: endMs == null ? null : frameAt(endMs) };
}

/** Is there an encoder? Returns null when ffmpeg answers, else the whole refusal — the
 *  missing tool AND the way through without it, because "ffmpeg not found" on its own
 *  leaves a user with a rendered story and nowhere to put it. */
function ffmpegMissing(args) {
  const probe = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" });
  if (!probe.error) return null;
  return (
    `ffmpeg not found on PATH (tried "${FFMPEG}"; $SMV_FFMPEG overrides) — render the frames ` +
    "with --png-dir frames/ instead, then encode them wherever ffmpeg lives:\n" +
    `  ffmpeg -framerate ${args.fps} -i frames/frame-%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 ${args.out}`
  );
}

/** A PNG sequence on disk. Stale `frame-*.png` are cleared first so a shorter take never
 *  leaves a longer one's tail behind for ffmpeg to pick up. */
function pngSink(dirPath) {
  const dir = resolve(dirPath);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (/^frame-\d+\.png$/.test(f)) rmSync(join(dir, f));
  return {
    what: `${dir}/frame-%05d.png`,
    async write(buf, i) { writeFileSync(join(dir, `frame-${String(i).padStart(5, "0")}.png`), buf); },
    async finish() {},
    async abort() {},
    // Nothing to undo: every frame written is a complete PNG of a moment the story really
    // held, and a short sequence cannot pass for a whole one the way a finalized mp4 can.
    // This is the take a user can salvage after a Ctrl+C, which is why --out says so.
    abortSync() {},
  };
}

/** The mp4 pipe: one long-lived ffmpeg reading PNGs off stdin (`-f image2pipe`), so no
 *  intermediate sequence is ever written. Three things this has to get right —
 *  backpressure (a 4K frame is megabytes and the encoder is slower than the screenshot
 *  loop, so an unawaited write buffers the whole take in RSS), a dead encoder (the drain
 *  that never comes: every wait races the child's exit), and saying WHY it died, which
 *  only ffmpeg's own stderr knows. */
function ffmpegSink(outPath, fps) {
  const out = resolve(outPath);
  const child = spawn(FFMPEG, [
    // -hide_banner so the kept stderr tail is diagnosis rather than eleven lines of
    // library version numbers pushing the actual error out of it.
    "-y", "-hide_banner", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out,
    // Its own process group (`detached`), so a terminal Ctrl+C reaches the recorder and
    // NOT the encoder: a SIGINT delivered straight to ffmpeg makes it finalize what it has
    // behind the recorder's back — a valid, playable 0.4s clip of a 3.4s story, which is
    // exactly the artifact abort() exists to prevent. The recorder stays the sole author of
    // this file's lifetime. Deliberately not unref'd: `closed` must still resolve.
  ], { stdio: ["pipe", "ignore", "pipe"], detached: true });

  const errLines = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (s) => { errLines.push(s); if (errLines.length > 200) errLines.shift(); });
  // EPIPE on stdin when the encoder has already died: the close handler below carries the
  // real reason, and an unhandled 'error' here would replace it with a useless one.
  child.stdin.on("error", () => {});

  let spawnErr = null, exit = null;
  const closed = new Promise((done) => {
    child.on("error", (e) => { spawnErr = e; done(); });
    child.on("close", (code, signal) => { exit = { code, signal }; done(); });
  });
  const tail = () => {
    const lines = errLines.join("").trim().split("\n");
    return lines.slice(-12).join("\n");
  };
  const died = () => {
    if (spawnErr) return `could not run ffmpeg ("${FFMPEG}"): ${spawnErr.message}`;
    if (exit) return `ffmpeg exited ${exit.signal ? `on ${exit.signal}` : exit.code} before the take finished:\n${tail()}`;
    return null;
  };

  return {
    what: out,
    async write(buf) {
      const gone = died();
      if (gone) throw new Error(gone);
      if (child.stdin.write(buf)) return;
      await new Promise((res) => {
        const go = () => { child.stdin.off("drain", go); res(); };
        child.stdin.once("drain", go);
        closed.then(go);
      });
      const late = died();
      if (late) throw new Error(late);
    },
    async finish() {
      await new Promise((res) => { child.stdin.end(res); closed.then(res); });
      await closed;
      if (spawnErr) throw new Error(`could not run ffmpeg ("${FFMPEG}"): ${spawnErr.message}`);
      if (exit && exit.code !== 0) {
        throw new Error(`ffmpeg exited ${exit.signal ? `on ${exit.signal}` : exit.code}:\n${tail()}`);
      }
    },
    /** Every failure path lands here: kill the child (SIGKILL, not SIGTERM — a terminated
     *  ffmpeg finalizes what it has, and half a story that looks like a whole one is worse
     *  than no file) and take the truncated output with it. */
    async abort() {
      if (!exit && !spawnErr) { child.stdin.destroy(); child.kill("SIGKILL"); }
      await closed;
      // Only remove what this encoder was writing. If ffmpeg never started (ENOENT), the
      // path is untouched — and it may be a file the user already had there.
      if (!spawnErr) rmSync(out, { force: true });
    },
    /** The same guarantee with no `await` in it, for the signal handler: a handler that
     *  yields to the event loop races process exit and can lose, and losing here means the
     *  truncated file survives. The unlink is safe before the kill lands — ffmpeg's fd
     *  outlives the name, and the name is what a user would go on to publish. */
    abortSync() {
      if (!exit && !spawnErr) { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
      if (!spawnErr) rmSync(out, { force: true });
    },
  };
}

/** playwright-core is a devDependency: the library itself never touches a browser, only
 *  this CLI does. Say so plainly instead of dying on a bare MODULE_NOT_FOUND. */
async function loadChromium() {
  try {
    return (await import("playwright-core")).chromium;
  } catch {
    throw new Error("smv-record needs playwright-core — npm install -D playwright-core");
  }
}

/** One frame: advance the one shared clock (D1), then let every promise chain the tick
 *  released settle. A step boundary lands on such a chain (a transition resolving hands the
 *  storyboard its next op), and a macrotask turn drains all the microtasks behind it — so
 *  poll the observable state until it stops moving and no boundary can straddle a capture. */
const stepFrame = async ([ms, minTurns, maxTurns]) => {
  const g = window.__smv;
  g.ticker.tick(ms);
  const sig = () => {
    const t = g.timeline(), tr = g.scene.transition, v = g.viewport.transform;
    return [t.index, t.time, t.steps, tr ? tr.duration : -1, v.x, v.y, v.k].join("|");
  };
  let prev = null;
  for (let i = 0; i < maxTurns; i++) {
    await new Promise((r) => setTimeout(r, 0));
    const s = sig();
    if (i + 1 >= minTurns && s === prev) break;
    prev = s;
  }
  // Whether the STORY is over, not whether this frame settled: every step ran and nothing
  // is left mid-transition. The loop spends the tail after this goes true, so `--tail` is
  // held frames on the finished picture rather than budget the story is still eating.
  const sb = g.storyboard(), pos = sb ? sb.position() : null;
  return { done: (!pos || pos.done) && !g.scene.transition };
};

async function record(args) {
  const spec = readJSON(args.spec, "spec");
  const storyboard = readJSON(args.storyboard, "storyboard");
  if (!Array.isArray(storyboard)) throw new Error(`storyboard "${args.storyboard}" must be a JSON array of steps`);
  const live = findLiveRun(storyboard);
  if (live != null) {
    throw new Error(
      `storyboard step ${live} drives a live run ({mode:"live"}) — Mode B replays a real event ` +
      "log against real time and is not reproducible frame by frame. Record a Mode A " +
      '("simulate") story instead.'
    );
  }

  const iifePath = join(root, "dist", "smv.iife.min.js");
  if (!existsSync(iifePath)) throw new Error("dist/smv.iife.min.js not found — run npm run build first");
  // A pinned face is served next to the packed page (relative url, same origin) rather than
  // inlined as a data: URI: a WOFF2 is tens of KB of base64 in a file that already carries
  // the spec and the 128KB IIFE, and the page is thrown away at the end of the take anyway.
  const fontFile = args.font ? "smv-record-font" + extname(args.font).toLowerCase() : null;
  const html = buildHTML({
    spec, storyboard, title: "smv-record", preset: args.preset, theme: args.theme,
    record: true, iife: readFileSync(iifePath, "utf8"),
    font: args.font
      ? { file: fontFile, format: FONT_FORMATS[extname(args.font).toLowerCase()], family: FONT_FAMILY }
      : null,
  });

  // Everything below is cleaned up by ONE finally: the packed story.html is the whole spec
  // plus the 128KB IIFE, and the paths that fail before the browser exists (no
  // playwright-core, no chromium binary, a launch that rejects) are exactly the ones the
  // code above anticipates — so they must not each leak a copy of it into /tmp. The sinks
  // join it for the same reason: a failed take must not leave a truncated mp4 behind.
  let serveDir = null, server = null, port = 0, browser = null;
  const sinks = [];
  const frameMs = 1000 / args.fps;
  let frames = 0, finished = false;
  // Ctrl+C is how a long take ends early ("a take is minutes of work"), and it is the one
  // path where the finally below does not run: node's default disposition for SIGINT — and
  // playwright's own handlers, turned off at launch for this reason — exit the process
  // without unwinding it. So the recorder owns its termination: one handler doing exactly
  // what the finally does, synchronously (an async teardown racing process exit can lose),
  // then a nonzero exit. Removed in the finally so an importing test is not left with them.
  const signals = [];
  const interrupted = (sig) => {
    for (const sink of sinks) { try { sink.abortSync(); } catch { /* keep tearing down */ } }
    if (browser) browser.close().catch(() => {}); // best effort; exiting closes its pipe anyway
    if (server) { try { server.close(); } catch { /* keep tearing down */ } }
    if (serveDir) { try { rmSync(serveDir, { recursive: true, force: true }); } catch { /* ditto */ } }
    process.stderr.write(
      `smv-record: interrupted (${sig}) after ${frames} frames` +
      (args.out ? ` — removed the partial ${resolve(args.out)}` : "") +
      (args.pngDir ? ` (the frames in ${resolve(args.pngDir)} are complete)` : "") +
      (args.out && !args.pngDir ? " (use --png-dir for a take you can salvage)" : "") + "\n"
    );
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  try {
    for (const sig of ["SIGINT", "SIGTERM"]) {
      const handler = () => interrupted(sig);
      signals.push([sig, handler]);
      process.on(sig, handler);
    }
    if (args.pngDir) sinks.push(pngSink(args.pngDir));
    if (args.out) sinks.push(ffmpegSink(args.out, args.fps));
    serveDir = mkdtempSync(join(tmpdir(), "smv-record-"));
    writeFileSync(join(serveDir, "story.html"), html, "utf8");
    if (args.font) copyFileSync(args.font, join(serveDir, fontFile));
    const chromium = await loadChromium();
    ({ server, port } = await serveRoot(serveDir));
    browser = await chromium.launch({
      executablePath: findChromium(),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      // Playwright otherwise installs its own signal handlers, which close the browser and
      // process.exit() out from under both the finally and the handler above — leaving the
      // half-written mp4 to be finalized by whatever else got the signal. The recorder
      // handles these itself.
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });

    const page = await browser.newPage({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: args.scale,
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${port}/story.html`, { waitUntil: "load" });
    try {
      await page.waitForFunction("!!window.__smv", null, { timeout: MOUNT_TIMEOUT_MS });
    } catch {
      throw new Error("the packed page never mounted" + (pageErrors.length ? ` — ${pageErrors[0]}` : ""));
    }
    // Text metrics decide node boxes, so the layout is only reproducible once the fonts are.
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
    // …and once the PINNED one is one of them. `document.fonts.ready` resolves either way —
    // a face that failed to decode is settled, just settled in `error` — and smv-pack mounts
    // on `.then(go, go)` by design, so a bad face costs nothing but the pin. Nothing
    // downstream would notice: chromium reports the failure as a console *warning*, which
    // the pageErrors collector above does not keep. Ask the page directly. This runs inside
    // the try, so the sinks abort and no truncated mp4 survives the refusal.
    if (args.font) {
      const why = await page.evaluate((fam) => {
        if (!document.fonts) return "the page has no FontFaceSet";
        const unquote = (s) => String(s).replace(/^"(.*)"$/, "$1");
        const faces = [...document.fonts].filter((f) => unquote(f.family) === fam);
        if (!faces.length) return "no @font-face for it reached the page";
        // `error` is the decode failure specifically, which is worth telling apart from a
        // face that simply never got as far as being asked for.
        if (faces.some((f) => f.status === "error")) return "the face failed to decode";
        return document.fonts.check("500 13px " + fam) ? null : "the face never loaded";
      }, FONT_FAMILY);
      if (why) {
        throw new Error(
          `--font "${args.font}" did not load in the browser — ${why}. The layout would fall ` +
          "back to the machine default, which is the machine dependence --font exists to remove."
        );
      }
    }

    const info = await page.evaluate((materializeRun) => {
      const g = window.__smv;
      // Nothing but the script may move the camera during a take (D13).
      g.viewport.setInteractive(false);
      // stepSlices() prices a `run.play` step off the run transport's own clock — but only
      // when that transport exists, and the record pack does not autoplay, so at this point
      // nothing has created it. Measuring first would price a whole simulated run at one
      // mutation's baseDuration (350ms) and cut the take short, silently, at exit 0. So
      // materialize it here: exactly what applyStep's ensureRun() does at the step itself.
      if (materializeRun) g.run();
      const r = g.el.getBoundingClientRect();
      const t = g.timeline();
      return {
        total: t.total, steps: t.steps, cues: g.cues(),
        clip: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      };
    }, hasRunPlay(storyboard));
    if (!(info.clip.width > 0 && info.clip.height > 0)) throw new Error("the mount root has no size — nothing to capture");

    // --from/--to: a label range, resolved through resolveRange (see it for the boundary
    // rules). The take itself is unchanged — same play(), same tick cadence, same settle —
    // only the capture window moves, so a slice is byte-identical to the matching stretch
    // of the full render. Cheating by seeking to `--from` instead would run a different
    // story: a forward scrub replays director ops instantly and skips the tweens they were
    // supposed to leave behind, so the first captured frame would be a state the story
    // never actually held.
    const { startMs, endMs, firstFrame, lastFrame } =
      resolveRange(info.cues, { from: args.from, to: args.to, fps: args.fps });

    // The declared timeline (D12) is the FLOOR, not the end: each async phase boundary
    // resolves on the first tick at or past its duration, so a story of N boundaries can
    // run up to N ticks long. Cutting at the declared total would drop the settled final
    // state (the last mark() flip lands after the last tween), and `--tail` would pay for
    // the overrun instead of holding the finished picture. So: play until the storyboard
    // says it is done, then spend the tail — with a cap so a runaway script still ends.
    const storyFloor = Math.max(1, Math.ceil(info.total / frameMs));
    // A range that ends at `--to` ends there: the tail is held frames on a FINISHED story,
    // and the story is not finished in the middle of it.
    const tailFrames = lastFrame == null ? Math.ceil(args.tail / frameMs) : 0;
    const maxStory = storyFloor + Math.ceil(SETTLE_CAP_MS / frameMs);
    const estimate = Math.max(1, (lastFrame == null ? storyFloor + tailFrames : lastFrame + 1) - firstFrame);
    const range = args.from || args.to
      ? ` [${args.from || "start"} ${startMs}ms .. ${args.to || "end"}${endMs == null ? "" : " " + endMs + "ms"}]`
      : "";
    process.stderr.write(
      `smv-record: ${info.steps} steps, ${info.total}ms + ${Math.round(tailFrames * frameMs)}ms tail ` +
      `-> ~${estimate} frames at ${args.fps}fps ` +
      `(${info.clip.width}x${info.clip.height} @${args.scale}x, ${info.cues.length} cues)${range}\n`
    );

    // The cue sheet is a function of the declared timeline alone, so it is written before
    // the frame loop: a long take interrupted half way still leaves a usable sheet, and a
    // bad --cues extension has already failed (in main) before a browser was launched.
    if (args.cues) {
      const sheet = formatCues(args.cues, info.cues, {
        fps: args.fps, width: info.clip.width, height: info.clip.height, scale: args.scale,
        total: info.total, startMs, endMs,
        // The .srt annotates the MEDIA, which runs `tailFrames` past the story: the caption
        // that is up when the story ends is up for the whole tail. Without this a caption
        // issued as the last step closes at `total` — a zero-length span the clip drops,
        // silently losing a subtitle the viewer sees for over a second. 0 under --to, where
        // there is no tail.
        mediaEnd: info.total + tailFrames * frameMs,
        range: args.from || args.to ? { from: args.from || null, to: args.to || null, startMs, endMs } : null,
      });
      writeFileSync(resolve(args.cues), sheet.text, "utf8");
      process.stderr.write(
        `smv-record: wrote ${sheet.kind} cue sheet to ${resolve(args.cues)}` +
        (sheet.empty ? " — but the story has nothing to put in it" : "") + "\n"
      );
    }

    await page.evaluate(() => { window.__smv.storyboard().play(); });

    const every = Math.max(1, Math.round(args.fps)); // one progress line per second of output
    // `idx` is the frame's position on the STORY's clock; `frames` counts what was kept.
    // They differ only under --from/--to, and that is the whole trick: the loop always
    // ticks every frame, it just does not always shoot one.
    let idx = 0;
    const shoot = async () => {
      const st = await page.evaluate(stepFrame, [idx === 0 ? 0 : frameMs, MIN_TURNS, MAX_TURNS]);
      const keep = idx >= firstFrame && (lastFrame == null || idx <= lastFrame);
      // A skipped frame still gets its compositor frame. Measured, not assumed: without
      // this, the first captures after a fast-forward came back a hair different from the
      // same frames of a full render — ~92dB PSNR, a few antialiased pixels on the frames
      // in the middle of a camera tween. The JS state is identical (the ticks are), but
      // the RASTER is not: a screenshot forces a paint, so shooting every frame and
      // shooting one in eight leave Skia in different places. One rAF round-trip per
      // skipped frame restores the cadence for a fraction of a screenshot's cost, and
      // makes a slice byte-identical to the full render's matching frames — which is the
      // only reason to render a range separately (it has to intercut).
      if (!keep) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      else {
        const buf = await page.screenshot({ clip: info.clip });
        for (const sink of sinks) await sink.write(buf, frames);
        frames++;
        if ((frames - 1) % every === 0) {
          process.stderr.write(`smv-record: frame ${frames}/~${estimate} (${((idx * frameMs) / 1000).toFixed(1)}s)\n`);
        }
      }
      idx++;
      return st;
    };

    let overran = false;
    for (;;) {
      // Frame 0 is the story at t=0: settle what play() queued, advance nothing.
      const st = await shoot();
      if (lastFrame != null && idx > lastFrame) break;
      if (idx >= storyFloor && st.done) break;
      if (idx >= maxStory) { overran = true; break; }
    }
    if (overran) {
      process.stderr.write(
        `smv-record: the story had not finished ${SETTLE_CAP_MS}ms past its declared ${info.total}ms — ` +
        "cutting there. Check for a step whose declared `dur` is shorter than what it does.\n"
      );
    }
    for (let t = 0; t < tailFrames; t++) await shoot();
    if (!frames) throw new Error("the range captured no frames — check --from/--to");
    if (pageErrors.length) throw new Error(`the page reported errors during the take — ${pageErrors[0]}`);
    for (const sink of sinks) await sink.finish();
    finished = true;
  } finally {
    // Defensive: the try now opens before the browser and the server exist.
    // A failed take must not leave a truncated mp4 that looks like a finished one — but an
    // abort that itself throws must not replace the error that explains what went wrong.
    if (!finished) {
      for (const sink of sinks) {
        try { await sink.abort(); } catch { /* the original failure is the one worth reporting */ }
      }
    }
    if (browser) await browser.close();
    if (server) server.close();
    if (serveDir) rmSync(serveDir, { recursive: true, force: true });
    for (const [sig, handler] of signals) process.off(sig, handler);
  }

  process.stderr.write(
    `smv-record: wrote ${frames} frames (${((frames * frameMs) / 1000).toFixed(2)}s at ${args.fps}fps) to ` +
    sinks.map((s) => s.what).join(" and ") + "\n"
  );
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`smv-record: ${err.message}\n\n` + usage());
    process.exit(1);
  }
  if (args.help || !args.spec) {
    process.stderr.write(usage());
    process.exit(args.help ? 0 : 1);
  }

  try {
    if (!args.storyboard) throw new Error("--storyboard sb.json is required (there is no story to record without one)");
    if (!args.out && !args.pngDir) {
      throw new Error("nowhere to put the frames — pass --out story.mp4 and/or --png-dir frames/");
    }
    // Everything a browser cannot teach us is checked up front: a take is minutes of work,
    // and finding out at the end that there is no encoder, the cue file cannot be named,
    // the font is not there or a label is misspelled is finding out too late.
    if (args.out) {
      const gap = ffmpegMissing(args);
      if (gap) throw new Error(gap);
    }
    if (args.cues) formatCues(args.cues, [], {}); // extension check only; the sheet is written mid-take
    if (args.font) {
      if (!existsSync(args.font) || !statSync(args.font).isFile()) throw new Error(`--font "${args.font}" is not a file`);
      const want = FONT_FORMATS[extname(args.font).toLowerCase()];
      if (!want) {
        throw new Error(`--font "${args.font}" must be one of: ${Object.keys(FONT_FORMATS).join(", ")}`);
      }
      // The extension alone cannot see the two everyday accidents — a git-lfs pointer left
      // unfetched by a checkout, and a WOFF2 renamed .ttf — and both fail SILENTLY in the
      // browser: the face errors, the mount falls back to the machine's default, and the
      // take completes at exit 0 having laid the graph out in exactly the machine-dependent
      // font --font exists to remove. Four bytes catch them before a browser is launched.
      const got = sniffFontFormat(args.font);
      if (sfntBucket(got) !== sfntBucket(want)) {
        throw new Error(
          `--font "${args.font}" does not contain ${want} font data — ` +
          (got
            ? `its first bytes say it is ${got}, so the injected format("${want}") hint makes the browser skip it`
            : "it starts with no font signature at all (an unfetched git-lfs pointer or a truncated download looks exactly like this)") +
          ". The layout would silently fall back to the machine default, which is the machine dependence --font exists to remove."
        );
      }
    }
    if (args.from || args.to) {
      // Label EXISTENCE is a property of the storyboard file, so it is checked here; the ms
      // offsets still come from the page's own cue sheet, because where a label sits can
      // depend on a compiled run only the browser can build.
      const labels = labelsOf(readJSON(args.storyboard, "storyboard"));
      const known = labels.length ? labels.map((l) => `"${l}"`).join(", ") : "(this storyboard has no labels)";
      for (const [flag, want] of [["--from", args.from], ["--to", args.to]]) {
        if (want && !labels.includes(want)) {
          throw new Error(`${flag} "${want}" is not a label in the storyboard — known labels: ${known}`);
        }
      }
    }
    await record(args);
  } catch (err) {
    process.stderr.write(`smv-record: ${err.message}\n`);
    process.exit(1);
  }
}

// Only run when invoked directly (so parseArgs/findLiveRun are importable from tests).
// Compare resolved file URLs, not a hand-built `file://` + argv[1]: npm/npx installs this
// bin as a symlink (import.meta.url is the realpath, argv[1] is the link) and any space in
// the path is percent-encoded on one side only — either divergence would turn the CLI into
// a silent no-op that exits 0 with no output.
if (import.meta.url === entryURL()) {
  await main(process.argv.slice(2));
}

function entryURL() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return null; // no argv[1], or it is not a real path — not a direct invocation
  }
}

export { parseArgs, findLiveRun, labelsOf, resolveRange, sniffFontFormat };
