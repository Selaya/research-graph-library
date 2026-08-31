# Embedding sparkle-motion-visualizer

Two ways to get a graph onto a page with **zero build step** (R1/D11): a copy-paste
`<script>` snippet, or a one-shot CLI that packs everything — library, spec, optional
storyboard — into a single `.html` file you can email, commit, or drop on a static host.

## 1. Copy-paste embed (the recipe)

Point a `<script>` tag at the IIFE build (from a CDN, or a local `dist/smv.iife.min.js`
copied next to your page), give it a sized container, and mount:

```html
<!doctype html>
<html>
<body>
  <div id="pipe" style="height:480px"></div>

  <script src="https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@1/dist/smv.iife.min.js"></script>
  <script>
    const spec = {
      nodes: [
        { id: "ingest", label: "Ingest", data: { duration: "45m", status: "done" } },
        { id: "clean",  label: "Clean",  data: { duration: "2h",  status: "active" } },
      ],
      edges: [{ id: "e1", source: "ingest", target: "clean" }],
    };

    const g = SparkleMotion.mount("#pipe", spec, {
      theme: "auto",          // "light" | "dark" | "auto"
      controls: true,         // transport bar: play/pause/step/scrub/speed
      preset: "pipeline",     // duration chips, status glyphs, condense odometer
    });
  </script>
</body>
</html>
```

That's the whole contract: one `<div>`, one `<script src>`, one `mount()` call. No CSS
file to link — styles are injected once into `<head>` on first mount (D7/G8). No bundler,
no ESM resolution — the IIFE build exposes a single global, `SparkleMotion`.

Swap the CDN URL for a local copy of `dist/smv.iife.min.js` (from this package's `dist/`
or your own `npm run build`) to work fully offline.

### Optional pieces (ESM-only, not in the IIFE)

`exportSVG`/`exportPNG` and the linearized a11y table are intentionally left out of the
IIFE bundle to keep the default embed small (D11). Reach them via ESM, e.g. from a module
script or a bundler:

```html
<script type="module">
  import { exportSVG, exportPNG } from "https://cdn.jsdelivr.net/npm/sparkle-motion-visualizer@1/src/export.js";
  // exportSVG(g) -> string   (works anywhere, incl. Node, for the string-building half)
  // exportPNG(g) -> Promise<Blob>  (browser only — canvas rasterization)
</script>
```

or, from an npm install:

```js
import { exportSVG, exportPNG } from "sparkle-motion-visualizer/export";
import { attachA11yTable } from "sparkle-motion-visualizer/a11y-table";
```

## 2. `smv-pack` CLI — one self-contained HTML file

For sharing a specific graph (a snapshot, a demo, a storyboard narrative) as a single
file with nothing to fetch at open time, use the bundled CLI. It inlines the prebuilt
`dist/smv.iife.min.js` together with your spec JSON into one `.html` file.

```sh
# from an npm install
npx smv-pack spec.json -o pipeline.html

# from a checkout of this repo (build once first)
npm run build
node bin/smv-pack.mjs demo/spec.json -o pipeline.html
```

### Usage

```
smv-pack <spec.json> [-o out.html] [--storyboard sb.json] [--title T] [--preset pipeline]
```

| Flag | Meaning |
|---|---|
| `<spec.json>` (required) | Path to a graph spec — the same JSON shape as `mount()`'s second argument (§5.1 in `docs/PLAN.md`). |
| `-o, --out <file>` | Output path. Defaults to `<spec-basename>.smv.html`. |
| `--storyboard <sb.json>` | Path to a JSON storyboard op array (§5.5). When given, the packed page mounts with `autoplay: true` and replays it. |
| `--title <T>` | `<title>` of the emitted HTML document. |
| `--preset <pipeline>` | Enables a preset (currently only `"pipeline"`) via `opts.preset`. |

The emitted page always mounts with `controls: true` (the transport bar), so a stray
storyboard or a manually-run graph can still be scrubbed by hand.

If `dist/smv.iife.min.js` doesn't exist yet (a fresh checkout that hasn't been built),
the CLI does **not** try to build it for you — it prints:

```
smv-pack: dist/smv.iife.min.js not found — run npm run build first
```

and exits with status 1. Run `npm run build`, then re-run `smv-pack`.

### What gets embedded

The output is one HTML file with two inline `<script>` tags: the IIFE bundle, then a
tiny mount call carrying your spec (and storyboard, if given) as embedded JSON. There is
no external `<script src>`, no fetch, no CDN dependency — open the file directly
(`file://`) in a browser and it renders and animates exactly as the live embed does.

## Spec and mount options

Both paths above take the same graph spec shape and the same `mount()` options
documented in `docs/PLAN.md` §5.1–§5.6 and the top-level `README.md`. In particular:
`theme`, `layout`, `animation`, `controls`, `preset`, `storyboard`, `autoplay` all work
identically whether you wired the `<script>` tag by hand or generated the page with
`smv-pack`.
