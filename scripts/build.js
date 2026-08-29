// Builds dist/smv.esm.js, dist/smv.iife.min.js, dist/smv.core.esm.js from src/index.js.
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const entry = join(root, 'src', 'index.js');
const outdir = join(root, 'dist');

if (!existsSync(entry)) {
  console.error(`build: entry ${entry} does not exist yet — nothing to build.`);
  process.exit(2);
}

mkdirSync(outdir, { recursive: true });

async function build() {
  // full ESM bundle, dagre included, unminified
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outdir, 'smv.esm.js'),
    bundle: true,
    format: 'esm',
    minify: false,
    platform: 'browser',
  });

  // IIFE bundle, minified, dagre included, global SparkleMotion
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outdir, 'smv.iife.min.js'),
    bundle: true,
    format: 'iife',
    globalName: 'SparkleMotion',
    minify: true,
    platform: 'browser',
  });
  // index.js has named + default exports; esbuild assigns the whole module
  // namespace to the IIFE global. Unwrap so SparkleMotion.mount is callable.
  appendFileSync(
    join(outdir, 'smv.iife.min.js'),
    '\nSparkleMotion=SparkleMotion.default??SparkleMotion;\n'
  );

  // core-size metric only: dagre marked external, minified ESM
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outdir, 'smv.core.esm.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    external: ['@dagrejs/dagre'],
  });
}

build().then(() => {
  console.log('build: wrote dist/smv.esm.js, dist/smv.iife.min.js, dist/smv.core.esm.js');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
