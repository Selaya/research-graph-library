#!/usr/bin/env node
// Smoke-check demo pages in headless chromium.
//   node scripts/check-demos.mjs demo/foo.html [demo/bar.html ...] [--screenshot DIR] [--wait MS]
//   node scripts/check-demos.mjs --all            # every demo/*.html except index.html
//
// For each page: serve the repo over http, open `<page>?auto=1`, wait for the page's
// "story finished" signal (up to --timeout, default 60s), then assert: no page errors, no
// console errors, no `[smv:` misuse warnings, at least one `.smv-node` rendered, every node
// transform / edge path finite. Optionally writes `<DIR>/<basename>.png`.
//
// Two finish signals, either of which a page may offer:
//   - `window.smv` (or `window.__smv`) = the mounted instance, and `g.finished` resolves
//     when the story ends — the library's own convention (mount opts `autoplay: 'auto'`
//     honours the `?auto=1` this script appends, and `g.finish()` ends a live-mode page).
//   - `window.__smvExit = { done, errors }` — the older page-rolled hook, still honoured,
//     and preferred when a page has both, since it also carries the page's own error list.
// A page with neither is simply given --wait ms (default 4000).
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

/** Which finish signal the page offers, as a string the poll returns once it is there. */
const SIGNAL = `(() => {
  if (window.__smvExit && typeof window.__smvExit === "object") return "__smvExit";
  const g = window.smv || window.__smv;
  return g && g.finished && typeof g.finished.then === "function" ? "finished" : false;
})()`;

/** Latch g.finished onto a plain flag so waitForFunction (and --timeout) can own the wait. */
const LATCH = `(() => {
  window.__smvFinished = false;
  (window.smv || window.__smv).finished.then(() => { window.__smvFinished = true; });
})()`;

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
    let hook = null;
    try {
      await page.goto(url, { waitUntil: "load" });
      // Pages usually install a hook synchronously, but give a deferred install a moment.
      // `__smvExit` wins when both are present: it also carries the page's own error list.
      hook = await page.waitForFunction(SIGNAL, null, { timeout: 1500 })
        .then((h) => h.jsonValue(), () => null);
      if (hook === "__smvExit") {
        await page.waitForFunction("window.__smvExit && window.__smvExit.done === true", null, { timeout: opt.timeout });
      } else if (hook === "finished") {
        // g.finished is a promise, and waitForFunction polls — so latch it onto a flag the
        // poll can read, which keeps --timeout in charge instead of hanging in evaluate().
        await page.evaluate(LATCH);
        await page.waitForFunction("window.__smvFinished === true", null, { timeout: opt.timeout });
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
    const waited = hook === "finished" ? "(waited for smv.finished)"
      : hook === "__smvExit" ? "(waited for __smvExit.done)" : `(waited ${opt.wait}ms)`;
    console.log(`${ok ? "PASS" : "FAIL"}  ${rel}  nodes=${info.nodes} edges=${info.edges} ${waited}`);
    for (const p of problems) console.log("      - " + p);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(anyFail ? 1 : 0);
