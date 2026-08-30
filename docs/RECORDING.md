# Recording a narrated story

How to write a director script — a storyboard that drives the camera, highlights, and
captions as well as the graph — how to play it, and how to capture it as video **today**
with a screen recorder. The deterministic frame-by-frame renderer (`smv-record`, byte-
identical PNGs piped to ffmpeg) is M4b; until it lands, OBS-over-a-live-tab is the recipe.

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
(350), a batch the max of its members.

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

## 3. Recording with OBS today

Until `smv-record` lands (M4b), screen-record a live tab. The result is real-time, not
frame-perfect — fine for a demo, not for byte-identical CI renders.

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
   the script's camera. (The M4b renderer calls `viewport.setInteractive(false)` for
   exactly this reason; you are the interlock in the OBS recipe.)

4. **Roll** — start recording, reload the page (autoplay runs the story from step 0),
   stop after the last step plus a beat. Trim the ends in the editor. `g.cues()` printed
   to the console gives you the ms offsets for syncing a voice-over.

If your OS has reduced motion enabled, mount with `motion: "full"` (D15) — a recording's
audience is the video's viewers, not the recording machine's accessibility settings.

## 4. What M4b changes

`smv-record <spec.json> --storyboard sb.json --out story.mp4` will drive a manual ticker
(`opts.ticker: "manual"`) frame by frame in headless Chromium and screenshot each one —
deterministic output, byte-identical across runs, no wall clock anywhere
(`data-smv-record` kills every CSS transition; the declared timeline says exactly how
many frames each step is worth). The mount plumbing for all of that already ships.

One thing it will refuse by design: storyboards driving `g.run({ mode: "live" })`. A live
run replays a real event log against real time — wall-clock, unreproducible — so Mode B
runs are not recordable; record a Mode A (`simulate`) story instead.
