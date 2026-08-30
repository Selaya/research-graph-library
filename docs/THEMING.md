# Theming

`sparkle-motion-vizualizer` has **one styling mechanism** (D7): everything visual is driven
by `--smv-*` CSS custom properties and `[data-*]` attributes, written at *commit* time
(never per animation frame — geometry is the only thing that moves 60x/sec). That means
theming is ordinary CSS: override a custom property, or write a selector against a
`data-*` attribute. There is no CSS-in-JS, no inline `style=` sprawl, and no need to
reach into the DOM the library owns.

The one caveat: **the CSS the library injects itself always wins ties** unless you either
raise specificity or use a custom property override, both covered below.

## Basics

Every mount gets exactly one global `<style data-smv-styles>` injected into the document
(deduplicated — many instances on a page share it, G8). The mount root itself gets:

```html
<div class="smv-root" data-smv-theme="auto">
  <svg class="smv smv-grabbing?">...</svg>
  <!-- .smv-transport if opts.controls -->
  <!-- .smv-totalbar if opts.preset:'pipeline' -->
</div>
```

`data-smv-theme` is `"auto"` (default, follows `prefers-color-scheme`), `"light"`, or
`"dark"` — set via `mount(el, spec, { theme })` or at runtime with `g.theme(t)`. All the
built-in custom properties are defined three ways, most-specific override wins:

1. `:where(.smv-root)` — the light defaults, at specificity 0 so *any* rule you write
   beats them, including a plain `.smv-root { --smv-accent: ... }`.
2. `.smv-root[data-smv-theme="dark"]` — the explicit dark palette.
3. `@media (prefers-color-scheme: dark) { .smv-root[data-smv-theme="auto"] { ... } }` —
   the OS-driven dark palette, only when the mount is left on `"auto"`.

Because the light palette lives at `:where()` specificity, the simplest theme override is
just:

```css
.smv-root {
  --smv-accent: #ff5a36;
}
```

No `!important`, no fighting the library's own dark-mode block — your rule and the
built-in dark override both sit above `:where()`, so whichever theme is active, yours wins
for `--smv-accent` specifically while every other property keeps its themed default.

## `--smv-*` custom property reference

All defined at `:where(.smv-root)` (light) / `.smv-root[data-smv-theme="dark"]` and the
`prefers-color-scheme` mirror of the latter. Grep source: `src/styles.js`.

| Property | Used for | Light default | Dark default |
|---|---|---|---|
| `--smv-bg` | svg background, edge-label halo stroke | `#fbfbfd` | `#11141b` |
| `--smv-fill` | node box fill (default status) | `#ffffff` | `#1b2029` |
| `--smv-stroke` | node box / container stack stroke, transport border | `#ccd2de` | `#39414f` |
| `--smv-text` | node label text | `#1b2230` | `#e6e9f0` |
| `--smv-muted` | edge label, container badge, chip text, join pips | `#6b7488` | `#98a1b3` |
| `--smv-edge` | edge line + arrow fill | `#9aa3b5` | `#5d6678` |
| `--smv-edge-width` | edge stroke width (meta-edges double it) | `1.5px` | `1.5px` |
| `--smv-accent` | hover/focus ring, token fill, join-pip fill, active traversed edges | `#5b6ef5` | `#8b9bff` |
| `--smv-ok` | `[data-status="done"]` / `[data-run="done"]` node fill | `#e8f6ec` | `#1a2c21` |
| `--smv-ok-stroke` | same, stroke | `#4c9a63` | `#4f9c68` |
| `--smv-active` | `[data-status="active"]` / `[data-run="active"]` node fill | `#eef1ff` | `#1e2440` |
| `--smv-active-stroke` | same, stroke; also the token-progress fill under a label | `#5b6ef5` | `#8b9bff` |
| `--smv-container` | collapsed-container node fill | `#f2f4f9` | `#161b24` |
| `--smv-header` | expanded-container header strip fill | `#e7eaf3` | `#222836` |
| `--smv-condense` | condense/split phase glow, loop badge, delta badge | `#f0a000` | `#e0a53a` |
| `--smv-radius` | node corner radius (read by `render.js`, not CSS) | `8px` | `8px` |
| `--smv-traversed` | **written per commit**, not themeable — a 0..1 float driving traversed-edge width (`run-render.js`) | — | — |
| `--smv-emph` | the emphasis stroke colour, indirected from `--smv-accent`/`--smv-condense`/`--smv-ok-stroke`/`--smv-muted` by `[data-emph]`'s variant (D14) | — | — |
| `--smv-pulse` | **written per tick on `.smv-root`**, not themeable — a 0..1 bucketed float driving the emphasis pulse's stroke width (`director.js`, D17). Unset reads as 0, i.e. a still highlight | — | — |

`--smv-fill`/`--smv-stroke` are also **overridden locally** by status/mode selectors
(`[data-status]`, `[data-run]`, `[data-container]`, `[data-condense]`) — see the table
below for exactly which attribute wins which property on a given element. If you set
`--smv-fill` globally, a done/active node's local override still wins for that node; scope
your rule to the state you actually want to change (e.g.
`.smv-node[data-status="done"] { --smv-fill: ...; }`).

`g.style(fn)` is the per-node escape hatch: `fn(node)` returns a plain object of
`--smv-*` values written as **inline** custom properties on that node's `<g>` at commit
time — highest specificity of all, and the only mechanism meant to vary per-node data
(§5.6). It only ever writes properties, never classes or `data-*` — combine it with the
CSS selectors below for anything state-shaped.

`g.props(map)` is the *director's* escape hatch on the same channel (D16): a
`{id: {"--smv-*": value}}` layer merged **over** `g.style(fn)` at commit time, for nodes
**and** edges, so a storyboard step can recolour one element for one beat without the mount
owning a style function that knows about the story. It is replace-not-accumulate (one call
is the whole layer) and it is snapshotted state, so a backward scrub restores it. `g.props(null)`
clears the layer and whatever `g.style(fn)` sets shows through again. Same rule as everywhere
else: only `--smv-*` keys, anything else throws.

## `data-*` attribute reference

All written at commit time (`renderer.styleCommit`, `preset-pipeline.js`, `a11y.js`,
`run-render.js`) — never per frame. Grep source: `src/render.js`, `src/styles.js`,
`src/preset-pipeline.js`, `src/a11y.js`, `src/run-render.js`.

| Attribute | Where | Meaning / values |
|---|---|---|
| `data-smv-theme` | `.smv-root` | `"auto"` \| `"light"` \| `"dark"` |
| `data-id` | `.smv-node`, `.smv-edge` | the node/edge's spec id (also the a11y/query key) |
| `data-status` | `.smv-node` | from `node.data.status` (spec-authored: `"done"`, `"active"`, …) |
| `data-mode` | `.smv-node` | from `node.data.mode` (e.g. `"automated"` — swaps the manual-hand/auto-bolt badge in the pipeline preset) |
| `data-run` | `.smv-node` | the **token engine's own mirror of status** (`"active"`\|`"done"`), written by `run-render.js` — never spec-authored, cleared when a run stops driving the node |
| `data-container` | `.smv-node` | present (any truthy value) when the node is a compound/container node |
| `data-collapsed` | `.smv-node` | present when a container is collapsed (controls header-strip vs. stacked-card chrome) |
| `data-count` | `.smv-node` | the ×N child-count badge on a collapsed container |
| `data-emph` | `.smv-node`, `.smv-edge` | director emphasis (D14): `"focus"` \| `"warn"` \| `"ok"` \| `"mute"` — picks `--smv-emph`; pair with `--smv-pulse` for the beat |
| `data-dim` | `.smv-node`, `.smv-edge` | the spotlight half of `highlight({dim:true})` — everything drawn and not emphasised drops to 28% opacity |
| `data-smv-record` | `.smv-root` | record mode (D15): kills every CSS transition/animation beneath it |
| `data-condense` | `.smv-node` | `"src"` during highlight, `"reveal"` after converge/diverge — shared by both condense and split choreography |
| `data-reversed` | `.smv-edge` | present on back edges (FAS-pinned) — dashed stroke, reduced opacity |
| `data-weight` | `.smv-edge` | meta-edge aggregation count (>1); doubles the edge width |
| `data-traversed` | `.smv-edge` | present once a token has crossed the edge; pairs with `--smv-traversed` for the progressive width |
| `data-frozen` | `.smv-token` | token whose rate is 0 (paused branch) |
| `data-filled` | `.smv-join-pip` | a join slot that has arrived |
| `data-smv-styles`, `data-smv-a11y`, `data-smv-preset-styles`, `data-smv-a11y-table` | `<style>` | injection dedup markers (G8) — not meant to be selected against |

Containers get **two** stroke-affecting states worth knowing about: an *expanded*
container (`[data-container]:not([data-collapsed])`) drops its own box fill/stroke to
read as a frame, and a *collapsed* one (`[data-container][data-collapsed]`) reads as a
stacked card. If you theme container fill, target `--smv-container` (the collapsed card
face) and `--smv-header` (the expanded frame's label strip) rather than `--smv-fill`,
which a container's card-state selectors already claim.

## Dark mode

Three ways to land in dark mode, matching the property-cascade order above:

- **Follow the OS** (default): mount with `theme: 'auto'` (or omit it) and leave
  `data-smv-theme="auto"` alone — the `prefers-color-scheme` media query drives it.
- **Force it**: `mount(el, spec, { theme: 'dark' })`, or at runtime `g.theme('dark')`.
- **Follow your own app's theme toggle**: call `g.theme(appIsDark ? 'dark' : 'light')`
  whenever your app's theme changes — `g.theme()` just sets the one attribute, so it's
  cheap to call from a theme-change listener.

`exportSVG()`/`exportPNG()` (see `docs/EMBED.md`) resolve the theme once at export time
(`opts.theme`, else whatever the live root's `data-smv-theme` currently is) and bake it
into the standalone document — an exported SVG has no separate root to carry
`data-smv-theme` on, so `export.js` folds it onto the `<svg>` itself.

## Worked example 1 — status colors via `g.style`

Per-node, data-driven coloring that the built-in `data-status` selectors don't cover
(say, a priority level rather than a run status):

```js
g.style((node) => {
  const p = node.data && node.data.priority;
  if (p === "high") return { "--smv-fill": "#fdecea", "--smv-stroke": "#c0392b" };
  if (p === "low") return { "--smv-fill": "#f4f6fb", "--smv-stroke": "#aab2c5" };
  return null; // no override — falls through to the theme default / data-status
});
```

`g.style(fn)` re-runs `fn` for every node at the next commit and on every commit after
(it's stored, not one-shot) — call `g.style(null)` to clear it. Because these are inline
custom properties, they win over `data-status`'s CSS-level `--smv-fill` override too, so
a "high priority, done" node still shows your color, not the built-in green.

## Worked example 2 — a CSS-only theme

No JS at all: a page-level stylesheet that reskins the accent, tightens corners, and
gives back edges a stronger dashed look, following the OS by default but with an explicit
dark override for a `data-smv-theme="dark"` mount:

```css
/* Brand palette, both themes at once via :where() specificity (see Basics above). */
.smv-root {
  --smv-accent: #7c3aed;
  --smv-radius: 4px;
}

/* Extra emphasis on retry/back edges beyond the built-in dash. */
.smv-edge[data-reversed] path.smv-edge-line {
  stroke-dasharray: 2 4;
  stroke-width: calc(var(--smv-edge-width) * 1.5);
}

/* A custom "blocked" status the pipeline preset doesn't know about. */
.smv-node[data-status="blocked"] {
  --smv-fill: #fff4e5;
  --smv-stroke: #b8860b;
}

/* Dark-mode-only tweak: a lighter accent than the library's own dark default. */
.smv-root[data-smv-theme="dark"] {
  --smv-accent: #a78bfa;
}
@media (prefers-color-scheme: dark) {
  .smv-root[data-smv-theme="auto"] {
    --smv-accent: #a78bfa;
  }
}
```

Because `data-status="blocked"` isn't one of the library's own selectors
(`"done"`/`"active"`), there's no specificity fight to win — this is exactly how you add
your own status vocabulary on top of the spec's free-form `node.data.status` string.
