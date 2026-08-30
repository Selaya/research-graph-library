#!/usr/bin/env node
// smv-fit — VO-first hold fitting (M4d). A pure JSON->JSON transform: given a director
// script and a list of "the narration wants this label at this millisecond" marks, it
// stretches and shrinks the `wait` steps between the marked labels until every label
// lands on its mark.
//
//   smv-fit script.sb.json --vo marks.json -o fitted.sb.json
//
// The workflow this closes (docs/RECORDING.md §3.2): render once with `--cues`, record the
// narration against the sheet, then feed the timestamps the read actually landed on back
// into the script instead of hand-tuning `wait` steps and re-rendering to see where they
// went. Nothing else in the file moves — same steps, same order, same keys, same identity;
// only the holds between the beats change.
//
// It lives in bin/ for the same reason bin/cues.mjs does: it is a publishing concern, the
// library carries a hard gzip budget, and a transform that never runs in a browser has no
// business inside it. Nothing here imports from src/ — but the pricing below MUST stay the
// `durOf()` table in src/index.js verbatim, because a fit computed off a different clock
// than the scrubber, the cue sheet and the frame renderer read is worse than no fit at all.
// test/fit-cli.test.js asserts that parity against a real `g.cues()` (D12).

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---- the pricing table (D12) — src/index.js durOf(), verbatim ------------------------
/** A camera move with no declared `dur`. */
const CAMERA_MS = 600;
/** condense/split: the CONDENSE_PHASES sum (highlight + converge + reveal). */
const CHOREO_MS = 900;
/** The mount-wide `animation.duration` default every other mutation costs. */
const BASE_MS = 350;
/** Inside a batch, the ops that keep their own clock instead of folding into the one
 *  shared relayout — so they, and only they, can make the batch cost more than the commit. */
const PARALLEL_IN_BATCH = new Set(["wait", "camera", "condense", "split"]);

/** A batch step's children, read exactly as applyStep reads them (src/index.js). */
const batchKids = (step) =>
  Array.isArray(step.steps) ? step.steps : (Array.isArray(step.args && step.args[0]) ? step.args[0] : []);

/**
 * durOf(step, base) -> ms. The declared timeline is the contract (D12): what a step is
 * worth is what it actually takes, and `dur` on the step overrides. `base` is the mount's
 * `animation.duration` — pass it when the story will be played at anything but 350ms.
 */
export function durOf(step, base = BASE_MS) {
  if (!step || step.op === undefined) return 0;      // labels are zero-duration positions
  if (step.dur != null) return Math.max(0, step.dur);
  const a0 = step.args && step.args[0];
  switch (step.op) {
    case "wait": return Math.max(0, step.ms ?? a0 ?? 0);
    case "camera": return Math.max(0, (a0 && a0.dur) ?? CAMERA_MS);
    case "highlight": case "clearHighlight": case "caption": case "props":
    case "run.step": case "run.seek": return 0;      // discrete state flips, D14
    case "condense": case "split": return CHOREO_MS;
    case "batch":
      return batchKids(step).reduce(
        (m, s) => (s && PARALLEL_IN_BATCH.has(s.op) ? Math.max(m, durOf(s, base)) : m), base,
      );
    default: return base;
  }
}

/** Where every label sits on the story clock, as `{label, index, at}` in step order —
 *  the same numbers `g.cues()` emits for its `kind:"label"` entries. */
export function labelOffsets(steps, base = BASE_MS) {
  const out = [];
  let at = 0;
  (steps || []).forEach((s, index) => {
    if (s && s.op === undefined && s.label !== undefined) out.push({ label: String(s.label), index, at });
    at += durOf(s, base);
  });
  return out;
}

/** The one step kind this transform cannot price: `run.play` is measured off the compiled
 *  run transport's own clock (src/index.js stepSlices), which only exists inside a browser
 *  with the engine loaded. Refuse rather than guess — a segment mispriced by a whole
 *  simulated run would move every label after it. */
function findRunPlay(steps) {
  let hit = null;
  (steps || []).forEach((s, i) => {
    if (hit != null || !s) return;
    if (s.op === "run.play") hit = i;
    else if (s.op === "batch" && findRunPlay(batchKids(s)) != null) hit = i;
  });
  return hit;
}

/** The refusal itself, shared by the exported fit() and the CLI — which runs it before it
 *  even opens the marks file, so the answer never depends on the marks being valid. An
 *  explicit `dur` on the step is NOT a way out: stepSlices() prices a run.play off
 *  `runCtl` and never reads `s.dur`, so honouring one here would put the fit on a
 *  different clock than the scrubber, the cue sheet and the frame renderer. */
function assertNoRunPlay(steps) {
  const run = findRunPlay(steps);
  if (run == null) return;
  throw new Error(
    `storyboard step ${run} is a run.play — its length is measured off the compiled token ` +
    "run inside the browser, not off the declared timeline, so this transform cannot price " +
    "the segment it sits in. Fit a script without one: `run.seek`/`run.step` steps paced by " +
    "`wait` holds drive the same run on a timeline this transform can read."
  );
}

// ---- marks ---------------------------------------------------------------------------

/**
 * parseMarks(raw) -> [{label, ms}] in file order. Both shapes a VO tool might hand over:
 * the object form `{"intro":0,"focus":4200}` (key order is the file's order, which is what
 * JSON.parse preserves) and the array form `[{"label":"intro","ms":0}, …]`.
 */
export function parseMarks(raw) {
  const out = [];
  const push = (label, ms, where) => {
    if (label == null || label === "") throw new Error(`${where} has no label`);
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
      throw new Error(`mark "${label}" needs a number of milliseconds (got ${JSON.stringify(ms)})`);
    }
    if (ms < 0) throw new Error(`mark "${label}" is at ${ms}ms — a story has no time before 0`);
    out.push({ label: String(label), ms });
  };
  if (Array.isArray(raw)) raw.forEach((m, i) => push(m && m.label, m && m.ms, `mark ${i}`));
  else if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw)) push(k, v, `mark "${k}"`);
  else throw new Error('the marks file must be {"label": ms, …} or [{"label":…,"ms":…}, …]');
  if (!out.length) throw new Error("the marks file names no labels — there is nothing to fit to");
  const seen = new Set();
  for (const m of out) {
    if (seen.has(m.label)) throw new Error(`mark "${m.label}" appears twice`);
    seen.add(m.label);
  }
  return out;
}

// ---- the fit -------------------------------------------------------------------------

/** What prices a `wait`, written back onto whichever field priced it — `dur` wins in
 *  durOf(), so a wait carrying both is kept honest on both. A wait declaring neither grows
 *  an `ms` (the only key this transform ever adds to an existing step). */
function setWait(step, ms) {
  let wrote = false;
  if (step.dur != null) { step.dur = ms; wrote = true; }
  if (step.ms != null) { step.ms = ms; wrote = true; }
  else if (Array.isArray(step.args) && step.args.length) { step.args[0] = ms; wrote = true; }
  if (!wrote) step.ms = ms;
}

/**
 * fit(steps, marks, {base}) -> {steps, moves} — PURE apart from mutating the `steps` it is
 * handed (the caller passes a fresh JSON.parse, so key order and step identity survive).
 *
 * The story start is an implicit anchor at 0ms, so the run-up to the first marked label is
 * fitted like every other segment. For each pair of consecutive anchors:
 *   floor  = what the segment's NON-wait steps cost — the shortest it can possibly be
 *   T      = the requested gap minus that floor, i.e. the whole wait budget
 * and T is handed to the segment's wait steps in proportion to what they already hold
 * (integers; the rounding remainder lands on the last one, so the sum is exactly T). A
 * segment with no wait at all gets one inserted immediately before the label — which is
 * also what makes the transform idempotent: re-fitting finds that wait holding exactly T,
 * asks for T again, and writes it back unchanged.
 */
export function fit(steps, marks, { base = BASE_MS } = {}) {
  assertNoRunPlay(steps); // a library caller must not silently price a run.play at `base`
  const offsets = labelOffsets(steps, base);
  const byLabel = new Map();
  for (const l of offsets) if (!byLabel.has(l.label)) byLabel.set(l.label, l);

  // Resolve, then order by where the labels actually are in the SCRIPT: a marks file is a
  // VO tool's output and its key order is the narrator's, not the story's.
  const anchors = marks.map((m) => {
    const l = byLabel.get(m.label);
    if (!l) {
      const known = offsets.length ? offsets.map((o) => `"${o.label}"`).join(", ") : "(this storyboard has no labels)";
      throw new Error(`--vo names a label the storyboard does not have: "${m.label}" — known labels: ${known}`);
    }
    return { label: m.label, index: l.index, at: l.at, want: m.ms };
  });
  anchors.sort((a, b) => a.index - b.index);
  for (let i = 1; i < anchors.length; i++) {
    const p = anchors[i - 1], c = anchors[i];
    if (c.want < p.want) {
      throw new Error(
        `the marks run backwards: "${c.label}" comes after "${p.label}" in the script but is ` +
        `marked at ${c.want}ms, before its ${p.want}ms`
      );
    }
  }

  const moves = [];
  // Walk backwards so an inserted wait never shifts an anchor index we have not used yet.
  for (let i = anchors.length - 1; i >= 0; i--) {
    const end = anchors[i];
    const start = i > 0 ? anchors[i - 1] : { index: 0, at: 0, want: 0, label: null };
    const span = steps.slice(start.index, end.index);
    const waits = span.filter((s) => s && s.op === "wait");
    const floor = span.reduce((sum, s) => sum + (s && s.op === "wait" ? 0 : durOf(s, base)), 0);
    const gap = end.want - start.want;
    if (gap < floor) {
      throw new Error(
        `"${end.label}" cannot land at ${end.want}ms: the ${floor}ms of unstretchable steps ` +
        `${start.label ? `after "${start.label}"` : "before it"} already exceed the ${gap}ms gap asked for. ` +
        "Give the read more room, or shorten those steps' `dur`."
      );
    }
    const budget = gap - floor;
    if (!waits.length) {
      if (budget > 0) steps.splice(end.index, 0, { op: "wait", ms: budget });
    } else {
      const held = waits.reduce((sum, s) => sum + durOf(s, base), 0);
      let spent = 0;
      waits.forEach((s, j) => {
        // The remainder lands on the last wait, so the segment sums to exactly `budget`
        // whatever the rounding did — and a re-fit of the result is a no-op.
        const share = j === waits.length - 1
          ? budget - spent
          : (held > 0 ? Math.floor((durOf(s, base) * budget) / held) : 0);
        spent += share;
        setWait(s, share);
      });
    }
    moves.push({ label: end.label, from: end.at, to: end.want });
  }
  moves.reverse();
  return { steps, moves };
}

// ---- CLI -----------------------------------------------------------------------------

function usage() {
  return (
    "Usage: smv-fit <script.sb.json> --vo marks.json [-o fitted.sb.json] [--base 350]\n" +
    "\n" +
    "  Stretches/shrinks the `wait` steps between labelled beats so every label named in\n" +
    "  the marks file lands on its millisecond. Pure JSON->JSON: nothing else in the\n" +
    "  script moves, and re-fitting an already-fitted script is a no-op.\n" +
    "\n" +
    '  --vo    {"intro":0,"focus":4200,…} or [{"label":"intro","ms":0},…] — where the\n' +
    "          narration wants each label, in absolute ms on the story clock\n" +
    "  -o      where to write (default: stdout)\n" +
    "  --base  the mount's animation.duration, what an unpriced mutation costs (default 350)\n"
  );
}

export function parseArgs(argv) {
  const out = { steps: null, vo: null, out: null, base: BASE_MS, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vo") out.vo = argv[++i];
    else if (a === "-o" || a === "--out") out.out = argv[++i];
    else if (a === "--base") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error("--base needs a non-negative number of ms");
      out.base = n;
    } else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag "${a}"`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new Error(`expected one storyboard file, got ${positional.length}`);
  out.steps = positional[0] || null;
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

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`smv-fit: ${err.message}\n\n` + usage());
    process.exit(1);
  }
  if (args.help || !args.steps) {
    process.stderr.write(usage());
    process.exit(args.help ? 0 : 1);
  }
  try {
    if (!args.vo) throw new Error("--vo marks.json is required (there is nothing to fit to without it)");
    const steps = readJSON(args.steps, "storyboard");
    if (!Array.isArray(steps)) throw new Error(`storyboard "${args.steps}" must be a JSON array of steps`);
    assertNoRunPlay(steps);
    const marks = parseMarks(readJSON(args.vo, "marks"));
    const { moves } = fit(steps, marks, { base: args.base });
    const text = JSON.stringify(steps, null, 2) + "\n";
    if (args.out) writeFileSync(args.out, text, "utf8");
    else process.stdout.write(text);
    for (const m of moves) {
      process.stderr.write(`smv-fit: ${m.label} ${m.from}ms -> ${m.to}ms\n`);
    }
    const total = steps.reduce((sum, s) => sum + durOf(s, args.base), 0);
    process.stderr.write(`smv-fit: ${steps.length} steps, ${total}ms total -> ${args.out || "stdout"}\n`);
  } catch (err) {
    process.stderr.write(`smv-fit: ${err.message}\n`);
    process.exit(1);
  }
}

// Only run when invoked directly — see bin/smv-record.mjs for why this compares resolved
// file URLs rather than a hand-built `file://` + argv[1].
if (import.meta.url === entryURL()) main(process.argv.slice(2));

function entryURL() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return null;
  }
}
