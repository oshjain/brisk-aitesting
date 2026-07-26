import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);
const workDir = join(packageDir, '.brisk-aitesting-cli-smoke');

const server = createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('CLI smoke server did not expose a port');

try {
  const configPath = join(workDir, 'brisk-aitesting.config.mjs');
  const outputPath = join(workDir, 'cli-output-result.json');
  await writeFile(configPath, cliSmokeConfig(address.port, workDir), 'utf8');

  const success = await runCli([
    'run',
    '--config',
    configPath,
    '--goal',
    'CLI smoke health API',
    '--scenarios',
    '1',
    '--json',
    '--output',
    outputPath,
  ]);

  const errors = [];
  if (success.code !== 0) errors.push(`expected success exit 0, got ${success.code}: ${success.stderr}`);
  const parsed = parseStdoutJson(success.stdout);
  if (parsed.schemaVersion !== 'brisk-aitesting.cli-result.v1') errors.push('wrong CLI JSON schema');
  if (parsed.status !== 'passed') errors.push(`expected CLI status passed, got ${parsed.status}`);
  if (parsed.summary?.total !== 1 || parsed.summary?.passed !== 1) errors.push('CLI summary did not report 1/1 passed');
  if (parsed.resultPath !== outputPath) errors.push('CLI JSON did not report custom output path');
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  if (written.schemaVersion !== 'brisk-aitesting.result.v1') errors.push('CLI output file missing result schema');

  const usage = await runCli(['run', '--config', configPath, '--scenarios', '0']);
  if (usage.code !== 2) errors.push(`expected usage exit 2, got ${usage.code}`);
  if (!usage.stderr.includes('--scenarios must be a positive integer')) errors.push('usage error did not explain invalid scenarios');

  if (errors.length > 0) {
    console.error(JSON.stringify({ status: 'failed', errors, success, usage }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      status: 'passed',
      cliSchema: parsed.schemaVersion,
      exitCode: success.code,
      usageExitCode: usage.code,
      resultPath: outputPath,
    }, null, 2));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function cliSmokeConfig(port, artifactsRoot) {
  return `import { defineConfig } from '../dist/index.js';

export default defineConfig({
  app: {
    name: 'CLI smoke app',
    baseUrl: 'http://127.0.0.1:${port}',
    env: 'local',
  },
  aiProvider: {
    name: 'cli-smoke-provider',
    async complete() {
      return {
        content: JSON.stringify({
          mode: 'automatic',
          scenarios: [{
            id: 'cli_smoke_health_api',
            name: 'CLI smoke health API',
            type: 'api',
            objective: 'Health endpoint responds through the CLI.',
            target: { method: 'GET', path: '/api/health' },
            expect: { status: 200, json: { ok: true } },
            assertions: ['status is 200', 'json.ok is true'],
            evidenceRequired: ['api']
          }]
        })
      };
    }
  },
  runtime: {
    artifactsDir: ${JSON.stringify(join(artifactsRoot, 'artifacts'))},
    timeoutMs: 30000,
    retries: 0,
    headless: true,
    dryRun: false,
  },
  discovery: {
    includeRepo: false,
    includeUi: false,
    includeApi: true,
    includeContracts: false,
  },
  security: {
    networkPolicy: 'localhost-only',
    allowedHosts: ['127.0.0.1', 'localhost'],
    redactSecrets: true,
  },
});
`;
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(packageDir, 'dist', 'cli.js'), ...args], {
      cwd: packageDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseStdoutJson(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`CLI stdout did not contain JSON: ${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1));
}
