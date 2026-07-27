import { exec } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const packDir = '.brisk-aitesting-pack-check';
const required = [
  'package/dist/index.js',
  'package/dist/index.d.ts',
  'package/dist/cli.js',
  'package/README.md',
  'package/docs/ARCHITECTURE.md',
  'package/docs/STATUS.md',
  'package/docs/ROADMAP.md',
  'package/examples/brisk-aitesting.config.ts',
  'package/examples/host-config-bridge.ts',
  'package/reference-apps/serious-saas/README.md',
  'package/reference-apps/serious-saas/server.mjs',
  'package/reference-apps/serious-saas/openapi.json',
  'package/reference-apps/serious-saas/brisk-aitesting.config.mjs',
  'package/fixtures/golden/serious-saas-plan.json',
  'package/fixtures/golden/serious-saas-result-summary.json',
  'package/assets/logo_transparent.png',
  'package/assets/logo_transparent.ico',
];
const forbiddenPatterns = [
  /^package\/\.env/i,
  /^package\/.*\.env/i,
  /^package\/node_modules\//,
  /^package\/src\//,
  /^package\/smoke\//,
  /^package\/\.git\//,
  /^package\/\.brisk-aitesting/i,
  /^package\/brisk-aitesting-playwright-work\//,
  /^package\/playwright-work\//,
  /^package\/test-results\//,
  /^package\/playwright-report\//,
  /^package\/.*\.log$/i,
];

await rm(packDir, { recursive: true, force: true });
await mkdir(packDir, { recursive: true });

const { stdout } = await execAsync(`npm pack --json --pack-destination ${JSON.stringify(packDir)}`, {
  maxBuffer: 1024 * 1024 * 10,
});
const pack = JSON.parse(stdout)[0];
const files = pack.files.map((entry) => `package/${entry.path.replace(/\\/g, '/')}`).sort();
const errors = [];

for (const path of required) {
  if (!files.includes(path)) errors.push(`missing required package file ${path}`);
}

for (const file of files) {
  if (forbiddenPatterns.some((pattern) => pattern.test(file))) {
    errors.push(`forbidden package file ${file}`);
  }
}

if (pack.entryCount !== files.length) errors.push(`entry count mismatch: ${pack.entryCount} vs ${files.length}`);
if (typeof pack.size !== 'number' || pack.size <= 0) errors.push('package size was not reported');
if (typeof pack.filename !== 'string' || !pack.filename.endsWith('.tgz')) errors.push('npm pack did not produce a tgz filename');

const report = {
  schemaVersion: 'brisk-aitesting.pack-check.v1',
  status: errors.length === 0 ? 'passed' : 'failed',
  tarball: join(packDir, pack.filename),
  files: files.length,
  unpackedSize: pack.unpackedSize,
  required,
  errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 1;
