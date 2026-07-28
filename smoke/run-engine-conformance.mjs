import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuiltinApiEngine,
  BuiltinContractEngine,
  BuiltinMessageContractEngine,
  BuiltinPlaywrightEngine,
  BuiltinReplayEngine,
  BuiltinSchemaFuzzEngine,
  defineConfig,
  normalizeConfig,
} from '../dist/index.js';

const schemaVersion = 'brisk-aitesting.engine-conformance.v1';
const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);
const workDir = join(packageDir, '.brisk-aitesting-engine-conformance');
const artifactsDir = join(workDir, 'artifacts');
const openApiPath = join(workDir, 'openapi.json');
const asyncApiPath = join(workDir, 'asyncapi.json');

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const server = createServer(async (request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'engine-conformance' }));
    return;
  }
  if (request.url === '/api/widgets' && request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const parsed = parseJsonOrNull(body);
      if (!parsed || typeof parsed.name !== 'string') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'invalid_widget' }));
        return;
      }
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html>
  <head><title>Engine Conformance</title></head>
  <body>
    <main>
      <h1>Engine Conformance</h1>
      <button data-testid="primary-action">Ready</button>
    </main>
  </body>
</html>`);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Conformance server did not expose a TCP port');

const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  await writeFile(openApiPath, JSON.stringify(openApiDocument(), null, 2), 'utf8');
  await writeFile(asyncApiPath, JSON.stringify(asyncApiDocument(), null, 2), 'utf8');

  const config = normalizeConfig(defineConfig({
    app: {
      name: 'engine conformance app',
      baseUrl,
      repoPath: packageDir,
      env: 'local',
    },
    auth: { type: 'none' },
    contracts: { openApiPath, asyncApiPath },
    runtime: {
      artifactsDir,
      timeoutMs: 30_000,
      retries: 0,
      headless: true,
      dryRun: false,
    },
    discovery: {
      includeRepo: false,
      includeUi: false,
      includeApi: false,
      includeContracts: true,
    },
    security: {
      networkPolicy: 'localhost-only',
      allowedHosts: ['localhost', '127.0.0.1', '::1'],
      redactSecrets: true,
    },
  }));

  const discovery = {
    schemaVersion: 'brisk-aitesting.discovery.v1',
    app: {
      name: config.app.name,
      baseUrl: config.app.baseUrl,
      repoPath: config.app.repoPath,
    },
    uiRoutes: [{ path: '/', source: 'config', confidence: 1 }],
    apiRoutes: [{
      method: 'GET',
      path: '/api/health',
      source: 'contract',
      confidence: 1,
      operationId: 'getHealth',
      contractPath: openApiPath,
      statusCodes: [200],
    }],
    contracts: [
      { kind: 'openapi', path: openApiPath, exists: true, operations: 1 },
      { kind: 'asyncapi', path: asyncApiPath, exists: true },
    ],
    repoSignals: [],
    warnings: [],
    createdAt: new Date().toISOString(),
  };

  const scenarios = {
    api: {
      id: 'conformance_api_health',
      name: 'API engine conformance health check',
      type: 'api',
      objective: 'API engine returns a valid ScenarioResult.',
      target: { method: 'GET', path: '/api/health' },
      expect: { status: 200, json: { ok: true, service: 'engine-conformance' } },
      assertions: ['status is 200', 'json.ok is true'],
      evidenceRequired: ['api'],
    },
    ui: {
      id: 'conformance_ui_home',
      name: 'Playwright engine conformance homepage check',
      type: 'ui',
      objective: 'Playwright engine returns a valid ScenarioResult.',
      target: { route: '/' },
      assertions: ['body is visible'],
      evidenceRequired: ['ui'],
    },
    contract: {
      id: 'conformance_contract_openapi',
      name: 'Contract engine conformance OpenAPI check',
      type: 'contract',
      objective: 'Contract engine returns a valid ScenarioResult.',
      target: { schema: openApiPath },
      assertions: ['contract parses'],
      evidenceRequired: ['schema'],
    },
    schema: {
      id: 'conformance_schema_fuzz',
      name: 'Schema fuzz engine conformance OpenAPI negative check',
      type: 'schema',
      objective: 'Schema fuzz engine sends malformed OpenAPI requests and receives safe rejection.',
      target: { schema: openApiPath },
      assertions: ['malformed requests are rejected'],
      evidenceRequired: ['schema', 'api'],
    },
    replay: {
      id: 'conformance_replay_health',
      name: 'Replay engine conformance health check',
      type: 'replay',
      objective: 'Replay engine reruns declared HTTP interactions.',
      assertions: ['recorded interaction replays'],
      evidenceRequired: ['api'],
      metadata: {
        replay: {
          requests: [{ method: 'GET', path: '/api/health', expectStatus: 200 }],
        },
      },
    },
    message: {
      id: 'conformance_message_contract',
      name: 'Message engine conformance AsyncAPI check',
      type: 'message',
      objective: 'Message contract engine returns a valid ScenarioResult.',
      target: { schema: asyncApiPath, channel: 'orders.created' },
      assertions: ['message contract exposes channel and payload'],
      evidenceRequired: ['message', 'schema'],
    },
  };

  const plan = {
    schemaVersion: 'brisk-aitesting.plan.v1',
    runId: 'engine_conformance',
    goal: 'Engine conformance',
    mode: 'automatic',
    scenarios: Object.values(scenarios),
    discovery,
    warnings: [],
    createdAt: new Date().toISOString(),
  };

  const engineCases = [
    { engine: new BuiltinApiEngine(), validScenario: scenarios.api, unrelatedScenario: scenarios.ui },
    { engine: new BuiltinContractEngine(), validScenario: scenarios.contract, unrelatedScenario: scenarios.api },
    { engine: new BuiltinSchemaFuzzEngine(), validScenario: scenarios.schema, unrelatedScenario: scenarios.api },
    { engine: new BuiltinReplayEngine(), validScenario: scenarios.replay, unrelatedScenario: scenarios.api },
    { engine: new BuiltinMessageContractEngine(), validScenario: scenarios.message, unrelatedScenario: scenarios.api },
    { engine: new BuiltinPlaywrightEngine(), validScenario: scenarios.ui, unrelatedScenario: scenarios.api },
  ];

  const engines = [];
  const errors = [];

  for (const engineCase of engineCases) {
    const report = await checkEngine({
      config,
      plan,
      engine: engineCase.engine,
      validScenario: engineCase.validScenario,
      unrelatedScenario: engineCase.unrelatedScenario,
    });
    engines.push(report);
    errors.push(...report.errors.map((error) => `${engineCase.engine.name}: ${error}`));
  }

  const status = errors.length === 0 ? 'passed' : 'failed';
  const output = {
    schemaVersion,
    status,
    engines,
    errors,
  };

  console.log(JSON.stringify(output, null, 2));
  if (status !== 'passed') process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function checkEngine({ config, plan, engine, validScenario, unrelatedScenario }) {
  const checks = [];
  const errors = [];
  const record = (name, passed, detail) => {
    checks.push({
      name,
      status: passed ? 'passed' : 'failed',
      ...(detail !== undefined ? { detail } : {}),
    });
    if (!passed) errors.push(`${name}${detail !== undefined ? `: ${detail}` : ''}`);
  };

  record('name is non-empty', typeof engine.name === 'string' && engine.name.length > 0);
  record('type is valid', ['ui', 'api', 'contract', 'schema', 'replay', 'message', 'custom'].includes(engine.type));
  record('canRun accepts own scenario', engine.canRun(validScenario) === true);
  record('canRun rejects unrelated scenario', engine.canRun(unrelatedScenario) === false);

  let output;
  try {
    output = await engine.run({ config, runId: `engine_conformance_${engine.type}`, plan, scenario: validScenario });
    record('run returns output object', isRecord(output));
  } catch (error) {
    record('run returns output object', false, error instanceof Error ? error.message : String(error));
  }

  if (isRecord(output)) {
    validateEngineOutput(output, validScenario, record);
  }

  return {
    name: engine.name,
    type: engine.type,
    status: errors.length === 0 ? 'passed' : 'failed',
    checks,
    errors,
  };
}

function validateEngineOutput(output, scenario, record) {
  const result = output.result;
  record('result exists', isRecord(result));
  if (!isRecord(result)) return;

  record('result.scenarioId matches scenario', result.scenarioId === scenario.id);
  record('result.name is non-empty', typeof result.name === 'string' && result.name.length > 0);
  record('result.type matches scenario', result.type === scenario.type);
  record('result.engine is non-empty', typeof result.engine === 'string' && result.engine.length > 0);
  record('result.status is valid', ['passed', 'failed', 'error', 'skipped'].includes(result.status));
  record('valid scenario passes', result.status === 'passed', result.status);
  record('result.durationMs is a number', typeof result.durationMs === 'number' && Number.isFinite(result.durationMs));
  record('result.assertions is an array', Array.isArray(result.assertions));
  record('result.artifacts is an array', Array.isArray(result.artifacts));
  record('result.diagnostics is an array', Array.isArray(result.diagnostics));
  record('result has no obvious secret leakage', !containsSecretLikeValue(result));

  if (Array.isArray(result.artifacts)) {
    for (const [index, artifact] of result.artifacts.entries()) {
      record(`artifact ${index + 1} shape is valid`, isValidArtifact(artifact), JSON.stringify(artifact));
    }
  }

  if (Array.isArray(output.artifacts)) {
    for (const [index, artifact] of output.artifacts.entries()) {
      record(`output artifact ${index + 1} shape is valid`, isValidArtifact(artifact), JSON.stringify(artifact));
    }
  }
}

function isValidArtifact(value) {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== 'string' || value.kind.length === 0) return false;
  if (typeof value.label !== 'string' || value.label.length === 0) return false;
  if (value.path !== undefined && typeof value.path !== 'string') return false;
  if (value.url !== undefined && typeof value.url !== 'string') return false;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  return true;
}

function containsSecretLikeValue(value) {
  const text = JSON.stringify(value);
  return /sk-[A-Za-z0-9]{12,}|npm_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|AKIA[A-Z0-9]{12,}/i.test(text);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function openApiDocument() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Engine Conformance API',
      version: '1.0.0',
    },
    paths: {
      '/api/health': {
        get: {
          operationId: 'getHealth',
          responses: {
            200: {
              description: 'Healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'service'],
                    properties: {
                      ok: { type: 'boolean' },
                      service: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/widgets': {
        post: {
          operationId: 'createWidget',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: {
                      ok: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Invalid request',
            },
          },
        },
      },
    },
  };
}

function asyncApiDocument() {
  return {
    asyncapi: '2.6.0',
    info: {
      title: 'Engine Conformance Events',
      version: '1.0.0',
    },
    channels: {
      'orders.created': {
        publish: {
          message: {
            name: 'OrderCreated',
            contentType: 'application/json',
            payload: {
              type: 'object',
              required: ['orderId', 'total'],
              properties: {
                orderId: { type: 'string' },
                total: { type: 'number' },
              },
            },
          },
        },
      },
    },
  };
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
