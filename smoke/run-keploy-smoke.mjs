import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBriskAiTesting,
  defineConfig,
  KeployCliEngine,
  runEnginePluginConformance,
} from '../dist/index.js';
import { createApiOnlyServer } from '../reference-apps/api-only/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);
const hasKeploy = process.env.BRISK_AITESTING_KEPLOY_COMMAND !== undefined || existsSync('/usr/local/bin/keploy') || existsSync('/usr/bin/keploy');

if (!hasKeploy && process.env.BRISK_AITESTING_REQUIRE_KEPLOY !== 'true') {
  console.log(JSON.stringify({
    schemaVersion: 'brisk-aitesting.keploy-smoke.v1',
    status: 'skipped',
    reason: 'Keploy CLI is not available on PATH. Install Keploy to run the real record/test adapter smoke.',
    errors: [],
  }, null, 2));
  process.exit(0);
}

const server = createApiOnlyServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('api-only reference app did not expose a TCP port');

try {
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const config = defineConfig({
    app: {
      name: 'API-only reference app',
      baseUrl,
      repoPath: join(packageDir, 'reference-apps', 'api-only'),
      env: 'local',
    },
    auth: { type: 'none' },
    contracts: { openApiPath: join(packageDir, 'reference-apps', 'api-only', 'openapi.json') },
    runtime: {
      artifactsDir: join(packageDir, '.brisk-aitesting-keploy-smoke', 'artifacts'),
      timeoutMs: 120_000,
      retries: 0,
      headless: true,
      dryRun: false,
    },
    security: {
      networkPolicy: 'localhost-only',
      allowedHosts: ['127.0.0.1', 'localhost'],
      redactSecrets: true,
    },
  });
  const keployPath = join(packageDir, '.brisk-aitesting-keploy-smoke', 'keploy');
  const scenario = {
    id: 'keploy_api_only_replay',
    name: 'Keploy replays API-only traffic',
    type: 'replay',
    objective: 'Run real Keploy CLI replay/virtualization path against the API-only proof app.',
    assertions: ['Keploy CLI runs and writes local artifacts'],
    evidenceRequired: ['api'],
    metadata: {
      adapter: 'keploy',
      replay: {
        keployPath,
        requests: [{ method: 'GET', path: '/api/health', expectStatus: 200 }],
      },
    },
  };
  const unrelatedScenario = {
    id: 'keploy_unrelated_ui',
    name: 'unrelated UI scenario',
    type: 'ui',
    objective: 'Keploy must reject unrelated UI scenarios.',
    assertions: ['ui runs'],
    evidenceRequired: ['ui'],
  };
  const plan = {
    schemaVersion: 'brisk-aitesting.plan.v1',
    runId: 'keploy_smoke',
    goal: 'Run real Keploy adapter smoke',
    mode: 'replay',
    scenarios: [scenario],
    discovery: {
      schemaVersion: 'brisk-aitesting.discovery.v1',
      app: { name: config.app.name, baseUrl: config.app.baseUrl, repoPath: config.app.repoPath },
      uiRoutes: [],
      apiRoutes: [],
      contracts: [],
      repoSignals: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    },
    warnings: [],
    createdAt: new Date().toISOString(),
  };
  const engine = new KeployCliEngine({
    command: process.env.BRISK_AITESTING_KEPLOY_COMMAND ?? 'keploy',
    mode: 'test',
    path: keployPath,
  });
  const conformance = await runEnginePluginConformance({
    config,
    plan,
    cases: [{ engine, validScenario: scenario, unrelatedScenario }],
    runId: 'keploy_conformance',
  });
  const tester = createBriskAiTesting(config, {
    planner: {
      name: 'keploy-smoke-planner',
      async plan(context) {
        return { ...plan, runId: context.runId, goal: context.input.goal, discovery: context.discovery };
      },
    },
    engines: [engine],
  });
  const result = await tester.run({ goal: 'Run real Keploy CLI adapter against API-only proof app', scenarios: 1, mode: 'replay' });
  const errors = [];
  if (conformance.status !== 'passed') errors.push(`Keploy engine conformance failed: ${conformance.errors.join('; ')}`);
  if (!['passed', 'failed'].includes(result.status)) errors.push(`Keploy run should execute, got ${result.status}`);
  const evidenceArtifact = result.artifacts.find((artifact) => artifact.metadata?.schemaVersion === 'brisk-aitesting.keploy-evidence.v1' && artifact.path !== undefined);
  const evidence = evidenceArtifact?.path === undefined ? undefined : JSON.parse(await readFile(evidenceArtifact.path, 'utf8'));
  if (evidence?.schemaVersion !== 'brisk-aitesting.keploy-evidence.v1') errors.push('wrong Keploy evidence schema');
  if ((evidence?.commands?.length ?? 0) < 1) errors.push('Keploy coverage missing command run');
  if ((evidence?.artifacts?.length ?? 0) < 2) errors.push('Keploy coverage missing saved artifacts');

  const status = errors.length === 0 ? 'passed' : 'failed';
  console.log(JSON.stringify({
    schemaVersion: 'brisk-aitesting.keploy-smoke.v1',
    status,
    conformance: {
      status: conformance.status,
      engines: conformance.engines.map((entry) => ({ name: entry.name, status: entry.status })),
    },
    summary: result.summary,
    evidence: evidence === undefined ? undefined : {
      schemaVersion: evidence.schemaVersion,
      status: evidence.status,
      generated: evidence.generated,
    },
    errors,
  }, null, 2));
  if (status !== 'passed') process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// coverage missing guard for adapter readiness.
