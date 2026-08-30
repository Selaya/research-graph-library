// M3 exit criterion, end to end in a real browser.
//   node test/e2e-m3.mjs
// Serves the repo over http (file:// breaks module/script loading rules), drives
// demo/pipeline.html?auto=1 (UNCHANGED from M1 — the in-house engine swap is a layout.js
// solver-seam change, not a demo change) and asserts the §6 narrative still plays end to
// end on the in-house engine, plus the M3-specific gates from INTERNALS.md's "M3 exit"
// section: no dagre in the built IIFE, the size budget passes at 50KB, structural visual
// parity (left-to-right stage order, containers contain their children, no overlaps, no
// NaN), and a 300-node synthetic graph (demo/m3-scale.html) mounts with viewport culling
// active — nothing culled at the initial fit, plenty culled once zoomed into a corner —
// with per-frame pan cost measured and reported for the compositor-offload decision
// (docs/DEVIATIONS.md item 10).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, constants as zlibConstants } from "node:zlib";
import { chromium } from "playwright-core";
import { ROOT, findChromium, serveRoot } from "../scripts/harness.mjs";

const TIMEOUT_MS = 90000;
const IIFE_LIMIT = 50 * 1024;

const fail = [];
const pass = [];
const check = (ok, label, detail = "") => (ok ? pass : fail).push(label + (detail ? " — " + detail : ""));

// ---------------------------------------------------------------------------
// (b) dist gate: no "dagre" substring in the minified IIFE, and it fits the 50KB gzip
// budget. Per the integration agent's note: grep the IIFE (comments are stripped by
// minification, so any hit can only be code), never the unminified smv.esm.js — that file
// legitimately keeps a source comment mentioning what dagre's useDynamic used to do.
// ---------------------------------------------------------------------------
const iifePath = join(ROOT, "dist", "smv.iife.min.js");
let iifeSrc = "";
try {
  iifeSrc = readFileSync(iifePath, "utf8");
  check(!/dagre/i.test(iifeSrc), 'dist/smv.iife.min.js contains no "dagre" substring');
} catch (err) {
  check(false, "dist/smv.iife.min.js exists and is readable", String(err));
}
if (iifeSrc) {
  const raw = Buffer.byteLength(iifeSrc, "utf8");
  const gz = gzipSync(readFileSync(iifePath), { level: zlibConstants.Z_BEST_COMPRESSION }).length;
  check(gz < IIFE_LIMIT, `IIFE min+gzip under the 50KB M3 budget`, `${(gz / 1024).toFixed(2)}KB raw=${(raw / 1024).toFixed(2)}KB`);
  console.log(`dist/smv.iife.min.js: raw ${(raw / 1024).toFixed(2)}KB, gzip ${(gz / 1024).toFixed(2)}KB (limit ${(IIFE_LIMIT / 1024).toFixed(0)}KB)`);
}

const { server, port } = await serveRoot();
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  // ===========================================================================
  // (a)+(c) — demo/pipeline.html?auto=1, UNCHANGED from M1. If loading/mounting it needs
  // any change at all, that alone is a finding (the in-house engine sits behind the exact
  // same layout() seam dagre used).
  // ===========================================================================
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(`http://127.0.0.1:${port}/demo/pipeline.html?auto=1`, { waitUntil: "load" });
  await page.waitForFunction("window.__smvM1 && window.__smvM1.done === true", null, { timeout: TIMEOUT_MS });

  const result = await page.evaluate(() => {
    const num = (s) => (s == null ? NaN : Number(s));
    const nodes = [...document.querySelectorAll("#pipe .smv-node")].map((g) => {
      const m = /translate\(\s*([-\d.e+]+)\s*,\s*([-\d.e+]+)\s*\)/i.exec(g.getAttribute("transform") || "");
      const r = g.querySelector("rect.smv-node-box");
      return {
        id: g.getAttribute("data-id"),
        x: m ? Number(m[1]) : NaN,     // top-left (render.js: translate(x - w/2, y - h/2))
        y: m ? Number(m[2]) : NaN,
        w: num(r && r.getAttribute("width")),
        h: num(r && r.getAttribute("height")),
        container: g.hasAttribute("data-container"),
        run: g.getAttribute("data-run"),
      };
    });
    const edges = [...document.querySelectorAll("#pipe .smv-edge")].map((g) => ({
      id: g.getAttribute("data-id"),
      reversed: g.hasAttribute("data-reversed"),
      traversed: g.hasAttribute("data-traversed"),
      d: (g.querySelector("path.smv-edge-line") || {}).getAttribute?.("d") || "",
    }));
    return {
      m1: window.__smvM1,
      nodes,
      edges,
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
    };
  });

  const { m1, nodes, edges } = result;
  const c = m1.checks || {};

  // --- (a) reprise of e2e-m1's key checks, on the in-house engine ---
  check(result.scripts.length === 1 && /smv\.iife\.min\.js$/.test(result.scripts[0]),
    "ONE <script src> — the built IIFE (demo unchanged)", JSON.stringify(result.scripts));
  check(Array.isArray(m1.errors) && m1.errors.length === 0, "page reported no errors", JSON.stringify(m1.errors));
  check(consoleErrors.length === 0, "no console/page errors", JSON.stringify(consoleErrors));
  check(c.fanOutTokens === 3, "3 concurrent tokens across the fan-out", `got ${c.fanOutTokens}`);
  const bp = c.branchProgress;
  check(!!bp && bp.lint > bp.unit && bp.unit > bp.e2e, "lint sprints, e2e crawls (branch rates preserved)",
    JSON.stringify(bp));
  check(c.joinNeeded === 3 && c.joinArrivedAtFire === 3, "the all-join fires with 3/3 arrivals",
    `${c.joinArrivedAtFire}/${c.joinNeeded}`);
  check(c.loopIteration === 3 && c.loopMax === 5, "retry loop ticks to 3 of max 5",
    `${c.loopIteration}/${c.loopMax}`);
  check(c.substepsAfterExpand === 3, "expand revealed 3 substeps", String(c.substepsAfterExpand));
  check(c.substepsAfterCondense === 0 && c.odometerAfterCondense === "8s",
    'condense left 1 node, chip odometered to "8s"', JSON.stringify({ substeps: c.substepsAfterCondense, chip: c.odometerAfterCondense }));
  check(!!c.scrubBack && c.scrubBack.substeps === 3 && c.scrubBack.mergedPresent === false,
    "scrub back restores the 3 substeps", JSON.stringify(c.scrubBack));
  check(!!c.scrubForward && c.scrubForward.mergedPresent === true && c.scrubForward.chip === "8s",
    "scrub forward re-condenses cleanly", JSON.stringify(c.scrubForward));
  check(Array.isArray(c.nan) && c.nan.length === 0, "no NaN/Infinity anywhere in the DOM (m1 checks)",
    JSON.stringify(c.nan));

  // --- (c) structural visual parity ---
  const bad = nodes.filter((n) => ![n.x, n.y, n.w, n.h].every(Number.isFinite));
  check(bad.length === 0, "every rendered node has finite geometry", JSON.stringify(bad));
  check(nodes.every((n) => n.w > 0 && n.h > 0), "every rendered node has positive size");

  // Forward (non-reversed) edges must strictly advance left-to-right along the DAG's rank
  // axis (LR layout): parse each path's polyline and check the last point's x >= first's,
  // with a small epsilon for rounding. The one reversed edge (the retry loop) is excluded —
  // it is a back edge by definition and is checked separately below.
  function pathXs(d) {
    const xs = [];
    const re = /-?\d+(?:\.\d+)?/g;
    const nums = (d.match(re) || []).map(Number);
    for (let i = 0; i < nums.length; i += 2) xs.push(nums[i]);
    return xs;
  }
  const forwardEdges = edges.filter((e) => !e.reversed && e.d);
  const backEdges = edges.filter((e) => e.reversed && e.d);
  const regressed = forwardEdges.filter((e) => {
    const xs = pathXs(e.d);
    return xs.length < 2 || xs[xs.length - 1] < xs[0] - 0.5;
  });
  check(forwardEdges.length > 0, "at least one forward edge was rendered to check", String(forwardEdges.length));
  check(regressed.length === 0, "every forward edge advances left-to-right along the DAG",
    JSON.stringify(regressed.map((e) => e.id)));
  check(backEdges.length >= 1, "the retry loop is still tagged as a back edge", String(backEdges.length));

  // Container containment: the pipeline's only surviving container at story-end is "clean",
  // holding the condensed "clean.auto" as its sole child (store.condense() inherits the
  // common parent of the condensed set — docs read, not a demo-side assumption).
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const clean = byId["clean"], auto = byId["clean.auto"];
  check(!!clean && clean.container, '"clean" is still rendered as a container after condense');
  if (clean && auto) {
    const insideX = auto.x >= clean.x - 0.5 && auto.x + auto.w <= clean.x + clean.w + 0.5;
    const insideY = auto.y >= clean.y - 0.5 && auto.y + auto.h <= clean.y + clean.h + 0.5;
    check(insideX && insideY, "the container's child sits strictly inside its rect",
      JSON.stringify({ clean, auto }));
  }

  // No pairwise node overlaps, except the one known container/child containment pair above.
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  const overlapPairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const isKnownContainment = (a.id === "clean" && b.id === "clean.auto") || (b.id === "clean" && a.id === "clean.auto");
      if (isKnownContainment) continue;
      if (overlaps(a, b)) overlapPairs.push([a.id, b.id]);
    }
  }
  check(overlapPairs.length === 0, "no unexpected pairwise node overlaps", JSON.stringify(overlapPairs));

  console.log("pipeline nodes: " + nodes.length + "  edges: " + edges.length +
    "  forward: " + forwardEdges.length + "  back: " + backEdges.length);

  // ===========================================================================
  // (d) demo/m3-scale.html — 300-node synthetic graph, culling + frame-cost profiling.
  // ===========================================================================
  const scalePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const scaleErrors = [];
  scalePage.on("console", (m) => { if (m.type() === "error") scaleErrors.push(m.text()); });
  scalePage.on("pageerror", (e) => scaleErrors.push("pageerror: " + e.message));

  await scalePage.goto(`http://127.0.0.1:${port}/demo/m3-scale.html?auto=1`, { waitUntil: "load" });
  await scalePage.waitForFunction("window.__smvM3Scale && window.__smvM3Scale.done === true", null, { timeout: TIMEOUT_MS });

  const scale = await scalePage.evaluate(() => window.__smvM3Scale);
  const sc = scale.checks || {};

  check(Array.isArray(scale.errors) && scale.errors.length === 0, "m3-scale page reported no errors",
    JSON.stringify(scale.errors));
  check(scaleErrors.length === 0, "no console/page errors on m3-scale", JSON.stringify(scaleErrors));
  check(sc.totalNodes === 300, "the synthetic graph has exactly 300 nodes", String(sc.totalNodes));
  check(sc.totalGroups > 150, "total rendered groups are above the culling threshold (150)", String(sc.totalGroups));
  check(sc.culledAtFit === 0, "nothing is culled at the initial fit (whole graph visible)", String(sc.culledAtFit));
  check(sc.culledZoomed > 0, "zooming into a corner culls a real fraction of groups", String(sc.culledZoomed));
  check(sc.culledZoomed > sc.totalGroups * 0.3,
    "…specifically, more than 30% of groups are culled once zoomed in", `${sc.culledZoomed}/${sc.totalGroups}`);
  // The demo zooms in with no pointer event at all, so this also gates that a purely
  // programmatic viewport move re-arms the cull pass at all.
  check(sc.culledAfterFit === 0,
    "fitView() un-culls everything again (a programmatic move re-arms culling)", String(sc.culledAfterFit));
  check(Array.isArray(sc.nan) && sc.nan.length === 0, "no NaN/Infinity anywhere in the m3-scale DOM", JSON.stringify(sc.nan));
  check(Number.isFinite(sc.frameMedianMs) && sc.frameMedianMs >= 0, "pan frame median is a finite number",
    String(sc.frameMedianMs));
  check(sc.frameSamples > 30, "enough pan frames were sampled over 2s to be meaningful", String(sc.frameSamples));

  console.log(`m3-scale: nodes=${sc.totalNodes} groups=${sc.totalGroups} culledAtFit=${sc.culledAtFit} ` +
    `culledZoomed=${sc.culledZoomed}/${sc.totalGroups} culledAfterFit=${sc.culledAfterFit} ` +
    `panMedian=${sc.frameMedianMs?.toFixed(2)}ms ` +
    `panMean=${sc.frameMeanMs?.toFixed(2)}ms panMax=${sc.frameMaxMs?.toFixed(2)}ms samples=${sc.frameSamples}`);

  // Compositor-offload decision rule (docs/DEVIATIONS.md item 10, plan §7 M3): if the
  // median frame on the 300-node run is <= 8ms headless, the "not justified at v1 scale"
  // verdict stands as recorded; otherwise this is a finding for the orchestrator.
  const OFFLOAD_THRESHOLD_MS = 8;
  if (Number.isFinite(sc.frameMedianMs)) {
    check(sc.frameMedianMs <= OFFLOAD_THRESHOLD_MS,
      `median pan frame <= ${OFFLOAD_THRESHOLD_MS}ms — compositor offload not justified at v1 scale`,
      `${sc.frameMedianMs.toFixed(2)}ms`);
  }

  await scalePage.close();
} finally {
  await browser.close();
  server.close();
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(fail.length === 0 ? "\ne2e-m3: PASS" : `\ne2e-m3: FAIL (${fail.length})`);
process.exit(fail.length === 0 ? 0 : 1);
