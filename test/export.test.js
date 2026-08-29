import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportSVG, exportPNG } from "../src/export.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

// A minimal fake svg element supporting exactly the DOM surface export.js touches:
// cloneNode, getAttribute/setAttribute/removeAttribute, querySelector, outerHTML.
function fakeSvg() {
  const attrs = new Map([
    ["class", "smv"],
    ["xmlns", "http://www.w3.org/2000/svg"],
  ]);
  const viewport = {
    attrs: new Map([["transform", "translate(10,20) scale(1.5)"]]),
    removeAttribute(name) {
      this.attrs.delete(name);
    },
    get outerHTML() {
      const a = [...this.attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(" ");
      return `<g class="smv-viewport" ${a}><g class="smv-edges"></g><g class="smv-nodes"><g class="smv-node" data-id="a"><text>Ingest &amp; Go</text></g></g></g>`;
    },
  };
  const el = {
    attrs,
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    cloneNode() {
      return fakeSvg();
    },
    querySelector(sel) {
      return sel === ".smv-viewport" ? viewport : null;
    },
    get outerHTML() {
      const a = [...attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(" ");
      return `<svg ${a}>${viewport.outerHTML}</svg>`;
    },
  };
  return el;
}

function fakeG(overrides = {}) {
  return {
    renderer: { svg: fakeSvg() },
    bounds: () => ({ x: 10, y: 5, w: 200, h: 100 }),
    el: { getAttribute: (n) => (n === "data-smv-theme" ? "dark" : null) },
    ...overrides,
  };
}

test("exportSVG: throws without a mounted instance", () => {
  assert.throws(() => exportSVG({}), /mounted instance/);
  assert.throws(() => exportSVG(null), /mounted instance/);
});

test("exportSVG: embeds a <style> tag with the theme CSS", () => {
  const svg = exportSVG(fakeG());
  assert.match(svg, /<style>/);
  assert.match(svg, /--smv-fill/); // a real CSS custom property from styles.js
});

test("exportSVG: viewBox is bounds expanded by pad (default 24)", () => {
  const svg = exportSVG(fakeG());
  // bounds {x:10,y:5,w:200,h:100}, pad 24 -> x-24 y-24 w+48 h+48
  assert.match(svg, /viewBox="-14 -19 248 148"/);
});

test("exportSVG: custom pad changes the viewBox math", () => {
  const svg = exportSVG(fakeG(), { pad: 10 });
  assert.match(svg, /viewBox="0 -5 220 120"/);
});

test("exportSVG: width option scales height to preserve aspect ratio", () => {
  const svg = exportSVG(fakeG(), { width: 496 }); // 2x natural width (248)
  assert.match(svg, /width="496"/);
  assert.match(svg, /height="296"/); // 2x natural height (148)
});

test("exportSVG: sets xmlns and xmlns:xlink", () => {
  const svg = exportSVG(fakeG());
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
});

test("exportSVG: theme resolves from opts, else the mount root, else 'auto'", () => {
  assert.match(exportSVG(fakeG(), { theme: "light" }), /data-smv-theme="light"/);
  assert.match(exportSVG(fakeG()), /data-smv-theme="dark"/); // from mount root (g.el)
  assert.match(exportSVG(fakeG({ el: null })), /data-smv-theme="auto"/);
});

test("exportSVG: adds smv-root class so themed custom properties resolve", () => {
  const svg = exportSVG(fakeG());
  assert.match(svg, /class="smv smv-root"/);
});

test("exportSVG: strips the live pan/zoom transform from the viewport group", () => {
  const svg = exportSVG(fakeG());
  assert.doesNotMatch(svg, /class="smv-viewport" transform=/);
});

test("exportSVG: passes through rendered node markup", () => {
  const svg = exportSVG(fakeG());
  assert.match(svg, /data-id="a"/);
  assert.match(svg, /Ingest &amp; Go/);
});

test("exportPNG: rejects with a clear Error under Node", async () => {
  await assert.rejects(exportPNG(fakeG()), /browser environment/);
});

// --- integration: exportSVG against the real renderer (not the hand-rolled fake) -----

function makeRealEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    parent: null,
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    textContent: "",
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      return c;
    },
    querySelector(sel) {
      const cls = sel.replace(".", "");
      const find = (n) => {
        if ((n.attrs.class || "").split(/\s+/).includes(cls)) return n;
        for (const c of n.children) {
          const r = find(c);
          if (r) return r;
        }
        return null;
      };
      return find(this);
    },
    cloneNode(deep) {
      const c = makeRealEl(this.tagName);
      c.attrs = { ...this.attrs };
      c.textContent = this.textContent;
      if (deep) c.children = this.children.map((ch) => ch.cloneNode(true));
      return c;
    },
    get outerHTML() {
      const a = Object.entries(this.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      const inner = (this.children.map((c) => c.outerHTML || "").join("")) + (this.textContent || "");
      return `<${this.tagName}${a ? " " + a : ""}>${inner}</${this.tagName}>`;
    },
  };
  return el;
}

test("exportSVG: works against a real createRenderer() svg, not just the fake", async () => {
  const { createRenderer } = await import("../src/render.js");
  const fakeDoc = { createElementNS: (_ns, t) => makeRealEl(t) };
  const root = makeRealEl("div");
  const r = createRenderer(root, fakeDoc);
  r.styleCommit({
    nodes: { a: { id: "a", label: "Alpha" } },
    edges: {},
    style: null,
    sizes: { a: { w: 60, h: 32 } },
  });
  r.frame({ nodes: new Map([["a", { x: 50, y: 30, w: 60, h: 32, opacity: 1 }]]), edges: new Map() });

  const g = { renderer: r, bounds: () => ({ x: 0, y: 0, w: 100, h: 60 }), el: null };
  const svg = exportSVG(g);
  assert.match(svg, /<svg\b/);
  assert.match(svg, /viewBox="-24 -24 148 108"/);
  assert.match(svg, /<style>/);
  assert.match(svg, /data-id="a"/);
  assert.match(svg, /Alp/); // label text, truncated to fit the 60px-wide node under the estimator
});

// --- CLI smoke test -------------------------------------------------------------

test("smv-pack CLI: produces self-contained HTML containing the spec and the IIFE", () => {
  const iifePath = join(root, "dist", "smv.iife.min.js");
  if (!existsSync(iifePath)) {
    // Contract: don't shell out to build from inside export.js; the test suite may,
    // since a missing dist/ here just means `npm run build` hasn't run yet in this
    // checkout, not a bug in the CLI itself.
    execFileSync("node", [join(root, "scripts", "build.js")], { cwd: root, stdio: "inherit" });
  }
  assert.ok(existsSync(iifePath), "dist/smv.iife.min.js must exist to smoke-test the CLI");

  const dir = mkdtempSync(join(tmpdir(), "smv-pack-"));
  const specPath = join(dir, "spec.json");
  const spec = { nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], edges: [{ id: "e1", source: "a", target: "b" }] };
  writeFileSync(specPath, JSON.stringify(spec));
  const outPath = join(dir, "out.html");

  execFileSync("node", [join(root, "bin", "smv-pack.mjs"), specPath, "-o", outPath, "--title", "Demo Pipeline"], {
    cwd: root,
  });

  assert.ok(existsSync(outPath));
  const html = readFileSync(outPath, "utf8");
  assert.match(html, /<title>Demo Pipeline<\/title>/);
  assert.match(html, /"id":"a"/);
  assert.match(html, /"id":"e1"/);
  assert.match(html, /var SparkleMotion/); // IIFE marker from dist/smv.iife.min.js
  assert.match(html, /SparkleMotion\.mount/);
  assert.match(html, /"controls":true/);
});

test("smv-pack CLI: exits 1 with instructions when dist is missing", () => {
  // bin/smv-pack.mjs resolves dist/ relative to its own location (../dist), so
  // reproduce a "no build yet" checkout by copying just the bin/ script into a fresh
  // package tree with no dist/ directory.
  const dir = mkdtempSync(join(tmpdir(), "smv-pack-nodist-"));
  const pkgBin = join(dir, "bin");
  mkdirSync(pkgBin, { recursive: true });
  copyFileSync(join(root, "bin", "smv-pack.mjs"), join(pkgBin, "smv-pack.mjs"));
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify({ nodes: [], edges: [] }));

  assert.throws(() => {
    execFileSync("node", [join(pkgBin, "smv-pack.mjs"), specPath], { cwd: dir, stdio: "pipe" });
  }, (err) => {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /run npm run build first/);
    return true;
  });
});
