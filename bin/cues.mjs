// Cue-sheet formatting for smv-record --cues (M4c). Pure string assembly over the array
// `g.cues()` returns — `[{kind:"label"|"caption", at, label?, text?, index}]`, `at` in
// absolute story ms off the declared timeline (D12).
//
// This lives in bin/ on purpose: a subtitle serializer is a publishing concern, not a
// rendering one, and the library carries a hard <50KB gzip budget it would pay for nothing.
// Nothing here imports from src/.
//
// The three formats answer to two different clocks, which is the one subtlety:
//   - .json is the STORY's clock — `g.cues()` verbatim, plus the render metadata (fps,
//     dimensions, declared total, and the rendered range when --from/--to sliced it), so a
//     voice-over tool can rebase however it likes.
//   - .srt and chapters .txt annotate the MEDIA FILE that was just written, so they are
//     clipped to the rendered range and rebased onto its start — a subtitle track whose
//     timestamps do not match the video it sits next to is worse than no subtitle track.
//     That file is longer than the story: `--tail` holds the settled final picture for a
//     beat, and the caption that was up is up for all of it. So the media clock ends at
//     `mediaEnd` (total + tail), which is what closes the last open span — otherwise a
//     caption issued as the story's LAST step gets a zero-length span at `total` and is
//     dropped from the subtitles while being burned into every tail frame.

const pad = (n, w) => String(Math.floor(n)).padStart(w, "0");

/** SRT wants HH:MM:SS,mmm — comma, not the WebVTT dot, and hours are not optional. */
export function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  return `${pad(t / 3600000, 2)}:${pad((t / 60000) % 60, 2)}:${pad((t / 1000) % 60, 2)},${pad(t % 1000, 3)}`;
}

/** YouTube chapter timestamps: MM:SS, growing an hours field only once there are hours.
 *  Seconds FLOOR rather than round: a chapter timestamp is a seek target, and rounding
 *  0.7s up to 00:01 would land the viewer after the moment the mark names. */
export function chapterTime(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const mm = pad((t / 60) % 60, 2), ss = pad(t % 60, 2);
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Captions are point events in the cue sheet but spans on screen: the overlay holds the
 *  last text until something replaces it, `caption(null)` clears it, and the end of the
 *  clock the caller passes ends it — the story's `total` for the story's own clock, the
 *  media's `total + tail` for a subtitle track. `end` is exclusive-ish (the next caption's
 *  `start`), which is exactly what a subtitle renderer wants. */
export function captionSpans(cues, storyEnd) {
  const spans = [];
  for (const c of cues || []) {
    if (c.kind !== "caption") continue;
    const open = spans.length ? spans[spans.length - 1] : null;
    if (open && open.end == null) open.end = c.at;
    if (c.text != null && String(c.text) !== "") spans.push({ start: c.at, end: null, text: String(c.text) });
  }
  const last = spans[spans.length - 1];
  if (last && last.end == null) last.end = storyEnd;
  return spans;
}

/** Clip a [start,end) span to the rendered range and rebase it onto the range's start.
 *  Returns null when nothing of it survives — including the zero-length case, a caption
 *  replaced in the same frame it appeared. */
function clip(span, from, to) {
  const start = Math.max(span.start, from);
  const end = Math.min(span.end == null ? to : span.end, to);
  if (!(end > start)) return null;
  return { ...span, start: start - from, end: end - from };
}

export function toSRT(cues, { total = 0, startMs = 0, endMs = null, mediaEnd = null } = {}) {
  // The media runs past the story by the held tail; `mediaEnd` is where it actually ends.
  // Never shorter than `total` — a caller that omits it gets the story clock it used to.
  const media = mediaEnd == null ? total : Math.max(total, mediaEnd);
  const to = endMs == null ? media : endMs;
  const out = [];
  for (const span of captionSpans(cues, media)) {
    const s = clip(span, startMs, to);
    if (!s) continue;
    out.push(`${out.length + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`);
  }
  return out.join("\n");
}

export function toChapters(cues, { total = 0, startMs = 0, endMs = null } = {}) {
  const to = endMs == null ? total : endMs;
  const marks = (cues || [])
    .filter((c) => c.kind === "label" && c.label != null && c.at >= startMs && c.at <= to)
    .map((c) => ({ at: c.at - startMs, label: String(c.label) }));
  // YouTube drops the whole chapter list unless the first timestamp is 00:00, so the first
  // mark is pinned there. Nothing is being misdated: a range render starts at its own
  // `--from`, and a story whose first label sits a beat after t=0 has nothing before it.
  if (marks.length) marks[0].at = 0;
  return marks.map((m) => `${chapterTime(m.at)} ${m.label}`).join("\n") + (marks.length ? "\n" : "");
}

export function toJSON(cues, meta = {}) {
  // `cues` verbatim, on the story's own clock — `range` is what a consumer rebases with.
  // The fields are named rather than spread so the clipping numbers the other two formats
  // need (startMs/endMs) do not leak into the document as a second, confusing spelling of
  // `range`, and so the key order is stable across renders.
  const { fps, width, height, scale, total, range = null } = meta;
  return JSON.stringify({ fps, width, height, scale, total, range, cues: cues || [] }, null, 2) + "\n";
}

/** The extension picks the format; there is no --cue-format flag to get out of step with
 *  the filename. Returns `{text, kind, empty}` so the caller can warn about a sheet with
 *  nothing in it (a .srt for a story with no captions) without inspecting the string. */
export function formatCues(path, cues, meta = {}) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(path));
  switch (ext && ext[1].toLowerCase()) {
    case "json": return { kind: "json", text: toJSON(cues, meta), empty: !(cues || []).length };
    case "srt": {
      const text = toSRT(cues, meta);
      return { kind: "srt", text, empty: !text };
    }
    case "txt": {
      const text = toChapters(cues, meta);
      return { kind: "chapters", text, empty: !text };
    }
    default:
      throw new Error(
        `--cues "${path}" needs a known extension: .json (the cue sheet + render metadata), ` +
        ".srt (captions as subtitles) or .txt (YouTube chapters from the labels)"
      );
  }
}
