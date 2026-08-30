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
// mp4 output is M4c: `--out` reports what it would need and points at --png-dir.

import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { buildHTML } from "./smv-pack.mjs";
import { findChromium, serveRoot } from "../scripts/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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
    "Usage: smv-record <spec.json> --storyboard sb.json --png-dir frames/\n" +
    "                  [--fps 60] [--width 1920] [--height 1080] [--scale 2]\n" +
    "                  [--theme dark|light] [--preset pipeline] [--tail 1200]\n" +
    "\n" +
    "  Renders a director script frame by frame in headless chromium and writes a\n" +
    "  zero-padded PNG sequence (frame-00000.png …). Deterministic: the manual ticker is\n" +
    "  stepped 1000/fps per frame, so two runs are byte-identical.\n" +
    "  Run `npm run build` first if dist/smv.iife.min.js does not exist yet.\n" +
    "\n" +
    "  --tail  ms of held frames after the story has settled (default 1200)\n" +
    "  --out   mp4 encoding is M4c; it prints the ffmpeg line to run yourself — with\n" +
    "          --png-dir the frames are recorded first, without it nothing is\n"
  );
}

function parseArgs(argv) {
  const out = {
    spec: null, storyboard: null, pngDir: null, out: null, preset: null, theme: null,
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
  const html = buildHTML({
    spec, storyboard, title: "smv-record", preset: args.preset, theme: args.theme,
    record: true, iife: readFileSync(iifePath, "utf8"),
  });

  const dir = resolve(args.pngDir);
  mkdirSync(dir, { recursive: true });
  // A shorter take must not leave the tail of a longer one behind for ffmpeg to pick up.
  for (const f of readdirSync(dir)) if (/^frame-\d+\.png$/.test(f)) rmSync(join(dir, f));

  // Everything below is cleaned up by ONE finally: the packed story.html is the whole spec
  // plus the 128KB IIFE, and the paths that fail before the browser exists (no
  // playwright-core, no chromium binary, a launch that rejects) are exactly the ones the
  // code above anticipates — so they must not each leak a copy of it into /tmp.
  let serveDir = null, server = null, port = 0, browser = null;
  const frameMs = 1000 / args.fps;
  let frames = 0;
  try {
    serveDir = mkdtempSync(join(tmpdir(), "smv-record-"));
    writeFileSync(join(serveDir, "story.html"), html, "utf8");
    const chromium = await loadChromium();
    ({ server, port } = await serveRoot(serveDir));
    browser = await chromium.launch({
      executablePath: findChromium(),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
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
        total: t.total, steps: t.steps, cues: g.cues().length,
        clip: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      };
    }, hasRunPlay(storyboard));
    if (!(info.clip.width > 0 && info.clip.height > 0)) throw new Error("the mount root has no size — nothing to capture");

    // The declared timeline (D12) is the FLOOR, not the end: each async phase boundary
    // resolves on the first tick at or past its duration, so a story of N boundaries can
    // run up to N ticks long. Cutting at the declared total would drop the settled final
    // state (the last mark() flip lands after the last tween), and `--tail` would pay for
    // the overrun instead of holding the finished picture. So: play until the storyboard
    // says it is done, then spend the tail — with a cap so a runaway script still ends.
    const storyFloor = Math.max(1, Math.ceil(info.total / frameMs));
    const tailFrames = Math.ceil(args.tail / frameMs);
    const maxStory = storyFloor + Math.ceil(SETTLE_CAP_MS / frameMs);
    const estimate = storyFloor + tailFrames;
    process.stderr.write(
      `smv-record: ${info.steps} steps, ${info.total}ms + ${args.tail}ms tail -> ~${estimate} frames ` +
      `at ${args.fps}fps (${info.clip.width}x${info.clip.height} @${args.scale}x, ${info.cues} cues)\n`
    );

    await page.evaluate(() => { window.__smv.storyboard().play(); });

    const every = Math.max(1, Math.round(args.fps)); // one progress line per second of output
    const shoot = async (advance) => {
      const st = await page.evaluate(stepFrame, [advance, MIN_TURNS, MAX_TURNS]);
      await page.screenshot({ path: join(dir, `frame-${String(frames).padStart(5, "0")}.png`), clip: info.clip });
      frames++;
      if ((frames - 1) % every === 0) {
        process.stderr.write(`smv-record: frame ${frames}/~${estimate} (${(((frames - 1) * frameMs) / 1000).toFixed(1)}s)\n`);
      }
      return st;
    };

    let overran = false;
    for (;;) {
      // Frame 0 is the story at t=0: settle what play() queued, advance nothing.
      const st = await shoot(frames === 0 ? 0 : frameMs);
      if (frames >= storyFloor && st.done) break;
      if (frames >= maxStory) { overran = true; break; }
    }
    if (overran) {
      process.stderr.write(
        `smv-record: the story had not finished ${SETTLE_CAP_MS}ms past its declared ${info.total}ms — ` +
        "cutting there. Check for a step whose declared `dur` is shorter than what it does.\n"
      );
    }
    for (let t = 0; t < tailFrames; t++) await shoot(frameMs);
    if (pageErrors.length) throw new Error(`the page reported errors during the take — ${pageErrors[0]}`);
  } finally {
    // Defensive: the try now opens before the browser and the server exist.
    if (browser) await browser.close();
    if (server) server.close();
    if (serveDir) rmSync(serveDir, { recursive: true, force: true });
  }

  process.stderr.write(
    `smv-record: wrote ${frames} frames to ${dir} ` +
    `(${((frames * frameMs) / 1000).toFixed(2)}s at ${args.fps}fps)\n`
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
    // M4c owns the ffmpeg pipe. Until then --out names what is missing and the path that
    // does work — but only refuse when that path is not already on the command line:
    // telling someone who passed --png-dir to pass --png-dir, and writing no frames, is a
    // dead end dressed up as advice.
    const ffmpegGap = () => {
      const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return probe.error ? "ffmpeg not found on PATH" : "mp4 encoding is not wired up yet (M4c)";
    };
    if (args.out && !args.pngDir) {
      throw new Error(
        `${ffmpegGap()} — render the frames with --png-dir frames/ instead, then encode them yourself:\n` +
        `  ffmpeg -framerate ${args.fps} -i frames/frame-%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 ${args.out}`
      );
    }
    if (!args.pngDir) throw new Error("--png-dir frames/ is required (mp4 output via --out is M4c)");
    await record(args);
    if (args.out) {
      const d = resolve(args.pngDir);
      process.stderr.write(
        `smv-record: ${ffmpegGap()} — the frames are written; encode them yourself:\n` +
        `  ffmpeg -framerate ${args.fps} -i ${join(d, "frame-%05d.png")} -c:v libx264 -pix_fmt yuv420p -crf 18 ${args.out}\n`
      );
    }
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

export { parseArgs, findLiveRun };
