// bin/cues.mjs — the three cue-sheet formats smv-record --cues writes (M4c). Pure string
// assembly over what g.cues() returns, so this needs no browser and no ffmpeg.

import { test } from "node:test";
import assert from "node:assert/strict";
import { captionSpans, chapterTime, formatCues, srtTime, toChapters, toJSON, toSRT } from "../bin/cues.mjs";

// A cue sheet in the shape src/index.js emits: labels and captions with absolute story ms.
const CUES = [
  { kind: "label", at: 0, label: "intro", index: 0 },
  { kind: "caption", at: 300, text: "Two manual steps sit between ingest and publish.", index: 2 },
  { kind: "label", at: 700, label: "focus", index: 4 },
  { kind: "label", at: 1400, label: "automate", index: 8 },
  { kind: "caption", at: 2300, text: "…now one automated step.", index: 10 },
];
const TOTAL = 2900;

test("srtTime: HH:MM:SS,mmm — comma, padded hours, no rounding drift", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(1), "00:00:00,001");
  assert.equal(srtTime(2300), "00:00:02,300");
  assert.equal(srtTime(61_000 + 5), "00:01:01,005");
  assert.equal(srtTime(3_723_456), "01:02:03,456");
  assert.equal(srtTime(-5), "00:00:00,000");
});

test("chapterTime: MM:SS, growing an hours field only when there are hours", () => {
  assert.equal(chapterTime(0), "00:00");
  assert.equal(chapterTime(1400), "00:01");
  // Floor, not round: a chapter mark is a seek target, and 00:01 is past the 0.7s moment.
  assert.equal(chapterTime(700), "00:00");
  assert.equal(chapterTime(95_900), "01:35");
  assert.equal(chapterTime(3_723_900), "1:02:03");
});

test("captionSpans: a caption runs until the next one, a clear, or the end of the story", () => {
  const spans = captionSpans(CUES, TOTAL);
  assert.deepEqual(spans, [
    { start: 300, end: 2300, text: "Two manual steps sit between ingest and publish." },
    { start: 2300, end: TOTAL, text: "…now one automated step." },
  ]);
  // caption(null) is a clear: it ends the open span and opens nothing.
  assert.deepEqual(
    captionSpans([{ kind: "caption", at: 100, text: "a" }, { kind: "caption", at: 400, text: null }], 900),
    [{ start: 100, end: 400, text: "a" }]
  );
  assert.deepEqual(captionSpans([], 900), []);
});

test("toSRT: numbered entries with the spans as their timing", () => {
  assert.equal(
    toSRT(CUES, { total: TOTAL }),
    "1\n00:00:00,300 --> 00:00:02,300\nTwo manual steps sit between ingest and publish.\n\n" +
    "2\n00:00:02,300 --> 00:00:02,900\n…now one automated step.\n"
  );
  assert.equal(toSRT([], { total: TOTAL }), "");
});

test("toSRT: the last caption is held for the tail, so a final-step caption survives", () => {
  // A caption issued as the story's LAST step sits at `at === total` (captions are
  // zero-duration ops), so on the story clock its span is [2900,2900) — zero length, which
  // clip() drops. It is burned into every one of the tail frames all the same, and dropping
  // it loses a subtitle the viewer sees for over a second. The media clock is the fix.
  const withEnd = [...CUES, { kind: "caption", at: TOTAL, text: "The End", index: 13 }];
  assert.equal(toSRT(withEnd, { total: TOTAL, mediaEnd: TOTAL + 1200 }).split("\n\n")[2],
    "3\n00:00:02,900 --> 00:00:04,100\nThe End\n");
  // …and the caption that was already up runs to the end of the MEDIA, not of the story.
  assert.equal(toSRT(CUES, { total: TOTAL, mediaEnd: TOTAL + 1200 }).split("\n\n")[1],
    "2\n00:00:02,300 --> 00:00:04,100\n…now one automated step.\n");
  // --tail 0, and a caller that passes no media clock at all, both stay on the story's.
  assert.equal(toSRT(withEnd, { total: TOTAL, mediaEnd: TOTAL }), toSRT(withEnd, { total: TOTAL }));
  assert.equal(toSRT(withEnd, { total: TOTAL }).split("\n\n").length, 2); // the zero-length span is dropped
});

test("toSRT: a range clips and rebases, because the subtitles annotate the MEDIA", () => {
  // Rendering [focus .. automate] produces a 700ms video; a subtitle track still timed off
  // the story would put its only caption 300ms before the file starts.
  const srt = toSRT(CUES, { total: TOTAL, startMs: 700, endMs: 1400 });
  assert.equal(srt, "1\n00:00:00,000 --> 00:00:00,700\nTwo manual steps sit between ingest and publish.\n");
  // A span that is entirely outside the range is dropped, not clamped to zero length.
  assert.equal(toSRT(CUES, { total: TOTAL, startMs: 0, endMs: 200 }), "");
  // A --to render spends no tail, so the media ends at --to and nothing runs past it.
  assert.equal(toSRT(CUES, { total: TOTAL, startMs: 700, endMs: 1400, mediaEnd: TOTAL }), srt);
});

test("toChapters: YouTube's format, and its rule that the list starts at 00:00", () => {
  assert.equal(toChapters(CUES, { total: TOTAL }), "00:00 intro\n00:00 focus\n00:01 automate\n");
  // A range render starts at its own --from: the labels inside it rebase onto the file, and
  // the first one is pinned to 00:00 (YouTube drops the whole list otherwise).
  // (`automate` rebases to 700ms, which floors to 00:00 — this fixture is a 2.9s story;
  // real chapter lists are minutes apart.)
  assert.equal(toChapters(CUES, { total: TOTAL, startMs: 700, endMs: 2900 }), "00:00 focus\n00:00 automate\n");
  assert.equal(toChapters([], { total: TOTAL }), "");
});

test("toJSON: g.cues() verbatim on the story's clock, plus the render metadata", () => {
  const parsed = JSON.parse(toJSON(CUES, { fps: 30, width: 1920, height: 1080, total: TOTAL, range: null }));
  assert.deepEqual(parsed.cues, CUES); // verbatim — absolute story ms, index and all
  assert.deepEqual([parsed.fps, parsed.width, parsed.height, parsed.total], [30, 1920, 1080, TOTAL]);
  assert.equal(parsed.range, null);
});

test("formatCues: the extension picks the format, and an unknown one is refused", () => {
  const meta = { total: TOTAL };
  assert.equal(formatCues("out/cues.json", CUES, meta).kind, "json");
  assert.equal(formatCues("out/cues.SRT", CUES, meta).kind, "srt");
  assert.equal(formatCues("out/chapters.txt", CUES, meta).kind, "chapters");
  assert.throws(() => formatCues("cues.vtt", CUES, meta), /needs a known extension/);
  assert.throws(() => formatCues("cues", CUES, meta), /needs a known extension/);
  // `empty` is what the CLI warns on: the format is right, the story has nothing for it.
  assert.equal(formatCues("chapters.txt", [{ kind: "caption", at: 0, text: "hi" }], meta).empty, true);
  assert.equal(formatCues("cues.srt", CUES, meta).empty, false);
});
