'use strict';
// Verifies a finished `npm run build` before anything is deployed or started from it:
//
//   node scripts/ops/check-build.cjs [--strict]
//
// Why it exists: `npm run start:prod` runs dist/src/main, and that path is a CONSEQUENCE of tsconfig.build.json (rootDir "." keeps the
// `src/` and `scripts/` folders apart in dist). Anything that changes the layout (a missing rootDir, a plain `tsc` build) used to break
// production start-up silently; this makes it a build-time failure instead. Exit code 1 on a problem; `--strict` also fails on warnings.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, 'dist');
const strict = process.argv.includes('--strict');
const problems = [];
const warnings = [];

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const isCompiledJs = (file) => file.endsWith('.js');

// 1. The files production actually starts.
for (const required of ['src/main.js', 'src/app.module.js', 'src/config/data-source.js', 'scripts/maintenance/super-admin.js']) {
  if (!fs.existsSync(path.join(dist, required))) problems.push(`dist/${required} is missing — run "npm run build" (nest build), not a plain tsc.`);
}
if (fs.existsSync(path.join(dist, 'main.js'))) warnings.push('dist/main.js exists — a leftover from a build with a different layout. start:prod runs dist/src/main.js; delete dist and rebuild.');

// 2. Nothing in the output may still need the @app/* path alias: Node cannot resolve it (the Nest CLI rewrites it; a plain tsc build does not).
const compiled = walk(path.join(dist, 'src')).filter(isCompiledJs);
const aliased = compiled.filter((file) => /require\(["']@app\//.test(fs.readFileSync(file, 'utf8')));
if (aliased.length > 0) problems.push(`${aliased.length} compiled file(s) still require "@app/…" (e.g. ${path.relative(root, aliased[0])}): build with "nest build", which rewrites the alias.`);

// 3. Every migration source has its compiled twin (a missing one would silently skip a schema change).
const migrationSources = fs.readdirSync(path.join(root, 'src', 'migrations')).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.spec.ts'));
const migrationOutputs = new Set(fs.existsSync(path.join(dist, 'src', 'migrations')) ? fs.readdirSync(path.join(dist, 'src', 'migrations')).filter(isCompiledJs) : []);
const missingMigrations = migrationSources.filter((f) => !migrationOutputs.has(f.replace(/\.ts$/, '.js')));
if (missingMigrations.length > 0) problems.push(`${missingMigrations.length} migration(s) were not compiled (e.g. ${missingMigrations[0]}).`);

// 4. Specs and test configuration do not belong in a deployable build.
const stray = walk(dist).filter((f) => /\.(spec|test)\.js$/.test(f) || path.basename(f) === 'jest.config.js');
if (stray.length > 0) warnings.push(`${stray.length} spec/test file(s) were compiled into dist (e.g. ${path.relative(root, stray[0])}).`);

// 5. Compiled files whose source no longer exists (a removed module keeps running from dist until dist is cleaned).
const orphans = compiled.filter((file) => {
  const rel = path.relative(path.join(dist, 'src'), file).replace(/\.js$/, '.ts');
  return !fs.existsSync(path.join(root, 'src', rel));
});
if (orphans.length > 0) warnings.push(`${orphans.length} compiled file(s) in dist/src have no source any more (e.g. ${path.relative(root, orphans[0])}): delete dist and rebuild before deploying, or their code and migrations keep running.`);

for (const w of warnings) console.log('WARN  ' + w);
for (const p of problems) console.log('FAIL  ' + p);
if (problems.length === 0 && (!strict || warnings.length === 0)) {
  console.log(`OK    dist/src/main.js present · ${compiled.length} compiled source files · ${migrationOutputs.size} migrations`);
  process.exit(0);
}
process.exit(1);
