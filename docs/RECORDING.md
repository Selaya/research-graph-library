# Recording a narrated story

How to write a director script — a storyboard that drives the camera, highlights, and
captions as well as the graph — how to play it, and how to render it to frames with
`smv-record`, the deterministic frame-by-frame renderer (§3). Screen-recording a live tab
(§4) is still the fastest way to a rough take; it is just not reproducible.

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
in absolute story ms — feed it to a voice-over session or an `.srt` generator; M4c adds
`--cues` formatting to the CLI.

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

## 3. Rendering frames with `smv-record`

```
npm run build                       # dist/smv.iife.min.js is what gets packed
npx smv-record spec.json --storyboard sb.json --png-dir frames/ \
    --fps 60 --width 1920 --height 1080 --scale 2 --theme dark --tail 1200
```

Out comes `frames/frame-00000.png …`, one per frame, at `width×height × scale` pixels.
Encode them however you like:

```
ffmpeg -framerate 60 -i frames/frame-%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 story.mp4
```

(`--out story.mp4` is reserved for M4c's built-in pipe. On its own it exits with that
ffmpeg line; passed *alongside* `--png-dir` it records the frames and prints the line
afterwards, filled in with your directory.)

### Flags

| flag | default | what it does |
|---|---|---|
| `<spec.json>` | required | the graph spec (same file `smv-pack` takes) |
| `--storyboard sb.json` | required | the director script — no story, nothing to record |
| `--png-dir frames/` | required | output directory; existing `frame-*.png` are cleared first so a shorter take never leaves a longer one's tail behind |
| `--fps N` | 60 | frames per second — one `tick(1000/fps)` each |
| `--width` / `--height` | 1920 / 1080 | browser viewport in CSS px; the mount root fills it |
| `--scale N` | 2 | `deviceScaleFactor` — PNG pixels are `width×scale` |
| `--theme dark\|light` | page default | passed into the pack (don't let the OS decide) |
| `--preset pipeline` | none | mount the preset |
| `--tail ms` | 1200 | held frames on the finished picture, after the story has settled |
| `--out story.mp4` | — | M4c; without `--png-dir` it exits with the ffmpeg line to run yourself, with it the frames are recorded and the line is printed after |

Needs `dist/smv.iife.min.js` (`npm run build`) and the dev-installed `playwright-core`;
any bad input exits 1 with `smv-record: <reason>` before a browser is launched.

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
  changing), then one screenshot clipped to the mount root.

Two runs on one machine are byte-identical — that is what `node test/e2e-m4.mjs` asserts,
frame for frame. Across machines, fonts are the variable: pin one (M4c adds `--font`).

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

## 5. What M4c adds

The ffmpeg pipe behind `--out story.mp4` (so no PNG directory is needed), `--cues
cues.srt|cues.json|chapters.txt` off `g.cues()`, `--from/--to` label-range re-renders, a
`--font` flag that serves a WOFF2 and injects an `@font-face` for cross-machine layout
stability, and `exportSVG(g, {viewport:true})` for a still that matches the live shot.
