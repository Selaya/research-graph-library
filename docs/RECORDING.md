# Recording a narrated story

How to write a director script — a storyboard that drives the camera, highlights, and
captions as well as the graph — how to play it, and how to render it to an mp4 (or a frame
sequence, a cue sheet, a chapter list) with `smv-record`, the deterministic frame-by-frame
renderer (§3). Screen-recording a live tab (§4) is still the fastest way to a rough take;
it is just not reproducible. §5 is the matching still image.

Design background: PLAN.md D12–D15 and §5.7; module contracts in INTERNALS.md (M4).

## 1. Writing a director script

A director script is an ordinary storyboard (PLAN §5.5): a serializable JSON op array.
M4 adds four ops and one field. Nothing here needs authored JS — the array is the whole
artifact, and `smv-pack --storyboard` ships it.

### The op reference

**`camera`** — move the viewport. One target object; resolution order, first match wins:

```json
{ "op": "camera", "args": [{ "node": "clean", "k": 1.8, "pad": 60, "ease": "cubic-in-out" }] }
{ "op": "camera", "args": [{ "nodes": ["a", "b"], "pad": 48 }] }
{ "op": "camera", "args": [{ "fit": true, "pad": 24 }] }
{ "op": "camera", "args": [{ "x": 120, "y": -40, "k": 1.25 }] }
{ "op": "camera", "args": [{ "by": { "dx": -200, "dy": 0 } }] }
{ "op": "camera", "args": [{ "zoom": 1.6 }] }
```

- `node` frames one node's box; `nodes` the union box; `fit:true` the whole graph.
  `pad` (default 24) pads the framing; `k` on a box target is an explicit scale instead.
- `x`/`y`/`k` is an absolute transform (screen px + scale).
- `zoom` (or a bare `k`) scales about the pane centre — "lean in on this", not on the
  world origin. `by:{dx,dy}` is a screen-px pan, applied after any zoom.
- `dur` (default 600) and `ease` (`linear | cubic-out | cubic-in-out | overshoot`,
  default `cubic-in-out`) go in the target object.
- Relative moves compose onto where the camera is *heading*, so two quick nudges add up
  instead of fighting; a new camera op cancels the in-flight one (D9), never queues.
- The first `camera` op in a script hands the viewport to the script (D13): auto-refit
  stops, the camera joins the per-step snapshots, and scrubbing restores your shots.

**`highlight`** — emphasis, replace-not-accumulate: one call IS the emphasis state, so
you never clear the previous one first.

```json
{ "op": "highlight", "args": [{ "nodes": ["a"], "edges": ["e1"], "variant": "focus", "dim": true }] }
{ "op": "clearHighlight" }
```

`variant ∈ focus | warn | ok | mute` (theme colors via `--smv-emph`). `dim: true` turns
it into a spotlight: everything else drops to 28% opacity. Highlights survive relayouts,
expands and backward scrubs — they are state, not a flash.

**`caption`** — one narration overlay (`role="status"`, bottom-centred).

```json
{ "op": "caption", "args": ["Three manual steps become one automated one.", { "place": "bottom", "variant": "note" }] }
{ "op": "caption", "args": [null] }
```

`place: "top"` moves it up; `variant: "note"` mutes/italicizes. Mounting with
`captions: false` hides the overlay but keeps the text in the state and the cue sheet —
so you can burn subtitles in from `g.cues()` instead.

### Pacing: `dur` and `wait`

Every step may declare `dur` (ms). The declared timeline is the contract (D12): the
scrubber, `g.cues()` and the frame renderer all read the same numbers, so a step is
*worth* exactly what it declares. Without `dur`: labels/highlights/captions 0, `wait` its
ms, camera 600, condense/split 900, other mutations the mount's `animation.duration`
(350), a batch the longest of its own commit and its `wait`/`camera`/`condense`/`split`
children (a mutation child folds into the one shared relayout, so its own `dur` is ignored
— put the `dur` on the batch).

`dur` on a mutation step is ambient for the whole op — `{ "op": "expand", "args":
["clean"], "dur": 1200 }` slows that one relayout without touching anything else. Use
`wait` for beats where nothing moves but the narration needs air:

```json
{ "op": "caption", "args": ["Watch the fan-out."] },
{ "op": "wait", "ms": 1500 },
```

### Labels as chapters

A bare `{ "label": "automate" }` is a zero-duration position marker: the transport bar
shows the current label, `seek("automate")` jumps to it, and `g.cues()` emits it with its
absolute ms offset — which is exactly a chapter list. A typical scene:

```json
{ "label": "automate" },
{ "op": "camera", "args": [{ "nodes": ["clean.dedupe", "clean.validate", "clean.normalize"], "pad": 60 }] },
{ "op": "highlight", "args": [{ "nodes": ["clean.dedupe", "clean.validate", "clean.normalize"], "dim": true }] },
{ "op": "caption", "args": ["Three manual steps…"] },
{ "op": "wait", "ms": 1200 },
{ "op": "condense", "args": [["clean.dedupe", "clean.validate", "clean.normalize"],
                             { "id": "clean.auto", "data": { "duration": "8s" } }] },
{ "op": "caption", "args": ["…now one automated step."] },
```

`g.cues()` returns every label and caption as `{kind, at, label?/text?, index}` with `at`
in absolute story ms — feed it to a voice-over session, or let `smv-record --cues` write it
out as JSON, subtitles or a chapter list (§3.2).

(The fluent builder in `src/storyboard.js` — `timeline(g).camera({...}).wait(1200)
.caption("…").build()` — emits exactly this array, but the JSON is the primitive and the
only thing on the public export map; to put `dur` on a mutation step, author the JSON.)

## 2. Playing it

```js
const g = SparkleMotion.mount("#pipe", spec, {
  controls: true,        // transport bar: play/pause/step/scrub, current label
  autoplay: false,
  storyboard: steps,     // or g.storyboard(steps) after mount
});
```

Scrubbing works through everything: each step is snapshotted before it runs (G2), and
emphasis, the caption, and — once the script has a camera op — the viewport are part of
that snapshot, so a backward seek restores the shot, not just the graph. A forward scrub
replays camera/highlight/caption instantly (you asked for a position, not a screening).

For a self-contained file:

```
npx smv-pack spec.json -o story.html --storyboard sb.json --preset pipeline --title "Pipeline"
```

## 3. Rendering with `smv-record`

```
npm run build                       # dist/smv.iife.min.js is what gets packed
npx smv-record spec.json --storyboard sb.json --out story.mp4 \
    --fps 60 --width 1920 --height 1080 --scale 2 --theme dark --tail 1200
```

Out comes an h.264 mp4: every frame is piped straight into
`ffmpeg -f image2pipe -framerate <fps> -i - -c:v libx264 -pix_fmt yuv420p -crf 18`, so no
intermediate PNG sequence is ever written. `--png-dir frames/` writes that sequence instead
(`frames/frame-00000.png …`, at `width×height × scale` pixels), and is what to use on a
machine with no ffmpeg:

```
npx smv-record spec.json --storyboard sb.json --png-dir frames/
ffmpeg -framerate 60 -i frames/frame-%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 story.mp4
```

Both flags together record once and write both. Without ffmpeg (`$SMV_FFMPEG` overrides
which binary is used), `--out` exits 1 up front with that command line rather than
rendering a take it cannot encode.

### Flags

| flag | default | what it does |
|---|---|---|
| `<spec.json>` | required | the graph spec (same file `smv-pack` takes) |
| `--storyboard sb.json` | required | the director script — no story, nothing to record |
| `--out story.mp4` | — | pipe the frames into ffmpeg; one of `--out`/`--png-dir` is required |
| `--png-dir frames/` | — | PNG sequence; existing `frame-*.png` are cleared first so a shorter take never leaves a longer one's tail behind |
| `--fps N` | 60 | frames per second — one `tick(1000/fps)` each |
| `--width` / `--height` | 1920 / 1080 | browser viewport in CSS px; the mount root fills it |
| `--scale N` | 2 | `deviceScaleFactor` — PNG pixels are `width×scale` |
| `--theme dark\|light` | page default | passed into the pack (don't let the OS decide) |
| `--preset pipeline` | none | mount the preset |
| `--tail ms` | 1200 | held frames on the finished picture, after the story has settled |
| `--cues f.json\|f.srt\|f.txt` | — | write the cue sheet beside the video; the extension picks the format (§3.2) |
| `--from label` / `--to label` | — | render only that chapter range (§3.3) |
| `--font pinned.woff2` | — | pin the typeface so the layout is the same on every machine (§3.4) |

Needs `dist/smv.iife.min.js` (`npm run build`) and the dev-installed `playwright-core`;
any bad input — a missing encoder, an unknown `--cues` extension, a `--font` that is not
there or is not a font, a `--from` label the storyboard does not have — exits 1 with
`smv-record: <reason>` before a browser is launched.

**Interrupting a take.** Ctrl+C at any point removes the partial `--out` file and exits
130: a half story that opens and plays is worse than no file, so there is never a truncated
mp4 to mistake for a finished one. A `--png-dir` sequence is left alone — every frame in it
is a complete PNG — so that is the take you can salvage. The cue sheet is written before the
frame loop, so an interrupted take still leaves a usable one.

### 3.2 Cue sheets: `--cues`

One flag, three formats, chosen by the extension so the filename cannot lie about the
contents:

| extension | what you get |
|---|---|
| `.json` | `g.cues()` **verbatim** (absolute story ms, `index` and all) plus the render metadata: `fps`, `width`, `height`, `scale`, `total`, and `range` when the take was sliced |
| `.srt` | the captions as subtitles — each runs until the next caption, a `caption(null)` clear, or the end of **the media** (the story plus the held `--tail`, since the last caption is on screen for all of it), timed `HH:MM:SS,mmm` |
| `.txt` | a YouTube chapter list off the labels — `00:00 intro`, one per line |

The two text formats annotate **the media file that was just written**: under `--from/--to`
they are clipped to the rendered range and rebased onto its start (and the first chapter is
pinned to `00:00`, which YouTube requires or it drops the list). The `.json` stays on the
story's own clock and hands you `range` to rebase with. The sheet is written before the
frame loop, so interrupting a long take still leaves a usable one.

**Worked example.** The e2e fixture story — labels `intro` at 0ms, `focus` at 700ms,
`automate` at 1400ms; captions at 300ms and 2300ms; declared total 2900ms — rendered with
`--tail 200 --cues story.srt` gives one span per caption, each running to whatever replaces
it and the last one to the end of the file:

```
1
00:00:00,300 --> 00:00:02,300
Two manual steps sit between ingest and publish.

2
00:00:02,300 --> 00:00:03,100
…now one automated step.
```

(That last span is the story's 2900ms plus the 200ms of tail — an end-card caption written
as the *last* storyboard step sits at exactly `total`, and on the story's clock alone its
span would be zero-length and vanish from a file that shows it for the whole tail.)

and with `--cues chapters.txt` one line per label (seconds floor — a chapter mark is a
seek target, so `0.7s` must not round up past the moment it names):

```
00:00 intro
00:00 focus
00:01 automate
```

**The voice-over workflow.** Render once with `--cues`, then record the narration *against
the sheet*, not against the video: each `.srt` span is a line to read and its timestamps
say when it must land; each chapter is a beat. The timing is trustworthy before a single
frame exists — the sheet is a function of the declared timeline (D12), so you can cut VO
while a long take is still rendering. Mux the finished track under the video
(`ffmpeg -i story.mp4 -i vo.wav -c:v copy -c:a aac -shortest story-vo.mp4`), and where the
read will not fit a beat, give the storyboard air with `wait` steps and re-render — the
cue sheet moves with it. (Stretching `wait`s to a recorded VO's timestamps automatically is
M4d's `smv-fit`.)

### 3.3 Re-rendering one chapter: `--from` / `--to`

```
npx smv-record spec.json --storyboard sb.json --out automate.mp4 --from automate --to outro
```

Labels are resolved to absolute ms through the same cue sheet everything else reads (D12),
then to frame indices: capture starts on the first frame at or past `--from` and ends on
the first frame at or past `--to` (that boundary frame is included — it is the frame that
shows the labelled moment). `--from` alone runs to the end of the story and still spends
the tail; with a `--to` there is no tail, because the story is not finished there.

The story itself is *not* seeked or restarted — the take plays from step 0 exactly as a
full render does, ticks at exactly the same cadence, and simply does not keep the frames
before the range. That is what makes a slice **byte-identical** to the matching frames of
the full render, so a re-rendered chapter intercuts with the original. (A forward seek
would not: it replays camera/highlight/caption ops instantly and skips the tweens they were
supposed to leave behind, so the first frame would be a state the story never held.) It
costs the same *story* time as a full render to the end of the range; what it saves is the
frames, the encode and the re-cut.

### 3.4 Pinning the font: `--font`

```
npx smv-record spec.json --storyboard sb.json --out story.mp4 --font Inter.woff2
```

Two machines render the same script differently for exactly one reason: fonts. Node boxes
are sized from text metrics (`src/measure.js` measures against
`500 13px system-ui, …`), and `system-ui` is whatever the recording machine calls its UI
font — so the *layout*, not just the glyphs, moves. `--font` copies a `.woff2`/`.woff`/
`.ttf`/`.otf` next to the served page, injects an `@font-face` plus a `font-family`
override, and waits for the face before the mount measures anything.

The pin is *verified*, twice: the file's first four bytes have to agree with its extension
(an unfetched git-lfs pointer and a WOFF2 renamed `.ttf` are the two everyday accidents, and
both are refused before a browser launches), and once the page is up the face itself has to
have decoded. A face that fails silently is worse than no `--font` at all — the take would
finish at exit 0 with the layout measured in the machine's default font, which is exactly
the machine dependence the flag exists to remove.

It pins **both** pipelines. CSS can only pin what is drawn: a generic family keyword like
`system-ui` cannot be redefined by `@font-face`, so the record page also swaps the family
on canvas font assignments, which is what `measureText` — and therefore every node box —
answers to. On this machine, pinning Liberation Serif moved the fixture's node widths from
41/47/49/45px to 36/41/43/41px: that difference is the whole point.

**Picking fps and scale.** The output timing is exact at any fps — the declared timeline
is divided, not sampled (a take runs a frame or so long per async step boundary; see
below) — so fps only buys smoothness and costs frames: draft at
`--fps 12 --scale 1` (a 3s story is ~40 small PNGs, seconds to render), ship at 30 or
60. `--scale 2` is the crisp choice for text at 1080p and the right one if the video
will be shown on high-DPI screens; it quadruples the pixels per frame. Expect roughly
2–3 minutes of wall time per minute of story at 1080p60 (the screenshot dominates —
frames × capture cost, so halving fps roughly halves the render).

**Why it is reproducible.** The renderer packs the page with `smv-pack --record` (D15):
the mount gets `ticker:"manual"`, so the one shared clock (D1) only moves when the CLI
says so; `motion:"full"`, so the recording machine's reduced-motion setting cannot shrink
the story; and `data-smv-record` on the root, which kills every CSS transition — the one
piece of wall-clock animation the library otherwise leaves to the browser. Then:

- the story is **not** autoplayed — the CLI starts it after `document.fonts.ready` (text
  metrics decide node boxes) and after `viewport.setInteractive(false)`, so frame 0 is the
  same frame every time;
- the declared timeline (D12) is the floor: the take is at least
  `ceil(g.timeline().total / (1000/fps))` frames, and it keeps going — still tick by tick,
  never by the clock — until the storyboard reports the story finished, because each async
  phase boundary can only resolve on the first tick at or past its duration (so an N-step
  story can run up to N frames long). A runaway script is cut 2s past the declared total,
  with a warning. Only then does `--tail` spend `ceil(tail / (1000/fps))` held frames on
  the finished picture — so `--tail 0` still ends on the settled final state;
- each frame is exactly one `ticker.tick(1000/fps)`, then a settle (step boundaries land
  on promise chains, so a macrotask turn drains them; the loop polls until the page stops
  changing), then one screenshot clipped to the mount root;
- a frame *outside* a `--from/--to` range is still ticked, settled and given a compositor
  frame (one `requestAnimationFrame` round-trip) — it just is not shot. The rAF is not
  ceremony: a screenshot forces a paint, so skipping seven of them left the rasterizer in
  a different place and the next capture came back a hair different (~92dB PSNR, a few
  antialiased pixels on a camera-tween frame) from the same frame of a full render.

Two runs on one machine are byte-identical — that is what `node test/e2e-m4.mjs` asserts,
frame for frame, for a full take, a sliced one and a `--font` one. Across machines, fonts
are the variable: pin one with `--font` (§3.4).

**Refused by design:** a storyboard driving `g.run({ mode: "live" })`. A live run replays a
real event log against real time — wall-clock, unreproducible — so Mode B is not
recordable; record a Mode A (`simulate`) story instead. The CLI checks the `run.play`
steps' own options (batches included) before it launches a browser and exits nonzero; a
node or edge whose `data` happens to say `{"mode": "live"}` is your payload, not a run, and
is left alone.

A Mode A `{"op": "run.play"}` step records fine, and is sized from the compiled run rather
than from the mutation default — the renderer materializes the run transport before it
measures the timeline, which is also why frame 0 already carries the token layer.

## 4. Recording a live tab with OBS

When a rough take is enough — a quick demo, no CI, no re-render — screen-record the live
page. The result is real-time, not frame-perfect.

1. **Fixed-size container** — give the mount div the exact output size, and hide the
   chrome you don't want on camera:

   ```html
   <div id="stage" style="width:1920px;height:1080px"></div>
   <script>
     const g = SparkleMotion.mount("#stage", spec, {
       controls: false,        // no transport bar in the shot
       autoplay: true,         // the story starts itself
       storyboard: steps,
       theme: "dark",          // pick one — don't let the OS decide mid-take
     });
   </script>
   ```

2. **Region capture** — OBS (or any screen recorder): capture the browser window and
   crop to the `#stage` box (OBS: Window Capture → alt-drag the edges, or a Crop/Pad
   filter). Match the canvas to 1920×1080 so nothing rescales.

3. **Quiet the environment** — full-screen the tab (F11), hide the cursor from the
   region, close notification sources, and don't touch the page: pan/zoom would fight
   the script's camera. (`smv-record` calls `viewport.setInteractive(false)` for exactly
   this reason; you are the interlock in the OBS recipe.)

4. **Roll** — start recording, reload the page (autoplay runs the story from step 0),
   stop after the last step plus a beat. Trim the ends in the editor. `g.cues()` printed
   to the console gives you the ms offsets for syncing a voice-over.

If your OS has reduced motion enabled, mount with `motion: "full"` (D15) — a recording's
audience is the video's viewers, not the recording machine's accessibility settings.

## 5. A still that matches the shot

`exportSVG` normally produces the *whole graph*: it drops the pan/zoom transform, re-frames
to a bounds-sized `viewBox` and un-hides everything viewport culling had hidden. That is
the right document for "export this diagram", and the wrong one for "grab the frame I am
looking at".

```js
import { exportSVG } from "sparkle-motion-vizualizer/export";
const still = exportSVG(g, { viewport: true });   // the shot: same framing as the video
```

`viewport: true` keeps the live `.smv-viewport` transform *and* the live culling state, and
sizes the `viewBox` to the pane — a deliberate inversion of both defaults (`pad` is ignored;
the transform is the framing, and the culled elements are by definition outside it). Pair it
with a `camera` op to publish a thumbnail of a beat in the story without re-recording it.

## 6. What M4d adds

`bin/smv-fit.mjs` — a pure JSON→JSON transform that stretches the `wait` steps between
labels so each label lands on a voice-over timestamp — and per-step `props` custom-property
overrides.
