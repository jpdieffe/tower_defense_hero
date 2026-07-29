// Bundles the headless simulation checks with esbuild (already present as a
// Vite dependency) and runs them in Node.
//
//   npm run check:sim

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = await mkdtemp(path.join(tmpdir(), 'bulwark-'));
const outfile = path.join(dir, 'checks.mjs');

await build({
  entryPoints: [path.join(projectDir, 'src/tests/determinism.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

const started = Date.now();
const { runChecks } = await import(pathToFileURL(outfile).href);
const report = runChecks();

console.log('');
for (const line of report.lines) console.log('  ' + line);
console.log(`\n  finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(report.ok ? '\n  ✅ Simulation is deterministic.\n' : '\n  ❌ Determinism check FAILED.\n');

await rm(dir, { recursive: true, force: true });
process.exit(report.ok ? 0 : 1);
