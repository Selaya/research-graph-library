// M2 exit criterion, end to end in a real browser.
//   node test/e2e-m2.mjs
// Serves the repo over http (file:// breaks module/script loading rules), drives
// demo/m2.html?auto=1 in headless chromium and asserts the §7 M2 exit: Mode B "live" run
// (scripted start/finish/spawn, occupancy badge, time-travel seek clamped at "now", events
// landing again after follow()); condense()->split() round trip (1 node becomes 3, edges
// redirected); an edge label tracking its edge through a relayout; collapseAll/expandAll
// flipping every container in one transition; full keyboard/ARIA nav driven with REAL
// keyboard events; and exportSVG/exportPNG via an ESM import of ../src/export.js.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_MS = 90000;

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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(`http://127.0.0.1:${port}/demo/m2.html?auto=1`, { waitUntil: "load" });
  await page.waitForFunction("window.__smvM2 && window.__smvM2.done === true", null, { timeout: TIMEOUT_MS });
  await page.waitForFunction("!!window.__smvExport", null, { timeout: 5000 });

  const state = await page.evaluate(() => {
    const num = (s) => (s == null ? NaN : Number(s));
    const nodes = [...document.querySelectorAll("#stage .smv-node")].map((g) => {
      const m = /translate\(\s*([-\d.e+]+)\s*,\s*([-\d.e+]+)\s*\)/i.exec(g.getAttribute("transform") || "");
      const r = g.querySelector("rect.smv-node-box");
      return {
        id: g.getAttribute("data-id"),
        x: m ? Number(m[1]) : NaN,
        y: m ? Number(m[2]) : NaN,
        w: num(r && r.getAttribute("width")),
        h: num(r && r.getAttribute("height")),
        role: g.getAttribute("role"),
        ariaExpanded: g.getAttribute("aria-expanded"),
        tabindex: g.getAttribute("tabindex"),
      };
    });
    return {
      m2: window.__smvM2,
      nodes,
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
      styleSheets: document.querySelectorAll("style[data-smv-styles]").length,
      treeRole: (document.querySelector("#stage .smv-nodes") || {}).getAttribute?.("role"),
    };
  });

  const { m2, nodes } = state;
  const c = m2.checks || {};

  // 0 — zero errors, the injected stylesheet exists once.
  check(Array.isArray(m2.errors) && m2.errors.length === 0, "page reported no errors", JSON.stringify(m2.errors));
  check(consoleErrors.length === 0, "no console/page errors", JSON.stringify(consoleErrors));
  check(state.styleSheets === 1, "one deduped injected stylesheet", String(state.styleSheets));

  // 1 — live mode: scripted start/finish/spawn, occupancy badge, time-travel + clamp + follow.
  check(c.liveNowDone === 2, "before scrubbing back: ingest + build both done", `got ${c.liveNowDone}`);
  check(c.livePastDone === 1, "seek(pastT) shows FEWER done nodes (only ingest)", `got ${c.livePastDone}`);
  check(c.livePastDone < c.liveNowDone, "past state strictly precedes the later state", `${c.livePastDone} vs ${c.liveNowDone}`);
  check(c.liveFollowingAfterSeek === false, "seek() detaches from the frontier (following=false)");
  check(c.liveOccupancyBadge === "×3", 'the ×3 occupancy badge rendered after spawn(id,3)', JSON.stringify(c.liveOccupancyBadge));
  check(c.liveOccupancyState === 3, "state().nodes.buffer.occupancy === 3", String(c.liveOccupancyState));
  check(c.liveClampOk === true, "seek(1e9) clamps to now() — time() === now()");
  check(c.liveFollowingAfterFollow === true, "follow() re-attaches (following=true)");
  check(c.liveAfterFollowStatus === "active", "a new start() lands once following again", JSON.stringify(c.liveAfterFollowStatus));

  // 2 — split: condense() -> split() round trip, 1 node becomes 3, edges redirected.
  const afterCondense = c.afterCondenseNodes || [];
  check(!afterCondense.includes("prep.a") && !afterCondense.includes("prep.b") && !afterCondense.includes("prep.c"),
    "condense() removed the 3 sources", JSON.stringify(afterCondense));
  check(afterCondense.includes("prep.auto"), "…and left the merged node in their place");
  check(!!c.condenseInEdge && c.condenseInEdge.source === "ingest", "the merged node's incoming edge still comes from ingest",
    JSON.stringify(c.condenseInEdge));
  check(!!c.condenseOutEdge && c.condenseOutEdge.target === "build", "…and its outgoing edge still reaches build",
    JSON.stringify(c.condenseOutEdge));

  const afterSplit = c.afterSplitNodes || [];
  check(!afterSplit.includes("prep.auto"), "split() removed the merged node", JSON.stringify(afterSplit));
  check(["prep.x", "prep.y", "prep.z"].every((id) => afterSplit.includes(id)),
    "…and left exactly the 3 new nodes (1 -> 3, animated bloom)", JSON.stringify(afterSplit));
  check(!!c.splitInEdge && c.splitInEdge.id === (c.condenseInEdge && c.condenseInEdge.id) && c.splitInEdge.target === "prep.x",
    "the former incoming edge redirected to the entry node (SAME edge id — store round-trips)", JSON.stringify(c.splitInEdge));
  check(!!c.splitOutEdge && c.splitOutEdge.id === (c.condenseOutEdge && c.condenseOutEdge.id) && c.splitOutEdge.source === "prep.z",
    "the former outgoing edge redirected FROM the exit node", JSON.stringify(c.splitOutEdge));

  // 3 — labels: the "final" edge label survives a relayout and keeps tracking its edge.
  const lb = c.labelBefore, la = c.labelAfter;
  check(!!lb && lb.text === "final", "edge label rendered before the relayout", JSON.stringify(lb));
  check(!!la && la.text === "final", "…and still rendered (same text) after it", JSON.stringify(la));
  if (lb && la) {
    check([lb.x, lb.y, la.x, la.y].every(Number.isFinite), "label positions are finite both times");
    check(lb.x !== la.x || lb.y !== la.y, "the label's position actually MOVED with the relayout",
      `(${lb.x},${lb.y}) -> (${la.x},${la.y})`);
  }

  // 4 — collapseAll/expandAll: every container flips in one transition.
  const before = c.beforeExpandAll || [], afterExp = c.afterExpandAll || [], afterColl = c.afterCollapseAll || [];
  const kids = ["verifyA.unit", "verifyA.e2e", "verifyB.unit", "verifyB.e2e"];
  check(kids.every((id) => !before.includes(id)), "both containers start collapsed (no children on screen)");
  check(kids.every((id) => afterExp.includes(id)), "expandAll() reveals every container's children in one go",
    JSON.stringify(afterExp));
  check(kids.every((id) => !afterColl.includes(id)), "collapseAll() hides them all again", JSON.stringify(afterColl));

  // 5 — no corruption anywhere.
  check(Array.isArray(c.nan) && c.nan.length === 0, "no NaN/Infinity anywhere in the DOM", JSON.stringify(c.nan));
  const badGeom = nodes.filter((n) => ![n.x, n.y, n.w, n.h].every(Number.isFinite) || n.w <= 0 || n.h <= 0);
  check(badGeom.length === 0, "every rendered node has finite, positive geometry", JSON.stringify(badGeom));

  // 6 — a11y baseline: every node is a treeitem; containers report aria-expanded.
  check(state.treeRole === "tree", 'the nodes group carries role="tree"');
  check(nodes.length > 0 && nodes.every((n) => n.role === "treeitem"), "every rendered node has role=treeitem",
    JSON.stringify(nodes.filter((n) => n.role !== "treeitem").map((n) => n.id)));
  const verifyA0 = nodes.find((n) => n.id === "verifyA");
  check(!!verifyA0 && verifyA0.ariaExpanded === "false", 'the collapsed container starts aria-expanded="false"',
    JSON.stringify(verifyA0));

  // ---------------------------------------------------------------------------
  // 7 — a11y keyboard nav, driven with REAL keyboard events (playwright), reading
  // roles/aria-expanded/activeElement straight off the live page.
  // ---------------------------------------------------------------------------
  const startTab = await page.$('#stage .smv-node[tabindex="0"]');
  check(!!startTab, "exactly one node carries the roving tabindex=0");
  if (startTab) await startTab.click();

  const readingOrder = await page.evaluate(() => {
    const lr = window.__g.layoutResult();
    return Object.keys(lr.nodes).sort((a, b) => {
      const na = lr.nodes[a], nb = lr.nodes[b];
      return na.x !== nb.x ? na.x - nb.x : na.y - nb.y;
    });
  });
  const activeId = () => page.evaluate(() => {
    const el = document.activeElement;
    return el && el.getAttribute ? el.getAttribute("data-id") : null;
  });

  await page.keyboard.press("Home");
  const first = await activeId();
  check(first === readingOrder[0], "Home focuses the first node in reading order (x then y)",
    `${first} vs ${readingOrder[0]}`);

  const visited = [first];
  const steps = Math.min(readingOrder.length - 1, 12);
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("ArrowRight");
    visited.push(await activeId());
  }
  check(JSON.stringify(visited) === JSON.stringify(readingOrder.slice(0, steps + 1)),
    "ArrowRight walks the reading order exactly, node by node (activeElement observed live)",
    JSON.stringify({ visited, expected: readingOrder.slice(0, steps + 1) }));

  await page.keyboard.press("End");
  const last = await activeId();
  check(last === readingOrder[readingOrder.length - 1], "End focuses the last node in reading order", last);

  // Enter toggles a container: navigate back to verifyA (still collapsed — nothing
  // structural has changed yet) and press Enter.
  await page.keyboard.press("Home");
  let landedOnA = (await activeId()) === "verifyA";
  for (let i = 0; i < readingOrder.length && !landedOnA; i++) {
    await page.keyboard.press("ArrowRight");
    landedOnA = (await activeId()) === "verifyA";
  }
  check(landedOnA, "keyboard nav can reach the verifyA container");
  const expandedBefore = await page.evaluate(() =>
    document.querySelector('#stage .smv-node[data-id="verifyA"]').getAttribute("aria-expanded"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400); // the expand relayout settles on the shared clock
  const expandedAfter = await page.evaluate(() =>
    document.querySelector('#stage .smv-node[data-id="verifyA"]').getAttribute("aria-expanded"));
  const childVisible = await page.evaluate(() => !!document.querySelector('#stage .smv-node[data-id="verifyA.unit"]'));
  check(expandedBefore === "false", "verifyA was collapsed (aria-expanded=false) before Enter");
  check(expandedAfter === "true", "Enter on a focused container flips aria-expanded to true", expandedAfter);
  check(childVisible, "…and its child is now actually in the DOM (real expand, not just the attribute)");

  // ---------------------------------------------------------------------------
  // 8 — exports: exportSVG (parse + content) and exportPNG (decode dimensions), driven
  // live via the ESM import the page's own module script made.
  // ---------------------------------------------------------------------------
  const svgCheck = await page.evaluate(() => {
    const g = window.__g;
    const svg = window.__smvExport.exportSVG(g);
    const hasStyle = /<style[\s>]/.test(svg);
    const labels = [...document.querySelectorAll("#stage text.smv-node-label")]
      .map((t) => t.textContent).filter(Boolean);
    const missing = labels.filter((l) => !svg.includes(l));
    let parseOk = false, parseError = "";
    try {
      const doc = new DOMParser().parseFromString(svg, "application/xml");
      parseOk = !doc.querySelector("parsererror");
    } catch (err) { parseError = String(err); }
    return { length: svg.length, hasStyle, labels, missing, parseOk, parseError, hasSvgTag: /<svg[\s>]/.test(svg) };
  });
  check(svgCheck.hasSvgTag && svgCheck.length > 200, "exportSVG() returned a real <svg> document", String(svgCheck.length));
  check(svgCheck.hasStyle, "…with an inlined <style> block (themed CSS)");
  check(svgCheck.parseOk, "…that parses cleanly as XML", svgCheck.parseError || JSON.stringify(svgCheck));
  check(svgCheck.labels.length > 0 && svgCheck.missing.length === 0,
    "…and contains every currently-visible node label", JSON.stringify(svgCheck.missing));

  const pngCheck = await page.evaluate(async () => {
    const g = window.__g;
    const bounds = g.bounds();
    const pad = 24, scale = 2;
    const w = Math.max(0, (bounds.w || 0) + pad * 2);
    const h = Math.max(0, (bounds.h || 0) + pad * 2);
    const expected = { w: Math.max(1, Math.round(w)) * scale, h: Math.max(1, Math.round(h)) * scale };
    const blob = await window.__smvExport.exportPNG(g);
    const bmp = await createImageBitmap(blob);
    const actual = { w: bmp.width, h: bmp.height };
    bmp.close();
    return { type: blob.type, size: blob.size, actual, expected };
  });
  check(pngCheck.type === "image/png", "exportPNG() resolved an image/png Blob", pngCheck.type);
  check(pngCheck.size > 0, "…with non-zero byte size", String(pngCheck.size));
  check(pngCheck.actual.w === pngCheck.expected.w && pngCheck.actual.h === pngCheck.expected.h,
    "…decoded dimensions match bounds × scale exactly", JSON.stringify(pngCheck));

  console.log("nodes: " + nodes.length + "  reading order: " + JSON.stringify(readingOrder));
  console.log("live: now=" + c.liveNowDone + " past=" + c.livePastDone + " occ=" + c.liveOccupancyBadge);
  console.log("png: " + JSON.stringify(pngCheck));
} finally {
  await browser.close();
  server.close();
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(fail.length === 0 ? "\ne2e-m2: PASS" : `\ne2e-m2: FAIL (${fail.length})`);
process.exit(fail.length === 0 ? 0 : 1);
