import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuiltinDiscoverer,
  createBriskAiTesting,
  defineConfig,
  loadOpenApiSummary,
  normalizeConfig,
  parseAiPlanForTesting,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);
const workDir = join(packageDir, '.brisk-aitesting-benchmark');
const reportPath = join(workDir, 'benchmark-report.json');

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
await mkdir(join(workDir, 'src'), { recursive: true });
await writeFile(join(workDir, 'malformed-openapi.yaml'), 'openapi: 3.0.3\npaths:\n  /broken:\n    get: [', 'utf8');
await writeFile(join(workDir, 'empty-openapi.json'), JSON.stringify({ openapi: '3.0.3', info: { title: 'Empty', version: '1.0.0' }, paths: {} }, null, 2), 'utf8');
await writeFile(join(workDir, 'package.json'), JSON.stringify({ dependencies: { express: '^4.0.0' } }, null, 2), 'utf8');
await writeFile(join(workDir, 'src', 'routes.ts'), [
  "import express from 'express';",
  'const app = express();',
  'const apiRouter = express.Router();',
  'const channelRouter = express.Router();',
  "app.get('/api/implemented', (_request, response) => response.json({ ok: true }));",
  "app.get('/api/users/:id', (_request, response) => response.json({ ok: true }));",
  "app.post('/api/undocumented', (_request, response) => response.json({ ok: true }));",
  "apiRouter.use('/channels', channelRouter);",
  "channelRouter.get('/:channelId/topics', (_request, response) => response.json({ ok: true }));",
  "channelRouter.post('/undocumented-nested', (_request, response) => response.json({ ok: true }));",
  "apiRouter.route('/subscriptions').get((_request, response) => response.json({ ok: true }));",
  "app.use('/api', apiRouter);",
  "request('/api/generic-request-helper');",
  "app.get('/internal/ignored', (_request, response) => response.json({ ok: true }));",
].join('\n'), 'utf8');
await writeFile(join(workDir, 'src', 'nest-controller.ts'), [
  "import { Controller, Delete, Get, Post } from '@nestjs/common';",
  "@Controller('/api/audit')",
  'export class AuditController {',
  "  @Get('/:eventId')",
  '  readEvent() { return { ok: true }; }',
  '  @Post()',
  '  createEvent() { return { ok: true }; }',
  "  @Delete('/undocumented-nest')",
  '  deleteUndocumentedEvent() { return { ok: true }; }',
  '}',
].join('\n'), 'utf8');

const server = createServer(async (request, response) => {
  if (request.url === '/api/wrong-schema') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: 'not-a-boolean' }));
    return;
  }
  if (request.url === '/api/undocumented-status') {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Benchmark server did not expose a TCP port');

const cases = [];
try {
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const contractPath = join(workDir, 'benchmark-openapi.json');
  await writeFile(contractPath, JSON.stringify(benchmarkOpenApi(), null, 2), 'utf8');

  await benchmark(cases, {
    id: 'config.rejects-secret-looking-api-key-env',
    area: 'config',
    expected: 'normalizeConfig rejects apiKeyEnv values that look like secrets',
    run: async () => {
      let passed = false;
      try {
        normalizeConfig(defineConfig({
          app: { name: 'bad config', baseUrl },
          ai: { provider: 'minimax', model: 'model', apiKeyEnv: 'sk-secret-value' },
        }));
      } catch (error) {
        passed = error instanceof Error && error.message.includes('ai.apiKeyEnv must be an environment variable name');
      }
      return { passed, observed: passed ? 'rejected secret-looking apiKeyEnv' : 'config was accepted' };
    },
  });

  await benchmark(cases, {
    id: 'openapi.malformed-yaml-fails',
    area: 'openapi',
    expected: 'malformed YAML OpenAPI throws a parser error',
    run: async () => {
      try {
        await loadOpenApiSummary(join(workDir, 'malformed-openapi.yaml'));
        return { passed: false, observed: 'malformed YAML parsed successfully' };
      } catch (error) {
        return { passed: error instanceof Error, observed: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  await benchmark(cases, {
    id: 'openapi.empty-paths-diagnosed',
    area: 'openapi',
    expected: 'OpenAPI with no paths returns diagnostics and zero operations',
    run: async () => {
      const summary = await loadOpenApiSummary(join(workDir, 'empty-openapi.json'));
      const passed = summary.operations.length === 0 && summary.diagnostics.some((entry) => /did not expose any HTTP operations/i.test(entry));
      return { passed, observed: JSON.stringify({ operations: summary.operations.length, diagnostics: summary.diagnostics }) };
    },
  });

  await benchmark(cases, {
    id: 'discovery.missing-openapi-reported',
    area: 'discovery',
    expected: 'missing OpenAPI contract is reported in discovery warnings',
    run: async () => {
      const config = defineConfig({
        app: { name: 'missing contract app', baseUrl },
        contracts: { openApiPath: join(workDir, 'missing-openapi.yaml') },
        discovery: { includeRepo: false, includeUi: false, includeApi: false, includeContracts: true },
      });
      const normalized = normalizeConfig(config);
      const discovery = await new BuiltinDiscoverer().discover({ config: normalized, input: { goal: 'missing contract' }, runId: `bench_${randomUUID()}` });
      const passed = discovery.contracts[0]?.exists === false && discovery.warnings.some((warning) => /does not exist/i.test(warning));
      return { passed, observed: JSON.stringify({ contracts: discovery.contracts, warnings: discovery.warnings }) };
    },
  });

  await benchmark(cases, {
    id: 'discovery.contract-drift-reports-route-mismatches',
    area: 'discovery',
    expected: 'discovery reports implemented-but-undocumented and documented-but-not-implemented API routes',
    run: async () => {
      const driftContractPath = join(workDir, 'drift-openapi.json');
      await writeFile(driftContractPath, JSON.stringify(driftOpenApi(), null, 2), 'utf8');
      const config = defineConfig({
        app: { name: 'drift benchmark app', baseUrl, repoPath: workDir },
        contracts: { openApiPath: driftContractPath },
        discovery: { includeRepo: true, includeUi: false, includeApi: false, includeContracts: true },
      });
      const normalized = normalizeConfig(config);
      const discovery = await new BuiltinDiscoverer().discover({ config: normalized, input: { goal: 'contract drift' }, runId: `bench_${randomUUID()}` });
      const drift = discovery.contractDrift;
      const passed = drift?.schemaVersion === 'brisk-aitesting.contract-drift.v1'
        && drift.implementedButUndocumented.some((route) => route.method === 'POST' && route.path === '/api/undocumented')
        && drift.implementedButUndocumented.some((route) => route.method === 'POST' && route.path === '/api/channels/undocumented-nested')
        && drift.implementedButUndocumented.some((route) => route.method === 'DELETE' && route.path === '/api/audit/undocumented-nest')
        && drift.documentedButNotImplemented.some((route) => route.method === 'GET' && route.path === '/api/documented-only')
        && drift.matchedRoutes.some((route) => route.method === 'GET' && route.path === '/api/implemented')
        && drift.matchedRoutes.some((route) => route.method === 'GET' && route.implementation.path === '/api/users/:id' && route.contract.path === '/api/users/{userId}')
        && drift.matchedRoutes.some((route) => route.method === 'GET' && route.implementation.path === '/api/channels/:channelId/topics' && route.contract.path === '/api/channels/{channelId}/topics')
        && drift.matchedRoutes.some((route) => route.method === 'GET' && route.path === '/api/subscriptions')
        && drift.matchedRoutes.some((route) => route.method === 'GET' && route.implementation.path === '/api/audit/:eventId' && route.contract.path === '/api/audit/{eventId}')
        && drift.matchedRoutes.some((route) => route.method === 'POST' && route.path === '/api/audit')
        && !discovery.apiRoutes.some((route) => route.method === 'REQUEST')
        && !discovery.apiRoutes.some((route) => route.path === '/api/generic-request-helper')
        && !drift.implementedButUndocumented.some((route) => route.path === '/api/health');
      return {
        passed,
        observed: JSON.stringify({
          implementedButUndocumented: drift?.implementedButUndocumented,
          documentedButNotImplemented: drift?.documentedButNotImplemented,
          matchedRoutes: drift?.matchedRoutes.map((route) => ({ method: route.method, path: route.path })),
          apiRouteMethods: discovery.apiRoutes.map((route) => route.method),
          diagnostics: drift?.diagnostics,
        }),
      };
    },
  });

  await benchmark(cases, {
    id: 'ai-parser.ignores-irrelevant-object-before-plan',
    area: 'ai',
    expected: 'AI parser selects the real plan instead of an earlier irrelevant object',
    run: async () => {
      const context = await plannerContext(baseUrl);
      const plan = parseAiPlanForTesting('Ignore this object { route: "/" }\nActual plan:\n{ scenarios: [{ name: "Health", type: "backend", target: { method: "GET", path: "/api/wrong-schema" }, assertions: ["runs"], evidenceRequired: ["api"] }] }', context);
      const passed = plan.scenarios.length === 1 && plan.scenarios[0]?.target?.path === '/api/wrong-schema';
      return { passed, observed: JSON.stringify(plan.scenarios.map((scenario) => scenario.target)) };
    },
  });

  await benchmark(cases, {
    id: 'api.response-schema-mismatch-fails',
    area: 'api',
    expected: 'API engine fails when response body violates OpenAPI schema',
    run: async () => {
      const result = await runApiScenario(baseUrl, contractPath, {
        id: 'wrong_schema',
        name: 'Wrong schema fails',
        type: 'api',
        objective: 'Response schema mismatch should fail.',
        target: { method: 'GET', path: '/api/wrong-schema' },
        expect: { status: 200 },
        assertions: ['response body matches schema'],
        evidenceRequired: ['api', 'schema'],
      });
      const test = result.tests[0];
      const passed = result.status === 'failed' && test?.assertions.some((assertion) => /response body matches OpenAPI schema/.test(assertion.name) && assertion.status === 'failed');
      return { passed, observed: JSON.stringify({ status: result.status, assertions: test?.assertions, diagnosis: result.diagnosis }) };
    },
  });

  await benchmark(cases, {
    id: 'api.undocumented-status-fails',
    area: 'api',
    expected: 'API engine fails when status is not documented by OpenAPI',
    run: async () => {
      const result = await runApiScenario(baseUrl, contractPath, {
        id: 'undocumented_status',
        name: 'Undocumented status fails',
        type: 'api',
        objective: 'Undocumented status should fail.',
        target: { method: 'GET', path: '/api/undocumented-status' },
        assertions: ['status is documented'],
        evidenceRequired: ['api', 'schema'],
      });
      const test = result.tests[0];
      const passed = result.status === 'failed' && test?.assertions.some((assertion) => /documented in contract/.test(assertion.name) && assertion.status === 'failed');
      return { passed, observed: JSON.stringify({ status: result.status, assertions: test?.assertions, diagnosis: result.diagnosis }) };
    },
  });

  await benchmark(cases, {
    id: 'security.network-policy-blocks-disallowed-host',
    area: 'security',
    expected: 'network policy blocks hosts outside allowlist without crashing',
    run: async () => {
      const result = await runApiScenario('http://example.com', undefined, {
        id: 'blocked_network',
        name: 'Blocked network policy',
        type: 'api',
        objective: 'Network policy should skip disallowed host.',
        target: { method: 'GET', path: '/api/health' },
        assertions: ['network policy blocks request'],
        evidenceRequired: ['api'],
      }, { allowedHosts: ['127.0.0.1'] });
      const test = result.tests[0];
      const passed = result.status === 'skipped' && test?.diagnostics.some((diagnostic) => /Network policy blocked host/i.test(diagnostic));
      return { passed, observed: JSON.stringify({ status: result.status, diagnostics: test?.diagnostics }) };
    },
  });

  await benchmark(cases, {
    id: 'cli.invalid-scenarios-exits-2',
    area: 'cli',
    expected: 'CLI invalid --scenarios exits with code 2 and clear message',
    run: async () => {
      const configPath = join(workDir, 'cli-benchmark.config.mjs');
      await writeFile(configPath, `export default { app: { name: 'CLI benchmark', baseUrl: ${JSON.stringify(baseUrl)} } };\n`, 'utf8');
      const cli = await runCli(['run', '--config', configPath, '--goal', 'bad scenarios', '--scenarios', '0']);
      const passed = cli.code === 2 && cli.stderr.includes('--scenarios must be a positive integer');
      return { passed, observed: JSON.stringify(cli) };
    },
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const passed = cases.filter((entry) => entry.status === 'passed').length;
const failed = cases.filter((entry) => entry.status === 'failed').length;
const report = {
  schemaVersion: 'brisk-aitesting.benchmark.v1',
  generatedAt: new Date().toISOString(),
  summary: {
    total: cases.length,
    passed,
    failed,
    passRate: cases.length === 0 ? 0 : Math.round((passed / cases.length) * 10000) / 100,
  },
  cases,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failed > 0) process.exitCode = 1;

async function benchmark(cases, testCase) {
  const started = Date.now();
  try {
    const output = await testCase.run();
    cases.push({
      id: testCase.id,
      area: testCase.area,
      status: output.passed ? 'passed' : 'failed',
      expected: testCase.expected,
      observed: output.observed,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    cases.push({
      id: testCase.id,
      area: testCase.area,
      status: 'failed',
      expected: testCase.expected,
      observed: error instanceof Error ? error.stack ?? error.message : String(error),
      durationMs: Date.now() - started,
    });
  }
}

async function plannerContext(baseUrl) {
  const config = normalizeConfig(defineConfig({
    app: { name: 'planner context', baseUrl },
    discovery: { includeRepo: false, includeUi: false, includeApi: true, includeContracts: false },
  }));
  const runId = `bench_${randomUUID()}`;
  const discovery = await new BuiltinDiscoverer().discover({ config, input: { goal: 'planner context' }, runId });
  return { config, input: { goal: 'planner context', scenarios: 1, mode: 'automatic' }, runId, discovery };
}

async function runApiScenario(baseUrl, contractPath, scenario, security = {}) {
  const config = defineConfig({
    app: { name: 'benchmark app', baseUrl },
    ...(contractPath !== undefined ? { contracts: { openApiPath: contractPath } } : {}),
    runtime: {
      artifactsDir: join(workDir, 'artifacts'),
      timeoutMs: 30000,
      retries: 0,
      headless: true,
      dryRun: false,
    },
    discovery: {
      includeRepo: false,
      includeUi: false,
      includeApi: true,
      includeContracts: contractPath !== undefined,
    },
    security: {
      networkPolicy: 'localhost-only',
      allowedHosts: ['127.0.0.1', 'localhost'],
      redactSecrets: true,
      ...security,
    },
  });
  const planner = {
    name: `benchmark-planner-${scenario.id}`,
    async plan(context) {
      return {
        schemaVersion: 'brisk-aitesting.plan.v1',
        runId: context.runId,
        goal: context.input.goal,
        mode: 'automatic',
        discovery: context.discovery,
        createdAt: new Date().toISOString(),
        warnings: [],
        scenarios: [scenario],
      };
    },
  };
  return createBriskAiTesting(config, { planner }).run({
    goal: scenario.objective,
    scenarios: 1,
    mode: 'automatic',
  });
}

function benchmarkOpenApi() {
  return {
    openapi: '3.0.3',
    info: { title: 'Benchmark API', version: '1.0.0' },
    paths: {
      '/api/wrong-schema': {
        get: {
          operationId: 'getWrongSchema',
          responses: {
            200: {
              description: 'Wrong schema endpoint',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/undocumented-status': {
        get: {
          operationId: 'getUndocumentedStatus',
          responses: {
            200: {
              description: 'Documented success',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function driftOpenApi() {
  return {
    openapi: '3.0.3',
    info: { title: 'Drift Benchmark API', version: '1.0.0' },
    paths: {
      '/api/implemented': {
        get: {
          operationId: 'getImplemented',
          responses: {
            200: {
              description: 'Implemented endpoint',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/documented-only': {
        get: {
          operationId: 'getDocumentedOnly',
          responses: {
            200: {
              description: 'Documented but not implemented',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/users/{userId}': {
        get: {
          operationId: 'getUserById',
          responses: {
            200: {
              description: 'Parameterized user endpoint',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/channels/{channelId}/topics': {
        get: {
          operationId: 'listChannelTopics',
          responses: {
            200: {
              description: 'Nested router route',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/subscriptions': {
        get: {
          operationId: 'listSubscriptions',
          responses: {
            200: {
              description: 'Express router.route endpoint',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/audit/{eventId}': {
        get: {
          operationId: 'getAuditEvent',
          responses: {
            200: {
              description: 'Nest decorator endpoint',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/audit': {
        post: {
          operationId: 'createAuditEvent',
          responses: {
            201: {
              description: 'Nest decorator endpoint without method path',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok'],
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
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
