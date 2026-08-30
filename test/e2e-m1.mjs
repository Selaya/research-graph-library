// M1 exit criterion, end to end in a real browser.
//   node test/e2e-m1.mjs
// Serves the repo over http (file:// breaks module/script loading rules), drives
// demo/pipeline.html?auto=1 in headless chromium and asserts the §7 M1 exit: one static
// page with ONE script tag plays the whole §6 narrative — 3-way fan-out at different
// rates, an `all`-join, a retry loop ticking to 3 of 5, expand into 3 substeps, condense
// to one node with the 2h -> 8s odometer — and scrubs backward and forward with no
// corruption and no NaN anywhere.

import { chromium } from "playwright-core";
import { findChromium, serveRoot } from "../scripts/harness.mjs";

const TIMEOUT_MS = 90000;

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

  await page.goto(`http://127.0.0.1:${port}/demo/pipeline.html?auto=1`, { waitUntil: "load" });
  await page.waitForFunction("window.__smvM1 && window.__smvM1.done === true", null, { timeout: TIMEOUT_MS });

  const result = await page.evaluate(() => {
    const num = (s) => (s == null ? NaN : Number(s));
    const nodes = [...document.querySelectorAll("#pipe .smv-node")].map((g) => {
      const m = /translate\(\s*([-\d.e+]+)\s*,\s*([-\d.e+]+)\s*\)/i.exec(g.getAttribute("transform") || "");
      const r = g.querySelector("rect.smv-node-box");
      return {
        id: g.getAttribute("data-id"),
        x: m ? Number(m[1]) : NaN,
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
      weight: g.getAttribute("data-weight"),
      d: (g.querySelector("path.smv-edge-line") || {}).getAttribute?.("d") || "",
      arrow: (g.querySelector("path.smv-edge-arrow") || {}).getAttribute?.("transform") || "",
    }));
    return {
      m1: window.__smvM1,
      nodes,
      edges,
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
      tokenLayers: document.querySelectorAll("#pipe .smv-tokens").length,
      transports: document.querySelectorAll("#pipe .smv-transport").length,
      totalBars: document.querySelectorAll("#pipe .smv-totalbar").length,
      totalBarText: (document.querySelector("#pipe .smv-totalbar-label") || {}).textContent || "",
      styleSheets: document.querySelectorAll("style[data-smv-styles]").length,
      chips: [...document.querySelectorAll("#pipe text.smv-chip")].map((t) => t.textContent),
    };
  });

  const { m1, nodes, edges } = result;
  const c = m1.checks || {};

  // 0 — the single-file embed premise (R1): exactly one library script tag.
  check(result.scripts.length === 1 && /smv\.iife\.min\.js$/.test(result.scripts[0]),
    "ONE <script src> — the built IIFE", JSON.stringify(result.scripts));
  check(result.styleSheets === 1, "one deduped injected stylesheet", String(result.styleSheets));

  // 1 — zero errors.
  check(Array.isArray(m1.errors) && m1.errors.length === 0, "page reported no errors", JSON.stringify(m1.errors));
  check(consoleErrors.length === 0, "no console/page errors", JSON.stringify(consoleErrors));

  // 2 — 3-way fan-out: three concurrent tokens, at visibly different branch rates (R8).
  check(c.fanOutTokens === 3, "3 concurrent tokens across the fan-out", `got ${c.fanOutTokens}`);
  const bp = c.branchProgress;
  check(!!bp, "a fan-out instant was sampled", JSON.stringify(bp));
  if (bp) {
    const vals = [bp.lint, bp.unit, bp.e2e];
    check(vals.every((v) => Number.isFinite(v)), "branch progresses are numbers", JSON.stringify(vals));
    check(new Set(vals.map((v) => v.toFixed(4))).size === 3, "three DISTINCT branch progresses", JSON.stringify(vals));
    check(bp.lint > bp.unit && bp.unit > bp.e2e, "lint sprints, e2e crawls", JSON.stringify(vals));
    check(c.branchSpread > 0.15, "the branches are visibly apart (spread > .15)", String(c.branchSpread));
  }

  // 3 — the all-join fires only once all three arrived.
  check(c.joinNeeded === 3, "the join expects all 3 in-edges", String(c.joinNeeded));
  check(c.joinArrivedAtFire === 3, "join fired with 3 arrivals", String(c.joinArrivedAtFire));
  check(!!c.joinEvent && c.joinEvent.arrived === 3 && c.joinEvent.needed === 3,
    "the engine's own join event says 3/3", JSON.stringify(c.joinEvent));

  // 4 — the retry loop ticks to the run's cap of 3, on an edge whose max is 5 (R7/D4).
  check(c.loopIteration === 3, "loop ticked to iteration 3", String(c.loopIteration));
  check(c.loopMax === 5, "…of the edge's declared max 5", String(c.loopMax));
  check(/^iter 3\/5$/.test(c.loopBadge || ""), 'loop badge reads "iter 3/5"', JSON.stringify(c.loopBadge));

  // 5 — expand grows the container into its three substeps (R4/D5).
  check(c.substepsAfterExpand === 3, "expand revealed 3 substeps", String(c.substepsAfterExpand));
  check(c.containerExpandedAfterExpand === true, "…and the container is no longer collapsed");

  // 6 — condense leaves one node in their place, chip odometered to 8s (R5/D6).
  check(c.substepsAfterCondense === 0, "the 3 substeps are gone after condense", String(c.substepsAfterCondense));
  check(c.odometerAfterCondense === "8s", 'the merged node\'s chip landed on "8s"', JSON.stringify(c.odometerAfterCondense));
  check(c.containerChipAfterCondense === "8s", "…and the container's durationAgg rollup followed it",
    JSON.stringify(c.containerChipAfterCondense));
  check(c.scrubBack && c.scrubBack.nodes - c.nodesAfterCondense === 2,
    "condense removed 3 nodes and added 1", `${c.scrubBack && c.scrubBack.nodes} -> ${c.nodesAfterCondense}`);

  // 7 — scrub BACKWARD to the marker before the condense: the substeps are back.
  const back = c.scrubBack || {};
  check(back.label === "automate", 'scrubbed back to the "automate" marker', JSON.stringify(back.label));
  check(back.substeps === 3, "the 3 substeps are on screen again", JSON.stringify(back));
  check(back.mergedPresent === false, "…and the merged node is gone");
  check(back.expanded === true, "…with the container still expanded there");

  // 8 — and FORWARD to the end: the condense replays cleanly from the snapshot.
  const fwd = c.scrubForward || {};
  check(fwd.substeps === 0, "scrubbing forward re-condenses the substeps", JSON.stringify(fwd));
  check(fwd.mergedPresent === true, "…the merged node is back");
  check(fwd.chip === "8s", '…and its chip is "8s" again', JSON.stringify(fwd.chip));
  check(fwd.done === true, "the storyboard is at its end");

  // 9 — no corruption: nothing NaN, every rendered geometry finite.
  check(Array.isArray(c.nan) && c.nan.length === 0, "no NaN/Infinity anywhere in the DOM", JSON.stringify(c.nan));
  const bad = nodes.filter((n) => ![n.x, n.y, n.w, n.h].every(Number.isFinite));
  check(bad.length === 0, "all rendered node positions finite", JSON.stringify(bad));
  check(nodes.every((n) => n.w > 0 && n.h > 0), "all node rects have positive size");
  const spread = nodes.length > 1 && Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x)) > 1;
  check(spread, "nodes are spread out (no NaN->0 collapse)");
  const badEdges = edges.filter((e) => !e.d || /NaN|Infinity/.test(e.d) || /NaN|Infinity/.test(e.arrow));
  check(badEdges.length === 0, "all edge paths finite", JSON.stringify(badEdges.map((e) => e.id)));

  // 10 — the finished picture: merged node present, loop arc still a back edge, chrome up.
  const ids = nodes.map((n) => n.id);
  check(ids.includes("clean.auto"), "the merged node is in the final DOM");
  check(ids.includes("clean") && nodes.find((n) => n.id === "clean").container, "…inside the container it replaced");
  check(nodes.filter((n) => n.run === "done").length >= 8, "the run left most steps marked done",
    String(nodes.filter((n) => n.run === "done").length));
  check(edges.some((e) => e.id === "retry" && e.reversed), "the retry arc is still tagged as a back edge");
  check(edges.some((e) => e.traversed), "traversed edges kept their progress channel");
  check(result.tokenLayers === 1, "exactly one g.smv-tokens layer", String(result.tokenLayers));
  check(result.transports === 1, "the transport bar is mounted", String(result.transports));
  check(result.totalBars === 1, "the preset's total-duration bar is mounted", String(result.totalBars));
  check(result.chips.includes("45m") && result.chips.includes("8s"),
    "duration chips render (45m … 8s)", JSON.stringify(result.chips));

  console.log("nodes: " + nodes.length + "  edges: " + edges.length + "  total bar: " + result.totalBarText);
  console.log("checks: " + JSON.stringify(c.branchProgress) + "  loop " + c.loopIteration + "/" + c.loopMax);
} finally {
  await browser.close();
  server.close();
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(fail.length === 0 ? "\ne2e-m1: PASS" : `\ne2e-m1: FAIL (${fail.length})`);
process.exit(fail.length === 0 ? 0 : 1);
