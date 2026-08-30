// Shared e2e plumbing: find the pre-installed chromium, and serve a directory over http.
// One copy of each — test/e2e-m0..m3.mjs and bin/smv-record.mjs all import from here
// (the four e2e scripts each carried a byte-identical private copy until M4b).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root — the default document root, and where the e2e demos live. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** playwright-core ships no browsers; this image pre-installs them under /opt. */
export function findChromium() {
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

/** Serve `root` (the repo by default) over http — file:// breaks module/script loading
 *  rules. Resolves `{server, port}` on a random free port. */
export function serveRoot(root = ROOT) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/favicon.ico") { res.writeHead(204).end(); return; } // browser-initiated, not the page's
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      const file = join(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403).end("forbidden"); return; }
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
