# Writing your own preset

A preset is a plain function: `(g) => { destroy() }`. It decorates a mounted instance from
the *outside*, through the same public surface a page using the library already has, and
gives you back a handle to undo everything it did. `presetPipeline` (`src/preset-pipeline.js`,
`opts.preset: "pipeline"`) is the one shipped with the library — this doc is how to write your
own alongside it, or instead of it.

## The minimal shape

```js
export function myPreset(g) {
  const off = g.on("commit", (ev) => {
    // ev = { nodes, edges, bounds, meta, focal, duration, transition, reversedEdgeIds }
    // ev.nodes / ev.edges are the CURRENT layout: id -> {x, y, w, h, ...}
  });

  return {
    destroy() {
      if (typeof off === "function") off();
      else g.off("commit", /* the same fn */);
    },
  };
}
```

That's the whole contract: subscribe via `g.on(type, fn)` (every `on()` call returns an
unsubscribe function — hang onto it), read the graph via `g.nodes()` / `g.spec()` /
`g.renderer.node(id)` / `g.renderer.edge(id)`, style through `--smv-*` custom properties (D7
— the same channel `g.style()`/`g.props()` write to, so a preset composes with a mount's own
styling instead of fighting it), and give `destroy()` back so a caller can unwind everything
you did.

## The boundary discipline

`presetPipeline` states its own rule at the top of `src/preset-pipeline.js`, and it's worth
following in anything you write:

> Boundary: subscribes ONLY via the public instance surface (`g.on`/`g.node`/`g.spec`/`g.el`/
> `g.renderer.node|edge`/`g.ticker`/`g.layoutResult`) plus DOM elements it creates itself.
> Never reaches into scene/render/index internals — so it can ship as a separate entry point
> (own stylesheet, own marker) that a core-only page never has to load.

Two things fall out of that:

- **Everything you touch is public API.** `g.renderer.node(id)` / `g.renderer.edge(id)` give
  you the live `<g>`/`<path>` element for a node or edge — append your own children to it,
  don't reach past it into `scene`/`viewstate`/whatever else `g` happens to expose. `g.spec()`
  gives you a plain-copy snapshot of the current graph (nodes/edges arrays); `g.nodes(filter)`
  is the query-sugar equivalent when you want a subset. `g.ticker` is the shared clock —
  animate on it (`ticker.add(fn)`/`ticker.remove(fn)`), never with a `setInterval` or a raw
  `requestAnimationFrame`, so your preset's motion pauses/reduces exactly like the library's
  own does.
- **Position at commit time, never per frame.** A node's box only changes at a `"commit"` —
  the tween between two commits is the renderer's own job (FLIP), not yours. Read `ev.nodes[id]`
  (or `g.layoutResult().nodes[id]`) for `{x, y, w, h}` and set your decoration's position once
  per commit; it glides for free as the node's own `<g>` transitions, because your element is
  a child of that `<g>`.

## `--smv-*` styling

Anything you want theme-aware — colors especially — should read a `--smv-*` custom property
rather than hardcode a hex value, the same discipline `docs/THEMING.md` documents for
`g.style()`. A CSS rule like:

```css
.my-badge { fill: var(--smv-muted, #6b7488); }
```

picks up the mount's light/dark palette (and any override `g.props()`/`g.style()` has set)
for free, without your preset needing to know which theme is active. Inject your stylesheet
once, guarded by a marker attribute so a second `myPreset(g)` call (or applying it after a
page-level re-mount) doesn't stack a duplicate `<style>`:

```js
const MARKER = "data-my-preset-styles";
function injectStyles(doc) {
  if (!doc || doc.querySelector(`style[${MARKER}]`)) return;
  const el = doc.createElement("style");
  el.setAttribute(MARKER, "");
  el.textContent = `.my-badge{ font:600 10px system-ui,sans-serif; fill:var(--smv-muted,#6b7488); pointer-events:none }`;
  (doc.head || doc.documentElement).appendChild(el);
}
```

## Back-filling current state

A preset applied *after* mount used to only see *future* commits: whatever was already on
screen stayed undecorated until the next unrelated mutation nudged a commit. Every preset
following the shape above should now do the same thing `presetPipeline` does — call
`g.layoutResult()` right after subscribing, and if it returns something, run your own
commit-handling pass against it synchronously:

```js
export function myPreset(g) {
  function onCommit(ev) { /* ... */ }

  const off = g.on("commit", onCommit);

  // Back-fill: decorate whatever is ALREADY on screen, not just future commits.
  const lr = typeof g.layoutResult === "function" && g.layoutResult();
  if (lr && lr.nodes) onCommit(lr);

  return { destroy() { off(); /* ... */ } };
}
```

The `typeof g.layoutResult === "function"` guard matters: a `g`-shaped test double or an
older host might not have it, or nothing may be laid out yet, in which case there's nothing
to back-fill and the first real `"commit"` covers it exactly as before. `mount(el, spec, {
preset: "pipeline" })` never needed this — it gets the mount's own initial commit for free —
but `presetPipeline(g)`/your own `myPreset(g)` called *after* mount now behaves the same way,
so the two application styles are equivalent.

## A worked example: an owner badge

A small preset that reads `data.owner` off each node's spec and draws it as a text label in
the node's corner — no run/token awareness, just `"commit"` and the spec.

```js
const NS = "http://www.w3.org/2000/svg";
const MARKER = "data-owner-badge-styles";

function injectStyles(doc) {
  if (!doc || typeof doc.createElement !== "function") return;
  if (doc.querySelector(`style[${MARKER}]`)) return;
  const el = doc.createElement("style");
  el.setAttribute(MARKER, "");
  el.textContent = `.owner-badge{
    font: 600 10px system-ui, -apple-system, 'Segoe UI', sans-serif;
    fill: var(--smv-muted, #6b7488);
    text-anchor: start; dominant-baseline: central; pointer-events: none;
  }`;
  (doc.head || doc.documentElement).appendChild(el);
}

export function ownerBadgePreset(g) {
  const doc = g.el && g.el.ownerDocument;
  injectStyles(doc);
  const badges = new Map(); // node id -> <text>

  function badgeFor(id) {
    const host = g.renderer && g.renderer.node && g.renderer.node(id);
    if (!host || !doc) return null;
    let el = badges.get(id);
    if (!el || el.parentNode !== host) {
      el = doc.createElementNS(NS, "text");
      el.setAttribute("class", "owner-badge");
      host.appendChild(el);
      badges.set(id, el);
    }
    return el;
  }

  function onCommit() {
    const spec = g.spec();
    const seen = new Set();
    for (const n of spec.nodes || []) {
      seen.add(n.id);
      const el = badgeFor(n.id);
      if (!el) continue;
      const owner = n.data && n.data.owner;
      el.textContent = owner ? `@${owner}` : "";
      el.setAttribute("x", "10");
      el.setAttribute("y", "34"); // under the label, above the bottom edge
    }
    // A node that left the graph loses its badge too.
    for (const id of [...badges.keys()]) {
      if (seen.has(id)) continue;
      const el = badges.get(id);
      if (el.parentNode) el.parentNode.removeChild(el);
      badges.delete(id);
    }
  }

  const off = g.on("commit", onCommit);
  const lr = typeof g.layoutResult === "function" && g.layoutResult();
  if (lr && lr.nodes) onCommit();

  return {
    destroy() {
      if (typeof off === "function") off(); else g.off("commit", onCommit);
      for (const el of badges.values()) if (el.parentNode) el.parentNode.removeChild(el);
      badges.clear();
    },
  };
}
```

```js
const g = SparkleMotion.mount("#pipe", spec);
const badges = ownerBadgePreset(g);
// ...
badges.destroy();   // undoes everything, independent of g.destroy()
```

A **status-dot** preset would follow exactly the same shape, subscribing to `"runstatus"`
(the bus event `run-render.js` emits every time a node's `data-run` attribute actually
changes — `{id, status}`, `status` one of `pending`/`active`/`done`/`failed`) instead of
reading `data.status` from the spec, and painting a small `<circle>` colored off
`--smv-ok`/`--smv-active`/`--smv-fail`/`--smv-muted` to match. Both are the same recipe:
one (or two) `g.on(...)` subscriptions, a `Map` of decoration elements keyed by id, position
at commit time, `destroy()` tears it all back down.

## See also

- `docs/THEMING.md` — the full `--smv-*` token list and the `g.style()`/`g.props()` contract
  a preset's own CSS should stay consistent with.
- `docs/RUN.md` / `docs/LIVE.md` — `run.state()`/`"runstatus"`/`"fail"` if your preset reacts
  to a run instead of (or in addition to) the spec.
