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
  'package/CHANGELOG.md',
  'package/adapters/manifest.json',
  'package/docs/ARCHITECTURE.md',
  'package/docs/STATUS.md',
  'package/docs/ROADMAP.md',
  'package/docs/GETTING_STARTED.md',
  'package/docs/CONFIGURATION.md',
  'package/docs/API_REFERENCE.md',
  'package/docs/SECURITY.md',
  'package/docs/COMPATIBILITY.md',
  'package/docs/COMPETITIVE_COMPARISON.md',
  'package/docs/TROUBLESHOOTING.md',
  'package/docs/RELEASE.md',
  'package/examples/brisk-aitesting.config.ts',
  'package/examples/host-config-bridge.ts',
  'package/examples/README.md',
  'package/examples/sdk-basic.ts',
  'package/examples/cli-basic.md',
  'package/examples/openapi-api-generation.ts',
  'package/examples/ui-grounded-flow.ts',
  'package/examples/schema-fuzzing.ts',
  'package/examples/replay-http.ts',
  'package/examples/live-message-flow.ts',
  'package/examples/pact-message.ts',
  'package/examples/schemathesis-adapter.ts',
  'package/examples/specmatic-adapter.ts',
  'package/examples/custom-engine.ts',
  'package/examples/custom-ai-provider.ts',
  'package/examples/ci-github-actions.yml',
  'package/reference-apps/serious-saas/README.md',
  'package/reference-apps/serious-saas/server.mjs',
  'package/reference-apps/serious-saas/openapi.json',
  'package/reference-apps/serious-saas/brisk-aitesting.config.mjs',
  'package/reference-apps/api-only/README.md',
  'package/reference-apps/api-only/server.mjs',
  'package/reference-apps/api-only/openapi.json',
  'package/reference-apps/todo/README.md',
  'package/reference-apps/todo/server.mjs',
  'package/reference-apps/todo/openapi.json',
  'package/reference-apps/multi-tenant/README.md',
  'package/reference-apps/multi-tenant/server.mjs',
  'package/reference-apps/multi-tenant/openapi.json',
  'package/reference-apps/e-commerce/README.md',
  'package/reference-apps/e-commerce/server.mjs',
  'package/reference-apps/e-commerce/openapi.json',
  'package/reference-apps/event-messaging/README.md',
  'package/reference-apps/event-messaging/server.mjs',
  'package/reference-apps/event-messaging/openapi.json',
  'package/reference-apps/event-messaging/asyncapi.json',
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
  /^package\/dist\/keploy/i,
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
