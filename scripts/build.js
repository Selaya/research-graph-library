// Builds dist/smv.esm.js, dist/smv.iife.min.js, dist/smv.core.esm.js from src/index.js.
//
// M3: nothing on the default path imports @dagrejs/dagre any more — src/layout.js drives
// the in-house engine, and the dagre solver lives in the ESM-only src/adapters/dagre.js,
// which no bundle here entry-points. assertNoDagre() below turns that from an intention
// into a build failure.
import { existsSync, mkdirSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const entry = join(root, 'src', 'index.js');
const outdir = join(root, 'dist');
// The core-size metric bundle is a CI artifact, not a deliverable — see below. package.json
// packs the whole of `dist`, so it has to live somewhere `files` does not name.
const metricdir = join(root, 'build');

if (!existsSync(entry)) {
  console.error(`build: entry ${entry} does not exist yet — nothing to build.`);
  process.exit(2);
}

mkdirSync(outdir, { recursive: true });
mkdirSync(metricdir, { recursive: true });
// A metric bundle left in dist by an older checkout would still be published.
rmSync(join(outdir, 'smv.core.esm.js'), { force: true });

// The stylesheets ship as template literals, so esbuild's minifier never sees them as CSS
// and their prose comments, indentation and line breaks ride into every bundle — a couple
// of KB gzip that only the source needs. This runs the `…CSS = `…`` constants through
// esbuild's own CSS minifier for the MINIFIED bundles (the unminified dist/smv.esm.js
// keeps them verbatim, same as it keeps JS comments). Using the real CSS printer rather
// than a regex is what makes the whitespace safe to collapse: it knows a space inside a
// selector is a combinator and a space inside `font:` shorthand is a value separator.
//
// Two escaping hazards, because the result goes back into a template literal:
//  - going IN, `\`, a backtick or a `${` in the source text would mean something to JS
//    that it does not mean to a CSS parser, so such a stylesheet is left alone entirely;
//  - coming OUT, the CSS printer emits its own escapes (`content:"· "` prints as the CSS
//    escape `"\b7 "`), and `\b` in a template literal is JS's backspace — so every
//    backslash the printer produced is re-escaped for the literal it lands in.
const stripCssComments = {
  name: 'strip-css-comments',
  setup(b) {
    b.onLoad({ filter: /src[\\/].*\.js$/ }, (args) => {
      const text = readFileSync(args.path, 'utf8');
      if (!/CSS\s*=\s*`/.test(text)) return null;
      return {
        loader: 'js',
        contents: text.replace(/(CSS\s*=\s*`)([^`]*)(`)/g, (m, open, css, close) =>
          open + minifyCss(css) + close),
      };
    });
  },
};

/** Minified CSS body, or a comment-stripped one if it is not safe to re-embed. */
function minifyCss(css) {
  if (!/[\\`]|\$\{/.test(css)) {
    const { code, warnings } = esbuild.transformSync(css, { loader: 'css', minify: true });
    if (!warnings.length) return forTemplateLiteral(code.replace(/\n$/, ''));
  }
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n');
}

/** Escape what a `…` literal would otherwise read as JS syntax rather than as text. */
const forTemplateLiteral = (s) => s.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${');

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
    plugins: [stripCssComments],
  });
  // index.js has named + default exports; esbuild assigns the whole module
  // namespace to the IIFE global. Unwrap so SparkleMotion.mount is callable.
  appendFileSync(
    join(outdir, 'smv.iife.min.js'),
    '\nSparkleMotion=SparkleMotion.default??SparkleMotion;\n'
  );

  // core-size metric only ("core, no layout" — plan §8's public commitment). Through M2
  // that meant `external: ['@dagrejs/dagre']`; from M3 the layout engine is ours and lives
  // in src/engine.js, so THAT is what gets subtracted.
  //
  // Written to build/, NOT dist/: `external: ['./engine.js']` leaves an unresolvable import
  // in it, so it is a broken module the moment anyone loads it — and package.json's `files`
  // packs all of dist, which is how "never shipped" quietly became 106KB of dead, broken
  // code in every published tarball. The size gate reads it from here.
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(metricdir, 'smv.core.esm.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    plugins: [stripCssComments],
    external: ['./engine.js'],
  });
}

/**
 * No dagre in any default bundle (INTERNALS "Build, size and tests"). Module
 * specifiers and dagre's inlined graphlib are banned from every output; the two minified
 * bundles additionally may not contain the string at all (their comments are stripped, so
 * a hit there can only be code). The unminified ESM keeps source comments, some of which
 * legitimately explain what dagre used to do.
 */
function assertNoDagre() {
  const files = [
    { name: 'smv.esm.js', dir: outdir, strict: false },
    { name: 'smv.iife.min.js', dir: outdir, strict: true },
    { name: 'smv.core.esm.js', dir: metricdir, strict: true },
  ];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(f.dir, f.name), 'utf8');
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
  console.log('build: wrote dist/smv.esm.js, dist/smv.iife.min.js (+ build/smv.core.esm.js, metric only)');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
