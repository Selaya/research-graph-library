// Runs the build, then hard-fails if gzip'd bundle sizes exceed budget (docs/PLAN.md §8).
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

// dagre-era budget; M3 (in-house layout) tightens the IIFE limit to 50KB.
const CORE_LIMIT = 40 * 1024;
const IIFE_LIMIT = 56 * 1024;

const result = spawnSync('node', [join(__dirname, 'build.js')], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error('size-budget: build failed');
  process.exit(result.status ?? 1);
}

function gzipSize(path) {
  const buf = readFileSync(path);
  const gz = gzipSync(buf, { level: zlibConstants.Z_BEST_COMPRESSION });
  return { raw: buf.length, gzip: gz.length };
}

const targets = [
  { name: 'smv.core.esm.js', path: join(dist, 'smv.core.esm.js'), limit: CORE_LIMIT },
  { name: 'smv.iife.min.js', path: join(dist, 'smv.iife.min.js'), limit: IIFE_LIMIT },
];

let failed = false;
const rows = [];
for (const t of targets) {
  let sizes;
  try {
    sizes = gzipSize(t.path);
  } catch (err) {
    console.error(`size-budget: could not read ${t.path}: ${err.message}`);
    process.exit(1);
  }
  const over = sizes.gzip >= t.limit;
  if (over) failed = true;
  rows.push({ ...t, ...sizes, over });
}

const fmt = n => `${(n / 1024).toFixed(2)}KB`;
console.log('\nfile                   raw       gzip      limit     status');
console.log('----------------------------------------------------------------');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(22)} ${fmt(r.raw).padEnd(9)} ${fmt(r.gzip).padEnd(9)} ${fmt(r.limit).padEnd(9)} ${r.over ? 'FAIL' : 'ok'}`
  );
}
console.log('');

if (failed) {
  console.error('size-budget: one or more bundles exceeded their gzip budget.');
  process.exit(1);
}
console.log('size-budget: all bundles within budget.');
