// M0 exit criterion, end to end in a real browser.
//   node test/e2e-m0.mjs
// Serves the repo over http (file:// breaks module/script loading rules), drives
// demo/m0.html?auto=1 in headless chromium and asserts the three M0 invariants:
// no runtime errors, the back edge never flips sides across 5 overlapping appends
// (D3 consistent-side), and every rendered node position is finite.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_MS = 30000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** playwright-core ships no browsers; this image pre-installs them under /opt. */
function findChromium() {
  const direct = "/opt/pw-browsers/chromium";
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  const bases = ["/opt/pw-browsers", process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = join(base, entry, rel);
        if (existsSync(p) && statSync(p).isFile()) return p;
      }
    }
  }
  throw new Error("no chromium binary found under /opt/pw-browsers");
}

function serveRoot() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/favicon.ico") { res.writeHead(204).end(); return; } // browser-initiated, not the page's
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      const file = join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
      const s = await stat(file);
      if (s.isDirectory()) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const fail = [];
const pass = [];
const check = (ok, label, detail = "") => (ok ? pass : fail).push(label + (detail ? " — " + detail : ""));

const { server, port } = await serveRoot();
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

let result;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(`http://127.0.0.1:${port}/demo/m0.html?auto=1`, { waitUntil: "load" });
  await page.waitForFunction("window.__smvExit && window.__smvExit.done === true", null, { timeout: TIMEOUT_MS });

  result = await page.evaluate(() => {
    const num = (s) => (s == null ? NaN : Number(s));
    const nodes = [...document.querySelectorAll("#pipe .smv-node")].map((g) => {
      const m = /translate\(\s*([-\d.e+]+)\s*,\s*([-\d.e+]+)\s*\)/i.exec(g.getAttribute("transform") || "");
      const r = g.querySelector("rect");
      return {
        id: g.getAttribute("data-id"),
        x: m ? Number(m[1]) : NaN,
        y: m ? Number(m[2]) : NaN,
        w: num(r && r.getAttribute("width")),
        h: num(r && r.getAttribute("height")),
        opacity: num(g.getAttribute("opacity")),
      };
    });
    const edges = [...document.querySelectorAll("#pipe .smv-edge")].map((g) => ({
      id: g.getAttribute("data-id"),
      reversed: g.hasAttribute("data-reversed"),
      d: (g.querySelector("path.smv-edge-line") || {}).getAttribute?.("d") || "",
      arrow: (g.querySelector("path.smv-edge-arrow") || {}).getAttribute?.("transform") || "",
    }));
    return { exit: window.__smvExit, nodes, edges };
  });

  const { exit, nodes, edges } = result;

  // 1 — no runtime errors.
  check(Array.isArray(exit.errors) && exit.errors.length === 0,
    "errors array empty", JSON.stringify(exit.errors));
  check(consoleErrors.length === 0, "no console/page errors", JSON.stringify(consoleErrors));

  // 2 — the back edge never flips sides across the 5 overlapping appends (D3).
  const sides = exit.backEdgeSides || [];
  check(sides.length === 5, "5 recorded commits", `got ${sides.length}: ${JSON.stringify(sides)}`);
  check(sides.length > 0 && sides.every((s) => s === "below"),
    'every backEdgeSides entry === "below"', JSON.stringify(sides));

  // 3 — every rendered node position finite (and actually laid out, not collapsed to 0/0
  // by the renderer's non-finite guard).
  const bad = nodes.filter((n) => ![n.x, n.y, n.w, n.h, n.opacity].every(Number.isFinite));
  check(nodes.length === 15, "15 nodes rendered (10 base + 5 appended)", `got ${nodes.length}`);
  check(bad.length === 0, "all rendered node positions finite", JSON.stringify(bad));
  const spread = nodes.length > 1 &&
    Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x)) > 1;
  check(spread, "nodes are spread out (no NaN->0 collapse)");
  check(nodes.every((n) => n.w > 0 && n.h > 0), "all node rects have positive size");

  const badEdges = edges.filter((e) => !e.d || /NaN|Infinity/.test(e.d) || /NaN|Infinity/.test(e.arrow));
  check(badEdges.length === 0, "all edge paths finite", JSON.stringify(badEdges.map((e) => e.id)));
  const loop = edges.find((e) => e.id === "retry");
  check(!!loop && loop.reversed, "back edge 'retry' rendered with data-reversed");

  console.log("nodes: " + nodes.length + "  edges: " + edges.length);
  console.log("backEdgeSides: " + JSON.stringify(sides));
} finally {
  await browser.close();
  server.close();
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(fail.length === 0 ? "\ne2e-m0: PASS" : `\ne2e-m0: FAIL (${fail.length})`);
process.exit(fail.length === 0 ? 0 : 1);
