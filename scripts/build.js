// Builds dist/smv.esm.js, dist/smv.iife.min.js, dist/smv.core.esm.js from src/index.js.
//
// M3: nothing on the default path imports @dagrejs/dagre any more — src/layout.js drives
// the in-house engine, and the dagre solver lives in the ESM-only src/adapters/dagre.js,
// which no bundle here entry-points. assertNoDagre() below turns that from an intention
// into a build failure.
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
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

  // core-size metric only ("core, no layout" — plan §8's public commitment). Through M2
  // that meant `external: ['@dagrejs/dagre']`; from M3 the layout engine is ours and lives
  // in src/engine.js, so THAT is what gets subtracted. Metric bundle, never shipped.
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outdir, 'smv.core.esm.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    external: ['./engine.js'],
  });
}

/**
 * No dagre in any default bundle (INTERNALS §Gates / plan §8 M3 budget). Module
 * specifiers and dagre's inlined graphlib are banned from every output; the two minified
 * bundles additionally may not contain the string at all (their comments are stripped, so
 * a hit there can only be code). The unminified ESM keeps source comments, some of which
 * legitimately explain what dagre used to do.
 */
function assertNoDagre() {
  const files = [
    { name: 'smv.esm.js', strict: false },
    { name: 'smv.iife.min.js', strict: true },
    { name: 'smv.core.esm.js', strict: true },
  ];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(outdir, f.name), 'utf8');
    if (/@dagrejs|graphlib/i.test(src)) bad.push(`${f.name}: bundles @dagrejs/graphlib code`);
    else if (f.strict && /dagre/i.test(src)) bad.push(`${f.name}: contains "dagre"`);
  }
  if (bad.length) {
    console.error('build: dagre leaked into a default bundle —\n  ' + bad.join('\n  '));
    process.exit(1);
  }
  console.log('build: verified no dagre in any default bundle');
}

build().then(() => {
  assertNoDagre();
  console.log('build: wrote dist/smv.esm.js, dist/smv.iife.min.js, dist/smv.core.esm.js');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
