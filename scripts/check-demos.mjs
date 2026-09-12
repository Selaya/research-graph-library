#!/usr/bin/env node
// Smoke-check demo pages in headless chromium.
//   node scripts/check-demos.mjs demo/foo.html [demo/bar.html ...] [--screenshot DIR] [--wait MS]
//   node scripts/check-demos.mjs --all            # every demo/*.html except index.html
//
// For each page: serve the repo over http, open `<page>?auto=1`, wait for
// `window.__smvExit.done === true` when the page defines that hook (up to --timeout, default
// 60s) or for --wait ms (default 4000) when it doesn't, then assert: no page errors, no
// console errors, no `[smv:` misuse warnings, at least one `.smv-node` rendered, every node
// transform / edge path finite. Optionally writes `<DIR>/<basename>.png`.
// Exits 1 if any page fails.

import { chromium } from "playwright-core";
import { readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { findChromium, serveRoot, ROOT } from "./harness.mjs";

const argv = process.argv.slice(2);
const opt = { screenshot: null, wait: 4000, timeout: 60000, all: false };
const pages = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--screenshot") opt.screenshot = argv[++i];
  else if (a === "--wait") opt.wait = Number(argv[++i]);
  else if (a === "--timeout") opt.timeout = Number(argv[++i]);
  else if (a === "--all") opt.all = true;
  else pages.push(a);
}
if (opt.all) {
  for (const f of readdirSync(join(ROOT, "demo"))) {
    if (f.endsWith(".html") && f !== "index.html") pages.push("demo/" + f);
  }
}
if (!pages.length) {
  console.error("usage: node scripts/check-demos.mjs demo/<page>.html [...] [--screenshot DIR] [--wait MS] | --all");
  process.exit(2);
}
if (opt.screenshot) mkdirSync(opt.screenshot, { recursive: true });

const { server, port } = await serveRoot();
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

let anyFail = false;
try {
  for (const rel of pages) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const problems = [];
    page.on("console", (m) => {
      const t = m.type();
      const text = m.text();
      if (t === "error") problems.push("console.error: " + text);
      else if (t === "warning" && /\[smv:/.test(text)) problems.push("smv warning: " + text);
    });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("requestfailed", (r) => problems.push("request failed: " + r.url()));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

    const sep = rel.includes("?") ? "&" : "?";
    const url = `http://127.0.0.1:${port}/${rel}${sep}auto=1`;
    let hook = false;
    try {
      await page.goto(url, { waitUntil: "load" });
      // Pages usually install the hook synchronously, but give a deferred install a moment.
      hook = await page.waitForFunction("typeof window.__smvExit === 'object' && window.__smvExit !== null", null, { timeout: 1500 })
        .then(() => true, () => false);
      if (hook) {
        await page.waitForFunction("window.__smvExit && window.__smvExit.done === true", null, { timeout: opt.timeout });
      } else {
        await page.waitForTimeout(opt.wait);
      }
    } catch (e) {
      problems.push("load/wait: " + e.message.split("\n")[0]);
    }

    let info = { nodes: 0, edges: 0, badNodes: [], badEdges: [], exitErrors: [] };
    try {
      info = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll(".smv-node")].map((g) => {
          const m = /translate\(\s*([-\d.e+]+)\s*,\s*([-\d.e+]+)\s*\)/i.exec(g.getAttribute("transform") || "");
          return { id: g.getAttribute("data-id"), x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN };
        });
        const edges = [...document.querySelectorAll(".smv-edge")].map((g) => ({
          id: g.getAttribute("data-id"),
          d: (g.querySelector("path.smv-edge-line") || {}).getAttribute?.("d") || "",
        }));
        const exit = window.__smvExit || {};
        return {
          nodes: nodes.length,
          edges: edges.length,
          badNodes: nodes.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y)).map((n) => n.id),
          badEdges: edges.filter((e) => !e.d || /NaN|Infinity/.test(e.d)).map((e) => e.id),
          exitErrors: Array.isArray(exit.errors) ? exit.errors : [],
        };
      });
    } catch (e) {
      problems.push("evaluate: " + e.message.split("\n")[0]);
    }
    if (info.nodes === 0) problems.push("no .smv-node rendered");
    if (info.badNodes.length) problems.push("non-finite node transforms: " + info.badNodes.join(", "));
    if (info.badEdges.length) problems.push("non-finite/empty edge paths: " + info.badEdges.join(", "));
    for (const e of info.exitErrors) problems.push("__smvExit.errors: " + e);

    if (opt.screenshot) {
      try {
        await page.screenshot({ path: join(opt.screenshot, basename(rel).replace(/\.html.*$/, "") + ".png"), fullPage: false });
      } catch (e) {
        problems.push("screenshot: " + e.message.split("\n")[0]);
      }
    }

    const ok = problems.length === 0;
    anyFail ||= !ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${rel}  nodes=${info.nodes} edges=${info.edges} ${hook ? "(waited for __smvExit.done)" : `(waited ${opt.wait}ms)`}`);
    for (const p of problems) console.log("      - " + p);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(anyFail ? 1 : 0);
