# Releasing to npm

The package is wired so publishing is just versioning + `npm publish`:

- `prepack` rebuilds `dist/` (so the tarball always carries fresh bundles —
  `smv-pack`, the CDN entry points, and the script-tag quickstart all depend on it).
- `prepublishOnly` runs the full gate: tests, build, size budget, and the type check.
- The `files` whitelist keeps the tarball to `src`, `dist`, `types`, `bin`, and
  `scripts/harness.mjs`; `LICENSE`, `README.md`, and `package.json` ship automatically.

## Steps

1. Make sure `main` is green and your working tree is clean.
2. Bump the version (this also creates the git tag):

   ```bash
   npm version patch   # or minor / major
   ```

3. Publish (runs `prepublishOnly` + `prepack` first; add `--dry-run` to rehearse):

   ```bash
   npm publish
   ```

   First publish of the name requires being logged in (`npm login`). The package is
   unscoped, so no `--access public` flag is needed.

4. Push the commit and tag:

   ```bash
   git push && git push --tags
   ```

5. Sanity-check the result: `npm view sparkle-motion-vizualizer version`, and load
   `https://cdn.jsdelivr.net/npm/sparkle-motion-vizualizer` in a scratch HTML page —
   the `unpkg`/`jsdelivr` fields point that URL at `dist/smv.iife.min.js`.

## Version discipline

While pre-1.0, treat minor bumps as the breaking-change lane (`0.2.0`) and patch
bumps as everything else, matching how npm ranges treat `^0.x`.
