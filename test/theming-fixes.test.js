// Theming + style-contract regressions (src/render.js), against the same minimal
// hand-rolled DOM used by test/labels.test.js / test/cull.test.js: createRenderer takes an
// explicit {root, doc} — no globalThis.document, so this file stays isolated.
//
// Covers:
//  1. --smv-radius: docs/THEMING.md documents it as "read by render.js, not CSS" (with a
//     worked example) — render.js used to hardcode CORNER=8 and never read it at all.
//  2. g.style(fn) returning a non---smv-* key used to be silently dropped; docs/THEMING.md
//     has always claimed it throws, same as g.props(). Now it does (GraphError 'style-key').

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../src/render.js";
import { CSS } from "../src/styles.js";
import { GraphError } from "../src/store.js";

// ---------------------------------------------------------------------------
// Minimal hand-rolled DOM (same technique as test/labels.test.js / test/cull.test.js).
// ---------------------------------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], parent: null, attrs: {}, textContent: "",
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.remove();
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
  };
  return el;
}
function makeRoot() {
  const root = makeEl("div");
  const doc = { createElementNS(_ns, t) { const e = makeEl(t); e.ownerDocument = doc; return e; } };
  root.ownerDocument = doc;
  return { root, doc };
}

function visualOf(nodes, edges = {}) {
  const vn = new Map(Object.entries(nodes).map(([id, n]) => [id, { ...n, opacity: 1 }]));
  const ve = new Map(Object.entries(edges).map(([id, e]) => [id, { ...e, opacity: 1 }]));
  return { nodes: vn, edges: ve };
}

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}
const byClass = (node, cls) => findAll(node, (n) => (n.attrs.class || "").split(/\s+/).includes(cls));

const oneNode = { a: { x: 0, y: 0, w: 80, h: 40 } };

// ---------------------------------------------------------------------------
// --smv-radius (docs/THEMING.md:71, worked example at :176)
// ---------------------------------------------------------------------------

test("--smv-radius: unset (no defaultView at all, the Node DOM test stub) falls back to 8 — identical to before the fix", () => {
  const { root, doc } = makeRoot(); // no doc.defaultView, no global `window`
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: { a: {} } });
  r.frame(visualOf(oneNode));
  const rect = byClass(r.node("a"), "smv-node-box")[0];
  assert.equal(rect.attrs.rx, "8");
  assert.equal(rect.attrs.ry, "8");
});

test("--smv-radius: read from the mount root's computed style (THEMING.md worked example 2: --smv-radius: 4px)", () => {
  const { root, doc } = makeRoot();
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: (k) => (k === "--smv-radius" ? "4px" : "") }) };
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: { a: {} } });
  r.frame(visualOf(oneNode));
  const rect = byClass(r.node("a"), "smv-node-box")[0];
  assert.equal(rect.attrs.rx, "4");
  assert.equal(rect.attrs.ry, "4");
});

test("--smv-radius: an unparseable value falls back to 8, not NaN", () => {
  const { root, doc } = makeRoot();
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: () => "not-a-length" }) };
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: { a: {} } });
  r.frame(visualOf(oneNode));
  const rect = byClass(r.node("a"), "smv-node-box")[0];
  assert.equal(rect.attrs.rx, "8");
});

test("--smv-radius: a throwing or minimal getComputedStyle never crashes styleCommit (defensive fallback)", () => {
  const { root, doc } = makeRoot();
  doc.defaultView = { getComputedStyle: () => { throw new Error("nope, not this environment"); } };
  const r = createRenderer(root, doc);
  assert.doesNotThrow(() => r.styleCommit({ nodes: { a: {} } }));
  r.frame(visualOf(oneNode));
  assert.equal(byClass(r.node("a"), "smv-node-box")[0].attrs.rx, "8");

  // getComputedStyle() resolves but hands back something with no getPropertyValue at all.
  const { root: root2, doc: doc2 } = makeRoot();
  doc2.defaultView = { getComputedStyle: () => ({}) };
  const r2 = createRenderer(root2, doc2);
  assert.doesNotThrow(() => r2.styleCommit({ nodes: { a: {} } }));
  r2.frame(visualOf(oneNode));
  assert.equal(byClass(r2.node("a"), "smv-node-box")[0].attrs.rx, "8");
});

test("--smv-radius: re-resolved every styleCommit, so a later change updates ALREADY-created elements too", () => {
  let radius = "8px";
  const { root, doc } = makeRoot();
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: (k) => (k === "--smv-radius" ? radius : "") }) };
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: { a: {} } });
  r.frame(visualOf(oneNode));
  const rect = byClass(r.node("a"), "smv-node-box")[0];
  assert.equal(rect.attrs.rx, "8");

  radius = "16px";
  r.styleCommit({ nodes: { a: {} } }); // re-commit only — no new node created, "a" already exists
  assert.equal(rect.attrs.rx, "16", "the existing rect's rx/ry followed the property change");
  assert.equal(rect.attrs.ry, "16");
});

test("--smv-radius: a container's stack/header rects follow it too", () => {
  const { root, doc } = makeRoot();
  doc.defaultView = { getComputedStyle: () => ({ getPropertyValue: (k) => (k === "--smv-radius" ? "10px" : "") }) };
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: { box: { collapsed: false } } });
  r.frame(visualOf({ box: { x: 0, y: 0, w: 200, h: 120 } }));
  const g = r.node("box");
  for (const cls of ["smv-node-box", "smv-node-stack", "smv-node-header"]) {
    const el = byClass(g, cls)[0];
    assert.equal(el.attrs.rx, "10", `${cls} rx`);
    assert.equal(el.attrs.ry, "10", `${cls} ry`);
  }
});

// ---------------------------------------------------------------------------
// g.style(fn): non---smv-* keys now throw (docs/THEMING.md:83-95), matching g.props()
// ---------------------------------------------------------------------------

test("styleCommit(): a style fn returning a non---smv-* key throws GraphError('style-key'), matching g.props()'s contract (D7)", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  assert.throws(
    () => r.styleCommit({ nodes: { a: {} }, style: () => ({ color: "red" }) }),
    (err) => {
      assert.ok(err instanceof GraphError);
      assert.equal(err.code, "style-key");
      assert.match(err.message, /style only sets --smv-\* properties \(D7\): "color" on "a" is not one/);
      return true;
    },
  );
});

test("styleCommit(): a style fn's --smv-* keys still work exactly as before (no regression)", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  r.styleCommit({ nodes: { a: {} }, style: () => ({ "--smv-fill": "#7c5cff" }) });
  r.frame(visualOf(oneNode));
  const g = r.node("a");
  assert.equal(g.style._p["--smv-fill"], "#7c5cff");
});

test("styleCommit(): the bad key is reported for the offending node's own id, not a fixed placeholder", () => {
  const { root, doc } = makeRoot();
  const r = createRenderer(root, doc);
  assert.throws(
    () => r.styleCommit({
      nodes: { first: { tag: "keep" }, second: { tag: "bad" } },
      style: (n) => (n.tag === "bad" ? { fill: "x" } : { "--smv-fill": "ok" }),
    }),
    /"second"/,
  );
});

// ---------------------------------------------------------------------------
// F18 — status colour composes with the role/props colour instead of losing to it.
// props()/style() write --smv-fill INLINE on the node group, which outranks the status
// rules, so a role-coloured node used to show no done/failed tint at all. Status now
// paints --smv-status-fill, mixed OVER whatever --smv-fill resolved to.
// ---------------------------------------------------------------------------

/** The body of the single `@supports (color:color-mix(...))` block. */
function supportsBlock() {
  const at = CSS.indexOf("@supports (color:color-mix(");
  assert.ok(at >= 0, "the composition is guarded by @supports");
  let depth = 0;
  for (let i = CSS.indexOf("{", at); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(at, i + 1);
  }
  throw new Error("unterminated @supports block");
}

test("styles: the node box paints the status channel over the role fill, with --smv-fill as the fallback", () => {
  const block = supportsBlock();
  assert.match(block, /\.smv-node rect\.smv-node-box\{fill:var\(--smv-status-fill,var\(--smv-fill\)\)\}/);
  // Unguarded, the sheet is exactly what it was: a renderer without color-mix (an exported
  // SVG opened in an older viewer) keeps painting var(--smv-fill) and nothing goes black.
  const before = CSS.slice(0, CSS.indexOf("@supports (color:color-mix("));
  assert.match(before, /\.smv-node rect\.smv-node-box\{\s*fill:var\(--smv-fill\);/);
});

test("styles: every run/spec status defines --smv-status-fill as its token mixed over --smv-fill", () => {
  const block = supportsBlock();
  for (const [attrs, token] of [
    ['\\[data-status="done"\\],\\.smv-node\\[data-run="done"\\]', "--smv-ok"],
    ['\\[data-status="active"\\],\\.smv-node\\[data-run="active"\\]', "--smv-active"],
    ['\\[data-run="failed"\\]', "--smv-fail"],
  ]) {
    const re = new RegExp(
      `\\.smv-node${attrs}\\{\\s*--smv-status-fill:color-mix\\(in srgb,var\\(${token}\\) ` +
      "var\\(--smv-status-mix,70%\\),var\\(--smv-fill\\)\\)[;}]",
    );
    assert.match(block, re, `${token} composes`);
  }
});

test("styles: the status rules still set --smv-fill, so an un-overridden node mixes a colour with itself", () => {
  // That is what keeps the default picture identical: color-mix(X 70%, X) is X. The legacy
  // declarations are also what a theme overriding --smv-ok keeps steering.
  assert.match(CSS, /\.smv-node\[data-status="done"\]\{--smv-fill:var\(--smv-ok\)/);
  assert.match(CSS, /\.smv-node\[data-run="done"\]\{--smv-fill:var\(--smv-ok\)/);
  assert.match(CSS, /\.smv-node\[data-run="failed"\]\{--smv-fill:var\(--smv-fail\)/);
  // --smv-status-mix is themeable, and never defined as a token: 100% restores "status wins".
  assert.equal((CSS.match(/--smv-status-mix:/g) || []).length, 0);
  assert.equal((CSS.match(/var\(--smv-status-mix,70%\)/g) || []).length, 3);
});

test("styles: a collapsed container carrying a spec status takes the status tint over container grey", () => {
  // [data-container] sets --smv-fill AFTER the status rules at equal specificity, so such a
  // node painted plain container grey before F18. It now mixes the status token over that
  // grey, like any other override — documented in THEMING.md's data-* precedence section.
  const status = CSS.indexOf('.smv-node[data-status="done"]{--smv-fill:var(--smv-ok)');
  const container = CSS.indexOf(".smv-node[data-container]{--smv-fill:var(--smv-container)");
  assert.ok(status >= 0 && container > status, "[data-container] still wins --smv-fill");
  // …and the status channel is written regardless of [data-container], which is what makes
  // the tint show through.
  assert.doesNotMatch(supportsBlock(), /data-status="done"\][^{]*:not\(\[data-container\]\)/);
});
