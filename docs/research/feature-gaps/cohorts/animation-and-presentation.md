# Cohort survey: animation-and-presentation
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** Motion Canvas, Manim (graph mobjects), Remotion, GSAP/Flip plugin, anime.js, Excalidraw & tldraw (hand-drawn diagrams, collaboration, frames, laser pointer, presentation mode), reveal.js/Slidev auto-animate, Figma Smart Animate, Loom/Screen Studio recording — what narrative/explainer/recording tooling offers

**Verification tally:** 20 claimed gaps: 14 missing, 5 partial, 1 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| Motion Canvas | unknown (actively developed, pre-1.0 in parts) | MIT | https://motioncanvas.io | yes | TypeScript generator-function based programmatic animation/video engine with a scrubbable timeline editor, signals, and a flow module (waitFor/waitUntil/loop/chain). |
| Manim Community | v0.20.x / v0.21.0 docs current | MIT | https://docs.manim.community | yes | Python engine for precise programmatic math/graph animations; Graph/DiGraph mobjects with pluggable layout algorithms (spring, circular, kamada_kawai, planar, tree, partite, shell, spectral, spiral). |
| Remotion | v4.x | Remotion License (source-available, paid for companies over revenue threshold; free for individuals/small teams) | https://www.remotion.dev | yes | React-based programmatic video generation; Composition/Sequence/Series primitives, useCurrentFrame(), a scrubbable preview timeline, and server-side rendering to mp4. |
| GSAP / Flip plugin | GSAP 3.x | Free (GSAP standard + Flip plugin were made free as of GSAP 3.9 core; Webflow now owns GSAP and it is free for all use) | https://gsap.com/docs/v3/Plugins/Flip/ | yes | General animation engine; Flip plugin captures First/Last DOM states and animates the Invert/Play offsets automatically, including layout reflows GSAP itself didn't cause. |
| anime.js | v4.x | MIT | https://animejs.com | yes | Lightweight JS animation engine with a timeline object, stagger() utility (time/value/timeline staggering with from:first/last/center/random), and SVG line-drawing/morphing helpers. |
| Excalidraw | unknown exact npm version | MIT (editor); excalidraw.com hosted app has some proprietary Plus features | https://excalidraw.com | yes | Hand-drawn-style whiteboard; React component + API, real-time multiplayer collaboration via Socket.IO relay, and a dedicated laser-pointer tool/library (@excalidraw/laser-pointer) enabled by default for the presenter during presentations. |
| tldraw | v4.4.0 (per release notes found) | tldraw SDK license (free for most non-commercial/small use; commercial license required above revenue threshold; watermark otherwise) | https://tldraw.dev | yes | Infinite-canvas whiteboard SDK; frames (group/clip elements, nameable, exportable as thumbnails), a redesigned telestrator-style laser pointer with a general-purpose scribbles API (editor.scribbles.startSession), multiplayer sync, and an actions/tools API. |
| reveal.js | v5.x (auto-animate docs current) | MIT | https://revealjs.com/auto-animate/ | yes | HTML slide framework; Auto-Animate matches elements by data-id across adjacent slides and interpolates position/size/color/opacity/etc. automatically, with autoAnimateEasing/Duration/Unmatched config and data-auto-animate-id to scope matching groups. |
| Slidev | unknown exact | MIT | https://sli.dev | no | Vue/Markdown-based dev-oriented slide deck tool built on reveal-style concepts; supports v-motion/auto-animate transitions between slide states, click-based fragment reveals, and a presenter/recording mode. |
| Figma (Smart Animate) | n/a | proprietary/commercial SaaS | https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames | yes | Prototyping feature that auto-matches layers by name/type/hierarchy across frames and interpolates position/size/rotation/fill/opacity between them, with per-transition easing and duration; does not morph shapes or animate text content changes. |
| Loom | n/a | proprietary/commercial SaaS | https://loom.com | no | Screen/webcam recording with async video messaging: auto-generated chapters/transcript, click-to-cut silence trimming, viewer engagement analytics (view counts, drop-off), comments/reactions on the timeline. |
| Screen Studio | n/a | proprietary, one-time purchase ($89), macOS-only | https://screen.studio | yes | Screen recorder that captures cursor/click/scroll telemetry and renders a virtual camera in post: automatic zoom-and-pan keyed to clicks/typing/idle, cursor-motion smoothing, and a timeline UI for manual zoom-block edits. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Auto-matched cross-state morph/tween by identity (FLIP / Smart Animate / Auto-Animate pattern)

- **Category:** animation · **Fit:** 2/5 · **Verified in repo:** `present`
- **Who has it:** GSAP Flip; Figma Smart Animate; reveal.js Auto-Animate; Motion Canvas
- **What they offer:** Capture the 'before' geometry (position/size/color/opacity/rotation) of elements matched by a stable key, apply the 'after' state, then animate the delta automatically — GSAP's Flip.getState()/Flip.from(), Figma's layer-name matching, reveal.js's data-auto-animate/data-id matching.
- **Why it matters here:** sparkle-motion-visualizer already does its own diff-based enter/update/exit + FLIP internally for graph mutations, but exposes no general-purpose 'flip any two states' primitive a consumer could reuse outside the graph mutation path — e.g. animating a caption card or an external DOM element alongside the graph using the same FLIP machinery the library already built.
- **How it could fit:** Could expose the internal FLIP helper as a small public utility (e.g. sparkle-motion-visualizer/flip: captureState(els)/animateFromState(state, opts)) reusing the existing ticker, for consumer-authored decoration.
- **Survey evidence:** https://gsap.com/docs/v3/Plugins/Flip/ ; https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames ; https://revealjs.com/auto-animate/ (verified)
- **Repo check:** README.md:85 'the library diffs old vs. new state and generates the transition (keyed enter/update/exit + FLIP); you never hand-author animations.' Implementation referenced throughout src/engine.js and src/viewport.js:4 ('the FLIP tween'). Nodes are matched by stable id (the graph node id), before/after geometry captured and animated automatically — this is the library's core mechanism, not a peripheral feature.
- **Verifier note:** Matching key is the node id (fixed schema), not an arbitrary layer-name/attribute matcher like Figma's.
- *Verifier's phrasing of the claim:* Auto-matched cross-state morph/tween by identity (FLIP)

### 2. Pluggable/multiple layout algorithm families (force-directed, radial, circular, tree, spectral, kamada_kawai, shell, spiral, partite)

- **Category:** layout · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** Manim Graph/DiGraph
- **What they offer:** Manim's Graph mobject ships layout='spring'|'circular'|'kamada_kawai'|'planar'|'random'|'shell'|'spectral'|'spiral'|'tree'|'partite' as a simple string switch, selectable per graph instantiation.
- **Why it matters here:** This library is explicitly layered/Sugiyama-only; a pipeline library increasingly used for non-DAG/organic relationship diagrams (e.g. showing a dependency web, not just a left-to-right pipeline) has no radial/force option, and the dagre adapter doesn't add algorithm diversity either (dagre is also layered-only).
- **How it could fit:** Could fit the existing pluggable LayoutSolver seam — an additional adapter package (e.g. adapters/force or adapters/radial) rather than core engine work, consistent with how the dagre adapter is shipped.
- **Survey evidence:** https://docs.manim.community/en/stable/reference/manim.mobject.graph.Graph.html (verified)
- **Repo check:** types/index.d.ts:236-243 LayoutOpts only exposes dir (LR/TB/RL/BT) and a pluggable `solver` function (LayoutSolver), defaulting to an in-house layered/dagre-style engine (src/layout.js, types/adapters-dagre.d.ts). There is no built-in string switch for force/radial/circular/tree/spectral/kamada_kawai/shell/spiral/partite — a caller would have to author their own SolverInput->SolverResult function from scratch.
- **Verifier note:** Architecturally pluggable (like Manim's layout seam) but ships only one layered-DAG family out of the box; none of Manim's named alternatives exist as presets.

### 3. Generator/keyframe-based imperative animation scripting language with time controls (waitFor/waitUntil/loop/chain/all/sequence)

- **Category:** animation/storyboard · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** Motion Canvas
- **What they offer:** Motion Canvas scenes are authored as JS/TS generator functions using yield* with flow-control helpers: waitFor(seconds), waitUntil(namedEvent), loop(), chain(), all() (parallel) and sequence(), plus a scrubbable timeline UI showing named time-events as editable markers.
- **Why it matters here:** sparkle-motion-visualizer's storyboard is a flat JSON op array with per-step `dur` and label markers — it lacks a parallel-composition primitive (run N animations concurrently as one logical step) and named/editable time-event markers surfaced in a UI the way Motion Canvas's timeline shows waitUntil markers as draggable handles.
- **How it could fit:** A `parallel: [...]` step wrapping child ops (distinct from `batch`, which is about graph-mutation commit-coalescing, not storyboard-level concurrent op execution) would close this; already has label markers, could add named waitUntil-style anchors independent of camera/caption ops.
- **Survey evidence:** https://motioncanvas.io/docs/time-events/ ; https://motioncanvas.io/api/core/flow/ (verified)
- **Repo check:** src/storyboard.js implements a pure JSON-op sequencer with a fluent builder (wait(ms) at line 227, run.play/run.step/run.seek, batch for parallel steps, camera/highlight/caption/props ops) and named 'wait' positions seekable via labels() (comment at line 63). But it is JSON-op based, not a JS/TS generator-function DSL with yield*; there is no waitUntil(namedEvent), no chain()/all()/sequence() combinators, and no scrubbable timeline UI with editable markers.
- **Verifier note:** Comparable intent (declarative timeline you can seek/scrub) but a different, more limited authoring model than Motion Canvas generators.

### 4. Server/headless-independent programmatic React video rendering with parametrized renders and a Studio scrub-preview separate from final render

- **Category:** recording/export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Remotion
- **What they offer:** Remotion renders videos by evaluating a React tree per-frame via <Composition>/<Sequence>, offering renderMedia() as a Node API (no browser automation needed at render time beyond a bundled headless Chrome it manages itself), parametrizable per-render props (inputProps), and a still-frame renderStill() for thumbnails.
- **Why it matters here:** smv-record already does deterministic headless-Chromium + ffmpeg recording, which covers most of this, but Remotion additionally supports rendering a single parametrized frame/still directly from arbitrary props without staging a full storyboard scrub, and renders can run on distributed/cloud infra (Remotion Lambda) — worth noting as a scaling path smv-record doesn't offer.
- **How it could fit:** Out of scope for a small library, but a lightweight 'renderStill(spec, storyboard, atMs)' CLI mode (single PNG at an arbitrary timestamp, not just --from/--to chapter boundaries) would be a cheap partial win.
- **Survey evidence:** https://www.remotion.dev/docs/composition/ ; https://www.remotion.dev/docs/the-fundamentals (verified)
- **Repo check:** Searched for React/JSX usage across src/, docs/RECORDING.md, and package.json — none found; the library is vanilla JS/SVG with no framework dependency (README.md: 'no framework'). docs/RECORDING.md and test/record-cli.test.js describe a `smv-record` CLI that drives a real headless Chromium via a findChromium() helper (per docs/USABILITY-EVAL.md:529) to capture frames — the opposite of Remotion's 'evaluate a React tree per frame, no browser automation' model. No renderMedia()/renderStill() Node API or React <Composition>/<Sequence> primitives exist.
- *Verifier's phrasing of the claim:* Server/headless-independent programmatic React video rendering (Remotion-style)

### 5. Stagger utility for offsetting many elements' animation start times by pattern (index, distance-from-point, first/last/center/random)

- **Category:** animation · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** anime.js; GSAP
- **What they offer:** anime.js's stagger() computes a per-target delay from parameters like from:'center'|'first'|'last'|index, grid position, or a value range, pluggable anywhere a timing value is accepted, including inside a Timeline's position argument.
- **Why it matters here:** sparkle-motion-visualizer's expandAll()/collapseAll() explicitly fires 'every container' as ONE shared transition — there's no way to cascade a ripple/stagger effect across many nodes (e.g. tokens lighting up in sequence, or a wave of container expansions) which is a common explainer-video beat.
- **How it could fit:** Could add a `stagger` option to expandAll/collapseAll/batch and to storyboard highlight ops: {stagger: {each: 30, from:'first'|'center'|nodeId}}.
- **Survey evidence:** https://animejs.com/documentation/utilities/stagger/ (verified)
- **Repo check:** grep -rni 'stagger' src/*.js docs/*.md README.md returned only an unrelated prose use in docs/PLAN.md:596 ('a ~12ms stagger' describing internal condense choreography, not an exposed API). No stagger()-style utility function or timing-value helper (from:'center'|'first'|'last', grid, index) is exported in types/index.d.ts or src/.
- **Verifier note:** Batch/condense/split operations do have internal micro-staggering baked into specific choreographies, but nothing generic or user-controllable is exposed.
- *Verifier's phrasing of the claim:* Stagger utility for offsetting many elements' animation start times by pattern

### 6. Real-time multiplayer collaboration (shared cursors, shared canvas state, presence)

- **Category:** collaboration · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Excalidraw; tldraw
- **What they offer:** Both ship real-time multi-user editing: Excalidraw via a Socket.IO relay server broadcasting scene deltas and pointer/laser positions; tldraw via its sync engine with presence, shared undo history, and live cursors.
- **Why it matters here:** Not really this library's remit (it's a rendering/playback library, not an authoring/editing tool), but worth flagging since 'collaboration' was named in the cohort brief explicitly.
- **How it could fit:** Out of scope — sparkle-motion-visualizer has no authoring UI or shared mutable document model to synchronize.
- **Survey evidence:** https://www.npmjs.com/package/@excalidraw/laser-pointer ; tldraw sync docs (from memory) (verified)
- **Repo check:** No socket/websocket/sync/presence code found in src/ (grep for 'socket|presence|multiplayer|collab' across src/*.js and docs/*.md returns nothing); docs/PLAN.md:32 explicitly lists 'graph editing UI (drag-to-connect)' as out of scope, and the library has no client-server transport layer at all — it is a single-page, single-user SVG renderer driven by a JS API.

### 7. Live laser-pointer / telestrator annotation tool for presentations

- **Category:** presentation · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Excalidraw; tldraw; Figma (community feature request, not shipped)
- **What they offer:** A transient, non-persisted freehand stroke overlay the presenter draws during a live session to point at something; strokes fade out automatically. tldraw's v4 rework keeps concurrent strokes visible together, then fades as a group ('telestrator' style) via editor.scribbles.startSession()/addScribbleToSession() with fadeMode/idleTimeoutMs/fadeDurationMs.
- **Why it matters here:** sparkle-motion-visualizer has emphasis/spotlight (dim+focus) and camera framing as its 'point at this' primitives, but nothing for freeform ad-hoc pointing during a live (non-storyboard-scripted) walkthrough — a presenter driving the graph live via g.camera()/g.highlight() has no way to circle/underline an arbitrary spot the way a laser pointer does.
- **How it could fit:** Could be a small opt-in interaction addon: pointerdown+drag draws a temporary SVG stroke on an overlay layer, auto-fades after N ms; would fit the existing 'preset' plugin contract ((g)=>{destroy()}) rather than core.
- **Survey evidence:** https://tldraw.dev/blog/redesigning-lasers ; https://twitter.com/excalidraw/status/1712112531550925138 (verified)
- **Repo check:** grep -rni 'laser|telestrator|scribble' src/ docs/ README.md returns nothing. The library has no freehand drawing/annotation primitive at all — src/interact.js only covers pan/zoom/hover interaction (checked directly, no drawing tool).
- *Verifier's phrasing of the claim:* Live laser-pointer / telestrator annotation tool

### 8. Frames as a reusable authoring/grouping/export unit distinct from data containers

- **Category:** data model / export · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** tldraw; Figma
- **What they offer:** tldraw's frame tool groups arbitrary canvas elements into a named, moveable, individually-exportable unit (thumbnail export, clipping mask) independent of any semantic/data relationship between the grouped elements — purely a presentation-level grouping.
- **Why it matters here:** sparkle-motion-visualizer's only grouping concept is the container node (`parent`), which is a semantic/data-model construct tied to collapse/expand and duration rollup. There's no presentation-only grouping a storyboard author could use purely to frame-and-export a region of the canvas (e.g. 'camera-frame this rectangle of unrelated nodes for a thumbnail') without it being a real compound node in the graph.
- **How it could fit:** exportSVG already supports viewport:true (shoots whatever's on screen) which partially covers this; a named, storyboard-addressable 'region' (a virtual bounding box over a set of node ids, usable by camera{nodes} and export) would close the rest without touching the data model.
- **Survey evidence:** https://seatable.com/help/guide-to-whiteboard-plugin-tldraw/ (frame tool) — from memory for Figma frames (from memory / unverified)
- **Repo check:** The only grouping primitive is `parent` (compound/container nodes tied to the graph's semantic data model — README.md:87 'parent links make containers'). There is no presentation-only, semantics-free grouping/frame/export-unit construct; grep for 'frame' in src/*.js shows only animation-frame (rAF) usage, not a UI frame concept.

### 9. Dedicated presentation/present mode with a distinct navigation surface (slide-by-slide, laser-on-by-default, follow-presenter for viewers)

- **Category:** presentation · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** tldraw; Excalidraw; reveal.js; Slidev
- **What they offer:** A mode switch that changes interaction affordances for a live audience-facing session: reveal.js/Slidev step through discrete slides with keyboard/click; Excalidraw's presenter mode auto-enables the laser tool and (in multiplayer) can broadcast the presenter's viewport to followers.
- **Why it matters here:** sparkle-motion-visualizer has a transport bar (play/pause/scrub) and storyboard labels/steps, which cover the authored-narrative case, but has no 'presenter broadcasts live viewport to N viewers' concept — that's squarely a collaboration feature outside a client-side embeddable visualization library's remit, but the plain 'present mode disables editing chrome, shows only nav + captions' pattern is closer to scope.
- **How it could fit:** opts.controls:true is the closest existing primitive; a `presentMode:true` opt (hide non-essential chrome, lock camera to storyboard-only navigation, larger caption typography) would be a light, in-scope addition.
- **Survey evidence:** from memory (reveal.js/Slidev present mode, Excalidraw presenter mode) (from memory / unverified)
- **Repo check:** grep -rni 'present mode|presentation mode|follow-presenter' src/ docs/ README.md returns nothing. The library exposes a transport bar (play/pause/scrub, README.md intro) for the token-flow story and a storyboard sequencer, but no slide-by-slide stepping mode, no laser-default toggle, and no viewport-follow-for-viewers broadcast mechanism.
- **Verifier note:** The transport/storyboard control surface is the closest analog but is a scrub timeline for one local viewer, not an audience-facing present mode.
- *Verifier's phrasing of the claim:* Dedicated presentation/present mode with distinct navigation surface

### 10. Chapter/section navigation UI with named jump targets exposed as a visible outline/table of contents

- **Category:** presentation/UI · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** reveal.js; Slidev; Loom (auto-chapters)
- **What they offer:** reveal.js/Slidev render a slide overview grid and keyboard section jump; Loom auto-generates timestamped chapters from a recording and shows them as a scrubber overlay/side list the viewer can click.
- **Why it matters here:** sparkle-motion-visualizer already computes g.cues() (label+caption offsets) and can emit a YouTube chapter list via toChapters() for external video platforms, but has no built-in UI widget that renders those cues as a clickable in-page chapter list/outline for the live embedded (non-recorded) viewing experience — only the external transport scrub slider exists.
- **How it could fit:** A small optional UI addon consuming g.cues() to render a clickable outline that calls g.timeline() seek — fits as a preset, not core.
- **Survey evidence:** https://revealjs.com/auto-animate/ (site-wide reveal.js overview feature, from memory) ; smv already has toChapters per inventory (from memory / unverified)
- **Repo check:** src/storyboard.js supports named 'wait' labels that are seekable (comment at line 63: 'not just await, just a named position for seek()/labels()') and the transport/index.d.ts expose labels()/seek() programmatically. But this is a data/API surface, not a rendered, clickable outline/TOC widget or scrubber overlay — no such UI component exists in src/render.js or the controls code (README mentions `controls: true` only for basic play/pause/scrub).
- **Verifier note:** The naming/seek plumbing exists; the visible chapter-list UI does not.
- *Verifier's phrasing of the claim:* Chapter/section navigation UI with named jump targets exposed as a visible outline/TOC

### 11. Automatic camera-follow / auto-zoom keyed to activity (not manually scripted)

- **Category:** camera/director · **Fit:** 4/5 · **Verified in repo:** `partial`
- **Who has it:** Screen Studio
- **What they offer:** Screen Studio tracks cursor/click/scroll telemetry during capture and, in post, algorithmically generates zoom-in/pan/idle-wide-shot camera moves keyed to detected activity, with configurable easing/padding, rather than the operator hand-placing every camera cut.
- **Why it matters here:** sparkle-motion-visualizer's camera op is 100% hand-scripted (director must specify node/nodes/fit/x,y,k for every beat). For Mode A (simulated) runs specifically, an 'auto-follow the active token(s)' camera mode that frames whatever node(s) currently have run activity — without the storyboard author hand-keying a camera op per state transition — would remove a large amount of manual work for simple demos.
- **How it could fit:** Could be a mount/run option like `camera: {autoFollow: true, pad, maxK}` that on each runstatus/tick frames active nodes automatically, overridable by an explicit camera op (consistent with the existing 'first camera op takes over' rule, inverted: autoFollow stays live until an explicit camera op is issued).
- **Survey evidence:** https://www.screenkite.com/blog/screenkite-auto-zoom-how-it-works ; https://www.datastudios.org/post/screen-studio-auto-zoom-mechanism-mac-only-limits-and-pricing-explained (verified)
- **Repo check:** src/director.js and the `camera` storyboard op (src/storyboard.js:15) provide a scriptable camera (pan/zoom to node/region), and README.md/docs/PLAN.md describe centroid-following choreography for condense/split ('the viewport shifts only ... centroid', docs/PLAN.md:596). But this is triggered by explicit authored ops (camera step, or built-in condense/split choreography), not an algorithmic system that infers camera moves from arbitrary detected activity/telemetry the way Screen Studio does.
- **Verifier note:** Some built-in auto-follow exists for specific mutation types (condense/split centroid shift) but it's not a general, configurable auto-zoom system.
- *Verifier's phrasing of the claim:* Automatic camera-follow / auto-zoom keyed to activity

### 12. Automatic transcript / voice-track generation and synced captions from audio

- **Category:** captions/recording · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Loom
- **What they offer:** Loom auto-transcribes recorded narration and syncs a caption track to it, plus lets viewers search video content via the transcript.
- **Why it matters here:** smv-fit already goes the OTHER direction (stretch a storyboard's wait steps to match a supplied voice-over's marks.json), which is the harder/more correct half of this problem for a scripted pipeline narrative; full ASR transcript generation is arguably out of scope (needs a speech model) but is worth naming as a capability this cohort has that smv doesn't attempt.
- **How it could fit:** Out of scope for a client-side visualization lib — would require bundling/calling a speech-to-text service.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rni 'transcript|caption' src shows only the storyboard `caption` op (src/storyboard.js:15, director.js) which is an author-supplied text overlay, not audio transcription. No audio/voice handling exists anywhere in the library (it is a pure SVG visual renderer with no audio pipeline).
- **Verifier note:** The 'caption' op is manually authored text, unrelated to auto-transcription from audio.
- *Verifier's phrasing of the claim:* Automatic transcript / voice-track generation and synced captions

### 13. Viewer engagement analytics on recorded/shared content (view counts, drop-off heatmap, reactions)

- **Category:** analytics/recording · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Loom
- **What they offer:** Loom shows creators per-video view counts, a retention/drop-off curve over the timeline, and viewer comments/emoji reactions anchored to timestamps.
- **Why it matters here:** Entirely a hosting/SaaS-platform feature (needs a backend, accounts, analytics pipeline) — flagged for completeness per the cohort brief but clearly outside a client-side embeddable library's remit.
- **How it could fit:** Out of scope.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rni 'analytics|view count|retention|heatmap|reaction' src/ docs/ README.md returns nothing. The library has no hosting/sharing/viewing backend at all — it is an embeddable client-side renderer with no server component to collect such data.
- *Verifier's phrasing of the claim:* Viewer engagement analytics on recorded/shared content

### 14. Silence/dead-space auto-trimming of recorded footage

- **Category:** recording · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Loom; Screen Studio
- **What they offer:** Automatically detects and removes pauses/silence in a recording's audio/cursor-idle track to tighten pacing without manual scrubbing.
- **Why it matters here:** smv-record produces deterministic frame-perfect renders from an authored storyboard (no 'dead space' exists to trim since timing is declared), so this doesn't map cleanly, but smv-fit's stretch-only model (it only stretches wait steps to match VO marks, never compresses/removes them) means a voice-over that runs faster than the authored pacing has no automatic tightening path — smv-fit explicitly only stretches.
- **How it could fit:** Could extend smv-fit to allow negative adjustment (compressing overlong wait steps) when marks land earlier than authored duration, not just stretching for late marks — check whether that's already implicitly supported; inventory only documents 'stretches/shrinks' so this may already partially exist and not be a true gap — flagged as low confidence.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rni 'silence|trim|dead.space' src/ docs/RECORDING.md returns nothing related; docs/RECORDING.md describes smv-record producing deterministic frame-by-frame video captures of a storyboard's own scripted timeline (no audio track, no idle-detection/trimming pass).

### 15. Text-based DSL for authoring diagrams (declarative markup rather than JSON op arrays)

- **Category:** data model / authoring · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Slidev (Markdown-driven slides/diagrams); Manim (Python API as the authoring language)
- **What they offer:** Slidev decks and Manim scenes are authored in a readable text format (Markdown+YAML frontmatter / Python) rather than hand-built JSON, lowering the barrier for non-programmatic authors and enabling diffable version control of the narrative script itself.
- **Why it matters here:** sparkle-motion-visualizer's storyboard is already 'just JSON' plus a fluent JS builder — there is no plain-text/YAML authoring format, so a non-JS author (e.g. a technical writer building a pipeline explainer) has no lighter-weight entry point than writing JS or hand-editing a JSON array.
- **How it could fit:** A thin YAML-to-storyboard-JSON transform (parallel to smv-fit's JSON->JSON model) would fit the existing CLI-tool pattern without touching core.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** docs/PLAN.md:32 explicitly states out of scope: 'no graph editing UI (drag-to-connect), React/Vue bindings, a text DSL à la Mermaid.' The graph spec is JSON only ({nodes, edges} passed to mount()), confirmed throughout README.md and types/index.d.ts.
- **Verifier note:** This is an explicit, documented non-goal, not an oversight.
- *Verifier's phrasing of the claim:* Text-based DSL for authoring diagrams (declarative markup vs JSON)

### 16. Node shape variety / rich node content (icons, images, custom shapes beyond rounded-rect)

- **Category:** rendering/data model · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Manim (arbitrary vertex_type mobject); Excalidraw/tldraw (arbitrary shape library, image embeds); Motion Canvas (arbitrary node components)
- **What they offer:** These tools let a node/vertex be rendered as literally any shape/image/icon/rich content, not a fixed shape vocabulary — Manim's vertex_type accepts any Mobject class, Excalidraw/tldraw support image elements and varied shape primitives (ellipse, diamond, arrow, freedraw), Motion Canvas nodes are arbitrary component trees.
- **Why it matters here:** Already listed as a known limit in the inventory (rounded-rects only) — surfaced here because every cohort tool exceeds it, confirming it as a real competitive gap for a 'pipeline/process' library where consumers often want icon-per-step (e.g. a cloud icon, a database cylinder) rather than a generic box.
- **How it could fit:** Could add an opts.nodeRenderer(node) => SVG-fragment escape hatch (consistent with the existing style()/props() override philosophy) rather than a built-in shape enum.
- **Survey evidence:** already flagged as knownLimits in the provided inventory; cohort comparison confirms competitive relevance (verified)
- **Repo check:** src/render.js builds every node from a single fixed template: an SVG <rect> ('smv-node-box', line 153) with rounded corners (rx/ry) plus a text label and optional stack/header/chevron/badge decorations for containers — all still rect-based. No path to render an arbitrary shape (ellipse/diamond/freedraw), an <image>, or an icon; types/index.d.ts node shape has no `shape`/`icon`/`image` field (grep confirmed zero matches).
- **Verifier note:** Custom CSS var theming (--smv-*) changes color/radius/stroke, but not the underlying shape/content vocabulary — every node is a rounded rect with text.
- *Verifier's phrasing of the claim:* Node shape variety / rich node content (icons, images, custom shapes)

### 17. Minimap / navigator overview panel for large graphs

- **Category:** interaction/UI · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** tldraw (minimap); Excalidraw (zoom-to-fit + navigator in some forks)
- **What they offer:** A small persistent overview widget showing the whole canvas with a viewport rectangle, letting users click/drag to jump to a region — common in whiteboard/canvas tools for orientation on large documents.
- **Why it matters here:** sparkle-motion-visualizer targets graphs large enough to need viewport culling (150+ elements) but has no minimap/navigator widget for a viewer to orient within a large pipeline once zoomed in — only fitView()/keyboard nav exist.
- **How it could fit:** Could ship as an optional preset (consistent with the presetPipeline plugin contract) reading g.bounds()/viewport state rather than core.
- **Survey evidence:** from memory (tldraw minimap) (from memory / unverified)
- **Repo check:** grep -rni 'minimap' src/ docs/*.md README.md finds only docs/PLAN.md:693 listing 'minimap' among 'M5+ ideas explicitly deferred/not built' (a wishlist mention, not an implementation). No minimap component exists in src/viewport.js or src/render.js.
- *Verifier's phrasing of the claim:* Minimap / navigator overview panel

### 18. Undo/redo history stack

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Excalidraw; tldraw; Figma
- **What they offer:** Standard editor undo/redo (Ctrl+Z/Shift+Ctrl+Z) over the document's edit history, including collaborative-safe history in tldraw/Excalidraw's multiplayer mode.
- **Why it matters here:** sparkle-motion-visualizer is not an editor (no in-place user authoring of the graph structure), so classic undo/redo doesn't map directly — but the library also has no 'undo the last programmatic mutation' convenience (a consumer must manually track and reverse addNode/removeNode calls themselves); cancel() only interrupts a trailing animation, never reverses a committed structural change.
- **How it could fit:** A lightweight g.undo()/g.redo() built on replaying storyboard-style op history (since every mutation is already an auditable op) could be a natural, low-effort fit given ops are already structured/serializable.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rni 'undo|redo' src/*.js shows only unrelated internal comments (e.g. src/index.js:88 'cancel() never undoes add/remove/update' — describing that cancellation does NOT undo mutations, i.e. confirming absence). There is no history stack, no undo()/redo() API in types/index.d.ts, and no keyboard-shortcut handling for it in src/interact.js.
- **Verifier note:** The library is a scripted/programmatic mutator (addNode/removeNode/update, storyboard), not an interactive editor with a document history a user edits by hand — so this concept doesn't map onto it.

### 19. Box/marquee select and multi-element selection state

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Excalidraw; tldraw; Figma
- **What they offer:** Drag a rectangle to select multiple canvas elements at once, then apply a group action (move, delete, style) to the whole selection.
- **Why it matters here:** Already listed as a known limit (no multi-select/selection API) — confirmed as universal across the whiteboard cohort, though of limited relevance since smv nodes aren't user-draggable anyway; more relevant would be a way to select multiple nodes to drive g.highlight()/g.props() interactively rather than only via storyboard/API.
- **How it could fit:** Out of scope for current interaction model (no drag-repositioning exists to select-and-move); low priority.
- **Survey evidence:** already flagged in provided inventory knownLimits (verified)
- **Repo check:** grep -rni 'marquee|multi-select|selection' src/interact.js (the file that owns all pointer/wheel interaction) returned zero matches. src/interact.js implements only pan/zoom/hover, confirmed by direct inspection of its exported surface; there is no click/drag selection concept anywhere in the library, since it has no interactive editing model at all.

### 20. Search/filter across nodes with highlight-matches UX

- **Category:** interaction · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** tldraw (community search plugins); reveal.js (search plugin)
- **What they offer:** A find-in-diagram box that highlights/pans to matching nodes by label or data field.
- **Why it matters here:** g.nodes(filter) exists as a read-only query but there's no built-in interactive search UI wired to g.highlight()/camera framing — a viewer of a large pipeline exported as a standalone html (smv-pack) has no way to locate a specific step by name.
- **How it could fit:** Natural preset: an input box calling g.nodes({label: match}) then g.highlight({nodes: ids, dim:true}) + g.camera({nodes: ids}).
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** src/query.js implements a programmatic query API — makeQuery(store) -> {nodes(filter), edges(filter), children(id), descendants(id), roots()} (lines 32-45) supporting predicate or match-object filters — and src/director.js/storyboard's `highlight` op can visually highlight a given set of node ids. But there is no built-in 'find-in-diagram' UI box, no automatic pan-to-match, and no text-label search — the caller would have to write their own query + call `g.highlight(ids)` themselves.
- **Verifier note:** The building blocks (query by field, highlight op) exist; the assembled find-box UX does not.

## Borrowable ideas

- GSAP Flip's explicit First/Last/Invert/Play state-capture API (Flip.getState()/Flip.from()) as a public reusable primitive, not just an internal diffing mechanism — lets consumers FLIP-animate their own DOM alongside the graph using the library's own ticker.
- Motion Canvas's named, timeline-visible waitUntil() time-event markers that are independently draggable/editable in a UI — richer than smv's current label markers.
- anime.js stagger() with from:'first'|'last'|'center'|'random'|nodeId as a reusable timing-offset utility pluggable into expandAll/collapseAll/highlight for cascade effects.
- tldraw's redesigned telestrator-style laser pointer (concurrent strokes fade together as a group, not independently) as a lightweight live-annotation overlay addon.
- Figma Smart Animate's 'match by stable identity across states, animate only the delta' mental model — already implicit in smv's diffing, but Figma's naming/UX (clear before/after frame pairing) is a good reference for documentation clarity.
- Screen Studio's activity-keyed auto-camera (auto zoom/pan to wherever the action currently is) — directly adaptable as an optional camera:{autoFollow:true} mode for Mode A token runs.
- reveal.js's slide overview/table-of-contents grid, adaptable as a clickable chapter/outline panel built from g.cues().
- Loom's auto-generated chapter list from a recording, mirrored by smv's existing toChapters()/--cues — worth cross-promoting in docs as reaching parity with Loom's viewer-facing chapter UX once paired with a simple outline widget.

## Survey notes

Time-boxed research pass: verified via WebSearch for GSAP Flip, tldraw (v4.4.0, laser pointer/scribbles API), Excalidraw (laser pointer + collaboration relay), reveal.js Auto-Animate, Manim Graph/DiGraph layouts, Motion Canvas flow/waitFor, Remotion Composition/Sequence, Figma Smart Animate mechanics, Screen Studio auto-zoom, anime.js v4 stagger + MIT license. Not independently verified in this pass (marked from memory / unverified): Slidev version and v-motion details, Loom feature specifics (transcripts/analytics/silence-trim), tldraw exact license terms, Figma frames grouping semantics, minimap/undo/search UX claims. No exact npm/PyPI version numbers were confirmed for Motion Canvas, Excalidraw, or Slidev — reported as 'unknown exact version' rather than guessed, per instructions. Fit scores lean toward the narrative/camera/staging features (autoFollow camera, stagger, FLIP-as-public-utility, node shape escape hatch) as highest-value since they extend capabilities the library already half-has (director/storyboard, diff-based FLIP, styling escape hatches) rather than requiring new architecture (collaboration, analytics, undo were scored low as out of remit).
